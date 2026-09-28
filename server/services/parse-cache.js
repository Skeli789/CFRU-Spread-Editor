/**
 * A disk cache for parsed repository files, kept in the editor's data folder outside every repository.
 * Each cached result lives in its own slot, such as one per source file, and is reused only when every
 * input it was built from (file contents, configuration and the parser code itself) is unchanged.
 */

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const DATA_DIRECTORY_ENV = "SPREAD_EDITOR_DATA_DIR";
const DATA_DIRECTORY_NAME = "CFRU Spread Editor";
const HIDDEN_DATA_DIRECTORY_NAME = ".cfru-spread-editor";
const CACHE_DIRECTORY = "cache";
module.exports.CACHE_DIRECTORY = CACHE_DIRECTORY;
const CACHE_EXTENSION = ".json";
const TEMP_SUFFIX = ".tmp";
const HASH_ALGORITHM = "sha256";

// Bump when the layout of cache files changes
const CACHE_FORMAT = 1;
const NAMESPACE_PATTERN = /^[a-z][a-z0-9-]*$/;

// The parser code and native grammars that shape every cached result
const PARSER_MODULES = ["./preprocessor", "./spread-parser", "./source-parser"];
const PARSER_PACKAGES = ["@ast-grep/napi/package.json", "@ast-grep/lang-c/package.json"];

let parserVersion = null;


/**
 * Returns the folder where backups, save journals and the cache are kept, outside every repository.
 *
 * @returns {string} The folder.
 */
function getDataDirectory()
{
    if (process.env[DATA_DIRECTORY_ENV])
        return process.env[DATA_DIRECTORY_ENV];
    if (process.env.LOCALAPPDATA)
        return path.join(process.env.LOCALAPPDATA, DATA_DIRECTORY_NAME);

    return path.join(os.homedir(), HIDDEN_DATA_DIRECTORY_NAME);
}
module.exports.getDataDirectory = getDataDirectory;

/**
 * Returns the hash of some text or bytes.
 *
 * @param {string|Buffer} contents The contents.
 * @returns {string} The hex digest.
 */
function hash(contents)
{
    return crypto.createHash(HASH_ALGORITHM).update(contents).digest("hex");
}
module.exports.hash = hash;

/**
 * Returns a version identifying the parser code, so updating the editor invalidates old results.
 *
 * @returns {string} The version.
 */
function getParserVersion()
{
    if (parserVersion == null)
    {
        const sources = [...PARSER_MODULES.map((name) => require.resolve(name)), ...PARSER_PACKAGES.map((name) => require.resolve(name))];
        parserVersion = hash(sources.map((file) => fs.readFileSync(file)).join("\0"));
    }

    return parserVersion;
}
module.exports.getParserVersion = getParserVersion;

/**
 * Returns a hash of preprocessor macros, ignoring where they were defined so comment edits do not count.
 *
 * @param {Map<string, {body: string, functionLike: boolean}>} macros The macros.
 * @returns {string} The hash.
 */
function hashMacros(macros)
{
    const entries = [...macros].map(([name, { body, functionLike }]) => [name, body, functionLike]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return hash(JSON.stringify(entries));
}
module.exports.hashMacros = hashMacros;

/**
 * Creates a parse cache.
 *
 * @param {object} [options] Cache options.
 * @param {string} [options.directory] The cache folder.
 * @param {object} [options.fileSystem] An fs.promises-compatible object.
 * @returns {{getOrCreate: Function, set: Function}} The cache.
 */
function createParseCache({ directory = path.join(getDataDirectory(), CACHE_DIRECTORY), fileSystem = fs.promises } = {})
{
    /**
     * Returns the file holding a slot.
     *
     * @param {string} namespace The kind of result, such as spread-file.
     * @param {string} slot What the result is for, such as a file in a repository.
     * @returns {string} The path.
     */
    function getSlotPath(namespace, slot)
    {
        if (!NAMESPACE_PATTERN.test(namespace))
            throw new Error(`Invalid cache namespace ${namespace}.`);

        return path.join(directory, namespace, hash(slot) + CACHE_EXTENSION);
    }

    /**
     * Stores a result in a slot, replacing what was there. Failures only mean the next load parses again.
     *
     * @param {string} namespace The kind of result.
     * @param {string} slot What the result is for.
     * @param {Array<*>} inputs Everything the result depends on.
     * @param {*} value The JSON-serializable result.
     */
    async function set(namespace, slot, inputs, value)
    {
        const slotPath = getSlotPath(namespace, slot);
        const temporaryPath = `${slotPath}.${crypto.randomBytes(4).toString("hex")}${TEMP_SUFFIX}`;
        try
        {
            await fileSystem.mkdir(path.dirname(slotPath), { recursive: true });
            await fileSystem.writeFile(temporaryPath, JSON.stringify({ key: hash(JSON.stringify([CACHE_FORMAT, ...inputs])), value }));
            await fileSystem.rename(temporaryPath, slotPath);
        }
        catch
        {
            await fileSystem.rm(temporaryPath, { force: true }).catch(() => {});
        }
    }

    /**
     * Returns a slot's result when its inputs are unchanged, otherwise creates and stores a new one.
     *
     * @param {string} namespace The kind of result.
     * @param {string} slot What the result is for.
     * @param {Array<*>} inputs Everything the result depends on.
     * @param {Function} create Builds the result when the cache cannot be used.
     * @returns {Promise<*>} The result.
     */
    async function getOrCreate(namespace, slot, inputs, create)
    {
        // A missing, unreadable or outdated slot is simply rebuilt
        const key = hash(JSON.stringify([CACHE_FORMAT, ...inputs]));
        try
        {
            const cached = JSON.parse(await fileSystem.readFile(getSlotPath(namespace, slot), "utf8"));
            if (cached?.key === key)
                return cached.value;
        }
        catch
        {
            // Fall through to rebuilding
        }

        const value = await create();
        await set(namespace, slot, inputs, value);
        return value;
    }

    return { getOrCreate, set };
}
module.exports.createParseCache = createParseCache;
