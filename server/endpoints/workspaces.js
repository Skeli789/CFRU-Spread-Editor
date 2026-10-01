const express = require('express');
const router = express.Router();
const { StatusCode } = require('status-code-enum');

const { ApiError } = require('../middleware/errors');
const { loadGameCatalog } = require('../services/catalog');
const { getWorkspace, loadWorkspace } = require('../services/repositories');
const { loadSpreads, saveSpreads } = require('../services/spread-store');
const { ARCHIVE_CONTENT_TYPE, ARCHIVE_FILENAME, exportArchive } = require('../services/archives');
const { registerRequestProgress } = require('../middleware/progress');
const { PROGRESS_LABELS } = require('../services/progress');


/**
 * Validates the three repositories and starts a workspace with its spreads.
 * @route POST /api/workspaces/load
 * @param {Object} req.body.paths Absolute paths keyed by cfru, dpe and cloud.
 * @returns {Object} 200 - The workspace snapshot
 */
router.post('/load', async (req, res) =>
{
    const progress = registerRequestProgress(req, res, PROGRESS_LABELS.repositories);
    const { paths } = req.body ?? {};
    if (paths === null || typeof paths !== 'object' || Array.isArray(paths))
        throw new ApiError(StatusCode.ClientErrorBadRequest, 'INVALID_REQUEST', 'Repository paths are required.');

    const snapshot = await loadWorkspace(paths, progress?.update);
    progress?.update({ percentage: 95, label: PROGRESS_LABELS.spreads });
    const { spreads, diagnostics } = await loadSpreads(getWorkspace(snapshot.workspaceId));
    progress?.complete();
    res.status(StatusCode.SuccessOK).send({ ...snapshot, spreads, diagnostics: [...snapshot.diagnostics, ...diagnostics] });
});

/**
 * Loads the catalog for a game in a workspace.
 * @route POST /api/workspaces/:id/catalog
 * @param {string} req.params.id The workspace ID.
 * @param {string} req.body.gameId The game ID.
 * @returns {Object} 200 - The catalog summary
 */
router.post('/:id/catalog', async (req, res) =>
{
    const { gameId } = req.body ?? {};
    const workspace = getWorkspace(req.params.id);
    res.status(StatusCode.SuccessOK).send(await loadGameCatalog(workspace, gameId));
});

/**
 * Saves changes to a workspace's spreads.
 * @route POST /api/workspaces/:id/save
 * @param {string} req.params.id The workspace ID.
 * @param {string} req.body.revision The spreads revision the changes were made to.
 * @param {string} [req.body.gameId] The selected game, used for ability comments.
 * @param {Array<Object>} req.body.operations Update, add and reorder changes.
 * @returns {Object} 200 - The new spreads snapshot, IDs given to new spreads and per-file results
 */
router.post('/:id/save', async (req, res) =>
{
    const workspace = getWorkspace(req.params.id);
    res.status(StatusCode.SuccessOK).send(await saveSpreads(workspace, req.body ?? {}));
});


/**
 * Exports all editor sources across declared games, with an optional selected game ID.
 * @route POST /api/workspaces/:id/archive
 * @returns {Buffer} 200 - The source ZIP attachment.
 */
router.post('/:id/archive', async (req, res) =>
{
    const progress = registerRequestProgress(req, res, PROGRESS_LABELS.listing);
    const workspace = getWorkspace(req.params.id);
    const bytes = await exportArchive(workspace, req.body?.gameId, progress?.update);
    progress?.complete();
    res.attachment(ARCHIVE_FILENAME).type(ARCHIVE_CONTENT_TYPE).send(bytes);
});

module.exports = router;
