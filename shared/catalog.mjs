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

// Unbound Cloud's forms that cannot exist outside of battle, besides Mega, Primal and Gigantamax forms
const BATTLE_ONLY_BASE_FORMS =
{
    SPECIES_CHERRIM_SUN: "SPECIES_CHERRIM",
    SPECIES_DARMANITANZEN: "SPECIES_DARMANITAN",
    SPECIES_DARMANITAN_G_ZEN: "SPECIES_DARMANITAN_G",
    SPECIES_MELOETTA_PIROUETTE: "SPECIES_MELOETTA",
    SPECIES_ASHGRENINJA: "SPECIES_GRENINJA",
    SPECIES_AEGISLASH_BLADE: "SPECIES_AEGISLASH",
    SPECIES_XERNEAS_NATURAL: "SPECIES_XERNEAS",
    SPECIES_ZYGARDE_COMPLETE: "SPECIES_ZYGARDE",
    SPECIES_WISHIWASHI_S: "SPECIES_WISHIWASHI",
    SPECIES_MIMIKYU_BUSTED: "SPECIES_MIMIKYU",
    SPECIES_NECROZMA_ULTRA: "SPECIES_NECROZMA",
    SPECIES_CRAMORANT_GULPING: "SPECIES_CRAMORANT",
    SPECIES_CRAMORANT_GORGING: "SPECIES_CRAMORANT",
    SPECIES_EISCUE_NOICE: "SPECIES_EISCUE",
    SPECIES_MORPEKO_HANGRY: "SPECIES_MORPEKO",
    SPECIES_ZACIAN_CROWNED: "SPECIES_ZACIAN",
    SPECIES_ZAMAZENTA_CROWNED: "SPECIES_ZAMAZENTA",
    SPECIES_ETERNATUS_ETERNAMAX: "SPECIES_ETERNATUS",
    SPECIES_PALAFIN_HERO: "SPECIES_PALAFIN",
    SPECIES_TERAPAGOS_TERASTAL: "SPECIES_TERAPAGOS",
    SPECIES_TERAPAGOS_STELLAR: "SPECIES_TERAPAGOS",
};
const GIGANTAMAX_SUFFIX = "GIGA";
const BATTLE_ONLY_SUFFIX = /_(MEGA(?:_[XYZ])?|PRIMAL|GIGA)$/;
const battleOnlyForms = new WeakMap();


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

/**
 * Finds the form a species takes outside of battle, following Unbound Cloud's rules for battle-only forms.
 *
 * @param {object} catalog The game catalog.
 * @param {string} species The SPECIES_* constant.
 * @returns {{species: string, item: string|null, gigantamax: boolean}|null} The base form, the item that triggers
 *          the battle form and whether it is a Gigantamax form, or null when the species exists outside of battle.
 */
export function getOutOfBattleForm(catalog, species)
{
    if (!battleOnlyForms.has(catalog))
        battleOnlyForms.set(catalog, findBattleOnlyForms(catalog));

    return battleOnlyForms.get(catalog).get(species) ?? null;
}

/**
 * Returns whether a species can only exist during a battle, such as a Mega Evolution or Gigantamax form.
 *
 * @param {object} catalog The game catalog.
 * @param {string} species The SPECIES_* constant.
 * @returns {boolean} Whether the species is a battle-only form.
 */
export function isBattleOnlySpecies(catalog, species)
{
    return getOutOfBattleForm(catalog, species) != null;
}

/**
 * Maps every battle-only form in a catalog to its base form.
 *
 * @param {object} catalog The game catalog.
 * @returns {Map<string, {species: string, item: string|null, gigantamax: boolean}>} The base forms by battle form.
 */
function findBattleOnlyForms(catalog)
{
    const forms = new Map();
    const species = catalog.species ?? {};

    // Cloud's fixed list, then DPE's Mega Evolutions and Gigantamax forms
    for (const [form, base] of Object.entries(BATTLE_ONLY_BASE_FORMS))
    {
        if (Object.hasOwn(species, form) && Object.hasOwn(species, base))
            forms.set(form, { species: base, item: null, gigantamax: false });
    }

    for (const [base, info] of Object.entries(species))
    {
        for (const mega of info.megas ?? [])
            forms.set(mega.species, { species: base, item: mega.item ?? null, gigantamax: false });
        if (info.gigantamax?.species != null)
            forms.set(info.gigantamax.species, { species: base, item: null, gigantamax: true });
    }

    // Forms named like battle forms but missing from DPE's evolution table
    for (const form of Object.keys(species))
    {
        const match = BATTLE_ONLY_SUFFIX.exec(form);
        const base = match != null ? form.slice(0, match.index) : null;
        if (base != null && !forms.has(form) && Object.hasOwn(species, base))
            forms.set(form, { species: base, item: null, gigantamax: match[1] === GIGANTAMAX_SUFFIX });
    }

    return forms;
}
