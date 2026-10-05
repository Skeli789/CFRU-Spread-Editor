/**
 * Smogon sets and analyses from data.pkmn.cc, read through @pkmn/smogon. Every downloaded file is kept in the editor's
 * data folder, so sets stay available offline and an outage falls back to the saved copy.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { isDeepStrictEqual } = require("util");
const { Smogon } = require("@pkmn/smogon");
const { Dex } = require("@pkmn/dex");
const { Generations } = require("@pkmn/data");
const { StatusCode } = require("status-code-enum");
const { ApiError } = require("../middleware/errors");
const { CACHE_DIRECTORY, getDataDirectory } = require("./parse-cache");
const { PROGRESS_LABELS } = require("./progress");

const BASE_URL = "https://data.pkmn.cc";
const PENDING_PROGRESS_LIMIT = 99;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
module.exports.MAX_AGE_MS = MAX_AGE_MS;
const RETRY_DELAY_MS = 5 * 60 * 1000;
module.exports.RETRY_DELAY_MS = RETRY_DELAY_MS;
const REQUEST_TIMEOUT_MS = 10 * 1000;
const MAX_RESPONSE_LENGTH = 32 * 1024 * 1024;
module.exports.MAX_RESPONSE_LENGTH = MAX_RESPONSE_LENGTH;
const CACHE_FORMAT = 1;
const RESOURCE_PATTERN = /^\/(sets|analyses)\/[a-z0-9]+\.json$/;
const FORMAT_PATTERN = /^(champions|gen[6-9])([a-z0-9]+)$/;
const VGC_PATTERN = /^vgc\d{4}$/;
const TABS = ["champions", "gen9", "gen8", "gen7", "gen6"];
const TIERS =
{
    nationaldex: { category: "singles", label: "National Dex" },
    nationaldexubers: { category: "singles", label: "National Dex Ubers" },
    nationaldexuu: { category: "singles", label: "National Dex UU" },
    nationaldexru: { category: "singles", label: "National Dex RU" },
    anythinggoes: { category: "singles", label: "AG" },
    ubers: { category: "singles", label: "Ubers" },
    ou: { category: "singles", label: "OU" },
    battlestadiumsingles: { category: "singles", label: "Battle Stadium Singles" },
    battlespotsingles: { category: "singles", label: "Battle Spot Singles" },
    ubersuu: { category: "singles", label: "Ubers UU" },
    uubl: { category: "singles", label: "UUBL" },
    uu: { category: "singles", label: "UU" },
    rubl: { category: "singles", label: "RUBL" },
    ru: { category: "singles", label: "RU" },
    nubl: { category: "singles", label: "NUBL" },
    nu: { category: "singles", label: "NU" },
    publ: { category: "singles", label: "PUBL" },
    pu: { category: "singles", label: "PU" },
    zubl: { category: "singles", label: "ZUBL" },
    zu: { category: "singles", label: "ZU" },
    nfe: { category: "singles", label: "NFE" },
    lc: { category: "singles", label: "LC" },
    nationaldexdoubles: { category: "doubles", label: "National Dex Doubles" },
    doublesubers: { category: "doubles", label: "Doubles Ubers" },
    doublesou: { category: "doubles", label: "Doubles OU" },
    battlestadiumdoubles: { category: "doubles", label: "Battle Stadium Doubles" },
    battlespotdoubles: { category: "doubles", label: "Battle Spot Doubles" },
    vgc: { category: "doubles", label: "VGC" },
    doublesuu: { category: "doubles", label: "Doubles UU" },
    doublesnu: { category: "doubles", label: "Doubles NU" },
    doubleslc: { category: "doubles", label: "Doubles LC" },
};
const TIER_ORDER = Object.keys(TIERS);
const MOVESET_FIELDS = ["moves", "ability", "item", "nature", "evs", "ivs"];
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const generations = new Generations(Dex, () => true);
let source = null;


/**
 * Validates and normalizes the library's resource URLs.
 *
 * @param {string} value The requested URL.
 * @returns {URL} The allowed, normalized URL.
 */
function normalizeSmogonUrl(value)
{
    const url = new URL(value);
    url.pathname = url.pathname.replace(/\/{2,}/g, "/");
    if (url.protocol !== "https:" || url.host !== "data.pkmn.cc" || url.username || url.password || url.search || url.hash || !RESOURCE_PATTERN.test(url.pathname))
        throw new Error("Invalid Smogon resource URL.");
    return url;
}
module.exports.normalizeSmogonUrl = normalizeSmogonUrl;

/**
 * Converts analysis markup to plain text without sending HTML to the browser.
 *
 * @param {string|null} html The description markup.
 * @returns {string|null} The decoded description, or null when empty.
 */
function htmlToText(html)
{
    if (typeof html !== "string")
        return null;
    const text = html.replace(/<li\b[^>]*>/gi, "\n\u2022 ")
        .replace(/<\/(?:p|h3|h4|ul)\s*>|<br\b[^>]*>/gi, "\n")
        .replace(/<[^>]*>/g, "")
        .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code) =>
        {
            if (!code.startsWith("#"))
                return ENTITIES[code.toLowerCase()];
            const value = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
            return value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : "\ufffd";
        })
        .replace(/\r\n?/g, "\n").replace(/[^\S\n]+/g, " ")
        .replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    return text || null;
}
module.exports.htmlToText = htmlToText;

/**
 * Discovers supported formats in display order.
 *
 * @param {object} index The sets index.
 * @returns {object[]} Format descriptors.
 */
function discoverFormats(index)
{
    return Object.keys(index).flatMap((key) =>
    {
        const id = key.replace(/\.json$/, "");
        const match = FORMAT_PATTERN.exec(id);
        if (!match)
            return [];
        const [, tab, type] = match;
        const tier = VGC_PATTERN.test(type) ? "vgc" : type;
        if (!Object.hasOwn(TIERS, tier) || type === "vgc")
            return [];
        const { category, label } = TIERS[tier];
        return [{ id, tab, category, label: tier === "vgc" ? `VGC ${type.slice(3)}` : label }];
    }).sort((left, right) =>
    {
        const leftType = left.id.slice(left.tab.length);
        const rightType = right.id.slice(right.tab.length);
        return TABS.indexOf(left.tab) - TABS.indexOf(right.tab)
            || TIER_ORDER.indexOf(VGC_PATTERN.test(leftType) ? "vgc" : leftType) - TIER_ORDER.indexOf(VGC_PATTERN.test(rightType) ? "vgc" : rightType)
            || rightType.localeCompare(leftType);
    });
}

/**
 * Creates a disk-backed Smogon source with injectable network, clock and storage.
 *
 * @param {object} [options] Source dependencies.
 * @param {string} [options.directory] The cache directory.
 * @param {Function} [options.fetchResource] Fetch-compatible downloader.
 * @param {Function} [options.now] Current time in milliseconds.
 * @param {object} [options.fileSystem] An fs.promises-compatible object.
 * @returns {{getSets: Function}} The set source.
 */
function createSmogonSource(
{
    directory = path.join(getDataDirectory(), CACHE_DIRECTORY, "smogon"),
    fetchResource = globalThis.fetch,
    now = Date.now,
    fileSystem = fs.promises,
} = {})
{
    const current = new Map();
    const pending = new Map();
    const failures = new Map();
    let revision = 0;
    let smogon = null;
    let instanceAt = null;
    let instanceRevision = null;

    /**
     * Reads a valid cached resource envelope.
     *
     * @param {string} filename The cache file.
     * @returns {Promise<object|null>} Stored metadata and data.
     */
    async function readStored(filename)
    {
        try
        {
            const stored = JSON.parse(await fileSystem.readFile(filename, "utf8"));
            return stored?.format === CACHE_FORMAT && Number.isFinite(stored.fetchedAt) && stored.data != null && typeof stored.data === "object" ? stored : null;
        }
        catch
        {
            return null;
        }
    }

    /**
     * Downloads JSON with a bounded streamed response.
     *
     * @param {string} url The normalized resource URL.
     * @returns {Promise<object>} Validated JSON.
     */
    async function download(url)
    {
        const response = await fetchResource(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), headers: { Accept: "application/json" } });
        if (!response.ok)
            throw new Error(`Smogon returned ${response.status}.`);
        if (Number(response.headers?.get("content-length")) > MAX_RESPONSE_LENGTH)
            throw new Error("Smogon returned more data than expected.");
        let text;
        if (response.body?.getReader)
        {
            const reader = response.body.getReader();
            const chunks = [];
            let length = 0;
            try
            {
                while (true)
                {
                    const { done, value } = await reader.read();
                    if (done)
                        break;
                    length += value.byteLength;
                    if (length > MAX_RESPONSE_LENGTH)
                    {
                        await reader.cancel();
                        throw new Error("Smogon returned more data than expected.");
                    }
                    chunks.push(Buffer.from(value));
                }
                text = Buffer.concat(chunks).toString("utf8");
            }
            finally
            {
                reader.releaseLock();
            }
        }
        else
            text = await response.text();
        if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_LENGTH)
            throw new Error("Smogon returned more data than expected.");
        const data = JSON.parse(text);
        if (data == null || typeof data !== "object" || Array.isArray(data))
            throw new Error("Smogon returned unexpected JSON.");
        return data;
    }

    /**
     * Refreshes one resource, retaining stale data during outages.
     *
     * @param {URL} url The validated resource.
     * @returns {Promise<object>} Cache metadata and data.
     */
    async function load(url)
    {
        const key = url.pathname;
        const filename = path.join(directory, ...key.slice(1).split("/"));
        const stored = current.get(key) ?? await readStored(filename);
        if (stored && now() - stored.fetchedAt < MAX_AGE_MS)
        {
            current.set(key, stored);
            return stored;
        }
        const failed = failures.get(key);
        if (failed && now() - failed.at < RETRY_DELAY_MS)
        {
            if (stored)
                return stored;
            throw failed.error;
        }

        // Resource files are replaced atomically so interrupted downloads keep the old copy.
        let temporaryPath;
        try
        {
            const data = await download(url.href);
            const entry = { format: CACHE_FORMAT, fetchedAt: now(), data };
            temporaryPath = `${filename}.${crypto.randomBytes(8).toString("hex")}.tmp`;
            await fileSystem.mkdir(path.dirname(filename), { recursive: true });
            await fileSystem.writeFile(temporaryPath, JSON.stringify(entry));
            await fileSystem.rename(temporaryPath, filename);
            current.set(key, entry);
            failures.delete(key);
            revision++;
            return entry;
        }
        catch (error)
        {
            if (temporaryPath)
                await fileSystem.rm(temporaryPath, { force: true }).catch(() => {});
            failures.set(key, { at: now(), error });
            if (stored)
            {
                current.set(key, stored);
                return stored;
            }
            throw error;
        }
    }

    /**
     * Deduplicates loads and returns the response interface expected by Smogon.
     *
     * @param {string} value The requested URL.
     * @returns {Promise<object>} JSON response and stale metadata.
     */
    async function cachedFetch(value)
    {
        const url = normalizeSmogonUrl(value);
        if (!pending.has(url.pathname))
            pending.set(url.pathname, load(url).finally(() => pending.delete(url.pathname)));
        const stored = await pending.get(url.pathname);
        return { json: async () => stored.data, stale: now() - stored.fetchedAt >= MAX_AGE_MS };
    }

    /**
     * Returns raw sets for supported formats, tolerating individual unavailable files.
     *
     * @param {string[]} names Species names to query.
     * @param {object} [options] Optional request tracking.
     * @param {object} [options.progress] Progress handle receiving completed format counts.
     * @returns {Promise<object>} Formats, sets, stale status and unavailable format IDs.
     */
    async function getSets(names, { progress } = {})
    {
        progress?.update({ percentage: 0, label: PROGRESS_LABELS.listing });
        let index;
        try
        {
            index = await cachedFetch(`${BASE_URL}/sets/index.json`);
        }
        catch
        {
            throw new ApiError(StatusCode.ServerErrorServiceUnavailable, "SMOGON_UNAVAILABLE", "Smogon sets need an internet connection the first time.");
        }
        const formats = discoverFormats(await index.json());
        const result = { formats, sets: [], stale: index.stale, unavailable: [] };
        const seen = new Map();
        const displayed = new Set();
        let completedFormats = 0;

        /**
         * Reports formats whose resource loading and set parsing have finished.
         *
         * @returns {void} Nothing.
         */
        function reportFormatProgress()
        {
            progress?.update({ percentage: formats.length ? completedFormats / formats.length * PENDING_PROGRESS_LIMIT : 0,
                label: PROGRESS_LABELS.reading });
        }
        reportFormatProgress();

        // Refresh resources before using the library's otherwise permanent memory cache.
        for (const format of formats)
        {
            const resources = await Promise.allSettled(["sets", "analyses"].map((type) => cachedFetch(`${BASE_URL}/${type}/${format.id}.json`)));
            for (const resource of resources)
            {
                if (resource.status === "fulfilled")
                    result.stale ||= resource.value.stale;
            }
            if (resources[0].status === "rejected")
            {
                result.unavailable.push(format.id);
                completedFormats++;
                reportFormatProgress();
                continue;
            }
            if (!smogon || now() - instanceAt >= MAX_AGE_MS || instanceRevision !== revision)
            {
                smogon = new Smogon(cachedFetch, true);
                instanceAt = now();
                instanceRevision = revision;
            }
            const library = smogon;
            const gen = generations.get(format.tab === "champions" ? 9 : Number(format.tab.slice(3)));
            for (const species of names)
            {
                const queriedSpecies = gen.species.get(species);
                if (!queriedSpecies)
                    continue;
                const analyses = resources[1].status === "fulfilled" ? await library.analyses(gen, species, format.id) : [];
                const entries = analyses.flatMap((analysis) => Object.entries(analysis.sets));
                const analyzed = new Set(entries.map(([name]) => name));
                for (const set of await library.sets(gen, species, format.id))
                {
                    if (!analyzed.has(set.name))
                        entries.push([set.name, set]);
                }
                for (const [name, set] of entries)
                {
                    const key = `${format.id}\0${name}`;
                    const moveset = Object.fromEntries(MOVESET_FIELDS.map((field) => [field, set[field] ?? null]));
                    const previous = seen.get(key) ?? [];
                    if (previous.some((entry) => entry.species === species || isDeepStrictEqual(entry.moveset, moveset)))
                        continue;
                    const suffix = queriedSpecies.name.slice(queriedSpecies.baseSpecies.length).replace(/-/g, " ").trim();
                    const displayName = previous.length && suffix ? `${name} (${suffix})` : name;
                    const displayKey = `${format.id}\0${displayName}`;
                    if (displayed.has(displayKey))
                        continue;
                    displayed.add(displayKey);
                    previous.push({ species, moveset });
                    seen.set(key, previous);
                    result.sets.push({ format: format.id, species, name: displayName, description: htmlToText(set.description), moveset });
                }
            }
            completedFormats++;
            reportFormatProgress();
        }
        return result;
    }

    return { getSets };
}
module.exports.createSmogonSource = createSmogonSource;

/**
 * Returns the lazily constructed default source.
 *
 * @returns {{getSets: Function}} The active source.
 */
function getSmogonSource()
{
    source ??= createSmogonSource();
    return source;
}
module.exports.getSmogonSource = getSmogonSource;

/**
 * Replaces the default source for tests, or resets it for lazy construction.
 *
 * @param {object|null} [replacement] The replacement source.
 * @returns {void} Nothing.
 */
function setSmogonSource(replacement = null)
{
    source = replacement;
}
module.exports.setSmogonSource = setSmogonSource;
