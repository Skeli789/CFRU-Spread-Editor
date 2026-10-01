import { describe, expect, it } from "vitest";

import
{
    DEFAULT_FILTERS, FLAG_FILTER, buildRows, countActiveFilters, createFilterContext, findPage, getBalancedRowSizes, getDefaultFilters, getGapTarget,
    getRowCapacity, getMovedIds, getSetLabel, groupSpreads, holdsMegaStone, holdsZCrystal, insertSpread, matchesFilters, moveSpeciesGroup, moveSpread,
    canDropSpread, getSavedOrder, hasOrderChange, getMovedSpreadIds, paginateRows, restoreGroupPosition, restoreSpreadInGroup, restoreSpreadPosition,
} from "../../shared/spread-layout.mjs";
import { AUTO_FIX_CATEGORY, BATTLE_TYPES, MOVE_REMOVAL, compactMoves, getSpreadAutoFix, planSpreadAutoFix } from "../../shared/spread-model.mjs";
import { FRONTIER_SET, LITTLE_CUP_SET, PALMER_SET, PALMER_TRAINER, createCatalog, createFields, createSpreads } from "./EditorFixtures";

const CATALOG = createCatalog();
const SPREADS = createSpreads();
const ALL_IDS = SPREADS.entries.map((entry) => entry.id);

describe("Order and drop validation", () =>
{
    it("distinguishes actual order changes from insertion bookkeeping", () =>
    {
        const set = SPREADS.sets[0];
        const entries = new Map(SPREADS.entries.map((entry) => [entry.id, entry]));
        expect(hasOrderChange(set, undefined, entries)).toBe(false);
        expect(hasOrderChange(set, [...set.entryIds], entries)).toBe(false);
        expect(hasOrderChange(set, ["e2", "e1", "e0"], entries)).toBe(true);
        entries.set("new-1", { id: "new-1", setId: set.id, isNew: true, fields: createFields() });
        expect(getSavedOrder(set, entries)).toEqual(["e0", "e1", "e2", "new-1"]);
        expect(hasOrderChange(set, getSavedOrder(set, entries), entries)).toBe(false);
        expect(hasOrderChange(set, ["e2", "e1", "e0", "new-1"], entries)).toBe(true);
    });

    it("validates event-source peer drops and heading transfers without a selected set", () =>
    {
        const source = { id: "e0", setId: FRONTIER_SET, species: "SPECIES_CHARIZARD" };
        const target = { ...source, id: "e2" };
        expect(canDropSpread(source, target, () => true)).toBe(true);
        expect(canDropSpread(source, target, () => false)).toBe(false);
        expect(canDropSpread(source, source, () => true)).toBe(false);
        expect(canDropSpread(source, { ...target, species: "SPECIES_VENUSAUR" }, () => true)).toBe(false);
        expect(canDropSpread(source, { setId: FRONTIER_SET }, () => true)).toBe(false);
        expect(canDropSpread(source, { setId: LITTLE_CUP_SET }, () => false, () => "")).toBe(true);
        expect(canDropSpread(source, { setId: LITTLE_CUP_SET }, () => true, () => "Blocked")).toBe(false);
        expect(canDropSpread(source, { setId: LITTLE_CUP_SET }, () => true)).toBe(false);
        expect(canDropSpread(null, target, () => true)).toBe(false);
        expect(canDropSpread(source, null, () => true)).toBe(false);
    });
});


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

describe("Spread auto-fix", () =>
{
    it("separates move, IV and EV changes without changing the combined plan", () =>
    {
        const fields = createFields({ moves: [0, "MOVE_FLAMETHROWER", "MOVE_FLAMETHROWER", 0], hpIv: 40, spAtkEv: 255 });
        const fix = getSpreadAutoFix(CATALOG, fields);

        expect(fix.categoryFields).toEqual(
        {
            moves: { moves: ["MOVE_FLAMETHROWER", 0, 0, 0] },
            ivs: { hpIv: 31, atkIv: 0 },
            evs: { spAtkEv: 252 },
        });
        expect(fix.fields).toEqual({ moves: ["MOVE_FLAMETHROWER", 0, 0, 0], hpIv: 31, atkIv: 0, spAtkEv: 252 });
        for (const category of [AUTO_FIX_CATEGORY.MOVES, AUTO_FIX_CATEGORY.IVS, AUTO_FIX_CATEGORY.EVS])
            expect(planSpreadAutoFix(CATALOG, [{ id: "mixed", fields }], category).changes[0].fields).toEqual(fix.categoryFields[category]);
    });

    it("computes IV-only changes against current illegal attacking and slow-Speed moves", () =>
    {
        const fields = createFields({ moves: ["MOVE_GYROBALL", "MOVE_FLAMETHROWER", 0, 0], atkIv: 0, spdIv: 31 });
        const spreads = [{ id: "current-moves", fields }];
        const all = planSpreadAutoFix(CATALOG, spreads);
        const ivs = planSpreadAutoFix(CATALOG, spreads, AUTO_FIX_CATEGORY.IVS);

        expect(all.changes[0].fields).toEqual({ moves: ["MOVE_FLAMETHROWER", 0, 0, 0] });
        expect(ivs.changes[0].fields).toEqual({ atkIv: 31, spdIv: 0 });
        expect(ivs.changes[0].ivFix.changes).toEqual({ atkIv: 31, spdIv: 0 });
        expect(fields.moves[0]).toBe("MOVE_GYROBALL");
    });

    it("preserves current Hidden Power for IV-only fixes even when it is removed by All", () =>
    {
        const catalog = createCatalog();
        delete catalog.learnsets.SPECIES_CHARIZARD.moves.MOVE_HIDDENPOWER;
        const fields = createFields({ moves: ["MOVE_HIDDENPOWER", 0, 0, 0], spAtkIv: 0 });
        const spreads = [{ id: "hidden-power", fields }];

        expect(planSpreadAutoFix(catalog, spreads, AUTO_FIX_CATEGORY.IVS).changes[0].fields).toEqual({ atkIv: 1, spAtkIv: 30 });
        expect(planSpreadAutoFix(catalog, spreads).changes[0].fields).toEqual({ moves: [0, 0, 0, 0], atkIv: 0 });
    });

    it("keeps unknown current move details in the IV-only skipped list", () =>
    {
        const fields = createFields({ moves: ["MOVE_MADEUP", 0, 0, 0] });
        const spreads = [{ id: "unknown-current", fields }];
        const ivs = planSpreadAutoFix(CATALOG, spreads, AUTO_FIX_CATEGORY.IVS);

        expect(ivs.changes).toEqual([]);
        expect(ivs.skipped).toEqual([{ id: "unknown-current", stats: ["atk", "spAtk"] }]);
        expect(planSpreadAutoFix(CATALOG, spreads).skipped).toEqual([]);
    });

    it("caps each EV at 252 before repairing the total and leaves the input unchanged", () =>
    {
        const fields = createFields({ hpEv: 255, atkEv: 0, defEv: 0, spAtkEv: 255, spDefEv: 0, spdEv: 0 });
        const fix = getSpreadAutoFix(CATALOG, fields);

        expect(fix.evFix).toEqual({ hpEv: 252, spAtkEv: 252 });
        expect(fix.fields).toMatchObject(fix.evFix);
        expect(fields.hpEv).toBe(255);
        expect(fields.spAtkEv).toBe(255);
    });

    it("reduces the smallest non-maxed EV investments first with stat-order ties", () =>
    {
        const fields = createFields({ hpEv: 8, atkEv: 252, defEv: 8, spAtkEv: 0, spDefEv: 0, spdEv: 252 });
        const plan = planSpreadAutoFix(CATALOG, [{ id: "over-budget", fields }]);

        expect(plan.changes[0].evFix).toEqual({ hpEv: 0, defEv: 6 });
        expect(plan.changes[0].fields).toMatchObject({ hpEv: 0, defEv: 6 });
        expect(plan.changes[0].fields).not.toHaveProperty("atkEv");
        expect(plan.changes[0].fields).not.toHaveProperty("spdEv");
    });

    it("reduces maxed EVs only after exhausting non-maxed investments", () =>
    {
        const fields = createFields({ hpEv: 252, atkEv: 252, defEv: 4, spAtkEv: 0, spDefEv: 0, spdEv: 252 });
        const fix = getSpreadAutoFix(CATALOG, fields);

        expect(fix.evFix).toEqual({ hpEv: 6, defEv: 0 });
        expect({ ...fields, ...fix.evFix }).toMatchObject({ hpEv: 6, atkEv: 252, defEv: 0, spdEv: 252 });
    });

    it("preserves legal non-multiple-of-four EVs, including Little Cup spreads", () =>
    {
        const fields = createFields({ species: "SPECIES_PICHU", hpEv: 0, atkEv: 252, defEv: 0, spAtkEv: 0, spDefEv: 6, spdEv: 252 });
        const fix = getSpreadAutoFix(CATALOG, fields);

        expect(fix.evFix).toEqual({});
        expect(getSpreadAutoFix(CATALOG, { ...fields, spDefEv: 7 }).evFix).toEqual({ spDefEv: 6 });
    });

    it("shifts moves up over blank slots", () =>
    {
        const fields = createFields({ moves: [0, "MOVE_FLAMETHROWER", "MOVE_NONE", "MOVE_PROTECT"] });
        expect(compactMoves(fields).moves).toEqual(["MOVE_FLAMETHROWER", "MOVE_PROTECT", 0, "MOVE_NONE"]);
        const ordered = createFields({ moves: ["MOVE_FLAMETHROWER", 0, 0, 0] });
        expect(compactMoves(ordered)).toBe(ordered);
    });

    it("removes illegal, unknown and repeated moves, lowers IVs over 31, then fixes attacking IVs", () =>
    {
        const fields = createFields({ moves: ["MOVE_THUNDERBOLT", "MOVE_FLAMETHROWER", "MOVE_MADEUP", "MOVE_FLAMETHROWER"], hpIv: 45, atkIv: 31 });
        const fix = getSpreadAutoFix(CATALOG, fields);
        expect(fix.removedMoves).toEqual([
            { move: "MOVE_THUNDERBOLT", reason: MOVE_REMOVAL.ILLEGAL },
            { move: "MOVE_MADEUP", reason: MOVE_REMOVAL.UNDEFINED },
            { move: "MOVE_FLAMETHROWER", reason: MOVE_REMOVAL.DUPLICATE },
        ]);
        expect(fix.cappedIvs).toEqual(["hpIv"]);
        expect(fix.fields).toEqual({ moves: ["MOVE_FLAMETHROWER", 0, 0, 0], hpIv: 31, atkIv: 0 });
    });

    it("plans only the spreads that change", () =>
    {
        const fixed = createFields({ moves: ["MOVE_FLAMETHROWER", 0, 0, 0], atkIv: 0 });
        const gapped = createFields({ moves: [0, "MOVE_FLAMETHROWER", 0, 0], atkIv: 0 });
        const plan = planSpreadAutoFix(CATALOG, [{ id: "a", fields: fixed }, { id: "b", fields: gapped }]);
        expect(plan.changes.map((change) => [change.id, change.compacted, change.fields])).toEqual([["b", true, { moves: ["MOVE_FLAMETHROWER", 0, 0, 0] }]]);
    });

    it("keeps unknown-detail stats in the plan while still fixing known changes", () =>
    {
        const catalog = createCatalog();
        catalog.moves.MOVE_FLAMETHROWER = { name: "Flamethrower" };
        const fields = createFields({ moves: ["MOVE_FLAMETHROWER", 0, 0, 0], hpIv: 40 });
        const plan = planSpreadAutoFix(catalog, [{ id: "unknown", fields }]);

        expect(plan.changes).toHaveLength(1);
        expect(plan.changes[0].fields).toEqual({ hpIv: 31 });
        expect(plan.skipped).toEqual([{ id: "unknown", stats: ["atk", "spAtk"] }]);
    });

    it("excludes placeholders from changes and unknown-detail stats", () =>
    {
        const catalog = createCatalog();
        catalog.moves.MOVE_FLAMETHROWER = { name: "Flamethrower" };
        const fields = createFields({ moves: ["MOVE_FLAMETHROWER", 0, 0, 0], hpIv: 40 });
        const plan = planSpreadAutoFix(catalog,
        [
            { id: "placeholder", fields, placeholder: true },
            { id: "active", fields },
        ]);

        expect(plan.changes.map((change) => change.id)).toEqual(["active"]);
        expect(plan.skipped).toEqual([{ id: "active", stats: ["atk", "spAtk"] }]);
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
    it("inserts alongside species peers and moves only their source slots", () =>
    {
        const entries = new Map([["a", { setId: "set", fields: { species: "A" } }], ["b", { setId: "set", fields: { species: "B" } }],
            ["c", { setId: "set", fields: { species: "A" } }], ["new-1", { setId: "set", fields: { species: "A" } }]]);
        const inserted = insertSpread(["a", "b", "c"], entries, "new-1");
        expect(inserted).toEqual(["a", "b", "c", "new-1"]);
        expect(moveSpread(inserted, entries, "a", "c")).toEqual(["c", "b", "a", "new-1"]);
        expect(moveSpread(inserted, entries, "a", "b")).toBe(inserted);
        entries.set("outside", { setId: "other", fields: { species: "A" } });
        expect(moveSpread(inserted, entries, "a", "outside")).toBe(inserted);
        expect([...getMovedIds(["a", "b", "c"], ["c", "b", "a", "new-1"], new Set(["a"]))].sort()).toEqual(["a", "c"]);
        expect(getMovedIds(["a", "b", "c"], inserted).size).toBe(0);
    });

    it("marks only the spreads the user moved, not the ones they were moved past", () =>
    {
        const saved = ["a", "b", "c", "d", "e"];
        expect([...getMovedIds(saved, ["b", "c", "d", "a", "e"], new Set(["a"]))]).toEqual(["a"]);
        expect([...getMovedIds(saved, ["b", "c", "d", "a", "e"])]).toEqual(["a"]);
        expect([...getMovedIds(saved, ["c", "d", "e", "a", "b"], new Set(["a", "b"]))].sort()).toEqual(["a", "b"]);
        expect([...getMovedIds(saved, ["d", "e", "a", "b", "c"], new Set(["d", "e"]))].sort()).toEqual(["d", "e"]);
        expect(getMovedIds(saved, saved, new Set(["a"])).size).toBe(0);
    });

    it("puts one moved spread back without undoing other moves", () =>
    {
        const saved = ["a", "b", "c", "d"];
        expect(restoreSpreadPosition(saved, ["b", "c", "a", "d"], "a")).toEqual(saved);
        expect(restoreSpreadPosition(saved, ["b", "a", "d", "c"], "c")).toEqual(["b", "c", "a", "d"]);
        expect(restoreSpreadPosition(saved, ["b", "c", "d", "new-1", "a"], "a")).toEqual(["a", "b", "c", "d", "new-1"]);
    });

    it("tells moves within a species apart from moves of the whole group, and reverts each alone", () =>
    {
        // a1 and a2 are one species, b another; the group moved after b, then a1 moved after a2 within it
        const species = { a1: "A", a2: "A", b: "B" };
        const getSpecies = (id) => species[id];
        const saved = ["a1", "a2", "b"];
        const current = ["b", "a2", "a1"];
        expect([...getMovedSpreadIds(saved, current, getSpecies, new Set(["a1"]))]).toEqual(["a1"]);
        expect(getMovedSpreadIds(saved, ["b", "a1", "a2"], getSpecies).size).toBe(0);
        expect(restoreGroupPosition(saved, current, ["a2", "a1"])).toEqual(["a2", "a1", "b"]);
        expect(restoreSpreadInGroup(saved, current, ["a2", "a1"], "a1")).toEqual(["b", "a1", "a2"]);
    });

    it("moves whole species groups only by explicit request and flags interleaved source", () =>
    {
        const entries = new Map([["a", { setId: "set", fields: { species: "A" } }], ["b", { setId: "set", fields: { species: "B" } }],
            ["c", { setId: "set", fields: { species: "A" } }]]);
        expect(moveSpeciesGroup(["a", "b", "c"], entries, "A", 1)).toEqual({ order: ["b", "a", "c"], coalesces: true });
        expect(moveSpeciesGroup(["a", "b", "c"], entries, "A", 0).order).toEqual(["a", "b", "c"]);
        expect(moveSpeciesGroup(["a", "b", "c"], entries, "A", 5).order).toEqual(["a", "b", "c"]);
    });

    it("turns a drop between groups into the group's new position", () =>
    {
        expect(getGapTarget(0, 3)).toBe(2);
        expect(getGapTarget(2, 0)).toBe(0);
        expect(getGapTarget(1, 1)).toBe(1);
        expect(getGapTarget(1, 2)).toBe(1);
    });

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
