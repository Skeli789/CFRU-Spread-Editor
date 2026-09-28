const express = require('express');
const router = express.Router();
const { StatusCode } = require('status-code-enum');

const { ApiError } = require('../middleware/errors');
const { loadGameCatalog } = require('../services/catalog');
const { getWorkspace, loadWorkspace } = require('../services/repositories');


/**
 * Validates the three repositories and starts a workspace.
 * @route POST /api/workspaces/load
 * @param {Object} req.body.paths Absolute paths keyed by cfru, dpe and cloud.
 * @returns {Object} 200 - The workspace snapshot
 */
router.post('/load', async (req, res) =>
{
    const { paths } = req.body ?? {};
    if (paths === null || typeof paths !== 'object' || Array.isArray(paths))
        throw new ApiError(StatusCode.ClientErrorBadRequest, 'INVALID_REQUEST', 'Repository paths are required.');

    res.status(StatusCode.SuccessOK).send(await loadWorkspace(paths));
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

module.exports = router;
