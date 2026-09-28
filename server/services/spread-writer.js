/**
 * Turns spread changes into minimal source edits.
 * Only the characters that express a changed value are replaced; comments, whitespace, line endings
 * and every unchanged entry stay exactly as they were.
 */

const { StatusCode } = require("status-code-enum");

const { ApiError } = require("../middleware/errors");
const { getHiddenPowerType } = require("../../shared/pokemon-mechanics.mjs");
const
{
    ABILITY_COMMENT_PATTERN, ABILITY_SYMBOLS, FIELD_KIND_ABILITY, FIELD_KIND_BOOLEAN, FIELD_KIND_MOVES, FIELD_KIND_NUMBER,
    MAX_MOVES, MOVE_NONE, SPREAD_FIELDS, SPREAD_FIELDS_BY_NAME, TYPE_COMMENT_PATTERN, getIndentation, getOmittedValue,
} = require("./spread-parser");

const MAX_EV_TOTAL = 510;
const MAX_SYMBOL_LENGTH = 80;
const MOVE_HIDDEN_POWER = "MOVE_HIDDENPOWER";
const SYMBOL_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const ABILITY_NAME_PATTERN = /^ABILITY_[A-Z0-9_]+$/;
const DEFAULT_INDENT_UNIT = "\t";
const IV_FIELDS = SPREAD_FIELDS.filter((field) => field.name.endsWith("Iv")).map((field) => field.name);
const EV_FIELDS = SPREAD_FIELDS.filter((field) => field.name.endsWith("Ev")).map((field) => field.name);
const TRUE_SYMBOL = "TRUE";
const FALSE_SYMBOL = "FALSE";

// Fields every new entry writes even when they are zero, matching how the existing spreads are written
const ALWAYS_WRITTEN_FIELDS = new Set(["species", "nature", ...IV_FIELDS, "ability", "item", "ball", "forSingles", "forDoubles", "modifyMovesDoubles"]);


/**
 * Throws a validation error for an operation.
 *
 * @param {string} message The description.
 * @param {object} [details] Extra details.
 */
function invalid(message, details)
{
    throw new ApiError(StatusCode.ClientErrorUnprocessableEntity, "INVALID_OPERATION", message, details);
}

/**
 * Checks and normalizes one submitted field value.
 *
 * @param {object} field The field definition.
 * @param {*} value The submitted value.
 * @returns {*} The normalized value.
 */
function normalizeFieldValue(field, value)
{
    switch (field.kind)
    {
        case FIELD_KIND_NUMBER:
            if (!Number.isInteger(value) || value < 0 || value > field.max)
                invalid(`${field.name} must be a whole number from 0 to ${field.max}.`);
            return value;
        case FIELD_KIND_BOOLEAN:
            if (typeof value !== "boolean")
                invalid(`${field.name} must be true or false.`);
            return value;
        case FIELD_KIND_ABILITY:
            if (!Number.isInteger(value) || value < 0 || value >= ABILITY_SYMBOLS.length)
                invalid("ability must be 0 (hidden), 1 or 2.");
            return value;
        case FIELD_KIND_MOVES:
            if (!Array.isArray(value) || value.length > MAX_MOVES)
                invalid(`moves must be a list of at most ${MAX_MOVES} moves.`);
            return [...value, ...new Array(MAX_MOVES).fill(0)].slice(0, MAX_MOVES).map((move) =>
            {
                if (move === 0 || move === null || move === MOVE_NONE)
                    return 0;
                return normalizeSymbol(field, move);
            });
        default:
            return value === 0 ? 0 : normalizeSymbol(field, value);
    }
}

/**
 * Checks that a value is a constant name with the field's prefix, so it cannot inject other source text.
 *
 * @param {object} field The field definition.
 * @param {*} value The submitted value.
 * @returns {string} The constant name.
 */
function normalizeSymbol(field, value)
{
    if (typeof value !== "string" || value.length > MAX_SYMBOL_LENGTH || !SYMBOL_PATTERN.test(value) || !value.startsWith(field.prefix) || value === field.prefix)
        invalid(`${field.name} must be a ${field.prefix || "constant"}* name.`);

    return value;
}

/**
 * Applies submitted field values to a spread's current values and checks the result.
 *
 * @param {*} input The submitted fields.
 * @param {object} baseFields The current values.
 * @returns {object} The complete new values.
 */
function mergeSpreadFields(input, baseFields)
{
    if (input === null || typeof input !== "object" || Array.isArray(input))
        invalid("fields must be an object.");

    // Every submitted field must be one the editor knows how to write
    const fields = { ...baseFields, moves: [...baseFields.moves] };
    for (const [name, value] of Object.entries(input))
    {
        const field = SPREAD_FIELDS_BY_NAME.get(name);
        if (field == null)
            invalid(`${name} is not a spread field the editor can change.`);

        fields[name] = normalizeFieldValue(field, value);
    }

    // The whole spread must be valid, including values that were not changed
    for (const name of [...IV_FIELDS, ...EV_FIELDS])
        normalizeFieldValue(SPREAD_FIELDS_BY_NAME.get(name), fields[name]);

    const evTotal = EV_FIELDS.reduce((total, name) => total + fields[name], 0);
    if (evTotal > MAX_EV_TOTAL)
        invalid(`The EVs add up to ${evTotal}, but at most ${MAX_EV_TOTAL} are allowed.`);

    return fields;
}
module.exports.mergeSpreadFields = mergeSpreadFields;

/**
 * Returns a new spread's values, starting from the values C gives omitted fields.
 *
 * @param {*} input The submitted fields.
 * @returns {object} The complete values.
 */
function createSpreadFields(input)
{
    const base = Object.fromEntries(SPREAD_FIELDS.map((field) => [field.name, getOmittedValue(field)]));
    const fields = mergeSpreadFields(input, base);
    if (typeof fields.species !== "string" || fields.species === "SPECIES_NONE")
        invalid("A new spread needs a species.");
    if (fields.moves.every((move) => move === 0))
        invalid("A new spread needs at least one move.");

    return fields;
}
module.exports.createSpreadFields = createSpreadFields;

/**
 * Returns whether two field values are the same.
 *
 * @param {*} a The first value.
 * @param {*} b The second value.
 * @returns {boolean} Whether they are equal.
 */
function isSameValue(a, b)
{
    if (Array.isArray(a) && Array.isArray(b))
        return a.length === b.length && a.every((value, index) => value === b[index]);

    return a === b;
}
module.exports.isSameValue = isSameValue;

/**
 * Returns the source text for a field value.
 *
 * @param {object} field The field definition.
 * @param {*} value The value.
 * @returns {string} The C expression.
 */
function formatValue(field, value)
{
    switch (field.kind)
    {
        case FIELD_KIND_BOOLEAN:
            return value ? TRUE_SYMBOL : FALSE_SYMBOL;
        case FIELD_KIND_ABILITY:
            return ABILITY_SYMBOLS[value];
        default:
            return String(value);
    }
}

/**
 * Returns the source text for a move slot.
 *
 * @param {string|number} move The move.
 * @returns {string} The C expression.
 */
function formatMove(move)
{
    return move === 0 ? MOVE_NONE : String(move);
}

/**
 * Returns the Hidden Power comment a move slot should have, or null.
 *
 * @param {object} fields The spread's values.
 * @param {number} slot The move slot.
 * @returns {string|null} The comment text.
 */
function getHiddenPowerComment(fields, slot)
{
    return fields.moves[slot] === MOVE_HIDDEN_POWER ? `//${getHiddenPowerType(fields)}` : null;
}

/**
 * Returns the offset just after a field or move's comma and same-line comment.
 *
 * @param {{end: number, commaEnd: number|null, comment: object|null}} item The field or move.
 * @returns {number} The offset.
 */
function getTail(item)
{
    return item.comment?.end ?? item.commaEnd ?? item.end;
}

/**
 * Applies non-overlapping edits to text.
 *
 * @param {string} text The text.
 * @param {Array<{start: number, end: number, text: string}>} edits The edits; inserts at the same place keep their order.
 * @param {number} [offset] An offset subtracted from every edit, for editing a slice.
 * @returns {string} The edited text.
 */
function applyEdits(text, edits, offset = 0)
{
    const ordered = edits.map((edit, index) => ({ ...edit, index })).sort((a, b) => a.start - b.start || a.end - b.end || a.index - b.index);
    let result = "";
    let cursor = 0;

    for (const edit of ordered)
    {
        const start = edit.start - offset;
        const end = edit.end - offset;
        if (start < cursor || end < start)
            throw new Error("Spread edits overlap.");

        result += text.slice(cursor, start) + edit.text;
        cursor = end;
    }

    return result + text.slice(cursor);
}
module.exports.applyEdits = applyEdits;

/**
 * Describes the indentation and line ending new text should use in a set.
 *
 * @param {string} text The file text.
 * @param {object} set The set model.
 * @param {string} lineEnding The file's line ending.
 * @returns {{lineEnding: string, entry: string, field: string, move: string}} The formatting.
 */
function getSetFormatting(text, set, lineEnding)
{
    // Copy the first entry's layout, falling back to one level of indentation per nesting
    const sample = set.entries[0];
    const entry = sample?.indentation ?? set.placeholders[0]?.indentation ?? DEFAULT_INDENT_UNIT;
    const firstPair = sample != null ? Object.values(sample.pairs).find((pair) => pair.indentation != null) : null;
    const field = firstPair?.indentation ?? entry + DEFAULT_INDENT_UNIT;
    const firstMove = sample?.pairs.moves?.moves?.[0];
    const move = (firstMove != null ? getIndentation(text, firstMove.start) : null) ?? field + DEFAULT_INDENT_UNIT;

    return { lineEnding, entry, field, move };
}

/**
 * Returns the source lines of a moves list for new text.
 *
 * @param {object} fields The spread's values.
 * @param {object} format The set formatting.
 * @param {number} [firstSlot] The first slot to write.
 * @returns {Array<string>} One line per move, without line endings.
 */
function renderMoveLines(fields, format, firstSlot = 0)
{
    const count = fields.moves.reduce((last, move, slot) => (move !== 0 ? slot + 1 : last), 0);
    const lines = [];

    for (let slot = firstSlot; slot < count; slot++)
    {
        const comment = getHiddenPowerComment(fields, slot);
        lines.push(`${format.move}${formatMove(fields.moves[slot])},${comment != null ? ` ${comment}` : ""}`);
    }

    return lines;
}

/**
 * Returns the source lines for a field that is not written yet.
 *
 * @param {object} field The field definition.
 * @param {object} fields The spread's values.
 * @param {string|null} abilityName The ability's constant, for its comment.
 * @param {object} format The set formatting.
 * @returns {Array<string>} The lines, without line endings.
 */
function renderFieldLines(field, fields, abilityName, format)
{
    if (field.kind === FIELD_KIND_MOVES)
        return [`${format.field}.moves =`, `${format.field}{`, ...renderMoveLines(fields, format), `${format.field}},`];

    const comment = field.kind === FIELD_KIND_ABILITY && abilityName != null ? ` //${abilityName}` : "";
    return [`${format.field}.${field.name} = ${formatValue(field, fields[field.name])},${comment}`];
}

/**
 * Returns the source text of a new spread entry, from its opening to its closing brace.
 *
 * @param {object} fields The spread's values.
 * @param {string|null} abilityName The ability's constant, for its comment.
 * @param {object} format The set formatting.
 * @returns {string} The entry text.
 */
function renderNewEntry(fields, abilityName, format)
{
    const lines = ["{"];

    for (const field of SPREAD_FIELDS)
    {
        const omitted = isSameValue(fields[field.name], getOmittedValue(field));
        if (!omitted || ALWAYS_WRITTEN_FIELDS.has(field.name))
            lines.push(...renderFieldLines(field, fields, abilityName, format));
    }

    lines.push(`${format.entry}}`);
    return lines.join(format.lineEnding);
}
module.exports.renderNewEntry = renderNewEntry;

/**
 * Builds the edits that change an existing entry's values in place.
 *
 * @param {string} text The file text.
 * @param {object} entry The entry model.
 * @param {object} fields The new values.
 * @param {string|null} abilityName The ability's constant, for an existing ability comment.
 * @param {object} format The set formatting.
 * @returns {Array<object>} The edits.
 */
function buildEntryEdits(text, entry, fields, abilityName, format)
{
    const edits = [];
    const changed = new Set(SPREAD_FIELDS.map((field) => field.name).filter((name) => !isSameValue(entry.fields[name], fields[name])));
    const pairs = Object.values(entry.pairs).sort((a, b) => a.start - b.start);

    // Fields that are already written have just their value replaced
    for (const field of SPREAD_FIELDS)
    {
        const pair = entry.pairs[field.name];
        if (!changed.has(field.name) || field.kind === FIELD_KIND_MOVES || pair == null)
            continue;

        edits.push({ start: pair.valueStart, end: pair.valueEnd, text: formatValue(field, fields[field.name]) });
    }

    // An ability comment names the ability, which changes with the slot or the species
    const abilityPair = entry.pairs.ability;
    const abilityComment = abilityPair?.comment != null ? ABILITY_COMMENT_PATTERN.exec(abilityPair.comment.text) : null;
    if (abilityComment != null && abilityName != null && abilityName !== abilityComment[1] && (changed.has("ability") || changed.has("species")))
        edits.push({ start: abilityPair.comment.start, end: abilityPair.comment.end, text: abilityPair.comment.text.replace(abilityComment[1], abilityName) });

    // Moves and Hidden Power comments are edited per slot
    const hiddenPowerAffected = changed.has("moves") || IV_FIELDS.some((name) => changed.has(name));
    if (entry.pairs.moves != null && hiddenPowerAffected)
        edits.push(...buildMoveEdits(text, entry, fields, format));

    // Fields that were left out are added after the field that comes before them
    for (const field of SPREAD_FIELDS)
    {
        if (!changed.has(field.name) || entry.pairs[field.name] != null)
            continue;

        const before = SPREAD_FIELDS.slice(0, SPREAD_FIELDS.indexOf(field)).reverse().map((other) => entry.pairs[other.name]).find((pair) => pair != null);
        const lines = renderFieldLines(field, fields, abilityName, { ...format, field: before?.indentation ?? pairs[0]?.indentation ?? format.field });
        if (before != null)
        {
            if (before.commaEnd == null)
                edits.push({ start: before.end, end: before.end, text: "," });
            edits.push({ start: getTail(before), end: getTail(before), text: format.lineEnding + lines.join(format.lineEnding) });
        }
        else if (pairs[0] != null && pairs[0].indentation != null)
        {
            const lineStart = pairs[0].start - pairs[0].indentation.length;
            edits.push({ start: lineStart, end: lineStart, text: lines.join(format.lineEnding) + format.lineEnding });
        }
        else
            edits.push({ start: entry.start + 1, end: entry.start + 1, text: format.lineEnding + lines.join(format.lineEnding) });
    }

    return edits;
}
module.exports.buildEntryEdits = buildEntryEdits;

/**
 * Builds the edits for an entry's moves list and Hidden Power comments.
 *
 * @param {string} text The file text.
 * @param {object} entry The entry model.
 * @param {object} fields The new values.
 * @param {object} format The set formatting.
 * @returns {Array<object>} The edits.
 */
function buildMoveEdits(text, entry, fields, format)
{
    const edits = [];
    const pair = entry.pairs.moves;
    const elements = pair.moves;
    const appended = renderMoveLines(fields, { ...format, move: (elements[0] != null ? getIndentation(text, elements[0].start) : null) ?? format.move }, elements.length);

    elements.forEach((element, slot) =>
    {
        const move = fields.moves[slot];
        const oldMove = entry.fields.moves[slot];
        if (move !== oldMove)
            edits.push({ start: element.start, end: element.end, text: formatMove(move) });

        // The last move needs a comma before more are added after it
        const isLast = slot === elements.length - 1;
        if (isLast && appended.length > 0 && element.commaEnd == null)
            edits.push({ start: element.end, end: element.end, text: "," });

        // Hidden Power keeps a //TYPE_* comment matching its IVs; other comments are left alone
        const wanted = getHiddenPowerComment(fields, slot);
        const typeComment = element.comment != null && TYPE_COMMENT_PATTERN.test(element.comment.text) ? element.comment : null;
        if (wanted != null && typeComment != null && typeComment.text !== wanted)
            edits.push({ start: typeComment.start, end: typeComment.end, text: typeComment.text.replace(/TYPE_\w+/, wanted.slice(2)) });
        else if (wanted != null && element.comment == null)
        {
            const position = element.commaEnd ?? element.end;
            edits.push({ start: position, end: position, text: ` ${wanted}` });
        }
        else if (wanted == null && typeComment != null && oldMove === MOVE_HIDDEN_POWER)
            edits.push({ start: element.commaEnd ?? element.end, end: typeComment.end, text: "" });
    });

    // Extra moves go on new lines after the last one
    if (appended.length > 0)
    {
        const last = elements[elements.length - 1];
        const position = last != null ? getTail(last) : pair.valueStart + 1;
        edits.push({ start: position, end: position, text: format.lineEnding + appended.join(format.lineEnding) });
    }

    return edits;
}

/**
 * Builds the edits for one spread set: changed values, new entries and a new order.
 *
 * @param {string} text The file text.
 * @param {object} set The set model.
 * @param {object} plan The set's changes.
 * @param {Map<object, {fields: object, abilityName: string|null}>} plan.updates New values of existing entries.
 * @param {Array<{key: string, after: object|null, fields: object, abilityName: string|null}>} plan.additions New entries, each after an existing entry or at the end.
 * @param {Array<object|string>|null} plan.order Entry models and addition keys in their new order, or null to keep the order.
 * @param {string} lineEnding The file's line ending.
 * @returns {{edits: Array<object>, order: Array<object|string>}} The edits and the resulting order.
 */
function buildSetEdits(text, set, { updates, additions, order }, lineEnding)
{
    const format = getSetFormatting(text, set, lineEnding);
    const additionsByKey = new Map(additions.map((addition) => [addition.key, addition]));

    // Lay out the slots: existing entries, with each new entry after its anchor
    const slots = set.entries.map((entry) => ({ item: entry, entry, segment: entry.segment }));
    const lastEntry = set.entries[set.entries.length - 1] ?? null;
    let placeholderSlot = null;
    for (const addition of additions)
    {
        const anchor = addition.after ?? lastEntry;
        if (anchor == null && placeholderSlot == null && set.placeholders.length > 0)
        {
            // An array holding only an empty {} placeholder has its placeholder replaced
            placeholderSlot = { item: addition.key, placeholder: set.placeholders[0], segment: set.placeholders[0].segment };
            slots.push(placeholderSlot);
            continue;
        }

        const anchorSlotIndex = anchor != null ? slots.findIndex((slot) => slot.entry === anchor) : slots.indexOf(placeholderSlot);
        let insertAt = anchorSlotIndex + 1;
        while (insertAt < slots.length && slots[insertAt].anchor === (anchor ?? placeholderSlot))
            insertAt++;
        slots.splice(insertAt, 0, { item: addition.key, anchor: anchor ?? placeholderSlot, segment: anchor?.segment ?? placeholderSlot?.segment ?? 0 });
    }

    // Check that a new order only rearranges these entries, without crossing preprocessor lines
    const finalOrder = order ?? slots.map((slot) => slot.item);
    const slotItems = new Set(slots.map((slot) => slot.item));
    if (finalOrder.length !== slots.length || new Set(finalOrder).size !== finalOrder.length || finalOrder.some((item) => !slotItems.has(item)))
        invalid(`The new order of ${set.name} must list each of its spreads exactly once.`);

    const segmentOf = new Map(slots.map((slot) => [slot.item, slot.segment]));
    if (finalOrder.some((item, index) => segmentOf.get(item) !== slots[index].segment))
        invalid(`Spreads in ${set.name} cannot be moved past a preprocessor directive.`);

    // Renders an entry's complete text, applying its changes
    const renderItem = (item) =>
    {
        if (typeof item === "string")
        {
            const addition = additionsByKey.get(item);
            return renderNewEntry(addition.fields, addition.abilityName, format);
        }

        const update = updates.get(item);
        const entryText = text.slice(item.start, item.end);
        return update == null ? entryText : applyEdits(entryText, buildEntryEdits(text, item, update.fields, update.abilityName, format), item.start);
    };

    const edits = [];
    const insertions = new Map();
    slots.forEach((slot, index) =>
    {
        const item = finalOrder[index];

        // Entries that stay in place get only their value edits
        if (slot.entry != null)
        {
            if (item === slot.entry)
            {
                const update = updates.get(item);
                if (update != null)
                    edits.push(...buildEntryEdits(text, item, update.fields, update.abilityName, format));
            }
            else
                edits.push({ start: slot.entry.start, end: slot.entry.end, text: renderItem(item) });
            return;
        }

        if (slot.placeholder != null)
        {
            edits.push({ start: slot.placeholder.start, end: slot.placeholder.end, text: renderItem(item) });
            return;
        }

        // New slots are written after their anchor's comma, or at the start of an empty list
        const anchor = slot.anchor?.entry ?? slot.anchor?.placeholder ?? slot.anchor;
        const position = anchor != null ? anchor.commaEnd ?? anchor.end : set.listStart + 1;
        const needsComma = anchor != null && anchor.commaEnd == null;
        const group = insertions.get(position) ?? { needsComma, texts: [] };
        group.texts.push(format.lineEnding + format.entry + renderItem(item));
        insertions.set(position, group);
    });

    // Entries inserted after the last entry end with a comma unless the list did not use one
    for (const [position, { needsComma, texts }] of insertions)
        edits.push({ start: position, end: position, text: (needsComma ? "," : "") + texts.join(",") + (needsComma ? "" : ",") });

    return { edits, order: finalOrder };
}
module.exports.buildSetEdits = buildSetEdits;

/**
 * Checks that an ability constant from game data is safe to write into a comment.
 *
 * @param {*} abilityName The ability constant.
 * @returns {string|null} The constant, or null.
 */
function toAbilityName(abilityName)
{
    return typeof abilityName === "string" && ABILITY_NAME_PATTERN.test(abilityName) && abilityName !== "ABILITY_NONE" ? abilityName : null;
}
module.exports.toAbilityName = toAbilityName;
