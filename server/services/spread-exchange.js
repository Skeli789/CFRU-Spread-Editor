/**
 * Persistent export baselines for collaborative spread-file exchange.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Worker } = require("worker_threads");
const { StatusCode } = require("status-code-enum");
const { ApiError } = require("../middleware/errors");
const { getDataDirectory } = require("./parse-cache");
const { getRootKey, readOwnedBuffer } = require("./repositories");
const { hashBytes, prepareEditorChanges, prepareSpreadFiles } = require("./spread-store");
const { PROGRESS_LABELS } = require("./progress");

const EXPORT_DIRECTORY = "spread-exports";
const SNAPSHOT_ARCHIVE = "spread-files.zip";
const SNAPSHOT_METADATA = "export.json";
const SNAPSHOT_VERSION = 1;
const REPOSITORY_CFRU = "cfru";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PREVIEW_LIFETIME_MS = 15 * 60 * 1000;
const MAX_PREVIEWS = 16;
const MAX_PREVIEW_BYTES = 64 * 1024 * 1024;
const MAX_REVIEW_BYTES = 4 * 1024 * 1024;
const MAX_EXPORT_NAME_LENGTH = 128;
const EXPORT_NAME_CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/;
const COMPARISON_PROGRESS_START = 30;
const COMPARISON_PROGRESS_END = 98;
const PREVIEW_READY_PERCENTAGE = 99;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const EXPORT_DAMAGED_MESSAGE = "The saved export baseline is damaged. Choose another export.";
const EXPORT_UNAVAILABLE_MESSAGE = "The selected export is unavailable for this repository.";
const MERGE_TOO_LARGE_MESSAGE = "The smart import preview is too large. Import fewer files at a time.";
const MERGE_PREVIEW_EXPIRED = "MERGE_PREVIEW_EXPIRED";
const CONTEXT_KIND_CURRENT = "current";
const CHOICE_CURRENT = "current";
const CHOICE_INCOMING = "incoming";
const previews = new Map();


/**
 * Returns the private snapshot directory for a canonical CFRU root.
 * @param {object} workspace The owned workspace.
 * @returns {string} The snapshot directory.
 */
function exportDirectory(workspace)
{
    const key = hashBytes(getRootKey(workspace, REPOSITORY_CFRU));
    return path.join(getDataDirectory(), EXPORT_DIRECTORY, key);
}

/**
 * Retains exact exported bytes and a timestamp outside the repository.
 * @param {object} workspace The owned workspace.
 * @param {Buffer} bytes The completed spread-only ZIP.
 * @param {string} [name] The optional normalized display name.
 * @returns {Promise<object>} The selectable export metadata.
 */
async function recordSpreadExport(workspace, bytes, name)
{
    // Describe the baseline with a content hash
    const id = crypto.randomUUID();
    const directory = path.join(exportDirectory(workspace), id);
    const metadata = { version: SNAPSHOT_VERSION, id, exportedAt: new Date().toISOString(),
        ...(name ? { name } : {}),
        hash: hashBytes(bytes) };
    // Write the archive and metadata, removing the directory on failure
    await fs.promises.mkdir(directory, { recursive: true });
    try
    {
        await fs.promises.writeFile(path.join(directory, SNAPSHOT_ARCHIVE), bytes, { flag: "wx", mode: 0o600 });
        await fs.promises.writeFile(path.join(directory, SNAPSHOT_METADATA), JSON.stringify(metadata), { flag: "wx", mode: 0o600 });
    }
    catch (error)
    {
        await fs.promises.rm(directory, { recursive: true, force: true });
        throw error;
    }
    return { id, exportedAt: metadata.exportedAt, ...(name ? { name } : {}) };
}
module.exports.recordSpreadExport = recordSpreadExport;

/**
 * Validates an optional display name without using it as a filesystem path.
 * @param {*} name The submitted export name.
 * @returns {string|undefined} A trimmed name, or no name for blank exports.
 */
function normalizeSpreadExportName(name)
{
    if (name === undefined)
        return undefined;
    if (typeof name !== "string" || name.trim().length > MAX_EXPORT_NAME_LENGTH || EXPORT_NAME_CONTROL_CHARACTERS.test(name))
        throw new ApiError(StatusCode.ClientErrorUnprocessableEntity, "INVALID_EXPORT_NAME", "Export names must be at most 128 characters without control characters.");
    return name.trim() || undefined;
}
module.exports.normalizeSpreadExportName = normalizeSpreadExportName;

/**
 * Reads valid completed export metadata from private storage.
 * @param {object} workspace The owned workspace.
 * @param {string} id The server-issued export ID.
 * @returns {Promise<object>} The export metadata.
 */
async function readExportMetadata(workspace, id)
{
    if (typeof id !== "string" || !UUID_PATTERN.test(id))
        throw new ApiError(StatusCode.ClientErrorNotFound, "EXPORT_NOT_FOUND", EXPORT_UNAVAILABLE_MESSAGE);
    const metadata = JSON.parse(await fs.promises.readFile(path.join(exportDirectory(workspace), id, SNAPSHOT_METADATA), "utf8"));
    if (metadata.version !== SNAPSHOT_VERSION || metadata.id !== id || !Number.isFinite(Date.parse(metadata.exportedAt))
        || (metadata.name !== undefined && (typeof metadata.name !== "string" || !metadata.name.trim()
            || metadata.name.length > MAX_EXPORT_NAME_LENGTH || EXPORT_NAME_CONTROL_CHARACTERS.test(metadata.name)))
        || typeof metadata.hash !== "string" || !HASH_PATTERN.test(metadata.hash))
        throw new ApiError(StatusCode.ClientErrorConflict, "EXPORT_INVALID", EXPORT_DAMAGED_MESSAGE);
    return metadata;
}

/**
 * Lists retained export dates for this CFRU repository, newest first.
 * @param {object} workspace The owned workspace.
 * @returns {Promise<Array<object>>} Export IDs and timestamps.
 */
async function listSpreadExports(workspace)
{
    // Read the export directory, treating a missing one as empty
    let entries;
    try
    {
        entries = await fs.promises.readdir(exportDirectory(workspace), { withFileTypes: true });
    }
    catch (error)
    {
        if (error.code === "ENOENT")
            return [];
        throw error;
    }
    // Collect valid exports and skip damaged or vanished ones
    const exports = [];
    for (const entry of entries)
    {
        if (!entry.isDirectory() || !UUID_PATTERN.test(entry.name))
            continue;
        try
        {
            const metadata = await readExportMetadata(workspace, entry.name);
            exports.push({ id: metadata.id, exportedAt: metadata.exportedAt, ...(metadata.name ? { name: metadata.name } : {}) });
        }
        catch (error)
        {
            if (error.code !== "ENOENT" && error.code !== "EXPORT_INVALID" && !(error instanceof SyntaxError))
                throw error;
        }
    }
    // Sort newest first
    return exports.sort((first, second) => second.exportedAt.localeCompare(first.exportedAt) || second.id.localeCompare(first.id));
}
module.exports.listSpreadExports = listSpreadExports;

/**
 * Loads and verifies a baseline belonging to the selected CFRU root.
 * @param {object} workspace The owned workspace.
 * @param {string} id The selected export ID.
 * @returns {Promise<Buffer>} The exact original export ZIP.
 */
async function readSpreadExport(workspace, id)
{
    try
    {
        const metadata = await readExportMetadata(workspace, id);
        const bytes = await fs.promises.readFile(path.join(exportDirectory(workspace), id, SNAPSHOT_ARCHIVE));
        if (hashBytes(bytes) !== metadata.hash)
            throw new ApiError(StatusCode.ClientErrorConflict, "EXPORT_INVALID", EXPORT_DAMAGED_MESSAGE);
        return bytes;
    }
    catch (error)
    {
        if (error.code === "ENOENT")
            throw new ApiError(StatusCode.ClientErrorNotFound, "EXPORT_NOT_FOUND", EXPORT_UNAVAILABLE_MESSAGE);
        if (error instanceof SyntaxError)
            throw new ApiError(StatusCode.ClientErrorConflict, "EXPORT_INVALID", EXPORT_DAMAGED_MESSAGE);
        throw error;
    }
}
module.exports.readSpreadExport = readSpreadExport;

/**
 * Computes a header comparison in a worker so progress polling remains responsive.
 * @param {object} data The source bytes and configuration macros.
 * @param {Function} [onProgress] Receives completed worker stages.
 * @returns {Promise<object>} Whole-spread comparisons and replacement pieces.
 */
function compareHeader(data, onProgress)
{
    return new Promise((resolve, reject) =>
    {
        const worker = new Worker(path.join(__dirname, "spread-merge.js"), { workerData: data });
        let settled = false;
        worker.on("message", (message) =>
        {
            if (message.progress)
                onProgress?.(message.progress);
            else if (message.error)
            {
                settled = true;
                reject(new ApiError(message.error.status, message.error.code, message.error.message));
            }
            else if (message.result)
            {
                settled = true;
                resolve(message.result);
            }
        });
        worker.once("error", reject);
        worker.once("exit", () =>
        {
            if (!settled)
                reject(new ApiError(StatusCode.ServerErrorInternal, "MERGE_PREVIEW_FAILED", "The spread comparison could not complete. Try again."));
        });
    });
}

/**
 * Removes expired previews and bounds all retained source data.
 * @param {number} requiredBytes Bytes required by the new preview.
 */
function prunePreviews(requiredBytes = 0)
{
    // Drop expired entries
    for (const [id, preview] of previews)
    {
        if (Date.now() - preview.createdAt >= PREVIEW_LIFETIME_MS)
            previews.delete(id);
    }

    // Evict the oldest idle entries until the new data fits
    let total = [...previews.values()].reduce((sum, preview) => sum + preview.bytes, 0);
    while (previews.size && (previews.size >= MAX_PREVIEWS || total + requiredBytes > MAX_PREVIEW_BYTES))
    {
        const [id, preview] = previews.entries().next().value;
        if (preview.applying)
            break;
        previews.delete(id);
        total -= preview.bytes;
    }

    // Reject when limits still cannot be met
    if (previews.size >= MAX_PREVIEWS || total + requiredBytes > MAX_PREVIEW_BYTES || requiredBytes > MAX_PREVIEW_BYTES)
        throw new ApiError(StatusCode.ClientErrorUnprocessableEntity, "MERGE_LIMIT", MERGE_TOO_LARGE_MESSAGE);
}

/**
 * Builds a three-way source preview without writing to CFRU.
 * @param {object} workspace The destination workspace.
 * @param {Map<string, Buffer>} baseline Original exported headers.
 * @param {Map<string, Buffer>} incoming Returned headers.
 * @param {string} revision The destination snapshot revision.
 * @param {Function} [onProgress] Reports completed read, parse, and comparison work.
 * @param {string} [currentId] A server-issued effective editor snapshot ID.
 * @returns {Promise<object>} A bounded preview ID, incoming changes, and explicit conflicts.
 */
async function previewSpreadMerge(workspace, baseline, incoming, revision, onProgress, currentId)
{
    // Require a current snapshot and resolve the effective editor state
    if (!workspace.spreads || workspace.spreads.stale || workspace.spreads.revision !== revision)
        throw new ApiError(StatusCode.ClientErrorConflict, "SAVE_CONFLICT", "Load the repositories again before previewing a smart import.");
    const context = currentId ? getEditorContext(workspace, currentId, revision) : await prepareEditorChanges(workspace, { revision, operations: [] });
    const plan = { id: crypto.randomUUID(), rootKey: getRootKey(workspace, REPOSITORY_CFRU), revision, context,
        createdAt: Date.now(), files: [], conflicts: [], changes: [], bytes: 0, applying: false };
    // Weight each changed file by its source size for progress
    const workBytes = new Map([...incoming].map(([file, bytes]) => [file, baseline.get(file)?.equals(bytes) ? 0
        : bytes.length + (baseline.get(file)?.length ?? 0) + (context.sources.get(file)?.length ?? 0)]));
    const totalBytes = [...workBytes.values()].reduce((total, bytes) => total + bytes, 0);
    // Compare each changed file against its baseline in a worker
    let completedBytes = 0;
    for (const [file, incomingBytes] of incoming)
    {
        const baselineBytes = baseline.get(file);
        if (!baselineBytes)
            throw new ApiError(StatusCode.ClientErrorUnprocessableEntity, "EXPORT_MISMATCH", "The ZIP contains a spread header absent from the selected export.");
        if (baselineBytes.equals(incomingBytes))
            continue;
        const diskBytes = await readOwnedBuffer(workspace, REPOSITORY_CFRU, file, true);
        if (!diskBytes || hashBytes(diskBytes) !== workspace.spreads.hashes.get(file))
            throw new ApiError(StatusCode.ClientErrorConflict, "SAVE_CONFLICT", "The spread files changed outside the editor. Load the repositories again.");
        const localBytes = context.sources.get(file);
        plan.bytes += localBytes.length + baselineBytes.length + incomingBytes.length;
        if (plan.bytes > MAX_PREVIEW_BYTES)
            throw new ApiError(StatusCode.ClientErrorUnprocessableEntity, "MERGE_LIMIT", MERGE_TOO_LARGE_MESSAGE);
        const result = await compareHeader({ file, baselineBytes, localBytes, incomingBytes, macros: workspace.spreads.macros, currentSpreads: context.spreads },
            onProgress ? ({ percentage, label }) => onProgress({ percentage: Math.floor(COMPARISON_PROGRESS_START
                + (COMPARISON_PROGRESS_END - COMPARISON_PROGRESS_START) * (completedBytes + workBytes.get(file) * percentage / 100) / totalBytes), label }) : undefined);
        // Attach whole-file operations to structural conflicts
        for (const row of result.conflicts.filter((comparison) => comparison.structural))
        {
            const prepared = await prepareSpreadFiles(workspace, new Map([[file, incomingBytes]]), revision, context);
            row.operations = prepared.operations;
        }
        plan.changes.push(...result.changes);
        plan.conflicts.push(...result.conflicts);
        if (result.filePlan)
            plan.files.push(result.filePlan);
        completedBytes += workBytes.get(file);
        onProgress?.({ percentage: Math.floor(COMPARISON_PROGRESS_START
            + (COMPARISON_PROGRESS_END - COMPARISON_PROGRESS_START) * completedBytes / totalBytes), label: PROGRESS_LABELS.prepareComparisons });
    }
    // Bound the review size and retain the plan
    const result = { previewId: plan.id, revision, changes: plan.changes, conflicts: plan.conflicts,
        changedFiles: plan.files.map(({ file }) => file) };
    const reviewBytes = Buffer.byteLength(JSON.stringify(result));
    if (reviewBytes > MAX_REVIEW_BYTES)
        throw new ApiError(StatusCode.ClientErrorUnprocessableEntity, "MERGE_LIMIT", "The review contains too many changes. Import fewer files at a time.");
    plan.bytes += reviewBytes;
    prunePreviews(plan.bytes);
    previews.set(plan.id, plan);
    onProgress?.({ percentage: PREVIEW_READY_PERCENTAGE, label: PROGRESS_LABELS.prepareComparisons });
    return result;
}
module.exports.previewSpreadMerge = previewSpreadMerge;

/**
 * Applies only incoming differences, with explicit choices for every overlap.
 * @param {object} workspace The destination workspace.
 * @param {object} request The preview ID and conflict choices.
 * @param {string} request.previewId The server-issued preview ID.
 * @param {object<string, string>} [request.choices] The current or incoming choice for each comparison ID.
 * @param {string} [request.decisionId] Stages one comparison while retaining the remaining preview.
 * @returns {Promise<object>} Validated unsaved operations and decision counts.
 */
async function applySpreadMerge(workspace, { previewId, choices = {}, decisionId } = {})
{
    // Resolve the retained preview for this repository
    const plan = previews.get(previewId);
    if (!plan || plan.kind === CONTEXT_KIND_CURRENT || plan.rootKey !== getRootKey(workspace, REPOSITORY_CFRU) || Date.now() - plan.createdAt >= PREVIEW_LIFETIME_MS)
        throw new ApiError(StatusCode.ClientErrorConflict, MERGE_PREVIEW_EXPIRED, "This preview is unavailable. Preview the ZIP again.");
    if (plan.applying)
        throw new ApiError(StatusCode.ClientErrorConflict, "MERGE_BUSY", "This preview is already being applied.");
    // Require an explicit choice for every targeted comparison
    const comparisons = [...plan.conflicts, ...plan.changes];
    const decisions = decisionId === undefined ? comparisons : comparisons.filter((row) => row.id === decisionId);
    if (decisionId !== undefined && decisions.length !== 1)
        throw new ApiError(StatusCode.ClientErrorConflict, MERGE_PREVIEW_EXPIRED, "This comparison is no longer available. Preview the ZIP again.");
    if (!choices || typeof choices !== "object" || Array.isArray(choices)
        || Object.keys(choices).some((id) => !decisions.some((row) => row.id === id))
        || decisions.some((row) => ![CHOICE_CURRENT, CHOICE_INCOMING].includes(choices[row.id])))
        throw new ApiError(StatusCode.ClientErrorUnprocessableEntity, "MERGE_UNRESOLVED", "Accept or reject every change and resolve every conflict before importing.");
    // Verify the saved revision is still current, then collect accepted operations
    plan.applying = true;
    try
    {
        await prepareEditorChanges(workspace, { revision: plan.revision, operations: [] });
        const selected = decisions.filter((row) => choices[row.id] === CHOICE_INCOMING);
        const operations = [];
        for (const row of selected)
        {
            if (row.structural)
            {
                const filePlan = plan.files.find((file) => file.file === row.file);
                const result = await prepareSpreadFiles(workspace, new Map([[row.file, Buffer.from((filePlan.bom ? "\uFEFF" : "")
                    + row.incomingSource.replaceAll("\n", filePlan.lineEnding), "utf8")]]), plan.revision, plan.context);
                operations.push(...result.operations);
            }
            else
                operations.push(...row.operations);
        }
        // Validate the combined operations against the effective editor state
        const checked = await prepareEditorChanges(workspace,
            { revision: plan.revision, operations }, plan.context);
        const result = { operations, revision: plan.revision, files: checked.files.map((file) => ({ ...file, status: "staged" })), backupId: null,
            acceptedCount: selected.length, rejectedCount: decisions.length - selected.length };
        // Retire the preview, or keep the unresolved remainder for single decisions
        if (decisionId === undefined)
            previews.delete(previewId);
        else
        {
            plan.context = checked;
            plan.changes = plan.changes.filter((row) => row.id !== decisionId);
            plan.conflicts = plan.conflicts.filter((row) => row.id !== decisionId);
            if (plan.changes.length + plan.conflicts.length === 0)
                previews.delete(previewId);
        }
        return result;
    }
    finally
    {
        plan.applying = false;
    }
}
module.exports.applySpreadMerge = applySpreadMerge;

/**
 * Retains a write-free effective editor snapshot for a ZIP comparison.
 * @param {object} workspace The owned workspace.
 * @param {object} request Saved revision and pending editor operations.
 * @returns {Promise<object>} A repository-owned context ID.
 */
async function prepareImportContext(workspace, request)
{
    const context = await prepareEditorChanges(workspace, request);
    const id = crypto.randomUUID();
    const bytes = [...context.sources.values()].reduce((sum, source) => sum + source.length, 0);
    prunePreviews(bytes);
    previews.set(id, { ...context, kind: CONTEXT_KIND_CURRENT, rootKey: getRootKey(workspace, REPOSITORY_CFRU),
        revision: request.revision, createdAt: Date.now(), bytes });
    return { currentId: id };
}
module.exports.prepareImportContext = prepareImportContext;

/**
 * Resolves an editor snapshot only for the same repository and saved revision.
 * @param {object} workspace The owned workspace.
 * @param {string} currentId The server-issued snapshot ID.
 * @param {string} revision The saved revision.
 * @returns {object} An effective editor snapshot.
 */
function getEditorContext(workspace, currentId, revision)
{
    const context = previews.get(currentId);
    if (!context || context.kind !== CONTEXT_KIND_CURRENT || context.rootKey !== getRootKey(workspace, REPOSITORY_CFRU)
        || context.revision !== revision || Date.now() - context.createdAt >= PREVIEW_LIFETIME_MS)
        throw new ApiError(StatusCode.ClientErrorConflict, MERGE_PREVIEW_EXPIRED, "The current editor snapshot expired. Preview the ZIP again.");
    return context;
}
module.exports.getEditorContext = getEditorContext;
