/**
 * Spread editing rules shared by the editor page and the local server: value limits, battle types, doubles team
 * types, changed fields and edits that update several fields together.
 * This module must stay free of browser and Node APIs.
 */

import
{
    EV_FIELDS, IV_FIELDS, MAX_EV, MAX_EV_TOTAL, MAX_IV, MOVE_HIDDEN_POWER, STATS, getEvTotal, getMaxEv, optimizeHiddenPowerIvs,
} from "./pokemon-mechanics.mjs";

export const MAX_MOVES = 4;
const EMPTY_MOVE = 0;
const MOVES_FIELD = "moves";
const EV_TOTAL_FIELD = "evTotal";

export const BATTLE_TYPES =
{
    BOTH: "both",
    SINGLES: "singles",
    DOUBLES: "doubles",
    NEITHER: "neither",
};

// Both keeps the spread's own Modify Moves Doubles choice, so it is not listed
const BATTLE_TYPE_FLAGS =
{
    [BATTLE_TYPES.SINGLES]: { forSingles: true, forDoubles: false, modifyMovesDoubles: true },
    [BATTLE_TYPES.DOUBLES]: { forSingles: false, forDoubles: true, modifyMovesDoubles: false },
    [BATTLE_TYPES.BOTH]: { forSingles: true, forDoubles: true },
};

const TEAM_TYPE_FIELD = "specificTeamType";
const TEAM_TYPE_PATTERN = /^DOUBLES_(.+)_TEAM$/;
export const ANY_TEAM_TYPE = "DOUBLES_ANY_TEAM";

// The constant an omitted field's 0 is shown as; an omitted ball counts as random (user decision)
const ZERO_SYMBOLS = { nature: "NATURE_HARDY", item: "ITEM_NONE", ball: "BALL_TYPE_RANDOM" };


/**
 * Returns a spread's battle type from its flags.
 *
 * @param {{forSingles: boolean, forDoubles: boolean}} fields The spread's values.
 * @returns {string} A BATTLE_TYPES value. NEITHER is only possible in existing source.
 */
export function getBattleType(fields)
{
    if (fields.forSingles && fields.forDoubles)
        return BATTLE_TYPES.BOTH;
    if (fields.forSingles)
        return BATTLE_TYPES.SINGLES;
    if (fields.forDoubles)
        return BATTLE_TYPES.DOUBLES;

    return BATTLE_TYPES.NEITHER;
}

/**
 * Sets a spread's battle type. Singles Only always modifies moves for doubles and Doubles Only never does,
 * while Both uses the Modify Moves Doubles value the spread had the last time it was Both.
 *
 * @param {object} fields The spread's values.
 * @param {string} type The BATTLE_TYPES value, other than NEITHER.
 * @param {boolean} [bothModifyMovesDoubles] The Modify Moves Doubles value to use for Both.
 * @returns {object} The new values.
 */
export function applyBattleType(fields, type, bothModifyMovesDoubles = fields.modifyMovesDoubles)
{
    const flags = BATTLE_TYPE_FLAGS[type];
    if (flags == null)
        return fields;

    return { ...fields, modifyMovesDoubles: bothModifyMovesDoubles, ...flags };
}

/**
 * Changes a spread's battle type in the editor. Only Doubles Only spreads choose a doubles team type, so
 * any other battle type resets it to Any.
 *
 * @param {object} fields The spread's values.
 * @param {string} type The BATTLE_TYPES value, other than NEITHER.
 * @param {object} [options] The context.
 * @param {object} [options.saved] The saved values, so an omitted team type stays omitted.
 * @param {Array<{name: string, value: number|null}>} [options.teamTypes] The team types from the spreads snapshot.
 * @param {boolean} [options.bothModifyMovesDoubles] The Modify Moves Doubles value to use for Both.
 * @returns {object} The new values.
 */
export function changeBattleType(fields, type, { saved = fields, teamTypes = [], bothModifyMovesDoubles } = {})
{
    const changed = applyBattleType(fields, type, bothModifyMovesDoubles);
    if (type === BATTLE_TYPES.DOUBLES || changed === fields || teamTypes.length === 0)
        return changed;

    return setTeamType(changed, ANY_TEAM_TYPE, teamTypes, saved);
}

/**
 * Returns the constant a field names, treating an omitted field's 0 as the constant CFRU gives it.
 *
 * @param {object} fields The spread's values.
 * @param {string} name The field, such as item.
 * @returns {*} The constant, or the raw value when it is not an omitted 0.
 */
export function getFieldSymbol(fields, name)
{
    const value = fields[name];
    return value === 0 && Object.hasOwn(ZERO_SYMBOLS, name) ? ZERO_SYMBOLS[name] : value;
}

/**
 * Sets a field to a constant. Choosing what the field was saved as restores the saved value exactly, so an
 * omitted field stays omitted.
 *
 * @param {object} fields The spread's values.
 * @param {string} name The field.
 * @param {string} symbol The constant.
 * @param {object} [saved] The saved values.
 * @returns {object} The new values.
 */
export function setFieldSymbol(fields, name, symbol, saved = fields)
{
    const value = getFieldSymbol(saved, name) === symbol ? saved[name] : symbol;
    return { ...fields, [name]: value };
}

/**
 * Returns the doubles team type a spread needs a teammate for. An omitted value is the first type, which
 * needs nothing.
 *
 * @param {object} fields The spread's values.
 * @param {Array<{name: string, value: number|null}>} teamTypes The team types from the spreads snapshot.
 * @returns {string|null} The DOUBLES_*_TEAM constant, or null when a number matches no team type.
 */
export function getTeamType(fields, teamTypes)
{
    const value = fields[TEAM_TYPE_FIELD];
    if (typeof value === "number")
        return teamTypes.find((teamType) => teamType.value === value)?.name ?? null;

    return value;
}

/**
 * Sets a spread's doubles team type. Choosing the type it was saved with restores the saved value exactly,
 * so an omitted value stays omitted.
 *
 * @param {object} fields The spread's values.
 * @param {string} teamType The DOUBLES_*_TEAM constant.
 * @param {Array<{name: string, value: number|null}>} teamTypes The team types from the spreads snapshot.
 * @param {object} [saved] The saved values.
 * @returns {object} The new values.
 */
export function setTeamType(fields, teamType, teamTypes, saved = fields)
{
    const value = getTeamType(saved, teamTypes) === teamType ? saved[TEAM_TYPE_FIELD] : teamType;
    return { ...fields, [TEAM_TYPE_FIELD]: value };
}

/**
 * Returns a readable team type name, such as Trick Room for DOUBLES_TRICK_ROOM_TEAM.
 *
 * @param {string} teamType The DOUBLES_*_TEAM constant.
 * @returns {string} The name.
 */
export function getTeamTypeLabel(teamType)
{
    const name = TEAM_TYPE_PATTERN.exec(teamType)?.[1] ?? teamType;
    return name.toLowerCase().split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

/**
 * Returns whether a value is a whole number within a range.
 *
 * @param {*} value The value.
 * @param {number} max The largest allowed value.
 * @returns {boolean} Whether it is allowed.
 */
function isInRange(value, max)
{
    return Number.isInteger(value) && value >= 0 && value <= max;
}

/**
 * Checks a spread's IVs, EVs and moves. Existing source is shown as it is, so this only blocks saving
 * spreads that were added or changed.
 *
 * @param {object} fields The spread's values.
 * @returns {Array<{field: string, message: string}>} The problems, empty when the spread is valid.
 */
export function validateSpreadFields(fields)
{
    const problems = [];
    for (const stat of STATS)
    {
        if (!isInRange(fields[IV_FIELDS[stat]], MAX_IV))
            problems.push({ field: IV_FIELDS[stat], message: `${IV_FIELDS[stat]} must be a whole number from 0 to ${MAX_IV}.` });
        if (!isInRange(fields[EV_FIELDS[stat]], MAX_EV))
            problems.push({ field: EV_FIELDS[stat], message: `${EV_FIELDS[stat]} must be a whole number from 0 to ${MAX_EV}.` });
    }

    const total = getEvTotal(fields);
    if (total > MAX_EV_TOTAL)
        problems.push({ field: EV_TOTAL_FIELD, message: `The EVs add up to ${total}, but at most ${MAX_EV_TOTAL} are allowed.` });
    if (!Array.isArray(fields.moves) || fields.moves.length > MAX_MOVES)
        problems.push({ field: MOVES_FIELD, message: `A spread can have at most ${MAX_MOVES} moves.` });

    return problems;
}

/**
 * Sets one EV, limited to 0 to 252 and to what the 510 total leaves. Values need not be multiples of 4.
 *
 * @param {object} fields The spread's values.
 * @param {string} stat The stat key.
 * @param {number} value The entered EV.
 * @returns {object} The new values, or the same values when the entry is not a whole number.
 */
export function setEv(fields, stat, value)
{
    if (!Number.isInteger(value))
        return fields;

    return { ...fields, [EV_FIELDS[stat]]: Math.min(Math.max(value, 0), getMaxEv(fields, stat)) };
}

/**
 * Sets one IV, limited to 0 to 31.
 *
 * @param {object} fields The spread's values.
 * @param {string} stat The stat key.
 * @param {number} value The entered IV.
 * @returns {object} The new values, or the same values when the entry is not a whole number.
 */
export function setIv(fields, stat, value)
{
    if (!Number.isInteger(value))
        return fields;

    return { ...fields, [IV_FIELDS[stat]]: Math.min(Math.max(value, 0), MAX_IV) };
}

/**
 * Sets one move slot. Choosing a typed Hidden Power also changes the IVs to give that type.
 *
 * @param {object} fields The spread's values.
 * @param {number} slot The move slot, 0 to 3.
 * @param {string|number|null} move The MOVE_* constant, or 0 or null to empty the slot.
 * @param {string|null} [hiddenPowerType] The TYPE_* constant chosen for Hidden Power.
 * @returns {object} The new values.
 */
export function setMove(fields, slot, move, hiddenPowerType = null)
{
    const moves = [...fields.moves];
    moves[slot] = move ?? EMPTY_MOVE;

    const ivs = move === MOVE_HIDDEN_POWER && hiddenPowerType != null ? optimizeHiddenPowerIvs(fields, hiddenPowerType) : null;
    return { ...fields, ...ivs, moves };
}

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

/**
 * Returns the fields of a spread that differ from its saved values, which is what an update saves.
 *
 * @param {object} fields The spread's values.
 * @param {object} saved The saved values.
 * @returns {object} The changed fields and their new values, empty when nothing changed.
 */
export function getChangedFields(fields, saved)
{
    return Object.fromEntries(Object.entries(fields).filter(([name, value]) => !isSameValue(value, saved[name])));
}

/**
 * Returns whether a spread differs from its saved values.
 *
 * @param {object} fields The spread's values.
 * @param {object} saved The saved values.
 * @returns {boolean} Whether it has unsaved changes.
 */
export function isSpreadChanged(fields, saved)
{
    return Object.keys(getChangedFields(fields, saved)).length > 0;
}
