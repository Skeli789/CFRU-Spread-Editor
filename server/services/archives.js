/**
 * Bounded source-only ZIP exchange with private, persistent imported repository roots.
 */

const AdmZip = require("adm-zip");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { StatusCode } = require("status-code-enum");

const { ApiError } = require("../middleware/errors");
const { validateCatalogData } = require("./catalog");
const { getDataDirectory } = require("./parse-cache");
const
{
    CLOUD_GAME_CONFIG_FILE, REPOSITORY_KINDS, REPOSITORY_SENTINELS,
    forgetWorkspace, getWorkspace, loadWorkspace, readOwnedBuffer,
} = require("./repositories");
const { createSourceInventory, isInventoryFile, listArchiveSources } = require("./source-inventory");
const { loadSpreads } = require("./spread-store");
const { PROGRESS_LABELS } = require("./progress");

const ARCHIVE_FILENAME = "spread-editor-reqs.zip";
const ARCHIVE_CONTENT_TYPE = "application/zip";
const ARCHIVE_FORMAT = "cfru-spread-editor";
const ARCHIVE_VERSION = 1;
const MANIFEST_FILE = "manifest.json";
const IMPORT_DIRECTORY = "imports";
const MAX_COMPRESSED_BYTES = 128 * 1024 * 1024;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 512 * 1024 * 1024;
const MAX_ENTRIES = 16384;
const MAX_MANIFEST_BYTES = 16 * 1024;
const MAX_ENTRY_PATH = 1024;
const END_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const END_HEADER_BYTES = 22;
const CENTRAL_HEADER_BYTES = 46;
const LOCAL_HEADER_BYTES = 30;
const MAX_ZIP_COMMENT_BYTES = 65535;
const ALLOWED_FLAGS = 0x080e;
const UNIX_TYPE_MASK = 0o170000;
const UNIX_FILE_TYPE = 0o100000;
const UNIX_DIRECTORY_TYPE = 0o040000;
const INVALID_ARCHIVE = "ARCHIVE_INVALID";
const VALIDATION_YIELD_INTERVAL = 32;
const RESERVED_COMPONENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
module.exports.ARCHIVE_FILENAME = ARCHIVE_FILENAME;
module.exports.ARCHIVE_CONTENT_TYPE = ARCHIVE_CONTENT_TYPE;
module.exports.MAX_COMPRESSED_BYTES = MAX_COMPRESSED_BYTES;
module.exports.ARCHIVE_LIMITS = { entries: MAX_ENTRIES, fileBytes: MAX_FILE_BYTES, expandedBytes: MAX_EXPANDED_BYTES, compressedBytes: MAX_COMPRESSED_BYTES };

/**
 * Lets HTTP polling run between batches of completed ZIP work.
 * @returns {Promise<void>} Resolves on the next event-loop iteration.
 */
function yieldProgress()
{
    return new Promise((resolve) => setImmediate(resolve));
}


/**
 * Raises a stable archive validation error without exposing source-machine paths.
 *
 * @param {string} message The validation problem.
 */
function rejectArchive(message)
{
    throw new ApiError(StatusCode.ClientErrorUnprocessableEntity, INVALID_ARCHIVE, message);
}

/**
 * Checks a portable ZIP path without normalizing attacker-controlled components.
 *
 * @param {string} name The entry name.
 * @param {boolean} directory Whether it represents a directory.
 */
function validateEntryPath(name, directory)
{
    const plain = directory ? name.slice(0, -1) : name;
    if (!plain || name.length > MAX_ENTRY_PATH || !/^[A-Za-z0-9_ .\-/]+$/.test(name))
        rejectArchive("The archive contains an unsafe path.");

    for (const component of plain.split("/"))
    {
        if (!component || component === "." || component === ".." || /[. ]$/.test(component) || RESERVED_COMPONENT.test(component))
            rejectArchive("The archive contains an unsafe path.");
    }
}

/**
 * Bounds and validates central/local headers before the ZIP library allocates or inflates.
 *
 * @param {Buffer} buffer The ZIP bytes.
 * @param {Function} [onProgress] Reports validated header counts.
 * @returns {Promise<number>} The number of real archive entries.
 */
async function validateZipHeaders(buffer, onProgress)
{
    if (!Buffer.isBuffer(buffer) || buffer.length < END_HEADER_BYTES || buffer.length > MAX_COMPRESSED_BYTES)
        rejectArchive("The archive is empty, malformed or exceeds the compressed size limit.");

    // This source-only format deliberately excludes ZIP64 and multi-disk containers.
    let end = -1;
    for (let offset = buffer.length - END_HEADER_BYTES; offset >= Math.max(0, buffer.length - END_HEADER_BYTES - MAX_ZIP_COMMENT_BYTES); offset--)
    {
        if (buffer.readUInt32LE(offset) === END_SIGNATURE && offset + END_HEADER_BYTES + buffer.readUInt16LE(offset + 20) === buffer.length)
        {
            end = offset;
            break;
        }
    }
    if (end < 0)
        rejectArchive("The ZIP end header is malformed.");

    const count = buffer.readUInt16LE(end + 10);
    const centralSize = buffer.readUInt32LE(end + 12);
    const centralStart = buffer.readUInt32LE(end + 16);
    if (buffer.readUInt16LE(end + 4) !== 0 || buffer.readUInt16LE(end + 6) !== 0
        || buffer.readUInt16LE(end + 8) !== count || count === 0 || count > MAX_ENTRIES
        || centralStart + centralSize !== end)
        rejectArchive("The ZIP entry count or directory is unsupported.");

    let offset = centralStart;
    let total = 0;
    const extents = [];
    for (let index = 0; index < count; index++)
    {
        if (offset + CENTRAL_HEADER_BYTES > end || buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE)
            rejectArchive("The ZIP directory is malformed.");

        const flags = buffer.readUInt16LE(offset + 8);
        const method = buffer.readUInt16LE(offset + 10);
        const crc = buffer.readUInt32LE(offset + 16);
        const compressed = buffer.readUInt32LE(offset + 20);
        const expanded = buffer.readUInt32LE(offset + 24);
        const nameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const attributes = buffer.readUInt32LE(offset + 38);
        const local = buffer.readUInt32LE(offset + 42);
        const next = offset + CENTRAL_HEADER_BYTES + nameLength + extraLength + commentLength;
        if (next > end || !nameLength || buffer.readUInt16LE(offset + 34) !== 0
            || (flags & ~ALLOWED_FLAGS) !== 0 || ![0, 8].includes(method))
            rejectArchive("Encrypted or unsupported ZIP entries are not accepted.");

        const rawName = buffer.subarray(offset + CENTRAL_HEADER_BYTES, offset + CENTRAL_HEADER_BYTES + nameLength);
        const name = rawName.toString("utf8");
        const directory = name.endsWith("/");
        validateEntryPath(name, directory);
        const unixType = (attributes >>> 16) & UNIX_TYPE_MASK;
        if ((unixType !== 0 && unixType !== (directory ? UNIX_DIRECTORY_TYPE : UNIX_FILE_TYPE))
            || (!directory && (attributes & 0x10) !== 0) || (directory && (expanded !== 0 || compressed !== 0 || crc !== 0)))
            rejectArchive("Only regular files and empty directory entries are accepted.");

        total += expanded;
        if (expanded > MAX_FILE_BYTES || total > MAX_EXPANDED_BYTES || compressed > MAX_COMPRESSED_BYTES)
            rejectArchive("The archive exceeds the file or expanded size limit.");

        if (local + LOCAL_HEADER_BYTES > centralStart || buffer.readUInt32LE(local) !== LOCAL_SIGNATURE)
            rejectArchive("The ZIP local header is malformed.");
        const localNameLength = buffer.readUInt16LE(local + 26);
        const dataStart = local + LOCAL_HEADER_BYTES + localNameLength + buffer.readUInt16LE(local + 28);
        if (dataStart + compressed > centralStart || buffer.readUInt16LE(local + 6) !== flags
            || buffer.readUInt16LE(local + 8) !== method || localNameLength !== nameLength
            || !buffer.subarray(local + LOCAL_HEADER_BYTES, local + LOCAL_HEADER_BYTES + localNameLength).equals(rawName))
            rejectArchive("The ZIP local and central headers disagree.");
        if ((flags & 8) === 0 && (buffer.readUInt32LE(local + 14) !== crc
            || buffer.readUInt32LE(local + 18) !== compressed || buffer.readUInt32LE(local + 22) !== expanded))
            rejectArchive("The ZIP sizes or checksums disagree.");

        extents.push({ start: local, end: dataStart + compressed });
        offset = next;
        if ((index + 1) % VALIDATION_YIELD_INTERVAL === 0 || index + 1 === count)
        {
            onProgress?.({ percentage: Math.floor(20 + 5 * (index + 1) / count), label: PROGRESS_LABELS.headers });
            await yieldProgress();
        }
    }
    if (offset !== end)
        rejectArchive("The ZIP directory length is invalid.");
    extents.sort((a, b) => a.start - b.start);
    for (let index = 1; index < extents.length; index++)
    {
        if (extents[index].start < extents[index - 1].end)
            rejectArchive("The ZIP entries overlap.");
    }

    return count;
}

/**
 * Inflates an already bounded entry and checks even zero-byte payloads against the central CRC.
 *
 * @param {object} entry The ZIP entry.
 * @returns {Buffer} Its exact bytes.
 */
function readEntry(entry)
{
    const data = entry.getData();
    if (data.length !== entry.header.size || zlib.crc32(data) !== entry.header.crc)
        rejectArchive("The ZIP entry data or checksum is malformed.");
    return data;
}

/**
 * Validates the format, collisions, allowlist and payloads before creating any cache directory.
 *
 * @param {Buffer} buffer The uploaded archive.
 * @param {Function} [onProgress] Reports completed validation work.
 * @returns {Promise<{entries: Array<object>, manifest: object}>} Validated entries and manifest.
 */
async function validateArchive(buffer, onProgress)
{
    try
    {
        onProgress?.({ percentage: 20, label: PROGRESS_LABELS.headers });
        await yieldProgress();
        const count = await validateZipHeaders(buffer, onProgress);
        const entries = new AdmZip(buffer).getEntries().filter((entry) => !entry.temporary);
        if (entries.length !== count)
            rejectArchive("The ZIP entry count is invalid.");

        // Include implicit ancestors so case aliases and file/directory collisions cannot hide.
        const paths = new Map();
        const explicit = new Set();
        let checkedPaths = 0;
        for (const entry of entries)
        {
            const name = entry.entryName.replace(/\/$/, "");
            const key = name.toLowerCase();
            if (explicit.has(key))
                rejectArchive("The archive contains duplicate or case-colliding entries.");
            explicit.add(key);
            const components = name.split("/");
            for (let index = 1; index <= components.length; index++)
            {
                const current = components.slice(0, index).join("/");
                const directory = index < components.length || entry.isDirectory;
                const previous = paths.get(current.toLowerCase());
                if (previous && (previous.name !== current || previous.directory !== directory))
                    rejectArchive("The archive contains colliding paths.");
                paths.set(current.toLowerCase(), { name: current, directory });
            }
            checkedPaths++;
            if (checkedPaths % VALIDATION_YIELD_INTERVAL === 0 || checkedPaths === count)
            {
                onProgress?.({ percentage: Math.floor(25 + 5 * checkedPaths / count), label: PROGRESS_LABELS.paths });
                await yieldProgress();
            }
        }

        const manifestEntry = entries.find((entry) => entry.entryName === MANIFEST_FILE);
        const configEntry = entries.find((entry) => entry.entryName === `cloud/${CLOUD_GAME_CONFIG_FILE}`);
        if (!manifestEntry || manifestEntry.isDirectory || manifestEntry.header.size > MAX_MANIFEST_BYTES || !configEntry || configEntry.isDirectory)
            rejectArchive("The archive manifest or game declarations are missing.");

        const manifest = JSON.parse(readEntry(manifestEntry).toString("utf8"));
        if (!manifest || Array.isArray(manifest) || manifest.format !== ARCHIVE_FORMAT || manifest.version !== ARCHIVE_VERSION
            || Object.keys(manifest).some((key) => !["format", "version", "gameId"].includes(key))
            || (manifest.gameId !== undefined && (typeof manifest.gameId !== "string" || !manifest.gameId || manifest.gameId.length > 256)))
            rejectArchive("The archive manifest version or fields are unsupported.");

        const inventory = createSourceInventory(readEntry(configEntry).toString("utf8"));
        let checkedFiles = 0;
        for (const entry of entries)
        {
            if (entry.isDirectory ? !inventory.directories.has(entry.entryName.slice(0, -1))
                : entry.entryName !== MANIFEST_FILE && !isInventoryFile(inventory, entry.entryName))
                rejectArchive("The archive contains a file outside the source allowlist.");
            if (!entry.isDirectory)
                readEntry(entry);
            checkedFiles++;
            onProgress?.({ percentage: Math.floor(30 + 10 * checkedFiles / count), label: PROGRESS_LABELS.validation });
            await yieldProgress();
        }

        return { entries, manifest };
    }
    catch (error)
    {
        if (error instanceof ApiError)
            throw error;
        rejectArchive("The ZIP archive is malformed or has invalid data or checksums.");
    }
}

/**
 * Exports required and present optional owned sources, never repository trees or machine paths.
 *
 * @param {object} workspace The loaded workspace.
 * @param {string} [gameId] The selected game, not a filter on exported games.
 * @param {Function} [onProgress] Receives {percentage, label}; 100 is reserved for route success.
 * @returns {Promise<Buffer>} A ZIP archive containing exact source bytes.
 */
async function exportArchive(workspace, gameId, onProgress)
{
    if (gameId !== undefined && (typeof gameId !== "string" || gameId.length > 256 || !workspace.games.has(gameId)))
        throw new ApiError(StatusCode.ClientErrorNotFound, "GAME_NOT_FOUND", "This game is not available in the loaded workspace.");

    onProgress?.({ percentage: 0, label: PROGRESS_LABELS.listing });
    const inventory = await listArchiveSources(workspace);
    onProgress?.({ percentage: 5, label: PROGRESS_LABELS.reading });
    const required = new Set(REPOSITORY_KINDS.flatMap((kind) => REPOSITORY_SENTINELS[kind]
        .filter((entry) => entry.type === "file").map((entry) => `${kind}/${entry.path}`)));
    for (const game of workspace.games.values())
    {
        for (const file of Object.values(game.dataFiles))
            required.add(`cloud/${file}`);
    }

    const zip = new AdmZip();
    const manifest = Buffer.from(JSON.stringify({ format: ARCHIVE_FORMAT, version: ARCHIVE_VERSION, ...(gameId !== undefined ? { gameId } : {}) }));
    zip.addFile(MANIFEST_FILE, manifest);
    for (const directory of inventory.directories)
    {
        validateEntryPath(`${directory}/`, true);
        zip.addFile(`${directory}/`, Buffer.alloc(0));
    }
    if (zip.getEntryCount() > MAX_ENTRIES)
        rejectArchive("The sources exceed the archive entry limit.");

    let expanded = manifest.length;
    let completedFiles = 0;
    const files = [...inventory.files].sort();
    for (const name of files)
    {
        validateEntryPath(name, false);
        const [kind, ...components] = name.split("/");
        const relative = components.join("/");
        try
        {
            // Missing optional sources are omitted; other filesystem failures are not hidden.
            const stats = await fs.promises.lstat(path.join(workspace.roots[kind], ...components));
            if (!stats.isFile() || stats.isSymbolicLink())
                rejectArchive("An archive source is not a regular file.");
        }
        catch (error)
        {
            if (error.code === "ENOENT" && !required.has(name))
            {
                completedFiles++;
                onProgress?.({ percentage: Math.floor(5 + 40 * completedFiles / files.length), label: PROGRESS_LABELS.reading });
                continue;
            }
            throw error;
        }

        const bytes = await readOwnedBuffer(workspace, kind, relative);
        expanded += bytes.length;
        if (bytes.length > MAX_FILE_BYTES || expanded > MAX_EXPANDED_BYTES || zip.getEntryCount() >= MAX_ENTRIES)
            rejectArchive("The sources exceed the archive size or entry limits.");
        zip.addFile(name, bytes);
        completedFiles++;
        onProgress?.({ percentage: Math.floor(5 + 40 * completedFiles / files.length), label: PROGRESS_LABELS.reading });
    }

    onProgress?.({ percentage: 45, label: PROGRESS_LABELS.compression });
    await yieldProgress();
    // Empty/stored entries invoke adm-zip callbacks synchronously; yield those too.
    for (const entry of zip.getEntries())
    {
        const compress = entry.getCompressedDataAsync.bind(entry);
        /**
         * Yields after a real entry finishes compression before the library continues.
         * @param {Function} callback The library's compressed-data callback.
         */
        entry.getCompressedDataAsync = (callback) => compress((data) => setImmediate(callback, data));
    }
    let compressedEntries = 0;
    const entryCount = zip.getEntryCount();
    const bytes = await new Promise((resolve, reject) =>
    {
        zip.toBuffer(resolve, reject, undefined, () =>
        {
            compressedEntries++;
            onProgress?.({ percentage: Math.floor(45 + 54 * compressedEntries / entryCount), label: PROGRESS_LABELS.compression });
        });
    });
    if (bytes.length > MAX_COMPRESSED_BYTES)
        rejectArchive("The sources exceed the compressed archive size limit.");
    return bytes;
}
module.exports.exportArchive = exportArchive;

/**
 * Imports into a fresh server-owned UUID directory and returns a normal loaded snapshot.
 *
 * @param {Buffer} buffer The raw ZIP bytes.
 * @param {Function} [onProgress] Receives {percentage, label} in the 20..99 import range.
 * @returns {Promise<object>} Repositories, games, spreads, diagnostics and optional gameId.
 */
async function importArchive(buffer, onProgress)
{
    const { entries, manifest } = await validateArchive(buffer, onProgress);
    const parent = path.join(getDataDirectory(), IMPORT_DIRECTORY);
    await fs.promises.mkdir(parent, { recursive: true });
    const directory = path.join(parent, crypto.randomUUID());
    await fs.promises.mkdir(directory);
    let workspaceId;
    try
    {
        // Never use library extraction, archive permissions, or client-selected destinations.
        const extractable = entries.filter((entry) => entry.entryName !== MANIFEST_FILE);
        let extracted = 0;
        onProgress?.({ percentage: 40, label: PROGRESS_LABELS.extraction });
        for (const entry of extractable)
        {
            const target = path.join(directory, ...entry.entryName.split("/"));
            if (entry.isDirectory)
                await fs.promises.mkdir(target, { recursive: true });
            else
            {
                await fs.promises.mkdir(path.dirname(target), { recursive: true });
                await fs.promises.writeFile(target, readEntry(entry), { flag: "wx", mode: 0o600 });
            }
            extracted++;
            onProgress?.({ percentage: Math.floor(40 + 35 * extracted / extractable.length), label: PROGRESS_LABELS.extraction });
        }

        const snapshot = await loadWorkspace(Object.fromEntries(REPOSITORY_KINDS.map((kind) => [kind, path.join(directory, kind)])),
            onProgress ? ({ percentage, label }) => onProgress({ percentage: Math.floor(75 + percentage / 10), label }) : undefined);
        workspaceId = snapshot.workspaceId;
        const workspace = getWorkspace(workspaceId);
        if (manifest.gameId !== undefined && !workspace.games.has(manifest.gameId))
            rejectArchive("The selected archive game is unavailable.");
        onProgress?.({ percentage: 85, label: PROGRESS_LABELS.catalog });
        await validateCatalogData(workspace, onProgress ? ({ percentage }) =>
            onProgress({ percentage: Math.floor(85 + percentage / 20), label: PROGRESS_LABELS.catalog }) : undefined);
        onProgress?.({ percentage: 90, label: PROGRESS_LABELS.spreads });
        const { spreads, diagnostics } = await loadSpreads(workspace);
        if (diagnostics.some((diagnostic) => diagnostic.severity === "error"))
            rejectArchive("The imported spreads could not be parsed reliably.");

        onProgress?.({ percentage: 99, label: PROGRESS_LABELS.spreads });

        return { ...snapshot, spreads, diagnostics: [...snapshot.diagnostics, ...diagnostics], ...(manifest.gameId !== undefined ? { gameId: manifest.gameId } : {}) };
    }
    catch (error)
    {
        if (workspaceId !== undefined)
            forgetWorkspace(workspaceId);
        await fs.promises.rm(directory, { recursive: true, force: true });
        throw error;
    }
}
module.exports.importArchive = importArchive;
