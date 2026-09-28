const express = require('express');
const router = express.Router();
const { StatusCode } = require('status-code-enum');

const { ApiError } = require('../middleware/errors');
const { getSessionToken } = require('../services/session');


/**
 * Issues this server process's session token to the editor page.
 * @route POST /api/session
 * @returns {Object} 200 - {token}
 */
router.post('/', async (req, res) =>
{
    // Browsers always send Origin here, and pages from other origins were already rejected
    if (req.headers.origin === undefined)
        throw new ApiError(StatusCode.ClientErrorForbidden, 'ORIGIN_REQUIRED', 'The session must be requested by the editor page.');

    res.status(StatusCode.SuccessOK).send({ token: getSessionToken() });
});

module.exports = router;
