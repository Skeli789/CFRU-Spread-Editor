const express = require('express');
const router = express.Router();
const { StatusCode } = require('status-code-enum');


/**
 * Health check endpoint for the API
 * 
 * @route GET /api/health
 * @returns {Object} 200 - Success message
 */
router.get('/', async (req, res) =>
{
    res.status(StatusCode.SuccessOK).send({ message: 'API is working!' });
});

module.exports = router;
