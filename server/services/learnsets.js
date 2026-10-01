/**
 * Move availability from the Dynamic Pokemon Expansion: level-up, evolution, egg, TM and tutor moves,
 * inherited through evolutions and shared between forms, plus the CFRU teaching rules that are not
 * stored in DPE's tables. Also reads which held items or moves trigger Mega Evolution and Gigantamax.
 */

const { LEARN_SOURCES, LEARN_SOURCE_ORDER, LEARNSET_COMPLETE, LEARNSET_MISSING } = require("../../shared/catalog.mjs");
const { ApiError } = require("../middleware/errors");
const { parseCompatibilityFile, parseEggMoves, parseEvolutionTable, parseLevelUpLearnsets, parseTeachableTables } = require("./data-parser");
const { getParserVersion, hash } = require("./parse-cache");
const { evaluatePreprocessor } = require("./preprocessor");
const { REPOSITORY_DPE, getRootKey, listOwnedFiles, readOwnedFile } = require("./repositories");

const DPE_CONFIG_FILE = "src/defines.h";
const DPE_LEARNSETS_FILE = "src/Learnsets.c";
const DPE_EGG_MOVES_FILE = "src/Egg_Moves.c";
const DPE_TABLES_FILE = "src/TM_Tutor_Tables.c";
const DPE_EVOLUTION_FILE = "src/Evolution Table.c";
const DPE_TM_DIRECTORY = "src/tm_compatibility";
const DPE_TUTOR_DIRECTORY = "src/tutor_compatibility";
const DPE_SOURCE_FILES = [DPE_LEARNSETS_FILE, DPE_EGG_MOVES_FILE, DPE_TABLES_FILE, DPE_EVOLUTION_FILE];
const COMPATIBILITY_EXTENSION = ".txt";
const EXPAND_LEARNSETS_MACRO = "EXPAND_LEARNSETS";
const CACHE_DPE_DATA = "dpe-data";

const SPECIES_PREFIX = "SPECIES_";
const MOVE_PREFIX = "MOVE_";
const ITEM_PREFIX = "ITEM_";
const ITEM_NONE = "ITEM_NONE";
const MOVE_NONE = "MOVE_NONE";
const EVO_MEGA = "EVO_MEGA";
const EVO_GIGANTAMAX = "EVO_GIGANTAMAX";
const NON_PERMANENT_EVOLUTIONS = new Set([EVO_MEGA, EVO_GIGANTAMAX]);
const GIGANTAMAX_ENABLED = new Set(["TRUE", 1]);
const EXAMPLE_COUNT = 3;

const SEVERITY_WARNING = "warning";

// CFRU src/item.c CanMonLearnTutorMove: tutors checked by type or Pokedex number instead of a compatibility table
const SPECIAL_TUTOR_MACRO = "EXPANDED_MOVE_TUTORS";
const SPECIAL_TUTOR_RULES =
[
    { move: "MOVE_DRACOMETEOR", types: ["TYPE_DRAGON"] },
    { move: "MOVE_SECRETSWORD", dex: ["NATIONAL_DEX_KELDEO"] },
    { move: "MOVE_RELICSONG", dex: ["NATIONAL_DEX_MELOETTA"] },
    { move: "MOVE_VOLTTACKLE", dex: ["NATIONAL_DEX_PICHU", "NATIONAL_DEX_PIKACHU", "NATIONAL_DEX_RAICHU"] },
    { move: "MOVE_VOLTTACKLE", dex: ["NATIONAL_DEX_SHINX", "NATIONAL_DEX_LUXIO", "NATIONAL_DEX_LUXRAY", "NATIONAL_DEX_BLITZLE", "NATIONAL_DEX_ZEBSTRIKA"], macro: "UNBOUND" },
    { move: "MOVE_DRAGONASCENT", dex: ["NATIONAL_DEX_RAYQUAZA"] },
    { move: "MOVE_THOUSANDARROWS", dex: ["NATIONAL_DEX_ZYGARDE"] },
    { move: "MOVE_THOUSANDWAVES", dex: ["NATIONAL_DEX_ZYGARDE"] },
    { move: "MOVE_COREENFORCER", dex: ["NATIONAL_DEX_ZYGARDE"] },
    { move: "MOVE_STEELBEAM", types: ["TYPE_STEEL"], dex: ["NATIONAL_DEX_SILVALLY", "NATIONAL_DEX_ZACIAN", "NATIONAL_DEX_ZAMAZENTA"] },
];

// CFRU src/daycare.c: a Pichu hatched from a parent holding a Light Ball knows Volt Tackle
const BREEDING_MOVES = [{ species: "SPECIES_PICHU", move: "MOVE_VOLTTACKLE" }];

// CFRU atkA8_copymovepermanently: Sketch copies any move but these, Z-Moves and Max Moves, which Cloud's move lists leave out
const SKETCH_MOVE = "MOVE_SKETCH";
const SKETCH_EXCLUDED_MOVES = new Set(["MOVE_STRUGGLE", "MOVE_CHATTER", SKETCH_MOVE]);

// Moves learned by changing form, from CFRU's party_menu.c and form_change.c and DPE's learnset scripts.
// They are added after inheritance, since changing back forgets them.
const FORM_CHANGE_MOVES =
{
    SPECIES_KYUREM: ["MOVE_GLACIATE"],
    SPECIES_KYUREM_BLACK: ["MOVE_FUSIONBOLT"],
    SPECIES_KYUREM_WHITE: ["MOVE_FUSIONFLARE"],
    SPECIES_NECROZMA_DUSK_MANE: ["MOVE_SUNSTEELSTRIKE"],
    SPECIES_NECROZMA_DAWN_WINGS: ["MOVE_MOONGEISTBEAM"],
    SPECIES_ZACIAN_CROWNED: ["MOVE_BEHEMOTHBLADE"],
    SPECIES_ZAMAZENTA_CROWNED: ["MOVE_BEHEMOTHBASH"],
    SPECIES_ROTOM_HEAT: ["MOVE_OVERHEAT"],
    SPECIES_ROTOM_WASH: ["MOVE_HYDROPUMP"],
    SPECIES_ROTOM_FROST: ["MOVE_BLIZZARD"],
    SPECIES_ROTOM_FAN: ["MOVE_AIRSLASH"],
    SPECIES_ROTOM_MOW: ["MOVE_LEAFSTORM"],
    SPECIES_MELOETTA: ["MOVE_RELICSONG"],
    SPECIES_MELOETTA_PIROUETTE: ["MOVE_RELICSONG"],
};

const UNBOUND_MACRO = "UNBOUND";

// CFRU's gPikachuSpreads confirms the standard signatures; PhD's Flamethrower is Unbound-specific.
const COSPLAY_FORM_CHANGE_MOVES =
[
    { species: "SPECIES_PIKACHU_LIBRE", move: "MOVE_FLYINGPRESS" },
    { species: "SPECIES_PIKACHU_ROCK_STAR", move: "MOVE_METEORMASH" },
    { species: "SPECIES_PIKACHU_BELLE", move: "MOVE_ICICLECRASH" },
    { species: "SPECIES_PIKACHU_POP_STAR", move: "MOVE_DRAININGKISS" },
    { species: "SPECIES_PIKACHU_PHD", move: "MOVE_FLAMETHROWER", macro: UNBOUND_MACRO },
];

// Fusions and item forms keep the moves of the form they came from
const FORM_CHANGE_EDGES =
[
    ["SPECIES_KYUREM", "SPECIES_KYUREM_BLACK"],
    ["SPECIES_KYUREM", "SPECIES_KYUREM_WHITE"],
    ["SPECIES_NECROZMA", "SPECIES_NECROZMA_DUSK_MANE"],
    ["SPECIES_NECROZMA", "SPECIES_NECROZMA_DAWN_WINGS"],
    ["SPECIES_ZACIAN", "SPECIES_ZACIAN_CROWNED"],
    ["SPECIES_ZAMAZENTA", "SPECIES_ZAMAZENTA_CROWNED"],
];

// Forms that change back and forth and share every move, from DPE's validate_trainer_spread_moves.py
const SHARED_FORM_FAMILIES =
[
    ["SPECIES_SHAYMIN", "SPECIES_SHAYMIN_SKY"],
    ["SPECIES_DEOXYS", "SPECIES_DEOXYS_ATTACK", "SPECIES_DEOXYS_DEFENSE", "SPECIES_DEOXYS_SPEED"],
    ["SPECIES_HOOPA", "SPECIES_HOOPA_UNBOUND"],
];
const SHARED_FORM_PREFIXES = ["SPECIES_PIKACHU", "SPECIES_ROTOM"];


/**
 * Adds a repository and file to diagnostics.
 *
 * @param {Array<object>} diagnostics The diagnostics.
 * @param {string} file The repository-relative file.
 * @returns {Array<object>} The diagnostics with repository and file.
 */
function withFile(diagnostics, file)
{
    return diagnostics.map((diagnostic) => ({ ...diagnostic, repository: REPOSITORY_DPE, file }));
}

/**
 * Parses the DPE sources that decide move availability. The result can be cached.
 *
 * @param {{configText: string, files: Object<string, string>, compatibility: Object<string, Array<{name: string, text: string}>>}} sources
 *        The DPE configuration, source files and TM and tutor compatibility files by folder.
 * @returns {object} The parsed tables, each null when it could not be read, and diagnostics.
 */
function parseDpeSources({ configText, files, compatibility })
{
    // DPE's own configuration decides which of its tables are compiled
    const configuration = evaluatePreprocessor(configText);
    const macros = configuration.macros;
    const diagnostics = withFile(configuration.diagnostics, DPE_CONFIG_FILE);

    const levelUp = parseLevelUpLearnsets(files[DPE_LEARNSETS_FILE], macros);
    const eggMoves = parseEggMoves(files[DPE_EGG_MOVES_FILE], macros);
    const tables = parseTeachableTables(files[DPE_TABLES_FILE], macros);
    const evolutions = parseEvolutionTable(files[DPE_EVOLUTION_FILE], macros);
    diagnostics.push(...withFile(levelUp.diagnostics, DPE_LEARNSETS_FILE), ...withFile(eggMoves.diagnostics, DPE_EGG_MOVES_FILE),
        ...withFile(tables.diagnostics, DPE_TABLES_FILE), ...withFile(evolutions.diagnostics, DPE_EVOLUTION_FILE));

    if (!macros.has(EXPAND_LEARNSETS_MACRO))
        diagnostics.push({ severity: SEVERITY_WARNING, code: "DPE_LEARNSETS_DISABLED", message: `${DPE_CONFIG_FILE} does not define ${EXPAND_LEARNSETS_MACRO}, so DPE's level-up learnsets are not used and move legality is unknown.`, repository: REPOSITORY_DPE, file: DPE_CONFIG_FILE });

    // Each compatibility file lists the species one TM or tutor can teach
    const readCompatibility = (directory) => (compatibility[directory] ?? []).map(({ name, text }) =>
    {
        const file = `${directory}/${name}`;
        const parsed = parseCompatibilityFile(name, text);
        diagnostics.push(...withFile(parsed.diagnostics, file));
        return { file, number: parsed.number, moveName: parsed.moveName, species: parsed.species };
    });

    return {
        levelUp: levelUp.learnsets,
        eggMoves: eggMoves.eggMoves,
        tmMoves: tables.tmMoves,
        tutorMoves: tables.tutorMoves,
        tmCompatibility: readCompatibility(DPE_TM_DIRECTORY),
        tutorCompatibility: readCompatibility(DPE_TUTOR_DIRECTORY),
        evolutions: evolutions.evolutions,
        diagnostics,
    };
}
module.exports.parseDpeSources = parseDpeSources;

/**
 * Reads the DPE files that decide move availability.
 *
 * @param {object} workspace The workspace.
 * @returns {Promise<{sources: object, diagnostics: Array<object>}>} The file contents and read diagnostics.
 */
async function readDpeSources(workspace)
{
    // Without its configuration DPE's defaults are unknown, which only limits what can be decided
    const diagnostics = [];
    let configText = "";
    try
    {
        configText = await readOwnedFile(workspace, REPOSITORY_DPE, DPE_CONFIG_FILE);
    }
    catch (error)
    {
        if (!(error instanceof ApiError))
            throw error;
        diagnostics.push({ severity: SEVERITY_WARNING, code: "DPE_CONFIG_UNAVAILABLE", message: `${DPE_CONFIG_FILE} could not be read, so DPE's configuration is unknown.`, repository: REPOSITORY_DPE, file: DPE_CONFIG_FILE });
    }

    const contents = await Promise.all(DPE_SOURCE_FILES.map((file) => readOwnedFile(workspace, REPOSITORY_DPE, file)));
    const files = Object.fromEntries(DPE_SOURCE_FILES.map((file, index) => [file, contents[index]]));

    const compatibility = {};
    for (const directory of [DPE_TM_DIRECTORY, DPE_TUTOR_DIRECTORY])
    {
        const names = (await listOwnedFiles(workspace, REPOSITORY_DPE, directory)).filter((name) => name.toLowerCase().endsWith(COMPATIBILITY_EXTENSION));
        const texts = await Promise.all(names.map((name) => readOwnedFile(workspace, REPOSITORY_DPE, `${directory}/${name}`)));
        compatibility[directory] = names.map((name, index) => ({ name, text: texts[index] }));
    }

    return { sources: { configText, files, compatibility }, diagnostics };
}

/**
 * Loads the parsed DPE tables, reusing the cached parse while no DPE file has changed.
 *
 * @param {object} workspace The workspace.
 * @param {object} cache The parse cache.
 * @returns {Promise<object>} The parsed tables and diagnostics.
 */
async function loadDpeData(workspace, cache)
{
    const { sources, diagnostics } = await readDpeSources(workspace);
    const inputs = [getParserVersion(), hash(JSON.stringify(sources))];
    const parsed = await cache.getOrCreate(CACHE_DPE_DATA, getRootKey(workspace, REPOSITORY_DPE), inputs, () => parseDpeSources(sources));
    return { ...parsed, diagnostics: [...diagnostics, ...parsed.diagnostics] };
}
module.exports.loadDpeData = loadDpeData;

/**
 * Returns a comparable form of a move name, ignoring case, accents and punctuation.
 *
 * @param {string} name The name.
 * @returns {string} The key.
 */
function toNameKey(name)
{
    return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Returns a short list of examples for a diagnostic.
 *
 * @param {Iterable<string>} values The values.
 * @returns {string} The first few, comma separated.
 */
function formatExamples(values)
{
    return [...values].slice(0, EXAMPLE_COUNT).join(", ");
}

/**
 * Returns the forms of a family named by a prefix, such as every SPECIES_PIKACHU form.
 *
 * @param {Set<string>} universe Every known species.
 * @param {string} prefix The base species.
 * @returns {Array<string>} The family.
 */
function getPrefixFamily(universe, prefix)
{
    return [...universe].filter((species) => species === prefix || species.startsWith(`${prefix}_`));
}

/**
 * Builds each species' learnable moves for a game.
 *
 * @param {object} options The inputs.
 * @param {object} options.dpe The parsed DPE tables.
 * @param {Object<string, {types: Array<string>, dex: string|null}>} options.species The game's species, with their
 *        types and NATIONAL_DEX_* constants.
 * @param {Object<string, string>} options.moveNames Display names of moves, used to check TM and tutor headings.
 * @param {Array<string>} options.gameMoves The game's moves, which Sketch can copy.
 * @param {Map<string, object>} options.cfruMacros The CFRU configuration macros.
 * @returns {{learnsets: Object<string, {status: string, moves: Object<string, Array<string>>, unknown: Object<string, string>}>,
 *            diagnostics: Array<object>}} Each game species' learnset and diagnostics.
 */
function buildLearnsets({ dpe, species, moveNames, gameMoves, cfruMacros })
{
    const diagnostics = [];
    const levelUp = dpe.levelUp ?? {};
    const universe = new Set([...Object.keys(species), ...Object.keys(levelUp)]);
    const available = new Map();

    const add = (target, move, source) =>
    {
        if (!available.has(target))
            available.set(target, new Map());
        const moves = available.get(target);
        if (!moves.has(move))
            moves.set(move, new Set());
        moves.get(move).add(source);
    };

    // Level-up moves, where level 0 is learned on evolving
    for (const [target, moves] of Object.entries(levelUp))
        for (const { move, level } of moves)
            add(target, move, level === 0 ? LEARN_SOURCES.EVOLUTION : LEARN_SOURCES.LEVEL);

    for (const [target, moves] of Object.entries(dpe.eggMoves ?? {}))
        for (const move of moves)
            add(target, move, LEARN_SOURCES.EGG);

    for (const { species: target, move } of BREEDING_MOVES)
        if (universe.has(target))
            add(target, move, LEARN_SOURCES.SPECIAL);

    // Each TM or tutor file teaches the move at its position in the table the game offers
    const unknownSpecies = new Set();
    const addCompatibility = (entries, table, label, source) =>
    {
        for (const { file, number, moveName, species: learners } of entries)
        {
            const move = table != null && number != null ? table[number - 1] : null;
            if (move == null)
            {
                diagnostics.push({ severity: SEVERITY_WARNING, code: "COMPATIBILITY_MOVE_UNKNOWN", message: `${file} is for ${label} ${number}, which DPE's table does not offer.`, repository: REPOSITORY_DPE, file });
                continue;
            }

            const headingKey = moveName != null ? toNameKey(moveName) : null;
            if (headingKey != null && headingKey !== toNameKey(move.slice(MOVE_PREFIX.length)) && headingKey !== toNameKey(moveNames[move] ?? ""))
                diagnostics.push({ severity: SEVERITY_WARNING, code: "COMPATIBILITY_MOVE_MISMATCH", message: `${file} is headed ${moveName}, but ${label} ${number} teaches ${move}. ${move} is used.`, repository: REPOSITORY_DPE, file });

            for (const learner of learners)
            {
                if (!universe.has(learner))
                    unknownSpecies.add(learner);
                add(learner, move, source);
            }
        }
    };
    addCompatibility(dpe.tmCompatibility, dpe.tmMoves, "TM", LEARN_SOURCES.TM);
    addCompatibility(dpe.tutorCompatibility, dpe.tutorMoves, "Tutor", LEARN_SOURCES.TUTOR);
    if (unknownSpecies.size > 0)
        diagnostics.push({ severity: SEVERITY_WARNING, code: "COMPATIBILITY_SPECIES_UNKNOWN", message: `DPE's TM and tutor lists name ${unknownSpecies.size} species that have no learnset, such as ${formatExamples(unknownSpecies)}.`, repository: REPOSITORY_DPE, details: [...unknownSpecies] });

    // Evolutions keep their pre-evolutions' moves, and some forms keep each other's
    const edges = [];
    for (const [from, evolutions] of Object.entries(dpe.evolutions ?? {}))
        for (const { method, target } of evolutions)
            if (!NON_PERMANENT_EVOLUTIONS.has(method) && target !== from && target.startsWith(SPECIES_PREFIX))
                edges.push({ from, to: target, source: LEARN_SOURCES.PREVOLUTION });
    for (const [from, to] of FORM_CHANGE_EDGES)
        edges.push({ from, to, source: LEARN_SOURCES.FORM });
    for (const family of [...SHARED_FORM_FAMILIES, ...SHARED_FORM_PREFIXES.map((prefix) => getPrefixFamily(universe, prefix))])
        for (const from of family)
            for (const to of family.filter((member) => member !== from))
                edges.push({ from, to, source: LEARN_SOURCES.FORM });

    // Repeat until nothing new is inherited, which also ends for cycles since move sets only grow
    let changed = true;
    while (changed)
    {
        changed = false;
        for (const { from, to, source } of edges)
        {
            for (const move of available.get(from)?.keys() ?? [])
            {
                if (available.get(to)?.has(move))
                    continue;
                add(to, move, source);
                changed = true;
            }
        }
    }

    for (const moves of available.values())
        if (moves.has(SKETCH_MOVE))
            for (const move of gameMoves.filter((candidate) => !SKETCH_EXCLUDED_MOVES.has(candidate) && !moves.has(candidate)))
                moves.set(move, new Set([LEARN_SOURCES.SKETCH]));

    // Tutors checked by type or Pokedex number, which are only certain when CFRU enables them
    const tutorsEnabled = cfruMacros.has(SPECIAL_TUTOR_MACRO);
    const unknown = new Map();
    for (const rule of SPECIAL_TUTOR_RULES.filter((candidate) => candidate.macro == null || cfruMacros.has(candidate.macro)))
    {
        for (const [target, { types, dex }] of Object.entries(species))
        {
            const matches = (rule.types ?? []).some((type) => types.includes(type)) || (rule.dex ?? []).includes(dex);
            if (!matches || available.get(target)?.has(rule.move))
                continue;

            if (tutorsEnabled)
                add(target, rule.move, LEARN_SOURCES.SPECIAL);
            else
            {
                if (!unknown.has(target))
                    unknown.set(target, {});
                unknown.get(target)[rule.move] = `CFRU teaches ${rule.move} with a special tutor only when ${SPECIAL_TUTOR_MACRO} is defined in its configuration, which it is not.`;
            }
        }
    }

    for (const [target, moves] of Object.entries(FORM_CHANGE_MOVES))
        if (universe.has(target))
            for (const move of moves)
                add(target, move, LEARN_SOURCES.FORM_CHANGE);

    for (const { species: target, move, macro } of COSPLAY_FORM_CHANGE_MOVES)
        if (universe.has(target) && gameMoves.includes(move) && (macro == null || cfruMacros.has(macro)))
            add(target, move, LEARN_SOURCES.FORM_CHANGE);

    // Only the game's species are sent, with their sources in a fixed order
    const learnsets = {};
    const missing = [];
    for (const target of Object.keys(species))
    {
        const complete = dpe.levelUp != null && Object.hasOwn(levelUp, target);
        if (!complete)
            missing.push(target);

        const moves = {};
        for (const [move, sources] of available.get(target) ?? [])
            moves[move] = LEARN_SOURCE_ORDER.filter((source) => sources.has(source));

        learnsets[target] = { status: complete ? LEARNSET_COMPLETE : LEARNSET_MISSING, moves, unknown: unknown.get(target) ?? {} };
    }

    if (dpe.levelUp != null && missing.length > 0)
        diagnostics.push({ severity: SEVERITY_WARNING, code: "LEARNSET_MISSING", message: `${missing.length} species have no level-up learnset in DPE, so their move legality is unknown. For example: ${formatExamples(missing)}.`, repository: REPOSITORY_DPE, details: missing });

    return { learnsets, diagnostics };
}
module.exports.buildLearnsets = buildLearnsets;

/**
 * Reads the Mega Evolutions and Gigantamax forms of a game's species from DPE's evolution table.
 *
 * @param {Object<string, Array<object>>|null} evolutions The parsed evolution table.
 * @param {Set<string>} gameSpecies The species the game has.
 * @returns {{forms: Object<string, {megas: Array<object>, gigantamax: {species: string, available: boolean}|null}>,
 *            diagnostics: Array<object>}} Each species' battle forms and diagnostics.
 */
function buildBattleForms(evolutions, gameSpecies)
{
    const forms = {};
    const missing = new Set();

    for (const species of gameSpecies)
    {
        const megas = [];
        let gigantamax = null;
        for (const { method, parameter, target, variant } of evolutions?.[species] ?? [])
        {
            const available = gameSpecies.has(target);
            if (method === EVO_MEGA && typeof parameter === "string")
            {
                // A held item or known move triggers it; entries without one only revert a form
                const trigger = parameter.startsWith(ITEM_PREFIX) && parameter !== ITEM_NONE ? { item: parameter }
                    : parameter.startsWith(MOVE_PREFIX) && parameter !== MOVE_NONE ? { move: parameter } : null;
                if (trigger == null)
                    continue;

                megas.push({ species: target, ...trigger, variant, available });
            }
            else if (method === EVO_GIGANTAMAX && GIGANTAMAX_ENABLED.has(parameter))
                gigantamax = { species: target, available };
            else
                continue;

            if (!available)
                missing.add(target);
        }

        forms[species] = { megas, gigantamax };
    }

    const diagnostics = missing.size === 0 ? [] :
        [{ severity: SEVERITY_WARNING, code: "BATTLE_FORM_UNAVAILABLE", message: `${missing.size} Mega Evolution or Gigantamax forms in DPE are not species in this game, so they cannot be previewed. For example: ${formatExamples(missing)}.`, repository: REPOSITORY_DPE, file: DPE_EVOLUTION_FILE, details: [...missing] }];

    return { forms, diagnostics };
}
module.exports.buildBattleForms = buildBattleForms;
