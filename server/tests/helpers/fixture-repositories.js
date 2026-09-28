/**
 * Builds disposable synthetic repositories for server tests.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const { BATTLE_MOVES, CLOUD_FILES, DPE_FILES } = require("./catalog-fixtures");
const { CFRU_SOURCE_FILES } = require("./spread-fixtures");

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

const SPECIES_FORMS_ICON_NAMES =
{
    "SPECIES_LYCANROC_N": "lycanroc-midnight",
};

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
        ...CFRU_SOURCE_FILES,
        "include/new/frontier.h": "struct BattleTowerSpread {};\n",
        "src/Tables/battle_moves.c": BATTLE_MOVES,
    },
    dpe: DPE_FILES,
    cloud:
    {
        ...CLOUD_FILES,
        ".env": "SECRET=do-not-read\n",
        "src/PokemonUtil.jsx": CLOUD_GAME_CONFIG,
        "src/Util.jsx": "export const BASE_GFX_LINK = \"\";\n",
        "src/data/zeta/BaseStats.json": JSON.stringify(
        {
            SPECIES_BULBASAUR: {},
            SPECIES_VENUSAUR: { ability1: "ABILITY_OVERGROW", ability2: "ABILITY_THICKFAT", hiddenAbility: "ABILITY_CHLOROPHYLL" },
        }),
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
