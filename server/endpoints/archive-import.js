const express = require("express");
const { StatusCode } = require("status-code-enum");
const { ApiError } = require("../middleware/errors");
const { requireSession } = require("../middleware/security");
const { ARCHIVE_CONTENT_TYPE, MAX_COMPRESSED_BYTES, importArchive } = require("../services/archives");
const { registerRequestProgress } = require("../middleware/progress");
const { PROGRESS_LABELS } = require("../services/progress");

const router = express.Router({ caseSensitive: true, strict: true });


/**
 * Requires a raw ZIP with no HTTP content encoding before parsing its bounded body.
 *
 * @param {object} req The request.
 * @param {object} res The response.
 * @param {Function} next The next handler.
 */
function requireZipBody(req, res, next)
{
    if (!req.is(ARCHIVE_CONTENT_TYPE) || (req.headers["content-encoding"] !== undefined && req.headers["content-encoding"] !== "identity"))
        throw new ApiError(StatusCode.ClientErrorUnsupportedMediaType, "UNSUPPORTED_MEDIA_TYPE", "Import requires an unencoded application/zip body.");
    if (Number(req.headers["content-length"]) > MAX_COMPRESSED_BYTES)
        throw new ApiError(StatusCode.ClientErrorPayloadTooLarge, "REQUEST_TOO_LARGE", "The request is too large.");
    next();
}

/**
 * Registers before raw parsing and measures bytes without retaining another upload copy.
 * @param {object} req The request.
 * @param {object} res The response.
 * @param {Function} next The next handler.
 */
function trackUpload(req, res, next)
{
    const length = Number(req.headers["content-length"]);
    const knownLength = Number.isFinite(length) && length > 0;
    const label = knownLength ? PROGRESS_LABELS.upload : PROGRESS_LABELS.uploadUnknown;
    const progress = registerRequestProgress(req, res, label);
    if (!progress)
        return next();
    let received = 0;

    /**
     * Measures each actual body chunk; unknown lengths use the upload cap as a lower bound.
     * @param {Buffer} chunk The received bytes.
     */
    function data(chunk)
    {
        received += chunk.length;
        progress.update({ percentage: Math.min(19, 20 * received / (knownLength ? length : MAX_COMPRESSED_BYTES)), label });
    }

    /** Detaches every receipt listener on parser exit or stream termination. */
    function stop()
    {
        req.removeListener("data", data);
        req.removeListener("end", end);
        req.removeListener("aborted", failed);
        req.removeListener("error", failed);
        delete req.stopProgressUpload;
    }

    /** Records the end of actual receipt, not the success of validation. */
    function end()
    {
        progress.update({ percentage: 20, label: PROGRESS_LABELS.headers });
        stop();
    }

    /** Stops listening and leaves aborted or errored uploads below 100. */
    function failed()
    {
        progress.fail();
        stop();
    }

    req.stopProgressUpload = stop;
    req.on("data", data);
    req.once("end", end);
    req.once("aborted", failed);
    req.once("error", failed);
    next();
}

/**
 * Loads a ZIP into private cached repositories with a normal workspace snapshot.
 * @route POST /api/workspaces/import
 * @returns {object} 200 - The loaded snapshot and optional selected gameId.
 */
router.post("/api/workspaces/import", requireSession, trackUpload, requireZipBody,
    express.raw({ type: ARCHIVE_CONTENT_TYPE, limit: MAX_COMPRESSED_BYTES, inflate: false }), async (req, res) =>
    {
        req.stopProgressUpload?.();
        const snapshot = await importArchive(req.body, req.operationProgress?.update);
        req.operationProgress?.complete();
        res.status(StatusCode.SuccessOK).send(snapshot);
    });

module.exports = router;
