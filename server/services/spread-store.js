/**
 * Loads the spreads of a workspace and saves changes to them.
 * Saves check for outside changes, verify the new source by parsing it again, keep backups of the original
 * bytes outside the repository and journal their progress so an interrupted save can be undone later.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { StatusCode } = require("status-code-enum");

const { ApiError } = require("../middleware/errors");
const { readGameData } = require("./catalog");
const { parseTeamTypes } = require("./data-parser");
const { CACHE_DIRECTORY, createParseCache, getDataDirectory, getParserVersion, hashMacros } = require("./parse-cache");
const { evaluatePreprocessor } = require("./preprocessor");
const
{
    CFRU_CONFIG_FILE, CFRU_FRONTIER_HEADER, CFRU_SPREAD_FILES, CFRU_TRAINERS_FILE, REPOSITORY_CFRU, getRootKey, readOwnedBuffer,
    resolveOwnedFile,
} = require("./repositories");
const { ROLE_LITTLE_CUP, SPREAD_FIELDS, isAutomaticSize, parseSpreadFile, parseTrainerTables } = require("./spread-parser");
const { applyEdits, buildSetEdits, createSpreadFields, isSameValue, mergeSpreadFields, toAbilityName } = require("./spread-writer");

const [BATTLE_TOWER_FILE, SPECIAL_TRAINER_FILE, MULTI_PARTNER_FILE, RAID_PARTNER_FILE] = CFRU_SPREAD_FILES;
const SPREAD_CATEGORIES =
{
    [BATTLE_TOWER_FILE]: "battleTower",
    [SPECIAL_TRAINER_FILE]: "specialTrainer",
    [MULTI_PARTNER_FILE]: "multiPartner",
    [RAID_PARTNER_FILE]: "raidPartner",
};
const INPUT_FILES = [CFRU_CONFIG_FILE, CFRU_FRONTIER_HEADER, CFRU_TRAINERS_FILE, ...CFRU_SPREAD_FILES];
const LITTLE_CUP_POOLS = new Set(["gLittleCupSpreads"]);
const ABILITY_DATA_KEYS = ["hiddenAbility", "ability1", "ability2"];
const BASE_STATS_KEY = "baseStats";
const TEAM_TYPE_FIELD = "specificTeamType";

// An omitted specificTeamType is 0, the first team type
const TEAM_TYPE_OMITTED = 0;

const BYTE_ORDER_MARK = "\uFEFF";
const LINE_ENDING_CRLF = "\r\n";
const LINE_ENDING_LF = "\n";
const HASH_ALGORITHM = "sha256";

const CACHE_SPREAD_FILE = "spread-file";
const CACHE_TRAINER_TABLES = "trainer-tables";
const CACHE_TEAM_TYPES = "team-types";
const JOURNAL_DIRECTORY = "journal";
const BACKUP_DIRECTORY = "backups";
const JOURNAL_EXTENSION = ".json";
const MANIFEST_FILE = "manifest.json";
const TEMP_SUFFIX = ".tmp";

const JOURNAL_STAGED = "staged";
const JOURNAL_COMMITTING = "committing";
const JOURNAL_FAILED = "failed";
const FILE_PENDING = "pending";
const FILE_REPLACED = "replaced";
const FILE_SAVED = "saved";
const FILE_ROLLED_BACK = "rolledBack";
const FILE_NOT_REPLACED = "notReplaced";
const FILE_EXTERNALLY_MODIFIED = "externallyModified";
const FILE_FAILED = "failed";

const OPERATION_UPDATE = "update";
const OPERATION_ADD = "add";
const OPERATION_REORDER = "reorder";
const MAX_OPERATIONS = 20000;
const TEMP_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const REPLACE_RETRY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const REPLACE_ATTEMPTS = 5;
const REPLACE_RETRY_DELAY_MS = 100;
const MISSING_FILE_CODE = "ENOENT";

const SEVERITY_ERROR = "error";
const SEVERITY_WARNING = "warning";


/**
 * Returns the hash of some bytes.
 *
 * @param {Buffer} bytes The bytes.
 * @returns {string} The hex digest.
 */
function hashBytes(bytes)
{
    return crypto.createHash(HASH_ALGORITHM).update(bytes).digest("hex");
}

/**
 * Decodes a source file and describes how it is written.
 *
 * @param {Buffer} bytes The file contents.
 * @returns {{text: string, hash: string, lossless: boolean, bom: boolean, lineEnding: string}} The text and its format.
 */
function decodeSource(bytes)
{
    // Only files that turn back into the same bytes can be edited as text
    const text = bytes.toString("utf8");
    const crlfCount = (text.match(/\r\n/g) ?? []).length;
    const lfCount = (text.match(/\n/g) ?? []).length;

    return {
        text,
        hash: hashBytes(bytes),
        lossless: Buffer.from(text, "utf8").equals(bytes),
        bom: text.startsWith(BYTE_ORDER_MARK),
        lineEnding: crlfCount > 0 && crlfCount * 2 >= lfCount ? LINE_ENDING_CRLF : LINE_ENDING_LF,
    };
}

/**
 * Adds a file path to diagnostics.
 *
 * @param {Array<object>} diagnostics The diagnostics.
 * @param {string} file The repository-relative file.
 * @returns {Array<object>} The diagnostics with repository and file.
 */
function withFile(diagnostics, file)
{
    return diagnostics.map((diagnostic) => ({ ...diagnostic, repository: REPOSITORY_CFRU, file }));
}

/**
 * Throws a validation error for a save request.
 *
 * @param {string} message The description.
 */
function invalid(message)
{
    throw new ApiError(StatusCode.ClientErrorUnprocessableEntity, "INVALID_OPERATION", message);
}

/**
 * Reads every file that decides what the spreads contain.
 *
 * @param {object} workspace The workspace.
 * @returns {Promise<Map<string, Buffer>>} Relative paths to contents.
 */
async function readInputs(workspace)
{
    const contents = await Promise.all(INPUT_FILES.map((file) => readOwnedBuffer(workspace, REPOSITORY_CFRU, file)));
    return new Map(INPUT_FILES.map((file, index) => [file, contents[index]]));
}

/**
 * Parses a spread file into a result that can be cached.
 *
 * @param {string} text The file text.
 * @param {Map<string, object>} macros The configuration macros.
 * @returns {{sets: Array<object>, diagnostics: Array<object>, editable: boolean}} The parse result.
 */
function parseSpreads(text, macros)
{
    const { sets, diagnostics, editable } = parseSpreadFile(text, macros);
    return { sets, diagnostics, editable };
}

/**
 * Returns the cache slot and inputs for a parsed CFRU file.
 *
 * @param {object} workspace The workspace.
 * @param {string} file The relative path.
 * @param {string} fileHash The file's hash.
 * @param {string} macrosHash The configuration macros' hash.
 * @returns {{slot: string, inputs: Array<string>}} The slot and inputs.
 */
function getCacheEntry(workspace, file, fileHash, macrosHash)
{
    return { slot: `${getRootKey(workspace, REPOSITORY_CFRU)}\n${file}`, inputs: [getParserVersion(), fileHash, macrosHash] };
}

/**
 * Creates the server-side state of one parsed spread file.
 *
 * @param {string} file The relative path.
 * @param {object} decoded The decoded file.
 * @param {object} parsed The parse result.
 * @returns {object} The file state.
 */
function createFileState(file, decoded, parsed)
{
    const diagnostics = withFile(parsed.diagnostics, file);
    if (!decoded.lossless)
        diagnostics.push({ severity: SEVERITY_ERROR, code: "FILE_ENCODING_UNSUPPORTED", message: `${file} is not valid UTF-8, so its spreads cannot be changed.`, repository: REPOSITORY_CFRU, file });
    if (!parsed.editable)
        diagnostics.push({ severity: SEVERITY_ERROR, code: "FILE_NOT_EDITABLE", message: `${file} has parts the editor cannot read reliably, so its spreads cannot be changed.`, repository: REPOSITORY_CFRU, file });

    return { path: file, ...decoded, parsed, editable: parsed.editable && decoded.lossless, diagnostics, setIds: [] };
}

/**
 * Connects trainers to the spread arrays they use and decides what each set allows.
 *
 * @param {object} state The spread state.
 */
function describeSets(state)
{
    const setsByName = new Map();
    for (const set of state.sets.values())
        setsByName.set(set.model.name, [...(setsByName.get(set.model.name) ?? []), set]);

    // Attach each trainer link to the one array it names, preferring arrays in the trainer's own file
    for (const set of state.sets.values())
        set.usages = [];
    for (const trainer of state.trainers)
    {
        for (const link of trainer.links)
        {
            const candidates = setsByName.get(link.set) ?? [];
            const sameFile = candidates.filter((set) => set.file === trainer.file);
            const matches = sameFile.length > 0 ? sameFile : candidates;
            link.setId = matches.length === 1 ? matches[0].id : null;
            if (matches.length === 1)
                matches[0].usages.push({ trainerId: trainer.id, trainerName: trainer.name, table: trainer.table, kind: trainer.kind, role: link.role, ranks: link.ranks ?? null, sizeExpression: link.sizeExpression });
        }
    }

    for (const set of state.sets.values())
    {
        const file = state.files.get(set.file);
        const { model } = set;

        // Little Cup comes only from the known pool and trainers' Little Cup pointers
        set.littleCup = LITTLE_CUP_POOLS.has(model.name) || set.usages.some((usage) => usage.role === ROLE_LITTLE_CUP);
        set.canEdit = file.editable && model.occurrence === 1;
        set.canReorder = set.canEdit && model.structureEditable;

        // New entries must be counted automatically wherever the array's size is used
        const fixedSizeUsage = set.usages.find((usage) => !isAutomaticSize(usage.sizeExpression, model.name));
        if (!set.canEdit)
            set.insertBlockedReason = `${set.file} cannot be changed safely.`;
        else if (!model.structureEditable)
            set.insertBlockedReason = `${model.name} contains entries the editor cannot read.`;
        else if (model.fixedSize != null)
            set.insertBlockedReason = `${model.name} is declared with a fixed size of ${model.fixedSize}.`;
        else if (fixedSizeUsage != null)
            set.insertBlockedReason = `${fixedSizeUsage.trainerName} uses ${fixedSizeUsage.sizeExpression} as the size of ${model.name}, which would not count new spreads.`;
        else
            set.insertBlockedReason = null;
        set.canInsert = set.insertBlockedReason == null;
    }
}

/**
 * Registers the sets and entries of a parsed file, reusing IDs for entries that already have them.
 *
 * @param {object} state The spread state.
 * @param {object} fileState The file state.
 * @param {Map<number, Array<string>>} [entryIds] Entry IDs for each set index, in order.
 */
function registerFile(state, fileState, entryIds = new Map())
{
    // Remove what the file registered before
    for (const setId of fileState.setIds)
    {
        for (const entryId of state.sets.get(setId)?.entryIds ?? [])
            state.entries.delete(entryId);
        state.sets.delete(setId);
    }
    fileState.setIds = [];

    fileState.parsed.sets.forEach((model, index) =>
    {
        const id = `${fileState.path}#${model.name}${model.occurrence > 1 ? `#${model.occurrence}` : ""}`;
        const ids = model.entries.map((entry, position) => entryIds.get(index)?.[position] ?? `e${(state.nextId++).toString(36)}`);
        state.sets.set(id, { id, file: fileState.path, category: SPREAD_CATEGORIES[fileState.path], model, entryIds: ids });
        model.entries.forEach((entry, position) => state.entries.set(ids[position], { id: ids[position], setId: id, model: entry }));
        fileState.setIds.push(id);
    });
}

/**
 * Returns a revision covering every input file.
 *
 * @param {Map<string, string>} hashes Relative paths to hashes.
 * @returns {string} The revision.
 */
function getRevision(hashes)
{
    return hashBytes(Buffer.from(INPUT_FILES.map((file) => `${file}:${hashes.get(file)}`).join("\n")));
}

/**
 * Builds the spread state from the input files, reusing cached parses of files that have not changed.
 *
 * @param {object} workspace The workspace.
 * @param {Map<string, Buffer>} inputs Relative paths to contents.
 * @param {object} cache The parse cache.
 * @returns {Promise<object>} The state.
 */
async function buildState(workspace, inputs, cache)
{
    // Configuration macros decide which branches of every other file are compiled
    const decoded = new Map([...inputs].map(([file, bytes]) => [file, decodeSource(bytes)]));
    const configuration = evaluatePreprocessor(decoded.get(CFRU_CONFIG_FILE).text);
    const macros = configuration.macros;
    const state =
    {
        hashes: new Map([...decoded].map(([file, { hash }]) => [file, hash])),
        macros,
        macrosHash: hashMacros(macros),
        files: new Map(),
        sets: new Map(),
        entries: new Map(),
        trainers: [],
        teamTypes: null,
        diagnostics: withFile(configuration.diagnostics, CFRU_CONFIG_FILE),
        nextId: 0,
        stale: false,
    };
    state.revision = getRevision(state.hashes);

    // Each file is cached separately, so changing one only parses that one again
    const parse = (namespace, file, create) =>
    {
        const { slot, inputs: cacheInputs } = getCacheEntry(workspace, file, decoded.get(file).hash, state.macrosHash);
        return cache.getOrCreate(namespace, slot, cacheInputs, create);
    };

    for (const file of CFRU_SPREAD_FILES)
    {
        const parsed = await parse(CACHE_SPREAD_FILE, file, () => parseSpreads(decoded.get(file).text, macros));
        const fileState = createFileState(file, decoded.get(file), parsed);
        state.files.set(file, fileState);
        registerFile(state, fileState);
    }

    // Trainer tables live in the trainers file, and raid partners next to their spreads
    for (const file of [CFRU_TRAINERS_FILE, RAID_PARTNER_FILE])
    {
        const { trainers, diagnostics } = await parse(CACHE_TRAINER_TABLES, file, () => parseTrainerTables(decoded.get(file).text, macros));
        state.trainers.push(...trainers.map((trainer) => ({ ...trainer, id: `${file}#${trainer.id}`, file })));
        state.diagnostics.push(...withFile(diagnostics, file));
    }

    const { teamTypes, diagnostics: teamTypeDiagnostics } = await parse(CACHE_TEAM_TYPES, CFRU_FRONTIER_HEADER, () => parseTeamTypes(decoded.get(CFRU_FRONTIER_HEADER).text, macros));
    state.teamTypes = teamTypes;
    state.diagnostics.push(...withFile(teamTypeDiagnostics, CFRU_FRONTIER_HEADER));

    describeSets(state);
    return state;
}

/**
 * Converts the spread state into the data the editor page receives.
 *
 * @param {object} state The state.
 * @returns {object} The spreads snapshot.
 */
function toPayload(state)
{
    const sets = [];
    const entries = [];

    for (const fileState of state.files.values())
    {
        for (const setId of fileState.setIds)
        {
            const set = state.sets.get(setId);
            const { model } = set;
            sets.push(
            {
                id: set.id,
                name: model.name,
                file: set.file,
                category: set.category,
                line: model.line,
                isStatic: model.isStatic,
                branch: model.branch,
                littleCup: set.littleCup,
                usages: set.usages,
                entryIds: set.entryIds,
                placeholderCount: model.placeholders.length,
                canEdit: set.canEdit,
                canReorder: set.canReorder,
                canInsert: set.canInsert,
                insertBlockedReason: set.insertBlockedReason,
                diagnostics: withFile(model.diagnostics, set.file),
            });

            model.entries.forEach((entry, position) => entries.push(
            {
                id: set.entryIds[position],
                setId: set.id,
                line: entry.line,
                segment: entry.segment,
                fields: entry.fields,
                explicitFields: entry.explicitFields,
                rawFields: entry.rawFields,
                unknownFields: entry.unknownFields,
                abilityComment: entry.abilityComment,
                hiddenPowerComments: entry.hiddenPowerComments,
                editable: set.canEdit && entry.editable,
                diagnostics: withFile(entry.diagnostics, set.file),
            }));
        }
    }

    return {
        revision: state.revision,
        configuration: { file: CFRU_CONFIG_FILE, defines: [...state.macros.keys()] },
        files: [...state.files.values()].map((file) => ({ path: file.path, editable: file.editable, bom: file.bom, lineEnding: file.lineEnding === LINE_ENDING_CRLF ? "CRLF" : "LF" })),
        sets,
        entries,
        trainers: state.trainers.map(({ id, file, table, kind, name, line, links }) => ({ id, file, table, kind, name, line, links: links.map(({ role, setId, ranks }) => ({ role, setId, ranks: ranks ?? null })) })),
        teamTypes: state.teamTypes ?? [],
    };
}

/**
 * Collects the diagnostics a load reports.
 *
 * @param {object} state The state.
 * @returns {Array<object>} The diagnostics.
 */
function getStateDiagnostics(state)
{
    return [...state.diagnostics, ...[...state.files.values()].flatMap((file) => file.diagnostics)];
}

/**
 * Returns the ability constant a spread's ability slot names in the selected game.
 *
 * @param {object|null} baseStats The game's base stats.
 * @param {object} fields The spread's values.
 * @returns {string|null} The ability constant.
 */
function getAbilityName(baseStats, fields)
{
    const species = baseStats != null && typeof fields.species === "string" && Object.hasOwn(baseStats, fields.species) ? baseStats[fields.species] : null;
    return toAbilityName(species?.[ABILITY_DATA_KEYS[fields.ability]]);
}

/**
 * Checks that a new or changed doubles team type is one frontier.h defines, so the source still compiles.
 *
 * @param {object} state The spread state.
 * @param {string|number} value The specificTeamType value.
 */
function checkTeamType(state, value)
{
    if (value === TEAM_TYPE_OMITTED || state.teamTypes?.some((teamType) => teamType.name === value))
        return;

    invalid(`${value} is not a doubles team type in ${CFRU_FRONTIER_HEADER}.`);
}

/**
 * Turns submitted operations into per-set change plans.
 *
 * @param {object} state The spread state.
 * @param {Array<*>} operations The operations.
 * @param {object|null} baseStats The selected game's base stats, for ability comments.
 * @returns {Map<object, object>} Set records to their plans.
 */
function buildPlans(state, operations, baseStats)
{
    const plans = new Map();
    const tempIds = new Set();
    const getPlan = (set) =>
    {
        if (!plans.has(set))
            plans.set(set, { updates: new Map(), additions: [], order: null, requestedOrder: null });
        return plans.get(set);
    };
    const getSet = (setId) =>
    {
        const set = typeof setId === "string" ? state.sets.get(setId) : undefined;
        if (set == null)
            invalid("A change refers to a spread set that does not exist.");
        return set;
    };

    for (const operation of operations)
    {
        if (operation === null || typeof operation !== "object")
            invalid("Each change must be an object.");

        switch (operation.type)
        {
            case OPERATION_UPDATE:
            {
                // Existing entries are changed by ID, and several changes to one entry combine
                const entry = typeof operation.entryId === "string" ? state.entries.get(operation.entryId) : undefined;
                if (entry == null)
                    invalid("A change refers to a spread that does not exist.");

                const set = state.sets.get(entry.setId);
                if (!set.canEdit || !entry.model.editable)
                    invalid(`The spread on line ${entry.model.line} of ${set.file} cannot be changed safely.`);

                const plan = getPlan(set);
                const fields = mergeSpreadFields(operation.fields, plan.updates.get(entry.model)?.fields ?? entry.model.fields);
                if (fields[TEAM_TYPE_FIELD] !== entry.model.fields[TEAM_TYPE_FIELD])
                    checkTeamType(state, fields[TEAM_TYPE_FIELD]);
                plan.updates.set(entry.model, { fields, abilityName: getAbilityName(baseStats, fields) });
                break;
            }
            case OPERATION_ADD:
            {
                // New entries go after an existing entry of the same set, or at its end
                if (typeof operation.tempId !== "string" || !TEMP_ID_PATTERN.test(operation.tempId) || tempIds.has(operation.tempId))
                    invalid("Each new spread needs a unique temporary ID.");
                tempIds.add(operation.tempId);

                const set = getSet(operation.setId);
                if (!set.canInsert)
                    invalid(`Spreads cannot be added to ${set.model.name}: ${set.insertBlockedReason}`);

                let after = null;
                if (operation.afterEntryId != null)
                {
                    const anchor = state.entries.get(operation.afterEntryId);
                    if (anchor == null || anchor.setId !== set.id)
                        invalid("A new spread must be placed after a spread in the same set.");
                    after = anchor.model;
                }

                const fields = createSpreadFields(operation.fields);
                checkTeamType(state, fields[TEAM_TYPE_FIELD]);
                getPlan(set).additions.push({ key: operation.tempId, after, fields, abilityName: getAbilityName(baseStats, fields) });
                break;
            }
            case OPERATION_REORDER:
            {
                const set = getSet(operation.setId);
                const plan = getPlan(set);
                if (!set.canReorder)
                    invalid(`The spreads in ${set.model.name} cannot be reordered safely.`);
                if (plan.requestedOrder != null || !Array.isArray(operation.order) || operation.order.some((id) => typeof id !== "string"))
                    invalid(`${set.model.name} needs a single list of spread IDs in their new order.`);

                plan.requestedOrder = operation.order;
                break;
            }
            default:
                invalid("Each change must be an update, add or reorder.");
        }
    }

    // Orders can name entries added in the same save, so they are resolved last
    for (const [set, plan] of plans)
    {
        if (plan.requestedOrder == null)
            continue;

        const models = new Map(set.entryIds.map((id, position) => [id, set.model.entries[position]]));
        const keys = new Set(plan.additions.map((addition) => addition.key));
        plan.order = plan.requestedOrder.map((id) =>
        {
            if (models.has(id))
                return models.get(id);
            if (keys.has(id))
                return id;
            invalid(`The new order of ${set.model.name} lists a spread that is not in it.`);
        });
    }

    return plans;
}

/**
 * Parses a file's new text and checks it contains exactly the intended spreads.
 *
 * @param {object} state The spread state.
 * @param {object} fileState The file's current state.
 * @param {string} newText The new text.
 * @param {Map<object, object>} plans The set plans.
 * @param {Map<object, Array<object|string>>} orders The resulting order of each changed set.
 * @returns {object} The new parse result.
 */
function verifyFile(state, fileState, newText, plans, orders)
{
    const parsed = parseSpreads(newText, state.macros);
    const fail = (reason) =>
    {
        throw new ApiError(StatusCode.ServerErrorInternal, "SAVE_VERIFICATION_FAILED",
            `The changes to ${fileState.path} did not produce the expected source, so nothing was saved. ${reason}`, { file: fileState.path });
    };

    // The file must still contain the same arrays, and still be fully readable
    const oldSets = fileState.parsed.sets;
    if (!parsed.editable || parsed.sets.length !== oldSets.length || parsed.sets.some((set, index) => set.name !== oldSets[index].name))
        fail("The spread arrays changed.");

    fileState.setIds.forEach((setId, index) =>
    {
        const set = state.sets.get(setId);
        const plan = plans.get(set);
        const expected = orders.get(set) ?? set.model.entries;
        const actual = parsed.sets[index].entries;
        if (actual.length !== expected.length)
            fail(`${set.model.name} has ${actual.length} spreads instead of ${expected.length}.`);

        expected.forEach((item, position) =>
        {
            // Every entry must hold the intended values, and existing entries keep their other text
            const addition = typeof item === "string" ? plan.additions.find((candidate) => candidate.key === item) : null;
            const changed = addition != null || plan?.updates.has(item);
            const fields = addition?.fields ?? plan?.updates.get(item)?.fields ?? item.fields;
            const entry = actual[position];
            if ((changed && !entry.editable) || SPREAD_FIELDS.some((field) => !isSameValue(entry.fields[field.name], fields[field.name])))
                fail(`A spread in ${set.model.name} does not have the intended values.`);
            if (addition == null && JSON.stringify([entry.unknownFields, entry.rawFields]) !== JSON.stringify([item.unknownFields, item.rawFields]))
                fail(`A spread in ${set.model.name} lost fields the editor does not change.`);
        });
    });

    return parsed;
}

/**
 * Waits before retrying a file operation.
 *
 * @param {number} delayMs The delay.
 * @returns {Promise<void>} Resolves after the delay.
 */
function wait(delayMs)
{
    return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * Creates a spread store.
 *
 * @param {object} [options] Store options.
 * @param {object} [options.fileSystem] An fs.promises-compatible object used for every write.
 * @param {string} [options.dataDirectory] Where backups, journals and the parse cache are kept.
 * @param {number} [options.retryDelayMs] How long to wait before retrying a blocked file replacement.
 * @param {object} [options.cache] The parse cache.
 * @returns {{loadSpreads: Function, saveSpreads: Function}} The store.
 */
function createSpreadStore(
{
    fileSystem = fs.promises,
    dataDirectory = getDataDirectory(),
    retryDelayMs = REPLACE_RETRY_DELAY_MS,
    cache = createParseCache({ directory: path.join(dataDirectory, CACHE_DIRECTORY) }),
} = {})
{
    const journalDirectory = path.join(dataDirectory, JOURNAL_DIRECTORY);
    const backupDirectory = path.join(dataDirectory, BACKUP_DIRECTORY);
    const saveQueues = new Map();

    /**
     * Writes a file and flushes it to disk.
     *
     * @param {string} filePath The file.
     * @param {Buffer|string} contents The contents.
     */
    async function writeDurably(filePath, contents)
    {
        const handle = await fileSystem.open(filePath, "w");
        try
        {
            await handle.writeFile(contents);
            await handle.sync();
        }
        finally
        {
            await handle.close();
        }
    }

    /**
     * Records a journal's current state, replacing the previous record in one step.
     *
     * @param {object} journal The journal.
     */
    async function writeJournal(journal)
    {
        const journalPath = path.join(journalDirectory, `${journal.id}${JOURNAL_EXTENSION}`);
        await writeDurably(journalPath + TEMP_SUFFIX, JSON.stringify(journal, null, 2));
        await fileSystem.rename(journalPath + TEMP_SUFFIX, journalPath);
    }

    /**
     * Deletes a finished journal.
     *
     * @param {object} journal The journal.
     */
    async function removeJournal(journal)
    {
        await fileSystem.rm(path.join(journalDirectory, `${journal.id}${JOURNAL_EXTENSION}`), { force: true });
    }

    /**
     * Replaces a file with another, retrying while Windows reports the target as in use.
     *
     * @param {string} source The replacement.
     * @param {string} target The file to replace.
     */
    async function replaceFile(source, target)
    {
        for (let attempt = 1; ; attempt++)
        {
            try
            {
                await fileSystem.rename(source, target);
                return;
            }
            catch (error)
            {
                if (!REPLACE_RETRY_CODES.has(error.code) || attempt >= REPLACE_ATTEMPTS)
                    throw error;
                await wait(retryDelayMs);
            }
        }
    }

    /**
     * Returns the hash of a file, or null if it does not exist.
     *
     * @param {string} filePath The file.
     * @returns {Promise<string|null>} The hash.
     */
    async function hashFile(filePath)
    {
        try
        {
            return hashBytes(await fileSystem.readFile(filePath));
        }
        catch (error)
        {
            if (error.code === MISSING_FILE_CODE)
                return null;
            throw error;
        }
    }

    /**
     * Restores the files of an unfinished save that still hold its new contents.
     * Files changed by someone else since are left alone.
     *
     * @param {object} workspace The workspace.
     * @param {object} journal The journal.
     * @returns {Promise<Array<{path: string, status: string}>>} Each file's outcome.
     */
    async function rollBack(workspace, journal)
    {
        const outcomes = [];

        for (const file of journal.files)
        {
            try
            {
                // Staged copies are never needed again
                const target = await resolveOwnedFile(workspace, REPOSITORY_CFRU, file.path);
                await fileSystem.rm(target + file.stagedSuffix, { force: true });

                // Put the backup back only while the file still holds exactly what this save wrote
                const current = await hashFile(target);
                if (current === file.newHash)
                {
                    const restorePath = target + file.restoreSuffix;
                    await writeDurably(restorePath, await fileSystem.readFile(file.backup));
                    await replaceFile(restorePath, target);
                    file.status = FILE_ROLLED_BACK;
                }
                else if (current === file.originalHash)
                    file.status = file.status === FILE_REPLACED ? FILE_ROLLED_BACK : FILE_NOT_REPLACED;
                else
                    file.status = FILE_EXTERNALLY_MODIFIED;
            }
            catch
            {
                file.status = FILE_FAILED;
            }

            outcomes.push({ path: file.path, status: file.status });
        }

        // Keep the journal only when a file could not be restored, so the next load tries again
        if (outcomes.every((outcome) => outcome.status === FILE_ROLLED_BACK || outcome.status === FILE_NOT_REPLACED))
            await removeJournal(journal);
        else
        {
            journal.state = JOURNAL_FAILED;
            await writeJournal(journal);
        }

        return outcomes;
    }

    /**
     * Undoes saves to this workspace's CFRU repository that were interrupted, for example by the server stopping.
     *
     * @param {object} workspace The workspace.
     * @returns {Promise<Array<object>>} Diagnostics describing what was recovered.
     */
    async function recoverSaves(workspace)
    {
        let names;
        try
        {
            names = (await fileSystem.readdir(journalDirectory)).filter((name) => name.endsWith(JOURNAL_EXTENSION));
        }
        catch (error)
        {
            if (error.code === MISSING_FILE_CODE)
                return [];
            throw error;
        }

        const diagnostics = [];
        const rootKey = getRootKey(workspace, REPOSITORY_CFRU);
        for (const name of names)
        {
            // Only journals for this repository, naming only spread files, are acted on
            let journal;
            try
            {
                journal = JSON.parse(await fileSystem.readFile(path.join(journalDirectory, name), "utf8"));
            }
            catch
            {
                continue;
            }
            if (journal.rootKey !== rootKey || !Array.isArray(journal.files) || journal.files.some((file) => !CFRU_SPREAD_FILES.includes(file.path)))
                continue;

            const outcomes = await rollBack(workspace, journal);
            const restored = outcomes.filter((outcome) => outcome.status === FILE_ROLLED_BACK).map((outcome) => outcome.path);
            const stuck = outcomes.filter((outcome) => outcome.status === FILE_FAILED || outcome.status === FILE_EXTERNALLY_MODIFIED);
            if (restored.length > 0)
                diagnostics.push({ severity: SEVERITY_WARNING, code: "SAVE_RECOVERED", message: `A save from ${journal.createdAt} did not finish, so ${restored.join(", ")} were restored to how they were before it.`, repository: REPOSITORY_CFRU });
            if (stuck.length > 0)
                diagnostics.push({ severity: SEVERITY_ERROR, code: "SAVE_RECOVERY_INCOMPLETE", message: `A save from ${journal.createdAt} did not finish and ${stuck.map((outcome) => outcome.path).join(", ")} could not be restored. The original files are backed up in ${path.dirname(journal.files[0].backup)}.`, repository: REPOSITORY_CFRU });
        }

        return diagnostics;
    }

    /**
     * Writes staged files over their originals, backing up the originals first.
     *
     * @param {object} workspace The workspace.
     * @param {Array<object>} staged The changed files.
     * @returns {Promise<string>} The backup ID.
     */
    async function commit(workspace, staged)
    {
        // Back up the original bytes and record the plan before touching the repository
        const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(4).toString("hex")}`;
        const backupFolder = path.join(backupDirectory, id);
        await fileSystem.mkdir(backupFolder, { recursive: true });
        await fileSystem.mkdir(journalDirectory, { recursive: true });

        const journal = { id, rootKey: getRootKey(workspace, REPOSITORY_CFRU), root: workspace.roots[REPOSITORY_CFRU], createdAt: new Date().toISOString(), state: JOURNAL_STAGED, files: [] };
        for (const { fileState, newBytes } of staged)
        {
            const backup = path.join(backupFolder, fileState.path.replace(/\//g, "__"));
            await writeDurably(backup, Buffer.from(fileState.text, "utf8"));
            journal.files.push(
            {
                path: fileState.path,
                backup,
                stagedSuffix: `.${id}${TEMP_SUFFIX}`,
                restoreSuffix: `.${id}.restore${TEMP_SUFFIX}`,
                originalHash: fileState.hash,
                newHash: hashBytes(newBytes),
                status: FILE_PENDING,
            });
        }
        await writeDurably(path.join(backupFolder, MANIFEST_FILE), JSON.stringify({ id, root: journal.root, createdAt: journal.createdAt, files: journal.files.map(({ path: file, originalHash, newHash }) => ({ path: file, originalHash, newHash })) }, null, 2));
        await writeJournal(journal);

        try
        {
            // Stage each new file beside its original, so the replacement stays on the same drive
            for (const [index, { newBytes }] of staged.entries())
            {
                const target = await resolveOwnedFile(workspace, REPOSITORY_CFRU, journal.files[index].path);
                await writeDurably(target + journal.files[index].stagedSuffix, newBytes);
            }
            journal.state = JOURNAL_COMMITTING;
            await writeJournal(journal);

            // Replace each file, stopping if someone changed it after it was checked
            for (const file of journal.files)
            {
                const target = await resolveOwnedFile(workspace, REPOSITORY_CFRU, file.path);
                if (await hashFile(target) !== file.originalHash)
                    throw new ApiError(StatusCode.ClientErrorConflict, "SAVE_CONFLICT", `${file.path} was changed outside the editor while saving.`);

                await replaceFile(target + file.stagedSuffix, target);
                file.status = FILE_REPLACED;
                await writeJournal(journal);
            }

            await removeJournal(journal);
            return id;
        }
        catch (error)
        {
            // Undo what was replaced, then report exactly what happened to each file
            const outcomes = await rollBack(workspace, journal);
            const conflict = error instanceof ApiError && error.code === "SAVE_CONFLICT";
            const complete = outcomes.every((outcome) => outcome.status === FILE_ROLLED_BACK || outcome.status === FILE_NOT_REPLACED);
            const message = conflict ? error.message : `The files could not be saved (${error.code ?? error.message}).`;
            throw new ApiError(conflict ? StatusCode.ClientErrorConflict : StatusCode.ServerErrorInternal, conflict ? "SAVE_CONFLICT" : "SAVE_FAILED",
                complete ? `${message} No files were changed.` : `${message} Some files could not be restored; the originals are backed up in ${backupFolder}.`,
                { files: outcomes, backupId: id, restored: complete });
        }
    }

    /**
     * Loads the spreads of a workspace, first undoing any interrupted save to its repository.
     *
     * @param {object} workspace The workspace.
     * @returns {Promise<{spreads: object, diagnostics: Array<object>}>} The spreads snapshot and diagnostics.
     */
    async function loadSpreads(workspace)
    {
        const recovered = await recoverSaves(workspace);
        const state = await buildState(workspace, await readInputs(workspace), cache);
        workspace.spreads = state;

        return { spreads: toPayload(state), diagnostics: [...recovered, ...getStateDiagnostics(state)] };
    }

    /**
     * Saves changes to a workspace's spreads.
     *
     * @param {object} workspace The workspace.
     * @param {object} request The save request.
     * @param {string} request.revision The snapshot revision the changes were made to.
     * @param {string} [request.gameId] The game, for ability comments.
     * @param {Array<object>} request.operations The changes.
     * @returns {Promise<object>} The new snapshot, IDs of new spreads and per-file results.
     */
    async function performSave(workspace, { revision, gameId, operations })
    {
        // Changes must be made to the snapshot the server holds
        const state = workspace.spreads;
        if (state == null || state.stale)
            throw new ApiError(StatusCode.ClientErrorConflict, "RELOAD_REQUIRED", "The repositories need to be loaded again before saving.");
        if (!Array.isArray(operations) || operations.length > MAX_OPERATIONS)
            invalid(`A save must contain a list of at most ${MAX_OPERATIONS} changes.`);
        if (revision !== state.revision)
            throw new ApiError(StatusCode.ClientErrorConflict, "SAVE_CONFLICT", "These changes were made to an older copy of the spreads. Load the repositories again.");

        // The files must not have changed outside the editor since they were loaded
        const inputs = await readInputs(workspace);
        const changedFiles = INPUT_FILES.filter((file) => hashBytes(inputs.get(file)) !== state.hashes.get(file));
        if (changedFiles.length > 0)
            throw new ApiError(StatusCode.ClientErrorConflict, "SAVE_CONFLICT", `${changedFiles.join(", ")} changed outside the editor. Load the repositories again to see those changes.`, { files: changedFiles });

        // Ability comments use the selected game's ability names when it can be read
        let baseStats = null;
        if (gameId != null)
        {
            try
            {
                baseStats = await readGameData(workspace, gameId, BASE_STATS_KEY);
            }
            catch
            {
                baseStats = null;
            }
        }

        // Build and verify each changed file's new text before writing anything
        const plans = buildPlans(state, operations, baseStats);
        const staged = [];
        for (const fileState of state.files.values())
        {
            const edits = [];
            const orders = new Map();
            for (const setId of fileState.setIds)
            {
                const set = state.sets.get(setId);
                const plan = plans.get(set);
                if (plan == null)
                    continue;

                const result = buildSetEdits(fileState.text, set.model, plan, fileState.lineEnding);
                edits.push(...result.edits);
                orders.set(set, result.order);
            }

            const newText = applyEdits(fileState.text, edits);
            if (newText === fileState.text)
                continue;

            staged.push({ fileState, newText, newBytes: Buffer.from(newText, "utf8"), parsed: verifyFile(state, fileState, newText, plans, orders), orders });
        }

        if (staged.length === 0)
            return { spreads: toPayload(state), createdIds: {}, files: [], backupId: null };

        let backupId;
        try
        {
            backupId = await commit(workspace, staged);
        }
        catch (error)
        {
            // Files left in an unknown state make the snapshot unreliable
            if (error.details?.restored === false)
                state.stale = true;
            throw error;
        }

        // Carry entry IDs over to the saved text, giving new spreads their own
        const createdIds = {};
        for (const { fileState, newText, newBytes, parsed, orders } of staged)
        {
            const entryIds = new Map();
            fileState.setIds.forEach((setId, index) =>
            {
                const set = state.sets.get(setId);
                const order = orders.get(set);
                if (order == null)
                {
                    entryIds.set(index, set.entryIds);
                    return;
                }

                const idsByModel = new Map(set.model.entries.map((entry, position) => [entry, set.entryIds[position]]));
                entryIds.set(index, order.map((item) =>
                {
                    if (typeof item !== "string")
                        return idsByModel.get(item);
                    createdIds[item] = `e${(state.nextId++).toString(36)}`;
                    return createdIds[item];
                }));
            });

            Object.assign(fileState, decodeSource(newBytes), { text: newText, parsed });
            state.hashes.set(fileState.path, fileState.hash);
            registerFile(state, fileState, entryIds);

            // The next load can reuse the parse that verified this save
            const { slot, inputs: cacheInputs } = getCacheEntry(workspace, fileState.path, fileState.hash, state.macrosHash);
            await cache.set(CACHE_SPREAD_FILE, slot, cacheInputs, parsed);
        }

        state.revision = getRevision(state.hashes);
        describeSets(state);

        return {
            spreads: toPayload(state),
            createdIds,
            files: staged.map(({ fileState }) => ({ path: fileState.path, status: FILE_SAVED })),
            backupId,
        };
    }

    /**
     * Saves changes, one save at a time per CFRU repository.
     *
     * @param {object} workspace The workspace.
     * @param {object} request The save request.
     * @returns {Promise<object>} The save result.
     */
    function saveSpreads(workspace, request)
    {
        const key = getRootKey(workspace, REPOSITORY_CFRU);
        const previous = saveQueues.get(key) ?? Promise.resolve();
        const current = previous.catch(() => {}).then(() => performSave(workspace, request ?? {}));
        saveQueues.set(key, current);
        return current;
    }

    return { loadSpreads, saveSpreads };
}
module.exports.createSpreadStore = createSpreadStore;

const defaultStore = createSpreadStore();

/**
 * Loads a workspace's spreads with the default store.
 *
 * @param {object} workspace The workspace.
 * @returns {Promise<{spreads: object, diagnostics: Array<object>}>} The spreads snapshot and diagnostics.
 */
function loadSpreads(workspace)
{
    return defaultStore.loadSpreads(workspace);
}
module.exports.loadSpreads = loadSpreads;

/**
 * Saves changes to a workspace's spreads with the default store.
 *
 * @param {object} workspace The workspace.
 * @param {object} request The save request.
 * @returns {Promise<object>} The save result.
 */
function saveSpreads(workspace, request)
{
    return defaultStore.saveSpreads(workspace, request);
}
module.exports.saveSpreads = saveSpreads;
