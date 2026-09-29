/**
 * Test file for data-parser.js, learnsets.js, assets.js, pokeapi.js and shared/catalog.mjs
 * Tests reading move details and learnset sources, deciding move availability, battle forms,
 * image URLs, the PokeAPI index and legality lookups.
 */

const { expect } = require("chai");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { BATTLE_MOVES, CLOUD_FILES, DPE_FILES, DPE_SPRITE_FILES, ITEM_TABLES, NORMAL_PALETTE, SHINY_PALETTE, createIndexedPng, createPokeApiFetch } = require("../helpers/catalog-fixtures");
const { CFRU_SOURCE_FILES } = require("../helpers/spread-fixtures");
const { getBallIcon, getItemIcon, getSpeciesIcon, getSpeciesSprites, getTypeIcon, getTypeSymbol } = require("../../services/assets");
const
{
    parseBattleMoves, parseCompatibilityFile, parseEggMoves, parseEvolutionTable, parseItemTypes, parseLevelUpLearnsets, parseSpriteTable, parseTeachableTables,
    parseTeamTypes,
} = require("../../services/data-parser");
const { buildBattleForms, buildLearnsets, parseDpeSources } = require("../../services/learnsets");
const { createPokeApiIndex } = require("../../services/pokeapi");
const { evaluatePreprocessor } = require("../../services/preprocessor");
const { combineSpritePalette, parseSpriteSources } = require("../../services/sprites");
const { LEGALITY, POWER_KIND, alwaysHits, getMegaEvolutions, getMoveLegality, getPowerKind } = require("../../../shared/catalog.mjs");

const TM_DIRECTORY = "src/tm_compatibility";
const TUTOR_DIRECTORY = "src/tutor_compatibility";
const CFRU_MACROS = evaluatePreprocessor(CFRU_SOURCE_FILES["src/config.h"]).macros;
const DPE_MACROS = evaluatePreprocessor(DPE_FILES["src/defines.h"]).macros;
const GAME_SPECIES = JSON.parse(CLOUD_FILES["src/data/cfru/BaseStats.json"]);
const SPECIES_DEX = JSON.parse(CLOUD_FILES["src/data/SpeciesToDexNum.json"]);
const GAME_MOVES = Object.keys(JSON.parse(CLOUD_FILES["src/data/cfru/Moves.json"])).filter((move) => move !== "MOVE_NONE" && move !== "MOVE_REMOVED");
const DAY_MS = 24 * 60 * 60 * 1000;
const CLOUD_IMAGES = "/api/images/workspace-1/";
const EMPTY_IMAGES = { baseUrl: CLOUD_IMAGES, root: new Set(), items: new Set(), gen9: new Set(), gen9Shiny: new Set(), unboundShinies: new Set() };
const POKEAPI_SPRITES = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/";


/**
 * Returns the DPE sources as the loader passes them to the parser.
 *
 * @returns {object} The sources.
 */
function getDpeSources()
{
    const compatibility = { [TM_DIRECTORY]: [], [TUTOR_DIRECTORY]: [] };
    for (const [file, text] of Object.entries(DPE_FILES))
    {
        const directory = path.posix.dirname(file);
        if (Object.hasOwn(compatibility, directory) && file.endsWith(".txt"))
            compatibility[directory].push({ name: path.posix.basename(file), text });
    }

    return { configText: DPE_FILES["src/defines.h"], files: DPE_FILES, compatibility };
}

/**
 * Returns the game species' types and Pokedex constants.
 *
 * @returns {Object<string, {types: Array<string>, dex: string|null}>} The species.
 */
function getSpeciesInfo()
{
    return Object.fromEntries(Object.entries(GAME_SPECIES).filter(([species]) => species !== "SPECIES_NONE")
        .map(([species, entry]) => [species, { types: [entry.type1, entry.type2], dex: SPECIES_DEX[species] ?? null }]));
}

/**
 * Builds the fixture learnsets.
 *
 * @param {Map<string, object>} [cfruMacros] The CFRU configuration.
 * @returns {{learnsets: object, diagnostics: Array<object>}} The learnsets.
 */
function buildFixtureLearnsets(cfruMacros = CFRU_MACROS)
{
    return buildLearnsets({ dpe: parseDpeSources(getDpeSources()), species: getSpeciesInfo(), moveNames: { MOVE_MEGAPUNCH: "Mega Punch" }, gameMoves: GAME_MOVES, cfruMacros });
}

describe("Game data parser", () =>
{
    it("should read move details from the compiled branch, keeping unreadable values unknown", () =>
    {
        const { moves, diagnostics } = parseBattleMoves(BATTLE_MOVES, CFRU_MACROS);
        expect(moves.MOVE_POUND).to.deep.equal(
        {
            power: 40, accuracy: 100, pp: 35, priority: 0, secondaryEffectChance: 0, zMovePower: 100, maxMovePower: 90,
            effect: "EFFECT_HIT", type: "TYPE_NORMAL", target: "MOVE_TARGET_SELECTED", split: "SPLIT_PHYSICAL",
            flags: ["FLAG_MAKES_CONTACT", "FLAG_PROTECT_AFFECTED", "FLAG_MIRROR_MOVE_AFFECTED"],
        });
        expect(moves.MOVE_FLY.power).to.equal(100);
        expect(moves.MOVE_FLY.flags).to.deep.equal([]);
        expect(moves.MOVE_FLY.secondaryEffectChance).to.equal(null);
        expect(moves.MOVE_FLY).to.include({ zMovePower: null, maxMovePower: 0 });
        expect(moves.MOVE_VITALTHROW).to.include({ priority: -1, effect: 0, accuracy: 0 });
        expect(moves.MOVE_WEIRD).to.include({ power: null, flags: null, type: "TYPE_NORMAL" });
        expect(diagnostics.map((diagnostic) => diagnostic.code)).to.deep.equal(["MOVE_DATA_UNREADABLE"]);

        // Another configuration compiles the other branch, and other tables are not moves
        expect(parseBattleMoves(BATTLE_MOVES, new Map()).moves.MOVE_FLY.power).to.equal(90);
        expect(Object.keys(moves)).to.not.include("gDynamaxMovePowers");
    });

    it("should report a missing move table", () =>
    {
        const { moves, diagnostics } = parseBattleMoves("const u8 gOther[] = {1};\n", CFRU_MACROS);
        expect(moves).to.equal(null);
        expect(diagnostics[0].code).to.equal("DATA_TABLE_NOT_FOUND");
    });

    it("should leave Max Move powers unknown when Dynamax is not compiled", () =>
    {
        const withoutDynamax = BATTLE_MOVES.slice(0, BATTLE_MOVES.indexOf("const u8 gDynamaxMovePowers"));
        expect(parseBattleMoves(withoutDynamax, CFRU_MACROS).moves.MOVE_POUND).to.include({ zMovePower: 100, maxMovePower: null });
    });

    it("should read shared level-up learnsets, skipping padding entries and reporting unreadable ones", () =>
    {
        const { learnsets, diagnostics } = parseLevelUpLearnsets(DPE_FILES["src/Learnsets.c"], DPE_MACROS);
        expect(learnsets.SPECIES_VENUSAUR).to.deep.equal(
        [
            { move: "MOVE_PETALBLIZZARD", level: 0 },
            { move: "MOVE_GIGADRAIN", level: 1 },
            { move: "MOVE_SYNTHESIS", level: 40 },
        ]);
        expect(learnsets.SPECIES_KYUREM_BLACK).to.deep.equal(learnsets.SPECIES_KYUREM);
        expect(learnsets.SPECIES_NONE).to.deep.equal([]);
        expect(Object.keys(learnsets)).to.not.include("254");
        expect(diagnostics.map((diagnostic) => diagnostic.code)).to.have.members(["LEARNSET_NOT_FOUND", "LEARNSET_UNREADABLE"]);
    });

    it("should not read learnsets DPE's configuration leaves out", () =>
    {
        const { learnsets, diagnostics } = parseLevelUpLearnsets(DPE_FILES["src/Learnsets.c"], new Map());
        expect(learnsets).to.equal(null);
        expect(diagnostics[0].code).to.equal("DATA_TABLE_NOT_FOUND");
    });

    it("should read egg moves and the TM and tutor tables", () =>
    {
        expect(parseEggMoves(DPE_FILES["src/Egg_Moves.c"], DPE_MACROS)).to.deep.equal({ eggMoves: { SPECIES_BULBASAUR: ["MOVE_SKULLBASH", "MOVE_CHARM"] }, diagnostics: [] });
        expect(parseTeachableTables(DPE_FILES["src/TM_Tutor_Tables.c"], DPE_MACROS)).to.deep.equal(
        {
            tmMoves: ["MOVE_FOCUSPUNCH", "MOVE_HIDDENPOWER", "MOVE_CUT"],
            tutorMoves: ["MOVE_MEGAPUNCH", "MOVE_SWORDSDANCE"],
            diagnostics: [],
        });
    });

    it("should read compatibility files with a byte order mark, typos in the heading and unreadable lines", () =>
    {
        expect(parseCompatibilityFile("2 - Hidden Power.txt", DPE_FILES[`${TM_DIRECTORY}/2 - Hidden Power.txt`])).to.deep.equal(
            { number: 2, moveName: "Hidden Power", species: ["SPECIES_BULBASAUR", "SPECIES_VENUSAUR"], diagnostics: [] });
        expect(parseCompatibilityFile("3 - Cut.txt", "3HM01: Cut\nIVYSAUR\n")).to.include({ number: 3, moveName: "Cut" });

        const unreadable = parseCompatibilityFile("Notes.txt", "Just some notes\nnot a species!\n");
        expect(unreadable).to.include({ number: null, moveName: null });
        expect(unreadable.diagnostics.map((diagnostic) => diagnostic.code)).to.deep.equal(
            ["COMPATIBILITY_FILE_UNREADABLE", "COMPATIBILITY_FILE_UNREADABLE", "COMPATIBILITY_SPECIES_UNREADABLE"]);
    });

    it("should read evolutions, including GCC's designator without an equals sign", () =>
    {
        const { evolutions, diagnostics } = parseEvolutionTable(DPE_FILES["src/Evolution Table.c"], DPE_MACROS);
        expect(evolutions.SPECIES_PICHU).to.deep.equal([{ method: "EVO_LEVEL_SPECIFIC_TIME_RANGE", parameter: "TIME_RANGE(1, 2)", target: "SPECIES_PIKACHU", variant: 0 }]);
        expect(evolutions.SPECIES_CHARIZARD.map((evolution) => evolution.target)).to.deep.equal(["SPECIES_CHARIZARD_MEGA_X", "SPECIES_CHARIZARD_MEGA_Y", "SPECIES_CHARIZARD_GIGA"]);
        expect(evolutions.SPECIES_BULBASAUR[0]).to.deep.equal({ method: "EVO_LEVEL", parameter: 16, target: "SPECIES_IVYSAUR", variant: 0 });
        expect(diagnostics.map((diagnostic) => diagnostic.code)).to.deep.equal(["EVOLUTION_UNREADABLE"]);
    });

    it("should read the doubles team types from the compiled branch", () =>
    {
        const header = CFRU_SOURCE_FILES["include/new/frontier.h"];
        expect(parseTeamTypes(header, CFRU_MACROS)).to.deep.equal(
        {
            teamTypes:
            [
                { name: "DOUBLES_ANY_TEAM", value: 0 },
                { name: "DOUBLES_SUN_TEAM", value: 1 },
                { name: "DOUBLES_TRICK_ROOM_TEAM", value: 7 },
                { name: "DOUBLES_TAILWIND_TEAM", value: 8 },
            ],
            diagnostics: [],
        });
        expect(parseTeamTypes(header, new Map()).teamTypes.map((teamType) => teamType.name)).to.include("DOUBLES_VANILLA_TEAM");
    });

    it("should report missing doubles team types", () =>
    {
        const { teamTypes, diagnostics } = parseTeamTypes("enum { CURR_STREAK };\n", CFRU_MACROS);
        expect(teamTypes).to.equal(null);
        expect(diagnostics[0].code).to.equal("TEAM_TYPES_NOT_FOUND");
    });

    it("should read item kinds, reporting values that are not constants", () =>
    {
        const { itemTypes, diagnostics } = parseItemTypes(ITEM_TABLES, CFRU_MACROS);
        expect(itemTypes).to.deep.equal({ ITEM_LEFTOVERS: "ITEM_TYPE_HELD_ITEM", ITEM_VENUSAURITE: "ITEM_TYPE_MEGA_STONE", ITEM_NORMALIUM_Z: "ITEM_TYPE_Z_CRYSTAL" });
        expect(diagnostics.map((diagnostic) => diagnostic.code)).to.deep.equal(["ITEM_TYPE_UNREADABLE"]);
        expect(parseItemTypes("const u8 gOther[] = {1};\n", CFRU_MACROS)).to.deep.include({ itemTypes: null });
    });
});

describe("Learnsets", () =>
{
    it("should combine level-up, evolution, egg, TM and tutor moves", () =>
    {
        const { learnsets } = buildFixtureLearnsets();
        expect(learnsets.SPECIES_BULBASAUR).to.deep.equal(
        {
            status: "complete",
            moves: { MOVE_TACKLE: ["level"], MOVE_LEECHSEED: ["level"], MOVE_SKULLBASH: ["egg"], MOVE_CHARM: ["egg"], MOVE_HIDDENPOWER: ["tm"] },
            unknown: {},
        });
        expect(learnsets.SPECIES_VENUSAUR.moves).to.deep.include({ MOVE_PETALBLIZZARD: ["evolution"], MOVE_GIGADRAIN: ["level"], MOVE_HIDDENPOWER: ["tm"] });
        expect(learnsets.SPECIES_CHARIZARD.moves).to.deep.include({ MOVE_FOCUSPUNCH: ["tm"], MOVE_MEGAPUNCH: ["tutor"] });
    });

    it("should use a TM file's number for the move, even when its heading names an HM", () =>
    {
        const { learnsets } = buildFixtureLearnsets();
        expect(learnsets.SPECIES_IVYSAUR.moves.MOVE_CUT).to.deep.equal(["tm"]);
    });

    it("should pass pre-evolution moves down every evolution but not to Mega Evolutions", () =>
    {
        const { learnsets } = buildFixtureLearnsets();
        expect(learnsets.SPECIES_IVYSAUR.moves).to.deep.include({ MOVE_LEECHSEED: ["prevolution"], MOVE_SKULLBASH: ["prevolution"] });
        expect(learnsets.SPECIES_VENUSAUR.moves).to.deep.include({ MOVE_CHARM: ["prevolution"], MOVE_CUT: ["prevolution"], MOVE_TACKLE: ["prevolution"] });
        expect(learnsets.SPECIES_VENUSAUR_MEGA).to.deep.equal({ status: "complete", moves: {}, unknown: {} });
    });

    it("should share moves between forms and keep form change moves with their form", () =>
    {
        const { learnsets } = buildFixtureLearnsets();

        // Pichu's Light Ball Volt Tackle reaches Pikachu and every Pikachu form
        expect(learnsets.SPECIES_PICHU.moves.MOVE_VOLTTACKLE).to.deep.equal(["special"]);
        expect(learnsets.SPECIES_PIKACHU.moves.MOVE_VOLTTACKLE).to.deep.equal(["prevolution"]);
        expect(learnsets.SPECIES_PIKACHU_SURFING.moves.MOVE_VOLTTACKLE).to.deep.equal(["form"]);

        // Fusing keeps Kyurem's moves, but Glaciate is replaced by Fusion Bolt
        expect(learnsets.SPECIES_KYUREM.moves).to.deep.include({ MOVE_GLACIATE: ["formChange"], MOVE_SWORDSDANCE: ["tutor"] });
        expect(learnsets.SPECIES_KYUREM_BLACK.moves).to.deep.include({ MOVE_FUSIONBOLT: ["formChange"], MOVE_SWORDSDANCE: ["form"] });
        expect(learnsets.SPECIES_KYUREM_BLACK.moves).to.not.have.property("MOVE_GLACIATE");
    });

    it("should let a Sketch user learn every game move except those Sketch cannot copy", () =>
    {
        const { learnsets } = buildFixtureLearnsets();
        const moves = learnsets.SPECIES_SMEARGLE.moves;
        expect(moves.MOVE_SKETCH).to.deep.equal(["level"]);
        expect(moves.MOVE_EARTHQUAKE).to.deep.equal(["sketch"]);
        expect(moves).to.not.have.any.keys("MOVE_STRUGGLE", "MOVE_CHATTER");
    });

    it("should leave special tutor moves unknown unless CFRU enables its special tutors", () =>
    {
        const disabled = buildFixtureLearnsets().learnsets;
        expect(disabled.SPECIES_DRAGONITE.unknown).to.have.all.keys("MOVE_DRACOMETEOR");
        expect(disabled.SPECIES_DRAGONITE.moves).to.not.have.property("MOVE_DRACOMETEOR");
        expect(disabled.SPECIES_BULBASAUR.unknown).to.deep.equal({});

        const enabled = buildFixtureLearnsets(new Map([...CFRU_MACROS, ["EXPANDED_MOVE_TUTORS", { body: "", functionLike: false }]])).learnsets;
        expect(enabled.SPECIES_DRAGONITE.moves.MOVE_DRACOMETEOR).to.deep.equal(["special"]);
        expect(enabled.SPECIES_DRAGONITE.unknown).to.deep.equal({});
    });

    it("should apply configuration-specific special tutors only when their macro is defined", () =>
    {
        const species = { SPECIES_SHINX: { types: ["TYPE_ELECTRIC", "TYPE_ELECTRIC"], dex: "NATIONAL_DEX_SHINX" } };
        const dpe = { levelUp: { SPECIES_SHINX: [] }, tmCompatibility: [], tutorCompatibility: [] };
        const tutors = ["EXPANDED_MOVE_TUTORS", { body: "", functionLike: false }];
        const unbound = ["UNBOUND", { body: "", functionLike: false }];

        const withUnbound = buildLearnsets({ dpe, species, moveNames: {}, gameMoves: [], cfruMacros: new Map([tutors, unbound]) });
        expect(withUnbound.learnsets.SPECIES_SHINX.moves.MOVE_VOLTTACKLE).to.deep.equal(["special"]);

        const withoutUnbound = buildLearnsets({ dpe, species, moveNames: {}, gameMoves: [], cfruMacros: new Map([tutors]) });
        expect(withoutUnbound.learnsets.SPECIES_SHINX.moves).to.deep.equal({});
    });

    it("should mark species without a level-up learnset as missing", () =>
    {
        const { learnsets, diagnostics } = buildFixtureLearnsets();
        expect(learnsets.SPECIES_GARCHOMP.status).to.equal("missing");
        expect(learnsets.SPECIES_CHARIZARD_MEGA_X.status).to.equal("missing");
        expect(diagnostics.find((diagnostic) => diagnostic.code === "LEARNSET_MISSING").message).to.include("SPECIES_CHARIZARD_MEGA_X");
        expect(diagnostics.find((diagnostic) => diagnostic.code === "LEARNSET_MISSING").details).to.include("SPECIES_CHARIZARD_MEGA_X");
    });

    it("should report TM and tutor files that do not match DPE's tables", () =>
    {
        const { diagnostics } = buildFixtureLearnsets();
        const codes = diagnostics.map((diagnostic) => diagnostic.code);
        expect(codes).to.include.members(["COMPATIBILITY_MOVE_MISMATCH", "COMPATIBILITY_MOVE_UNKNOWN", "COMPATIBILITY_SPECIES_UNKNOWN"]);
        expect(diagnostics.find((diagnostic) => diagnostic.code === "COMPATIBILITY_SPECIES_UNKNOWN").message).to.include("SPECIES_MISSINGNO");
        expect(diagnostics.find((diagnostic) => diagnostic.code === "COMPATIBILITY_SPECIES_UNKNOWN").details).to.include("SPECIES_MISSINGNO");

        // Headings are compared ignoring accents and punctuation, and against Cloud's move names
        expect(diagnostics.filter((diagnostic) => diagnostic.code === "COMPATIBILITY_MOVE_MISMATCH")).to.have.length(1);
    });

    it("should mark every learnset missing when DPE's learnsets are not compiled", () =>
    {
        const sources = getDpeSources();
        const dpe = parseDpeSources({ ...sources, configText: "#pragma once\n" });
        expect(dpe.diagnostics.map((diagnostic) => diagnostic.code)).to.include("DPE_LEARNSETS_DISABLED");

        const { learnsets, diagnostics } = buildLearnsets({ dpe, species: getSpeciesInfo(), moveNames: {}, gameMoves: GAME_MOVES, cfruMacros: CFRU_MACROS });
        expect(Object.values(learnsets).every((learnset) => learnset.status === "missing")).to.equal(true);
        expect(learnsets.SPECIES_CHARIZARD.moves.MOVE_FOCUSPUNCH).to.deep.equal(["tm"]);
        expect(diagnostics.map((diagnostic) => diagnostic.code)).to.not.include("LEARNSET_MISSING");
    });

    it("should finish when evolutions form a cycle", () =>
    {
        const dpe =
        {
            levelUp: { SPECIES_A: [{ move: "MOVE_X", level: 1 }], SPECIES_B: [{ move: "MOVE_Y", level: 1 }] },
            evolutions: { SPECIES_A: [{ method: "EVO_LEVEL", target: "SPECIES_B" }], SPECIES_B: [{ method: "EVO_ITEM", target: "SPECIES_A" }] },
            tmCompatibility: [],
            tutorCompatibility: [],
        };
        const species = { SPECIES_A: { types: [], dex: null }, SPECIES_B: { types: [], dex: null } };

        const { learnsets } = buildLearnsets({ dpe, species, moveNames: {}, gameMoves: [], cfruMacros: new Map() });
        expect(learnsets.SPECIES_A.moves).to.deep.equal({ MOVE_X: ["level"], MOVE_Y: ["prevolution"] });
        expect(learnsets.SPECIES_B.moves).to.deep.equal({ MOVE_Y: ["level"], MOVE_X: ["prevolution"] });
    });
});

describe("Battle forms", () =>
{
    it("should read Mega Stones, move triggers and Gigantamax forms, ignoring reversions", () =>
    {
        const { evolutions } = parseEvolutionTable(DPE_FILES["src/Evolution Table.c"], DPE_MACROS);
        const { forms, diagnostics } = buildBattleForms(evolutions, new Set([...Object.keys(GAME_SPECIES), "SPECIES_RAYQUAZA", "SPECIES_RAYQUAZA_MEGA"]));

        expect(forms.SPECIES_CHARIZARD).to.deep.equal(
        {
            megas:
            [
                { species: "SPECIES_CHARIZARD_MEGA_X", item: "ITEM_CHARIZARDITE_X", variant: "MEGA_VARIANT_STANDARD", available: true },
                { species: "SPECIES_CHARIZARD_MEGA_Y", item: "ITEM_CHARIZARDITE_Y", variant: "MEGA_VARIANT_STANDARD", available: false },
            ],
            gigantamax: { species: "SPECIES_CHARIZARD_GIGA", available: true },
        });
        expect(forms.SPECIES_RAYQUAZA.megas).to.deep.equal([{ species: "SPECIES_RAYQUAZA_MEGA", move: "MOVE_DRAGONASCENT", variant: "MEGA_VARIANT_WISH", available: true }]);
        expect(forms.SPECIES_VENUSAUR_MEGA).to.deep.equal({ megas: [], gigantamax: null });
        expect(diagnostics.map((diagnostic) => diagnostic.code)).to.deep.equal(["BATTLE_FORM_UNAVAILABLE"]);
        expect(diagnostics[0].message).to.include("SPECIES_CHARIZARD_MEGA_Y");
    });
});

describe("Image URLs", () =>
{
    const index = { pokemon: { charizard: 6, "charizard-gmax": 10196, "lycanroc-midnight": 10126, "lycanroc-midday": 745 }, types: { fire: 10 } };
    const sprites = (species, info, images = EMPTY_IMAGES) => getSpeciesSprites(species, { dex: null, dexNumber: null, iconName: undefined, customShiny: false, ...info }, { index, images });

    it("should use PokeAPI's IDs rather than game or Pokedex numbers for forms", () =>
    {
        expect(sprites("SPECIES_CHARIZARD_GIGA", { dex: "NATIONAL_DEX_CHARIZARD", dexNumber: 6 })).to.deep.equal(
        {
            normal: `${POKEAPI_SPRITES}10196.png`,
            shiny: `${POKEAPI_SPRITES}shiny/10196.png`,
            fallback: null,
            source: "pokeapi",
            exact: true,
        });
        expect(sprites("SPECIES_LYCANROC_N", { dex: "NATIONAL_DEX_LYCANROC", dexNumber: 745, iconName: "lycanroc-midnight" }).normal).to.equal(`${POKEAPI_SPRITES}10126.png`);
    });

    it("should use the Pokedex number for default forms PokeAPI names with a suffix, including female sprites", () =>
    {
        expect(sprites("SPECIES_LYCANROC", { dex: "NATIONAL_DEX_LYCANROC", dexNumber: 745 })).to.include({ normal: `${POKEAPI_SPRITES}745.png`, source: "pokeapi", exact: true });
        expect(sprites("SPECIES_PYROAR_FEMALE", { dex: "NATIONAL_DEX_PYROAR", dexNumber: 668, iconName: "female/pyroar" })).to.include(
            { normal: `${POKEAPI_SPRITES}female/668.png`, shiny: `${POKEAPI_SPRITES}shiny/female/668.png` });
    });

    it("should use Cloud's icon rule for forms PokeAPI does not have, falling back to the base form", () =>
    {
        const unown = sprites("SPECIES_UNOWN_B", { dex: "NATIONAL_DEX_UNOWN", dexNumber: 201 });
        expect(unown.normal).to.equal("https://raw.githubusercontent.com/msikma/pokesprite/master/pokemon-gen8/regular/unown-b.png");
        expect(unown.source).to.equal("pokesprite");
        expect(unown.fallback).to.deep.equal({ normal: `${POKEAPI_SPRITES}201.png`, shiny: `${POKEAPI_SPRITES}shiny/201.png` });
        expect(sprites("SPECIES_RAICHU_A", { dex: "NATIONAL_DEX_RAICHU", dexNumber: 26 }).normal).to.match(/regular\/raichu-alola\.png$/);
    });

    it("should use the local Cloud repository's images for custom forms and custom shinies", () =>
    {
        const images = { ...EMPTY_IMAGES, root: new Set(["SPECIES_PIKACHU_SURFING.png", "SPECIES_PIKACHU_SURFING_SHINY.png"]), unboundShinies: new Set(["SPECIES_CHARIZARD.png"]), gen9: new Set(["SPECIES_SPRIGATITO.png"]) };
        expect(sprites("SPECIES_PIKACHU_SURFING", { dexNumber: 25 }, images)).to.include(
            { normal: `${CLOUD_IMAGES}root/SPECIES_PIKACHU_SURFING.png`, shiny: `${CLOUD_IMAGES}root/SPECIES_PIKACHU_SURFING_SHINY.png`, source: "cloud" });
        expect(sprites("SPECIES_CHARIZARD", { dexNumber: 6, customShiny: true }, images)).to.include(
            { normal: `${POKEAPI_SPRITES}6.png`, shiny: `${CLOUD_IMAGES}unboundShinies/SPECIES_CHARIZARD.png` });
        expect(sprites("SPECIES_SPRIGATITO", { dexNumber: 906 }, images)).to.include({ normal: `${CLOUD_IMAGES}gen9/SPECIES_SPRIGATITO.png`, shiny: null });
        expect(sprites("SPECIES_CUSTOM", {})).to.include({ normal: null, shiny: null, source: null, exact: false });
    });

    it("should use Cloud's form names for compact species icons", () =>
    {
        expect(getSpeciesIcon("SPECIES_RAICHU_A")).to.match(/regular\/raichu-alola\.png$/);
        expect(getSpeciesIcon("SPECIES_PYROAR_FEMALE", "female/pyroar")).to.match(/regular\/female\/pyroar\.png$/);
    });

    it("should follow Cloud's item, ball and type icon rules", () =>
    {
        const images = { ...EMPTY_IMAGES, items: new Set(["ITEM_CUSTOM_CHARM.png"]) };
        expect(getItemIcon("ITEM_LEFTOVERS", { link: "hold-item/leftovers" }, images)).to.equal("https://raw.githubusercontent.com/msikma/pokesprite/master/items/hold-item/leftovers.png");
        expect(getItemIcon("ITEM_CUSTOM_CHARM", { name: "Custom Charm" }, images)).to.equal(`${CLOUD_IMAGES}items/ITEM_CUSTOM_CHARM.png`);
        expect(getItemIcon("ITEM_UNHOSTED", undefined, images)).to.equal(null);
        expect(getItemIcon("ITEM_NONE", { link: "none" }, images)).to.equal(null);
        expect(getBallIcon("Poké Ball")).to.equal("https://raw.githubusercontent.com/msikma/pokesprite/master/items/ball/poke.png");
        expect(getTypeIcon("Fire", index)).to.equal("https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/types/generation-viii/sword-shield/10.png");
        expect(getTypeIcon("Fire", null)).to.equal("https://raw.githubusercontent.com/msikma/pokesprite/master/misc/types/gen8/fire.png");
        expect(getTypeSymbol("Fire")).to.equal("https://raw.githubusercontent.com/msikma/pokesprite/master/misc/types/gen8/fire.png");
    });
});

describe("DPE sprites", () =>
{
    const graphics = Object.keys(DPE_SPRITE_FILES).filter((file) => file.endsWith(".png"));
    const tables = { tiles: DPE_SPRITE_FILES["src/Front_Pic_Table.c"], palette: DPE_SPRITE_FILES["src/Palette_Table.c"], shinyPalette: DPE_SPRITE_FILES["src/Shiny_Palette_Table.c"] };

    /**
     * Returns a PNG's chunks.
     *
     * @param {Buffer} png The PNG.
     * @returns {Array<{type: string, data: Buffer}>} The chunks.
     */
    const chunks = (png) =>
    {
        const result = [];
        for (let offset = 8; offset < png.length; offset += 12 + png.readUInt32BE(offset))
            result.push({ type: png.toString("latin1", offset + 4, offset + 8), data: png.subarray(offset + 8, offset + 8 + png.readUInt32BE(offset)) });
        return result;
    };

    it("should read which graphic each species uses", () =>
    {
        const { symbols, diagnostics } = parseSpriteTable(tables.tiles, DPE_MACROS, "gMonFrontPicTable");
        expect(symbols).to.deep.equal({ SPECIES_BULBASAUR: "gFrontSprite001BulbasaurTiles", SPECIES_IVYSAUR: "gFrontSprite002IvysaurTiles", SPECIES_VENUSAUR: "gFrontSprite003VenusaurTiles" });
        expect(diagnostics).to.deep.equal([]);
        expect(parseSpriteTable(tables.tiles, DPE_MACROS, "gMissing").symbols).to.equal(null);
    });

    it("should match species to their image files, leaving out species without images", () =>
    {
        const { sprites } = parseSpriteSources({ configText: DPE_FILES["src/defines.h"], tables, graphics });
        expect(sprites).to.deep.equal(
        {
            SPECIES_BULBASAUR:
            {
                tiles: "graphics/frontspr/gFrontSprite001Bulbasaur.png",
                palette: "graphics/frontspr/gFrontSprite001Bulbasaur.png",
                shinyPalette: "graphics/backspr/gBackShinySprite001Bulbasaur.png",
            },
            SPECIES_VENUSAUR: { tiles: "graphics/frontspr/gFrontSprite003Venusaur.png", palette: "graphics/frontspr/gFrontSprite003Venusaur.png", shinyPalette: null },
        });
        expect(parseSpriteSources({ configText: "", tables: { ...tables, palette: null }, graphics }).sprites).to.equal(null);
    });

    it("should draw a sprite with another palette and a transparent background", () =>
    {
        const tiles = createIndexedPng(NORMAL_PALETTE);
        const combined = chunks(combineSpritePalette(tiles, createIndexedPng(SHINY_PALETTE)));

        expect(combined.map((chunk) => chunk.type)).to.deep.equal(["IHDR", "PLTE", "tRNS", "IDAT", "IEND"]);
        expect([...combined[1].data]).to.deep.equal(SHINY_PALETTE.flat());
        expect([...combined[2].data]).to.deep.equal([0]);
        expect(combined[3].data.equals(chunks(tiles).find((chunk) => chunk.type === "IDAT").data)).to.equal(true);
        expect(() => combineSpritePalette(Buffer.from("png"), tiles)).to.throw();
    });
});

describe("PokeAPI index", () =>
{
    let directory;

    beforeEach(() =>
    {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), "cfru-editor-pokeapi-"));
    });

    afterEach(() =>
    {
        fs.rmSync(directory, { recursive: true, force: true });
    });

    it("should download the index once and reuse the stored copy", async () =>
    {
        const fetchResource = createPokeApiFetch();
        const index = await createPokeApiIndex({ directory, fetchResource }).getIndex();
        expect(index.pokemon).to.include({ "charizard-mega-x": 10034, "lycanroc-midday": 745 });
        expect(index.types).to.deep.equal({ fire: 10, dragon: 16 });
        expect(fetchResource.calls).to.have.length(2);

        const secondFetch = createPokeApiFetch();
        expect((await createPokeApiIndex({ directory, fetchResource: secondFetch }).getIndex()).pokemon).to.deep.equal(index.pokemon);
        expect(secondFetch.calls).to.have.length(0);
    });

    it("should keep an old index when it cannot be refreshed, and not retry right away", async () =>
    {
        let time = 0;
        const now = () => time;
        expect(await createPokeApiIndex({ directory, fetchResource: createPokeApiFetch(), now }).getIndex()).to.not.equal(null);

        time = 31 * DAY_MS;
        const offline = createPokeApiFetch({ fail: true });
        const loader = createPokeApiIndex({ directory, fetchResource: offline, now });
        expect((await loader.getIndex()).fetchedAt).to.equal(0);
        await loader.getIndex();
        expect(offline.calls).to.have.length(2);
    });

    it("should return nothing when offline without a stored index", async () =>
    {
        expect(await createPokeApiIndex({ directory, fetchResource: createPokeApiFetch({ fail: true }) }).getIndex()).to.equal(null);
    });

    it("should keep only plain names and numeric IDs", async () =>
    {
        const results = [{ name: "bulbasaur", url: "https://pokeapi.co/api/v2/pokemon/1/" }, { name: "../evil", url: "https://pokeapi.co/api/v2/pokemon/2/" }, { name: "odd", url: "https://pokeapi.co/api/v2/pokemon/x/" }];
        const fetchResource = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ results }) });
        expect((await createPokeApiIndex({ directory, fetchResource }).getIndex()).pokemon).to.deep.equal({ bulbasaur: 1 });
    });
});

describe("Catalog lookups", () =>
{
    const catalog =
    {
        name: "Test Game",
        species: { SPECIES_CHARIZARD: { megas: [{ species: "SPECIES_CHARIZARD_MEGA_X", item: "ITEM_CHARIZARDITE_X" }, { species: "SPECIES_CHARIZARD_MEGA_Y", item: "ITEM_CHARIZARDITE_Y" }] }, SPECIES_RAYQUAZA: { megas: [{ species: "SPECIES_RAYQUAZA_MEGA", move: "MOVE_DRAGONASCENT" }] } },
        moves: { MOVE_FLAMETHROWER: {}, MOVE_SURF: {}, MOVE_DRACOMETEOR: {} },
        learnsets:
        {
            SPECIES_CHARIZARD: { status: "complete", moves: { MOVE_FLAMETHROWER: ["level"] }, unknown: { MOVE_DRACOMETEOR: "Special tutor." } },
            SPECIES_MISSING: { status: "missing", moves: {}, unknown: {} },
        },
    };

    it("should classify moves as allowed, illegal, unknown or undefined", () =>
    {
        expect(getMoveLegality(catalog, "SPECIES_CHARIZARD", "MOVE_FLAMETHROWER")).to.deep.equal({ status: LEGALITY.ALLOWED, sources: ["level"], reason: null });
        expect(getMoveLegality(catalog, "SPECIES_CHARIZARD", "MOVE_SURF").status).to.equal(LEGALITY.ILLEGAL);
        expect(getMoveLegality(catalog, "SPECIES_CHARIZARD", "MOVE_DRACOMETEOR")).to.deep.equal({ status: LEGALITY.UNKNOWN, sources: [], reason: "Special tutor." });
        expect(getMoveLegality(catalog, "SPECIES_MISSING", "MOVE_SURF").status).to.equal(LEGALITY.UNKNOWN);
        expect(getMoveLegality(catalog, "SPECIES_NOT_IN_GAME", "MOVE_SURF").status).to.equal(LEGALITY.UNKNOWN);
        expect(getMoveLegality(catalog, "SPECIES_CHARIZARD", "MOVE_HYPERSPACEFURY").status).to.equal(LEGALITY.UNDEFINED);
        expect(getMoveLegality(catalog, "SPECIES_CHARIZARD", 7).status).to.equal(LEGALITY.UNDEFINED);
        expect(getMoveLegality(catalog, "SPECIES_CHARIZARD", 0).status).to.equal(LEGALITY.NONE);
        expect(getMoveLegality(catalog, "SPECIES_CHARIZARD", "MOVE_NONE").status).to.equal(LEGALITY.NONE);
    });

    it("should tell unknown, no, variable and fixed power apart, and moves that always hit", () =>
    {
        expect([null, 0, 1, 90].map((power) => getPowerKind({ power }))).to.deep.equal([POWER_KIND.UNKNOWN, POWER_KIND.NONE, POWER_KIND.VARIABLE, POWER_KIND.FIXED]);
        expect(alwaysHits({ accuracy: 0 })).to.equal(true);
        expect(alwaysHits({ accuracy: 100 })).to.equal(false);
        expect(alwaysHits({ accuracy: null })).to.equal(false);
    });

    it("should find the Mega Evolution a held item or known move triggers", () =>
    {
        expect(getMegaEvolutions(catalog, "SPECIES_CHARIZARD", "ITEM_CHARIZARDITE_Y").map((mega) => mega.species)).to.deep.equal(["SPECIES_CHARIZARD_MEGA_Y"]);
        expect(getMegaEvolutions(catalog, "SPECIES_CHARIZARD", "ITEM_LEFTOVERS")).to.deep.equal([]);
        expect(getMegaEvolutions(catalog, "SPECIES_RAYQUAZA", "ITEM_NONE", ["MOVE_DRAGONASCENT"]).map((mega) => mega.species)).to.deep.equal(["SPECIES_RAYQUAZA_MEGA"]);
        expect(getMegaEvolutions(catalog, "SPECIES_RAYQUAZA", "ITEM_NONE")).to.deep.equal([]);
        expect(getMegaEvolutions(catalog, "SPECIES_UNKNOWN", "ITEM_CHARIZARDITE_X")).to.deep.equal([]);
    });
});
