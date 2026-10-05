const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { StatusCode } = require("status-code-enum");

const { ApiError } = require("../middleware/errors");
const { getTypeIcon, getTypeSymbol } = require("./assets");
const { CACHE_DIRECTORY, getDataDirectory } = require("./parse-cache");

const TYPE_IMAGE_DIRECTORY = "type-images";
const TYPE_NAME_PATTERN = /^[a-z0-9-]+$/;
const TYPE_FILE_PATTERN = /^[a-z0-9-]+\.png$/;
const TYPE_VARIANTS = new Set(["symbol", "full"]);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_IMAGE_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 5000;
const RETRY_DELAY_MS = 5 * 60 * 1000;
const caches = new Map();


/**
 * Checks that downloaded or stored bytes contain a bounded PNG image.
 *
 * @param {Buffer} image The image bytes.
 * @returns {boolean} Whether the image is a PNG.
 */
function isPng(image)
{
    return image.length >= 24 && image.length <= MAX_IMAGE_BYTES
        && image.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
        && image.toString("ascii", 12, 16) === "IHDR";
}

/**
 * Creates a persistent cache for type symbols and full banners.
 *
 * @param {object} [options] Cache options.
 * @param {string} [options.directory] The cache directory.
 * @param {Function} [options.fetchResource] A fetch-compatible downloader.
 * @param {Function} [options.now] The current time in milliseconds.
 * @returns {{getUrl: Function, readImage: Function}} The cache.
 */
function createTypeImageCache(
{
    directory = path.join(getDataDirectory(), CACHE_DIRECTORY, TYPE_IMAGE_DIRECTORY),
    fetchResource = (url, options) => globalThis.fetch(url, options),
    now = () => Date.now(),
} = {})
{
    const pending = new Map();
    const failures = new Map();

    /**
     * Reads only a recognized cached type PNG, never an arbitrary file path.
     *
     * @param {string} variant The symbol or full variant.
     * @param {string} file The type PNG filename.
     * @returns {Promise<Buffer>} The image bytes.
     */
    async function readImage(variant, file)
    {
        if (TYPE_VARIANTS.has(variant) && typeof file === "string" && TYPE_FILE_PATTERN.test(file))
        {
            try
            {
                const image = await fs.promises.readFile(path.join(directory, variant, file));
                if (isPng(image))
                    return image;
            }
            catch {}
        }

        throw new ApiError(StatusCode.ClientErrorNotFound, "IMAGE_NOT_FOUND", "This image does not exist.");
    }

    /**
     * Downloads a missing image, preserving existing files and tolerating offline use.
     *
     * @param {string} variant The image variant.
     * @param {string} file The PNG filename.
     * @param {string} remoteUrl The trusted artwork URL.
     * @returns {Promise<boolean>} Whether the image is cached.
     */
    async function ensureImage(variant, file, remoteUrl)
    {
        const imagePath = path.join(directory, variant, file);
        let temporaryPath;
        try
        {
            await readImage(variant, file);
            return true;
        }
        catch {}

        const failedAt = failures.get(imagePath);
        if (failedAt != null && now() - failedAt < RETRY_DELAY_MS)
            return false;

        try
        {
            const response = await fetchResource(remoteUrl, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), headers: { Accept: "image/png" } });
            if (!response.ok || Number(response.headers?.get("content-length")) > MAX_IMAGE_BYTES)
                throw new Error("Type image could not be downloaded.");

            const image = Buffer.from(await response.arrayBuffer());
            if (!isPng(image))
                throw new Error("Type image is not a PNG.");

            await fs.promises.mkdir(path.dirname(imagePath), { recursive: true });
            temporaryPath = `${imagePath}.${crypto.randomBytes(4).toString("hex")}.tmp`;
            await fs.promises.writeFile(temporaryPath, image);
            await fs.promises.rename(temporaryPath, imagePath);
            failures.delete(imagePath);
            return true;
        }
        catch
        {
            failures.set(imagePath, now());
            if (temporaryPath != null)
                await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
            return false;
        }
    }

    /**
     * Returns a local URL after caching artwork, or the original URL if unavailable.
     *
     * @param {string} workspaceId The workspace serving the image.
     * @param {string} typeName The type's display name.
     * @param {object|null} index The PokeAPI index.
     * @param {string} variant The symbol or full variant.
     * @returns {Promise<string>} The image URL.
     */
    async function getUrl(workspaceId, typeName, index, variant)
    {
        const remoteUrl = variant === "full" ? getTypeIcon(typeName, index) : getTypeSymbol(typeName);
        const name = typeName.toLowerCase();
        if (!TYPE_VARIANTS.has(variant) || !TYPE_NAME_PATTERN.test(name))
            return remoteUrl;

        const file = `${name}.png`;
        const key = `${variant}/${file}`;
        if (!pending.has(key))
            pending.set(key, ensureImage(variant, file, remoteUrl).finally(() => pending.delete(key)));

        return await pending.get(key) ? `/api/images/${workspaceId}/types/${variant}/${file}` : remoteUrl;
    }

    return { getUrl, readImage };
}
module.exports.createTypeImageCache = createTypeImageCache;

/**
 * Returns the cache shared by catalogs and image routes for the editor's data folder.
 *
 * @returns {{getUrl: Function, readImage: Function}} The cache.
 */
function getTypeImageCache()
{
    const directory = path.join(getDataDirectory(), CACHE_DIRECTORY, TYPE_IMAGE_DIRECTORY);
    if (!caches.has(directory))
        caches.set(directory, createTypeImageCache({ directory }));
    return caches.get(directory);
}
module.exports.getTypeImageCache = getTypeImageCache;
