/**
 * Spread list rules shared by the editor page and its tests: filters, set and species groups, rows, pages and
 * readable set names. This module must stay free of browser and Node APIs.
 */

import { LEGALITY, getMegaEvolutions, getMoveLegality } from "./catalog.mjs";
import { getEffectiveAbility } from "./pokemon-mechanics.mjs";
import { getBattleType, getFieldSymbol, getTeamType } from "./spread-model.mjs";

export const FLAG_FILTER = { ANY: "", YES: "yes", NO: "no" };

export const DEFAULT_FILTERS = Object.freeze(
{
    species: [],
    file: "",
    setId: "",
    trainerId: "",
    moves: [],
    ability: "",
    item: "",
    gigantamax: FLAG_FILTER.ANY,
    megaStone: FLAG_FILTER.ANY,
    zCrystal: FLAG_FILTER.ANY,
    shiny: FLAG_FILTER.ANY,
    battleType: "",
    teamType: "",
    unsaved: false,
    illegalMoves: false,
});

export const PAGE_SIZES = [12, 24, 48];
export const DEFAULT_PAGE_SIZE = PAGE_SIZES[0];

const ITEM_TYPE_Z_CRYSTAL = "ITEM_TYPE_Z_CRYSTAL";
const ILLEGAL_STATUSES = new Set([LEGALITY.ILLEGAL, LEGALITY.UNDEFINED]);

// Set names such as gSpecialTowerSpread_Skeli: a scope prefix, words, then the trainer and ranks
const SET_SCOPE_PREFIX = /^[gs](?=[A-Z])/;
const SET_NAME_SEPARATOR = "_";
const DROPPED_SET_WORDS = new Set(["Tower"]);
const RANK_PART = /^Rank(\d+)$/;
const WORD_BOUNDARIES = [/([a-z])([A-Z0-9])/g, /([0-9])([A-Za-z])/g];
const NON_ALPHANUMERIC = /[^a-z0-9]/gi;


/**
 * Returns the filters a snapshot starts with: everything, limited to the first spread set.
 *
 * @param {object} spreads The spreads snapshot.
 * @returns {object} The filters.
 */
export function getDefaultFilters(spreads)
{
    return { ...DEFAULT_FILTERS, setId: spreads.sets[0]?.id ?? DEFAULT_FILTERS.setId };
}

/**
 * Splits a name written in CamelCase into words, keeping numbers apart, such as Pablo1Format1 into Pablo 1 Format 1.
 *
 * @param {string} text The name.
 * @returns {Array<string>} The words.
 */
function splitWords(text)
{
    return WORD_BOUNDARIES.reduce((result, pattern) => result.replace(pattern, "$1 $2"), text).split(" ").filter((word) => word !== "");
}

/**
 * Returns a readable rank part, such as Ranks 5-6 for Rank56.
 *
 * @param {string} part The part of the set name.
 * @returns {Array<string>|null} The words, or null when the part is not ranks.
 */
function formatRankPart(part)
{
    const digits = RANK_PART.exec(part)?.[1];
    if (digits == null)
        return null;

    const ranks = [...digits].map(Number);
    if (ranks.length === 1)
        return ["Rank", String(ranks[0])];

    const consecutive = ranks.every((rank, index) => index === 0 || rank === ranks[index - 1] + 1);
    return ["Ranks", consecutive ? `${ranks[0]}-${ranks.at(-1)}` : ranks.join(", ")];
}

/**
 * Returns a spread set's readable name, such as Special Spread Skeli for gSpecialTowerSpread_Skeli, leaving out
 * the trainer when it is already known.
 *
 * @param {string} name The array name.
 * @param {string} [trainerName] The chosen trainer's name.
 * @returns {string} The readable name.
 */
export function getSetLabel(name, trainerName = "")
{
    const [head, ...parts] = name.replace(SET_SCOPE_PREFIX, "").split(SET_NAME_SEPARATOR);
    const words = splitWords(head).filter((word) => !DROPPED_SET_WORDS.has(word));
    const trainer = trainerName.replace(NON_ALPHANUMERIC, "").toLowerCase();

    parts.forEach((part, index) =>
    {
        // The trainer comes first, possibly followed by a number such as Palmer1
        const rest = index === 0 && trainer !== "" && part.toLowerCase().startsWith(trainer) ? part.slice(trainer.length) : part;
        words.push(...(formatRankPart(rest) ?? splitWords(rest)));
    });

    return words.length > 0 ? words.join(" ") : name;
}


/**
 * Returns whether a yes/no filter accepts a value.
 *
 * @param {string} filter A FLAG_FILTER value.
 * @param {boolean} value The spread's value.
 * @returns {boolean} Whether it matches.
 */
function matchesFlag(filter, value)
{
    return filter === FLAG_FILTER.ANY || (filter === FLAG_FILTER.YES) === value;
}

/**
 * Returns whether a spread holds a Mega Stone its species can use.
 *
 * @param {object} catalog The game catalog.
 * @param {object} fields The spread's values.
 * @returns {boolean} Whether it holds a matching Mega Stone.
 */
export function holdsMegaStone(catalog, fields)
{
    return getMegaEvolutions(catalog, fields.species, getFieldSymbol(fields, "item")).some((mega) => mega.item != null);
}

/**
 * Returns whether a spread holds a Z-Crystal, according to CFRU's item kinds.
 *
 * @param {object} catalog The game catalog.
 * @param {object} fields The spread's values.
 * @returns {boolean} Whether it holds a Z-Crystal.
 */
export function holdsZCrystal(catalog, fields)
{
    const item = fields.item;
    return typeof item === "string" && Object.hasOwn(catalog.items, item) && catalog.items[item].itemType === ITEM_TYPE_Z_CRYSTAL;
}

/**
 * Returns whether a spread has a move its species cannot learn or the game does not have.
 *
 * @param {object} catalog The game catalog.
 * @param {object} fields The spread's values.
 * @returns {boolean} Whether a move is illegal.
 */
export function hasIllegalMove(catalog, fields)
{
    return fields.moves.some((move) => ILLEGAL_STATUSES.has(getMoveLegality(catalog, fields.species, move).status));
}

/**
 * Returns the ability a spread has in battle.
 *
 * @param {object} catalog The game catalog.
 * @param {object} fields The spread's values.
 * @returns {string|null} The ABILITY_* constant.
 */
export function getSpreadAbility(catalog, fields)
{
    const species = Object.hasOwn(catalog.species, fields.species) ? catalog.species[fields.species] : null;
    return getEffectiveAbility(species, fields.ability);
}

/**
 * Prepares the lookups filters need from the spreads snapshot.
 *
 * @param {object} spreads The spreads snapshot.
 * @returns {{setsById: Map<string, object>, trainerSets: Map<string, Set<string>>}} Sets by ID and each trainer's sets.
 */
export function createFilterContext(spreads)
{
    return {
        setsById: new Map(spreads.sets.map((set) => [set.id, set])),
        trainerSets: new Map(spreads.trainers.map((trainer) => [trainer.id, new Set(trainer.links.map((link) => link.setId).filter((id) => id != null))])),
    };
}

/**
 * Returns whether a spread passes every filter.
 *
 * @param {object} entry The spread entry.
 * @param {object} fields The spread's current values.
 * @param {object} filters The filters, shaped like DEFAULT_FILTERS.
 * @param {object} context The lookups.
 * @param {object} context.catalog The game catalog.
 * @param {Map<string, object>} context.setsById Sets by ID.
 * @param {Map<string, Set<string>>} context.trainerSets Each trainer's set IDs.
 * @param {Array<{name: string, value: number|null}>} context.teamTypes The team types.
 * @param {function(string): boolean} context.isChanged Whether a spread has unsaved changes.
 * @returns {boolean} Whether it matches.
 */
export function matchesFilters(entry, fields, filters, context)
{
    const { catalog } = context;
    if (filters.species.length > 0 && !filters.species.includes(fields.species))
        return false;
    if (filters.file && context.setsById.get(entry.setId)?.file !== filters.file)
        return false;
    if (filters.setId && entry.setId !== filters.setId)
        return false;
    if (filters.trainerId && !context.trainerSets.get(filters.trainerId)?.has(entry.setId))
        return false;
    if (filters.moves.some((move) => !fields.moves.includes(move)))
        return false;
    if (filters.ability && getSpreadAbility(catalog, fields) !== filters.ability)
        return false;
    if (filters.item && getFieldSymbol(fields, "item") !== filters.item)
        return false;
    if (!matchesFlag(filters.gigantamax, fields.gigantamax === true) || !matchesFlag(filters.shiny, fields.shiny === true))
        return false;
    if (filters.megaStone && !matchesFlag(filters.megaStone, holdsMegaStone(catalog, fields)))
        return false;
    if (filters.zCrystal && !matchesFlag(filters.zCrystal, holdsZCrystal(catalog, fields)))
        return false;
    if (filters.battleType && getBattleType(fields) !== filters.battleType)
        return false;
    if (filters.teamType && getTeamType(fields, context.teamTypes) !== filters.teamType)
        return false;
    if (filters.unsaved && !context.isChanged(entry.id))
        return false;
    if (filters.illegalMoves && !hasIllegalMove(catalog, fields))
        return false;

    return true;
}

/**
 * Counts the filters that narrow the results more or less than the defaults.
 *
 * @param {object} filters The filters.
 * @param {object} [defaults] The filters the results start with.
 * @returns {number} The number of changed filters.
 */
export function countActiveFilters(filters, defaults = DEFAULT_FILTERS)
{
    return Object.entries(filters).filter(([name, value]) => (Array.isArray(value) ? value.length > 0 : value !== defaults[name])).length;
}

/**
 * Groups spreads by set, then by stored species, in the order each first appears.
 *
 * @param {Array<{id: string, species: string, setId: string}>} spreads The spreads in source order.
 * @returns {Array<{setId: string, species: string, ids: Array<string>}>} The groups, each in source order.
 */
export function groupSpreads(spreads)
{
    const sets = new Map();
    for (const { id, species, setId } of spreads)
    {
        if (!sets.has(setId))
            sets.set(setId, new Map());

        const groups = sets.get(setId);
        if (!groups.has(species))
            groups.set(species, { setId, species, ids: [] });
        groups.get(species).ids.push(id);
    }

    return [...sets.values()].flatMap((groups) => [...groups.values()]);
}

/**
 * Returns how many cards fit in a row.
 *
 * @param {number} width The container width.
 * @param {number} minCardWidth The narrowest a card may be.
 * @param {number} gap The space between cards.
 * @returns {number} The capacity, at least 1.
 */
export function getRowCapacity(width, minCardWidth, gap)
{
    return Math.max(1, Math.floor((width + gap) / (minCardWidth + gap)));
}

/**
 * Fills each row before starting the next one.
 *
 * @param {number} count The group's size.
 * @param {number} capacity The most cards in a row.
 * @returns {Array<number>} The row sizes, larger rows first.
 */
export function getBalancedRowSizes(count, capacity)
{
    if (count <= 0)
        return [];

    const rowCapacity = Math.max(1, capacity);
    const rows = Math.ceil(count / rowCapacity);
    return Array.from({ length: rows }, (_, index) => Math.min(rowCapacity, count - index * rowCapacity));
}

/**
 * Lays groups out in rows. Groups that fit in one row share it with the groups beside them while there is room,
 * and larger groups fill rows of their own. Rows never mix sets.
 *
 * @param {Array<{setId: string, species: string, ids: Array<string>}>} groups The groups.
 * @param {number} capacity The most cards in a row.
 * @returns {Array<{setId: string, species: Array<string>, ids: Array<string>, block: number}>} The rows. Rows with
 *          the same block hold whole groups and must stay on one page.
 */
export function buildRows(groups, capacity)
{
    const rows = [];
    let sharedRow = null;
    for (const { setId, species, ids } of groups)
    {
        if (ids.length <= capacity && sharedRow?.setId === setId && sharedRow.ids.length + ids.length <= capacity)
        {
            sharedRow.species.push(species);
            sharedRow.ids.push(...ids);
            continue;
        }

        const block = rows.length === 0 ? 0 : rows.at(-1).block + 1;
        const sizes = getBalancedRowSizes(ids.length, capacity);
        let start = 0;
        for (const size of sizes)
        {
            rows.push({ setId, species: [species], ids: ids.slice(start, start + size), block });
            start += size;
        }

        sharedRow = sizes.length === 1 ? rows.at(-1) : null;
    }

    return rows;
}

/**
 * Divides rows into pages of at most a number of cards. A block of rows is never split, so a species larger
 * than a page gets a page to itself.
 *
 * @param {Array<object>} rows The rows from buildRows.
 * @param {number} pageSize The most cards on a page.
 * @returns {Array<Array<object>>} The pages, each a list of rows.
 */
export function paginateRows(rows, pageSize)
{
    const pages = [];
    let page = [];
    let used = 0;

    for (let index = 0; index < rows.length;)
    {
        const blockRows = [];
        do
            blockRows.push(rows[index++]);
        while (index < rows.length && rows[index].block === blockRows[0].block);

        const blockSize = blockRows.reduce((sum, row) => sum + row.ids.length, 0);
        if (used > 0 && used + blockSize > pageSize)
        {
            pages.push(page);
            page = [];
            used = 0;
        }

        page.push(...blockRows);
        used += blockSize;
    }

    if (page.length > 0)
        pages.push(page);
    return pages;
}

/**
 * Returns the page that shows a spread.
 *
 * @param {Array<Array<object>>} pages The pages.
 * @param {string|null} id The spread ID.
 * @returns {number} The page index, or 0 when no page shows it.
 */
export function findPage(pages, id)
{
    if (id == null)
        return 0;

    const index = pages.findIndex((rows) => rows.some((row) => row.ids.includes(id)));
    return Math.max(0, index);
}
