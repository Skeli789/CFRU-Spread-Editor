const express = require('express');
const router = express.Router();
const { StatusCode } = require('status-code-enum');

const { resolveCloudImage } = require('../services/assets');
const { getWorkspace } = require('../services/repositories');

const IMAGE_CACHE_CONTROL = 'private, max-age=3600';

// Image elements cannot send the session token, so other websites are kept out by these instead
const IMAGE_HEADERS =
{
    'Cache-Control': IMAGE_CACHE_CONTROL,
    'Cross-Origin-Resource-Policy': 'same-site',
    'X-Content-Type-Options': 'nosniff',
};


/**
 * Serves one of the local Unbound Cloud repository's public images.
 * @route GET /api/images/:workspaceId/:folder/:file
 * @param {string} req.params.workspaceId The workspace ID.
 * @param {string} req.params.folder The image folder: root, items, gen9, gen9Shiny or unboundShinies.
 * @param {string} req.params.file The PNG file name.
 * @returns {File} 200 - The image
 */
router.get('/:workspaceId/:folder/:file', async (req, res) =>
{
    const { workspaceId, folder, file } = req.params;
    const imagePath = await resolveCloudImage(getWorkspace(workspaceId), folder, file);

    await new Promise((resolve, reject) =>
    {
        // A page that stops loading the image is not an error worth reporting
        res.status(StatusCode.SuccessOK).sendFile(imagePath, { headers: IMAGE_HEADERS }, (error) => (error != null && !res.headersSent ? reject(error) : resolve()));
    });
});

module.exports = router;
