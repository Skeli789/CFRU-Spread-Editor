const { progressStore } = require("../services/progress");


/**
 * Registers optional progress after authentication and fails disconnected operations.
 * @param {object} req The request.
 * @param {object} res The response.
 * @param {string} label The initial public stage.
 * @returns {object|undefined} The request's operation handle.
 */
function registerRequestProgress(req, res, label)
{
    if (req.query.progressId === undefined)
        return undefined;
    const progress = progressStore.start(req.query.progressId, label);
    req.operationProgress = progress;

    /** Removes operation listeners on every response exit. */
    function cleanup()
    {
        req.stopProgressUpload?.();
        res.removeListener("finish", cleanup);
        res.removeListener("close", closed);
    }

    /** Marks a response disconnected before it finishes as failed. */
    function closed()
    {
        if (!res.writableFinished)
            progress.fail();
        cleanup();
    }

    res.once("finish", cleanup);
    res.once("close", closed);
    return progress;
}
module.exports.registerRequestProgress = registerRequestProgress;
