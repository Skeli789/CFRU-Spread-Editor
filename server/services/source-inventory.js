/**
 * The archive inventory shares the exact source constants used by repository readers.
 */

const { CLOUD_IMAGE_FOLDERS } = require("./assets");
const { CFRU_ITEM_TABLES_FILE, CFRU_MOVES_FILE, CLOUD_SHARED_FILES } = require("./catalog");
const { DPE_COMPATIBILITY_DIRECTORIES, DPE_CONFIG_FILE, DPE_SOURCE_FILES } = require("./learnsets");
const
{
    CLOUD_GAME_CONFIG_FILE, REPOSITORY_KINDS, REPOSITORY_SENTINELS,
    listOwnedFiles, readOwnedFile, resolveCloudDataSpecifier,
} = require("./repositories");
const { parseCloudGameConfig } = require("./source-parser");
const { GRAPHICS_FOLDERS, SPRITE_TABLES } = require("./sprites");

const SOURCE_FOLDERS =
[
    ...DPE_COMPATIBILITY_DIRECTORIES.map((directory) => ({ kind: "dpe", directory, pattern: /^[^/]+\.txt$/i })),
    ...GRAPHICS_FOLDERS.map((directory) => ({ kind: "dpe", directory, pattern: /^[^/]+\.png$/i })),
    ...Object.values(CLOUD_IMAGE_FOLDERS).map((directory) => ({ kind: "cloud", directory, pattern: /^[A-Za-z0-9_-]+\.png$/ })),
];


/**
 * Builds a strict file and directory allowlist from static readers and literal game imports.
 *
 * @param {string} cloudConfig The Cloud game declarations, never executed.
 * @returns {{files: Set<string>, directories: Set<string>, folders: Array<object>}} Allowed sources.
 */
function createSourceInventory(cloudConfig)
{
    const files = new Set();
    const directories = new Set(REPOSITORY_KINDS);
    for (const kind of REPOSITORY_KINDS)
    {
        for (const sentinel of REPOSITORY_SENTINELS[kind])
            (sentinel.type === "directory" ? directories : files).add(`${kind}/${sentinel.path}`);
    }

    for (const file of [CFRU_MOVES_FILE, CFRU_ITEM_TABLES_FILE])
        files.add(`cfru/${file}`);
    for (const file of [DPE_CONFIG_FILE, ...DPE_SOURCE_FILES, ...Object.values(SPRITE_TABLES).map((table) => table.file)])
        files.add(`dpe/${file}`);
    for (const file of Object.values(CLOUD_SHARED_FILES))
        files.add(`cloud/${file}`);

    // Include existing imports even for partially unavailable declared games.
    for (const game of parseCloudGameConfig(cloudConfig).games)
    {
        for (const specifier of Object.values(game.dataImports ?? {}))
        {
            const file = resolveCloudDataSpecifier(specifier);
            if (file != null)
                files.add(`cloud/${file}`);
        }
    }

    for (const { kind, directory } of SOURCE_FOLDERS)
        directories.add(`${kind}/${directory}`);
    for (const entry of [...files, ...directories])
    {
        const components = entry.split("/");
        while (components.length > 1)
        {
            components.pop();
            directories.add(components.join("/"));
        }
    }

    return { files, directories, folders: SOURCE_FOLDERS };
}
module.exports.createSourceInventory = createSourceInventory;

/**
 * Returns whether a file is an exact source or a supported immediate folder child.
 *
 * @param {object} inventory The source allowlist.
 * @param {string} name The root-prefixed file name.
 * @returns {boolean} Whether the editor can read the file.
 */
function isInventoryFile(inventory, name)
{
    return inventory.files.has(name) || inventory.folders.some(({ kind, directory, pattern }) =>
        name.startsWith(`${kind}/${directory}/`) && pattern.test(name.slice(`${kind}/${directory}/`.length)));
}
module.exports.isInventoryFile = isInventoryFile;

/**
 * Lists exact sources and folder children using repository-owned reads.
 *
 * @param {object} workspace The loaded workspace.
 * @returns {Promise<object>} The inventory with discovered files.
 */
async function listArchiveSources(workspace)
{
    const inventory = createSourceInventory(await readOwnedFile(workspace, "cloud", CLOUD_GAME_CONFIG_FILE));
    for (const { kind, directory, pattern } of inventory.folders)
    {
        for (const name of await listOwnedFiles(workspace, kind, directory))
        {
            if (pattern.test(name))
                inventory.files.add(`${kind}/${directory}/${name}`);
        }
    }

    return inventory;
}
module.exports.listArchiveSources = listArchiveSources;
