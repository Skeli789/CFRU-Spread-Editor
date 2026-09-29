import { describe, expect, it } from "vitest";

import
{
    DEFAULT_FILTERS, FLAG_FILTER, buildRows, countActiveFilters, createFilterContext, findPage, getBalancedRowSizes, getDefaultFilters, getRowCapacity,
    getSetLabel, groupSpreads, holdsMegaStone, holdsZCrystal, matchesFilters, paginateRows,
} from "../../shared/spread-layout.mjs";
import { BATTLE_TYPES } from "../../shared/spread-model.mjs";
import { FRONTIER_SET, LITTLE_CUP_SET, PALMER_SET, PALMER_TRAINER, createCatalog, createFields, createSpreads } from "./EditorFixtures";

const CATALOG = createCatalog();
const SPREADS = createSpreads();
const ALL_IDS = SPREADS.entries.map((entry) => entry.id);


/**
 * Returns the IDs of the fixture spreads that pass filters.
 *
 * @param {object} changes The filters to change from the defaults.
 * @param {Object<string, object>} [drafts] Unsaved values by spread ID.
 * @returns {Array<string>} The matching IDs.
 */
function filterIds(changes, drafts = {})
{
    const filters = { ...DEFAULT_FILTERS, ...changes };
    const context = { ...createFilterContext(SPREADS), catalog: CATALOG, teamTypes: SPREADS.teamTypes, isChanged: (id) => Object.hasOwn(drafts, id) };
    return SPREADS.entries.filter((entry) => matchesFilters(entry, drafts[entry.id] ?? entry.fields, filters, context)).map((entry) => entry.id);
}

/**
 * Returns spreads for layout tests, one group per count.
 *
 * @param {Array<number>} counts The size of each species group.
 * @param {string} [setId] The set they are all in.
 * @returns {Array<{id: string, species: string, setId: string}>} The spreads.
 */
function createGroups(counts, setId = "set")
{
    return counts.flatMap((count, group) => Array.from({ length: count }, (_, index) => ({ id: `${setId}-g${group}-${index}`, species: `SPECIES_${group}`, setId })));
}

/**
 * Returns the number of cards in each row of a layout.
 *
 * @param {Array<object>} spreads The spreads.
 * @param {number} capacity The most cards in a row.
 * @returns {Array<number>} The row sizes.
 */
function getRowSizes(spreads, capacity)
{
    return buildRows(groupSpreads(spreads), capacity).map((row) => row.ids.length);
}

describe("Spread filters", () =>
{
    it("match everything by default", () =>
    {
        expect(filterIds({})).toEqual(ALL_IDS);
        expect(countActiveFilters(DEFAULT_FILTERS)).toBe(0);
    });

    it("start with the first spread set, which Clear Filters goes back to", () =>
    {
        const defaults = getDefaultFilters(SPREADS);

        expect(defaults).toEqual({ ...DEFAULT_FILTERS, setId: FRONTIER_SET });
        expect(filterIds(defaults)).toEqual(["e0", "e1", "e2"]);
        expect(countActiveFilters(defaults, defaults)).toBe(0);
        expect(countActiveFilters({ ...defaults, setId: "" }, defaults)).toBe(1);
    });

    it.each(
    [
        ["species", { species: ["SPECIES_CHARIZARD"] }, ["e0", "e2", "e5"]],
        ["several species", { species: ["SPECIES_PICHU", "SPECIES_GARCHOMP"] }, ["e3", "e4"]],
        ["file", { file: "src/Tables/frontier_special_trainer_spreads.h" }, ["e4", "e5"]],
        ["spread set", { setId: LITTLE_CUP_SET }, ["e3"]],
        ["trainer", { trainerId: PALMER_TRAINER }, ["e4", "e5"]],
        ["moves, which must all be known", { moves: ["MOVE_EARTHQUAKE", "MOVE_DRAGONCLAW"] }, ["e2", "e4"]],
        ["effective ability", { ability: "ABILITY_CHLOROPHYLL" }, ["e1"]],
        ["item", { item: "ITEM_LIFEORB" }, ["e3"]],
        ["Gigantamax", { gigantamax: FLAG_FILTER.YES }, ["e4"]],
        ["not shiny", { shiny: FLAG_FILTER.NO }, ["e0", "e1", "e3", "e4", "e5"]],
        ["Mega Stone", { megaStone: FLAG_FILTER.YES }, ["e1", "e2", "e5"]],
        ["Z-Crystal", { zCrystal: FLAG_FILTER.YES }, ["e4"]],
        ["Singles Only", { battleType: BATTLE_TYPES.SINGLES }, ["e3"]],
        ["Doubles Only", { battleType: BATTLE_TYPES.DOUBLES }, ["e1", "e2"]],
        ["Both", { battleType: BATTLE_TYPES.BOTH }, ["e0", "e4", "e5"]],
        ["a doubles team type", { teamType: "DOUBLES_SUN_TEAM" }, ["e1"]],
        ["the Any team type, including omitted values", { teamType: "DOUBLES_ANY_TEAM" }, ["e0", "e2", "e3", "e4", "e5"]],
        ["illegal moves", { illegalMoves: true }, ["e2"]],
    ])("filter by %s", (name, changes, expected) =>
    {
        expect(filterIds(changes)).toEqual(expected);
        expect(countActiveFilters({ ...DEFAULT_FILTERS, ...changes })).toBe(1);
    });

    it("filter by unsaved changes and use unsaved values", () =>
    {
        const drafts = { e0: createFields({ item: "ITEM_LIFEORB" }) };

        expect(filterIds({ unsaved: true }, drafts)).toEqual(["e0"]);
        expect(filterIds({ item: "ITEM_LIFEORB" }, drafts)).toEqual(["e0", "e3"]);
    });

    it("combine filters with AND", () =>
    {
        expect(filterIds({ species: ["SPECIES_CHARIZARD"], battleType: BATTLE_TYPES.DOUBLES })).toEqual(["e2"]);
        expect(filterIds({ setId: FRONTIER_SET, megaStone: FLAG_FILTER.YES, shiny: FLAG_FILTER.YES })).toEqual(["e2"]);
        expect(filterIds({ trainerId: PALMER_TRAINER, setId: FRONTIER_SET })).toEqual([]);
        expect(countActiveFilters({ ...DEFAULT_FILTERS, setId: PALMER_SET, moves: ["MOVE_PROTECT"] })).toBe(2);
    });

    it("use the actual Mega Stone mapping and item kinds", () =>
    {
        expect(holdsMegaStone(CATALOG, createFields({ item: "ITEM_CHARIZARDITE_Y" }))).toBe(true);
        expect(holdsMegaStone(CATALOG, createFields({ species: "SPECIES_GARCHOMP", item: "ITEM_CHARIZARDITE_Y" }))).toBe(false);
        expect(holdsZCrystal(CATALOG, createFields({ item: "ITEM_FIRIUM_Z" }))).toBe(true);
        expect(holdsZCrystal(CATALOG, createFields({ item: 0 }))).toBe(false);
    });
});

describe("Spread set names", () =>
{
    it.each(
    [
        ["gFrontierSpreads", "", "Frontier Spreads"],
        ["gSpecialTowerSpread_Skeli", "", "Special Spread Skeli"],
        ["gSpecialTowerSpread_Skeli", "Skeli", "Special Spread"],
        ["gLittleCupTowerSpread_BigMo", "", "Little Cup Spread Big Mo"],
        ["gSpecialTowerSpread_Pablo1Format2", "Pablo", "Special Spread 1 Format 2"],
        ["gMultiTowerSpread_RivalV1", "", "Multi Spread Rival V1"],
        ["sRaidPartnerSpread_Abimbola_Rank56", "", "Raid Partner Spread Abimbola Ranks 5-6"],
        ["sRaidPartnerSpread_Abimbola_Rank2", "Abimbola", "Raid Partner Spread Rank 2"],
    ])("read %s with trainer %j as %s", (name, trainer, expected) =>
    {
        expect(getSetLabel(name, trainer)).toBe(expected);
    });
});

describe("Spread layout", () =>
{
    it("groups by set, then by stored species, in order of first appearance", () =>
    {
        const spreads = [{ id: "a", species: "B", setId: "x" }, { id: "b", species: "A", setId: "y" }, { id: "c", species: "B", setId: "x" }, { id: "d", species: "B", setId: "y" }];

        expect(groupSpreads(spreads)).toEqual(
        [
            { setId: "x", species: "B", ids: ["a", "c"] },
            { setId: "y", species: "A", ids: ["b"] },
            { setId: "y", species: "B", ids: ["d"] },
        ]);
    });

    it("fits as many cards as the width allows", () =>
    {
        expect(getRowCapacity(1400, 420, 8)).toBe(3);
        expect(getRowCapacity(1276, 420, 8)).toBe(3);
        expect(getRowCapacity(1275, 420, 8)).toBe(2);
        expect(getRowCapacity(300, 420, 8)).toBe(1);
    });

    it("fills rows before starting the next one", () =>
    {
        expect(getBalancedRowSizes(4, 3)).toEqual([3, 1]);
        expect(getBalancedRowSizes(7, 3)).toEqual([3, 3, 1]);
        expect(getBalancedRowSizes(3, 3)).toEqual([3]);
        expect(getBalancedRowSizes(0, 3)).toEqual([]);
    });

    it("lets species that fit share a row, but gives larger species rows of their own", () =>
    {
        expect(getRowSizes(createGroups([1, 2]), 3)).toEqual([3]);
        expect(buildRows(groupSpreads(createGroups([1, 2])), 3)[0].species).toEqual(["SPECIES_0", "SPECIES_1"]);
        expect(getRowSizes(createGroups([1, 1, 1, 1]), 3)).toEqual([3, 1]);
        expect(getRowSizes(createGroups([2, 2]), 3)).toEqual([2, 2]);
        expect(getRowSizes(createGroups([4, 3, 4]), 4)).toEqual([4, 3, 4]);
        expect(getRowSizes(createGroups([4]), 3)).toEqual([3, 1]);
        expect(getRowSizes(createGroups([1, 4, 1]), 3)).toEqual([1, 3, 1, 1]);
    });

    it("never shares a row between sets", () =>
    {
        expect(getRowSizes([...createGroups([1], "a"), ...createGroups([1], "b")], 3)).toEqual([1, 1]);
    });

    it("keeps pages within the card limit without splitting species", () =>
    {
        const pages = paginateRows(buildRows(groupSpreads(createGroups([4, 3, 4, 5])), 3), 12);

        expect(pages.map((page) => page.map((row) => row.ids.length))).toEqual([[3, 1, 3, 3, 1], [3, 2]]);
        expect(pages.every((page) => page.reduce((sum, row) => sum + row.ids.length, 0) <= 12)).toBe(true);
    });

    it("gives a species larger than a page a page to itself", () =>
    {
        const spreads = createGroups([1, 20, 1]);
        const pages = paginateRows(buildRows(groupSpreads(spreads), 3), 12);

        expect(pages.map((page) => page.map((row) => row.ids.length))).toEqual([[1], [3, 3, 3, 3, 3, 3, 2], [1]]);
        expect(pages.flat().flatMap((row) => row.ids)).toEqual(spreads.map((spread) => spread.id));
    });

    it("never drops or repeats spreads when the width changes", () =>
    {
        const spreads = [...createGroups([5, 1, 9, 2], "a"), ...createGroups([13, 4, 1, 1], "b")];
        for (const capacity of [1, 2, 3, 4, 6])
        {
            const pages = paginateRows(buildRows(groupSpreads(spreads), capacity), 12);
            expect(pages.flat().flatMap((row) => row.ids)).toEqual(spreads.map((spread) => spread.id));
        }
    });

    it("finds the page showing a spread", () =>
    {
        const pages = paginateRows(buildRows(groupSpreads(createGroups([1, 20])), 3), 12);

        expect(findPage(pages, "set-g1-15")).toBe(1);
        expect(findPage(pages, "missing")).toBe(0);
        expect(findPage(pages, null)).toBe(0);
        expect(paginateRows([], 12)).toEqual([]);
    });
});
