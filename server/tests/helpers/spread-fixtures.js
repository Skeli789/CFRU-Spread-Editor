/**
 * Synthetic CFRU source files for spread parser and save tests.
 * They mirror the real files' layouts: tabs, CRLF or LF line endings, a byte order mark, comments,
 * preprocessor branches, placeholders and trainer tables.
 */

const CRLF = "\r\n";
const LF = "\n";
const BYTE_ORDER_MARK = "\uFEFF";

const IV_NAMES = ["hpIv", "atkIv", "defIv", "spAtkIv", "spDefIv", "spdIv"];


/**
 * Returns the IV lines of an entry.
 *
 * @param {Array<number>} ivs IVs in source order.
 * @returns {Array<string>} The lines.
 */
function ivLines(ivs)
{
    return IV_NAMES.map((name, index) => `\t\t.${name} = ${ivs[index]},`);
}

/**
 * Returns the lines of one spread entry.
 *
 * @param {object} spread The spread.
 * @param {string} spread.species The species constant and any comment.
 * @param {Array<number>} [spread.ivs] IVs in source order: HP, Atk, Def, SpA, SpD, Spe.
 * @param {Array<string>} [spread.evs] EV lines such as "hpEv = 252".
 * @param {string} [spread.ability] The ability slot constant.
 * @param {string} [spread.abilityComment] The ability constant written in a comment after it.
 * @param {string} [spread.item] The held item.
 * @param {Array<string>} [spread.moves] Move lines, which may include comments.
 * @param {Array<string>} [spread.extra] Extra field lines after the flags.
 * @returns {Array<string>} The lines.
 */
function entryLines({ species, ivs = [31, 31, 31, 31, 31, 31], evs = [], ability = "FRONTIER_ABILITY_1", abilityComment = null, item = "ITEM_LIFE_ORB", moves = ["MOVE_TACKLE"], extra = [] })
{
    return [
        "\t{",
        `\t\t.species = ${species},`,
        "\t\t.nature = NATURE_TIMID,",
        ...ivLines(ivs),
        ...evs.map((ev) => `\t\t.${ev},`),
        `\t\t.ability = ${ability},${abilityComment != null ? ` //${abilityComment}` : ""}`,
        `\t\t.item = ${item},`,
        "\t\t.moves =",
        "\t\t{",
        ...moves.map((move) => `\t\t\t${move}`),
        "\t\t},",
        "\t\t.ball = BALL_TYPE_RANDOM,",
        "\t\t.forSingles = TRUE,",
        "\t\t.forDoubles = TRUE,",
        "\t\t.modifyMovesDoubles = TRUE,",
        ...extra.map((line) => `\t\t${line}`),
        "\t},",
    ];
}

const CONFIG_UNBOUND =
[
    "#pragma once",
    "",
    "/* #define NOT_DEFINED */",
    "#define UNBOUND",
    "#define SPREAD_LEVEL 2 //Compared by a fixture condition",
    "",
].join(CRLF);

const CONFIG_VANILLA = CONFIG_UNBOUND.replace("#define UNBOUND", "//#define UNBOUND");

// CRLF with section comments, Hidden Power, unknown fields and an inactive branch of empty placeholders
const BATTLE_TOWER_SPREADS =
[
    "/*",
    "battle_tower_spreads.h",
    "#ifdef inside a comment is not a directive",
    "*/",
    "",
    "#ifdef UNBOUND",
    "const struct BattleTowerSpread gFrontierSpreads[] =",
    "{",
    ...entryLines(
    {
        species: "SPECIES_VENUSAUR",
        ivs: [31, 0, 31, 31, 31, 31],
        evs: ["hpEv = 252", "defEv = 252"],
        ability: "FRONTIER_ABILITY_HIDDEN",
        abilityComment: "ABILITY_CHLOROPHYLL",
        item: "ITEM_BLACK_SLUDGE",
        moves: ["MOVE_GIGADRAIN,", "MOVE_HIDDENPOWER, //TYPE_DRAGON", "MOVE_LEECHSEED,", "MOVE_SYNTHESIS,"],
    }),
    "\t//Gen 8",
    ...entryLines(
    {
        species: "SPECIES_CHARIZARD",
        evs: ["spAtkEv = 252", "spdEv = 252"],
        moves: ["MOVE_FLAMETHROWER,", "MOVE_AIRSLASH,"],
        extra: [".gigantamax = TRUE,", ".specificTeamType = DOUBLES_SUN_TEAM,", ".futureField = SOME_VALUE, //Kept as written"],
    }),
    "\t{",
    "\t\t.species = SPECIES_PIKACHU, //Placeholder spreads",
    "\t},",
    "};",
    "",
    "const struct BattleTowerSpread gLittleCupSpreads[] =",
    "{",
    ...entryLines({ species: "SPECIES_BULBASAUR", moves: ["MOVE_GIGADRAIN,"] }),
    "};",
    "",
    "#else",
    "",
    "const struct BattleTowerSpread gFrontierSpreads[] =",
    "{",
    "\t{",
    "\t},",
    "};",
    "",
    "const struct BattleTowerSpread gLittleCupSpreads[] =",
    "{",
    "\t{",
    "\t},",
    "};",
    "",
    "#endif",
    "",
    "const u16 gNumFrontierSpreads = ARRAY_COUNT(gFrontierSpreads);",
    "",
].join(CRLF);

// LF with Unicode comments, a conditional inside an array, a fixed-size array and an unsupported entry
const SPECIAL_TRAINER_SPREADS =
[
    "#include \"../config.h\"",
    "",
    "#ifdef UNBOUND",
    "const struct BattleTowerSpread gSpecialTowerSpread_Palmer1[] =",
    "{",
    ...entryLines({ species: "SPECIES_GARCHOMP, //Pokémon ✓", moves: ["MOVE_EARTHQUAKE, //Élan"] }),
    "#if SPREAD_LEVEL >= 2 && defined(UNBOUND)",
    ...entryLines({ species: "SPECIES_TYRANITAR", moves: ["MOVE_CRUNCH,"] }),
    "#endif",
    ...entryLines({ species: "SPECIES_METAGROSS", moves: ["MOVE_METEORMASH,"] }),
    ...entryLines({ species: "SPECIES_SALAMENCE", moves: ["MOVE_OUTRAGE,"] }),
    "};",
    "",
    "const struct BattleTowerSpread gLittleCupTowerSpread_Palmer1[] =",
    "{",
    ...entryLines({ species: "SPECIES_GIBLE", moves: ["MOVE_DRAGONCLAW,"] }),
    "};",
    "",
    "const struct BattleTowerSpread gSpecialTowerSpread_Fixed[2] =",
    "{",
    ...entryLines({ species: "SPECIES_LUCARIO", moves: ["MOVE_AURASPHERE,"] }),
    "\t{",
    "\t\t.species = SPECIES_GOLEM,",
    "\t\t BALL_TYPE_MASTER_BALL,",
    "\t},",
    "};",
    "#endif",
    "",
].join(LF);

// A byte order mark, CRLF and a last entry without a trailing comma
const MULTI_SPREADS = BYTE_ORDER_MARK +
[
    "#include \"../config.h\"",
    "",
    "#ifdef UNBOUND",
    "const struct BattleTowerSpread gMultiTowerSpread_Milo[] =",
    "{",
    ...entryLines({ species: "SPECIES_PIKACHU", moves: ["MOVE_THUNDERBOLT,"] }),
    ...entryLines({ species: "SPECIES_RAICHU", moves: ["MOVE_THUNDER"] }).map((line, index, lines) => (index === lines.length - 1 ? "\t}" : line)),
    "};",
    "#endif",
    "",
].join(CRLF);

// Static raid arrays, a raid partner table with rank ranges, and a size that does not follow its array
const RAID_PARTNERS =
[
    "#include \"../config.h\"",
    "",
    "#ifdef UNBOUND",
    "",
    "static const struct BattleTowerSpread sRaidPartnerSpread_Catherine_Rank12[] =",
    "{",
    ...entryLines({ species: "SPECIES_SYLVEON", moves: ["MOVE_HYPERVOICE,"] }),
    "};",
    "",
    "static const struct BattleTowerSpread sRaidPartnerSpread_Catherine_Rank3[] =",
    "{",
    ...entryLines({ species: "SPECIES_ESPEON", moves: ["MOVE_PSYCHIC,"] }),
    "};",
    "",
    "extern const u8 sTrainerName_Catherine[];",
    "",
    "const struct MultiRaidTrainer gRaidPartners[] =",
    "{",
    "\t{",
    "\t\t.name = sTrainerName_Catherine,",
    "\t\t.spreads =",
    "\t\t{",
    "\t\t\t[ONE_STAR_RAID ... TWO_STAR_RAID] = sRaidPartnerSpread_Catherine_Rank12,",
    "\t\t\t[THREE_STAR_RAID]                 = sRaidPartnerSpread_Catherine_Rank3,",
    "\t\t},",
    "\t\t.spreadSizes =",
    "\t\t{",
    "\t\t\t[ONE_STAR_RAID ... TWO_STAR_RAID] = NELEMS(sRaidPartnerSpread_Catherine_Rank12),",
    "\t\t\t[THREE_STAR_RAID]                 = 1,",
    "\t\t},",
    "\t},",
    "};",
    "",
    "#else",
    "const struct MultiRaidTrainer gRaidPartners[] = {0};",
    "#endif",
    "",
    "const u8 gNumRaidPartners = NELEMS(gRaidPartners);",
    "",
].join(CRLF);

const FRONTIER_TRAINERS =
[
    "#include \"../config.h\"",
    "#include \"frontier_special_trainer_spreads.h\"",
    "",
    "#ifdef UNBOUND",
    "const struct SpecialBattleFrontierTrainer gFrontierBrains[] =",
    "{",
    "\t[0] =",
    "\t\t{",
    "\t\t\t.name =\t\t\t\tsTrainerName_Palmer,",
    "\t\t\t.regularSpreads =\tgSpecialTowerSpread_Palmer1,",
    "\t\t\t.littleCupSpreads = gLittleCupTowerSpread_Palmer1,",
    "\t\t\t.regSpreadSize = \tNELEMS(gSpecialTowerSpread_Palmer1),",
    "\t\t\t.lcSpreadSize =\t\tNELEMS(gLittleCupTowerSpread_Palmer1),",
    "\t\t},",
    "};",
    "",
    "const struct MultiBattleTowerTrainer gFrontierMultiBattleTrainers[] =",
    "{",
    "\t{",
    "\t\t.name = sTrainerName_Milo,",
    "\t\t.regularSpreads = gMultiTowerSpread_Milo,",
    "\t\t.regSpreadSize = NELEMS(gMultiTowerSpread_Milo),",
    "\t},",
    "\t{",
    "\t\t.name = NULL, //Predefined ingame",
    "\t},",
    "};",
    "#endif",
    "",
].join(CRLF);

const CFRU_SOURCE_FILES =
{
    "src/config.h": CONFIG_UNBOUND,
    "src/Tables/battle_frontier_trainers.c": FRONTIER_TRAINERS,
    "src/Tables/battle_tower_spreads.h": BATTLE_TOWER_SPREADS,
    "src/Tables/frontier_special_trainer_spreads.h": SPECIAL_TRAINER_SPREADS,
    "src/Tables/frontier_multi_spreads.h": MULTI_SPREADS,
    "src/Tables/raid_partners.h": RAID_PARTNERS,
};
module.exports.CFRU_SOURCE_FILES = CFRU_SOURCE_FILES;
module.exports.CONFIG_VANILLA = CONFIG_VANILLA;
