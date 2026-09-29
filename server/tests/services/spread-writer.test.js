/**
 * Test file for saving spread changes.
 * Every test works on disposable copies of synthetic repositories, never the attached CFRU checkout.
 * Tests minimal edits, comments, new entries, reordering, validation, conflicts, failed replacements and recovery.
 */

const { expect } = require("chai");
const fs = require("fs");
const path = require("path");

const { getWorkspace, loadWorkspace } = require("../../services/repositories");
const { createParseCache } = require("../../services/parse-cache");
const { createSpreadStore } = require("../../services/spread-store");
const { createFixtureRepositories } = require("../helpers/fixture-repositories");
const { CONFIG_VANILLA } = require("../helpers/spread-fixtures");

const BATTLE_TOWER = "src/Tables/battle_tower_spreads.h";
const SPECIAL_TRAINERS = "src/Tables/frontier_special_trainer_spreads.h";
const MULTI_SPREADS = "src/Tables/frontier_multi_spreads.h";
const RAID_PARTNERS = "src/Tables/raid_partners.h";
const CONFIG = "src/config.h";
const SPREAD_FILES = [BATTLE_TOWER, SPECIAL_TRAINERS, MULTI_SPREADS, RAID_PARTNERS];
const GAME_WITH_ABILITIES = "zeta";
const RETRY_DELAY_MS = 1;
const FIXTURE_TIMEOUT_MS = 20000;
const PARSED_FILE_COUNT = 7;

const NEW_SPREAD =
{
    species: "SPECIES_BULBASAUR",
    nature: "NATURE_HARDY",
    hpIv: 31, atkIv: 31, defIv: 31, spAtkIv: 31, spDefIv: 31, spdIv: 31,
    ability: 1,
    item: "ITEM_NONE",
    ball: "BALL_TYPE_RANDOM",
    moves: ["MOVE_TACKLE", "MOVE_HIDDENPOWER"],
    forSingles: true,
    forDoubles: true,
    modifyMovesDoubles: true,
};


/**
 * Returns the lines that differ between two texts, assuming one changed region.
 *
 * @param {string} before The original text.
 * @param {string} after The new text.
 * @returns {{removed: Array<string>, added: Array<string>}} The differing lines.
 */
function changedLines(before, after)
{
    const a = before.split("\n");
    const b = after.split("\n");
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start])
        start++;

    let endA = a.length;
    let endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1])
    {
        endA--;
        endB--;
    }

    return { removed: a.slice(start, endA), added: b.slice(start, endB) };
}

/**
 * Returns an fs.promises-compatible object with some methods replaced.
 *
 * @param {object} overrides Replacement methods.
 * @returns {object} The file system.
 */
function createFileSystem(overrides = {})
{
    const methods = ["open", "rename", "readFile", "mkdir", "rm", "readdir"];
    return { ...Object.fromEntries(methods.map((name) => [name, (...args) => fs.promises[name](...args)])), ...overrides };
}

/**
 * Returns an error with a Node error code.
 *
 * @param {string} code The code.
 * @returns {Error} The error.
 */
function codedError(code)
{
    return Object.assign(new Error(code), { code });
}

describe("Spread Saving", function ()
{
    this.timeout(FIXTURE_TIMEOUT_MS);

    let fixture;
    let dataDirectory;

    const cfruPath = (file) => path.join(fixture.paths.cfru, ...file.split("/"));
    const readText = (file) => fs.readFileSync(cfruPath(file), "utf8");
    const readBytes = (file) => fs.readFileSync(cfruPath(file));
    const readAllSpreadFiles = () => Object.fromEntries(SPREAD_FILES.map((file) => [file, readBytes(file)]));

    /**
     * Loads the fixture workspace into a store.
     *
     * @param {object} [options] Store options.
     * @returns {Promise<{workspace: object, store: object, spreads: object, diagnostics: Array<object>}>} The loaded workspace.
     */
    async function load(options = {})
    {
        const store = createSpreadStore({ dataDirectory, retryDelayMs: RETRY_DELAY_MS, ...options });
        const workspace = getWorkspace((await loadWorkspace(fixture.paths)).workspaceId);
        const { spreads, diagnostics } = await store.loadSpreads(workspace);
        return { workspace, store, spreads, diagnostics };
    }

    const findEntry = (spreads, species) => spreads.entries.find((entry) => entry.fields.species === species);
    const findSet = (spreads, name) => spreads.sets.find((set) => set.name === name);

    /**
     * Expects a save to be rejected.
     *
     * @param {Promise} promise The save.
     * @param {number} status The expected status.
     * @param {string} code The expected error code.
     * @returns {Promise<object>} The error.
     */
    async function expectRejected(promise, status, code)
    {
        try
        {
            await promise;
        }
        catch (error)
        {
            expect(error.code).to.equal(code);
            expect(error.status).to.equal(status);
            return error;
        }

        throw new Error(`Expected the save to fail with ${code}.`);
    }

    beforeEach(() =>
    {
        fixture = createFixtureRepositories();
        dataDirectory = path.join(fixture.base, "editor data");
    });

    afterEach(() =>
    {
        fixture.cleanup();
    });

    describe("Loading", () =>
    {
        it("should load spreads, trainer links and set permissions", async () =>
        {
            const { spreads, diagnostics } = await load();
            expect(spreads.entries).to.have.length(15);
            expect(spreads.configuration.defines).to.include("UNBOUND");
            expect(diagnostics.filter((diagnostic) => diagnostic.severity === "error")).to.deep.equal([]);

            // Little Cup comes from the known pool and trainer pointers only
            expect(spreads.sets.filter((set) => set.littleCup).map((set) => set.name)).to.deep.equal(["gLittleCupSpreads", "gLittleCupTowerSpread_Palmer1"]);
            expect(findSet(spreads, "sRaidPartnerSpread_Catherine_Rank12").usages[0]).to.include({ trainerName: "Catherine", role: "raid" });
            expect(findSet(spreads, "sRaidPartnerSpread_Catherine_Rank12").usages[0].ranks).to.deep.equal([1, 2]);
            expect(findSet(spreads, "gSpecialTowerSpread_Palmer1").category).to.equal("specialTrainer");

            // Arrays whose size would not include new spreads cannot grow
            expect(findSet(spreads, "gSpecialTowerSpread_Fixed").insertBlockedReason).to.match(/fixed size of 2/);
            expect(findSet(spreads, "sRaidPartnerSpread_Catherine_Rank3").insertBlockedReason).to.match(/uses 1 as the size/);
            expect(findSet(spreads, "gFrontierSpreads").canInsert).to.equal(true);
            expect(findEntry(spreads, "SPECIES_GOLEM").editable).to.equal(false);
        });

        it("should list the doubles team types frontier.h compiles", async () =>
        {
            const { spreads } = await load();
            expect(spreads.teamTypes.map((teamType) => teamType.name)).to.deep.equal(["DOUBLES_ANY_TEAM", "DOUBLES_SUN_TEAM", "DOUBLES_TRICK_ROOM_TEAM", "DOUBLES_TAILWIND_TEAM"]);
            expect(findEntry(spreads, "SPECIES_CHARIZARD").fields.specificTeamType).to.equal("DOUBLES_SUN_TEAM");
        });
    });

    describe("Parse cache", () =>
    {
        let parses;

        /**
         * Returns a cache in the fixture's data folder that counts the files it has to parse.
         *
         * @returns {object} The cache.
         */
        function createCountingCache()
        {
            const cache = createParseCache({ directory: path.join(dataDirectory, "cache") });
            return {
                ...cache,
                getOrCreate: (namespace, slot, inputs, create) => cache.getOrCreate(namespace, slot, inputs, () =>
                {
                    parses.push(`${namespace}:${slot.split("\n").pop()}`);
                    return create();
                }),
            };
        }

        const loadCounted = () => load({ cache: createCountingCache() });

        beforeEach(() =>
        {
            parses = [];
        });

        it("should reuse every parse when nothing changed", async () =>
        {
            const first = await loadCounted();
            expect(parses).to.have.length(PARSED_FILE_COUNT);

            parses = [];
            const second = await loadCounted();
            expect(parses).to.deep.equal([]);
            expect(second.spreads).to.deep.equal(first.spreads);
        });

        it("should parse only a file that changed", async () =>
        {
            await loadCounted();
            fs.appendFileSync(cfruPath(BATTLE_TOWER), "//Edited outside the editor\r\n");

            parses = [];
            await loadCounted();
            expect(parses).to.deep.equal([`spread-file:${BATTLE_TOWER}`]);
        });

        it("should parse everything again only when configuration macros change", async () =>
        {
            await loadCounted();
            fs.appendFileSync(cfruPath(CONFIG), "//A comment\r\n");

            parses = [];
            await loadCounted();
            expect(parses).to.deep.equal([]);

            fs.writeFileSync(cfruPath(CONFIG), CONFIG_VANILLA);
            await loadCounted();
            expect(parses).to.have.length(PARSED_FILE_COUNT);
        });

        it("should reuse the parse from a save on the next load", async () =>
        {
            const { store, workspace, spreads } = await loadCounted();
            const result = await store.saveSpreads(workspace, { revision: spreads.revision, operations: [{ type: "update", entryId: findEntry(spreads, "SPECIES_VENUSAUR").id, fields: { hpEv: 248 } }] });

            parses = [];
            const reloaded = await loadCounted();
            expect(parses).to.deep.equal([]);
            expect(reloaded.spreads.entries.map((entry) => entry.fields)).to.deep.equal(result.spreads.entries.map((entry) => entry.fields));
        });
    });

    describe("Minimal edits", () =>
    {
        it("should leave every file byte-for-byte unchanged when nothing changes", async () =>
        {
            const before = readAllSpreadFiles();
            const { store, workspace, spreads } = await load();
            const venusaur = findEntry(spreads, "SPECIES_VENUSAUR");

            const result = await store.saveSpreads(workspace, { revision: spreads.revision, operations: [{ type: "update", entryId: venusaur.id, fields: { hpEv: 252 } }] });
            expect(result.files).to.deep.equal([]);
            expect(result.backupId).to.equal(null);
            for (const file of SPREAD_FILES)
                expect(readBytes(file).equals(before[file]), file).to.equal(true);
        });

        it("should change only the line of an edited value", async () =>
        {
            const before = readText(BATTLE_TOWER);
            const { store, workspace, spreads } = await load();
            const venusaur = findEntry(spreads, "SPECIES_VENUSAUR");

            const result = await store.saveSpreads(workspace, { revision: spreads.revision, operations: [{ type: "update", entryId: venusaur.id, fields: { hpEv: 248 } }] });
            expect(result.files).to.deep.equal([{ path: BATTLE_TOWER, status: "saved" }]);
            expect(changedLines(before, readText(BATTLE_TOWER))).to.deep.equal({ removed: ["\t\t.hpEv = 252,\r"], added: ["\t\t.hpEv = 248,\r"] });
            expect(findEntry(result.spreads, "SPECIES_VENUSAUR")).to.include({ id: venusaur.id });
            expect(result.spreads.revision).to.not.equal(spreads.revision);
        });

        it("should add an omitted field after the field before it", async () =>
        {
            const before = readText(BATTLE_TOWER);
            const { store, workspace, spreads } = await load();
            const venusaur = findEntry(spreads, "SPECIES_VENUSAUR");

            await store.saveSpreads(workspace, { revision: spreads.revision, operations: [{ type: "update", entryId: venusaur.id, fields: { atkEv: 4 } }] });
            expect(changedLines(before, readText(BATTLE_TOWER))).to.deep.equal({ removed: [], added: ["\t\t.atkEv = 4,\r"] });
            expect(readText(BATTLE_TOWER)).to.include("\t\t.hpEv = 252,\r\n\t\t.atkEv = 4,\r\n\t\t.defEv = 252,\r\n");
        });

        it("should change and add doubles team types", async () =>
        {
            const before = readText(BATTLE_TOWER);
            const { store, workspace, spreads } = await load();
            const charizard = findEntry(spreads, "SPECIES_CHARIZARD");
            const venusaur = findEntry(spreads, "SPECIES_VENUSAUR");

            const result = await store.saveSpreads(workspace, { revision: spreads.revision, operations:
            [
                { type: "update", entryId: charizard.id, fields: { specificTeamType: "DOUBLES_TRICK_ROOM_TEAM" } },
                { type: "update", entryId: venusaur.id, fields: { specificTeamType: "DOUBLES_SUN_TEAM" } },
            ] });
            const after = readText(BATTLE_TOWER);
            expect(after).to.include("\t\t.modifyMovesDoubles = TRUE,\r\n\t\t.specificTeamType = DOUBLES_SUN_TEAM,\r\n\t},\r\n\t//Gen 8");
            expect(after).to.include(".gigantamax = TRUE,\r\n\t\t.specificTeamType = DOUBLES_TRICK_ROOM_TEAM,\r\n");
            expect(after.split("\n")).to.have.length(before.split("\n").length + 1);
            expect(findEntry(result.spreads, "SPECIES_VENUSAUR").fields.specificTeamType).to.equal("DOUBLES_SUN_TEAM");
        });

        it("should keep Unicode comments and LF line endings", async () =>
        {
            const before = readText(SPECIAL_TRAINERS);
            const { store, workspace, spreads } = await load();
            const garchomp = findEntry(spreads, "SPECIES_GARCHOMP");

            await store.saveSpreads(workspace, { revision: spreads.revision, operations: [{ type: "update", entryId: garchomp.id, fields: { item: "ITEM_CHOICE_SCARF" } }] });
            const after = readText(SPECIAL_TRAINERS);
            expect(changedLines(before, after)).to.deep.equal({ removed: ["\t\t.item = ITEM_LIFE_ORB,"], added: ["\t\t.item = ITEM_CHOICE_SCARF,"] });
            expect(after).to.include("SPECIES_GARCHOMP, //Pokémon ✓");
            expect(after).to.not.include("\r");
        });
    });

    describe("Comments", () =>
    {
        it("should update the Hidden Power comment when the IVs change its type", async () =>
        {
            const before = readText(BATTLE_TOWER);
            const { store, workspace, spreads } = await load();
            const venusaur = findEntry(spreads, "SPECIES_VENUSAUR");

            const result = await store.saveSpreads(workspace, { revision: spreads.revision, operations: [{ type: "update", entryId: venusaur.id, fields: { atkIv: 1 } }] });
            const after = readText(BATTLE_TOWER);
            expect(after).to.include("\t\t\tMOVE_HIDDENPOWER, //TYPE_DARK\r\n");
            expect(before.split("\n").filter((line, index) => line !== after.split("\n")[index])).to.have.length(2);
            expect(findEntry(result.spreads, "SPECIES_VENUSAUR").hiddenPowerComments[1]).to.equal("TYPE_DARK");
        });

        it("should remove a type comment when Hidden Power is replaced and add one for a new Hidden Power", async () =>
        {
            const { store, workspace, spreads } = await load();
            const venusaur = findEntry(spreads, "SPECIES_VENUSAUR");
            const charizard = findEntry(spreads, "SPECIES_CHARIZARD");

            await store.saveSpreads(workspace, { revision: spreads.revision, operations:
            [
                { type: "update", entryId: venusaur.id, fields: { moves: ["MOVE_GIGADRAIN", "MOVE_SLUDGEBOMB", "MOVE_LEECHSEED", "MOVE_SYNTHESIS"] } },
                { type: "update", entryId: charizard.id, fields: { moves: ["MOVE_FLAMETHROWER", "MOVE_AIRSLASH", "MOVE_HIDDENPOWER"] } },
            ] });

            const after = readText(BATTLE_TOWER);
            expect(after).to.include("\t\t\tMOVE_SLUDGEBOMB,\r\n\t\t\tMOVE_LEECHSEED,");
            expect(after).to.include("\t\t\tMOVE_AIRSLASH,\r\n\t\t\tMOVE_HIDDENPOWER, //TYPE_DARK\r\n\t\t},");
        });

        it("should update the ability comment using the selected game's abilities", async () =>
        {
            const { store, workspace, spreads } = await load();
            const venusaur = findEntry(spreads, "SPECIES_VENUSAUR");

            await store.saveSpreads(workspace, { revision: spreads.revision, gameId: GAME_WITH_ABILITIES, operations: [{ type: "update", entryId: venusaur.id, fields: { ability: 2 } }] });
            expect(readText(BATTLE_TOWER)).to.include("\t\t.ability = FRONTIER_ABILITY_2, //ABILITY_THICKFAT\r\n");
        });
    });

    describe("New entries and order", () =>
    {
        it("should remove a deleted spread's lines entirely", async () =>
        {
            const { store, workspace, spreads } = await load();
            const venusaur = findEntry(spreads, "SPECIES_VENUSAUR");
            const before = readText(BATTLE_TOWER);
            const result = await store.saveSpreads(workspace, { revision: spreads.revision, operations: [{ type: "delete", entryId: venusaur.id }] });
            const after = readText(BATTLE_TOWER);

            expect(after).to.include("gFrontierSpreads[] =\r\n{\r\n\t//Gen 8\r\n\t{\r\n\t\t.species = SPECIES_CHARIZARD,");
            expect(after).not.to.include("SPECIES_VENUSAUR");
            expect(before.split("\r\n").length - after.split("\r\n").length).to.equal(25);
            expect(result.spreads.entries.find((entry) => entry.id === venusaur.id)).to.equal(undefined);
            expect(findSet(result.spreads, "gFrontierSpreads").entryIds).not.to.include(venusaur.id);
        });

        it("should remove a last spread that has no trailing comma", async () =>
        {
            const { store, workspace, spreads } = await load();
            const raichu = findEntry(spreads, "SPECIES_RAICHU");
            await store.saveSpreads(workspace, { revision: spreads.revision, operations: [{ type: "delete", entryId: raichu.id }] });
            const after = readText(MULTI_SPREADS);

            expect(after).not.to.include("SPECIES_RAICHU");
            expect(after).to.include("\t\t.modifyMovesDoubles = TRUE,\r\n\t},\r\n};");
        });

        it("should insert a new spread where a deleted last spread was", async () =>
        {
            const { store, workspace, spreads } = await load();
            const set = findSet(spreads, "gMultiTowerSpread_Milo");
            const raichu = findEntry(spreads, "SPECIES_RAICHU");
            const result = await store.saveSpreads(workspace, { revision: spreads.revision, operations:
            [
                { type: "delete", entryId: raichu.id },
                { type: "add", tempId: "new-1", setId: set.id, fields: NEW_SPREAD },
            ] });

            expect(readText(MULTI_SPREADS)).not.to.include("SPECIES_RAICHU");
            expect(findSet(result.spreads, "gMultiTowerSpread_Milo").entryIds).to.have.length(2);
        });

        it("should reject deleting every spread in a set", async () =>
        {
            const { store, workspace, spreads } = await load();
            const bulbasaur = findEntry(spreads, "SPECIES_BULBASAUR");
            await expectRejected(store.saveSpreads(workspace, { revision: spreads.revision, operations: [{ type: "delete", entryId: bulbasaur.id }] }), 422, "INVALID_OPERATION");
        });

        it("should insert new spreads using the file's formatting and give them IDs", async () =>
        {
            const { store, workspace, spreads } = await load();
            const set = findSet(spreads, "gFrontierSpreads");
            const venusaur = findEntry(spreads, "SPECIES_VENUSAUR");

            const result = await store.saveSpreads(workspace, { revision: spreads.revision, gameId: GAME_WITH_ABILITIES, operations:
            [
                { type: "add", tempId: "after-venusaur", setId: set.id, afterEntryId: venusaur.id, fields: { ...NEW_SPREAD, species: "SPECIES_VENUSAUR" } },
                { type: "add", tempId: "at-end", setId: set.id, fields: { ...NEW_SPREAD, shiny: true } },
            ] });

            const after = readText(BATTLE_TOWER);
            const newVenusaur = result.createdIds["after-venusaur"];
            expect(result.spreads.sets.find((candidate) => candidate.id === set.id).entryIds).to.deep.equal([venusaur.id, newVenusaur, ...set.entryIds.slice(1), result.createdIds["at-end"]]);
            expect(after).to.include(
            [
                "\t{",
                "\t\t.species = SPECIES_VENUSAUR,",
                "\t\t.nature = NATURE_HARDY,",
                "\t\t.hpIv = 31,",
                "\t\t.atkIv = 31,",
                "\t\t.defIv = 31,",
                "\t\t.spAtkIv = 31,",
                "\t\t.spDefIv = 31,",
                "\t\t.spdIv = 31,",
                "\t\t.ability = FRONTIER_ABILITY_1, //ABILITY_OVERGROW",
                "\t\t.item = ITEM_NONE,",
                "\t\t.moves =",
                "\t\t{",
                "\t\t\tMOVE_TACKLE,",
                "\t\t\tMOVE_HIDDENPOWER, //TYPE_DARK",
                "\t\t},",
                "\t\t.ball = BALL_TYPE_RANDOM,",
                "\t\t.forSingles = TRUE,",
                "\t\t.forDoubles = TRUE,",
                "\t\t.modifyMovesDoubles = TRUE,",
                "\t},",
                "\t//Gen 8",
            ].join("\r\n"));
            expect(after).to.include("\t\t.ball = BALL_TYPE_RANDOM,\r\n\t\t.shiny = TRUE,\r\n");
        });

        it("should add after a last entry without a comma and keep the byte order mark", async () =>
        {
            const { store, workspace, spreads } = await load();
            const set = findSet(spreads, "gMultiTowerSpread_Milo");

            await store.saveSpreads(workspace, { revision: spreads.revision, operations: [{ type: "add", tempId: "new", setId: set.id, fields: NEW_SPREAD }] });
            const after = readText(MULTI_SPREADS);
            expect(after.startsWith("\uFEFF")).to.equal(true);
            expect(after).to.match(/MOVE_THUNDER\r\n\t\t},[\s\S]*\t},\r\n\t\{\r\n\t\t\.species = SPECIES_BULBASAUR,[\s\S]*\t\}\r\n\};/);
        });

        it("should replace the placeholder of an empty array and leave the inactive branch unchanged", async () =>
        {
            fs.writeFileSync(cfruPath(CONFIG), CONFIG_VANILLA);
            const before = readText(BATTLE_TOWER);
            const { store, workspace, spreads } = await load();
            const set = findSet(spreads, "gFrontierSpreads");
            expect(set.entryIds).to.deep.equal([]);
            expect(set.placeholderCount).to.equal(1);

            const result = await store.saveSpreads(workspace, { revision: spreads.revision, operations: [{ type: "add", tempId: "first", setId: set.id, fields: NEW_SPREAD }] });
            const after = readText(BATTLE_TOWER);
            const elseIndex = before.indexOf("#else");
            expect(after.slice(0, elseIndex)).to.equal(before.slice(0, elseIndex));
            expect(after.slice(elseIndex)).to.include("const struct BattleTowerSpread gFrontierSpreads[] =\r\n{\r\n\t{\r\n\t\t.species = SPECIES_BULBASAUR,");
            expect(findSet(result.spreads, "gFrontierSpreads").placeholderCount).to.equal(0);
        });

        it("should reorder spreads by ID and keep their IDs", async () =>
        {
            const before = readText(SPECIAL_TRAINERS);
            const { store, workspace, spreads } = await load();
            const set = findSet(spreads, "gSpecialTowerSpread_Palmer1");
            const [garchomp, tyranitar, metagross, salamence] = set.entryIds;

            const result = await store.saveSpreads(workspace, { revision: spreads.revision, operations: [{ type: "reorder", setId: set.id, order: [garchomp, tyranitar, salamence, metagross] }] });
            expect(findSet(result.spreads, "gSpecialTowerSpread_Palmer1").entryIds).to.deep.equal([garchomp, tyranitar, salamence, metagross]);
            expect(result.spreads.entries.find((entry) => entry.id === salamence).fields.species).to.equal("SPECIES_SALAMENCE");

            // Swapping back restores the original bytes
            await store.saveSpreads(workspace, { revision: result.spreads.revision, operations: [{ type: "reorder", setId: set.id, order: [garchomp, tyranitar, metagross, salamence] }] });
            expect(readText(SPECIAL_TRAINERS)).to.equal(before);
        });

        it("should not move spreads past a preprocessor directive", async () =>
        {
            const { store, workspace, spreads } = await load();
            const set = findSet(spreads, "gSpecialTowerSpread_Palmer1");
            const [garchomp, tyranitar, metagross, salamence] = set.entryIds;

            await expectRejected(store.saveSpreads(workspace, { revision: spreads.revision, operations: [{ type: "reorder", setId: set.id, order: [metagross, tyranitar, garchomp, salamence] }] }), 422, "INVALID_OPERATION");
        });

        it("should match the saved snapshot when the files are loaded again", async () =>
        {
            const { store, workspace, spreads } = await load();
            const set = findSet(spreads, "gFrontierSpreads");
            const [venusaur, charizard, pikachu] = set.entryIds;

            const result = await store.saveSpreads(workspace, { revision: spreads.revision, operations:
            [
                { type: "add", tempId: "new", setId: set.id, fields: NEW_SPREAD },
                { type: "reorder", setId: set.id, order: [charizard, "new", venusaur, pikachu] },
                { type: "update", entryId: venusaur, fields: { spdIv: 30 } },
            ] });

            const reloaded = await load();
            const strip = (snapshot) => snapshot.entries.map(({ fields, explicitFields, unknownFields, hiddenPowerComments }) => ({ fields, explicitFields, unknownFields, hiddenPowerComments }));
            expect(strip(reloaded.spreads)).to.deep.equal(strip(result.spreads));
            expect(reloaded.spreads.revision).to.equal(result.spreads.revision);
        });
    });

    describe("Validation", () =>
    {
        it("should reject changes that are invalid or could inject source text", async () =>
        {
            const before = readAllSpreadFiles();
            const { store, workspace, spreads } = await load();
            const venusaur = findEntry(spreads, "SPECIES_VENUSAUR");
            const golem = findEntry(spreads, "SPECIES_GOLEM");
            const frontier = findSet(spreads, "gFrontierSpreads");
            const save = (operations) => store.saveSpreads(workspace, { revision: spreads.revision, operations });

            await expectRejected(save([{ type: "update", entryId: venusaur.id, fields: { species: "SPECIES_X, .hpIv = 0" } }]), 422, "INVALID_OPERATION");
            await expectRejected(save([{ type: "update", entryId: venusaur.id, fields: { item: "MOVE_TACKLE" } }]), 422, "INVALID_OPERATION");
            await expectRejected(save([{ type: "update", entryId: venusaur.id, fields: { futureField: 1 } }]), 422, "INVALID_OPERATION");
            await expectRejected(save([{ type: "update", entryId: venusaur.id, fields: { hpIv: 32 } }]), 422, "INVALID_OPERATION");
            await expectRejected(save([{ type: "update", entryId: venusaur.id, fields: { specificTeamType: "DOUBLES_VANILLA_TEAM" } }]), 422, "INVALID_OPERATION");
            await expectRejected(save([{ type: "add", tempId: "x", setId: frontier.id, fields: { ...NEW_SPREAD, specificTeamType: "DOUBLES_MADE_UP_TEAM" } }]), 422, "INVALID_OPERATION");
            await expectRejected(save([{ type: "update", entryId: venusaur.id, fields: { spAtkEv: 8 } }]), 422, "INVALID_OPERATION");
            await expectRejected(save([{ type: "update", entryId: venusaur.id, fields: { moves: ["MOVE_A", "MOVE_B", "MOVE_C", "MOVE_D", "MOVE_E"] } }]), 422, "INVALID_OPERATION");
            await expectRejected(save([{ type: "update", entryId: golem.id, fields: { hpIv: 30 } }]), 422, "INVALID_OPERATION");
            await expectRejected(save([{ type: "update", entryId: "missing", fields: { hpIv: 30 } }]), 422, "INVALID_OPERATION");
            await expectRejected(save([{ type: "add", tempId: "x", setId: frontier.id, fields: { ...NEW_SPREAD, moves: [] } }]), 422, "INVALID_OPERATION");
            await expectRejected(save([{ type: "add", tempId: "x", setId: findSet(spreads, "gSpecialTowerSpread_Fixed").id, fields: NEW_SPREAD }]), 422, "INVALID_OPERATION");
            await expectRejected(save([{ type: "add", tempId: "x", setId: frontier.id, fields: NEW_SPREAD }, { type: "add", tempId: "x", setId: frontier.id, fields: NEW_SPREAD }]), 422, "INVALID_OPERATION");
            await expectRejected(save([{ type: "reorder", setId: frontier.id, order: frontier.entryIds.slice(1) }]), 422, "INVALID_OPERATION");
            await expectRejected(save([{ type: "delete", entryId: golem.id }]), 422, "INVALID_OPERATION");
            await expectRejected(store.saveSpreads(workspace, { revision: "old", operations: [] }), 409, "SAVE_CONFLICT");

            for (const file of SPREAD_FILES)
                expect(readBytes(file).equals(before[file]), file).to.equal(true);
        });
    });

    describe("Conflicts and failures", () =>
    {
        it("should reject a save when a spread file changed outside the editor", async () =>
        {
            const { store, workspace, spreads } = await load();
            const venusaur = findEntry(spreads, "SPECIES_VENUSAUR");
            const external = readText(BATTLE_TOWER).replace("NATURE_TIMID", "NATURE_BOLD");
            fs.writeFileSync(cfruPath(BATTLE_TOWER), external);

            const error = await expectRejected(store.saveSpreads(workspace, { revision: spreads.revision, operations: [{ type: "update", entryId: venusaur.id, fields: { hpEv: 248 } }] }), 409, "SAVE_CONFLICT");
            expect(error.details.files).to.deep.equal([BATTLE_TOWER]);
            expect(readText(BATTLE_TOWER)).to.equal(external);
        });

        it("should reject a save when the configuration changed", async () =>
        {
            const { store, workspace, spreads } = await load();
            fs.writeFileSync(cfruPath(CONFIG), CONFIG_VANILLA);

            const error = await expectRejected(store.saveSpreads(workspace, { revision: spreads.revision, operations: [] }), 409, "SAVE_CONFLICT");
            expect(error.details.files).to.deep.equal([CONFIG]);
        });

        it("should retry a replacement while Windows reports the file as busy", async () =>
        {
            let busyAttempts = 2;
            const fileSystem = createFileSystem(
            {
                rename: async (source, target) =>
                {
                    if (target.endsWith("battle_tower_spreads.h") && busyAttempts-- > 0)
                        throw codedError("EBUSY");
                    return fs.promises.rename(source, target);
                },
            });
            const { store, workspace, spreads } = await load({ fileSystem });
            const venusaur = findEntry(spreads, "SPECIES_VENUSAUR");

            const result = await store.saveSpreads(workspace, { revision: spreads.revision, operations: [{ type: "update", entryId: venusaur.id, fields: { hpEv: 248 } }] });
            expect(result.files).to.have.length(1);
            expect(readText(BATTLE_TOWER)).to.include(".hpEv = 248,");
        });

        it("should restore already replaced files when a later file cannot be replaced", async () =>
        {
            const before = readAllSpreadFiles();
            const fileSystem = createFileSystem(
            {
                rename: async (source, target) =>
                {
                    if (target.endsWith("frontier_multi_spreads.h") && source.endsWith(".tmp") && !source.includes(".restore"))
                        throw codedError("EPERM");
                    return fs.promises.rename(source, target);
                },
            });
            const { store, workspace, spreads } = await load({ fileSystem });

            const error = await expectRejected(store.saveSpreads(workspace, { revision: spreads.revision, operations:
            [
                { type: "update", entryId: findEntry(spreads, "SPECIES_VENUSAUR").id, fields: { hpEv: 248 } },
                { type: "update", entryId: findEntry(spreads, "SPECIES_RAICHU").id, fields: { hpIv: 30 } },
            ] }), 500, "SAVE_FAILED");

            expect(error.details.restored).to.equal(true);
            expect(error.details.files).to.deep.equal(
            [
                { path: BATTLE_TOWER, status: "rolledBack" },
                { path: MULTI_SPREADS, status: "notReplaced" },
            ]);
            for (const file of SPREAD_FILES)
                expect(readBytes(file).equals(before[file]), file).to.equal(true);
            expect(fs.readdirSync(path.dirname(cfruPath(BATTLE_TOWER))).filter((name) => name.endsWith(".tmp"))).to.deep.equal([]);
            expect(fs.readdirSync(path.join(dataDirectory, "journal"))).to.deep.equal([]);
        });

        it("should undo an interrupted save the next time the repositories load", async () =>
        {
            // Simulate the server stopping after the first file was replaced
            const before = readAllSpreadFiles();
            let crashed = false;
            const crashing = (name) => async (...args) =>
            {
                if (!crashed && name === "rename" && args[1].endsWith("frontier_multi_spreads.h"))
                    crashed = true;
                if (crashed)
                    throw new Error("Server stopped");
                return fs.promises[name](...args);
            };
            const fileSystem = createFileSystem(Object.fromEntries(["open", "rename", "readFile", "mkdir", "rm", "readdir"].map((name) => [name, crashing(name)])));
            const { store, workspace, spreads } = await load({ fileSystem });

            try
            {
                await store.saveSpreads(workspace, { revision: spreads.revision, operations:
                [
                    { type: "update", entryId: findEntry(spreads, "SPECIES_VENUSAUR").id, fields: { hpEv: 248 } },
                    { type: "update", entryId: findEntry(spreads, "SPECIES_RAICHU").id, fields: { hpIv: 30 } },
                ] });
            }
            catch
            {
                // The simulated stop interrupts the save
            }
            expect(readText(BATTLE_TOWER)).to.include(".hpEv = 248,");

            // A new server finds the journal and restores the first file
            const { diagnostics } = await load();
            expect(diagnostics.map((diagnostic) => diagnostic.code)).to.include("SAVE_RECOVERED");
            for (const file of SPREAD_FILES)
                expect(readBytes(file).equals(before[file]), file).to.equal(true);
            expect(fs.readdirSync(path.dirname(cfruPath(BATTLE_TOWER))).filter((name) => name.endsWith(".tmp"))).to.deep.equal([]);
            expect(fs.readdirSync(path.join(dataDirectory, "journal"))).to.deep.equal([]);
        });

        it("should keep original bytes in a backup outside the repository", async () =>
        {
            const before = readBytes(BATTLE_TOWER);
            const { store, workspace, spreads } = await load();

            const result = await store.saveSpreads(workspace, { revision: spreads.revision, operations: [{ type: "update", entryId: findEntry(spreads, "SPECIES_VENUSAUR").id, fields: { hpEv: 248 } }] });
            const backup = fs.readFileSync(path.join(dataDirectory, "backups", result.backupId, BATTLE_TOWER.replace(/\//g, "__")));
            expect(backup.equals(before)).to.equal(true);
            expect(path.relative(fixture.paths.cfru, dataDirectory).startsWith("..")).to.equal(true);
        });
    });
});
