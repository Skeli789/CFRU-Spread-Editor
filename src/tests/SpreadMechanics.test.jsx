import { describe, expect, it } from "vitest";
import { createZygardeCatalog } from "./EditorFixtures";

import
{
    DEFAULT_PREVIEW_LEVEL, HIDDEN_POWER_TYPES, LITTLE_CUP_LEVEL, MOVE_HIDDEN_POWER, STAT_USE, calculateSpreadStats,
    calculateStats, getAbilityLabel, getAbilityOptions, getEffectiveAbility, getHiddenPowerType, getIvAutoFix,
    getMaxEv, getMegaAbility, getMegaSpecies, getMoveStatUse, getNatureEffect, getResetIvs, getSpreadLevel, optimizeHiddenPowerIvs, planIvAutoFix,
    isSlowSpeedSpread, stepEv,
} from "../../shared/pokemon-mechanics.mjs";
import
{
    BATTLE_TYPES, applyBattleType, changeBattleType, createNewSpreadFields, getBattleType, getChangedFields, getFieldSymbol, getTeamType, getTeamTypeLabel,
    isSpreadChanged, setEv, setFieldSymbol, setIv, setMove, setTeamType, validateSpreadFields,
} from "../../shared/spread-model.mjs";

const UP = 1;
const DOWN = -1;
const IV_KEYS = ["hpIv", "atkIv", "defIv", "spdIv", "spAtkIv", "spDefIv"];
const GARCHOMP_STATS = { hp: 108, atk: 130, def: 95, spAtk: 80, spDef: 85, spd: 102 };
const CHARIZARD_STATS = { hp: 78, atk: 84, def: 78, spAtk: 109, spDef: 85, spd: 100 };
const MEGA_Y_STATS = { hp: 78, atk: 104, def: 78, spAtk: 159, spDef: 115, spd: 100 };
const TEAM_TYPES =
[
    { name: "DOUBLES_ANY_TEAM", value: 0 },
    { name: "DOUBLES_SUN_TEAM", value: 1 },
    { name: "DOUBLES_TRICK_ROOM_TEAM", value: 7 },
];

// Showdown's standard Hidden Power IVs in HP / Atk / Def / SpA / SpD / Spe order
const SHOWDOWN_HIDDEN_POWER_IVS =
{
    TYPE_BUG: [31, 30, 30, 31, 30, 31],
    TYPE_DARK: [31, 31, 31, 31, 31, 31],
    TYPE_DRAGON: [31, 30, 31, 31, 31, 31],
    TYPE_ELECTRIC: [31, 31, 31, 30, 31, 31],
    TYPE_FIGHTING: [31, 31, 30, 30, 30, 30],
    TYPE_FIRE: [31, 30, 31, 30, 31, 30],
    TYPE_FLYING: [30, 30, 30, 30, 30, 31],
    TYPE_GHOST: [31, 31, 30, 31, 30, 31],
    TYPE_GRASS: [31, 30, 31, 30, 31, 31],
    TYPE_GROUND: [31, 31, 31, 30, 30, 31],
    TYPE_ICE: [31, 30, 30, 31, 31, 31],
    TYPE_POISON: [31, 31, 30, 30, 30, 31],
    TYPE_PSYCHIC: [31, 30, 31, 31, 31, 30],
    TYPE_ROCK: [31, 31, 30, 31, 30, 30],
    TYPE_STEEL: [31, 31, 31, 31, 30, 31],
    TYPE_WATER: [31, 30, 30, 30, 31, 31],
};

const CATALOG =
{
    name: "Test Game",
    species:
    {
        SPECIES_GARCHOMP: { baseStats: GARCHOMP_STATS, abilities: ["ABILITY_ROUGHSKIN", "ABILITY_SANDVEIL", null], megas: [] },
        SPECIES_CHARIZARD:
        {
            baseStats: CHARIZARD_STATS,
            abilities: ["ABILITY_SOLARPOWER", "ABILITY_BLAZE", null],
            megas:
            [
                { species: "SPECIES_CHARIZARD_MEGA_X", item: "ITEM_CHARIZARDITE_X", available: true },
                { species: "SPECIES_CHARIZARD_MEGA_Y", item: "ITEM_CHARIZARDITE_Y", available: true },
            ],
        },
        SPECIES_CHARIZARD_MEGA_X: { baseStats: CHARIZARD_STATS, abilities: [null, "ABILITY_TOUGHCLAWS", null], megas: [] },
        SPECIES_CHARIZARD_MEGA_Y: { baseStats: MEGA_Y_STATS, abilities: [null, "ABILITY_DROUGHT", null], megas: [] },
        SPECIES_SHEDINJA: { baseStats: { hp: 1, atk: 90, def: 45, spAtk: 30, spDef: 30, spd: 40 }, abilities: [null, "ABILITY_WONDERGUARD", null], megas: [] },
        SPECIES_TWINS: { baseStats: GARCHOMP_STATS, abilities: ["ABILITY_LEVITATE", "ABILITY_LEVITATE", "ABILITY_LEVITATE"], megas: [] },
    },
    moves:
    {
        MOVE_EARTHQUAKE: { split: "SPLIT_PHYSICAL", power: 100, effect: "EFFECT_EARTHQUAKE" },
        MOVE_FLAMETHROWER: { split: "SPLIT_SPECIAL", power: 90, effect: "EFFECT_BURN_HIT" },
        MOVE_FOULPLAY: { split: "SPLIT_PHYSICAL", power: 95, effect: "EFFECT_HIT" },
        MOVE_BODYPRESS: { split: "SPLIT_PHYSICAL", power: 80, effect: 0 },
        MOVE_SEISMICTOSS: { split: "SPLIT_PHYSICAL", power: 1, effect: "EFFECT_LEVEL_DAMAGE" },
        MOVE_NATURESMADNESS: { split: "SPLIT_SPECIAL", power: 1, effect: "EFFECT_SUPER_FANG" },
        MOVE_GYROBALL: { split: "SPLIT_PHYSICAL", power: 1, effect: "EFFECT_HIT" },
        MOVE_PHOTONGEYSER: { split: "SPLIT_SPECIAL", power: 100, effect: "EFFECT_HIT" },
        MOVE_PROTECT: { split: "SPLIT_STATUS", power: 0, effect: "EFFECT_PROTECT" },
        MOVE_TRICKROOM: { split: "SPLIT_STATUS", power: 0, effect: "EFFECT_TRICK_ROOM" },
        MOVE_HIDDENPOWER: { split: "SPLIT_SPECIAL", power: 60, effect: "EFFECT_HIT" },
        MOVE_MYSTERY: { split: "SPLIT_PHYSICAL", power: null, effect: null },
    },
};


/**
 * Returns spread values with 31 IVs, no EVs and a neutral nature, changed by the given values.
 *
 * @param {object} [values] Values to change.
 * @returns {object} The spread's values.
 */
function createFields(values = {})
{
    return {
        species: "SPECIES_GARCHOMP",
        nature: "NATURE_HARDY",
        hpIv: 31, atkIv: 31, defIv: 31, spAtkIv: 31, spDefIv: 31, spdIv: 31,
        hpEv: 0, atkEv: 0, defEv: 0, spAtkEv: 0, spDefEv: 0, spdEv: 0,
        ability: 1,
        item: "ITEM_NONE",
        moves: ["MOVE_EARTHQUAKE", 0, 0, 0],
        forSingles: true,
        forDoubles: true,
        modifyMovesDoubles: true,
        ...values,
    };
}

/**
 * Returns IVs in Showdown's HP / Atk / Def / SpA / SpD / Spe order.
 *
 * @param {Array<number>} values The six IVs.
 * @returns {object} The IV fields.
 */
function showdownIvs([hpIv, atkIv, defIv, spAtkIv, spDefIv, spdIv])
{
    return { hpIv, atkIv, defIv, spAtkIv, spDefIv, spdIv };
}

describe("Final stats", () =>
{
    it("match reference values at levels 50 and 100", () =>
    {
        const fields = createFields({ nature: "NATURE_ADAMANT", hpEv: 4, atkEv: 252, spdEv: 252 });

        expect(calculateStats("SPECIES_GARCHOMP", GARCHOMP_STATS, fields, 100)).toEqual({ hp: 358, atk: 394, def: 226, spAtk: 176, spDef: 206, spd: 303 });
        expect(calculateStats("SPECIES_GARCHOMP", GARCHOMP_STATS, fields, 50)).toEqual({ hp: 184, atk: 200, def: 115, spAtk: 90, spDef: 105, spd: 154 });
    });

    it("calculate at level 5 and floor EVs before multiplying", () =>
    {
        const withThree = createFields({ atkEv: 3 });

        expect(calculateStats("SPECIES_GARCHOMP", GARCHOMP_STATS, withThree, LITTLE_CUP_LEVEL).atk).toBe(19);
        expect(calculateStats("SPECIES_GARCHOMP", GARCHOMP_STATS, createFields(), LITTLE_CUP_LEVEL).hp).toBe(27);
    });

    it("give Shedinja 1 HP at every level", () =>
    {
        const fields = createFields({ species: "SPECIES_SHEDINJA", hpEv: 252 });

        for (const level of [LITTLE_CUP_LEVEL, 50, 100])
            expect(calculateStats("SPECIES_SHEDINJA", CATALOG.species.SPECIES_SHEDINJA.baseStats, fields, level).hp).toBe(1);
    });

    it("leave stats unknown when base stats are missing", () =>
    {
        expect(calculateStats("SPECIES_GARCHOMP", null, createFields(), 50).atk).toBeNull();
    });

    it("use the Mega Evolution's base stats only when previewing it", () =>
    {
        const fields = createFields({ species: "SPECIES_CHARIZARD", item: "ITEM_CHARIZARDITE_Y" });
        const mega = calculateSpreadStats(CATALOG, fields, { level: 100 });
        const base = calculateSpreadStats(CATALOG, fields, { level: 100, mega: false });

        expect(mega.species).toBe("SPECIES_CHARIZARD_MEGA_Y");
        expect(mega.mega).toBe(true);
        expect(mega.stats.spAtk).toBe(354);
        expect(base.species).toBe("SPECIES_CHARIZARD");
        expect(base.stats.spAtk).toBe(254);
        expect(fields.species).toBe("SPECIES_CHARIZARD");
    });

    it.each(["SPECIES_ZYGARDE", "SPECIES_ZYGARDE_10"])("preview Mega %s only with Power Construct and Zygardite", (species) =>
    {
        const catalog = createZygardeCatalog();
        const fields = createFields({ species, ability: 0, item: "ITEM_ZYGARDITE" });
        const saved = structuredClone(fields);
        expect(getMegaSpecies(catalog, fields)).toBe("SPECIES_ZYGARDE_MEGA");
        expect(getMegaAbility(catalog, fields)).toEqual({ species: "SPECIES_ZYGARDE_MEGA", ability: "ABILITY_POWERCONSTRUCT" });
        expect(calculateSpreadStats(catalog, fields, { level: 100 }).stats.atk).toBe(336);
        expect(calculateSpreadStats(catalog, fields, { level: 100, mega: false }).stats.atk).toBe(236);
        expect(getMegaSpecies(catalog, { ...fields, ability: 1 })).toBeNull();
        expect(getMegaSpecies(catalog, { ...fields, item: "ITEM_NONE" })).toBeNull();
        catalog.species.SPECIES_ZYGARDE_COMPLETE.megas[0].available = false;
        expect(getMegaSpecies(catalog, fields)).toBeNull();
        catalog.species.SPECIES_ZYGARDE_COMPLETE.megas[0].available = true;
        delete catalog.species.SPECIES_ZYGARDE_MEGA;
        expect(getMegaSpecies(catalog, fields)).toBeNull();
        expect(fields).toEqual(saved);
    });

    it("use level 5 for Little Cup sets and the preview level otherwise", () =>
    {
        expect(getSpreadLevel({ littleCup: true }, 100)).toBe(LITTLE_CUP_LEVEL);
        expect(getSpreadLevel({ littleCup: false }, 100)).toBe(100);
        expect(getSpreadLevel(null, DEFAULT_PREVIEW_LEVEL)).toBe(50);
    });
});

describe("Natures", () =>
{
    it("name the raised and lowered stats", () =>
    {
        expect(getNatureEffect("NATURE_ADAMANT")).toEqual({ increased: "atk", decreased: "spAtk" });
        expect(getNatureEffect("NATURE_TIMID")).toEqual({ increased: "spd", decreased: "atk" });
        expect(getNatureEffect("NATURE_SASSY")).toEqual({ increased: "spDef", decreased: "spd" });
    });

    it("have no arrows for neutral natures and unknown natures", () =>
    {
        expect(getNatureEffect("NATURE_SERIOUS")).toEqual({ increased: null, decreased: null });
        expect(getNatureEffect("NATURE_UNKNOWN")).toBeNull();
    });
});

describe("EV arrows", () =>
{
    it("step to multiples of 4", () =>
    {
        expect(stepEv(createFields(), "atk", UP)).toBe(4);
        expect(stepEv(createFields({ atkEv: 5 }), "atk", UP)).toBe(8);
        expect(stepEv(createFields({ atkEv: 6 }), "atk", DOWN)).toBe(4);
        expect(stepEv(createFields({ atkEv: 4 }), "atk", DOWN)).toBe(0);
        expect(stepEv(createFields(), "atk", DOWN)).toBeNull();
        expect(stepEv(createFields({ atkEv: 252 }), "atk", UP)).toBeNull();
    });

    it("stay within the 510 total", () =>
    {
        expect(getMaxEv(createFields({ hpEv: 252, defEv: 252 }), "atk")).toBe(6);
        expect(stepEv(createFields({ hpEv: 252, defEv: 252, spdEv: 4 }), "atk", UP)).toBeNull();
        expect(stepEv(createFields({ hpEv: 252, defEv: 250 }), "atk", UP)).toBe(4);
    });

    it("skip to the next reachable Little Cup stat when the nature skips one", () =>
    {
        // 2 x 130 + 31 = 291, so Attack is 19 before Adamant raises it to 20, and the next raw 20 becomes 22
        const fields = createFields({ nature: "NATURE_ADAMANT" });
        const littleCup = { species: "SPECIES_GARCHOMP", baseStats: GARCHOMP_STATS };

        expect(stepEv(fields, "atk", UP, littleCup)).toBe(36);
        expect(stepEv({ ...fields, atkEv: 36 }, "atk", DOWN, littleCup)).toBe(0);
    });

    it("step to the fewest EVs for the next Little Cup stat", () =>
    {
        const littleCup = { species: "SPECIES_GARCHOMP", baseStats: GARCHOMP_STATS };

        expect(stepEv(createFields({ atkEv: 200 }), "atk", DOWN, littleCup)).toBe(116);
        expect(stepEv(createFields({ atkEv: 116 }), "atk", UP, littleCup)).toBe(196);
        expect(stepEv(createFields({ atkEv: 200 }), "atk", UP, littleCup)).toBeNull();
    });

    it("clear Little Cup EVs that do not change the stat", () =>
    {
        const littleCup = { species: "SPECIES_GARCHOMP", baseStats: GARCHOMP_STATS };

        expect(stepEv(createFields({ atkEv: 20 }), "atk", DOWN, littleCup)).toBe(0);
        expect(stepEv(createFields(), "atk", DOWN, littleCup)).toBeNull();
    });

    it("never find a Little Cup HP change for Shedinja", () =>
    {
        const littleCup = { species: "SPECIES_SHEDINJA", baseStats: CATALOG.species.SPECIES_SHEDINJA.baseStats };
        const fields = createFields({ species: "SPECIES_SHEDINJA", hpEv: 8 });

        expect(stepEv(fields, "hp", UP, littleCup)).toBeNull();
        expect(stepEv(fields, "hp", DOWN, littleCup)).toBe(0);
    });

    it("do not raise a Little Cup stat past the EV budget", () =>
    {
        const littleCup = { species: "SPECIES_GARCHOMP", baseStats: GARCHOMP_STATS };

        expect(stepEv(createFields({ hpEv: 252, defEv: 252 }), "atk", UP, littleCup)).toBeNull();
    });
});

describe("EV and IV entry", () =>
{
    it("retains entered EVs beyond legal limits while clamping negatives and ignoring nonintegers", () =>
    {
        const fields = createFields();
        expect(setEv(createFields(), "atk", 5).atkEv).toBe(5);
        expect(setEv(fields, "atk", 300).atkEv).toBe(300);
        expect(setEv(fields, "atk", 1000).atkEv).toBe(1000);
        expect(setEv(createFields(), "atk", -4).atkEv).toBe(0);
        expect(setEv(createFields({ hpEv: 252, defEv: 248 }), "atk", 20).atkEv).toBe(20);
        expect(setEv(fields, "atk", 1.5)).toBe(fields);
        expect(setEv(fields, "atk", Number.NaN)).toBe(fields);
        expect(setEv(fields, "atk", Number.POSITIVE_INFINITY)).toBe(fields);
        expect(fields.atkEv).toBe(0);
        expect(validateSpreadFields(setEv(fields, "atk", 300)).map((problem) => problem.field)).toEqual(["atkEv"]);
        expect(validateSpreadFields(setEv(createFields({ hpEv: 252, defEv: 248 }), "atk", 20)).map((problem) => problem.field)).toEqual(["evTotal"]);
    });

    it("keeps entered IVs within 0 to 31 and ignores entries that are not whole numbers", () =>
    {
        const fields = createFields();

        expect(setIv(fields, "spd", 40).spdIv).toBe(31);
        expect(setIv(fields, "spd", 0).spdIv).toBe(0);
        expect(setIv(fields, "spd", 1.5)).toBe(fields);
        expect(setEv(fields, "spd", Number.NaN)).toBe(fields);
    });

    it("reports invalid values without changing them", () =>
    {
        const fields = createFields({ hpEv: 252, atkEv: 252, defEv: 8, spdIv: 32 });

        expect(validateSpreadFields(createFields({ hpEv: 252, atkEv: 252, defEv: 6 }))).toEqual([]);
        expect(validateSpreadFields(fields).map((problem) => problem.field)).toEqual(["spdIv", "evTotal"]);
        expect(validateSpreadFields(createFields({ atkEv: 253 })).map((problem) => problem.field)).toEqual(["atkEv"]);
        expect(fields.spdIv).toBe(32);
    });
});

describe("Abilities", () =>
{
    it("list only real abilities with their slot labels", () =>
    {
        expect(getAbilityOptions(CATALOG.species.SPECIES_GARCHOMP)).toEqual(
        [
            { slot: 1, ability: "ABILITY_SANDVEIL", label: "[1]" },
            { slot: 0, ability: "ABILITY_ROUGHSKIN", label: "[H]" },
        ]);
        expect(getAbilityLabel(2)).toBe("[2]");
    });

    it("keep every slot when slots share an ability", () =>
    {
        expect(getAbilityOptions(CATALOG.species.SPECIES_TWINS).map((option) => option.label)).toEqual(["[1]", "[2]", "[H]"]);
    });

    it("fall back to the first ability for an empty slot, like CFRU", () =>
    {
        expect(getEffectiveAbility(CATALOG.species.SPECIES_GARCHOMP, 2)).toBe("ABILITY_SANDVEIL");
    });

    it("preview the ability after Mega Evolving for each Mega Stone", () =>
    {
        const fields = createFields({ species: "SPECIES_CHARIZARD", ability: 0 });

        expect(getMegaAbility(CATALOG, { ...fields, item: "ITEM_CHARIZARDITE_X" })).toEqual({ species: "SPECIES_CHARIZARD_MEGA_X", ability: "ABILITY_TOUGHCLAWS" });
        expect(getMegaAbility(CATALOG, { ...fields, item: "ITEM_CHARIZARDITE_Y" })).toEqual({ species: "SPECIES_CHARIZARD_MEGA_Y", ability: "ABILITY_DROUGHT" });
        expect(getMegaAbility(CATALOG, { ...fields, item: "ITEM_LEFTOVERS" })).toBeNull();
    });
});

describe("Battle types", () =>
{
    it("write the flags for each type", () =>
    {
        const fields = createFields({ modifyMovesDoubles: false });

        expect(applyBattleType(fields, BATTLE_TYPES.SINGLES)).toMatchObject({ forSingles: true, forDoubles: false, modifyMovesDoubles: true });
        expect(applyBattleType(fields, BATTLE_TYPES.DOUBLES)).toMatchObject({ forSingles: false, forDoubles: true, modifyMovesDoubles: false });
        expect(applyBattleType(fields, BATTLE_TYPES.BOTH)).toMatchObject({ forSingles: true, forDoubles: true, modifyMovesDoubles: false });
    });

    it("restore the earlier Modify Moves Doubles choice when switching back to Both", () =>
    {
        const singles = applyBattleType(createFields({ modifyMovesDoubles: false }), BATTLE_TYPES.SINGLES);

        expect(applyBattleType(singles, BATTLE_TYPES.BOTH, false).modifyMovesDoubles).toBe(false);
    });

    it("read contradictory existing flags without changing them", () =>
    {
        const fields = createFields({ forSingles: false, forDoubles: false });

        expect(getBattleType(fields)).toBe(BATTLE_TYPES.NEITHER);
        expect(getBattleType(createFields({ forDoubles: false }))).toBe(BATTLE_TYPES.SINGLES);
        expect(applyBattleType(fields, BATTLE_TYPES.NEITHER)).toBe(fields);
    });
});

describe("Doubles team types", () =>
{
    it("read omitted and named team types", () =>
    {
        expect(getTeamType(createFields({ specificTeamType: 0 }), TEAM_TYPES)).toBe("DOUBLES_ANY_TEAM");
        expect(getTeamType(createFields({ specificTeamType: "DOUBLES_SUN_TEAM" }), TEAM_TYPES)).toBe("DOUBLES_SUN_TEAM");
        expect(getTeamType(createFields({ specificTeamType: 99 }), TEAM_TYPES)).toBeNull();
    });

    it("restore the saved value when the saved team type is chosen again", () =>
    {
        const saved = createFields({ specificTeamType: 0 });
        const sun = setTeamType(saved, "DOUBLES_SUN_TEAM", TEAM_TYPES, saved);

        expect(sun.specificTeamType).toBe("DOUBLES_SUN_TEAM");
        expect(isSpreadChanged(setTeamType(sun, "DOUBLES_ANY_TEAM", TEAM_TYPES, saved), saved)).toBe(false);
        expect(setTeamType(createFields({ specificTeamType: "DOUBLES_SUN_TEAM" }), "DOUBLES_ANY_TEAM", TEAM_TYPES).specificTeamType).toBe("DOUBLES_ANY_TEAM");
    });

    it("have readable names", () =>
    {
        expect(getTeamTypeLabel("DOUBLES_TRICK_ROOM_TEAM")).toBe("Trick Room");
        expect(getTeamTypeLabel("DOUBLES_ANY_TEAM")).toBe("Any");
        expect(getTeamTypeLabel("CUSTOM_TYPE")).toBe("Custom Type");
    });

    it("reset to Any when the battle type leaves Doubles Only, keeping an omitted value omitted", () =>
    {
        const saved = createFields({ forSingles: false, forDoubles: true, modifyMovesDoubles: false, specificTeamType: 0 });
        const sun = setTeamType(saved, "DOUBLES_SUN_TEAM", TEAM_TYPES, saved);
        const both = changeBattleType(sun, BATTLE_TYPES.BOTH, { saved, teamTypes: TEAM_TYPES, bothModifyMovesDoubles: true });

        expect(both).toMatchObject({ forSingles: true, forDoubles: true, modifyMovesDoubles: true, specificTeamType: 0 });
        expect(changeBattleType(sun, BATTLE_TYPES.DOUBLES, { saved, teamTypes: TEAM_TYPES }).specificTeamType).toBe("DOUBLES_SUN_TEAM");

        const savedSun = createFields({ forSingles: false, forDoubles: true, specificTeamType: 1 });
        expect(changeBattleType(savedSun, BATTLE_TYPES.SINGLES, { saved: savedSun, teamTypes: TEAM_TYPES }).specificTeamType).toBe("DOUBLES_ANY_TEAM");
        expect(changeBattleType(savedSun, BATTLE_TYPES.SINGLES, { saved: savedSun, teamTypes: [] }).specificTeamType).toBe(1);
    });
});

describe("Omitted fields", () =>
{
    it("read an omitted 0 as the constant the editor shows for it, with a random ball", () =>
    {
        const fields = createFields({ nature: 0, item: 0, ball: 0 });

        expect(getFieldSymbol(fields, "nature")).toBe("NATURE_HARDY");
        expect(getFieldSymbol(fields, "item")).toBe("ITEM_NONE");
        expect(getFieldSymbol(fields, "ball")).toBe("BALL_TYPE_RANDOM");
        expect(getFieldSymbol(fields, "ability")).toBe(1);
    });

    it("stay omitted when the constant they stand for is chosen again", () =>
    {
        const saved = createFields({ item: 0 });
        const leftovers = setFieldSymbol(saved, "item", "ITEM_LEFTOVERS", saved);

        expect(leftovers.item).toBe("ITEM_LEFTOVERS");
        expect(setFieldSymbol(leftovers, "item", "ITEM_NONE", saved).item).toBe(0);
        expect(setFieldSymbol(createFields(), "item", "ITEM_LEFTOVERS").item).toBe("ITEM_LEFTOVERS");
    });
});

describe("Hidden Power", () =>
{
    it("matches reference IV patterns", () =>
    {
        expect(getHiddenPowerType(showdownIvs([31, 31, 31, 31, 31, 31]))).toBe("TYPE_DARK");
        expect(getHiddenPowerType(showdownIvs([31, 30, 30, 31, 31, 31]))).toBe("TYPE_ICE");
        expect(getHiddenPowerType(showdownIvs([31, 30, 31, 30, 31, 30]))).toBe("TYPE_FIRE");
        expect(getHiddenPowerType(showdownIvs([31, 31, 31, 30, 30, 31]))).toBe("TYPE_GROUND");
        expect(getHiddenPowerType(showdownIvs([31, 31, 30, 30, 30, 30]))).toBe("TYPE_FIGHTING");
        expect(getHiddenPowerType(showdownIvs([31, 31, 31, 30, 31, 31]))).toBe("TYPE_ELECTRIC");
    });

    it("weighs HP, Attack, Defense, Speed, Sp. Atk and Sp. Def parity for all 64 patterns", () =>
    {
        const weights = { hpIv: 1, atkIv: 2, defIv: 4, spdIv: 8, spAtkIv: 16, spDefIv: 32 };
        for (let mask = 0; mask < 64; ++mask)
        {
            const ivs = Object.fromEntries(IV_KEYS.map((key, bit) => [key, 30 + ((mask >> bit) & 1)]));
            const sum = IV_KEYS.reduce((total, key) => total + (ivs[key] % 2) * weights[key], 0);

            expect(getHiddenPowerType(ivs)).toBe(HIDDEN_POWER_TYPES[Math.floor(sum * 15 / 63)]);
        }
    });

    it("offers every type except Normal and Fairy", () =>
    {
        expect(HIDDEN_POWER_TYPES).toHaveLength(16);
        expect(HIDDEN_POWER_TYPES).not.toContain("TYPE_NORMAL");
        expect(HIDDEN_POWER_TYPES).not.toContain("TYPE_FAIRY");
    });

    it("finds high IVs for all 16 types", () =>
    {
        for (const type of HIDDEN_POWER_TYPES)
        {
            const ivs = optimizeHiddenPowerIvs(createFields(), type);

            expect(getHiddenPowerType(ivs)).toBe(type);
            expect(Math.min(...Object.values(ivs))).toBeGreaterThanOrEqual(30);
        }
    });

    it("keeps low IVs low for all 16 types", () =>
    {
        for (const type of HIDDEN_POWER_TYPES)
        {
            const ivs = optimizeHiddenPowerIvs(createFields({ atkIv: 0 }), type);

            expect(getHiddenPowerType(ivs)).toBe(type);
            expect(ivs.atkIv).toBeLessThanOrEqual(1);
        }
    });

    it("chooses Showdown's standard IVs for all 16 types", () =>
    {
        for (const type of HIDDEN_POWER_TYPES)
            expect(optimizeHiddenPowerIvs(createFields(), type), type).toEqual(showdownIvs(SHOWDOWN_HIDDEN_POWER_IVS[type]));
    });

    it("lowers Speed only for types that cannot have an odd Speed IV", () =>
    {
        for (const type of HIDDEN_POWER_TYPES)
        {
            const oddSpeedPossible = Array.from({ length: 64 }, (_, mask) => mask).some((mask) =>
            {
                const ivs = Object.fromEntries(IV_KEYS.map((key, bit) => [key, 30 + ((mask >> bit) & 1)]));
                return ivs.spdIv === 31 && getHiddenPowerType(ivs) === type;
            });

            expect(optimizeHiddenPowerIvs(createFields(), type).spdIv, type).toBe(oddSpeedPossible ? 31 : 30);
        }
    });

    it("keeps a minimized Speed IV low", () =>
    {
        for (const type of ["TYPE_ICE", "TYPE_FIRE", "TYPE_GROUND"])
        {
            const ivs = optimizeHiddenPowerIvs(createFields({ spdIv: 0 }), type);

            expect(ivs.spdIv, type).toBe(0);
            expect(getHiddenPowerType(ivs)).toBe(type);
        }
    });

    it("leaves matching IVs alone", () =>
    {
        const ice = showdownIvs([30, 31, 30, 31, 31, 31]);

        expect(getHiddenPowerType(ice)).toBe("TYPE_ICE");
        expect(optimizeHiddenPowerIvs(ice, "TYPE_ICE")).toEqual(ice);
        expect(optimizeHiddenPowerIvs(createFields(), "TYPE_FAIRY")).toBeNull();
    });

    it("changes the IVs when a typed Hidden Power is chosen", () =>
    {
        const fields = setMove(createFields(), 1, MOVE_HIDDEN_POWER, "TYPE_FIRE");

        expect(fields.moves).toEqual(["MOVE_EARTHQUAKE", MOVE_HIDDEN_POWER, 0, 0]);
        expect(getHiddenPowerType(fields)).toBe("TYPE_FIRE");
        expect(setMove(fields, 1, null).moves).toEqual(["MOVE_EARTHQUAKE", 0, 0, 0]);
    });
});

describe("IV auto-fix", () =>
{
    it("ignores Foul Play, Body Press, fixed damage and status moves", () =>
    {
        const fields = createFields({ moves: ["MOVE_FOULPLAY", "MOVE_BODYPRESS", "MOVE_SEISMICTOSS", "MOVE_PROTECT"] });

        expect(getIvAutoFix(CATALOG, fields).changes).toEqual({ atkIv: 0, spAtkIv: 0 });
        expect(getMoveStatUse("MOVE_NATURESMADNESS", CATALOG.moves.MOVE_NATURESMADNESS)).toEqual({ atk: STAT_USE.UNUSED, spAtk: STAT_USE.UNUSED });
    });

    it("keeps the attacking IV of variable power moves", () =>
    {
        const fix = getIvAutoFix(CATALOG, createFields({ moves: ["MOVE_GYROBALL", "MOVE_PROTECT", 0, 0] }));

        expect(fix.uses).toEqual({ atk: STAT_USE.USED, spAtk: STAT_USE.UNUSED });
        expect(fix.changes).toEqual({ spAtkIv: 0, spdIv: 0 });
    });

    it("lowers Speed for Trick Room and Gyro Ball, keeping a Hidden Power's type", () =>
    {
        expect(getIvAutoFix(CATALOG, createFields({ moves: ["MOVE_EARTHQUAKE", "MOVE_TRICKROOM", 0, 0] })).changes).toEqual({ spAtkIv: 0, spdIv: 0 });
        expect(getIvAutoFix(CATALOG, createFields()).changes).toEqual({ spAtkIv: 0 });

        const fields = createFields({ ...showdownIvs([31, 30, 31, 30, 31, 30]), moves: [MOVE_HIDDEN_POWER, "MOVE_TRICKROOM", "MOVE_FLAMETHROWER", 0] });
        const fix = getIvAutoFix(CATALOG, fields);
        expect(fix.changes.spdIv).toBeLessThanOrEqual(1);
        expect(getHiddenPowerType({ ...fields, ...fix.changes })).toBe("TYPE_FIRE");
        expect(getResetIvs(CATALOG, createFields({ spdIv: 12, moves: ["MOVE_GYROBALL", 0, 0, 0] })).spdIv).toBe(0);
    });

    it("minimizes Speed for a Trick Room team without slow moves on auto-fix and reset", () =>
    {
        const fields = createFields({ specificTeamType: "DOUBLES_TRICK_ROOM_TEAM", spdIv: 12 });
        const before = JSON.stringify(fields);
        expect(getIvAutoFix(CATALOG, fields).changes).toEqual({ spAtkIv: 0, spdIv: 0 });
        expect(getResetIvs(CATALOG, fields)).toMatchObject({ atkIv: 31, spAtkIv: 0, spdIv: 0 });
        expect(JSON.stringify(fields)).toBe(before);
        const ordinary = { ...fields, specificTeamType: "DOUBLES_SUN_TEAM" };
        expect(getIvAutoFix(CATALOG, ordinary).changes).not.toHaveProperty("spdIv");
        expect(getResetIvs(CATALOG, ordinary).spdIv).toBe(31);
    });

    it.each([19, 73])("resolves numeric Trick Room team %i for the helper, reset and IV planner", (value) =>
    {
        const teamTypes = TEAM_TYPES.map((team) => team.name === "DOUBLES_TRICK_ROOM_TEAM" ? { ...team, value } : team);
        const fields = createFields({ specificTeamType: value, spdIv: 12 });
        const before = JSON.stringify({ fields, teamTypes });
        const symbolic = { ...fields, specificTeamType: "DOUBLES_TRICK_ROOM_TEAM" };
        expect(isSlowSpeedSpread(fields, teamTypes)).toBe(true);
        expect(isSlowSpeedSpread(symbolic)).toBe(true);
        expect(getIvAutoFix(CATALOG, fields, teamTypes)).toEqual(getIvAutoFix(CATALOG, symbolic));
        expect(getResetIvs(CATALOG, fields, teamTypes)).toEqual(getResetIvs(CATALOG, symbolic));
        expect(planIvAutoFix(CATALOG, [{ id: "numeric", fields }], teamTypes).changes[0].fields)
            .toEqual({ spAtkIv: 0, spdIv: 0 });
        expect(isSlowSpeedSpread(fields)).toBe(false);
        for (const specificTeamType of [0, 1, value + 1, null, undefined])
            expect(isSlowSpeedSpread({ ...fields, specificTeamType }, teamTypes)).toBe(false);
        expect(isSlowSpeedSpread({ ...fields, specificTeamType: null }, [{ name: "DOUBLES_TRICK_ROOM_TEAM", value: null }])).toBe(false);
        expect(JSON.stringify({ fields, teamTypes })).toBe(before);
    });

    it.each(HIDDEN_POWER_TYPES)("preserves %s while minimizing Trick Room team Speed on auto-fix and reset", (type) =>
    {
        const fields = createFields(
        {
            ...optimizeHiddenPowerIvs(createFields(), type),
            specificTeamType: "DOUBLES_TRICK_ROOM_TEAM", moves: [MOVE_HIDDEN_POWER, "MOVE_FLAMETHROWER", 0, 0],
        });
        const numeric = { ...fields, specificTeamType: TEAM_TYPES.find(({ name }) => name === "DOUBLES_TRICK_ROOM_TEAM").value };
        const fixed = { ...fields, ...getIvAutoFix(CATALOG, fields).changes };
        const reset = getResetIvs(CATALOG, fields);
        const numericFixed = { ...numeric, ...getIvAutoFix(CATALOG, numeric, TEAM_TYPES).changes };
        const numericReset = getResetIvs(CATALOG, numeric, TEAM_TYPES);
        expect(numericReset).toEqual(reset);
        for (const ivs of [fixed, reset, numericFixed, numericReset])
        {
            expect([0, 1]).toContain(ivs.spdIv);
            expect(getHiddenPowerType(ivs)).toBe(type);
        }
    });

    it("keeps both IVs for moves that pick their category from the higher stat", () =>
    {
        expect(getIvAutoFix(CATALOG, createFields({ moves: ["MOVE_PHOTONGEYSER", 0, 0, 0] })).changes).toEqual({});
    });

    it("raises the attacking IVs a move needs to 31, keeping a Hidden Power's type", () =>
    {
        expect(getIvAutoFix(CATALOG, createFields({ atkIv: 12, spAtkIv: 0 })).changes).toEqual({ atkIv: 31 });
        expect(getIvAutoFix(CATALOG, createFields({ atkIv: 12, spAtkIv: 5, moves: ["MOVE_PHOTONGEYSER", 0, 0, 0] })).changes).toEqual({ atkIv: 31, spAtkIv: 31 });

        const fields = createFields({ ...showdownIvs([31, 30, 31, 30, 31, 30]), spAtkIv: 20, moves: [MOVE_HIDDEN_POWER, "MOVE_FLAMETHROWER", 0, 0] });
        const fix = getIvAutoFix(CATALOG, fields);
        expect(fix.changes).toEqual({ atkIv: 0, spAtkIv: 30 });
        expect(fix.hiddenPowerIvs).toEqual(["spAtkIv"]);
        expect(getHiddenPowerType({ ...fields, ...fix.changes })).toBe("TYPE_FIRE");
    });

    it("keeps Attack at 1 when Hidden Power needs it odd", () =>
    {
        const fields = createFields({ ...showdownIvs([31, 31, 31, 30, 31, 31]), moves: [MOVE_HIDDEN_POWER, "MOVE_PROTECT", 0, 0] });
        const fix = getIvAutoFix(CATALOG, fields);

        expect(fix.changes).toEqual({ atkIv: 1 });
        expect(fix.hiddenPowerIvs).toEqual(["atkIv"]);
        expect(getHiddenPowerType({ ...fields, ...fix.changes })).toBe("TYPE_ELECTRIC");
    });

    it("sets Attack to 0 when Hidden Power needs it even", () =>
    {
        const fields = createFields({ ...showdownIvs([31, 30, 31, 30, 31, 30]), moves: [MOVE_HIDDEN_POWER, "MOVE_FLAMETHROWER", 0, 0] });

        expect(getIvAutoFix(CATALOG, fields).changes).toEqual({ atkIv: 0 });
    });

    it("leaves a stat alone when a move's details are unknown", () =>
    {
        const fix = getIvAutoFix(CATALOG, createFields({ moves: ["MOVE_MYSTERY", "MOVE_FLAMETHROWER", 0, 0] }));

        expect(fix.changes).toEqual({});
        expect(fix.unknown).toEqual(["atk"]);
        expect(getMoveStatUse("MOVE_UNDEFINED", null)).toEqual({ atk: STAT_USE.UNKNOWN, spAtk: STAT_USE.UNKNOWN });
    });

    it("plans changes for many spreads and reports skipped stats", () =>
    {
        const plan = planIvAutoFix(CATALOG,
        [
            { id: "a", fields: createFields() },
            { id: "b", fields: createFields({ spAtkIv: 0 }) },
            { id: "c", fields: createFields({ moves: ["MOVE_MYSTERY", 0, 0, 0] }) },
        ]);

        expect(plan.changes).toEqual([{ id: "a", fields: { spAtkIv: 0 }, hiddenPowerIvs: [] }, { id: "c", fields: { spAtkIv: 0 }, hiddenPowerIvs: [] }]);
        expect(plan.skipped).toEqual([{ id: "c", stats: ["atk"] }]);
    });

    it("resets IVs to 31 except unused attacking IVs, keeping a Hidden Power's type", () =>
    {
        const physical = createFields({ hpIv: 3, defIv: 0, spAtkIv: 20, spdIv: 0 });
        expect(getResetIvs(CATALOG, physical)).toEqual({ hpIv: 31, atkIv: 31, defIv: 31, spAtkIv: 0, spDefIv: 31, spdIv: 31 });

        const fire = createFields({ ...showdownIvs([20, 3, 5, 12, 9, 8]), moves: [MOVE_HIDDEN_POWER, "MOVE_FLAMETHROWER", 0, 0] });
        const type = getHiddenPowerType(fire);
        const reset = getResetIvs(CATALOG, fire);
        expect(getHiddenPowerType(reset)).toBe(type);
        expect(reset.atkIv).toBeLessThanOrEqual(1);
        expect(Math.min(reset.hpIv, reset.defIv, reset.spAtkIv, reset.spDefIv, reset.spdIv)).toBeGreaterThanOrEqual(30);
    });
});

describe("Changed fields", () =>
{
    it("lists only changed values and clears when values are reverted", () =>
    {
        const saved = createFields();
        const edited = setMove(setIv(saved, "atk", 0), 1, "MOVE_PROTECT");

        expect(getChangedFields(edited, saved)).toEqual({ atkIv: 0, moves: ["MOVE_EARTHQUAKE", "MOVE_PROTECT", 0, 0] });
        expect(isSpreadChanged(setMove(setIv(edited, "atk", 31), 1, 0), saved)).toBe(false);
    });

    it("creates new spreads with the documented defaults", () =>
    {
        const fields = createNewSpreadFields("SPECIES_GARCHOMP", CATALOG.species.SPECIES_GARCHOMP);

        expect(fields).toMatchObject({ species: "SPECIES_GARCHOMP", nature: "NATURE_HARDY", ability: 1, item: "ITEM_NONE", ball: "BALL_TYPE_RANDOM",
            moves: [0, 0, 0, 0], shiny: false, gigantamax: false, specificTeamType: 0 });
        expect(getBattleType(fields)).toBe(BATTLE_TYPES.BOTH);
        expect(fields.modifyMovesDoubles).toBe(true);
        expect(IV_KEYS.map((key) => fields[key])).toEqual([31, 31, 31, 31, 31, 31]);
        expect(createNewSpreadFields("SPECIES_SHEDINJA", CATALOG.species.SPECIES_SHEDINJA).ability).toBe(1);
    });
});
