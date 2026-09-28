const express = require('express');
const router = express.Router();
const { StatusCode } = require('status-code-enum');

const { pickRepository } = require('../services/repositories');


/**
 * Opens the native folder dialog for a repository.
 * @route POST /api/repositories/pick
 * @param {string} req.body.repository The repository kind: cfru, dpe or cloud.
 * @param {string} [req.body.startPath] The folder to start in.
 * @returns {Object} 200 - {status: "selected", path} or {status: "cancelled"}
 */
router.post('/pick', async (req, res) =>
{
    const { repository, startPath } = req.body ?? {};

    // Close the dialog if the page that opened it is reloaded or closed
    const abortController = new AbortController();
    res.on('close', () => abortController.abort());

    res.status(StatusCode.SuccessOK).send(await pickRepository(repository, startPath, abortController.signal));
});

module.exports = router;
