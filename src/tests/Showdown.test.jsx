import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getOutOfBattleForm, isBattleOnlySpecies } from "../../shared/catalog.mjs";
import { HIDDEN_POWER_TYPES, getHiddenPowerType, optimizeHiddenPowerIvs } from "../../shared/pokemon-mechanics.mjs";
import { applyOverwrite, countImportedSets, exportSpread, exportSpreads, parseShowdownText, resolveImportedSet, MAX_SHOWDOWN_LENGTH, MAX_SHOWDOWN_SETS, SHOWDOWN_PLACEHOLDER_ERROR } from "../../shared/showdown.mjs";
import { createCatalog, createFields } from "./EditorFixtures.js";

const CATALOG = createCatalog();
const TEAM_TYPES = [{ name: "DOUBLES_ANY_TEAM", value: 0 }, { name: "DOUBLES_TRICK_ROOM_TEAM", value: 1 }];

/**
 * Parses Showdown text and resolves its first set.
 *
 * @param {string} text Showdown text.
 * @param {object} [options] Resolution choices.
 * @param {object} [catalog] Catalog.
 * @returns {object} Resolved first set.
 */
function resolve(text, options = {}, catalog = CATALOG)
{
    const parsed = parseShowdownText(text);
    expect(parsed.errors).toEqual([]);
    return resolveImportedSet(catalog, parsed.sets[0], options);
}

describe("Showdown adapter", () =>
{
    it("exports and imports every representable field without reordering Speed and Sp. Def", () =>
    {
        const fields = createFields({ hpIv: 29, atkIv: 0, defIv: 1, spAtkIv: 30, spDefIv: 17, spdIv: 2, hpEv: 4, spDefEv: 252, spdEv: 252, ball: "BALL_TYPE_MASTER_BALL", shiny: true, gigantamax: true });
        const exported = exportSpread(CATALOG, fields, { level: 50 });
        expect(exported.errors).toEqual([]);
        expect(exported.text).toContain("Level: 50");
        expect(exported.text).toContain("252 SpD / 252 Spe");
        const imported = resolve(exported.text, { expectedLevel: 50 });
        expect(imported.errors).toEqual([]);
        expect(imported.ambiguities).toEqual([]);
        for (const name of ["species", "nature", "ability", "item", "ball", "shiny", "gigantamax", "moves", "hpIv", "atkIv", "defIv", "spAtkIv", "spDefIv", "spdIv", "hpEv", "atkEv", "defEv", "spAtkEv", "spDefEv", "spdEv"])
            expect(imported.fields[name], name).toEqual(fields[name]);
    });

    it("accepts named multi-teams, long lists, CRLF, BOM, aliases and slash spacing", () =>
    {
        const block = "Charizard @ Leftovers\nTrait: Blaze\nEVs: 4 HP/252 Sp. Atk / 252 Speed\nIVs: 0 Attack / 30 Sp. Def\n- Flamethrower";
        const text = `\uFEFF=== [gen9ou] First ===\r\n\r\n${block.replace(/\n/g, "\r\n")}\r\n---\r\n${block.replace(/\n/g, "\r\n")}\r\n\r\n=== [gen9ubers] Second ===\r\n\r\n${Array(7).fill(block).join("\r\n\r\n")}`;
        const parsed = parseShowdownText(text);
        expect(countImportedSets(parsed)).toBe(9);
        expect(parsed.sets.map((entry) => entry.teamName)).toEqual([...Array(2).fill("First"), ...Array(7).fill("Second")]);
        const result = resolveImportedSet(CATALOG, parsed.sets[8]);
        expect(result.errors).toEqual([]);
        expect(result.fields.spDefIv).toBe(30);
        expect(result.fields.spdEv).toBe(252);
    });

    it("reports malformed numbers, repeated and unknown lines, missing records and too many moves", () =>
    {
        const parsed = parseShowdownText("Charizard\nEVs: 25x Atk / 510 Spe\nEVs: 4 HP\nLevel: NaN\nMystery: Yes\n- Protect\n- Fly\n- Air Slash\n- Flamethrower\n- Earthquake");
        expect(parsed.sets[0].errors.map((entry) => entry.message).join(" ")).toMatch(/Invalid EVs|Duplicate evs|Invalid level|at most 4/);
        expect(parsed.sets[0].warnings).toHaveLength(1);
        expect(resolveImportedSet(CATALOG, parsed.sets[0]).errors.length).toBeGreaterThan(0);
        expect(resolve("Unknownmon\n- Invisible Beam").errors.map((entry) => entry.field)).toContain("species");
        expect(resolve("Charizard").errors.map((entry) => entry.field)).toContain("moves");
        const exported = exportSpreads(CATALOG, [{ id: "bad", fields: createFields({ species: "SPECIES_UNKNOWN" }) }, { id: "other", fields: createFields() }]);
        expect(exported.errors[0]).toMatchObject({ index: 0, id: "bad" });
        expect(exported.text).toContain("Charizard @ Heavy-Duty Boots");
    });

    it("exports unlearnable moves and illegal numeric values without fixing or omitting them", () =>
    {
        const fields = createFields({ moves: ["MOVE_THUNDERBOLT", "MOVE_PROTECT", 0, 0], hpEv: 300, atkEv: 252, hpIv: 40 });
        const exported = exportSpread(CATALOG, fields, { level: 101 });
        expect(exported.errors).toEqual([]);
        expect(exported.text).toContain("- Thunderbolt");
        expect(exported.text).toContain("EVs: 300 HP / 252 Atk");
        expect(exported.text).toContain("IVs: 40 HP");
        expect(exported.text).toContain("Level: 101");
        const batch = exportSpreads(CATALOG, [{ fields }, { fields: createFields() }]);
        expect(batch.errors).toEqual([]);
        expect(batch.text.split("\n\n")).toHaveLength(2);
        expect(batch.text).toContain("- Thunderbolt");
    });

    it("exports empty and overfull move lists when their names are representable", () =>
    {
        const empty = exportSpread(CATALOG, createFields({ moves: [0, 0, 0, 0] }));
        expect(empty.errors).toEqual([]);
        expect(empty.text).toContain("Charizard @ Heavy-Duty Boots");
        const moves = ["MOVE_PROTECT", "MOVE_FLY", "MOVE_AIRSLASH", "MOVE_FLAMETHROWER", "MOVE_EARTHQUAKE"];
        const overfull = exportSpread(CATALOG, createFields({ moves }));
        expect(overfull.errors).toEqual([]);
        expect(overfull.text.match(/^- /gm)).toHaveLength(moves.length);
    });

    it("only skips entries whose names or numbers cannot be expressed", () =>
    {
        for (const overrides of [{ species: "SPECIES_UNKNOWN" }, { item: "ITEM_UNKNOWN" }, { hpIv: NaN }])
        {
            const result = exportSpread(CATALOG, createFields(overrides));
            expect(result.text).toBe("");
            expect(result.errors.length).toBeGreaterThan(0);
        }
        const unknownMove = exportSpread(CATALOG, createFields({ moves: ["MOVE_UNKNOWN", "MOVE_FLAMETHROWER", 0, 0] }));
        expect(unknownMove.errors).toEqual([]);
        expect(unknownMove.text).toContain("- Flamethrower");
        expect(unknownMove.warnings.map((warning) => warning.message)).toEqual(["Unknown move MOVE_UNKNOWN left out"]);
        const catalog = createCatalog();
        catalog.species.SPECIES_CHARIZARD.name = "";
        catalog.species.SPECIES_CHARIZARD.showdownName = "";
        expect(exportSpread(catalog, createFields()).errors[0].field).toBe("species");
    });

    it("rejects packed strings, JSON, oversized text and excessive sets", () =>
    {
        for (const text of ['[{"species":"Charizard"}]', "Charizard||Leftovers|Blaze|Flamethrower|||||||", "x".repeat(MAX_SHOWDOWN_LENGTH + 1), Array(MAX_SHOWDOWN_SETS + 1).fill("Charizard\n- Protect").join("\n\n")])
            expect(parseShowdownText(text).errors.length).toBeGreaterThan(0);
    });

    it("round trips all Hidden Power types and nonstandard same-type IV patterns", () =>
    {
        for (const type of HIDDEN_POWER_TYPES)
        {
            const optimized = optimizeHiddenPowerIvs(createFields(), type);
            const fields = createFields({ ...optimized, moves: ["MOVE_HIDDENPOWER", "MOVE_PROTECT", 0, 0] });
            const text = exportSpread(CATALOG, fields).text;
            expect(text).toMatch(/IVs: \d+ HP \/ \d+ Atk \/ \d+ Def \/ \d+ SpA \/ \d+ SpD \/ \d+ Spe/);
            const result = resolve(text);
            expect(result.ambiguities, type).toEqual([]);
            expect(result.fields.moves).toEqual(fields.moves);
            expect(getHiddenPowerType(result.fields)).toBe(type);
            expect(result.fields.atkIv).toBe(fields.atkIv);
            const alternate = createFields({ ...optimized, hpIv: optimized.hpIv === 31 ? 29 : 28, moves: fields.moves });
            const again = resolve(exportSpread(CATALOG, alternate).text);
            expect(again.fields.hpIv, type).toBe(alternate.hpIv);
        }
    });

    it("offers both resolutions for conflicting typed Hidden Power IVs", () =>
    {
        const text = "Charizard\nIVs: 0 Atk / 1 Spe\nHidden Power: Fire\n- Hidden Power [Ice]";
        const parsed = parseShowdownText(text).sets[0];
        const ambiguities = resolveImportedSet(CATALOG, parsed).ambiguities;
        expect(ambiguities.map((entry) => entry.message)).toEqual([
            "Hidden Power Dragon from IVs (requested Ice)", "Hidden Power types disagree",
        ]);
        expect(resolveImportedSet(CATALOG, parsed, { hiddenPower: "optimizeIvs" }).fields.moves[0]).toBe("MOVE_HIDDENPOWER");
        expect(resolve("Charizard\n- Hidden Power Ice").fields.moves[0]).toBe("MOVE_HIDDENPOWER");
    });

    it("exports base Charizard and its original ability with either Mega stone", () =>
    {
        for (const item of ["ITEM_CHARIZARDITE_X", "ITEM_CHARIZARDITE_Y"])
        {
            const text = exportSpread(CATALOG, createFields({ item })).text;
            expect(text).toMatch(/^Charizard @ Charizardite/);
            expect(text).toContain("Ability: Blaze");
            expect(resolve(text).fields.item).toBe(item);
        }
        const mega = resolve("Mega Charizard X @ Charizardite X\nAbility: Tough Claws\n- Flamethrower");
        expect(mega.fields.species).toBe("SPECIES_CHARIZARD");
        expect(mega.fields.item).toBe("ITEM_CHARIZARDITE_X");
        expect(mega.warnings.map((warning) => warning.message)).toContain("Mega Charizard X imported as Charizard (battle-only form)");
    });

    it.each(["X", "Y"])("accepts a reachable Mega Charizard %s ability on the base species and retains a valid base slot", (variant) =>
    {
        const ability = variant === "X" ? "Tough Claws" : "Drought";
        const text = `Charizard @ Charizardite ${variant}\nAbility: ${ability}\n- Flamethrower`;
        for (const existingAbility of [undefined, 0, 2])
        {
            const result = resolve(text, { existingFields: createFields({ ability: existingAbility }) });
            expect(result.errors).toEqual([]);
            expect(result.fields).toMatchObject({ species: "SPECIES_CHARIZARD", item: `ITEM_CHARIZARDITE_${variant}`, ability: existingAbility === 0 ? 0 : 1 });
            expect(result.warnings.filter((warning) => warning.field === "ability")).toEqual([]);
        }
    });

    it.each(
    [
        { item: "Charizardite X", ability: "Sand Veil" },
        { item: "Charizardite Y", ability: "Tough Claws" },
        { item: "Leftovers", ability: "Tough Claws" },
    ])("warns for unavailable $ability with $item", ({ item, ability }) =>
    {
        const result = resolve(`Charizard @ ${item}\nAbility: ${ability}\n- Flamethrower`);
        expect(result.errors).toEqual([]);
        expect(result.fields.ability).toBe(1);
        expect(result.warnings.filter((warning) => warning.field === "ability")).toEqual([{ field: "ability", message: `${ability} not available (using Blaze)` }]);
    });

    it("accepts a move-triggered Mega ability only when its resolved move is present", () =>
    {
        const catalog = createCatalog();
        catalog.species.SPECIES_RAYQUAZA = { ...catalog.species.SPECIES_CHARIZARD, name: "Rayquaza", showdownName: "Rayquaza", megas: [{ species: "SPECIES_RAYQUAZA_MEGA", move: "MOVE_DRAGONASCENT" }] };
        catalog.species.SPECIES_RAYQUAZA_MEGA = { ...catalog.species.SPECIES_CHARIZARD_MEGA_X, name: "Mega Rayquaza", abilities: [null, "ABILITY_DELTASTREAM", null] };
        catalog.abilities.ABILITY_DELTASTREAM = "Delta Stream";
        catalog.moves.MOVE_DRAGONASCENT = { name: "Dragon Ascent" };
        const text = "Rayquaza\nAbility: Delta Stream\n- Dragon Ascent";
        const result = resolve(text, {}, catalog);
        expect(result.errors).toEqual([]);
        expect(result.fields.moves).toEqual(["MOVE_DRAGONASCENT", 0, 0, 0]);
        expect(result.warnings.filter((warning) => warning.field === "ability")).toEqual([]);
        expect(resolve("Rayquaza\nAbility: Delta Stream\n- Protect", {}, catalog).warnings.some((warning) => warning.field === "ability")).toBe(true);
        delete catalog.moves.MOVE_DRAGONASCENT;
        expect(resolve(`${text}\n- Protect`, {}, catalog).warnings.some((warning) => warning.field === "ability")).toBe(true);
    });

    it("imports Mega, Gigantamax and other battle-only forms as their base form", () =>
    {
        const catalog = createCatalog();
        catalog.species.SPECIES_CHARIZARD_GIGA = { ...catalog.species.SPECIES_CHARIZARD, name: "Gigantamax Charizard", showdownName: "Charizard-Gmax", megas: [], gigantamax: null };
        catalog.species.SPECIES_AEGISLASH = { ...catalog.species.SPECIES_GARCHOMP, name: "Aegislash", showdownName: "Aegislash" };
        catalog.species.SPECIES_AEGISLASH_BLADE = { ...catalog.species.SPECIES_GARCHOMP, name: "Aegislash Blade", showdownName: "Aegislash-Blade" };
        const megaY = resolve("Charizard-Mega-Y\n- Flamethrower", {}, { ...catalog, species: { ...catalog.species, SPECIES_CHARIZARD_MEGA_Y: { ...catalog.species.SPECIES_CHARIZARD_MEGA_Y, showdownName: "Charizard-Mega-Y" } } });
        expect(megaY.fields).toMatchObject({ species: "SPECIES_CHARIZARD", item: "ITEM_CHARIZARDITE_Y" });
        expect(resolve("Charizard-Gmax\n- Flamethrower", {}, catalog).fields).toMatchObject({ species: "SPECIES_CHARIZARD", gigantamax: true });
        expect(resolve("Aegislash-Blade\n- Earthquake", {}, catalog).fields.species).toBe("SPECIES_AEGISLASH");
        expect(isBattleOnlySpecies(catalog, "SPECIES_CHARIZARD_MEGA_X")).toBe(true);
        expect(isBattleOnlySpecies(catalog, "SPECIES_CHARIZARD_GIGA")).toBe(true);
        expect(isBattleOnlySpecies(catalog, "SPECIES_AEGISLASH_BLADE")).toBe(true);
        expect(isBattleOnlySpecies(catalog, "SPECIES_CHARIZARD")).toBe(false);
        expect(getOutOfBattleForm(catalog, "SPECIES_VENUSAUR_MEGA")).toEqual({ species: "SPECIES_VENUSAUR", item: "ITEM_VENUSAURITE", gigantamax: false });
    });

    it("uses compact battle-only, ability and move warnings", () =>
    {
        const catalog = createCatalog();
        catalog.species.SPECIES_VENUSAUR_MEGA.showdownName = "Venusaur-Mega";
        catalog.moves.MOVE_SLUDGEWAVE = { name: "Sludge Wave" };
        const result = resolve("Venusaur-Mega\nAbility: Sand Veil\n- Sludge Wave", {}, catalog);
        expect(result.errors).toEqual([]);
        expect(result.fields.species).toBe("SPECIES_VENUSAUR");
        expect(result.warnings.map((warning) => warning.message)).toEqual([
            "Venusaur-Mega imported as Venusaur (battle-only form)",
            "Sand Veil not available (using Overgrow)",
            "Sludge Wave not learnable",
        ]);
        catalog.species.SPECIES_VENUSAUR.name = "Base Venusaur";
        const renamed = resolve("Venusaur-Mega\nAbility: Sand Veil\n- Sludge Wave", {}, catalog);
        expect(renamed.warnings.map((warning) => warning.message)).toEqual([
            "Venusaur-Mega imported as Base Venusaur (battle-only form)",
            "Sand Veil not available (using Overgrow)",
            "Sludge Wave not learnable",
        ]);
    });

    it("imports a base form whose Mega shares its name without a battle-only warning, leaving out unknown moves", () =>
    {
        const catalog = createCatalog();
        catalog.species.SPECIES_VENUSAUR_MEGA = { ...catalog.species.SPECIES_VENUSAUR_MEGA, name: "Venusaur" };
        const base = resolve("Venusaur\n- Protect\n- Ice Spinner", {}, catalog);
        expect(base.errors).toEqual([]);
        expect(base.fields.species).toBe("SPECIES_VENUSAUR");
        expect(base.fields.moves).toEqual(["MOVE_PROTECT", 0, 0, 0]);
        expect(base.warnings.map((warning) => warning.message)).toEqual(["Ice Spinner not in this game (left out)"]);
        expect(resolve("Venusaur\n- Ice Spinner", {}, catalog).errors.map((entry) => entry.message)).toContain("No moves in this game");
    });

    it("prefers the form whose Showdown name matches when regional forms share a display name", () =>
    {
        const catalog = createCatalog();
        catalog.species.SPECIES_PICHU_A = { ...catalog.species.SPECIES_PICHU, name: "Pichu", showdownName: "Pichu-Alola" };
        const base = resolve("Pichu\n- Protect", {}, catalog);
        expect(base.fields.species).toBe("SPECIES_PICHU");
        expect(base.ambiguities).toEqual([]);
        expect(resolve("Pichu-Alola\n- Protect", {}, catalog).fields.species).toBe("SPECIES_PICHU_A");
    });

    it("handles alternate names, duplicate ability slots, unsupported details and levels", () =>
    {
        const catalog = createCatalog();
        catalog.species.SPECIES_LILLIGANT_HISUI = { ...catalog.species.SPECIES_PICHU, name: "Hisuian Lilligant", showdownName: "Lilligant-Hisui", abilities: [null, "ABILITY_BLAZE", "ABILITY_BLAZE"] };
        const text = "Lilligant-Hisui (F) @ Leftovers\nAbility: Blaze\nLevel: 5\nHappiness: 0\nDynamax Level: 10\nTera Type: Fire\n- Return";
        catalog.moves.MOVE_RETURN = { name: "Return" };
        const parsed = parseShowdownText(text).sets[0];
        const unresolved = resolveImportedSet(catalog, parsed, { expectedLevel: 50 });
        expect(unresolved.fields.species).toBe("SPECIES_LILLIGANT_HISUI");
        expect(unresolved.ambiguities).toEqual([]);
        expect(unresolved.fields.ability).toBe(1);
        expect(unresolved.unsupported.map((entry) => entry.field)).not.toContain("gender");
        expect(unresolved.unsupported.map((entry) => entry.field)).toContain("tera type");
        expect(unresolved.warnings.some((entry) => entry.field === "happiness")).toBe(true);
        expect(unresolved.warnings.some((entry) => entry.field === "level")).toBe(true);
        expect(resolveImportedSet(catalog, parsed, { abilitySlot: 2 }).fields.ability).toBe(2);
        expect(resolveImportedSet(catalog, parsed, { existingFields: createFields({ ability: 2 }) }).fields.ability).toBe(2);
    });

    it("keeps missing defaults, random ball and preview levels distinct", () =>
    {
        const result = resolve("Charizard\n- Protect");
        expect(result.fields).toMatchObject({ item: "ITEM_NONE", ball: "BALL_TYPE_RANDOM", nature: "NATURE_HARDY", hpIv: 31, spdIv: 31, spdEv: 0, shiny: false });
        for (const level of [5, 50, 100])
            expect(exportSpread(CATALOG, createFields(), { level }).text.includes("Level:")).toBe(level !== 100);
        expect(exportSpread(CATALOG, createFields()).text).not.toContain("Pokeball:");
    });

    it("marks zeroed source placeholders separately from incomplete active spreads", () =>
    {
        const fields = createFields(
        {
            nature: 0, item: 0, ball: 0, ability: 0, specificTeamType: 0,
            hpIv: 0, atkIv: 0, defIv: 0, spAtkIv: 0, spDefIv: 0, spdIv: 0,
            moves: [0, "MOVE_NONE", 0, 0], forSingles: false, forDoubles: false, modifyMovesDoubles: false,
        });
        const placeholder = exportSpread(CATALOG, fields);
        expect(placeholder.text).toBe("");
        expect(placeholder.errors).toEqual([{ field: "text", message: "Placeholder not exported", code: SHOWDOWN_PLACEHOLDER_ERROR }]);
        for (const overrides of [{ forSingles: true }, { hpIv: 31 }, { hpEv: 4 }, { item: "ITEM_LEFTOVERS" }])
            expect(exportSpread(CATALOG, { ...fields, ...overrides }).errors.some((error) => error.code === SHOWDOWN_PLACEHOLDER_ERROR)).toBe(false);
    });

    it("preserves battle flags and omitted ball while clearing team type on overwrite", () =>
    {
        const current = createFields({ ability: 1, specificTeamType: 1, forSingles: false, forDoubles: true, modifyMovesDoubles: false, ball: "BALL_TYPE_POKE_BALL" });
        const incoming = resolve("Charizard\nAbility: Blaze\n- Protect").fields;
        const result = applyOverwrite(CATALOG, current, incoming, { teamTypes: TEAM_TYPES });
        expect(result.fields).toMatchObject({ ball: "BALL_TYPE_POKE_BALL", ability: 1, specificTeamType: "DOUBLES_ANY_TEAM", forSingles: false, forDoubles: true, modifyMovesDoubles: false });
        expect(result.differences.some((entry) => entry.field === "specificTeamType")).toBe(true);
        expect(applyOverwrite(CATALOG, current, incoming, { teamTypes: TEAM_TYPES, saved: createFields({ specificTeamType: 0 }) }).fields.specificTeamType).toBe(0);
    });

    it("parses the real Raid Rush text without discarding later sets", () =>
    {
        const text = readFileSync("Raid Rush.txt", "utf8");
        const parsed = parseShowdownText(text);
        expect(parsed.errors).toEqual([]);
        expect(parsed.sets.length).toBeGreaterThan(6);
        expect(parsed.sets.at(-1).set.species).toBeTruthy();
    });
});
