/**
 * Smogon set rules shared by the Smogon dialog and its tests: requested species names, Champions Stat Points and
 * expanding slash options into importable sets. This module must stay free of browser and Node APIs.
 */

import { getOutOfBattleForm } from "./catalog.mjs";
import { EV_FIELDS, MAX_EV, STATS } from "./pokemon-mechanics.mjs";
import { SHOWDOWN_STATS } from "./showdown.mjs";
import { getEvAutoFix } from "./spread-model.mjs";

export const SMOGON_TABS =
[
    { id: "champions", label: "Champions" },
    { id: "gen9", label: "SV" },
    { id: "gen8", label: "SwSh" },
    { id: "gen7", label: "SM" },
    { id: "gen6", label: "XY" },
];
export const SMOGON_CATEGORIES =
[
    { id: "singles", label: "Singles" },
    { id: "doubles", label: "Doubles" },
];
export const MAX_SMOGON_VARIANTS = 24;
const MAX_SPECIES_NAMES = 16;
const STAT_POINT_MULTIPLIER = 8;
const STAT_POINT_OFFSET = 4;
const CHAMPIONS_PREFIX = "champions";


/**
 * Returns base and battle-only names to request together.
 *
 * @param {object} catalog The game catalog.
 * @param {string} species The base species constant.
 * @returns {Array<string>} Unique names, limited to the API request size.
 */
export function getSmogonSpeciesNames(catalog, species)
{
    const forms = [species, ...Object.keys(catalog.species).filter((form) => getOutOfBattleForm(catalog, form)?.species === species)];
    return [...new Set(forms.map((form) => catalog.species[form]?.showdownName || catalog.species[form]?.name).filter(Boolean))].slice(0, MAX_SPECIES_NAMES);
}

/**
 * Converts Champions Stat Points to legal EVs using the editor's repair priorities.
 *
 * @param {object} points Stat Points keyed by Showdown stat names.
 * @returns {object} EVs keyed by Showdown stat names.
 */
export function convertStatPoints(points)
{
    const fields = Object.fromEntries(STATS.map((stat) =>
    {
        const value = points?.[SHOWDOWN_STATS[stat]] ?? 0;
        return [EV_FIELDS[stat], value > 0 ? Math.min(MAX_EV, value * STAT_POINT_MULTIPLIER - STAT_POINT_OFFSET) : 0];
    }));
    const fixed = { ...fields, ...getEvAutoFix(fields) };
    return Object.fromEntries(STATS.map((stat) => [SHOWDOWN_STATS[stat], fixed[EV_FIELDS[stat]]]));
}

/**
 * Normalizes an optional value into a nonempty alternatives list.
 *
 * @param {*} value A scalar or alternatives.
 * @returns {Array<*>} The alternatives, including an omitted default.
 */
function alternatives(value)
{
    return Array.isArray(value) && value.length > 0 ? value : [Array.isArray(value) ? undefined : value ?? undefined];
}

/**
 * Expands item, nature and EV alternatives into importable Showdown objects.
 *
 * @param {object} catalog The game catalog.
 * @param {string} species The requested base species constant.
 * @param {object} entry A Smogon response set.
 * @returns {Array<object>} Bounded variants with display titles and plain sets.
 */
export function expandSmogonSet(catalog, species, entry)
{
    const moveset = entry.moveset ?? {};
    const form = Object.keys(catalog.species).find((value) =>
        (catalog.species[value].showdownName || catalog.species[value].name) === entry.species);
    const battleForm = getOutOfBattleForm(catalog, form);
    const fallbackItem = catalog.items[battleForm?.item]?.name;
    const items = alternatives(moveset.item).map((item) => item || fallbackItem);
    const natures = alternatives(moveset.nature);
    const spreads = alternatives(moveset.evs);
    const count = items.length * natures.length * spreads.length;
    const variants = [];
    for (const item of items)
    {
        for (const nature of natures)
        {
            for (const [spreadIndex, evs] of spreads.entries())
            {
                const suffix = count > 1 ? [items.length > 1 ? item || "No Item" : null,
                    natures.length > 1 ? nature || "Hardy" : null, spreads.length > 1 ? `Spread ${spreadIndex + 1}` : null].filter(Boolean) : [];
                variants.push(
                {
                    id: `${entry.format}|${entry.name}|${variants.length}`,
                    format: entry.format,
                    title: `${entry.name}${suffix.length ? ` (${suffix.join(", ")})` : ""}`,
                    description: entry.description ?? null,
                    set:
                    {
                        species: catalog.species[species]?.showdownName || catalog.species[species]?.name,
                        item, nature,
                        ability: alternatives(moveset.ability)[0],
                        evs: entry.format.startsWith(CHAMPIONS_PREFIX) && evs != null ? convertStatPoints(evs) : evs,
                        ivs: alternatives(moveset.ivs)[0],
                        moves: alternatives(moveset.moves).map((move) => alternatives(move)[0]).filter(Boolean),
                    },
                });
                if (variants.length === MAX_SMOGON_VARIANTS)
                    return variants;
            }
        }
    }
    return variants;
}
