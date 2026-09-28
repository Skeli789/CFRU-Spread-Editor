/**
 * Parses CFRU battle facility spread arrays and the trainer tables that point to them.
 * Only the text the compiler would see is parsed, and every entry keeps the source spans the
 * writer needs to change a single value without disturbing anything around it.
 */

const { parse, registerDynamicLanguage } = require("@ast-grep/napi");

const { evaluatePreprocessor, findRange } = require("./preprocessor");

const LANGUAGE_C = "c";
registerDynamicLanguage({ [LANGUAGE_C]: require("@ast-grep/lang-c") });

const SPREAD_STRUCT = "BattleTowerSpread";
const SPECIAL_TRAINER_STRUCT = "SpecialBattleFrontierTrainer";
const MULTI_TRAINER_STRUCT = "MultiBattleTowerTrainer";
const RAID_TRAINER_STRUCT = "MultiRaidTrainer";
const MAX_MOVES = 4;
module.exports.MAX_MOVES = MAX_MOVES;
const MOVE_NONE = "MOVE_NONE";
module.exports.MOVE_NONE = MOVE_NONE;
const BYTE_ORDER_MARK = "\uFEFF";

const KIND_DECLARATION = "declaration";
const KIND_INIT_DECLARATOR = "init_declarator";
const KIND_ARRAY_DECLARATOR = "array_declarator";
const KIND_STRUCT_SPECIFIER = "struct_specifier";
const KIND_TYPE_IDENTIFIER = "type_identifier";
const KIND_STORAGE_CLASS = "storage_class_specifier";
const KIND_INITIALIZER_LIST = "initializer_list";
const KIND_INITIALIZER_PAIR = "initializer_pair";
const KIND_FIELD_DESIGNATOR = "field_designator";
const KIND_SUBSCRIPT_DESIGNATOR = "subscript_designator";
const KIND_SUBSCRIPT_RANGE_DESIGNATOR = "subscript_range_designator";
const KIND_FIELD_IDENTIFIER = "field_identifier";
const KIND_IDENTIFIER = "identifier";
const KIND_NUMBER = "number_literal";
const KIND_TRUE = "true";
const KIND_FALSE = "false";
const KIND_NULL = "null";
const KIND_COMMENT = "comment";
const KIND_ERROR = "ERROR";
const TOKEN_COMMA = ",";
const TOKEN_OPEN_BRACE = "{";
const TOKEN_CLOSE_BRACE = "}";

const SEVERITY_ERROR = "error";
const SEVERITY_WARNING = "warning";

const FIELD_KIND_SYMBOL = "symbol";
const FIELD_KIND_NUMBER = "number";
const FIELD_KIND_BOOLEAN = "boolean";
const FIELD_KIND_ABILITY = "ability";
const FIELD_KIND_MOVES = "moves";
module.exports.FIELD_KIND_SYMBOL = FIELD_KIND_SYMBOL;
module.exports.FIELD_KIND_NUMBER = FIELD_KIND_NUMBER;
module.exports.FIELD_KIND_BOOLEAN = FIELD_KIND_BOOLEAN;
module.exports.FIELD_KIND_ABILITY = FIELD_KIND_ABILITY;
module.exports.FIELD_KIND_MOVES = FIELD_KIND_MOVES;

// BattleTowerSpread fields in the order new source text writes them
const SPREAD_FIELDS =
[
    { name: "species", kind: FIELD_KIND_SYMBOL, prefix: "SPECIES_" },
    { name: "nature", kind: FIELD_KIND_SYMBOL, prefix: "NATURE_" },
    { name: "hpIv", kind: FIELD_KIND_NUMBER, max: 31 },
    { name: "atkIv", kind: FIELD_KIND_NUMBER, max: 31 },
    { name: "defIv", kind: FIELD_KIND_NUMBER, max: 31 },
    { name: "spAtkIv", kind: FIELD_KIND_NUMBER, max: 31 },
    { name: "spDefIv", kind: FIELD_KIND_NUMBER, max: 31 },
    { name: "spdIv", kind: FIELD_KIND_NUMBER, max: 31 },
    { name: "hpEv", kind: FIELD_KIND_NUMBER, max: 252 },
    { name: "atkEv", kind: FIELD_KIND_NUMBER, max: 252 },
    { name: "defEv", kind: FIELD_KIND_NUMBER, max: 252 },
    { name: "spAtkEv", kind: FIELD_KIND_NUMBER, max: 252 },
    { name: "spDefEv", kind: FIELD_KIND_NUMBER, max: 252 },
    { name: "spdEv", kind: FIELD_KIND_NUMBER, max: 252 },
    { name: "ability", kind: FIELD_KIND_ABILITY },
    { name: "item", kind: FIELD_KIND_SYMBOL, prefix: "ITEM_" },
    { name: "moves", kind: FIELD_KIND_MOVES, prefix: "MOVE_" },
    { name: "ball", kind: FIELD_KIND_SYMBOL, prefix: "BALL_TYPE_" },
    { name: "shiny", kind: FIELD_KIND_BOOLEAN },
    { name: "forSingles", kind: FIELD_KIND_BOOLEAN },
    { name: "forDoubles", kind: FIELD_KIND_BOOLEAN },
    { name: "modifyMovesDoubles", kind: FIELD_KIND_BOOLEAN },
    { name: "gigantamax", kind: FIELD_KIND_BOOLEAN },
    { name: "specificTeamType", kind: FIELD_KIND_SYMBOL, prefix: "" },
];
module.exports.SPREAD_FIELDS = SPREAD_FIELDS;
const SPREAD_FIELDS_BY_NAME = new Map(SPREAD_FIELDS.map((field) => [field.name, field]));
module.exports.SPREAD_FIELDS_BY_NAME = SPREAD_FIELDS_BY_NAME;

const ABILITY_SYMBOLS = ["FRONTIER_ABILITY_HIDDEN", "FRONTIER_ABILITY_1", "FRONTIER_ABILITY_2"];
module.exports.ABILITY_SYMBOLS = ABILITY_SYMBOLS;
const BOOLEAN_SYMBOLS = { TRUE: true, FALSE: false, [KIND_TRUE]: true, [KIND_FALSE]: false };
const ABILITY_COMMENT_PATTERN = /^\/\/\s*(ABILITY_\w+)\s*$/;
const TYPE_COMMENT_PATTERN = /^\/\/\s*(TYPE_\w+)\s*$/;
module.exports.ABILITY_COMMENT_PATTERN = ABILITY_COMMENT_PATTERN;
module.exports.TYPE_COMMENT_PATTERN = TYPE_COMMENT_PATTERN;
const INTEGER_PATTERN = /^(0[xX][0-9a-fA-F]+|[0-9]+)[uUlL]*$/;
const SIZE_REFERENCE_PATTERN = /^(?:NELEMS|ARRAY_COUNT)\s*\(\s*([A-Za-z_]\w*)\s*\)$/;
const TRAINER_NAME_PREFIX = "sTrainerName_";

// Trainer table fields that point to spread arrays, with the field holding each array's size
const TRAINER_SPREAD_ROLES =
[
    { role: "regular", pointer: "regularSpreads", size: "regSpreadSize" },
    { role: "middleCup", pointer: "middleCupSpreads", size: "mcSpreadSize" },
    { role: "littleCup", pointer: "littleCupSpreads", size: "lcSpreadSize" },
    { role: "legendary", pointer: "legendarySpreads", size: "legSpreadSize" },
];
const ROLE_LITTLE_CUP = "littleCup";
module.exports.ROLE_LITTLE_CUP = ROLE_LITTLE_CUP;
const RAID_POINTER_FIELD = "spreads";
const RAID_SIZE_FIELD = "spreadSizes";
const RAID_RANKS = { ONE_STAR_RAID: 1, TWO_STAR_RAID: 2, THREE_STAR_RAID: 3, FOUR_STAR_RAID: 4, FIVE_STAR_RAID: 5, SIX_STAR_RAID: 6 };

const TRAINER_TABLE_KINDS =
{
    [SPECIAL_TRAINER_STRUCT]: "specialTrainer",
    [MULTI_TRAINER_STRUCT]: "multiPartner",
    [RAID_TRAINER_STRUCT]: "raidPartner",
};


/**
 * Returns the one-based line of a node.
 *
 * @param {object} node The syntax node.
 * @returns {number} The line.
 */
function getLine(node)
{
    return node.range().start.line + 1;
}

/**
 * Returns a node's start and end offsets, excluding the carriage return tree-sitter keeps in line comments.
 *
 * @param {object} node The syntax node.
 * @returns {{start: number, end: number}} The span.
 */
function getSpan(node)
{
    const range = node.range();
    const trailingReturn = node.kind() === KIND_COMMENT && node.text().endsWith("\r") ? 1 : 0;
    return { start: range.start.index, end: range.end.index - trailingReturn };
}

/**
 * Parses a C integer literal.
 *
 * @param {string} text The literal.
 * @returns {number|null} The value, or null for other literals.
 */
function parseInteger(text)
{
    const match = INTEGER_PATTERN.exec(text);
    if (match == null)
        return null;

    // C treats a leading zero as octal
    const digits = match[1];
    if (/^0[0-7]+$/.test(digits))
        return parseInt(digits, 8);
    if (/^0\d+$/.test(digits))
        return null;

    return Number(digits);
}

/**
 * Returns the comment that follows a node on the same line, if any.
 *
 * @param {Array<object>} siblings The node's siblings.
 * @param {number} index The index after the node and its comma.
 * @param {number} line The zero-based line the node ends on.
 * @returns {object|null} The comment node.
 */
function findTrailingComment(siblings, index, line)
{
    const next = siblings[index];
    if (next != null && next.kind() === KIND_COMMENT && next.range().start.line === line)
        return next;

    return null;
}

/**
 * Returns the whitespace before a node when the node is the first thing on its line.
 *
 * @param {string} text The source text.
 * @param {number} offset The node's start.
 * @returns {string|null} The indentation, or null when other text precedes the node.
 */
function getIndentation(text, offset)
{
    const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
    const prefix = text.slice(lineStart, offset);
    return /^[ \t]*$/.test(prefix) ? prefix : null;
}
module.exports.getIndentation = getIndentation;

/**
 * Reads the elements of a moves initializer list.
 *
 * @param {object} listNode The initializer list.
 * @param {Array<object>} diagnostics Diagnostics to append to.
 * @returns {{elements: Array<object>, supported: boolean}} Each element's value and spans.
 */
function readMoveElements(listNode, diagnostics)
{
    const children = listNode.children();
    const elements = [];
    let supported = true;

    for (let index = 0; index < children.length; index++)
    {
        const child = children[index];
        const kind = child.kind();
        if (kind === TOKEN_OPEN_BRACE || kind === TOKEN_CLOSE_BRACE || kind === TOKEN_COMMA || kind === KIND_COMMENT)
            continue;

        // Each move must be a constant name or a plain number, where MOVE_NONE is the empty slot 0
        let value = null;
        if (kind === KIND_IDENTIFIER)
            value = child.text() === MOVE_NONE ? 0 : child.text();
        else if (kind === KIND_NUMBER)
            value = parseInteger(child.text());

        if (value == null)
        {
            supported = false;
            diagnostics.push({ severity: SEVERITY_WARNING, code: "UNSUPPORTED_INITIALIZER", message: `Line ${getLine(child)}: this move is not a plain constant.`, line: getLine(child) });
        }

        // Keep the comma and any same-line comment, which may name a Hidden Power type
        const span = getSpan(child);
        let next = index + 1;
        const commaEnd = children[next]?.kind() === TOKEN_COMMA ? getSpan(children[next++]).end : null;
        const commentNode = findTrailingComment(children, next, child.range().end.line);
        const comment = commentNode != null ? { ...getSpan(commentNode), text: commentNode.text().replace(/\r$/, "") } : null;

        elements.push({ value, start: span.start, end: span.end, commaEnd, comment });
    }

    if (elements.length > MAX_MOVES)
    {
        supported = false;
        diagnostics.push({ severity: SEVERITY_ERROR, code: "TOO_MANY_MOVES", message: `Line ${getLine(listNode)}: a spread can have at most ${MAX_MOVES} moves.`, line: getLine(listNode) });
    }

    return { elements, supported };
}

/**
 * Converts a field's value node into its meaning, where omitted fields are zero as in C.
 *
 * @param {object} field The field definition.
 * @param {object} valueNode The value syntax node.
 * @returns {*} The value, or undefined if it is not a supported literal.
 */
function readFieldValue(field, valueNode)
{
    const kind = valueNode.kind();
    const text = valueNode.text();

    switch (field.kind)
    {
        case FIELD_KIND_NUMBER:
            return kind === KIND_NUMBER ? parseInteger(text) ?? undefined : undefined;
        case FIELD_KIND_BOOLEAN:
            if (kind === KIND_NUMBER && (text === "0" || text === "1"))
                return text === "1";
            return Object.hasOwn(BOOLEAN_SYMBOLS, text) && (kind === KIND_IDENTIFIER || kind === KIND_TRUE || kind === KIND_FALSE)
                ? BOOLEAN_SYMBOLS[text] : undefined;
        case FIELD_KIND_ABILITY:
            if (kind === KIND_IDENTIFIER && ABILITY_SYMBOLS.includes(text))
                return ABILITY_SYMBOLS.indexOf(text);
            return kind === KIND_NUMBER && parseInteger(text) != null && parseInteger(text) < ABILITY_SYMBOLS.length ? parseInteger(text) : undefined;
        default:
            if (kind === KIND_IDENTIFIER)
                return text;
            return kind === KIND_NUMBER ? parseInteger(text) ?? undefined : undefined;
    }
}

/**
 * Returns the value a spread field has when it is left out of the initializer.
 *
 * @param {object} field The field definition.
 * @returns {*} The zero value.
 */
function getOmittedValue(field)
{
    if (field.kind === FIELD_KIND_BOOLEAN)
        return false;
    if (field.kind === FIELD_KIND_MOVES)
        return new Array(MAX_MOVES).fill(0);

    return 0;
}
module.exports.getOmittedValue = getOmittedValue;

/**
 * Reads one spread entry.
 *
 * @param {object} entryNode The entry's initializer list.
 * @param {string} text The source text.
 * @returns {object} The entry model.
 */
function parseSpreadEntry(entryNode, text)
{
    const children = entryNode.children();
    const diagnostics = [];
    const fields = Object.fromEntries(SPREAD_FIELDS.map((field) => [field.name, getOmittedValue(field)]));
    const pairs = {};
    const rawFields = {};
    const unknownFields = [];
    let editable = true;
    let abilityComment = null;
    let hiddenPowerComments = new Array(MAX_MOVES).fill(null);

    const unsupported = (node, message) =>
    {
        editable = false;
        diagnostics.push({ severity: SEVERITY_WARNING, code: "UNSUPPORTED_INITIALIZER", message: `Line ${getLine(node)}: ${message}`, line: getLine(node) });
    };

    for (let index = 0; index < children.length; index++)
    {
        const child = children[index];
        const kind = child.kind();
        if (kind === TOKEN_OPEN_BRACE || kind === TOKEN_CLOSE_BRACE || kind === TOKEN_COMMA || kind === KIND_COMMENT)
            continue;

        // Fields must be written as .name = value
        const designators = child.children().filter((node) => node.kind().endsWith("designator"));
        const designator = designators[0];
        if (kind !== KIND_INITIALIZER_PAIR || designators.length !== 1 || designator.kind() !== KIND_FIELD_DESIGNATOR)
        {
            unsupported(child, "this entry has a value that is not written as .field = value.");
            continue;
        }

        const name = designator.children().find((node) => node.kind() === KIND_FIELD_IDENTIFIER)?.text();
        const valueNode = child.field("value");
        const span = getSpan(child);
        const valueSpan = getSpan(valueNode);

        // Keep the comma and any same-line comment with the field
        let next = index + 1;
        const commaEnd = children[next]?.kind() === TOKEN_COMMA ? getSpan(children[next++]).end : null;
        const commentNode = findTrailingComment(children, next, child.range().end.line);
        const comment = commentNode != null ? { ...getSpan(commentNode), text: commentNode.text().replace(/\r$/, "") } : null;

        // A field given twice uses its last value in C, which the editor cannot keep safely
        if (Object.hasOwn(pairs, name) || unknownFields.some((field) => field.name === name))
        {
            unsupported(child, `.${name} is set more than once.`);
            continue;
        }

        // Fields the editor does not know are preserved exactly as written
        const field = SPREAD_FIELDS_BY_NAME.get(name);
        if (field == null)
        {
            unknownFields.push({ name, expression: valueNode.text() });
            continue;
        }

        const pair = { start: span.start, end: span.end, valueStart: valueSpan.start, valueEnd: valueSpan.end, commaEnd, comment, indentation: getIndentation(text, span.start) };
        pairs[name] = pair;

        // Moves are a nested list of up to four constants
        if (field.kind === FIELD_KIND_MOVES)
        {
            if (valueNode.kind() !== KIND_INITIALIZER_LIST)
            {
                rawFields[name] = valueNode.text();
                unsupported(child, ".moves is not a list of moves.");
                continue;
            }

            const moves = readMoveElements(valueNode, diagnostics);
            pair.moves = moves.elements;
            if (!moves.supported)
            {
                editable = false;
                rawFields[name] = valueNode.text();
                continue;
            }

            fields.moves = [...moves.elements.map((element) => element.value), ...new Array(MAX_MOVES).fill(0)].slice(0, MAX_MOVES);
            hiddenPowerComments = fields.moves.map((_, slot) => TYPE_COMMENT_PATTERN.exec(moves.elements[slot]?.comment?.text ?? "")?.[1] ?? null);
            continue;
        }

        // Other fields are single constants or numbers
        const value = readFieldValue(field, valueNode);
        if (value === undefined)
        {
            rawFields[name] = valueNode.text();
            unsupported(child, `.${name} = ${valueNode.text()} is not a value the editor can change.`);
            continue;
        }

        fields[name] = value;
        if (name === "ability" && comment != null)
            abilityComment = ABILITY_COMMENT_PATTERN.exec(comment.text)?.[1] ?? null;
    }

    const span = getSpan(entryNode);
    return {
        start: span.start,
        end: span.end,
        line: getLine(entryNode),
        indentation: getIndentation(text, span.start),
        fields,
        explicitFields: SPREAD_FIELDS.map((field) => field.name).filter((name) => Object.hasOwn(pairs, name)),
        pairs,
        rawFields,
        unknownFields,
        abilityComment,
        hiddenPowerComments,
        editable,
        diagnostics,
    };
}
module.exports.parseSpreadEntry = parseSpreadEntry;

/**
 * Returns whether an entry is an empty {} placeholder that only exists so an array is not empty.
 *
 * @param {object} entryNode The entry's initializer list.
 * @returns {boolean} Whether it is a placeholder.
 */
function isPlaceholder(entryNode)
{
    return entryNode.children().every((child) => [TOKEN_OPEN_BRACE, TOKEN_CLOSE_BRACE, KIND_COMMENT].includes(child.kind()));
}

/**
 * Returns the array declarations of a struct type in a parsed file.
 *
 * @param {object} root The translation unit.
 * @param {string} structName The struct type.
 * @returns {Array<{declaration: object, name: string, sizeNode: object|null, listNode: object|null, isStatic: boolean}>}
 *          The declarations in source order.
 */
function findStructArrays(root, structName)
{
    const arrays = [];

    for (const declaration of root.children().filter((node) => node.kind() === KIND_DECLARATION))
    {
        // Match the struct type
        const struct = declaration.children().find((node) => node.kind() === KIND_STRUCT_SPECIFIER);
        const typeName = struct?.children().find((node) => node.kind() === KIND_TYPE_IDENTIFIER)?.text();
        if (typeName !== structName)
            continue;

        const isStatic = declaration.children().some((node) => node.kind() === KIND_STORAGE_CLASS && node.text() === "static");

        // Each initialized array declarator is one table
        for (const declarator of declaration.children().filter((node) => node.kind() === KIND_INIT_DECLARATOR))
        {
            const arrayNode = declarator.field("declarator");
            const listNode = declarator.field("value");
            if (arrayNode?.kind() !== KIND_ARRAY_DECLARATOR)
                continue;

            const name = arrayNode.field("declarator")?.text();
            arrays.push({ declaration, name, sizeNode: arrayNode.field("size"), listNode: listNode?.kind() === KIND_INITIALIZER_LIST ? listNode : null, isStatic });
        }
    }

    return arrays;
}

/**
 * Prepares a file for parsing: evaluates its directives and parses the text the compiler would see.
 *
 * @param {string} text The source text.
 * @param {Map<string, object>} macros Macros defined before the file.
 * @returns {{root: object, preprocessed: object, diagnostics: Array<object>, syntaxErrors: boolean}} The syntax tree and preprocessing results.
 */
function parseActiveSource(text, macros)
{
    // The byte order mark is masked like inactive text so positions stay the same
    const preprocessed = evaluatePreprocessor(text, macros);
    let parsedText = preprocessed.maskedText;
    if (parsedText.startsWith(BYTE_ORDER_MARK))
        parsedText = " " + parsedText.slice(1);

    const root = parse(LANGUAGE_C, parsedText).root();
    const diagnostics = [...preprocessed.diagnostics];
    const errors = root.findAll({ rule: { kind: KIND_ERROR } });
    for (const error of errors.slice(0, 5))
        diagnostics.push({ severity: SEVERITY_ERROR, code: "SYNTAX_ERROR", message: `Line ${getLine(error)}: the editor could not read this part of the file.`, line: getLine(error) });

    return { root, preprocessed, diagnostics, syntaxErrors: errors.length > 0 };
}

/**
 * Parses the spread arrays in a CFRU spread file.
 *
 * @param {string} text The file text.
 * @param {Map<string, object>} macros Macros defined before the file, such as those from config.h.
 * @returns {{sets: Array<object>, diagnostics: Array<object>, editable: boolean, macros: Map<string, object>}}
 *          The active spread arrays, diagnostics, whether the file can be changed safely and the macros after it.
 */
function parseSpreadFile(text, macros)
{
    const { root, preprocessed, diagnostics, syntaxErrors } = parseActiveSource(text, macros);
    const sets = [];
    const occurrences = new Map();

    for (const { declaration, name, sizeNode, listNode, isStatic } of findStructArrays(root, SPREAD_STRUCT))
    {
        // Only active arrays are parsed, so a second active array with the same name is a real duplicate
        const occurrence = (occurrences.get(name) ?? 0) + 1;
        occurrences.set(name, occurrence);
        const setDiagnostics = [];
        if (occurrence > 1)
            setDiagnostics.push({ severity: SEVERITY_ERROR, code: "DUPLICATE_ARRAY", message: `${name} is defined more than once.`, line: getLine(declaration) });

        const declarationSpan = getSpan(declaration);
        const set =
        {
            name,
            occurrence,
            line: getLine(declaration),
            start: declarationSpan.start,
            end: declarationSpan.end,
            isStatic,
            fixedSize: sizeNode?.text() ?? null,
            branch: findRange(preprocessed.ranges, declarationSpan.start)?.branch ?? [],
            listStart: null,
            listEnd: null,
            entries: [],
            placeholders: [],
            structureEditable: listNode != null,
            diagnostics: setDiagnostics,
        };
        sets.push(set);

        if (listNode == null)
        {
            setDiagnostics.push({ severity: SEVERITY_WARNING, code: "UNSUPPORTED_INITIALIZER", message: `${name} is not initialized with a list.`, line: set.line });
            continue;
        }

        const listSpan = getSpan(listNode);
        set.listStart = listSpan.start;
        set.listEnd = listSpan.end;

        // Directives inside the list separate entries that must not be reordered past each other
        const barriers = preprocessed.directives.filter((directive) => directive.start > listSpan.start && directive.start < listSpan.end).map((directive) => directive.start);
        const getSegment = (offset) => barriers.filter((barrier) => barrier < offset).length;

        const listChildren = listNode.children();
        for (let index = 0; index < listChildren.length; index++)
        {
            const child = listChildren[index];
            const kind = child.kind();
            if (kind === TOKEN_OPEN_BRACE || kind === TOKEN_CLOSE_BRACE || kind === TOKEN_COMMA || kind === KIND_COMMENT)
                continue;

            // Anything other than a braced entry cannot be moved or counted safely
            if (kind !== KIND_INITIALIZER_LIST)
            {
                set.structureEditable = false;
                setDiagnostics.push({ severity: SEVERITY_WARNING, code: "UNSUPPORTED_INITIALIZER", message: `Line ${getLine(child)}: ${name} contains something other than a spread.`, line: getLine(child) });
                continue;
            }

            // New entries are inserted after an entry's comma
            const span = getSpan(child);
            const segment = getSegment(span.start);
            const commaEnd = listChildren[index + 1]?.kind() === TOKEN_COMMA ? getSpan(listChildren[index + 1]).end : null;
            if (isPlaceholder(child))
            {
                set.placeholders.push({ ...span, commaEnd, segment, indentation: getIndentation(text, span.start) });
                continue;
            }

            const entry = parseSpreadEntry(child, text);
            entry.segment = segment;
            entry.commaEnd = commaEnd;
            set.entries.push(entry);
        }
    }

    return { sets, diagnostics, editable: !preprocessed.unresolved && !syntaxErrors, macros: preprocessed.macros };
}
module.exports.parseSpreadFile = parseSpreadFile;

/**
 * Reads the .field = value pairs of a trainer entry.
 *
 * @param {object} entryNode The trainer's initializer list.
 * @returns {Map<string, object>} Field names to value nodes.
 */
function readTrainerFields(entryNode)
{
    const fields = new Map();

    for (const pair of entryNode.children().filter((node) => node.kind() === KIND_INITIALIZER_PAIR))
    {
        const designator = pair.children().find((node) => node.kind() === KIND_FIELD_DESIGNATOR);
        const name = designator?.children().find((node) => node.kind() === KIND_FIELD_IDENTIFIER)?.text();
        if (name != null)
            fields.set(name, pair.field("value"));
    }

    return fields;
}

/**
 * Returns the raid ranks named by a designator such as [ONE_STAR_RAID ... TWO_STAR_RAID].
 *
 * @param {object} designator The subscript designator.
 * @returns {Array<number>|null} The ranks, or null if they cannot be read.
 */
function readRaidRanks(designator)
{
    const bounds = designator.children().filter((node) => node.kind() === KIND_IDENTIFIER || node.kind() === KIND_NUMBER).map((node) => node.text());
    const values = bounds.map((bound) => RAID_RANKS[bound] ?? (parseInteger(bound) != null ? parseInteger(bound) + 1 : null));
    if (values.length === 0 || values.includes(null))
        return null;

    const [first, last = first] = values;
    return Array.from({ length: Math.max(0, last - first + 1) }, (_, offset) => first + offset);
}

/**
 * Reads a raid partner's per-rank spread pointers or sizes.
 *
 * @param {object|undefined} listNode The .spreads or .spreadSizes list.
 * @returns {Array<{designator: string, ranks: Array<number>|null, value: string}>} Each designated value.
 */
function readRaidRankValues(listNode)
{
    if (listNode?.kind() !== KIND_INITIALIZER_LIST)
        return [];

    return listNode.children().filter((node) => node.kind() === KIND_INITIALIZER_PAIR).map((pair) =>
    {
        const designator = pair.children().find((node) => node.kind() === KIND_SUBSCRIPT_DESIGNATOR || node.kind() === KIND_SUBSCRIPT_RANGE_DESIGNATOR);
        return { designator: designator?.text() ?? "", ranks: designator != null ? readRaidRanks(designator) : null, value: pair.field("value")?.text() ?? "" };
    });
}

/**
 * Returns a readable trainer name from a name symbol such as sTrainerName_Palmer.
 *
 * @param {object|undefined} nameNode The .name value.
 * @param {string} table The table name.
 * @param {number} index The trainer's index.
 * @returns {string} The display name.
 */
function getTrainerLabel(nameNode, table, index)
{
    const symbol = nameNode?.kind() === KIND_IDENTIFIER ? nameNode.text() : null;
    if (symbol != null)
        return symbol.startsWith(TRAINER_NAME_PREFIX) ? symbol.slice(TRAINER_NAME_PREFIX.length) : symbol;

    return `${table}[${index}]`;
}

/**
 * Parses the trainer tables in a file and the spread arrays each trainer uses.
 *
 * @param {string} text The file text.
 * @param {Map<string, object>} macros Macros defined before the file.
 * @returns {{trainers: Array<object>, diagnostics: Array<object>}} Trainers in table order and diagnostics.
 */
function parseTrainerTables(text, macros)
{
    const { root, diagnostics } = parseActiveSource(text, macros);
    const trainers = [];

    for (const structName of Object.keys(TRAINER_TABLE_KINDS))
    {
        for (const { name: table, listNode } of findStructArrays(root, structName))
        {
            if (listNode == null)
                continue;

            // Entries are either positional or written as [index] = { ... }
            let position = 0;
            for (const child of listNode.children())
            {
                let entryNode = child;
                if (child.kind() === KIND_INITIALIZER_PAIR)
                {
                    const index = parseInteger(child.children().find((node) => node.kind() === KIND_SUBSCRIPT_DESIGNATOR)?.children().find((node) => node.kind() === KIND_NUMBER)?.text() ?? "");
                    entryNode = child.field("value");
                    if (index != null)
                        position = index;
                }
                if (entryNode?.kind() !== KIND_INITIALIZER_LIST)
                    continue;

                const fields = readTrainerFields(entryNode);
                const trainer =
                {
                    id: `${table}[${position}]`,
                    table,
                    index: position,
                    kind: TRAINER_TABLE_KINDS[structName],
                    name: getTrainerLabel(fields.get("name"), table, position),
                    line: getLine(entryNode),
                    links: [],
                };

                // Facility trainers point to one array per tier
                if (structName !== RAID_TRAINER_STRUCT)
                {
                    for (const { role, pointer, size } of TRAINER_SPREAD_ROLES)
                    {
                        const pointerNode = fields.get(pointer);
                        if (pointerNode?.kind() === KIND_IDENTIFIER)
                            trainer.links.push({ role, set: pointerNode.text(), sizeExpression: fields.get(size)?.text() ?? null });
                        else if (pointerNode != null && pointerNode.kind() !== KIND_NULL && pointerNode.text() !== "NULL")
                            diagnostics.push({ severity: SEVERITY_WARNING, code: "UNSUPPORTED_INITIALIZER", message: `Line ${getLine(pointerNode)}: ${trainer.name}'s ${pointer} is not a plain array name.`, line: getLine(pointerNode) });
                    }
                }
                else
                {
                    // Raid partners point to one array per range of raid ranks
                    const sizes = readRaidRankValues(fields.get(RAID_SIZE_FIELD));
                    for (const { designator, ranks, value } of readRaidRankValues(fields.get(RAID_POINTER_FIELD)))
                        trainer.links.push({ role: "raid", set: value, ranks, sizeExpression: sizes.find((size) => size.designator === designator)?.value ?? null });
                }

                trainers.push(trainer);
                position++;
            }
        }
    }

    return { trainers, diagnostics };
}
module.exports.parseTrainerTables = parseTrainerTables;

/**
 * Returns whether a trainer's size expression counts exactly the array it points to.
 *
 * @param {string|null} sizeExpression The size field's expression.
 * @param {string} setName The spread array.
 * @returns {boolean} Whether the size follows the array automatically.
 */
function isAutomaticSize(sizeExpression, setName)
{
    return sizeExpression == null || SIZE_REFERENCE_PATTERN.exec(sizeExpression.trim())?.[1] === setName;
}
module.exports.isAutomaticSize = isAutomaticSize;
