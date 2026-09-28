/**
 * PokeAPI's name-to-ID index, which sprite URLs need because PokeAPI files are named by its own IDs.
 * The index is downloaded once and kept in the editor's data folder; without it sprites fall back to
 * Pokedex numbers, so a missing connection never blocks editing.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { CACHE_DIRECTORY, getDataDirectory } = require("./parse-cache");

const POKEMON_LIST_URL = "https://pokeapi.co/api/v2/pokemon?limit=100000&offset=0";
const TYPE_LIST_URL = "https://pokeapi.co/api/v2/type?limit=1000&offset=0";
const INDEX_FILE = "pokeapi-index.json";
const TEMP_SUFFIX = ".tmp";
const INDEX_FORMAT = 1;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const RETRY_DELAY_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10 * 1000;
const MAX_RESPONSE_LENGTH = 4 * 1024 * 1024;
const NAME_PATTERN = /^[a-z0-9-]+$/;
const RESOURCE_ID_PATTERN = /\/(\d+)\/?$/;


/**
 * Creates a PokeAPI index loader.
 *
 * @param {object} [options] Loader options.
 * @param {string} [options.directory] The folder the index is kept in.
 * @param {Function} [options.fetchResource] A fetch-compatible function.
 * @param {Function} [options.now] Returns the current time in milliseconds.
 * @param {object} [options.fileSystem] An fs.promises-compatible object.
 * @returns {{getIndex: Function}} The loader, whose getIndex returns {pokemon, types} name-to-ID maps or null.
 */
function createPokeApiIndex(
{
    directory = path.join(getDataDirectory(), CACHE_DIRECTORY),
    fetchResource = (url, options) => globalThis.fetch(url, options),
    now = () => Date.now(),
    fileSystem = fs.promises,
} = {})
{
    const indexPath = path.join(directory, INDEX_FILE);
    let current = null;
    let pending = null;
    let failedAt = null;

    /**
     * Downloads one of PokeAPI's resource lists.
     *
     * @param {string} url The list URL.
     * @returns {Promise<Object<string, number>>} Resource names to IDs.
     */
    async function readList(url)
    {
        const response = await fetchResource(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), headers: { Accept: "application/json" } });
        if (!response.ok)
            throw new Error(`PokeAPI returned ${response.status}.`);

        const text = await response.text();
        if (text.length > MAX_RESPONSE_LENGTH)
            throw new Error("PokeAPI returned more data than expected.");

        const results = JSON.parse(text)?.results;
        if (!Array.isArray(results))
            throw new Error("PokeAPI returned an unexpected list.");

        // Only plain names and numeric IDs are kept, since they end up in URLs
        const ids = {};
        for (const result of results)
        {
            const id = typeof result?.url === "string" ? RESOURCE_ID_PATTERN.exec(result.url)?.[1] : null;
            if (typeof result?.name === "string" && NAME_PATTERN.test(result.name) && id != null)
                ids[result.name] = Number(id);
        }

        return ids;
    }

    /**
     * Reads the stored index.
     *
     * @returns {Promise<object|null>} The index, or null if there is none.
     */
    async function readStored()
    {
        try
        {
            const stored = JSON.parse(await fileSystem.readFile(indexPath, "utf8"));
            return stored?.format === INDEX_FORMAT ? stored : null;
        }
        catch
        {
            return null;
        }
    }

    /**
     * Stores the index. Failures only mean it is downloaded again next time.
     *
     * @param {object} index The index.
     */
    async function store(index)
    {
        const temporaryPath = `${indexPath}.${crypto.randomBytes(4).toString("hex")}${TEMP_SUFFIX}`;
        try
        {
            await fileSystem.mkdir(directory, { recursive: true });
            await fileSystem.writeFile(temporaryPath, JSON.stringify(index));
            await fileSystem.rename(temporaryPath, indexPath);
        }
        catch
        {
            await fileSystem.rm(temporaryPath, { force: true }).catch(() => {});
        }
    }

    /**
     * Returns the stored index while it is recent, otherwise downloads a new one, keeping an old one if that fails.
     *
     * @returns {Promise<object|null>} The index.
     */
    async function load()
    {
        const stored = current ?? await readStored();
        if (stored != null && now() - stored.fetchedAt < MAX_AGE_MS)
            return stored;

        // Offline use should not wait for a timeout on every catalog load
        if (failedAt != null && now() - failedAt < RETRY_DELAY_MS)
            return stored;

        try
        {
            const [pokemon, types] = await Promise.all([readList(POKEMON_LIST_URL), readList(TYPE_LIST_URL)]);
            const index = { format: INDEX_FORMAT, fetchedAt: now(), pokemon, types };
            await store(index);
            failedAt = null;
            return index;
        }
        catch
        {
            failedAt = now();
            return stored;
        }
    }

    /**
     * Returns the index, loading it at most once at a time.
     *
     * @returns {Promise<{pokemon: Object<string, number>, types: Object<string, number>}|null>} The index, or null.
     */
    function getIndex()
    {
        if (pending == null)
            pending = load().then((index) => { current = index; return index; }).finally(() => { pending = null; });

        return pending;
    }

    return { getIndex };
}
module.exports.createPokeApiIndex = createPokeApiIndex;
