/**
 * Reads game data tables from CFRU and DPE C sources: move details, level-up learnsets, egg moves,
 * TM and tutor tables, TM and tutor compatibility lists, the evolution table, the doubles team types, item kinds
 * and DPE's species graphics tables.
 * Only the text the compiler would see is read, and nothing is evaluated.
 */

const { getLine, parseActiveSource, parseInteger } = require("./spread-parser");

const KIND_DECLARATION = "declaration";
const KIND_INIT_DECLARATOR = "init_declarator";
const KIND_ARRAY_DECLARATOR = "array_declarator";
const KIND_POINTER_DECLARATOR = "pointer_declarator";
const KIND_PARENTHESIZED_DECLARATOR = "parenthesized_declarator";
const KIND_INITIALIZER_LIST = "initializer_list";
const KIND_INITIALIZER_PAIR = "initializer_pair";
const KIND_SUBSCRIPT_DESIGNATOR = "subscript_designator";
const KIND_FIELD_DESIGNATOR = "field_designator";
const KIND_FIELD_IDENTIFIER = "field_identifier";
const KIND_IDENTIFIER = "identifier";
const KIND_NUMBER = "number_literal";
const KIND_CALL = "call_expression";
const KIND_ARGUMENT_LIST = "argument_list";
const KIND_BINARY = "binary_expression";
const KIND_UNARY = "unary_expression";
const KIND_COMMENT = "comment";
const KIND_ENUMERATOR_LIST = "enumerator_list";
const KIND_ENUMERATOR = "enumerator";
const PUNCTUATION = new Set(["{", "}", ",", "(", ")"]);
const DECLARATOR_WRAPPERS = new Set([KIND_ARRAY_DECLARATOR, KIND_POINTER_DECLARATOR, KIND_PARENTHESIZED_DECLARATOR]);

const SEVERITY_WARNING = "warning";

const BATTLE_MOVES_ARRAY = "gBattleMoves";
const MAX_MOVE_POWERS_ARRAY = "gDynamaxMovePowers";
const LEVEL_UP_TABLE = "gLevelUpLearnsets";
const EGG_MOVES_ARRAY = "gEggMoves";
const TM_TABLE = "gTMHMMoves";
const TUTOR_TABLE = "gMoveTutorMoves";
const EVOLUTION_TABLE = "gEvolutionTable";
const ITEM_TYPES_TABLE = "gItemsByType";
const LEVEL_UP_MACRO = "LEVEL_UP_MOVE";
const LEVEL_UP_END = "LEVEL_UP_END";
const EGG_MOVES_MACRO = "egg_moves";
const EGG_MOVES_TERMINATOR = "EGG_MOVES_TERMINATOR";
const SPECIES_PREFIX = "SPECIES_";
const MOVE_PREFIX = "MOVE_";
const FLAG_SEPARATOR = "|";
const EVOLUTION_FIELD_COUNT = 4;

// The enum listing the values of BattleTowerSpread.specificTeamType starts with this member
const TEAM_TYPE_ANY = "DOUBLES_ANY_TEAM";

// Move fields read as numbers, symbols or a list of flags; others such as the Z-Move effect are not needed
const MOVE_NUMBER_FIELDS = ["power", "accuracy", "pp", "priority", "secondaryEffectChance", "zMovePower"];
const MOVE_SYMBOL_FIELDS = ["effect", "type", "target", "split"];
const MOVE_FLAGS_FIELD = "flags";
const MOVE_FIELD_NAMES = { z_move_power: "zMovePower" };
const MAX_MOVE_POWER_FIELD = "maxMovePower";

const COMPATIBILITY_FILE_PATTERN = /^(\d+)\s*-\s*(.+)\.txt$/i;
const COMPATIBILITY_HEADING_PATTERN = /^[^:]*?\d+\s*:\s*(.+?)\s*$/;
const COMPATIBILITY_SPECIES_PATTERN = /^[A-Z0-9_]+$/;
const BYTE_ORDER_MARK = /^\uFEFF/;

// GCC accepts the obsolete designator "[INDEX] value" without "="; one space becomes "=" so offsets stay the same
const OBSOLETE_DESIGNATOR_PATTERN = /\][ \t](?=[ \t]*\{)/g;
const DESIGNATOR_ASSIGNMENT = "]=";


/**
 * Returns the non-punctuation children of a list or argument node.
 *
 * @param {object} node The syntax node.
 * @returns {Array<object>} The elements.
 */
function getElements(node)
{
    return node.children().filter((child) => !PUNCTUATION.has(child.kind()) && child.kind() !== KIND_COMMENT);
}

/**
 * Returns the name a declarator declares, looking through pointers and array bounds.
 *
 * @param {object|null} declarator The declarator node.
 * @returns {string|null} The name.
 */
function getDeclaredName(declarator)
{
    let node = declarator;
    while (node != null && DECLARATOR_WRAPPERS.has(node.kind()))
        node = node.field("declarator");

    return node?.kind() === KIND_IDENTIFIER ? node.text() : null;
}

/**
 * Collects the top-level arrays initialized with a list, by name.
 *
 * @param {object} root The translation unit.
 * @returns {Map<string, {listNode: object, line: number, count: number}>} Arrays by name.
 */
function collectArrays(root)
{
    const arrays = new Map();

    for (const declaration of root.children().filter((node) => node.kind() === KIND_DECLARATION))
    {
        for (const declarator of declaration.children().filter((node) => node.kind() === KIND_INIT_DECLARATOR))
        {
            const listNode = declarator.field("value");
            const name = getDeclaredName(declarator.field("declarator"));
            if (name == null || listNode?.kind() !== KIND_INITIALIZER_LIST)
                continue;

            // The first definition is kept; a second one is reported by the caller
            const existing = arrays.get(name);
            if (existing != null)
                existing.count++;
            else
                arrays.set(name, { listNode, line: getLine(declaration), count: 1 });
        }
    }

    return arrays;
}

/**
 * Parses a C source file and collects its arrays.
 *
 * @param {string} text The file text.
 * @param {Map<string, object>} macros Macros defined before the file.
 * @returns {{arrays: Map<string, object>, diagnostics: Array<object>}} The arrays and diagnostics.
 */
function readSourceArrays(text, macros)
{
    const { root, diagnostics } = parseActiveSource(text.replace(OBSOLETE_DESIGNATOR_PATTERN, DESIGNATOR_ASSIGNMENT), macros);
    return { arrays: collectArrays(root), diagnostics };
}

/**
 * Returns an array, reporting when it is missing or defined more than once.
 *
 * @param {Map<string, object>} arrays The file's arrays.
 * @param {string} name The array name.
 * @param {Array<object>} diagnostics Diagnostics to append to.
 * @returns {object|null} The array.
 */
function requireArray(arrays, name, diagnostics)
{
    const array = arrays.get(name);
    if (array == null)
    {
        diagnostics.push({ severity: SEVERITY_WARNING, code: "DATA_TABLE_NOT_FOUND", message: `Could not find ${name}.` });
        return null;
    }

    if (array.count > 1)
        diagnostics.push({ severity: SEVERITY_WARNING, code: "DATA_TABLE_DUPLICATE", message: `${name} is defined more than once; the first definition is used.`, line: array.line });

    return array;
}

/**
 * Returns the key of a [KEY] = value initializer pair.
 *
 * @param {object} pair The initializer pair.
 * @returns {string|number|null} The key symbol, a numeric index, or null if the key cannot be read.
 */
function getSubscriptKey(pair)
{
    const designators = pair.children().filter((node) => node.kind().endsWith("designator"));
    if (designators.length !== 1 || designators[0].kind() !== KIND_SUBSCRIPT_DESIGNATOR)
        return null;

    const key = getElements(designators[0]).filter((node) => node.kind() !== "[" && node.kind() !== "]");
    if (key.length !== 1)
        return null;
    if (key[0].kind() === KIND_NUMBER)
        return parseInteger(key[0].text());

    return key[0].kind() === KIND_IDENTIFIER ? key[0].text() : null;
}

/**
 * Reads the [KEY] = value entries of a designated table, reporting anything else.
 * Entries at plain numeric indexes have no constant to name them, so they are left out.
 *
 * @param {object} array The array.
 * @param {string} name The array name, for diagnostics.
 * @param {Array<object>} diagnostics Diagnostics to append to.
 * @returns {Map<string, object>} Keys to value nodes, keeping the last value of a repeated key as C does.
 */
function readDesignatedEntries(array, name, diagnostics)
{
    const entries = new Map();
    let skipped = 0;
    let repeated = 0;

    for (const child of getElements(array.listNode))
    {
        const key = child.kind() === KIND_INITIALIZER_PAIR ? getSubscriptKey(child) : null;
        if (typeof key === "number")
            continue;
        if (key == null)
        {
            skipped++;
            continue;
        }

        if (entries.has(key))
            repeated++;
        entries.set(key, child.field("value"));
    }

    if (skipped > 0)
        diagnostics.push({ severity: SEVERITY_WARNING, code: "UNSUPPORTED_INITIALIZER", message: `${name} has ${skipped} entries that are not written as [CONSTANT] = value, so they were skipped.` });
    if (repeated > 0)
        diagnostics.push({ severity: SEVERITY_WARNING, code: "DATA_ENTRY_REPEATED", message: `${name} sets ${repeated} entries more than once; the last value of each is used.` });

    return entries;
}

/**
 * Reads a signed integer literal.
 *
 * @param {object} node The value node.
 * @returns {number|null} The value, or null if it is not a plain integer.
 */
function readSignedInteger(node)
{
    if (node == null || (node.kind() !== KIND_NUMBER && node.kind() !== KIND_UNARY))
        return null;

    // Tree-sitter keeps a leading minus sign inside the literal
    const text = node.text().replace(/\s+/g, "");
    const negative = text.startsWith("-");
    const value = parseInteger(negative ? text.slice(1) : text);
    return value == null ? null : negative ? -value : value;
}

/**
 * Reads flags written as FLAG_A | FLAG_B, or 0 for none.
 *
 * @param {object} node The value node.
 * @returns {Array<string>|null} The flag symbols, or null if they cannot be read.
 */
function readFlags(node)
{
    if (node == null)
        return null;
    if (node.kind() === KIND_NUMBER)
        return parseInteger(node.text()) === 0 ? [] : null;
    if (node.kind() === KIND_IDENTIFIER)
        return [node.text()];
    if (node.kind() !== KIND_BINARY)
        return null;

    // Every operand of the | chain must itself be a flag
    const isOr = node.children().some((child) => child.kind() === FLAG_SEPARATOR);
    const left = readFlags(node.field("left"));
    const right = readFlags(node.field("right"));
    if (!isOr || left == null || right == null)
        return null;

    return [...left, ...right];
}

/**
 * Reads one gBattleMoves entry.
 *
 * @param {object} listNode The entry's initializer list.
 * @returns {{move: object, unreadable: number}} The move's details, with null for values that could not be read,
 *          and how many fields could not be read.
 */
function readBattleMove(listNode)
{
    const move = Object.fromEntries([...MOVE_NUMBER_FIELDS, ...MOVE_SYMBOL_FIELDS, MOVE_FLAGS_FIELD].map((field) => [field, null]));
    let unreadable = 0;

    for (const pair of getElements(listNode).filter((node) => node.kind() === KIND_INITIALIZER_PAIR))
    {
        const designator = pair.children().find((node) => node.kind() === KIND_FIELD_DESIGNATOR);
        const sourceField = designator?.children().find((node) => node.kind() === KIND_FIELD_IDENTIFIER)?.text();
        const field = MOVE_FIELD_NAMES[sourceField] ?? sourceField;
        const valueNode = pair.field("value");
        if (field == null || valueNode == null || !Object.hasOwn(move, field))
            continue;

        let value = null;
        if (MOVE_NUMBER_FIELDS.includes(field))
            value = readSignedInteger(valueNode);
        else if (field === MOVE_FLAGS_FIELD)
            value = readFlags(valueNode);
        else if (valueNode.kind() === KIND_IDENTIFIER)
            value = valueNode.text();
        else
            value = readSignedInteger(valueNode);

        if (value == null)
            unreadable++;
        move[field] = value;
    }

    return { move, unreadable };
}

/**
 * Reads gDynamaxMovePowers, which only exists when CFRU compiles Dynamax.
 *
 * @param {Map<string, object>} arrays The file's arrays.
 * @param {Array<object>} diagnostics Diagnostics to append to.
 * @returns {Map<string, number|null>|null} Max Move powers by move, or null when the table is not compiled.
 */
function readMaxMovePowers(arrays, diagnostics)
{
    const array = arrays.get(MAX_MOVE_POWERS_ARRAY);
    if (array == null)
        return null;

    const powers = new Map();
    for (const [key, valueNode] of readDesignatedEntries(array, MAX_MOVE_POWERS_ARRAY, diagnostics))
        powers.set(key, readSignedInteger(valueNode));

    return powers;
}

/**
 * Parses CFRU's gBattleMoves table, with each move's Max Move power from gDynamaxMovePowers.
 *
 * @param {string} text The battle_moves.c text.
 * @param {Map<string, object>} macros The configuration macros.
 * @returns {{moves: Object<string, object>|null, diagnostics: Array<object>}} Move details by constant, or null
 *          when the table cannot be found, and diagnostics.
 */
function parseBattleMoves(text, macros)
{
    const { arrays, diagnostics } = readSourceArrays(text, macros);
    const array = requireArray(arrays, BATTLE_MOVES_ARRAY, diagnostics);
    if (array == null)
        return { moves: null, diagnostics };

    // Moves missing from the Max Move table get C's 0
    const maxMovePowers = readMaxMovePowers(arrays, diagnostics);

    // Values the editor cannot read are left unknown rather than guessed
    const moves = {};
    let unreadable = 0;
    for (const [key, valueNode] of readDesignatedEntries(array, BATTLE_MOVES_ARRAY, diagnostics))
    {
        if (valueNode?.kind() !== KIND_INITIALIZER_LIST)
        {
            unreadable++;
            continue;
        }

        const result = readBattleMove(valueNode);
        moves[key] = { ...result.move, [MAX_MOVE_POWER_FIELD]: maxMovePowers == null ? null : maxMovePowers.get(key) ?? 0 };
        unreadable += result.unreadable;
    }

    if (unreadable > 0)
        diagnostics.push({ severity: SEVERITY_WARNING, code: "MOVE_DATA_UNREADABLE", message: `${unreadable} move values in ${BATTLE_MOVES_ARRAY} are not plain values, so they are shown as unknown.` });

    return { moves, diagnostics };
}
module.exports.parseBattleMoves = parseBattleMoves;

/**
 * Reads one level-up learnset array.
 *
 * @param {object} listNode The array's initializer list.
 * @returns {{moves: Array<{move: string, level: number}>, unreadable: number}} The moves in order and how many
 *          entries could not be read.
 */
function readLevelUpMoves(listNode)
{
    const moves = [];
    let unreadable = 0;

    for (const element of getElements(listNode))
    {
        if (element.kind() === KIND_IDENTIFIER && element.text() === LEVEL_UP_END)
            continue;

        // Entries are LEVEL_UP_MOVE(level, move), or the {move, level} it expands to
        let levelNode = null;
        let moveNode = null;
        if (element.kind() === KIND_CALL && element.field("function")?.text() === LEVEL_UP_MACRO)
            [levelNode, moveNode] = getElements(element.field("arguments") ?? element.children().find((node) => node.kind() === KIND_ARGUMENT_LIST));
        else if (element.kind() === KIND_INITIALIZER_LIST)
            [moveNode, levelNode] = getElements(element);

        // The {0, 0xFF} terminator ends the list
        const level = readSignedInteger(levelNode);
        if (moveNode?.kind() === KIND_NUMBER && parseInteger(moveNode.text()) === 0)
            continue;

        if (level == null || moveNode?.kind() !== KIND_IDENTIFIER || !moveNode.text().startsWith(MOVE_PREFIX))
        {
            unreadable++;
            continue;
        }

        moves.push({ move: moveNode.text(), level });
    }

    return { moves, unreadable };
}

/**
 * Parses DPE's level-up learnsets.
 *
 * @param {string} text The Learnsets.c text.
 * @param {Map<string, object>} macros The DPE configuration macros.
 * @returns {{learnsets: Object<string, Array<{move: string, level: number}>>|null, diagnostics: Array<object>}}
 *          Each species' level-up moves, or null when the table is not compiled, and diagnostics.
 */
function parseLevelUpLearnsets(text, macros)
{
    const { arrays, diagnostics } = readSourceArrays(text, macros);
    const table = requireArray(arrays, LEVEL_UP_TABLE, diagnostics);
    if (table == null)
        return { learnsets: null, diagnostics };

    // Each species points to a named learnset array, which several species may share
    const learnsets = {};
    const cache = new Map();
    const missing = new Set();
    let unreadable = 0;
    for (const [species, valueNode] of readDesignatedEntries(table, LEVEL_UP_TABLE, diagnostics))
    {
        const arrayName = valueNode?.kind() === KIND_IDENTIFIER ? valueNode.text() : null;
        const array = arrayName != null ? arrays.get(arrayName) : null;
        if (array == null)
        {
            missing.add(arrayName ?? valueNode?.text() ?? species);
            continue;
        }

        if (!cache.has(arrayName))
        {
            const result = readLevelUpMoves(array.listNode);
            unreadable += result.unreadable;
            cache.set(arrayName, result.moves);
        }
        learnsets[species] = cache.get(arrayName);
    }

    if (missing.size > 0)
        diagnostics.push({ severity: SEVERITY_WARNING, code: "LEARNSET_NOT_FOUND", message: `${LEVEL_UP_TABLE} refers to ${missing.size} learnsets that could not be found, such as ${[...missing][0]}.` });
    if (unreadable > 0)
        diagnostics.push({ severity: SEVERITY_WARNING, code: "LEARNSET_UNREADABLE", message: `${unreadable} level-up moves are not written as LEVEL_UP_MOVE(level, MOVE_...), so they were skipped.` });

    return { learnsets, diagnostics };
}
module.exports.parseLevelUpLearnsets = parseLevelUpLearnsets;

/**
 * Parses DPE's egg moves.
 *
 * @param {string} text The Egg_Moves.c text.
 * @param {Map<string, object>} macros The DPE configuration macros.
 * @returns {{eggMoves: Object<string, Array<string>>|null, diagnostics: Array<object>}} Each species' egg moves,
 *          or null when the table cannot be found, and diagnostics.
 */
function parseEggMoves(text, macros)
{
    const { arrays, diagnostics } = readSourceArrays(text, macros);
    const array = requireArray(arrays, EGG_MOVES_ARRAY, diagnostics);
    if (array == null)
        return { eggMoves: null, diagnostics };

    // Entries are egg_moves(SPECIES_SUFFIX, MOVE_A, MOVE_B, ...)
    const eggMoves = {};
    let unreadable = 0;
    for (const element of getElements(array.listNode))
    {
        if (element.kind() === KIND_IDENTIFIER && element.text() === EGG_MOVES_TERMINATOR)
            continue;

        const [speciesNode, ...moveNodes] = element.kind() === KIND_CALL && element.field("function")?.text() === EGG_MOVES_MACRO
            ? getElements(element.field("arguments")) : [];
        if (speciesNode?.kind() !== KIND_IDENTIFIER || moveNodes.some((node) => node.kind() !== KIND_IDENTIFIER || !node.text().startsWith(MOVE_PREFIX)))
        {
            unreadable++;
            continue;
        }

        const species = SPECIES_PREFIX + speciesNode.text();
        eggMoves[species] = [...(eggMoves[species] ?? []), ...moveNodes.map((node) => node.text())];
    }

    if (unreadable > 0)
        diagnostics.push({ severity: SEVERITY_WARNING, code: "EGG_MOVES_UNREADABLE", message: `${unreadable} entries in ${EGG_MOVES_ARRAY} are not written as ${EGG_MOVES_MACRO}(SPECIES, MOVE_...), so they were skipped.` });

    return { eggMoves, diagnostics };
}
module.exports.parseEggMoves = parseEggMoves;

/**
 * Reads a table of move constants in order.
 *
 * @param {Map<string, object>} arrays The file's arrays.
 * @param {string} name The table name.
 * @param {Array<object>} diagnostics Diagnostics to append to.
 * @returns {Array<string|null>|null} The moves, with null for entries that are not constants.
 */
function readMoveList(arrays, name, diagnostics)
{
    const array = requireArray(arrays, name, diagnostics);
    if (array == null)
        return null;

    const moves = getElements(array.listNode).map((node) => (node.kind() === KIND_IDENTIFIER && node.text().startsWith(MOVE_PREFIX) ? node.text() : null));
    const unreadable = moves.filter((move) => move == null).length;
    if (unreadable > 0)
        diagnostics.push({ severity: SEVERITY_WARNING, code: "MOVE_TABLE_UNREADABLE", message: `${unreadable} entries in ${name} are not move constants.` });

    return moves;
}

/**
 * Parses DPE's TM and tutor move tables.
 *
 * @param {string} text The TM_Tutor_Tables.c text.
 * @param {Map<string, object>} macros The DPE configuration macros.
 * @returns {{tmMoves: Array<string|null>|null, tutorMoves: Array<string|null>|null, diagnostics: Array<object>}}
 *          The moves each TM and tutor teaches, in number order, and diagnostics.
 */
function parseTeachableTables(text, macros)
{
    const { arrays, diagnostics } = readSourceArrays(text, macros);
    return { tmMoves: readMoveList(arrays, TM_TABLE, diagnostics), tutorMoves: readMoveList(arrays, TUTOR_TABLE, diagnostics), diagnostics };
}
module.exports.parseTeachableTables = parseTeachableTables;

/**
 * Parses one TM or tutor compatibility file, such as "10 - Hidden Power.txt".
 *
 * @param {string} fileName The file name.
 * @param {string} text The file text: a heading such as "TM10: Hidden Power" followed by one species per line.
 * @returns {{number: number|null, moveName: string|null, species: Array<string>, diagnostics: Array<object>}}
 *          The one-based TM or tutor number from the file name, the move named by the heading, the species and diagnostics.
 */
function parseCompatibilityFile(fileName, text)
{
    // HMs are headed with their own numbers, so the file name decides the position in the table
    const diagnostics = [];
    const [heading = "", ...lines] = text.replace(BYTE_ORDER_MARK, "").split(/\r?\n/);
    const fileMatch = COMPATIBILITY_FILE_PATTERN.exec(fileName);
    const headingMatch = COMPATIBILITY_HEADING_PATTERN.exec(heading);
    const number = fileMatch != null ? Number(fileMatch[1]) : null;

    if (number == null)
        diagnostics.push({ severity: SEVERITY_WARNING, code: "COMPATIBILITY_FILE_UNREADABLE", message: `${fileName} does not start with its number.` });
    if (headingMatch == null)
        diagnostics.push({ severity: SEVERITY_WARNING, code: "COMPATIBILITY_FILE_UNREADABLE", message: `${fileName} does not start with a heading such as "TM01: Move Name".` });

    // Species are written without the SPECIES_ prefix, one per line
    const species = [];
    const unreadable = [];
    for (const line of lines.map((value) => value.trim()).filter((value) => value !== ""))
    {
        if (COMPATIBILITY_SPECIES_PATTERN.test(line))
            species.push(line.startsWith(SPECIES_PREFIX) ? line : SPECIES_PREFIX + line);
        else
            unreadable.push(line);
    }

    if (unreadable.length > 0)
        diagnostics.push({ severity: SEVERITY_WARNING, code: "COMPATIBILITY_SPECIES_UNREADABLE", message: `${fileName} has ${unreadable.length} lines that are not species constants, such as "${unreadable[0]}".` });

    return { number, moveName: headingMatch?.[1] ?? null, species, diagnostics };
}
module.exports.parseCompatibilityFile = parseCompatibilityFile;

/**
 * Reads an evolution parameter, which may be a constant, a number or an expression.
 *
 * @param {object} node The value node.
 * @returns {string|number} The constant or number, or the expression's text.
 */
function readEvolutionValue(node)
{
    if (node.kind() === KIND_IDENTIFIER)
        return node.text();

    return readSignedInteger(node) ?? node.text();
}

/**
 * Parses DPE's evolution table.
 *
 * @param {string} text The Evolution Table.c text.
 * @param {Map<string, object>} macros The DPE configuration macros.
 * @returns {{evolutions: Object<string, Array<{method: string, parameter: *, target: string, variant: *}>>|null,
 *            diagnostics: Array<object>}} Each species' evolutions, or null when the table cannot be found.
 */
function parseEvolutionTable(text, macros)
{
    const { arrays, diagnostics } = readSourceArrays(text, macros);
    const table = requireArray(arrays, EVOLUTION_TABLE, diagnostics);
    if (table == null)
        return { evolutions: null, diagnostics };

    // Each species lists up to EVOS_PER_MON {method, parameter, target, variant} entries
    const evolutions = {};
    let unreadable = 0;
    for (const [species, valueNode] of readDesignatedEntries(table, EVOLUTION_TABLE, diagnostics))
    {
        const entries = valueNode?.kind() === KIND_INITIALIZER_LIST ? getElements(valueNode) : [];
        evolutions[species] = [];
        for (const entry of entries)
        {
            const values = entry.kind() === KIND_INITIALIZER_LIST ? getElements(entry) : [];
            if (values.length !== EVOLUTION_FIELD_COUNT || values[0].kind() !== KIND_IDENTIFIER || values[2].kind() !== KIND_IDENTIFIER)
            {
                unreadable++;
                continue;
            }

            evolutions[species].push({ method: values[0].text(), parameter: readEvolutionValue(values[1]), target: values[2].text(), variant: readEvolutionValue(values[3]) });
        }
    }

    if (unreadable > 0)
        diagnostics.push({ severity: SEVERITY_WARNING, code: "EVOLUTION_UNREADABLE", message: `${unreadable} evolutions in ${EVOLUTION_TABLE} are not written as {EVO_METHOD, parameter, SPECIES_TARGET, value}, so they were skipped.` });

    return { evolutions, diagnostics };
}
module.exports.parseEvolutionTable = parseEvolutionTable;

/**
 * Parses the doubles team types a spread's specificTeamType can name, from CFRU's frontier.h.
 *
 * @param {string} text The frontier.h text.
 * @param {Map<string, object>} macros The configuration macros.
 * @returns {{teamTypes: Array<{name: string, value: number|null}>|null, diagnostics: Array<object>}} The team
 *          types in order with their values, or null when the enum cannot be found, and diagnostics.
 */
function parseTeamTypes(text, macros)
{
    // Headers use macros such as unusedArg that do not parse, which does not affect the enum
    const { root, preprocessed } = parseActiveSource(text, macros);
    const diagnostics = [...preprocessed.diagnostics];
    const list = root.findAll({ rule: { kind: KIND_ENUMERATOR_LIST } })
        .find((node) => node.children().some((child) => child.kind() === KIND_ENUMERATOR && child.field("name")?.text() === TEAM_TYPE_ANY));
    if (list == null)
    {
        diagnostics.push({ severity: SEVERITY_WARNING, code: "TEAM_TYPES_NOT_FOUND", message: `Could not find the enum starting with ${TEAM_TYPE_ANY}, so doubles team types cannot be changed.` });
        return { teamTypes: null, diagnostics };
    }

    // Members count up from the previous value, and a value the editor cannot read makes the rest unknown
    const teamTypes = [];
    let next = 0;
    for (const enumerator of list.children().filter((node) => node.kind() === KIND_ENUMERATOR))
    {
        const valueNode = enumerator.field("value");
        const value = valueNode != null ? readSignedInteger(valueNode) : next;
        teamTypes.push({ name: enumerator.field("name").text(), value });
        next = value == null ? null : value + 1;
    }

    return { teamTypes, diagnostics };
}
module.exports.parseTeamTypes = parseTeamTypes;

/**
 * Parses CFRU's gItemsByType table, which tells item kinds such as Z-Crystals and Mega Stones apart.
 *
 * @param {string} text The item_tables.c text.
 * @param {Map<string, object>} macros The configuration macros.
 * @returns {{itemTypes: Object<string, string>|null, diagnostics: Array<object>}} Each listed item's ITEM_TYPE_*
 *          constant, or null when the table cannot be found, and diagnostics.
 */
function parseItemTypes(text, macros)
{
    const { arrays, diagnostics } = readSourceArrays(text, macros);
    const table = requireArray(arrays, ITEM_TYPES_TABLE, diagnostics);
    if (table == null)
        return { itemTypes: null, diagnostics };

    const itemTypes = {};
    let unreadable = 0;
    for (const [item, valueNode] of readDesignatedEntries(table, ITEM_TYPES_TABLE, diagnostics))
    {
        if (valueNode?.kind() === KIND_IDENTIFIER)
            itemTypes[item] = valueNode.text();
        else
            unreadable++;
    }

    if (unreadable > 0)
        diagnostics.push({ severity: SEVERITY_WARNING, code: "ITEM_TYPE_UNREADABLE", message: `${unreadable} items in ${ITEM_TYPES_TABLE} are not given an ITEM_TYPE_* constant, so their kind is unknown.` });

    return { itemTypes, diagnostics };
}
module.exports.parseItemTypes = parseItemTypes;

/**
 * Parses one of DPE's species graphics tables, such as gMonFrontPicTable, whose entries start with the
 * graphic's symbol.
 *
 * @param {string} text The table's source text.
 * @param {Map<string, object>} macros DPE's configuration macros.
 * @param {string} name The array name.
 * @returns {{symbols: Object<string, string>|null, diagnostics: Array<object>}} Each species' graphic symbol, or
 *          null when the table cannot be found, and diagnostics.
 */
function parseSpriteTable(text, macros, name)
{
    const { arrays, diagnostics } = readSourceArrays(text, macros);
    const table = requireArray(arrays, name, diagnostics);
    if (table == null)
        return { symbols: null, diagnostics };

    const symbols = {};
    let unreadable = 0;
    for (const [species, valueNode] of readDesignatedEntries(table, name, diagnostics))
    {
        const first = valueNode?.kind() === KIND_INITIALIZER_LIST ? getElements(valueNode)[0] : null;
        if (first?.kind() === KIND_IDENTIFIER)
            symbols[species] = first.text();
        else
            unreadable++;
    }

    if (unreadable > 0)
        diagnostics.push({ severity: SEVERITY_WARNING, code: "SPRITE_ENTRY_UNREADABLE", message: `${unreadable} species in ${name} do not start with a graphic's name, so they have no sprite.` });

    return { symbols, diagnostics };
}
module.exports.parseSpriteTable = parseSpriteTable;
