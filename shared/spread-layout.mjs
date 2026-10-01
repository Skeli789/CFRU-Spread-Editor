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

// Moves of whole species groups are remembered by species, next to the IDs of spreads moved within their species
export const GROUP_MOVE_PREFIX = "group:";
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
 * @param {boolean} [shareRows] Whether small groups may share a row.
 * @returns {Array<{setId: string, species: Array<string>, ids: Array<string>, block: number}>} The rows. Rows with
 *          the same block hold whole groups and must stay on one page.
 */
export function buildRows(groups, capacity, shareRows = true)
{
    const rows = [];
    let sharedRow = null;
    for (const { setId, species, ids } of groups)
    {
        if (shareRows && ids.length <= capacity && sharedRow?.setId === setId && sharedRow.ids.length + ids.length <= capacity)
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

/**
 * Inserts a new ID after the last source entry of its species, or at the end of the set.
 *
 * @param {Array<string>} order The current source order.
 * @param {Map<string, object>} entries Entries by ID.
 * @param {string} id The new ID.
 * @returns {Array<string>} The new order.
 */
export function insertSpread(order, entries, id)
{
    const species = entries.get(id)?.fields.species;
    const last = order.findLastIndex((entryId) => entries.get(entryId)?.fields.species === species);
    const next = [...order];
    next.splice(last < 0 ? next.length : last + 1, 0, id);
    return next;
}

/**
 * Returns saved source order with unsaved additions in their default species positions.
 *
 * @param {object} set The spread set.
 * @param {Map<string, object>} entries Saved and new entries.
 * @returns {Array<string>} The default order, preserving additions.
 */
export function getSavedOrder(set, entries)
{
    let order = set.entryIds;
    for (const [id, entry] of entries)
    {
        if (entry.isNew && entry.setId === set.id)
            order = insertSpread(order, entries, id);
    }
    return order;
}

/**
 * Returns whether an order differs from saved slots plus default additions.
 *
 * @param {object|undefined} set The spread set.
 * @param {Array<string>|undefined} order Its draft order.
 * @param {Map<string, object>} entries Saved and new entries.
 * @returns {boolean} Whether Revert Order can change the order.
 */
export function hasOrderChange(set, order, entries)
{
    if (set == null || order == null)
        return false;
    const saved = getSavedOrder(set, entries);
    return saved.length !== order.length || order.some((id, index) => saved[index] !== id);
}

/**
 * Validates a drop using the event source rather than React's drag highlight state.
 *
 * @param {object|null} source The dragged spread.
 * @param {object|null} target The spread or heading target.
 * @param {Function} canMove Whether a spread can reorder within its set.
 * @param {Function|null} transferProblem Returns why a transfer is blocked.
 * @returns {boolean} Whether the drop is allowed.
 */
export function canDropSpread(source, target, canMove, transferProblem = null)
{
    if (source == null || target == null || source.id === target.id)
        return false;
    if (source.setId !== target.setId)
        return transferProblem != null && !transferProblem(source.id, target.setId);
    return target.id != null && source.species === target.species && canMove(source.id);
}

/**
 * Moves a spread within its species without moving another species out of its source slots.
 *
 * @param {Array<string>} order The source order.
 * @param {Map<string, object>} entries Entries by ID.
 * @param {string} id The spread to move.
 * @param {string} targetId The destination spread.
 * @returns {Array<string>} The new source order, or the original order for an invalid move.
 */
export function moveSpread(order, entries, id, targetId)
{
    const species = entries.get(id)?.fields.species;
    if (id === targetId || species == null || species !== entries.get(targetId)?.fields.species
        || entries.get(id)?.setId !== entries.get(targetId)?.setId)
        return order;

    const slots = order.map((entryId, index) => entries.get(entryId)?.fields.species === species ? index : -1).filter((index) => index >= 0);
    const ids = slots.map((index) => order[index]);
    const targetIndex = ids.indexOf(targetId);
    ids.splice(ids.indexOf(id), 1);
    ids.splice(targetIndex, 0, id);
    const next = [...order];
    slots.forEach((slot, index) => { next[slot] = ids[index]; });
    return next;
}

/**
 * Moves a complete species group to another position among the set's groups, coalescing interleaved source
 * entries only when requested.
 *
 * @param {Array<string>} order The source order.
 * @param {Map<string, object>} entries Entries by ID.
 * @param {string} species The group to move.
 * @param {number} targetIndex The group's new position among the set's groups.
 * @returns {{order: Array<string>, coalesces: boolean}} The proposed order and whether source slots coalesce.
 */
export function moveSpeciesGroup(order, entries, species, targetIndex)
{
    const groups = groupSpreads(order.map((id) => ({ id, species: entries.get(id).fields.species, setId: entries.get(id).setId })));
    const source = groups.findIndex((group) => group.species === species);
    if (source < 0 || !Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= groups.length || source === targetIndex)
        return { order, coalesces: false };

    const coalesces = order.some((id, index) => index > 0 && entries.get(id).fields.species !== entries.get(order[index - 1]).fields.species)
        && groups.some((group) => order.filter((id) => entries.get(id).fields.species === group.species).length > 1
            && order.findLastIndex((id) => entries.get(id).fields.species === group.species) - order.findIndex((id) => entries.get(id).fields.species === group.species) + 1 !== group.ids.length);
    const [moved] = groups.splice(source, 1);
    groups.splice(targetIndex, 0, moved);
    return { order: groups.flatMap((group) => group.ids), coalesces };
}

/**
 * Converts a drop between two groups into the moving group's new position.
 *
 * @param {number} source The moving group's position.
 * @param {number} gap The gap it was dropped in, where gap 0 is before the first group.
 * @returns {number} The group's new position.
 */
export function getGapTarget(source, gap)
{
    return gap > source ? gap - 1 : gap;
}

/**
 * Returns the existing entries the user moved: those outside the longest run still in saved relative order.
 * Entries the user moved on purpose are marked in preference to the entries they were moved past.
 *
 * @param {Array<string>} saved The saved source order.
 * @param {Array<string>} current The draft source order.
 * @param {Set<string>} [preferred] The entries the user moved.
 * @returns {Set<string>} The moved existing entries.
 */
export function getMovedIds(saved, current, preferred = new Set())
{
    const positions = new Map(saved.map((id, index) => [id, index + 1]));
    const existing = current.filter((id) => positions.has(id));

    // Spreads the user moved weigh least, and spreads still at their saved index break ties between the rest
    const heavy = 2 * (existing.length + 1);
    const getWeight = (id, index) => preferred.has(id) ? 1 : heavy + (positions.get(id) === index + 1 ? 1 : 0);

    // A Fenwick tree of the best run ending at or before each saved position
    const tree = Array.from({ length: saved.length + 1 }, () => ({ weight: 0, index: -1 }));
    const previous = [];
    let best = { weight: 0, index: -1 };
    existing.forEach((id, index) =>
    {
        let before = { weight: 0, index: -1 };
        for (let position = positions.get(id) - 1; position > 0; position -= position & -position)
        {
            if (tree[position].weight > before.weight)
                before = tree[position];
        }

        const run = { weight: before.weight + getWeight(id, index), index };
        previous[index] = before.index;
        for (let position = positions.get(id); position <= saved.length; position += position & -position)
        {
            if (run.weight > tree[position].weight)
                tree[position] = run;
        }
        if (run.weight > best.weight)
            best = run;
    });

    const kept = new Set();
    for (let index = best.index; index >= 0; index = previous[index])
        kept.add(existing[index]);
    return new Set(existing.filter((id) => !kept.has(id)));
}

/**
 * Puts one moved entry back after the entry that preceded it in the saved order, leaving other moves in place.
 *
 * @param {Array<string>} saved The saved source order.
 * @param {Array<string>} current The draft source order.
 * @param {string} id The entry to put back.
 * @returns {Array<string>} The new order.
 */
export function restoreSpreadPosition(saved, current, id)
{
    const next = current.filter((entryId) => entryId !== id);
    const previous = saved.slice(0, saved.indexOf(id)).findLast((entryId) => next.includes(entryId));
    next.splice(previous == null ? 0 : next.indexOf(previous) + 1, 0, id);
    return next;
}

/**
 * Puts one moved entry back in its saved place among its own species, keeping the species in its current slots.
 *
 * @param {Array<string>} saved The saved source order.
 * @param {Array<string>} current The draft source order.
 * @param {Array<string>} ids The entries of the entry's species.
 * @param {string} id The entry to put back.
 * @returns {Array<string>} The new order.
 */
export function restoreSpreadInGroup(saved, current, ids, id)
{
    const group = new Set(ids);
    const slots = current.map((entryId, index) => (group.has(entryId) ? index : -1)).filter((index) => index >= 0);
    const members = slots.map((index) => current[index]).filter((entryId) => entryId !== id);
    const previous = saved.slice(0, saved.indexOf(id)).findLast((entryId) => members.includes(entryId));
    members.splice(previous == null ? 0 : members.indexOf(previous) + 1, 0, id);
    const next = [...current];
    slots.forEach((slot, index) => { next[slot] = members[index]; });
    return next;
}

/**
 * Puts a moved species group back after the entry that preceded it in the saved order, keeping the order of the
 * group's own entries.
 *
 * @param {Array<string>} saved The saved source order.
 * @param {Array<string>} current The draft source order.
 * @param {Array<string>} ids The group's entries.
 * @returns {Array<string>} The new order, or the current order when the group has no saved entries.
 */
export function restoreGroupPosition(saved, current, ids)
{
    const group = new Set(ids);
    const first = saved.findIndex((id) => group.has(id));
    if (first < 0)
        return current;

    const next = current.filter((id) => !group.has(id));
    const previous = saved.slice(0, first).findLast((id) => next.includes(id));
    next.splice(previous == null ? 0 : next.indexOf(previous) + 1, 0, ...current.filter((id) => group.has(id)));
    return next;
}

/**
 * Returns the entries the user moved within their own species, leaving out moves of whole species groups.
 *
 * @param {Array<string>} saved The saved source order.
 * @param {Array<string>} current The draft source order.
 * @param {function(string): string} getSpecies Returns an entry's species.
 * @param {Set<string>} [preferred] The entries the user moved.
 * @returns {Set<string>} The moved entries.
 */
export function getMovedSpreadIds(saved, current, getSpecies, preferred = new Set())
{
    const moved = new Set();
    for (const species of new Set(current.map(getSpecies)))
    {
        const isMember = (id) => getSpecies(id) === species;
        for (const id of getMovedIds(saved.filter(isMember), current.filter(isMember), preferred))
            moved.add(id);
    }

    return moved;
}
