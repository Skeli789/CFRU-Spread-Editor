/**
 * Synthetic CFRU move data, DPE learnset sources and Unbound Cloud catalog data for catalog tests.
 * They follow the real files' layouts, including their quirks: headings with typos, a byte order mark,
 * GCC's obsolete "[INDEX] value" designator and numeric padding entries. DPE's sprite tables point at tiny
 * indexed PNGs.
 */

const zlib = require("zlib");

const CRLF = "\r\n";
const LF = "\n";
const BYTE_ORDER_MARK = "\uFEFF";

const BATTLE_MOVES =
[
    "#include \"../defines.h\"",
    "",
    "const struct BattleMove gBattleMoves[] =",
    "{",
    "\t[MOVE_NONE] =",
    "\t{",
    "\t\t.effect = EFFECT_HIT,",
    "\t\t.power = 40,",
    "\t\t.type = TYPE_MYSTERY,",
    "\t},",
    "",
    "\t[MOVE_POUND] =",
    "\t{",
    "\t\t.effect = EFFECT_HIT,",
    "\t\t.power = 40,",
    "\t\t.type = TYPE_NORMAL,",
    "\t\t.accuracy = 100,",
    "\t\t.pp = 35,",
    "\t\t.secondaryEffectChance = 0,",
    "\t\t.target = MOVE_TARGET_SELECTED,",
    "\t\t.priority = 0,",
    "\t\t.flags = FLAG_MAKES_CONTACT | FLAG_PROTECT_AFFECTED | FLAG_MIRROR_MOVE_AFFECTED,",
    "\t\t.z_move_power = 100,",
    "\t\t.split = SPLIT_PHYSICAL,",
    "\t\t.z_move_effect = 0",
    "\t},",
    "",
    "\t[MOVE_FLY] =",
    "\t{",
    "\t\t.effect = EFFECT_SEMI_INVULNERABLE,",
    "\t\t#ifdef UNBOUND",
    "\t\t.power = 100,",
    "\t\t#else",
    "\t\t.power = 90,",
    "\t\t#endif",
    "\t\t.type = TYPE_FLYING,",
    "\t\t.accuracy = 95,",
    "\t\t.pp = 15,",
    "\t\t.target = MOVE_TARGET_SELECTED,",
    "\t\t.priority = 0,",
    "\t\t.flags = 0,",
    "\t\t.split = SPLIT_PHYSICAL,",
    "\t},",
    "",
    "\t[MOVE_SWIFT] = { .effect = EFFECT_ALWAYS_HIT, .power = 60, .type = TYPE_NORMAL, .accuracy = 0, .pp = 20, .priority = 0, .split = SPLIT_SPECIAL },",
    "\t[MOVE_GYROBALL] = { .effect = EFFECT_HIT, .power = 1, .type = TYPE_STEEL, .accuracy = 100, .pp = 5, .priority = 0, .split = SPLIT_PHYSICAL },",
    "\t[MOVE_VITALTHROW] = { .effect = 0, .power = 70, .type = TYPE_FIGHTING, .accuracy = 0, .pp = 10, .priority = -1, .split = SPLIT_PHYSICAL },",
    "\t[MOVE_SWORDSDANCE] = { .effect = EFFECT_ATTACK_UP_2, .power = 0, .type = TYPE_NORMAL, .accuracy = 0, .pp = 20, .priority = 0, .split = SPLIT_STATUS },",
    "\t[MOVE_WEIRD] = { .power = SOME_MACRO(1), .type = TYPE_NORMAL, .flags = FLAG_A & FLAG_B },",
    "};",
    "",
    "const u8 gDynamaxMovePowers[] =",
    "{",
    "\t[MOVE_POUND] = 90,",
    "};",
    "",
].join(CRLF);
module.exports.BATTLE_MOVES = BATTLE_MOVES;

const ITEM_TABLES =
[
    "#include \"../defines.h\"",
    "",
    "const struct FlingStruct gFlingTable[ITEMS_COUNT] =",
    "{",
    "\t[ITEM_LEFTOVERS] = {10, 0},",
    "};",
    "",
    "const u16 gItemsByType[ITEMS_COUNT] =",
    "{",
    "\t[ITEM_LEFTOVERS] = ITEM_TYPE_HELD_ITEM,",
    "\t[ITEM_VENUSAURITE] = ITEM_TYPE_MEGA_STONE,",
    "\t[ITEM_NORMALIUM_Z] = ITEM_TYPE_Z_CRYSTAL,",
    "\t[ITEM_CUSTOM_CHARM] = 5,",
    "};",
    "",
].join(CRLF);
module.exports.ITEM_TABLES = ITEM_TABLES;

const DPE_DEFINES =
[
    "#pragma once",
    "",
    "#include \"../include/species.h\"",
    "",
    "#define EXPAND_LEARNSETS //Comment out to use CFRU's learnsets",
    "#define NUM_TMSHMS 3",
    "",
].join(LF);

const LEARNSETS =
[
    "#include \"defines.h\"",
    "",
    "#ifdef EXPAND_LEARNSETS",
    "",
    "#define LEVEL_UP_MOVE(lvl, move) {move, lvl}",
    "#define LEVEL_UP_END {0x0, 0xFF}",
    "",
    "static const struct LevelUpMove sEmptyMoveset[] = {",
    "\tLEVEL_UP_END",
    "};",
    "",
    "static const struct LevelUpMove sBulbasaurLevelUpLearnset[] = {",
    "\tLEVEL_UP_MOVE( 1, MOVE_TACKLE),",
    "\tLEVEL_UP_MOVE( 9, MOVE_LEECHSEED),",
    "\tLEVEL_UP_END",
    "};",
    "",
    "static const struct LevelUpMove sIvysaurLevelUpLearnset[] = {",
    "\tLEVEL_UP_MOVE( 1, MOVE_TACKLE),",
    "\tLEVEL_UP_END",
    "};",
    "",
    "static const struct LevelUpMove sVenusaurLevelUpLearnset[] = {",
    "\tLEVEL_UP_MOVE( 0, MOVE_PETALBLIZZARD),",
    "\tLEVEL_UP_MOVE( 1, MOVE_GIGADRAIN),",
    "\t{MOVE_SYNTHESIS, 40},",
    "\tLEVEL_UP_MOVE(50, 12),",
    "\tLEVEL_UP_END",
    "};",
    "",
    "static const struct LevelUpMove sCharizardLevelUpLearnset[] = {",
    "\tLEVEL_UP_MOVE( 1, MOVE_FLAMETHROWER),",
    "\tLEVEL_UP_MOVE( 1, MOVE_AIRSLASH),",
    "\tLEVEL_UP_END",
    "};",
    "",
    "static const struct LevelUpMove sPichuLevelUpLearnset[] = {",
    "\tLEVEL_UP_MOVE( 1, MOVE_THUNDERSHOCK),",
    "\tLEVEL_UP_END",
    "};",
    "",
    "static const struct LevelUpMove sPikachuLevelUpLearnset[] = {",
    "\tLEVEL_UP_MOVE( 1, MOVE_THUNDERBOLT),",
    "\tLEVEL_UP_END",
    "};",
    "",
    "static const struct LevelUpMove sDragoniteLevelUpLearnset[] = {",
    "\tLEVEL_UP_MOVE( 1, MOVE_OUTRAGE),",
    "\tLEVEL_UP_END",
    "};",
    "",
    "static const struct LevelUpMove sSmeargleLevelUpLearnset[] = {",
    "\tLEVEL_UP_MOVE( 1, MOVE_SKETCH),",
    "\tLEVEL_UP_END",
    "};",
    "",
    "static const struct LevelUpMove sKyuremLevelUpLearnset[] = {",
    "\tLEVEL_UP_MOVE( 1, MOVE_ICEBEAM),",
    "\tLEVEL_UP_END",
    "};",
    "",
    "const struct LevelUpMove* const gLevelUpLearnsets[NUM_SPECIES] =",
    "{",
    "\t[SPECIES_NONE] = sEmptyMoveset,",
    "\t[SPECIES_BULBASAUR] = sBulbasaurLevelUpLearnset,",
    "\t[SPECIES_IVYSAUR] = sIvysaurLevelUpLearnset,",
    "\t[SPECIES_VENUSAUR] = sVenusaurLevelUpLearnset,",
    "\t[SPECIES_VENUSAUR_MEGA] = sEmptyMoveset,",
    "\t[SPECIES_CHARIZARD] = sCharizardLevelUpLearnset,",
    "\t[SPECIES_PICHU] = sPichuLevelUpLearnset,",
    "\t[SPECIES_PIKACHU] = sPikachuLevelUpLearnset,",
    "\t[SPECIES_PIKACHU_SURFING] = sPikachuLevelUpLearnset,",
    "    [SPECIES_PIKACHU_LIBRE] = sPikachuLevelUpLearnset,",
    "    [SPECIES_PIKACHU_ROCK_STAR] = sPikachuLevelUpLearnset,",
    "    [SPECIES_PIKACHU_BELLE] = sPikachuLevelUpLearnset,",
    "    [SPECIES_PIKACHU_POP_STAR] = sPikachuLevelUpLearnset,",
    "    [SPECIES_PIKACHU_PHD] = sPikachuLevelUpLearnset,",
    "\t[SPECIES_DRAGONITE] = sDragoniteLevelUpLearnset,",
    "\t[SPECIES_SMEARGLE] = sSmeargleLevelUpLearnset,",
    "\t[SPECIES_KYUREM] = sKyuremLevelUpLearnset,",
    "\t[SPECIES_KYUREM_BLACK] = sKyuremLevelUpLearnset,",
    "\t[SPECIES_MISSING_ARRAY] = sNotDefinedLevelUpLearnset,",
    "\t[254] = sEmptyMoveset,",
    "};",
    "#endif",
    "",
].join(LF);

const EGG_MOVES =
[
    "#include \"defines.h\"",
    "",
    "#define EGG_MOVES_SPECIES_OFFSET 20000",
    "#define EGG_MOVES_TERMINATOR 0xFFFF",
    "#define egg_moves(species, moves...) (SPECIES_##species + EGG_MOVES_SPECIES_OFFSET), moves",
    "",
    "const u16 gEggMoves[] =",
    "{",
    "\tegg_moves(BULBASAUR,",
    "\t\tMOVE_SKULLBASH,",
    "\t\tMOVE_CHARM),",
    "",
    "\tEGG_MOVES_TERMINATOR",
    "};",
    "",
].join(LF);

const TM_TUTOR_TABLES =
[
    "#include \"defines.h\"",
    "",
    "const u16 gTMHMMoves[NUM_TMSHMS] =",
    "{",
    "\tMOVE_FOCUSPUNCH,\t//1",
    "\tMOVE_HIDDENPOWER,\t//2",
    "\tMOVE_CUT,\t//HM01",
    "};",
    "",
    "const u16 gMoveTutorMoves[NUM_MOVE_TUTOR_MOVES] =",
    "{",
    "\tMOVE_MEGAPUNCH,",
    "\tMOVE_SWORDSDANCE,",
    "};",
    "",
].join(LF);

const EVOLUTION_TABLE =
[
    "#include \"defines.h\"",
    "",
    "#define TIME_RANGE(startTime, endTime) ((startTime << 8) | endTime)",
    "",
    "const struct Evolution gEvolutionTable[NUM_SPECIES][EVOS_PER_MON] =",
    "{",
    "\t[SPECIES_BULBASAUR] =        {{EVO_LEVEL, 16, SPECIES_IVYSAUR, 0}},",
    "\t[SPECIES_IVYSAUR] =          {{EVO_LEVEL, 32, SPECIES_VENUSAUR, 0}},",
    "\t[SPECIES_VENUSAUR] =         {{EVO_MEGA, ITEM_VENUSAURITE, SPECIES_VENUSAUR_MEGA, MEGA_VARIANT_STANDARD}},",
    "\t[SPECIES_CHARIZARD] =        {{EVO_MEGA, ITEM_CHARIZARDITE_X, SPECIES_CHARIZARD_MEGA_X, MEGA_VARIANT_STANDARD},",
    "\t                              {EVO_MEGA, ITEM_CHARIZARDITE_Y, SPECIES_CHARIZARD_MEGA_Y, MEGA_VARIANT_STANDARD},",
    "\t                              {EVO_GIGANTAMAX, TRUE, SPECIES_CHARIZARD_GIGA, 0}},",
    "\t[SPECIES_PICHU]              {{EVO_LEVEL_SPECIFIC_TIME_RANGE, TIME_RANGE(1, 2), SPECIES_PIKACHU, 0}},",
    "\t[SPECIES_VENUSAUR_MEGA] =    {{EVO_MEGA, ITEM_NONE, SPECIES_VENUSAUR, MEGA_VARIANT_STANDARD}},",
    "\t[SPECIES_RAYQUAZA] =         {{EVO_MEGA, MOVE_DRAGONASCENT, SPECIES_RAYQUAZA_MEGA, MEGA_VARIANT_WISH}},",
    "\t[SPECIES_KYUREM] =           {{EVO_LEVEL}},",
    "};",
    "",
].join(LF);

const DPE_FILES =
{
    "src/defines.h": DPE_DEFINES,
    "src/Learnsets.c": LEARNSETS,
    "src/Egg_Moves.c": EGG_MOVES,
    "src/TM_Tutor_Tables.c": TM_TUTOR_TABLES,
    "src/Evolution Table.c": EVOLUTION_TABLE,
    "src/tm_compatibility/1 - Focus Punch.txt": "TM01: Focus Punch\nCHARIZARD\n",
    "src/tm_compatibility/2 - Hidden Power.txt": `${BYTE_ORDER_MARK}TM02: Hidden Power${CRLF}BULBASAUR${CRLF}SPECIES_VENUSAUR${CRLF}${CRLF}`,
    "src/tm_compatibility/3 - Cut.txt": "3HM01: Cut\nIVYSAUR\n",
    "src/tm_compatibility/notes.md": "Not a compatibility list\n",
    "src/tutor_compatibility/1 - Mega Punch.txt": "Tutour 1: Mega Punch\nCHARIZARD\nMISSINGNO\n",
    "src/tutor_compatibility/2 - Wrong Name.txt": "Tutor 2: Wrong Name\nKYUREM\nnot a species!\n",
    "src/tutor_compatibility/9 - Beyond The Table.txt": "Tutor 9: Beyond The Table\nKYUREM\n",
};
module.exports.DPE_FILES = DPE_FILES;

const COSPLAY_SIGNATURE_MOVES =
{
    SPECIES_PIKACHU_LIBRE: "MOVE_FLYINGPRESS",
    SPECIES_PIKACHU_ROCK_STAR: "MOVE_METEORMASH",
    SPECIES_PIKACHU_BELLE: "MOVE_ICICLECRASH",
    SPECIES_PIKACHU_POP_STAR: "MOVE_DRAININGKISS",
    SPECIES_PIKACHU_PHD: "MOVE_FLAMETHROWER",
};
module.exports.COSPLAY_SIGNATURE_MOVES = COSPLAY_SIGNATURE_MOVES;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_BIT_DEPTH = 4;
const PNG_COLOR_TYPE_INDEXED = 3;

/**
 * Encodes one PNG chunk.
 *
 * @param {string} type The chunk type.
 * @param {Buffer} data The chunk data.
 * @returns {Buffer} The chunk.
 */
function pngChunk(type, data)
{
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const length = Buffer.alloc(4);
    const crc = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
}

/**
 * Creates a 2x1 16 color indexed PNG like DPE's sprites, drawing palette colors 0 and 1.
 *
 * @param {Array<[number, number, number]>} colors The palette.
 * @returns {Buffer} The PNG.
 */
function createIndexedPng(colors)
{
    const header = Buffer.alloc(13);
    header.writeUInt32BE(2, 0);
    header.writeUInt32BE(1, 4);
    header[8] = PNG_BIT_DEPTH;
    header[9] = PNG_COLOR_TYPE_INDEXED;

    // One row with no filter, then pixels 0 and 1 packed into a byte
    const pixels = zlib.deflateSync(Buffer.from([0, 0x01]));
    return Buffer.concat([PNG_SIGNATURE, pngChunk("IHDR", header), pngChunk("gAMA", Buffer.alloc(4)), pngChunk("PLTE", Buffer.from(colors.flat())),
        pngChunk("IDAT", pixels), pngChunk("IEND", Buffer.alloc(0))]);
}
module.exports.createIndexedPng = createIndexedPng;

const NORMAL_PALETTE = [[0, 255, 0], [255, 0, 0]];
module.exports.NORMAL_PALETTE = NORMAL_PALETTE;
const SHINY_PALETTE = [[0, 255, 0], [0, 0, 255]];
module.exports.SHINY_PALETTE = SHINY_PALETTE;

/**
 * Returns one of DPE's species graphics tables.
 *
 * @param {string} struct The table's struct.
 * @param {string} name The table's name.
 * @param {Array<string>} entries The entries.
 * @returns {string} The source.
 */
function spriteTable(struct, name, entries)
{
    return ["#include \"defines.h\"", "", `const struct ${struct} ${name}[NUM_SPECIES] =`, "{", ...entries.map((entry) => `\t${entry},`), "};", ""].join(LF);
}

// Bulbasaur has every graphic, Ivysaur's image is missing and Venusaur has no shiny palette
const DPE_SPRITE_FILES =
{
    "src/Front_Pic_Table.c": spriteTable("CompressedSpriteSheet", "gMonFrontPicTable",
    [
        "[SPECIES_BULBASAUR] = {gFrontSprite001BulbasaurTiles, (64 * 64) / 2, SPECIES_BULBASAUR}",
        "[SPECIES_IVYSAUR] = {gFrontSprite002IvysaurTiles, (64 * 64) / 2, SPECIES_IVYSAUR}",
        "[SPECIES_VENUSAUR] = {gFrontSprite003VenusaurTiles, (64 * 64) / 2, SPECIES_VENUSAUR}",
    ]),
    "src/Palette_Table.c": spriteTable("CompressedSpritePalette", "gMonPaletteTable",
    [
        "[SPECIES_BULBASAUR] = {gFrontSprite001BulbasaurPal, SPECIES_BULBASAUR, 0x0}",
        "[SPECIES_IVYSAUR] = {gFrontSprite002IvysaurPal, SPECIES_IVYSAUR, 0x0}",
        "[SPECIES_VENUSAUR] = {gFrontSprite003VenusaurPal, SPECIES_VENUSAUR, 0x0}",
    ]),
    "src/Shiny_Palette_Table.c": spriteTable("CompressedSpritePalette", "gMonShinyPaletteTable",
    [
        "[SPECIES_BULBASAUR] = {gBackShinySprite001BulbasaurPal, SPECIES_BULBASAUR + NUM_SPECIES, 0x0}",
        "[SPECIES_VENUSAUR] = {gBackShinySprite003VenusaurPal, SPECIES_VENUSAUR + NUM_SPECIES, 0x0}",
    ]),
    "graphics/frontspr/gFrontSprite001Bulbasaur.png": createIndexedPng(NORMAL_PALETTE),
    "graphics/frontspr/gFrontSprite003Venusaur.png": createIndexedPng(NORMAL_PALETTE),
    "graphics/backspr/gBackShinySprite001Bulbasaur.png": createIndexedPng(SHINY_PALETTE),
};
module.exports.DPE_SPRITE_FILES = DPE_SPRITE_FILES;

/**
 * Returns a complete Cloud base stats entry.
 *
 * @param {Array<string>} types The two types.
 * @param {Array<string>} abilities The first, second and hidden abilities.
 * @returns {object} The entry.
 */
function baseStats(types, abilities)
{
    return {
        baseHP: 78, baseAttack: 84, baseDefense: 78, baseSpAttack: 109, baseSpDefense: 85, baseSpeed: 100,
        type1: types[0], type2: types[1],
        ability1: abilities[0], ability2: abilities[1], hiddenAbility: abilities[2],
    };
}

const GAME_SPECIES =
{
    SPECIES_NONE: baseStats(["TYPE_NORMAL", "TYPE_NORMAL"], ["ABILITY_NONE", "ABILITY_NONE", "ABILITY_NONE"]),
    SPECIES_BULBASAUR: baseStats(["TYPE_GRASS", "TYPE_POISON"], ["ABILITY_OVERGROW", "ABILITY_NONE", "ABILITY_CHLOROPHYLL"]),
    SPECIES_IVYSAUR: baseStats(["TYPE_GRASS", "TYPE_POISON"], ["ABILITY_OVERGROW", "ABILITY_NONE", "ABILITY_CHLOROPHYLL"]),
    SPECIES_VENUSAUR: baseStats(["TYPE_GRASS", "TYPE_POISON"], ["ABILITY_OVERGROW", "ABILITY_NONE", "ABILITY_CHLOROPHYLL"]),
    SPECIES_VENUSAUR_MEGA: baseStats(["TYPE_GRASS", "TYPE_POISON"], ["ABILITY_THICKFAT", "ABILITY_NONE", "ABILITY_NONE"]),
    SPECIES_CHARIZARD: baseStats(["TYPE_FIRE", "TYPE_FLYING"], ["ABILITY_BLAZE", "ABILITY_NONE", "ABILITY_SOLARPOWER"]),
    SPECIES_CHARIZARD_MEGA_X: baseStats(["TYPE_FIRE", "TYPE_DRAGON"], ["ABILITY_TOUGHCLAWS", "ABILITY_NONE", "ABILITY_NONE"]),
    SPECIES_CHARIZARD_GIGA: baseStats(["TYPE_FIRE", "TYPE_FLYING"], ["ABILITY_BLAZE", "ABILITY_NONE", "ABILITY_SOLARPOWER"]),
    SPECIES_PICHU: baseStats(["TYPE_ELECTRIC", "TYPE_ELECTRIC"], ["ABILITY_STATIC", "ABILITY_NONE", "ABILITY_LIGHTNINGROD"]),
    SPECIES_PIKACHU: baseStats(["TYPE_ELECTRIC", "TYPE_ELECTRIC"], ["ABILITY_STATIC", "ABILITY_NONE", "ABILITY_LIGHTNINGROD"]),
    SPECIES_PIKACHU_SURFING: baseStats(["TYPE_ELECTRIC", "TYPE_ELECTRIC"], ["ABILITY_STATIC", "ABILITY_NONE", "ABILITY_LIGHTNINGROD"]),
    SPECIES_DRAGONITE: baseStats(["TYPE_DRAGON", "TYPE_FLYING"], ["ABILITY_INNERFOCUS", "ABILITY_NONE", "ABILITY_MULTISCALE"]),
    SPECIES_SMEARGLE: baseStats(["TYPE_NORMAL", "TYPE_NORMAL"], ["ABILITY_OWNTEMPO", "ABILITY_TECHNICIAN", "ABILITY_MOODY"]),
    SPECIES_KYUREM: baseStats(["TYPE_DRAGON", "TYPE_ICE"], ["ABILITY_PRESSURE", "ABILITY_NONE", "ABILITY_NONE"]),
    SPECIES_KYUREM_BLACK: baseStats(["TYPE_DRAGON", "TYPE_ICE"], ["ABILITY_TERAVOLT", "ABILITY_NONE", "ABILITY_NONE"]),
    SPECIES_LYCANROC_N: baseStats(["TYPE_ROCK", "TYPE_ROCK"], ["ABILITY_KEENEYE", "ABILITY_NONE", "ABILITY_NOGUARD"]),
    SPECIES_UNOWN_B: baseStats(["TYPE_PSYCHIC", "TYPE_PSYCHIC"], ["ABILITY_LEVITATE", "ABILITY_NONE", "ABILITY_NONE"]),
    SPECIES_GARCHOMP: { baseHP: 108, type1: "TYPE_DRAGON", type2: "TYPE_GROUND", ability1: "ABILITY_SANDVEIL" },
};

const GAME_MOVES = Object.fromEntries(
[
    "MOVE_NONE", "MOVE_POUND", "MOVE_FLY", "MOVE_SWIFT", "MOVE_GYROBALL", "MOVE_SWORDSDANCE", "MOVE_TACKLE",
    "MOVE_LEECHSEED", "MOVE_PETALBLIZZARD", "MOVE_GIGADRAIN", "MOVE_FLAMETHROWER", "MOVE_AIRSLASH", "MOVE_SKULLBASH",
    "MOVE_CHARM", "MOVE_FOCUSPUNCH", "MOVE_HIDDENPOWER", "MOVE_CUT", "MOVE_MEGAPUNCH", "MOVE_THUNDERBOLT",
    "MOVE_VOLTTACKLE", "MOVE_DRACOMETEOR", "MOVE_OUTRAGE", "MOVE_SKETCH", "MOVE_STRUGGLE", "MOVE_CHATTER",
    "MOVE_ICEBEAM", "MOVE_GLACIATE", "MOVE_FUSIONBOLT", "MOVE_EARTHQUAKE",
].map((move) => [move, true]));

const CLOUD_FILES =
{
    "src/data/cfru/BaseStats.json": JSON.stringify(GAME_SPECIES),
    "src/data/cfru/Moves.json": JSON.stringify({ ...GAME_MOVES, MOVE_REMOVED: false }),
    "src/data/cfru/Items.json": `${BYTE_ORDER_MARK}${JSON.stringify({ ITEM_NONE: true, ITEM_LEFTOVERS: true, ITEM_VENUSAURITE: true, ITEM_CUSTOM_CHARM: true, ITEM_UNNAMED_THING: true })}`,
    "src/data/cfru/BallTypes.json": JSON.stringify({ BALL_TYPE_POKE_BALL: 0, BALL_TYPE_MASTER_BALL: true }),
    "src/data/SpeciesNames.json": JSON.stringify({ SPECIES_BULBASAUR: "Bulbasaur", SPECIES_CHARIZARD: "Charizard", SPECIES_PIKACHU_SURFING: "Pikachu" }),
    "src/data/SpeciesNamesAlts.json": JSON.stringify({ SPECIES_PIKACHU_SURFING: "Pikachu-Surfing" }),
    "src/data/SpeciesToDexNum.json": JSON.stringify(
    {
        SPECIES_BULBASAUR: "NATIONAL_DEX_BULBASAUR", SPECIES_IVYSAUR: "NATIONAL_DEX_IVYSAUR", SPECIES_VENUSAUR: "NATIONAL_DEX_VENUSAUR",
        SPECIES_VENUSAUR_MEGA: "NATIONAL_DEX_VENUSAUR", SPECIES_CHARIZARD: "NATIONAL_DEX_CHARIZARD", SPECIES_CHARIZARD_MEGA_X: "NATIONAL_DEX_CHARIZARD",
        SPECIES_CHARIZARD_GIGA: "NATIONAL_DEX_CHARIZARD", SPECIES_PICHU: "NATIONAL_DEX_PICHU", SPECIES_PIKACHU: "NATIONAL_DEX_PIKACHU",
        SPECIES_PIKACHU_SURFING: "NATIONAL_DEX_PIKACHU", SPECIES_DRAGONITE: "NATIONAL_DEX_DRAGONITE", SPECIES_SMEARGLE: "NATIONAL_DEX_SMEARGLE",
        SPECIES_KYUREM: "NATIONAL_DEX_KYUREM", SPECIES_KYUREM_BLACK: "NATIONAL_DEX_KYUREM", SPECIES_LYCANROC_N: "NATIONAL_DEX_LYCANROC",
        SPECIES_UNOWN_B: "NATIONAL_DEX_UNOWN",
    }),
    "src/data/DexNum.json": JSON.stringify(
    {
        NATIONAL_DEX_BULBASAUR: "1", NATIONAL_DEX_IVYSAUR: "2", NATIONAL_DEX_VENUSAUR: "3", NATIONAL_DEX_CHARIZARD: "6",
        NATIONAL_DEX_PIKACHU: "25", NATIONAL_DEX_DRAGONITE: "149", NATIONAL_DEX_PICHU: "172", NATIONAL_DEX_UNOWN: "201",
        NATIONAL_DEX_SMEARGLE: "235", NATIONAL_DEX_KYUREM: "646", NATIONAL_DEX_LYCANROC: "745",
    }),
    "src/data/MoveNames.json": JSON.stringify({ MOVE_POUND: "Pound", MOVE_FLY: "Fly", MOVE_MEGAPUNCH: "Mega Punch", MOVE_SWORDSDANCE: "Swords Dance" }),
    "src/data/MoveData.json": JSON.stringify(
    {
        MOVE_POUND: { type: "TYPE_NORMAL", split: "SPLIT_PHYSICAL", pp: 35 },
        MOVE_FLY: { type: "TYPE_FLYING", split: "SPLIT_PHYSICAL", pp: 10 },
        MOVE_TACKLE: { type: "TYPE_NORMAL", split: "SPLIT_PHYSICAL", pp: 35 },
    }),
    "src/data/AbilityNames.json": JSON.stringify({ ABILITY_NONE: "None", ABILITY_OVERGROW: "Overgrow", ABILITY_CHLOROPHYLL: "Chlorophyll" }),
    "src/data/ItemNames.json": JSON.stringify(
    {
        ITEM_NONE: { name: "None", link: "none" },
        ITEM_LEFTOVERS: { name: "Leftovers", link: "hold-item/leftovers" },
        ITEM_VENUSAURITE: { name: "Venusaurite", link: "mega-stone/venusaurite" },
        ITEM_CUSTOM_CHARM: { name: "Custom Charm" },
    }),
    "src/data/NatureNames.json": JSON.stringify({ NATURE_HARDY: "Hardy", NATURE_TIMID: "Timid" }),
    "src/data/TypeNames.json": JSON.stringify({ TYPE_FIRE: "Fire", TYPE_DRAGON: "Dragon" }),
    "src/data/BallTypeNames.json": JSON.stringify({ BALL_TYPE_POKE_BALL: "Poké Ball", BALL_TYPE_MASTER_BALL: "Master Ball" }),
    "src/data/UnboundShinies.json": JSON.stringify({ SPECIES_CHARIZARD: true }),
    "public/images/gigantamax.png": "png",
    "public/images/SPECIES_PIKACHU_SURFING.png": "png",
    "public/images/SPECIES_PIKACHU_SURFING_SHINY.png": "png",
    "public/images/items/ITEM_CUSTOM_CHARM.png": "png",
    "public/images/unbound_shinies/SPECIES_CHARIZARD.png": "png",
};
module.exports.CLOUD_FILES = CLOUD_FILES;

// PokeAPI's lists, where default forms of some species have a suffix and forms have IDs above 10000
const POKEAPI_POKEMON =
[
    ["bulbasaur", 1], ["ivysaur", 2], ["venusaur", 3], ["charizard", 6], ["pikachu", 25], ["dragonite", 149],
    ["pichu", 172], ["unown", 201], ["smeargle", 235], ["kyurem", 646], ["kyurem-black", 10023], ["lycanroc-midday", 745],
    ["venusaur-mega", 10033], ["charizard-mega-x", 10034], ["charizard-gmax", 10196], ["lycanroc-midnight", 10126],
];
const POKEAPI_TYPES = [["fire", 10], ["dragon", 16]];

/**
 * Returns a PokeAPI list response body.
 *
 * @param {string} resource The resource, such as pokemon.
 * @param {Array<[string, number]>} entries Names and IDs.
 * @returns {string} The JSON body.
 */
function toPokeApiList(resource, entries)
{
    return JSON.stringify({ count: entries.length, results: entries.map(([name, id]) => ({ name, url: `https://pokeapi.co/api/v2/${resource}/${id}/` })) });
}

/**
 * Creates a fetch replacement that serves PokeAPI's lists and records requested URLs.
 *
 * @param {object} [options] Stub options.
 * @param {boolean} [options.fail] Whether every request fails as if offline.
 * @returns {Function & {calls: Array<string>}} The fetch replacement.
 */
function createPokeApiFetch({ fail = false } = {})
{
    const calls = [];
    const fetchResource = async (url) =>
    {
        calls.push(url);
        if (fail)
            throw new TypeError("fetch failed");

        const body = url.includes("/type") ? toPokeApiList("type", POKEAPI_TYPES) : toPokeApiList("pokemon", POKEAPI_POKEMON);
        return { ok: true, status: 200, text: async () => body };
    };
    fetchResource.calls = calls;
    return fetchResource;
}
module.exports.createPokeApiFetch = createPokeApiFetch;
