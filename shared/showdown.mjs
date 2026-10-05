/**
 * Pure Showdown text adapter. No source ownership or battle-format metadata is embedded in team text.
 */

import { Sets, Teams } from "@pkmn/sets";
import { EV_FIELDS, HIDDEN_POWER_TYPES, IV_FIELDS, MAX_EV, MAX_EV_TOTAL, MAX_IV, MOVE_HIDDEN_POWER, STATS, getAbilityOptions, getEffectiveAbility, getHiddenPowerType, optimizeHiddenPowerIvs } from "./pokemon-mechanics.mjs";
import { ANY_TEAM_TYPE, MAX_MOVES, createNewSpreadFields, getFieldSymbol, setTeamType, validateSpreadFields } from "./spread-model.mjs";
import { getMegaEvolutions, getMoveLegality, getOutOfBattleForm, LEGALITY } from "./catalog.mjs";

export const MAX_SHOWDOWN_LENGTH = 1024 * 1024;
export const MAX_SHOWDOWN_SETS = 512;
export const SHOWDOWN_PLACEHOLDER_ERROR = "PLACEHOLDER";
export const SHOWDOWN_LOSSES = ["File, set and trainer ownership", "Singles and doubles flags", "Modify Moves Doubles", "Doubles team type", "Source comments", "Random-ball semantics", "Identical-name ability slots"];
const DEFAULT_LEVEL = 100;
const DEFAULT_IV = 31;
const EMPTY = 0;
const STAT_LABELS = { hp: "HP", atk: "Atk", def: "Def", spAtk: "SpA", spDef: "SpD", spd: "Spe" };
export const SHOWDOWN_STATS = { hp: "hp", atk: "atk", def: "def", spAtk: "spa", spDef: "spd", spd: "spe" };
const STAT_ALIASES = { hp: "hp", hitpoints: "hp", atk: "atk", attack: "atk", def: "def", defense: "def", defence: "def", spa: "spAtk", spatk: "spAtk", specialattack: "spAtk", spd: "spDef", spdef: "spDef", specialdefense: "spDef", specialdefence: "spDef", spe: "spd", speed: "spd" };
const HEADERS = new Set(["ability", "trait", "level", "shiny", "gigantamax", "pokeball", "hidden power", "happiness", "dynamax level", "tera type", "evs", "ivs"]);
// Gender is left out silently, since spreads never set it
const UNSUPPORTED = ["happiness", "dynamaxLevel", "teraType", "name"];
const REPLACE_FIELDS = ["species", "nature", ...STATS.map((stat) => IV_FIELDS[stat]), ...STATS.map((stat) => EV_FIELDS[stat]), "ability", "item", "moves", "ball", "shiny", "gigantamax"];

/**
 * Builds a comparison key that ignores case, accents and punctuation.
 *
 * @param {string} value Name to compare.
 * @returns {string} Punctuation-free key.
 */
function key(value)
{
    return String(value ?? "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Looks up the display name of a catalog constant.
 *
 * @param {object} table Catalog table.
 * @param {string} symbol Constant.
 * @returns {string|null} Display name.
 */
function label(table, symbol)
{
    const entry = table?.[symbol];
    return typeof entry === "string" ? entry : entry?.name ?? null;
}

/**
 * Finds the catalog constants whose name matches a Showdown name.
 *
 * @param {object} table Catalog table.
 * @param {string} name Display name.
 * @param {boolean} [species] Include alternate names.
 * @returns {string[]} Matching constants.
 */
function matches(table, name, species = false)
{
    const wanted = key(name);
    if (!wanted)
        return [];
    return Object.entries(table ?? {}).filter(([symbol, entry]) =>
        [symbol.replace(/^[^_]+_/, ""), label(table, symbol), ...(species ? [entry.showdownName] : [])].some((candidate) => key(candidate) === wanted)).map(([symbol]) => symbol);
}

/**
 * Creates an import or export problem for the UI.
 *
 * @param {string} message Problem text.
 * @param {string} [field] Affected field.
 * @returns {object} UI issue.
 */
function issue(message, field = "text")
{
    return { field, message: message.replace(/\.$/, "") };
}

/**
 * Recognizes the zeroed source placeholders without treating incomplete active spreads as placeholders.
 *
 * @param {object} fields The source fields.
 * @returns {boolean} Whether the fields describe a placeholder.
 */
function isExportPlaceholder(fields)
{
    return Boolean(fields.species) && !fields.forSingles && !fields.forDoubles
        && STATS.every((stat) => fields[IV_FIELDS[stat]] === EMPTY && fields[EV_FIELDS[stat]] === EMPTY)
        && fields.ability === EMPTY && !fields.shiny && !fields.gigantamax && !fields.modifyMovesDoubles && !fields.specificTeamType
        && getFieldSymbol(fields, "nature") === "NATURE_HARDY" && getFieldSymbol(fields, "item") === "ITEM_NONE"
        && getFieldSymbol(fields, "ball") === "BALL_TYPE_RANDOM"
        && Array.isArray(fields.moves) && fields.moves.every((move) => move === EMPTY || move === "MOVE_NONE");
}

/**
 * Exports one spread as Showdown set text.
 *
 * @param {object} catalog Catalog.
 * @param {object} fields Spread.
 * @param {{level?: number}} [options] Preview level.
 * @returns {{text: string, errors: object[], warnings: object[]}} Export result.
 */
export function exportSpread(catalog, fields, { level = DEFAULT_LEVEL } = {})
{
    if (isExportPlaceholder(fields))
        return { text: "", errors: [{ ...issue("Placeholder not exported"), code: SHOWDOWN_PLACEHOLDER_ERROR }], warnings: [] };

    const errors = [];
    const warnings = [];
    const species = catalog.species?.[fields.species];
    const speciesName = species?.showdownName || species?.name;
    if (!speciesName)
        errors.push(issue(`Unknown species: ${fields.species}.`, "species"));
    // Moves the game does not name are left out rather than skipping the spread
    const moves = (fields.moves ?? []).filter((move) => move && move !== "MOVE_NONE").filter((move) =>
    {
        const known = move === MOVE_HIDDEN_POWER || Boolean(label(catalog.moves, move));
        if (!known)
            warnings.push(issue(`Unknown move ${move} left out`, "moves"));
        return known;
    });
    const nature = label(catalog.natures, getFieldSymbol(fields, "nature"));
    const item = getFieldSymbol(fields, "item");
    const ball = getFieldSymbol(fields, "ball");
    const ability = getEffectiveAbility(species, fields.ability);
    if (!nature || !ability || !label(catalog.abilities, ability) || (item !== "ITEM_NONE" && !label(catalog.items, item)) || (ball !== "BALL_TYPE_RANDOM" && !label(catalog.balls, ball)))
        errors.push(issue("A nature, ability, item or ball has no catalog name.", "fields"));
    for (const stat of STATS)
    {
        for (const field of [IV_FIELDS[stat], EV_FIELDS[stat]])
        {
            if (!Number.isInteger(fields[field]))
                errors.push(issue(`${field} has no whole-number value.`, field));
        }
    }
    if (!Number.isInteger(level))
        errors.push(issue("Level has no whole-number value.", "level"));
    if (errors.length)
        return { text: "", errors, warnings };

    const hiddenPower = moves.includes(MOVE_HIDDEN_POWER);
    const ivs = Object.fromEntries(STATS.map((stat) => [SHOWDOWN_STATS[stat], fields[IV_FIELDS[stat]]]));
    const evs = Object.fromEntries(STATS.map((stat) => [SHOWDOWN_STATS[stat], fields[EV_FIELDS[stat]]]));
    const showdownMoves = moves.map((move) => move === MOVE_HIDDEN_POWER
        ? `Hidden Power [${label(catalog.types, getHiddenPowerType(fields)) ?? getHiddenPowerType(fields).slice(5).toLowerCase()}]` : label(catalog.moves, move));
    const set = { species: speciesName, item: item === "ITEM_NONE" ? "" : label(catalog.items, item), ability: label(catalog.abilities, ability), level, nature, shiny: !!fields.shiny, gigantamax: !!fields.gigantamax, pokeball: ball === "BALL_TYPE_RANDOM" ? "" : label(catalog.balls, ball), evs, ivs, moves: showdownMoves };
    let text = Sets.exportSet(set).trimEnd();
    if (hiddenPower)
    {
        const fullIvs = `IVs: ${STATS.map((stat) => `${fields[IV_FIELDS[stat]]} ${STAT_LABELS[stat]}`).join(" / ")}`;
        const lines = text.split("\n").filter((line) => !line.startsWith("IVs: "));
        const firstMove = lines.findIndex((line) => line.startsWith("- "));
        lines.splice(firstMove, 0, fullIvs);
        text = lines.join("\n");
    }
    return { text: text.replace(/  $/gm, ""), errors: [], warnings };
}

/**
 * Exports several spreads as one Showdown team text.
 *
 * @param {object} catalog Catalog.
 * @param {Array<{fields: object, level?: number, id?: string}>} entries Spreads.
 * @returns {{text: string, errors: object[], warnings: object[]}} Indexed export result.
 */
export function exportSpreads(catalog, entries)
{
    const results = entries.map((entry) => exportSpread(catalog, entry.fields, { level: entry.level }));
    const errors = results.flatMap((result, index) => result.errors.map((problem) => ({ ...problem, index, id: entries[index].id ?? null })));
    return { text: results.map((result) => result.text).filter(Boolean).join("\n\n"), errors, warnings: results.flatMap((result, index) => result.warnings.map((warning) => ({ ...warning, index, id: entries[index].id ?? null }))) };
}

/**
 * Validates and normalizes an IVs or EVs line.
 *
 * @param {string} line Raw stat line.
 * @param {string} kind IVs or EVs.
 * @param {object} details Parsed metadata.
 * @returns {string} Normalized stat line.
 */
function parseStats(line, kind, details)
{
    const seen = new Set();
    const parts = line.split(/\s*\/\s*/).map((part) =>
    {
        const match = /^(\S+)\s+(.+)$/.exec(part.trim());
        const stat = STAT_ALIASES[key(match?.[2])];
        const value = match?.[1];
        if (!match || !stat || !/^\d+$/.test(value))
        {
            details.errors.push(issue(`Invalid ${kind} entry: ${part}.`, kind.toLowerCase()));
            return part;
        }
        if (seen.has(stat))
            details.errors.push(issue(`Duplicate ${kind} stat: ${match[2]}.`, kind.toLowerCase()));
        seen.add(stat);
        const number = Number(value);
        if (number > (kind === "IVs" ? MAX_IV : MAX_EV))
            details.errors.push(issue(`${kind} ${match[2]} is out of range.`, kind.toLowerCase()));
        if (kind === "IVs")
            details.explicitIvs.add(stat);
        else
            details.evTotal += number;
        return `${number} ${STAT_LABELS[stat]}`;
    });
    return `${kind}: ${parts.join(" / ")}`;
}

/**
 * Validates and normalizes the lines of one set.
 *
 * @param {string[]} lines One set's raw lines.
 * @returns {{text: string, errors: object[], warnings: object[], explicitIvs: string[], unsupported: object[]}} Normalized block.
 */
function normalizeBlock(lines)
{
    const details = { errors: [], warnings: [], unsupported: [], explicitIvs: new Set(), evTotal: 0 };
    const seen = new Set();
    const normalized = lines.map((raw, index) =>
    {
        const line = raw.trim();
        if (index === 0)
            return line.replace(/\s+@\s+/, " @ ");
        if (/^[-~]\s*/.test(line))
            return `- ${line.replace(/^[-~]\s*/, "").replace(/^Hidden Power\s*\[([^\]]+)\]$/i, "Hidden Power [$1]")}`;
        const nature = /^(.+?)\s+Nature$/i.exec(line);
        if (nature)
        {
            if (seen.has("nature"))
                details.errors.push(issue("Duplicate Nature line.", "nature"));
            seen.add("nature");
            return `${nature[1]} Nature`;
        }
        const header = /^([^:]+):\s*(.*)$/.exec(line);
        const name = header?.[1].toLowerCase();
        if (!header || !HEADERS.has(name))
        {
            details.warnings.push(issue(`Unknown line: ${line}.`));
            return line;
        }
        const category = name === "trait" ? "ability" : name;
        if (seen.has(category))
            details.errors.push(issue(`Duplicate ${category} line.`, category));
        seen.add(category);
        if (category === "ivs" || category === "evs")
            return parseStats(header[2], category === "ivs" ? "IVs" : "EVs", details);
        if (["level", "happiness", "dynamax level"].includes(category) && !/^\d+$/.test(header[2]))
            details.errors.push(issue(`Invalid ${category}: ${header[2]}.`, category));
        if (["shiny", "gigantamax"].includes(category) && !/^(yes|no)$/i.test(header[2]))
            details.errors.push(issue(`Invalid ${category}: ${header[2]}.`, category));
        if (["level", "happiness", "dynamax level", "tera type"].includes(category))
            details.unsupported.push({ field: category, value: header[2] });
        return `${name === "trait" ? "Trait" : header[1]}: ${header[2]}`;
    });
    if (details.evTotal > MAX_EV_TOTAL)
        details.errors.push(issue(`EV total exceeds ${MAX_EV_TOTAL}.`, "evs"));
    return { ...details, explicitIvs: [...details.explicitIvs], text: normalized.join("\n") };
}

/**
 * Parses pasted Showdown team text into sets.
 *
 * @param {string} text Pasted team text.
 * @returns {{sets: object[], errors: object[]}} Ordered parsed sets with teamName, teamFormat, explicitIvs, warnings, errors and unsupported.
 */
export function parseShowdownText(text)
{
    if (typeof text !== "string" || text.length > MAX_SHOWDOWN_LENGTH)
        return { sets: [], errors: [issue(`Showdown text must be at most ${MAX_SHOWDOWN_LENGTH} characters.`)] };
    const clean = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
    if (/^[\[{]/.test(clean) || (clean.includes("|") && !clean.includes("\n")))
        return { sets: [], errors: [issue("Packed teams and JSON are not supported. Paste exported Showdown team text instead.")] };
    const teams = Teams.importTeams(clean);
    const blocks = [];
    let teamName = null;
    let teamFormat = null;
    let lines = [];
    /**
     * Finishes the current set block.
     */
    function flush()
    {
        if (lines.length)
            blocks.push({ lines, teamName, teamFormat });
        lines = [];
    }
    for (const line of clean.split("\n"))
    {
        const header = /^===\s*(?:\[([^\]]+)\]\s*)?(.*?)\s*===$/.exec(line.trim());
        if (header)
        {
            flush();
            teamFormat = header[1] ?? null;
            teamName = header[2] || null;
        }
        else if (!line.trim() || line.trim() === "---")
            flush();
        else
            lines.push(line);
    }
    flush();
    if (blocks.length > MAX_SHOWDOWN_SETS)
        return { sets: [], errors: [issue(`At most ${MAX_SHOWDOWN_SETS} sets can be imported.`)] };
    const sets = blocks.map((block) =>
    {
        const details = normalizeBlock(block.lines);
        const set = Sets.importSet(details.text);
        const moveLines = block.lines.filter((line) => /^\s*[-~]/.test(line));
        if (moveLines.length > MAX_MOVES)
            details.errors.push(issue(`A spread can have at most ${MAX_MOVES} moves.`, "moves"));
        const typed = moveLines.map((line) => /Hidden Power\s*(?:\[([^\]]+)\]|\s+([A-Za-z]+))/i.exec(line)).find(Boolean);
        return { set, teamName: block.teamName, teamFormat: block.teamFormat, ...details, hiddenPowerType: typed?.[1] ?? typed?.[2] ?? set.hpType ?? null };
    });
    return { sets, errors: teams.length === 0 && blocks.length === 0 ? [issue("No Showdown sets found.")] : [] };
}

/**
 * Resolves a parsed Showdown set into spread fields.
 *
 * @param {object} catalog Catalog.
 * @param {object} parsedSet Entry returned by parseShowdownText (or a Sets.importSet result).
 * @param {object} [options] {species, abilitySlot, hiddenPower, expectedLevel, existingFields}.
 * @returns {{fields: object|null, warnings: object[], errors: object[], ambiguities: object[], unsupported: object[]}} Resolution.
 */
export function resolveImportedSet(catalog, parsedSet, options = {})
{
    const parsed = parsedSet.set ?? parsedSet;
    const errors = [...(parsedSet.errors ?? [])];
    const warnings = [...(parsedSet.warnings ?? [])];
    const unsupported = [...(parsedSet.unsupported ?? [])];
    const ambiguities = [];
    let candidates = matches(catalog.species, parsed.species, true);

    // Regional and Mega forms can share their base form's display name, so an exact Showdown name wins
    const exact = candidates.filter((candidate) => key(catalog.species[candidate]?.showdownName) === key(parsed.species));
    if (exact.length)
        candidates = exact;

    // Prefer an out-of-battle match when a battle-only form shares its name.
    const outOfBattle = candidates.filter((candidate) => getOutOfBattleForm(catalog, candidate) == null);
    const battleForms = outOfBattle.length ? [] : candidates.map((candidate) => ({ ...getOutOfBattleForm(catalog, candidate), mega: candidate }));
    candidates = outOfBattle.length ? outOfBattle : battleForms.map((form) => form.species);
    candidates = [...new Set(candidates)];
    if (!candidates.length)
        errors.push(issue(`Unknown species: ${parsed.species || "(missing)"}.`, "species"));
    if (candidates.length > 1 && !candidates.includes(options.species))
        ambiguities.push({ field: "species", candidates, message: "Choose species" });
    const species = candidates.includes(options.species) ? options.species : candidates[0];
    const speciesName = label(catalog.species, species);
    const fields = createNewSpreadFields(species, catalog.species?.[species]);
    const mega = battleForms.find((form) => form.species === species);
    if (mega)
        warnings.push(issue(`${parsed.species} imported as ${speciesName} (battle-only form)`, "species"));
    const itemMatches = parsed.item ? matches(catalog.items, parsed.item) : [];
    if (parsed.item && !itemMatches.length)
        errors.push(issue(`Unknown item: ${parsed.item}.`, "item"));
    fields.item = itemMatches[0] ?? mega?.item ?? "ITEM_NONE";
    if (mega?.item && fields.item !== mega.item)
        ambiguities.push({ field: "item", candidates: [fields.item, mega.item], message: "Mega form and item disagree" });
    const natureMatches = matches(catalog.natures, parsed.nature || "Hardy");
    if (!natureMatches.length)
        errors.push(issue(`Unknown nature: ${parsed.nature}.`, "nature"));
    fields.nature = natureMatches[0] ?? fields.nature;
    const moves = parsed.moves ?? [];
    const resolvedMoves = moves.slice(0, MAX_MOVES).map((move) =>
    {
        const hidden = /^Hidden Power(?:\s*\[([^\]]+)\]|\s+([A-Za-z]+))?$/i.exec(move);
        const found = hidden ? [MOVE_HIDDEN_POWER] : matches(catalog.moves, move);
        return { move, hidden, symbol: label(catalog.moves, found[0]) ? found[0] : null };
    });
    const movesResolved = resolvedMoves.map(({ symbol }) => symbol).filter(Boolean);
    if (parsed.ability && species)
    {
        const abilityMatches = matches(catalog.abilities, parsed.ability);
        const abilityOptions = getAbilityOptions(catalog.species[species]);
        const slots = abilityOptions.filter((option) => abilityMatches.includes(option.ability)).map((option) => option.slot);
        const reachableMegas = getMegaEvolutions(catalog, species, fields.item, movesResolved);
        const megaSpecies = [mega?.mega, ...reachableMegas.map((evolution) => evolution.species)];
        const matchesMega = megaSpecies.some((candidate) => (catalog.species[candidate]?.abilities ?? []).some((ability) => abilityMatches.includes(ability)));
        if (slots.length)
            fields.ability = slots.includes(options.abilitySlot) ? options.abilitySlot : slots.includes(options.existingFields?.ability) ? options.existingFields.ability : slots[0];
        else if (matchesMega)
        {
            if (abilityOptions.some((option) => option.slot === options.existingFields?.ability))
                fields.ability = options.existingFields.ability;
        }
        else
            warnings.push(issue(`${parsed.ability} not available (using ${label(catalog.abilities, getEffectiveAbility(catalog.species[species], fields.ability)) ?? "default ability"})`, "ability"));
    }
    const ballMatches = parsed.pokeball ? matches(catalog.balls, parsed.pokeball) : [];
    if (parsed.pokeball && !ballMatches.length)
        errors.push(issue(`Unknown ball: ${parsed.pokeball}.`, "ball"));
    fields.ball = ballMatches[0] ?? "BALL_TYPE_RANDOM";
    fields.shiny = !!parsed.shiny;
    fields.gigantamax = !!parsed.gigantamax || mega?.gigantamax === true;
    for (const stat of STATS)
    {
        const showdownStat = SHOWDOWN_STATS[stat];
        fields[EV_FIELDS[stat]] = parsed.evs?.[showdownStat] ?? 0;
        fields[IV_FIELDS[stat]] = parsedSet.explicitIvs?.includes(stat) ? parsed.ivs?.[showdownStat] ?? DEFAULT_IV : DEFAULT_IV;
    }
    if (!parsedSet.explicitIvs && parsed.ivs)
    {
        for (const stat of STATS)
            fields[IV_FIELDS[stat]] = parsed.ivs[SHOWDOWN_STATS[stat]] ?? DEFAULT_IV;
    }
    if (!moves.length)
        errors.push(issue("At least one move required", "moves"));
    if (moves.length > MAX_MOVES)
        errors.push(issue(`At most ${MAX_MOVES} moves allowed`, "moves"));
    let moveHiddenPowerType = null;
    for (const { move, hidden, symbol } of resolvedMoves)
    {
        moveHiddenPowerType ??= hidden?.[1] ?? hidden?.[2];
        // A move the game lacks is left out rather than skipping the whole set
        if (!symbol)
            warnings.push(issue(`${move} not in this game (left out)`, "moves"));
        else
        {
            fields.moves[fields.moves.findIndex((slot) => !slot)] = symbol;
            if (species && catalog.learnsets && getMoveLegality(catalog, species, symbol).status === LEGALITY.ILLEGAL)
                warnings.push(issue(`${move} not learnable`, "moves"));
        }
    }
    if (moves.length && !fields.moves.some(Boolean))
        errors.push(issue("No moves in this game", "moves"));
    const requestedType = parsedSet.hiddenPowerType ?? parsed.hpType ?? moveHiddenPowerType;
    if (requestedType && fields.moves.includes(MOVE_HIDDEN_POWER))
    {
        const type = HIDDEN_POWER_TYPES.find((candidate) => key(candidate.slice(5)) === key(requestedType));
        if (!type)
            errors.push(issue(`Unknown Hidden Power type: ${requestedType}.`, "moves"));
        else if (!parsedSet.explicitIvs?.length)
            Object.assign(fields, optimizeHiddenPowerIvs(fields, type));
        else if (getHiddenPowerType(fields) !== type)
        {
            if (options.hiddenPower === "optimizeIvs")
                Object.assign(fields, optimizeHiddenPowerIvs(fields, type));
            else if (options.hiddenPower !== "keepIvs")
                ambiguities.push({ field: "hiddenPower", candidates: ["keepIvs", "optimizeIvs"], message: `Hidden Power ${label(catalog.types, getHiddenPowerType(fields)) ?? getHiddenPowerType(fields).slice(5)} from IVs (requested ${requestedType})` });
        }
    }
    if (parsed.hpType && fields.moves.includes(MOVE_HIDDEN_POWER) && parsedSet.hiddenPowerType && key(parsed.hpType) !== key(parsedSet.hiddenPowerType))
        ambiguities.push({ field: "hiddenPower", candidates: ["keepIvs", "optimizeIvs"], message: "Hidden Power types disagree" });
    if (options.expectedLevel != null && parsed.level != null && parsed.level !== options.expectedLevel)
        warnings.push(issue(`Level ${parsed.level} (expected ${options.expectedLevel})`, "level"));
    for (const name of UNSUPPORTED)
    {
        if (parsed[name] != null && parsed[name] !== "" && !unsupported.some((entry) => key(entry.field) === key(name)))
            unsupported.push({ field: name, value: parsed[name] });
    }
    if (unsupported.some((entry) => entry.field === "happiness") && moves.some((move) => /^(Return|Frustration)$/i.test(move)))
        warnings.push(issue("Happiness not saved (affects Return/Frustration)", "happiness"));
    errors.push(...validateSpreadFields(fields).map(({ field, message }) => issue(message, field)));
    return { fields, warnings, errors, ambiguities, unsupported };
}

/**
 * Overwrites an existing spread with an imported one.
 *
 * @param {object} catalog Catalog.
 * @param {object} currentFields Existing spread.
 * @param {object} resolvedFields Imported spread.
 * @param {{teamTypes?: object[], saved?: object, ballProvided?: boolean}} [options] Overwrite context.
 * @returns {{fields: object, differences: object[]}} Updated fields and {field, before, after} changes.
 */
export function applyOverwrite(catalog, currentFields, resolvedFields, { teamTypes = [], saved = currentFields, ballProvided = false } = {})
{
    const fields = { ...currentFields };
    for (const name of REPLACE_FIELDS)
    {
        if (name !== "ball" || ballProvided)
            fields[name] = Array.isArray(resolvedFields[name]) ? [...resolvedFields[name]] : resolvedFields[name];
    }
    const oldAbility = getEffectiveAbility(catalog.species?.[currentFields.species], currentFields.ability);
    const newAbility = getEffectiveAbility(catalog.species?.[fields.species], fields.ability);
    if (oldAbility === newAbility && catalog.species?.[fields.species]?.abilities?.[currentFields.ability] === newAbility)
        fields.ability = currentFields.ability;
    const reset = setTeamType(fields, ANY_TEAM_TYPE, teamTypes, saved);
    const differences = Object.keys(reset).filter((field) => JSON.stringify(reset[field]) !== JSON.stringify(currentFields[field])).map((field) => ({ field, before: currentFields[field], after: reset[field] }));
    return { fields: reset, differences };
}

/**
 * Counts the parsed sets.
 *
 * @param {{sets?: object[]}} parsed Result of parseShowdownText.
 * @returns {number} Number of sets across all teams.
 */
export function countImportedSets(parsed)
{
    return parsed.sets?.length ?? 0;
}
