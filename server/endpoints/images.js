const express = require('express');
const router = express.Router();
const { StatusCode } = require('status-code-enum');

const { resolveCloudImage } = require('../services/assets');
const { getWorkspace } = require('../services/repositories');
const { renderSprite } = require('../services/sprites');
const { getTypeImageCache } = require('../services/type-images');

const IMAGE_CACHE_CONTROL = 'private, max-age=3600';
const PNG_CONTENT_TYPE = 'image/png';

// Image elements cannot send the session token, so other websites are kept out by these instead
const IMAGE_HEADERS =
{
    'Cache-Control': IMAGE_CACHE_CONTROL,
    'Cross-Origin-Resource-Policy': 'same-site',
    'X-Content-Type-Options': 'nosniff',
};


/**
 * Serves a species' sprite drawn from the local DPE repository's graphics.
 * @route GET /api/images/:workspaceId/sprites/:variant/:file
 * @param {string} req.params.workspaceId The workspace ID.
 * @param {string} req.params.variant normal or shiny.
 * @param {string} req.params.file The species' constant with .png, such as SPECIES_CHARIZARD.png.
 * @returns {File} 200 - The image
 */
router.get('/:workspaceId/sprites/:variant/:file', async (req, res) =>
{
    const { workspaceId, variant, file } = req.params;
    const image = await renderSprite(getWorkspace(workspaceId), variant, file);
    res.status(StatusCode.SuccessOK).set(IMAGE_HEADERS).type(PNG_CONTENT_TYPE).send(image);
});

/**
 * Serves a cached type symbol or full banner without downloading on image requests.
 * @route GET /api/images/:workspaceId/types/:variant/:file
 * @param {string} req.params.workspaceId The workspace ID.
 * @param {string} req.params.variant symbol or full.
 * @param {string} req.params.file The lowercase type name with .png.
 * @returns {File} 200 - The image
 */
router.get('/:workspaceId/types/:variant/:file', async (req, res) =>
{
    const { workspaceId, variant, file } = req.params;
    getWorkspace(workspaceId);
    const image = await getTypeImageCache().readImage(variant, file);
    res.status(StatusCode.SuccessOK).set(IMAGE_HEADERS).type(PNG_CONTENT_TYPE).send(image);
});

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
