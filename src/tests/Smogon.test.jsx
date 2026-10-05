import { convertStatPoints, expandSmogonSet, getSmogonSpeciesNames, MAX_SMOGON_VARIANTS } from "../../shared/smogon.mjs";
import { resolveImportedSet } from "../../shared/showdown.mjs";
import { getHiddenPowerType } from "../../shared/pokemon-mechanics.mjs";
import { createCatalog } from "./EditorFixtures";

const SPECIES = "SPECIES_CHARIZARD";


/**
 * Builds one response entry with optional moveset overrides.
 *
 * @param {object} moveset The moveset overrides.
 * @returns {object} The entry.
 */
function entry(moveset = {})
{
    return { format: "gen9ou", species: "Charizard", name: "Offense", description: null,
        moveset: { moves: ["Flamethrower", ["Air Slash", "Protect"]], ability: ["Blaze", "Solar Power"], ...moveset } };
}

describe("Smogon shared adapter", () =>
{
    test("requests unique base and Mega names with catalog fallback", () =>
    {
        const catalog = createCatalog();
        catalog.species.SPECIES_CHARIZARD_MEGA_X.showdownName = "Charizard-Mega-X";
        expect(getSmogonSpeciesNames(catalog, SPECIES)).toEqual(["Charizard", "Charizard-Mega-X", "Mega Charizard Y"]);
        catalog.species.SPECIES_CHARIZARD_MEGA_Y.showdownName = "Charizard";
        expect(getSmogonSpeciesNames(catalog, SPECIES)).toHaveLength(2);
    });

    test("expands the Cartesian product and labels only differing values", () =>
    {
        const variants = expandSmogonSet(createCatalog(), SPECIES, entry({ item: ["Leftovers", "Life Orb"], nature: ["Timid", "Modest"], evs: [{ spa: 252 }, { spe: 252 }] }));
        expect(variants).toHaveLength(8);
        expect(variants[0].title).toBe("Offense (Leftovers, Timid, Spread 1)");
        expect(variants[7].title).toBe("Offense (Life Orb, Modest, Spread 2)");
        expect(variants[0].set.moves).toEqual(["Flamethrower", "Air Slash"]);
        expect(variants[0].set.ability).toBe("Blaze");
        expect(new Set(variants.map((variant) => variant.id)).size).toBe(8);
    });

    test("caps variants and leaves singleton titles unchanged", () =>
    {
        expect(expandSmogonSet(createCatalog(), SPECIES, entry({ item: Array(30).fill("Leftovers") }))).toHaveLength(MAX_SMOGON_VARIANTS);
        expect(expandSmogonSet(createCatalog(), SPECIES, entry())[0].title).toBe("Offense");
    });

    test("includes Gigantamax and bounds large form requests", () =>
    {
        const catalog = createCatalog();
        catalog.species.SPECIES_CHARIZARD_GIGA = { ...catalog.species[SPECIES], showdownName: "Charizard-Gmax", megas: [], gigantamax: null };
        for (let index = 0; index < 20; index++)
        {
            const form = `SPECIES_CHARIZARD_TEST_${index}`;
            catalog.species[form] = { ...catalog.species.SPECIES_CHARIZARD_MEGA_X, showdownName: `Charizard-Test-${index}` };
            catalog.species[SPECIES].megas.push({ species: form, item: "ITEM_CHARIZARDITE_X", available: true });
        }
        const names = getSmogonSpeciesNames(catalog, SPECIES);
        expect(names).toHaveLength(16);
        expect(names).toContain("Charizard-Gmax");
    });

    test("keeps ordinary EVs and first IVs, labels nature-only variants and honors explicit Mega items", () =>
    {
        const catalog = createCatalog();
        const variants = expandSmogonSet(catalog, SPECIES, { ...entry({ nature: ["Timid", "Modest"], item: "Leftovers",
            ivs: [{ atk: 0 }, { atk: 31 }], evs: { spa: 252, spe: 252 } }), species: "Mega Charizard Y" });
        expect(variants.map((variant) => variant.title)).toEqual(["Offense (Timid)", "Offense (Modest)"]);
        expect(variants[0].set.ivs).toEqual({ atk: 0 });
        expect(variants[0].set.evs).toEqual({ spa: 252, spe: 252 });
        expect(variants[0].set.item).toBe("Leftovers");
    });

    test("converts Stat Points and trims the smallest investment to 510", () =>
    {
        expect(convertStatPoints({ hp: 2, spa: 32, spe: 32 })).toEqual({ hp: 6, atk: 0, def: 0, spa: 252, spd: 0, spe: 252 });
        expect(convertStatPoints({ hp: 1, atk: 40 })).toEqual({ hp: 4, atk: 252, def: 0, spa: 0, spd: 0, spe: 0 });
        const champions = { ...entry({ evs: [{ hp: 2, spa: 32, spe: 32 }] }), format: "championsou" };
        expect(expandSmogonSet(createCatalog(), SPECIES, champions)[0].set.evs.hp).toBe(6);
    });

    test("uses base species and Mega item fallback and resolves through Showdown", () =>
    {
        const catalog = createCatalog();
        catalog.species.SPECIES_CHARIZARD_MEGA_Y.showdownName = "Charizard-Mega-Y";
        const variant = expandSmogonSet(catalog, SPECIES, { ...entry(), species: "Charizard-Mega-Y" })[0];
        expect(variant.set.species).toBe("Charizard");
        expect(variant.set.item).toBe("Charizardite Y");
        const resolved = resolveImportedSet(catalog, variant.set, { hiddenPower: "optimizeIvs" });
        expect(resolved.errors).toEqual([]);
        expect(resolved.fields.item).toBe("ITEM_CHARIZARDITE_Y");
        expect(resolved.fields.species).toBe(SPECIES);
    });

    test("resolves a Mega ability from a base-species Smogon set without an ability warning", () =>
    {
        const catalog = createCatalog();
        const variant = expandSmogonSet(catalog, SPECIES, entry({ item: "Charizardite X", ability: "Tough Claws" }))[0];
        expect(variant.set.species).toBe("Charizard");
        const result = resolveImportedSet(catalog, variant.set, { hiddenPower: "optimizeIvs" });
        expect(result.errors).toEqual([]);
        expect(result.fields).toMatchObject({ species: SPECIES, item: "ITEM_CHARIZARDITE_X", ability: 1 });
        expect(result.warnings.filter((warning) => warning.field === "ability")).toEqual([]);
    });

    test("optimizes typed Hidden Power when resolving a plain Smogon set", () =>
    {
        const catalog = createCatalog();
        const variant = expandSmogonSet(catalog, SPECIES, entry({ moves: [["Hidden Power [Fire]", "Protect"]] }))[0];
        const result = resolveImportedSet(catalog, variant.set, { hiddenPower: "optimizeIvs" });
        expect(result.errors).toEqual([]);
        expect(getHiddenPowerType(result.fields)).toBe("TYPE_FIRE");
    });
});
