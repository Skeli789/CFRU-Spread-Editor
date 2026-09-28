/**
 * Catalog helpers shared by the editor page and the local server: move legality lookups and
 * how move details and Mega Evolutions are interpreted.
 * This module must stay free of browser and Node APIs.
 */

// Ways a species can know a move, in the order they are listed
export const LEARN_SOURCES =
{
    LEVEL: "level",
    EVOLUTION: "evolution",
    EGG: "egg",
    TM: "tm",
    TUTOR: "tutor",
    SPECIAL: "special",
    SKETCH: "sketch",
    FORM_CHANGE: "formChange",
    PREVOLUTION: "prevolution",
    FORM: "form",
};
export const LEARN_SOURCE_ORDER = Object.values(LEARN_SOURCES);

export const LEARNSET_COMPLETE = "complete";
export const LEARNSET_MISSING = "missing";

export const LEGALITY =
{
    NONE: "none",
    ALLOWED: "allowed",
    ILLEGAL: "illegal",
    UNKNOWN: "unknown",
    UNDEFINED: "undefined",
};

export const POWER_KIND =
{
    UNKNOWN: "unknown",
    NONE: "none",
    VARIABLE: "variable",
    FIXED: "fixed",
};

const MOVE_NONE = "MOVE_NONE";

// CFRU stores 0 for moves that deal no direct damage and 1 for damage calculated when the move is used
const POWER_NONE = 0;
const POWER_VARIABLE = 1;
const ACCURACY_ALWAYS_HITS = 0;


/**
 * Classifies whether a species can know a move in the selected game.
 *
 * @param {object} catalog The game catalog.
 * @param {string} species The SPECIES_* constant.
 * @param {string|number} move The MOVE_* constant, or 0 for an empty slot.
 * @returns {{status: string, sources: Array<string>, reason: string|null}} The legality, how the move is learned
 *          and why legality could not be decided.
 */
export function getMoveLegality(catalog, species, move)
{
    if (move === 0 || move === MOVE_NONE)
        return { status: LEGALITY.NONE, sources: [], reason: null };

    // A move the game does not have cannot be used at all
    if (typeof move !== "string" || !Object.hasOwn(catalog.moves, move))
        return { status: LEGALITY.UNDEFINED, sources: [], reason: `${move} is not a move in ${catalog.name}.` };

    // Without a complete learnset nothing can be ruled out
    const learnset = Object.hasOwn(catalog.learnsets, species) ? catalog.learnsets[species] : null;
    if (learnset == null || learnset.status !== LEARNSET_COMPLETE)
        return { status: LEGALITY.UNKNOWN, sources: [], reason: `The Dynamic Pokemon Expansion has no learnset for ${species}.` };

    if (Object.hasOwn(learnset.moves, move))
        return { status: LEGALITY.ALLOWED, sources: learnset.moves[move], reason: null };
    if (Object.hasOwn(learnset.unknown, move))
        return { status: LEGALITY.UNKNOWN, sources: [], reason: learnset.unknown[move] };

    return { status: LEGALITY.ILLEGAL, sources: [], reason: null };
}

/**
 * Describes a move's power, telling moves without direct damage apart from those whose power varies.
 *
 * @param {{power: number|null}} details The move details.
 * @returns {string} A POWER_KIND value.
 */
export function getPowerKind(details)
{
    if (details?.power == null)
        return POWER_KIND.UNKNOWN;
    if (details.power === POWER_NONE)
        return POWER_KIND.NONE;
    if (details.power === POWER_VARIABLE)
        return POWER_KIND.VARIABLE;

    return POWER_KIND.FIXED;
}

/**
 * Returns whether a move skips the accuracy check, which CFRU stores as an accuracy of 0.
 *
 * @param {{accuracy: number|null}} details The move details.
 * @returns {boolean} Whether the move always hits.
 */
export function alwaysHits(details)
{
    return details?.accuracy === ACCURACY_ALWAYS_HITS;
}

/**
 * Returns the Mega Evolutions a spread would use, from its species, held item and moves.
 *
 * @param {object} catalog The game catalog.
 * @param {string} species The stored SPECIES_* constant.
 * @param {string|number} item The held ITEM_* constant.
 * @param {Array<string|number>} [moves] The spread's moves, for Mega Evolutions triggered by a move.
 * @returns {Array<{species: string, item?: string, move?: string, variant: *, available: boolean}>} The matching
 *          Mega Evolutions, usually one.
 */
export function getMegaEvolutions(catalog, species, item, moves = [])
{
    const megas = Object.hasOwn(catalog.species, species) ? catalog.species[species].megas : [];
    return megas.filter((mega) => (mega.item != null ? mega.item === item : moves.includes(mega.move)));
}
