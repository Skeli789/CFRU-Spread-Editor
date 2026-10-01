/**
 * Bounded, process-local operation progress with path-free public snapshots.
 */
const { StatusCode } = require("status-code-enum");
const { ApiError } = require("../middleware/errors");

const MAX_RECORDS = 256;
const RETENTION_MS = 15 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROGRESS_LABELS =
{
    starting: "Starting Operation",
    upload: "Receiving ZIP",
    uploadUnknown: "Receiving ZIP (Size Unknown)",
    headers: "Checking ZIP Headers",
    paths: "Checking ZIP Paths",
    validation: "Validating ZIP Files",
    extraction: "Extracting ZIP Files",
    repositories: "Checking Repositories",
    games: "Checking Games",
    access: "Checking Spread File Access",
    catalog: "Validating Catalog Data",
    spreads: "Loading Spreads",
    listing: "Listing Required Files",
    reading: "Reading Required Files",
    compression: "Compressing ZIP",
    complete: "Complete",
    failed: "Operation Failed",
};
module.exports.PROGRESS_LABELS = PROGRESS_LABELS;
const SAFE_LABELS = new Set(Object.values(PROGRESS_LABELS));


/**
 * Validates and normalizes an operation UUID.
 * @param {*} id The submitted ID.
 * @returns {string} The normalized UUID.
 */
function validateProgressId(id)
{
    if (typeof id !== "string" || !UUID_PATTERN.test(id))
        throw new ApiError(StatusCode.ClientErrorBadRequest, "INVALID_PROGRESS_ID", "Progress ID must be a UUID.");
    return id.toLowerCase();
}
module.exports.validateProgressId = validateProgressId;

/**
 * Creates an isolated store; expiration is lazy and polling does not extend retention.
 * @param {object} [options] Clock and storage bounds.
 * @returns {object} Registration and snapshot methods.
 */
function createProgressStore({ now = Date.now, maxRecords = MAX_RECORDS, retentionMs = RETENTION_MS } = {})
{
    const records = new Map();

    /** Removes stale records without a background timer. */
    function prune()
    {
        for (const [id, record] of records)
        {
            if (now() - record.updatedAt >= retentionMs)
                records.delete(id);
        }
    }

    /**
     * Registers exactly once; retries must use a fresh UUID to avoid overwriting work.
     * @param {string} rawId The UUID.
     * @param {string} [label] A public stage label.
     * @returns {object} A handle scoped to this registration, even after expiry.
     */
    function start(rawId, label = PROGRESS_LABELS.starting)
    {
        const id = validateProgressId(rawId);
        prune();
        if (records.has(id))
            throw new ApiError(StatusCode.ClientErrorConflict, "PROGRESS_ID_IN_USE", "Use a new progress ID for each operation or retry.");
        if (records.size >= maxRecords)
        {
            const removable = [...records].find(([, record]) => record.status !== "running");
            if (!removable)
                throw new ApiError(StatusCode.ServerErrorServiceUnavailable, "PROGRESS_BUSY", "Too many operations are being tracked.");
            records.delete(removable[0]);
        }
        const record = { percentage: 0, label: SAFE_LABELS.has(label) ? label : PROGRESS_LABELS.starting, status: "running", updatedAt: now() };
        records.set(id, record);

        /**
         * Records actual completed work, clamped below success and never decreasing.
         * @param {object} event The percentage and safe label.
         */
        function update({ percentage, label })
        {
            if (records.get(id) !== record || record.status !== "running")
                return;
            if (Number.isFinite(percentage))
                record.percentage = Math.max(record.percentage, Math.min(99, Math.max(0, Math.floor(percentage))));
            if (SAFE_LABELS.has(label))
                record.label = label;
            record.updatedAt = now();
        }

        /**
         * Ends this registration without allowing late callbacks to replace its result.
         * @param {boolean} success Whether all work succeeded.
         */
        function finish(success)
        {
            if (records.get(id) !== record || record.status !== "running")
                return;
            record.status = success ? "complete" : "failed";
            record.label = success ? PROGRESS_LABELS.complete : PROGRESS_LABELS.failed;
            if (success)
                record.percentage = 100;
            record.updatedAt = now();
        }

        return { update, complete: () => finish(true), fail: () => finish(false) };
    }

    /**
     * Returns only public progress, never IDs, errors or filesystem details.
     * @param {string} rawId The UUID.
     * @returns {object} A detached snapshot.
     */
    function snapshot(rawId)
    {
        const id = validateProgressId(rawId);
        prune();
        const record = records.get(id);
        if (!record)
            throw new ApiError(StatusCode.ClientErrorNotFound, "PROGRESS_NOT_FOUND", "This operation has not registered progress or its progress has expired.");
        return { percentage: record.percentage, label: record.label, status: record.status };
    }

    return { start, snapshot };
}
module.exports.createProgressStore = createProgressStore;
const progressStore = createProgressStore();
module.exports.progressStore = progressStore;
