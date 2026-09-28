/**
 * Test file for the spread and trainer table parser.
 * Tests field values, omitted fields, comments, placeholders, branches, unsupported entries and trainer links.
 */

const { expect } = require("chai");

const { evaluatePreprocessor } = require("../../services/preprocessor");
const { parseSpreadFile, parseTrainerTables } = require("../../services/spread-parser");
const { CFRU_SOURCE_FILES, CONFIG_VANILLA } = require("../helpers/spread-fixtures");

const UNBOUND_MACROS = evaluatePreprocessor(CFRU_SOURCE_FILES["src/config.h"]).macros;
const VANILLA_MACROS = evaluatePreprocessor(CONFIG_VANILLA).macros;
const BATTLE_TOWER = CFRU_SOURCE_FILES["src/Tables/battle_tower_spreads.h"];
const SPECIAL_TRAINERS = CFRU_SOURCE_FILES["src/Tables/frontier_special_trainer_spreads.h"];
const RAID_PARTNERS = CFRU_SOURCE_FILES["src/Tables/raid_partners.h"];
const MULTI_SPREADS = CFRU_SOURCE_FILES["src/Tables/frontier_multi_spreads.h"];
const TRAINERS = CFRU_SOURCE_FILES["src/Tables/battle_frontier_trainers.c"];


describe("Spread Parser", () =>
{
    describe("parseSpreadFile", () =>
    {
        it("should read only the arrays in the active branch", () =>
        {
            const { sets, editable, diagnostics } = parseSpreadFile(BATTLE_TOWER, UNBOUND_MACROS);
            expect(editable).to.equal(true);
            expect(diagnostics).to.deep.equal([]);
            expect(sets.map((set) => set.name)).to.deep.equal(["gFrontierSpreads", "gLittleCupSpreads"]);
            expect(sets[0].entries).to.have.length(3);
            expect(sets[0].branch).to.deep.equal(["#ifdef UNBOUND"]);
        });

        it("should read field values and keep omitted fields as zero", () =>
        {
            const [venusaur, charizard, pikachu] = parseSpreadFile(BATTLE_TOWER, UNBOUND_MACROS).sets[0].entries;
            expect(venusaur.fields).to.include({ species: "SPECIES_VENUSAUR", atkIv: 0, hpEv: 252, atkEv: 0, ability: 0, forSingles: true, shiny: false, specificTeamType: 0 });
            expect(venusaur.fields.moves).to.deep.equal(["MOVE_GIGADRAIN", "MOVE_HIDDENPOWER", "MOVE_LEECHSEED", "MOVE_SYNTHESIS"]);
            expect(venusaur.explicitFields).to.not.include("atkEv");
            expect(charizard.fields).to.include({ gigantamax: true, specificTeamType: "DOUBLES_SUN_TEAM" });
            expect(charizard.fields.moves).to.deep.equal(["MOVE_FLAMETHROWER", "MOVE_AIRSLASH", 0, 0]);

            // A spread that only names its species is a real entry whose other fields are zero
            expect(pikachu.fields).to.include({ species: "SPECIES_PIKACHU", hpIv: 0, ability: 0, item: 0, forDoubles: false });
            expect(pikachu.explicitFields).to.deep.equal(["species"]);
        });

        it("should read ability and Hidden Power comments", () =>
        {
            const [venusaur] = parseSpreadFile(BATTLE_TOWER, UNBOUND_MACROS).sets[0].entries;
            expect(venusaur.abilityComment).to.equal("ABILITY_CHLOROPHYLL");
            expect(venusaur.hiddenPowerComments).to.deep.equal([null, "TYPE_DRAGON", null, null]);
        });

        it("should keep fields the editor does not know", () =>
        {
            const charizard = parseSpreadFile(BATTLE_TOWER, UNBOUND_MACROS).sets[0].entries[1];
            expect(charizard.unknownFields).to.deep.equal([{ name: "futureField", expression: "SOME_VALUE" }]);
            expect(charizard.editable).to.equal(true);
        });

        it("should treat empty entries as placeholders rather than spreads", () =>
        {
            const { sets } = parseSpreadFile(BATTLE_TOWER, VANILLA_MACROS);
            expect(sets.map((set) => set.name)).to.deep.equal(["gFrontierSpreads", "gLittleCupSpreads"]);
            expect(sets[0].entries).to.have.length(0);
            expect(sets[0].placeholders).to.have.length(1);
            expect(sets[0].branch).to.deep.equal(["#else (#ifdef UNBOUND)"]);
        });

        it("should separate entries on either side of a directive inside an array", () =>
        {
            const [palmer] = parseSpreadFile(SPECIAL_TRAINERS, UNBOUND_MACROS).sets;
            expect(palmer.entries.map((entry) => entry.fields.species)).to.deep.equal(["SPECIES_GARCHOMP", "SPECIES_TYRANITAR", "SPECIES_METAGROSS", "SPECIES_SALAMENCE"]);
            expect(palmer.entries.map((entry) => entry.segment)).to.deep.equal([0, 1, 2, 2]);
        });

        it("should mark unsupported entries read-only and record fixed sizes", () =>
        {
            const fixed = parseSpreadFile(SPECIAL_TRAINERS, UNBOUND_MACROS).sets.find((set) => set.name === "gSpecialTowerSpread_Fixed");
            expect(fixed.fixedSize).to.equal("2");
            expect(fixed.entries.map((entry) => entry.editable)).to.deep.equal([true, false]);
            expect(fixed.entries[1].diagnostics[0].code).to.equal("UNSUPPORTED_INITIALIZER");
        });

        it("should read static arrays, a byte order mark and a last entry without a comma", () =>
        {
            const raid = parseSpreadFile(RAID_PARTNERS, UNBOUND_MACROS).sets;
            expect(raid.map((set) => set.isStatic)).to.deep.equal([true, true]);

            const [milo] = parseSpreadFile(MULTI_SPREADS, UNBOUND_MACROS).sets;
            expect(milo.entries.map((entry) => entry.commaEnd == null)).to.deep.equal([false, true]);
            expect(milo.entries[1].fields.moves[0]).to.equal("MOVE_THUNDER");
        });
    });

    describe("parseTrainerTables", () =>
    {
        it("should link facility trainers to their arrays by tier", () =>
        {
            const { trainers } = parseTrainerTables(TRAINERS, UNBOUND_MACROS);
            expect(trainers.map((trainer) => trainer.name)).to.deep.equal(["Palmer", "Milo", "gFrontierMultiBattleTrainers[1]"]);
            expect(trainers[0].links).to.deep.equal(
            [
                { role: "regular", set: "gSpecialTowerSpread_Palmer1", sizeExpression: "NELEMS(gSpecialTowerSpread_Palmer1)" },
                { role: "littleCup", set: "gLittleCupTowerSpread_Palmer1", sizeExpression: "NELEMS(gLittleCupTowerSpread_Palmer1)" },
            ]);
        });

        it("should link raid partners to their arrays by rank", () =>
        {
            const [catherine] = parseTrainerTables(RAID_PARTNERS, UNBOUND_MACROS).trainers;
            expect(catherine.kind).to.equal("raidPartner");
            expect(catherine.links).to.deep.equal(
            [
                { role: "raid", set: "sRaidPartnerSpread_Catherine_Rank12", ranks: [1, 2], sizeExpression: "NELEMS(sRaidPartnerSpread_Catherine_Rank12)" },
                { role: "raid", set: "sRaidPartnerSpread_Catherine_Rank3", ranks: [3], sizeExpression: "1" },
            ]);
        });

        it("should not read trainers in inactive branches", () =>
        {
            expect(parseTrainerTables(TRAINERS, VANILLA_MACROS).trainers).to.deep.equal([]);
        });
    });
});
