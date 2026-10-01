/**
 * Differential syntax tests against the official Showdown simulator.
 */

const { expect } = require("chai");
const { Teams } = require("pokemon-showdown");

const LEVEL = 50;

/**
 * Builds a small test catalog.
 *
 * @returns {object} A small catalog of official species and moves.
 */
function catalog()
{
    return {
        name: "Test",
        species: { SPECIES_CHARIZARD: { name: "Charizard", showdownName: "Charizard", abilities: ["ABILITY_SOLARPOWER", "ABILITY_BLAZE", null], megas: [] } },
        items: { ITEM_NONE: { name: "None" }, ITEM_LEFTOVERS: { name: "Leftovers" } },
        abilities: { ABILITY_BLAZE: "Blaze", ABILITY_SOLARPOWER: "Solar Power" },
        moves: { MOVE_FLAMETHROWER: { name: "Flamethrower" }, MOVE_PROTECT: { name: "Protect" } },
        natures: { NATURE_HARDY: "Hardy", NATURE_MODEST: "Modest" },
        balls: { BALL_TYPE_RANDOM: { name: "Random" } },
        types: {},
        learnsets: {},
    };
}

/**
 * Builds a test spread.
 *
 * @returns {object} A CFRU spread with an asymmetric SpD and Spe.
 */
function fields()
{
    return {
        species: "SPECIES_CHARIZARD", nature: "NATURE_MODEST", ability: 1, item: "ITEM_LEFTOVERS", ball: "BALL_TYPE_RANDOM",
        hpIv: 31, atkIv: 0, defIv: 31, spAtkIv: 30, spDefIv: 17, spdIv: 1,
        hpEv: 4, atkEv: 0, defEv: 0, spAtkEv: 252, spDefEv: 2, spdEv: 252,
        moves: ["MOVE_FLAMETHROWER", "MOVE_PROTECT", 0, 0], shiny: true, gigantamax: false,
        forSingles: true, forDoubles: true, modifyMovesDoubles: true, specificTeamType: 0,
    };
}

describe("Showdown official parser compatibility", () =>
{
    let adapter;

    before(async () =>
    {
        adapter = await import("../../../shared/showdown.mjs");
    });

    it("has the simulator recover every standard field from exported spreads", () =>
    {
        const exported = adapter.exportSpreads(catalog(), [{ id: "one", fields: fields(), level: LEVEL }, { id: "two", fields: fields(), level: LEVEL }]);
        expect(exported.errors).to.deep.equal([]);
        const official = Teams.import(exported.text);
        expect(official).to.have.length(2);
        for (const set of official)
        {
            expect(set).to.include({ species: "Charizard", item: "Leftovers", ability: "Blaze", nature: "Modest", level: LEVEL, shiny: true });
            expect(set.evs).to.include({ spa: 252, spd: 2, spe: 252 });
            expect(set.ivs).to.include({ atk: 0, spa: 30, spd: 17, spe: 1 });
            expect(set.moves).to.deep.equal(["Flamethrower", "Protect"]);
        }
    });

    it("exports illegal moves and stats for the simulator to parse without discarding the spread", () =>
    {
        const data = catalog();
        data.moves.MOVE_THUNDERBOLT = { name: "Thunderbolt" };
        data.learnsets.SPECIES_CHARIZARD = { status: "complete", moves: {}, unknown: {} };
        const illegal = { ...fields(), hpEv: 300, atkEv: 252, hpIv: 40, moves: ["MOVE_THUNDERBOLT", 0, 0, 0] };
        const exported = adapter.exportSpreads(data, [{ fields: illegal, level: LEVEL }, { fields: fields(), level: LEVEL }]);
        expect(exported.errors).to.deep.equal([]);
        const official = Teams.import(exported.text);
        expect(official).to.have.length(2);
        expect(official[0].moves).to.deep.equal(["Thunderbolt"]);
        expect(official[0].evs).to.include({ hp: 300, atk: 252 });
        expect(official[0].ivs.hp).to.equal(40);
    });

    it("preserves expressible entries when another spread has no species name", () =>
    {
        const exported = adapter.exportSpreads(catalog(), [{ id: "missing", fields: { ...fields(), species: "SPECIES_UNKNOWN" } }, { fields: fields() }]);
        expect(exported.errors[0]).to.include({ field: "species", index: 0, id: "missing" });
        expect(Teams.import(exported.text)).to.have.length(1);
    });

    it("imports official exported text into equivalent editor fields", () =>
    {
        const official = Teams.export([{
            species: "Charizard", item: "Leftovers", ability: "Blaze", nature: "Modest", level: LEVEL,
            evs: { hp: 4, atk: 0, def: 0, spa: 252, spd: 2, spe: 252 },
            ivs: { hp: 31, atk: 0, def: 31, spa: 30, spd: 17, spe: 1 },
            moves: ["Flamethrower", "Protect"], shiny: true,
        }]);
        const parsed = adapter.parseShowdownText(official);
        expect(parsed.errors).to.deep.equal([]);
        expect(parsed.sets).to.have.length(1);
        const result = adapter.resolveImportedSet(catalog(), parsed.sets[0], { expectedLevel: LEVEL });
        expect(result.errors).to.deep.equal([]);
        for (const name of ["species", "nature", "ability", "item", "moves", "shiny", "hpIv", "atkIv", "defIv", "spAtkIv", "spDefIv", "spdIv", "hpEv", "atkEv", "defEv", "spAtkEv", "spDefEv", "spdEv"])
            expect(result.fields[name], name).to.deep.equal(fields()[name]);
    });

    it("imports Mega-only abilities with the first regular base slot and no ambiguity", () =>
    {
        const data = catalog();
        data.species.SPECIES_CHARIZARD.megas = [{ species: "SPECIES_CHARIZARD_MEGA_X", item: "ITEM_CHARIZARDITE_X", available: true }];
        data.species.SPECIES_CHARIZARD_MEGA_X = { name: "Mega Charizard X", showdownName: "Charizard-Mega-X", abilities: [null, "ABILITY_TOUGHCLAWS", null], megas: [] };
        data.items.ITEM_CHARIZARDITE_X = { name: "Charizardite X" };
        data.abilities.ABILITY_TOUGHCLAWS = "Tough Claws";
        const parsed = adapter.parseShowdownText("Charizard-Mega-X @ Charizardite X\nAbility: Tough Claws\n- Flamethrower").sets[0];
        const result = adapter.resolveImportedSet(data, parsed);
        expect(result.errors).to.deep.equal([]);
        expect(result.ambiguities).to.deep.equal([]);
        expect(result.fields).to.include({ species: "SPECIES_CHARIZARD", ability: 1, item: "ITEM_CHARIZARDITE_X" });
        expect(result.warnings.map((warning) => warning.message)).to.deep.equal(["Charizard-Mega-X imported as Charizard (battle-only form)"]);
        const overwritten = adapter.resolveImportedSet(data, parsed, { existingFields: { ...fields(), ability: 0 } });
        expect(overwritten.fields.ability).to.equal(0);
        expect(overwritten.ambiguities).to.deep.equal([]);
    });

    it("keeps Mega, move and ability warnings compact", () =>
    {
        const data = catalog();
        data.species.SPECIES_VENUSAUR =
        {
            name: "Venusaur", showdownName: "Venusaur", abilities: [null, "ABILITY_OVERGROW", null],
            megas: [{ species: "SPECIES_VENUSAUR_MEGA", item: "ITEM_VENUSAURITE", available: true }],
        };
        data.species.SPECIES_VENUSAUR_MEGA =
        {
            name: "Mega Venusaur", showdownName: "Venusaur-Mega", abilities: [null, "ABILITY_THICKFAT", null], megas: [],
        };
        data.items.ITEM_VENUSAURITE = { name: "Venusaurite" };
        data.abilities.ABILITY_OVERGROW = "Overgrow";
        data.abilities.ABILITY_THICKFAT = "Thick Fat";
        data.abilities.ABILITY_SANDVEIL = "Sand Veil";
        data.moves.MOVE_SLUDGEWAVE = { name: "Sludge Wave" };
        data.learnsets.SPECIES_VENUSAUR = { status: "complete", moves: {}, unknown: {} };
        const parsed = adapter.parseShowdownText("Venusaur-Mega\nAbility: Sand Veil\n- Sludge Wave").sets[0];
        const result = adapter.resolveImportedSet(data, parsed);
        expect(result.errors).to.deep.equal([]);
        expect(result.fields).to.include({ species: "SPECIES_VENUSAUR", ability: 1, item: "ITEM_VENUSAURITE" });
        expect(result.warnings.map((warning) => warning.message)).to.deep.equal([
            "Venusaur-Mega imported as Venusaur (battle-only form)",
            "Sand Veil not available (using Overgrow)",
            "Sludge Wave not learnable",
        ]);
    });

    it("reports unknown species and items without ability or learnability problems", () =>
    {
        const data = catalog();
        data.learnsets.SPECIES_CHARIZARD = { status: "complete", moves: {}, unknown: {} };
        const parsed = adapter.parseShowdownText("Raichu-Mega-X @ Raichunite X\nAbility: Electric Surge\n- Flamethrower").sets[0];
        const result = adapter.resolveImportedSet(data, parsed);
        expect(result.errors.map((error) => error.message)).to.deep.equal(["Unknown species: Raichu-Mega-X", "Unknown item: Raichunite X"]);
        expect(result.warnings).to.deep.equal([]);
    });

    it("warns and uses the first regular ability when a species cannot have the imported ability", () =>
    {
        const data = catalog();
        data.abilities.ABILITY_SANDVEIL = "Sand Veil";
        for (const ability of ["Sand Veil", "Invisible Ability"])
        {
            const parsed = adapter.parseShowdownText(`Charizard\nAbility: ${ability}\n- Flamethrower`).sets[0];
            const result = adapter.resolveImportedSet(data, parsed, { existingFields: { ...fields(), ability: 0 } });
            expect(result.errors).to.deep.equal([]);
            expect(result.fields).not.to.equal(null);
            expect(result.fields.ability).to.equal(1);
            expect(result.warnings.map((warning) => warning.message)).to.deep.equal([`${ability} not available (using Blaze)`]);
            expect(adapter.applyOverwrite(data, { ...fields(), ability: 0 }, result.fields).fields.ability).to.equal(1);
        }
    });

    it("silently resolves identical-name ability slots while preserving an existing matching slot", () =>
    {
        const data = catalog();
        data.species.SPECIES_CHARIZARD.abilities = ["ABILITY_SOLARPOWER", "ABILITY_BLAZE", "ABILITY_BLAZE"];
        const parsed = adapter.parseShowdownText("Charizard\nAbility: Blaze\n- Flamethrower").sets[0];
        const result = adapter.resolveImportedSet(data, parsed);
        expect(result.fields.ability).to.equal(1);
        expect(result.ambiguities).to.deep.equal([]);
        const existing = { ...fields(), ability: 2 };
        const overwritten = adapter.resolveImportedSet(data, parsed, { existingFields: existing });
        expect(overwritten.fields.ability).to.equal(2);
        expect(overwritten.ambiguities).to.deep.equal([]);
        expect(adapter.applyOverwrite(data, existing, overwritten.fields).fields.ability).to.equal(2);
    });

    it("reports unknown catalog names without trailing periods", () =>
    {
        const parsed = adapter.parseShowdownText("Charizard @ Missing Item\nPokeball: Missing Ball\nMissing Nature\n- Flamethrower").sets[0];
        const result = adapter.resolveImportedSet(catalog(), parsed);
        expect(result.errors.map((error) => error.message)).to.deep.equal([
            "Unknown item: Missing Item", "Unknown nature: Missing", "Unknown ball: Missing Ball",
        ]);
    });

    it("shortens missing moves, level mismatch and happiness warnings", () =>
    {
        const data = catalog();
        data.moves.MOVE_RETURN = { name: "Return" };
        const parsed = adapter.parseShowdownText("Charizard\nLevel: 5\nHappiness: 0\n- Return\n- Invisible Beam").sets[0];
        const result = adapter.resolveImportedSet(data, parsed, { expectedLevel: LEVEL });
        expect(result.errors).to.deep.equal([]);
        expect(result.warnings.map((warning) => warning.message)).to.deep.equal([
            "Invisible Beam not in this game (left out)", "Level 5 (expected 50)", "Happiness not saved (affects Return/Frustration)",
        ]);
        expect(result.unsupported).to.deep.equal([{ field: "level", value: "5" }, { field: "happiness", value: "0" }]);
    });
});
