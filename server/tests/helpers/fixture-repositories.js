/**
 * Builds disposable synthetic repositories for server tests.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const CLOUD_GAME_CONFIG =
`import SpeciesNames from "./data/SpeciesNames.json";
import CFRUBaseStats from "./data/cfru/BaseStats.json";
import CFRUMoves from "./data/cfru/Moves.json";
import CFRUItems from "./data/cfru/Items.json";
import CFRUBallTypes from "./data/cfru/BallTypes.json";
import ZetaBaseStats from "./data/zeta/BaseStats.json";
import ZetaMoves from "./data/zeta/Moves.json";
import ZetaItems from "./data/zeta/Items.json";
import ZetaBallTypes from "./data/zeta/BallTypes.json";
import AlphaBaseStats from "./data/alpha/BaseStats.json";
import AlphaMoves from "./data/alpha/Moves.json";
import AlphaItems from "./data/alpha/Items.json";
import AlphaBallTypes from "./data/alpha/BallTypes.json";
import MissingBaseStats from "./data/missing/BaseStats.json";

export const GAME_DISPLAY_NAMES =
{
    "zeta": "Zeta Version",
    "cfru": "Official Games",
    "alpha": "Alpha Version",
    "missing": "Missing Files",
    "unlisted": "Unlisted Data",
};

const GAME_IDS_TO_DATA =
{
    "cfru": { "baseStats": CFRUBaseStats, "moves": CFRUMoves, "items": CFRUItems, "ballTypes": CFRUBallTypes },
    "zeta": { "baseStats": ZetaBaseStats, "moves": ZetaMoves, "items": ZetaItems, "ballTypes": ZetaBallTypes },
    "alpha": { "baseStats": AlphaBaseStats, "moves": AlphaMoves, "items": AlphaItems, "ballTypes": AlphaBallTypes },
    "missing": { "baseStats": MissingBaseStats },
};

export function Render() { return <div />; }
`;

const REPOSITORY_FILES =
{
    cfru:
    {
        "src/config.h": "#define UNBOUND\n",
        "include/new/frontier.h": "struct BattleTowerSpread {};\n",
        "src/Tables/battle_frontier_trainers.c": "\n",
        "src/Tables/battle_moves.c": "\n",
        "src/Tables/battle_tower_spreads.h": "\n",
        "src/Tables/frontier_special_trainer_spreads.h": "\n",
        "src/Tables/frontier_multi_spreads.h": "\n",
        "src/Tables/raid_partners.h": "\n",
    },
    dpe:
    {
        "src/Learnsets.c": "\n",
        "src/Egg_Moves.c": "\n",
        "src/Evolution Table.c": "\n",
        "src/TM_Tutor_Tables.c": "\n",
        "src/tm_compatibility/1 - Focus Punch.txt": "TM01: Focus Punch\n",
        "src/tutor_compatibility/1 - Mega Punch.txt": "Tutor01: Mega Punch\n",
    },
    cloud:
    {
        ".env": "SECRET=do-not-read\n",
        "src/PokemonUtil.jsx": CLOUD_GAME_CONFIG,
        "src/Util.jsx": "export const BASE_GFX_LINK = \"\";\n",
        "src/data/SpeciesNames.json": "{\"SPECIES_BULBASAUR\": \"Bulbasaur\"}",
        "src/data/cfru/BaseStats.json": "{\"SPECIES_BULBASAUR\": {}, \"SPECIES_IVYSAUR\": {}}",
        "src/data/cfru/Moves.json": "{\"MOVE_POUND\": {}}",
        "src/data/cfru/Items.json": "\uFEFF{\"ITEM_NONE\": {}}",
        "src/data/cfru/BallTypes.json": "{\"BALL_TYPE_POKE_BALL\": 0}",
        "src/data/zeta/BaseStats.json": "{\"SPECIES_BULBASAUR\": {}}",
        "src/data/zeta/Moves.json": "{}",
        "src/data/zeta/Items.json": "{}",
        "src/data/zeta/BallTypes.json": "{}",
        "src/data/alpha/BaseStats.json": "[1, 2]",
        "src/data/alpha/Moves.json": "{}",
        "src/data/alpha/Items.json": "{}",
        "src/data/alpha/BallTypes.json": "{}",
    },
};

/**
 * Writes one synthetic repository.
 *
 * @param {string} root The repository folder.
 * @param {Object<string, string>} files Relative paths to contents.
 */
function writeRepository(root, files)
{
    for (const [relativePath, contents] of Object.entries(files))
    {
        const filePath = path.join(root, ...relativePath.split("/"));
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, contents);
    }
}

/**
 * Creates a temporary folder containing synthetic CFRU, DPE and Cloud repositories.
 *
 * @returns {{base: string, paths: {cfru: string, dpe: string, cloud: string}, cleanup: Function}}
 *          The folder, repository paths and a cleanup function.
 */
function createFixtureRepositories()
{
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "cfru-editor-test-"));
    const paths = {};

    for (const [kind, files] of Object.entries(REPOSITORY_FILES))
    {
        paths[kind] = path.join(base, `${kind} repo`);
        writeRepository(paths[kind], files);
    }

    return { base, paths, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}
module.exports.createFixtureRepositories = createFixtureRepositories;
