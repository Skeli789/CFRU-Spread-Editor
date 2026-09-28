/**
 * Game catalog loading from the selected Unbound Cloud game's data files.
 */

const { StatusCode } = require("status-code-enum");

const { ApiError } = require("../middleware/errors");
const { REPOSITORY_CLOUD, readOwnedFile } = require("./repositories");


/**
 * Parses a Cloud data file and checks that it is a JSON object.
 *
 * @param {string} contents The file contents.
 * @param {string} relativePath The file path, for errors.
 * @returns {object} The parsed data.
 */
function parseDataObject(contents, relativePath)
{
    // Cloud's JSON files may start with a byte order mark
    let data;
    try
    {
        data = JSON.parse(contents.replace(/^\uFEFF/, ""));
    }
    catch
    {
        throw new ApiError(StatusCode.ClientErrorUnprocessableEntity, "CATALOG_INVALID", `${relativePath} is not valid JSON.`, { file: relativePath });
    }

    // Every game data file is keyed by constant name
    if (data === null || typeof data !== "object" || Array.isArray(data))
        throw new ApiError(StatusCode.ClientErrorUnprocessableEntity, "CATALOG_INVALID", `${relativePath} does not contain the expected data.`, { file: relativePath });

    return data;
}

/**
 * Returns one of the workspace's games.
 *
 * @param {object} workspace The workspace.
 * @param {*} gameId The requested game ID.
 * @returns {object} The game.
 */
function getGame(workspace, gameId)
{
    // Only games found when the workspace loaded can be opened
    const game = typeof gameId === "string" ? workspace.games.get(gameId) : undefined;
    if (game == null)
        throw new ApiError(StatusCode.ClientErrorNotFound, "GAME_NOT_FOUND", "This game is not available in the loaded Unbound Cloud repository.");

    return game;
}

/**
 * Reads one of a game's data files.
 *
 * @param {object} workspace The workspace.
 * @param {*} gameId The game ID.
 * @param {string} key The data key, such as baseStats.
 * @returns {Promise<object>} The parsed data.
 */
async function readGameData(workspace, gameId, key)
{
    const relativePath = getGame(workspace, gameId).dataFiles[key];
    return parseDataObject(await readOwnedFile(workspace, REPOSITORY_CLOUD, relativePath), relativePath);
}
module.exports.readGameData = readGameData;

/**
 * Loads the catalog for one of the workspace's games.
 *
 * @param {object} workspace The workspace.
 * @param {*} gameId The requested game ID.
 * @returns {Promise<{gameId: string, name: string, entryCounts: Object<string, number>}>} The catalog summary.
 */
async function loadGameCatalog(workspace, gameId)
{
    const game = getGame(workspace, gameId);

    // Read and check each of the game's data files
    const entryCounts = {};
    for (const [key, relativePath] of Object.entries(game.dataFiles))
    {
        const data = parseDataObject(await readOwnedFile(workspace, REPOSITORY_CLOUD, relativePath), relativePath);
        entryCounts[key] = Object.keys(data).length;
    }

    return { gameId: game.id, name: game.name, entryCounts };
}
module.exports.loadGameCatalog = loadGameCatalog;
