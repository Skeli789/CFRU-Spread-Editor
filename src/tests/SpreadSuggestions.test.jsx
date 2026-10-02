import { describe, expect, it } from "vitest";

import { SPREAD_PRESETS, getSuggestedSpread } from "../../shared/spread-suggestions.mjs";
import
{
    EV_FIELDS, EV_STEP, HIDDEN_POWER_TYPES, IV_FIELDS, MAX_EV, STATS, calculateStat,
    getHiddenPowerType, getNatureEffect, getResetIvs, optimizeHiddenPowerIvs,
} from "../../shared/pokemon-mechanics.mjs";
import { createCatalog, createFields, createSpreads } from "./EditorFixtures.js";

const NATURE_NAMES =
[
    "HARDY", "LONELY", "BRAVE", "ADAMANT", "NAUGHTY", "BOLD", "DOCILE", "RELAXED", "IMPISH", "LAX",
    "TIMID", "HASTY", "SERIOUS", "JOLLY", "NAIVE", "MODEST", "MILD", "QUIET", "BASHFUL", "RASH",
    "CALM", "GENTLE", "SASSY", "CAREFUL", "QUIRKY",
];
const EXPECTED_KEYS = [...Object.values(EV_FIELDS), ...Object.values(IV_FIELDS), "nature"].sort();
const EV_BUDGET = 508;


/**
 * Builds a fresh catalog with all real nature symbols and focused heuristic moves.
 * @returns {object} The test catalog.
 */
function suggestionCatalog()
{
    const catalog = createCatalog();
    catalog.natures = Object.fromEntries(NATURE_NAMES.map((name) => [`NATURE_${name}`, name]));
    const statusMoves = ["RECOVER", "ROOST", "WILLOWISP", "CALMMIND", "SWORDSDANCE", "DRAGONDANCE", "TRICKROOM", "AGILITY", "TOXIC"];
    for (const name of statusMoves)
        catalog.moves[`MOVE_${name}`] = { split: "SPLIT_STATUS", power: 0, effect: "EFFECT_TEST" };
    catalog.moves.MOVE_GYROBALL = { split: "SPLIT_PHYSICAL", power: 1, effect: "EFFECT_HIT" };
    catalog.moves.MOVE_BODYPRESS = { split: "SPLIT_PHYSICAL", power: 80, effect: "EFFECT_HIT" };
    catalog.moves.MOVE_FOULPLAY = { split: "SPLIT_PHYSICAL", power: 95, effect: "EFFECT_HIT" };
    catalog.moves.MOVE_SEISMICTOSS = { split: "SPLIT_PHYSICAL", power: 1, effect: "EFFECT_LEVEL_DAMAGE" };
    catalog.moves.MOVE_PHOTONGEYSER = { split: "SPLIT_SPECIAL", power: 100, effect: "EFFECT_HIT" };
    catalog.species.SPECIES_SHEDINJA =
    {
        baseStats: { hp: 1, atk: 90, def: 45, spAtk: 30, spDef: 30, spd: 40 },
        abilities: [null, "ABILITY_WONDERGUARD", null], megas: [],
    };
    return catalog;
}

/**
 * Asserts legal EVs and that removing the final EV step loses an actual stat point.
 * @param {object} suggestion The suggestion.
 * @param {object} catalog The test catalog.
 * @param {string} species The effective species.
 * @param {number} level The battle level.
 */
function expectEfficientEvs(suggestion, catalog, species, level)
{
    const values = suggestion.fields;
    const total = Object.values(EV_FIELDS).reduce((sum, key) => sum + values[key], 0);
    expect(total).toBeLessThanOrEqual(EV_BUDGET);
    for (const stat of STATS)
    {
        const ev = values[EV_FIELDS[stat]];
        expect(ev).toBeGreaterThanOrEqual(0);
        expect(ev).toBeLessThanOrEqual(MAX_EV);
        expect(ev % EV_STEP).toBe(0);
        if (ev === 0)
            continue;
        const input =
        {
            stat, baseStat: catalog.species[species].baseStats[stat], iv: values[IV_FIELDS[stat]],
            level, species, nature: values.nature,
        };
        expect(calculateStat({ ...input, ev })).toBeGreaterThan(calculateStat({ ...input, ev: ev - EV_STEP }));
    }
}

describe("spread suggestions", () =>
{
    it.each([19, 73])("matches symbolic Trick Room suggestions for numeric team %i without leaking context", (value) =>
    {
        const catalog = suggestionCatalog();
        const teamTypes = createSpreads().teamTypes.map((team) => team.name === "DOUBLES_TRICK_ROOM_TEAM" ? { ...team, value } : team);
        for (const type of HIDDEN_POWER_TYPES)
        {
            const fields = createFields({ ...optimizeHiddenPowerIvs(createFields(), type), specificTeamType: value, moves: ["MOVE_HIDDENPOWER", "MOVE_FLAMETHROWER"] });
            const before = JSON.stringify({ catalog, fields, teamTypes });
            const symbolic = { ...fields, specificTeamType: "DOUBLES_TRICK_ROOM_TEAM" };
            for (const preset of [null, ...SPREAD_PRESETS.map(({ name }) => name)])
            {
                const result = getSuggestedSpread(catalog, fields, { preset, teamTypes });
                expect(result).toEqual(getSuggestedSpread(catalog, symbolic, { preset }));
                expect(getNatureEffect(result.fields.nature).decreased).toBe("spd");
                expect(getHiddenPowerType(result.fields)).toBe(type);
                expect(Object.keys(result.fields).sort()).toEqual(EXPECTED_KEYS);
                if (preset === null || SPREAD_PRESETS.find(({ name }) => name === preset).slow)
                {
                    expect([0, 1]).toContain(result.fields.spdIv);
                    expect(result.fields.spdEv).toBe(0);
                }
                else
                    expect([30, 31]).toContain(result.fields.spdIv);
            }
            expect(JSON.stringify({ catalog, fields, teamTypes })).toBe(before);
        }
        const fields = createFields({ specificTeamType: value });
        catalog.natures = { NATURE_TIMID: "Timid" };
        expect(getSuggestedSpread(catalog, fields, { teamTypes })).toBeNull();
        expect(getSuggestedSpread(catalog, fields, { preset: "Fast Special Attacker", teamTypes })).toBeNull();
        expect(getSuggestedSpread(catalog, fields)).not.toBeNull();
    });

    it("exports the nine searchable preset names and investment priorities", () =>
    {
        expect(SPREAD_PRESETS.map(({ name }) => name)).toEqual(
        [
            "Fast Physical Attacker", "Fast Special Attacker", "Bulky Physical Attacker", "Bulky Special Attacker",
            "Slow Physical Attacker", "Slow Special Attacker", "Physically Defensive", "Specially Defensive", "Fast Bulky Support",
        ]);
        for (const preset of SPREAD_PRESETS)
        {
            expect(STATS).toContain(preset.primary);
            expect(STATS).toContain(preset.secondary);
            expect(STATS).toContain(preset.raised);
        }
    });

    it("lets explicit defensive presets replace the automatic attacking role", () =>
    {
        const catalog = suggestionCatalog();
        const fields = createFields();
        expect(getSuggestedSpread(catalog, fields).role).toBe("Fast Special Attacker");
        const physical = getSuggestedSpread(catalog, fields, { preset: "Physically Defensive" });
        const special = getSuggestedSpread(catalog, fields, { preset: "Specially Defensive" });
        expect(physical).toMatchObject({ role: "Physically Defensive", fields: { hpEv: 252, defEv: 252, spdEv: 0, spAtkEv: 0, nature: "NATURE_BOLD" } });
        expect(special).toMatchObject({ role: "Specially Defensive", fields: { hpEv: 252, spDefEv: 252, spdEv: 0, spAtkEv: 0, nature: "NATURE_CALM" } });
        expect(physical.fields).toMatchObject({ atkIv: 0, spAtkIv: 31 });
        expect(special.fields).toMatchObject({ atkIv: 0, spAtkIv: 31 });
    });

    it.each(SPREAD_PRESETS.filter(({ primary }) => ["atk", "spAtk"].includes(primary)))
    ("maximizes $name's primary attack even when actual moves do not use it", ({ name, primary, secondary }) =>
    {
        const catalog = suggestionCatalog();
        const incompatible = primary === "atk" ? "MOVE_FLAMETHROWER" : "MOVE_DRAGONCLAW";
        const compatible = primary === "atk" ? "MOVE_DRAGONCLAW" : "MOVE_FLAMETHROWER";
        for (const move of [incompatible, compatible, "MOVE_FOULPLAY"])
        {
            const result = getSuggestedSpread(catalog, createFields({ moves: [move] }), { preset: name });
            expect(result.role).toBe(name);
            expect(result.fields[EV_FIELDS[primary]]).toBe(252);
            expect(result.fields[IV_FIELDS[primary]]).toBe(31);
            expect([primary, secondary]).not.toContain(getNatureEffect(result.fields.nature).decreased);
            if (move === incompatible)
            {
                expect(result.fields).toMatchObject({ atkIv: 31, spAtkIv: 31 });
                expect(["atk", "spAtk"]).not.toContain(getNatureEffect(result.fields.nature).decreased);
            }
        }
    });

    it.each(SPREAD_PRESETS)("accepts empty, status-only, unknown and either move category for $name", ({ name, primary, secondary, slow }) =>
    {
        const catalog = suggestionCatalog();
        for (const moves of [[], [0, "MOVE_NONE"], ["MOVE_RECOVER"], ["MOVE_NOT_IN_CATALOG"],
            ["MOVE_DRAGONCLAW"], ["MOVE_FLAMETHROWER"], ["MOVE_FLAMETHROWER", "MOVE_NOT_IN_CATALOG"]])
        {
            const fields = createFields({ moves });
            const before = JSON.stringify({ catalog, fields });
            const result = getSuggestedSpread(catalog, fields, { preset: name });
            expect(result.role).toBe(name);
            expect(result.fields[EV_FIELDS[primary]]).toBeGreaterThan(0);
            expect([primary, secondary]).not.toContain(getNatureEffect(result.fields.nature).decreased);
            if (["atk", "spAtk"].includes(primary))
                expect(result.fields[IV_FIELDS[primary]]).toBe(31);
            expect(result.fields.spdIv).toBe(slow ? 0 : 31);
            expectEfficientEvs(result, catalog, fields.species, 50);
            expect(Object.keys(result.fields).sort()).toEqual(EXPECTED_KEYS);
            expect(JSON.stringify({ catalog, fields })).toBe(before);
        }
    });

    it.each(
    [
        { move: "MOVE_TRICKROOM" },
        { move: "MOVE_GYROBALL" },
        { move: "MOVE_FLAMETHROWER", specificTeamType: "DOUBLES_TRICK_ROOM_TEAM" },
    ])("keeps non-slow preset IV/EV priorities but lowers nature Speed for $move / $specificTeamType", ({ move, specificTeamType }) =>
    {
        const catalog = suggestionCatalog();
        const fields = createFields({ moves: [move], specificTeamType });
        const before = JSON.stringify({ catalog, fields });
        for (const { name, primary, secondary } of SPREAD_PRESETS.filter(({ slow }) => !slow))
        {
            const result = getSuggestedSpread(catalog, fields, { preset: name });
            expect(result.fields.spdIv).toBe(31);
            expect(getNatureEffect(result.fields.nature).decreased).toBe("spd");
            if (primary === "atk" || primary === "spAtk")
                expect(getNatureEffect(result.fields.nature).increased).toBe(primary);
            if (secondary === "spd")
                expect(result.fields.spdEv).toBe(252);
            if (move === "MOVE_GYROBALL")
                expect(result.fields.atkIv).toBe(31);
        }
        const defensive = getSuggestedSpread(catalog, fields, { preset: "Physically Defensive" });
        expect(defensive.fields).toMatchObject({ hpEv: 252, defEv: 252, spdEv: 0, spdIv: 31 });
        expect(JSON.stringify({ catalog, fields })).toBe(before);
    });

    it.each(["Physically Defensive", "Specially Defensive", "Fast Bulky Support"])
    ("allows %s for attacking, fixed-damage and status-only known moves", (preset) =>
    {
        const catalog = suggestionCatalog();
        for (const moves of [["MOVE_DRAGONCLAW"], ["MOVE_FLAMETHROWER"], ["MOVE_FOULPLAY"], ["MOVE_RECOVER"]])
            expect(getSuggestedSpread(catalog, createFields({ moves }), { preset }).role).toBe(preset);
        const support = getSuggestedSpread(catalog, createFields({ moves: ["MOVE_RECOVER"] }), { preset: "Fast Bulky Support" });
        expect(support.fields).toMatchObject({ hpEv: 252, spdEv: 252, atkEv: 0, spAtkEv: 0, atkIv: 0, spAtkIv: 0, nature: "NATURE_TIMID" });
    });

    it("uses the preset's nature priority even when automatic speed boosts favor damage", () =>
    {
        const catalog = suggestionCatalog();
        const fields = createFields({ moves: ["MOVE_FLAMETHROWER", "MOVE_AGILITY"] });
        expect(getSuggestedSpread(catalog, fields).fields.nature).toBe("NATURE_MODEST");
        expect(getSuggestedSpread(catalog, fields, { preset: "Fast Special Attacker" }).fields.nature).toBe("NATURE_TIMID");
        catalog.natures = { NATURE_MODEST: "Modest" };
        expect(getSuggestedSpread(catalog, fields, { preset: "Fast Special Attacker" }).fields.nature).toBe("NATURE_MODEST");
    });

    it.each(SPREAD_PRESETS)("uses safe incomplete-catalog nature fallbacks for $name", ({ name, primary, secondary }) =>
    {
        const catalog = createCatalog();
        const fields = createFields({ moves: [] });
        const result = getSuggestedSpread(catalog, fields, { preset: name });
        expect(result.role).toBe(name);
        expect(Object.keys(catalog.natures)).toContain(result.fields.nature);
        expect([primary, secondary]).not.toContain(getNatureEffect(result.fields.nature).decreased);
        catalog.natures = { NATURE_HARDY: "Hardy" };
        expect(getSuggestedSpread(catalog, fields, { preset: name }).fields.nature).toBe("NATURE_HARDY");
        catalog.natures = {};
        expect(getSuggestedSpread(catalog, fields, { preset: name })).toBeNull();
    });

    it.each(["Slow Physical Attacker", "Slow Special Attacker"])
    ("minimizes Speed for %s without slow moves or a catalog Trick Room entry", (preset) =>
    {
        const catalog = suggestionCatalog();
        delete catalog.moves.MOVE_TRICKROOM;
        const physical = preset === "Slow Physical Attacker";
        const fields = createFields({ moves: physical ? ["MOVE_DRAGONCLAW"] : ["MOVE_FLAMETHROWER"] });
        const before = JSON.stringify({ catalog, fields });
        const result = getSuggestedSpread(catalog, fields, { preset });
        expect(result.fields).toMatchObject({ spdEv: 0, spdIv: 0, hpEv: 252, nature: physical ? "NATURE_BRAVE" : "NATURE_QUIET" });
        expect(result.fields[physical ? "atkEv" : "spAtkEv"]).toBe(252);
        expect(result.fields[physical ? "spAtkIv" : "atkIv"]).toBe(0);
        expect(JSON.stringify({ catalog, fields })).toBe(before);
        expect(Object.keys(result.fields).sort()).toEqual(EXPECTED_KEYS);
    });

    it.each(HIDDEN_POWER_TYPES)("preserves %s for every explicit preset without changing actual moves", (type) =>
    {
        const catalog = suggestionCatalog();
        for (const { name, primary, secondary, slow } of SPREAD_PRESETS)
        {
            for (const moves of [["MOVE_HIDDENPOWER"], ["MOVE_HIDDENPOWER", "MOVE_NOT_IN_CATALOG", "MOVE_TRICKROOM"],
                ["MOVE_HIDDENPOWER", "MOVE_GYROBALL"]])
            {
                const fields = createFields({ ...optimizeHiddenPowerIvs(createFields(), type), moves });
                const before = JSON.stringify({ catalog, fields });
                const result = getSuggestedSpread(catalog, fields, { preset: name });
                const suggestedIvs = Object.fromEntries(Object.values(IV_FIELDS).map((key) => [key, result.fields[key]]));
                expect(getHiddenPowerType(suggestedIvs)).toBe(type);
                expect([30, 31]).toContain(result.fields.spAtkIv);
                if (primary === "atk" || moves.includes("MOVE_GYROBALL"))
                    expect([30, 31]).toContain(result.fields.atkIv);
                else
                    expect([0, 1]).toContain(result.fields.atkIv);
                expect(slow ? [0, 1] : [30, 31]).toContain(result.fields.spdIv);
                if (slow)
                    expect(result.fields.spdEv).toBe(0);
                if (moves.includes("MOVE_TRICKROOM") || moves.includes("MOVE_GYROBALL"))
                    expect(getNatureEffect(result.fields.nature).decreased).toBe("spd");
                else
                    expect([primary, secondary, "spAtk"]).not.toContain(getNatureEffect(result.fields.nature).decreased);
                expectEfficientEvs(result, catalog, fields.species, 50);
                expect(Object.keys(result.fields).sort()).toEqual(EXPECTED_KEYS);
                expect(JSON.stringify({ catalog, fields })).toBe(before);
            }
        }
    });

    it.each([5, 50, 100])("keeps every preset's allocations capped and efficient at level %i", (level) =>
    {
        const catalog = suggestionCatalog();
        const fields = createFields({ moves: ["MOVE_DRAGONCLAW", "MOVE_FLAMETHROWER"] });
        for (const { name, slow } of SPREAD_PRESETS)
        {
            const result = getSuggestedSpread(catalog, fields, { level, preset: name });
            expect(result.role).toBe(name);
            expectEfficientEvs(result, catalog, fields.species, level);
            expect(Object.keys(result.fields).sort()).toEqual(EXPECTED_KEYS);
            if (slow)
                expect(result.fields.spdEv).toBe(0);
        }
    });

    it("keeps null preset identical to automatic suggestions and rejects unknown names", () =>
    {
        const catalog = suggestionCatalog();
        for (const level of [5, 50, 100])
        {
            for (const moves of [["MOVE_FLAMETHROWER"], ["MOVE_DRAGONCLAW", "MOVE_TRICKROOM"], ["MOVE_RECOVER"],
                [], [0, "MOVE_NONE"], ["MOVE_NOT_IN_CATALOG"], ["MOVE_HIDDENPOWER"]])
            {
                const fields = createFields({ moves });
                expect(getSuggestedSpread(catalog, fields, { level, preset: null })).toEqual(getSuggestedSpread(catalog, fields, { level }));
            }
        }
        for (const moves of [[], [0, "MOVE_NONE"], ["MOVE_NOT_IN_CATALOG"]])
            expect(getSuggestedSpread(catalog, createFields({ moves }), { preset: null })).toBeNull();
        expect(getSuggestedSpread(catalog, createFields({ moves: ["MOVE_HIDDENPOWER"], hpIv: undefined }), { preset: null })).toBeNull();
        for (const preset of ["Unknown", "", "fast special attacker", "toString"])
            expect(getSuggestedSpread(catalog, createFields(), { preset })).toBeNull();
    });

    it("suggests fast special Charizard with reset attacking IVs and only editable stat fields", () =>
    {
        const result = getSuggestedSpread(suggestionCatalog(), createFields());
        expect(result.role).toBe("Fast Special Attacker");
        expect(result.fields).toMatchObject({ spAtkEv: 252, spdEv: 252, atkEv: 0, atkIv: 0, spAtkIv: 31, nature: "NATURE_TIMID" });
        expect(Object.keys(result.fields).sort()).toEqual(EXPECTED_KEYS);
    });

    it("uses Mega stats by default rather than any UI preview flag", () =>
    {
        const catalog = suggestionCatalog();
        catalog.species.SPECIES_CHARIZARD_MEGA_X.baseStats = { hp: 100, atk: 150, def: 110, spAtk: 100, spDef: 100, spd: 50 };
        const fields = createFields({ moves: ["MOVE_DRAGONCLAW", "MOVE_FLAMETHROWER"], item: "ITEM_NONE", showMega: false });
        const base = getSuggestedSpread(catalog, fields);
        const mega = getSuggestedSpread(catalog, { ...fields, item: "ITEM_CHARIZARDITE_X" });
        expect(base.role).toBe("Fast Mixed Attacker");
        expect(base.fields.spAtkEv).toBe(252);
        expect(mega.role).toBe("Bulky Mixed Attacker");
        expect(mega.fields.atkEv).toBe(252);
        expect(mega.fields.hpEv).toBe(252);
        expect(mega.fields.spdEv).toBe(0);
    });

    it("uses the effective Mega ability and selected ability slot with fallback", () =>
    {
        const catalog = suggestionCatalog();
        const fields = createFields({ species: "SPECIES_VENUSAUR", moves: ["MOVE_GIGADRAIN"], ability: 0, item: "ITEM_NONE" });
        expect(getSuggestedSpread(catalog, fields).fields.nature).toBe("NATURE_MODEST");
        expect(getSuggestedSpread(catalog, { ...fields, ability: 2 }).fields.nature).toBe("NATURE_TIMID");
        expect(getSuggestedSpread(catalog, { ...fields, item: "ITEM_VENUSAURITE" }).fields.nature).toBe("NATURE_TIMID");
    });

    it("honors physical and special Choice item bias without investing an unused attack", () =>
    {
        const catalog = suggestionCatalog();
        const fields = createFields({ species: "SPECIES_GARCHOMP", moves: ["MOVE_EARTHQUAKE", "MOVE_DRAGONCLAW"], item: "ITEM_CHOICEBAND" });
        const result = getSuggestedSpread(catalog, fields);
        expect(result.role).toBe("Fast Physical Attacker");
        expect(result.fields).toMatchObject({ atkEv: 252, spdEv: 252, spAtkEv: 0, spAtkIv: 0, nature: "NATURE_JOLLY" });
        const mixed = createFields({ moves: ["MOVE_DRAGONCLAW", "MOVE_FLAMETHROWER"] });
        expect(getSuggestedSpread(catalog, { ...mixed, item: "ITEM_CHOICEBAND" }).fields.atkEv).toBe(252);
        expect(getSuggestedSpread(catalog, { ...mixed, item: "ITEM_CHOICESPECS" }).fields.spAtkEv).toBe(252);
        expect(getSuggestedSpread(catalog, { ...mixed, moves: ["MOVE_FLAMETHROWER"], item: "ITEM_CHOICEBAND" }).fields.atkEv).toBe(0);
    });

    it("uses setup count to select the meaningful attacking stat and speed boosts to favor damage nature", () =>
    {
        const catalog = suggestionCatalog();
        const mixed = createFields({ moves: ["MOVE_DRAGONCLAW", "MOVE_FLAMETHROWER", "MOVE_SWORDSDANCE"] });
        expect(getSuggestedSpread(catalog, mixed).fields.atkEv).toBe(252);
        const boosted = getSuggestedSpread(catalog, createFields({ moves: ["MOVE_FLAMETHROWER", "MOVE_AGILITY"] }));
        expect(boosted.fields).toMatchObject({ nature: "NATURE_MODEST", spdEv: 252 });
        const scarf = getSuggestedSpread(catalog, createFields({ item: "ITEM_CHOICESCARF" }));
        expect(scarf.fields.nature).toBe("NATURE_MODEST");
    });

    it("uses HP plus the attacking stat for bulky offense, but fragility favors Speed", () =>
    {
        const catalog = suggestionCatalog();
        catalog.species.SPECIES_GARCHOMP.baseStats.spd = 60;
        const fields = createFields({ species: "SPECIES_GARCHOMP", moves: ["MOVE_EARTHQUAKE"] });
        const bulky = getSuggestedSpread(catalog, fields);
        expect(bulky.role).toBe("Bulky Physical Attacker");
        expect(bulky.fields).toMatchObject({ hpEv: 252, atkEv: 252, spdEv: 0, nature: "NATURE_ADAMANT" });
        catalog.species.SPECIES_GARCHOMP.baseStats.def = 60;
        expect(getSuggestedSpread(catalog, fields).role).toBe("Bulky Physical Attacker");
        catalog.species.SPECIES_GARCHOMP.baseStats.spd = 70;
        expect(getSuggestedSpread(catalog, fields).role).toBe("Fast Physical Attacker");
    });

    it("compensates Will-O-Wisp with special bulk and Calm Mind with physical bulk", () =>
    {
        const catalog = suggestionCatalog();
        const burn = getSuggestedSpread(catalog, createFields({ moves: ["MOVE_WILLOWISP", "MOVE_RECOVER", "MOVE_FLAMETHROWER", "MOVE_PROTECT"] }));
        expect(burn.role).toBe("Specially Defensive");
        expect(burn.fields).toMatchObject({ hpEv: 252, spDefEv: 252, spAtkEv: 0, spdEv: 0, nature: "NATURE_CALM" });
        const calmMind = getSuggestedSpread(catalog, createFields({ moves: ["MOVE_CALMMIND", "MOVE_RECOVER", "MOVE_FLAMETHROWER"] }));
        expect(calmMind.role).toBe("Physically Defensive");
        expect(calmMind.fields).toMatchObject({ hpEv: 252, defEv: 252, spdEv: 0, nature: "NATURE_BOLD" });
    });

    it("supports stall and recovery-only partial sets", () =>
    {
        const catalog = suggestionCatalog();
        expect(getSuggestedSpread(catalog, createFields({ moves: ["MOVE_TOXIC", "MOVE_PROTECT", "MOVE_FLAMETHROWER"] })).role).toBe("Specially Defensive");
        expect(getSuggestedSpread(catalog, createFields({ moves: ["MOVE_RECOVER"] })).fields).toMatchObject({ atkIv: 0, spAtkIv: 0, atkEv: 0, spAtkEv: 0 });
    });

    it.each(["MOVE_TRICKROOM", "MOVE_GYROBALL"])("lets %s override fast stats, boosted abilities and Choice Scarf", (slowMove) =>
    {
        const catalog = suggestionCatalog();
        catalog.species.SPECIES_GARCHOMP.abilities[1] = "ABILITY_SPEEDBOOST";
        const result = getSuggestedSpread(catalog, createFields(
        {
            species: "SPECIES_GARCHOMP", item: "ITEM_CHOICESCARF", moves: ["MOVE_EARTHQUAKE", slowMove, "MOVE_DRAGONDANCE"],
        }));
        expect(result.role).toBe("Slow Physical Attacker");
        expect(result.fields).toMatchObject({ spdEv: 0, spdIv: 0, hpEv: 252, atkEv: 252, nature: "NATURE_BRAVE" });
    });

    it("infers slow offense for a Trick Room team without slow moves", () =>
    {
        const catalog = suggestionCatalog();
        const fields = createFields({ moves: ["MOVE_FLAMETHROWER"], specificTeamType: "DOUBLES_TRICK_ROOM_TEAM" });
        const before = JSON.stringify({ catalog, fields });
        const result = getSuggestedSpread(catalog, fields);
        expect(result).toMatchObject(
        {
            role: "Slow Special Attacker",
            fields: { spdEv: 0, spdIv: 0, hpEv: 252, spAtkEv: 252, nature: "NATURE_QUIET" },
        });
        expect(JSON.stringify({ catalog, fields })).toBe(before);
    });

    it.each(HIDDEN_POWER_TYPES)("preserves %s for automatic and all preset Trick Room team suggestions", (type) =>
    {
        const catalog = suggestionCatalog();
        const fields = createFields(
        {
            ...optimizeHiddenPowerIvs(createFields(), type),
            specificTeamType: "DOUBLES_TRICK_ROOM_TEAM", moves: ["MOVE_HIDDENPOWER", "MOVE_FLAMETHROWER"],
        });
        const before = JSON.stringify({ catalog, fields });
        for (const preset of [null, ...SPREAD_PRESETS.map(({ name }) => name)])
        {
            const result = getSuggestedSpread(catalog, fields, { preset });
            expect(getHiddenPowerType(result.fields)).toBe(type);
            expect(getNatureEffect(result.fields.nature).decreased).toBe("spd");
            const slow = preset === null || SPREAD_PRESETS.find(({ name }) => name === preset).slow;
            expect(slow ? [0, 1] : [30, 31]).toContain(result.fields.spdIv);
            if (slow)
                expect(result.fields.spdEv).toBe(0);
            expectEfficientEvs(result, catalog, fields.species, 50);
        }
        expect(JSON.stringify({ catalog, fields })).toBe(before);
    });

    it.each(
    [
        { moves: ["MOVE_TRICKROOM"] },
        { moves: ["MOVE_GYROBALL"] },
        { moves: ["MOVE_FLAMETHROWER"], specificTeamType: "DOUBLES_TRICK_ROOM_TEAM" },
    ])("rejects non-slow catalog nature fallbacks under a slow condition $moves / $specificTeamType", (overrides) =>
    {
        const catalog = suggestionCatalog();
        const fields = createFields(overrides);
        catalog.natures = { NATURE_HARDY: "Hardy", NATURE_TIMID: "Timid" };
        for (const preset of [null, ...SPREAD_PRESETS.map(({ name }) => name)])
            expect(getSuggestedSpread(catalog, fields, { preset })).toBeNull();
        catalog.natures.NATURE_SASSY = "Sassy";
        for (const { name } of SPREAD_PRESETS)
            expect(getSuggestedSpread(catalog, fields, { preset: name }).fields.nature).toBe("NATURE_SASSY");
    });

    it("also lowers Speed for defensive Trick Room", () =>
    {
        const result = getSuggestedSpread(suggestionCatalog(), createFields({ moves: ["MOVE_BODYPRESS", "MOVE_RECOVER", "MOVE_TRICKROOM"] }));
        expect(result.fields).toMatchObject({ spdEv: 0, spdIv: 0, nature: "NATURE_RELAXED" });
    });

    it.each([
        { moves: ["MOVE_DRAGONCLAW", "MOVE_FLAMETHROWER"] },
        { moves: ["MOVE_PHOTONGEYSER"] },
    ])("preserves both attacking stats for mixed moves $moves", ({ moves }) =>
    {
        const result = getSuggestedSpread(suggestionCatalog(), createFields({ moves }));
        expect(result.role).toContain("Mixed");
        expect(result.fields).toMatchObject({ atkIv: 31, spAtkIv: 31 });
        expect(["atk", "spAtk"]).not.toContain(getNatureEffect(result.fields.nature).decreased);
    });

    it("invests Defense and HP for Body Press, not either attacking stat", () =>
    {
        const result = getSuggestedSpread(suggestionCatalog(), createFields({ moves: ["MOVE_BODYPRESS"] }));
        expect(result.role).toBe("Physically Defensive");
        expect(result.fields).toMatchObject({ hpEv: 252, defEv: 252, atkEv: 0, spAtkEv: 0, atkIv: 0, spAtkIv: 0, nature: "NATURE_BOLD" });
    });

    it.each(["MOVE_FOULPLAY", "MOVE_SEISMICTOSS"])("does not treat %s as using Attack", (move) =>
    {
        const result = getSuggestedSpread(suggestionCatalog(), createFields({ moves: [move] }));
        expect(result.fields).toMatchObject({ atkEv: 0, spAtkEv: 0, atkIv: 0, spAtkIv: 0 });
    });

    it("never invests Shedinja's fixed HP or defensive stats", () =>
    {
        const catalog = suggestionCatalog();
        const result = getSuggestedSpread(catalog, createFields({ species: "SPECIES_SHEDINJA", moves: ["MOVE_DRAGONCLAW", "MOVE_SWORDSDANCE"] }));
        expect(result.fields).toMatchObject({ hpEv: 0, defEv: 0, spDefEv: 0, spAtkEv: 0 });
        expect(result.fields.atkEv).toBeGreaterThan(0);
        expect(result.fields.spdEv).toBeGreaterThan(0);
        expectEfficientEvs(result, catalog, "SPECIES_SHEDINJA", 50);
    });

    it.each(HIDDEN_POWER_TYPES)("preserves %s using the exact existing IV reset rules", (type) =>
    {
        const catalog = suggestionCatalog();
        const ivs = optimizeHiddenPowerIvs(createFields(), type);
        const fields = createFields({ ...ivs, moves: ["MOVE_HIDDENPOWER", "MOVE_TRICKROOM"] });
        const result = getSuggestedSpread(catalog, fields);
        const suggestedIvs = Object.fromEntries(Object.values(IV_FIELDS).map((key) => [key, result.fields[key]]));
        expect(suggestedIvs).toEqual(getResetIvs(catalog, fields));
        expect(getHiddenPowerType(suggestedIvs)).toBe(type);
        expect(result.fields.spdEv).toBe(0);
    });

    it.each([5, 50, 100])("uses capped measurable allocations without wasted last EVs at level %i", (level) =>
    {
        const catalog = suggestionCatalog();
        const result = getSuggestedSpread(catalog, createFields(), { level });
        expectEfficientEvs(result, catalog, "SPECIES_CHARIZARD", level);
        expect(result.fields.atkEv).toBe(0);
        const total = Object.values(EV_FIELDS).reduce((sum, key) => sum + result.fields[key], 0);
        if (level === 100)
            expect(total).toBe(EV_BUDGET);
    });

    it("redistributes trimmed level-50 plateaus only into actual gains", () =>
    {
        const catalog = suggestionCatalog();
        const fields = createFields({ ...optimizeHiddenPowerIvs(createFields(), "TYPE_FIRE"), moves: ["MOVE_HIDDENPOWER"] });
        const result = getSuggestedSpread(catalog, fields);
        expect(result.fields.spAtkEv).toBe(248);
        expect(result.fields.spdEv).toBe(248);
        expect(result.fields.hpEv).toBeGreaterThan(0);
        expectEfficientEvs(result, catalog, "SPECIES_CHARIZARD", 50);
    });

    it("uses Defense rather than HP as the second bulky investment below level 20", () =>
    {
        const catalog = suggestionCatalog();
        catalog.species.SPECIES_GARCHOMP.baseStats.spd = 60;
        const result = getSuggestedSpread(catalog, createFields({ species: "SPECIES_GARCHOMP", moves: ["MOVE_EARTHQUAKE"] }), { level: 5 });
        expect(result.fields.spDefEv).toBeGreaterThan(0);
        expect(result.fields.hpEv).toBe(0);
        expectEfficientEvs(result, catalog, "SPECIES_GARCHOMP", 5);
    });

    it("accepts one to four known moves and explicit empty slots", () =>
    {
        const catalog = suggestionCatalog();
        for (const moves of [["MOVE_FLAMETHROWER"], ["MOVE_FLAMETHROWER", 0, "MOVE_NONE", 0], createFields().moves])
            expect(getSuggestedSpread(catalog, createFields({ moves }))).not.toBeNull();
    });

    it("returns null for absent inputs, missing base stats, empty moves and invalid levels", () =>
    {
        const catalog = suggestionCatalog();
        expect(getSuggestedSpread(null, createFields())).toBeNull();
        expect(getSuggestedSpread(catalog, null)).toBeNull();
        expect(getSuggestedSpread({}, {})).toBeNull();
        for (const overrides of [{ species: "SPECIES_UNKNOWN" }, { moves: null }, { moves: [] }, { moves: [0, "MOVE_NONE"] }, { moves: Array(5).fill("MOVE_PROTECT") }])
            expect(getSuggestedSpread(catalog, createFields(overrides))).toBeNull();
        for (const value of [null, undefined, NaN, Infinity, 0, -1, "100"])
        {
            catalog.species.SPECIES_CHARIZARD.baseStats.spd = value;
            expect(getSuggestedSpread(catalog, createFields())).toBeNull();
        }
        for (const level of [0, -1, 101, 5.5, NaN, null])
            expect(getSuggestedSpread(suggestionCatalog(), createFields(), { level })).toBeNull();
    });

    it("rejects incomplete Mega stats instead of falling back to the base", () =>
    {
        const catalog = suggestionCatalog();
        catalog.species.SPECIES_CHARIZARD_MEGA_Y.baseStats.def = null;
        expect(getSuggestedSpread(catalog, createFields({ item: "ITEM_CHARIZARDITE_Y" }))).toBeNull();
    });

    it.each(SPREAD_PRESETS)("still requires safe species, base stats, levels and Hidden Power IVs for $name", ({ name }) =>
    {
        const catalog = suggestionCatalog();
        const options = { preset: name };
        expect(getSuggestedSpread(null, createFields(), options)).toBeNull();
        expect(getSuggestedSpread(catalog, null, options)).toBeNull();
        for (const overrides of [{ species: "SPECIES_UNKNOWN" }, { moves: null }, { moves: Array(5).fill("MOVE_PROTECT") },
            { moves: ["MOVE_HIDDENPOWER"], hpIv: undefined }, { moves: ["MOVE_HIDDENPOWER"], atkIv: 32 }])
            expect(getSuggestedSpread(catalog, createFields(overrides), options)).toBeNull();
        for (const level of [0, -1, 101, 5.5, NaN, null])
            expect(getSuggestedSpread(catalog, createFields(), { ...options, level })).toBeNull();
        for (const value of [null, undefined, NaN, Infinity, 0, -1, "100"])
        {
            catalog.species.SPECIES_CHARIZARD.baseStats.spd = value;
            expect(getSuggestedSpread(catalog, createFields({ moves: [] }), options)).toBeNull();
        }
        catalog.species.SPECIES_CHARIZARD_MEGA_Y.baseStats.def = null;
        expect(getSuggestedSpread(catalog, createFields({ item: "ITEM_CHARIZARDITE_Y" }), options)).toBeNull();
    });

    it("rejects unknown details even when other moves already use the same attacking stat", () =>
    {
        const catalog = suggestionCatalog();
        for (const details of [null, {}, { split: "SPLIT_UNKNOWN", power: 80 }, { split: "SPLIT_SPECIAL", power: null }, { split: "SPLIT_SPECIAL", power: 1 }, { split: "SPLIT_SPECIAL", power: NaN }])
        {
            catalog.moves.MOVE_UNKNOWN = details;
            expect(getSuggestedSpread(catalog, createFields({ moves: ["MOVE_FLAMETHROWER", "MOVE_UNKNOWN"] }))).toBeNull();
            for (const { name } of SPREAD_PRESETS)
            {
                const result = getSuggestedSpread(catalog, createFields({ moves: ["MOVE_FLAMETHROWER", "MOVE_UNKNOWN"] }), { preset: name });
                expect(result.role).toBe(name);
                expect(result.fields.spAtkIv).toBe(31);
                expect(getNatureEffect(result.fields.nature).decreased).not.toBe("spAtk");
            }
        }
        expect(getSuggestedSpread(catalog, createFields({ moves: ["MOVE_NOT_IN_CATALOG"] }))).toBeNull();
        expect(getSuggestedSpread(catalog, createFields({ moves: ["MOVE_HIDDENPOWER"], hpIv: undefined }))).toBeNull();
    });

    it("falls back to a suitable current catalog nature, but never invents one", () =>
    {
        const catalog = createCatalog();
        const fields = createFields({ species: "SPECIES_GARCHOMP", moves: ["MOVE_EARTHQUAKE"], nature: "NATURE_ADAMANT" });
        expect(getSuggestedSpread(catalog, fields).fields.nature).toBe("NATURE_ADAMANT");
        catalog.natures = { NATURE_MODEST: "Modest" };
        expect(getSuggestedSpread(catalog, fields)).toBeNull();
    });

    it("does not fall back to a nature lowering Body Press's Defense or fast offense's Speed", () =>
    {
        const catalog = suggestionCatalog();
        catalog.natures = { NATURE_LONELY: "Lonely" };
        expect(getSuggestedSpread(catalog, createFields({ nature: "NATURE_LONELY", moves: ["MOVE_BODYPRESS"] }))).toBeNull();
        catalog.natures = { NATURE_QUIET: "Quiet" };
        expect(getSuggestedSpread(catalog, createFields({ nature: "NATURE_QUIET" }))).toBeNull();
    });

    it("never mutates the catalog or input fields", () =>
    {
        const catalog = suggestionCatalog();
        const fields = createFields({ hpEv: 17, atkIv: 7, nature: "NATURE_HARDY" });
        const before = JSON.stringify({ catalog, fields });
        const result = getSuggestedSpread(catalog, fields);
        expect(JSON.stringify({ catalog, fields })).toBe(before);
        expect(Object.keys(result).sort()).toEqual(["fields", "role"]);
        expect(Object.keys(result.fields).sort()).toEqual(EXPECTED_KEYS);
        expect(result.fields).not.toBe(fields);
    });
});
