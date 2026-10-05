const express = require("express");
const router = express.Router();
const { StatusCode } = require("status-code-enum");
const { ApiError } = require("../middleware/errors");
const { registerRequestProgress } = require("../middleware/progress");
const { PROGRESS_LABELS } = require("../services/progress");
const { getSmogonSource } = require("../services/smogon");

const MAX_SPECIES = 16;
const MAX_NAME_LENGTH = 64;


/**
 * Returns Smogon sets for the requested species, downloading and saving any format files that are missing or old.
 * @route POST /api/smogon/sets
 * @param {Array<string>} req.body.species The Showdown species names, such as Charizard and Charizard-Mega-X.
 * @param {string} [req.query.progressId] The optional progress operation UUID.
 * @returns {object} 200 - The formats, sets, whether saved copies were used and formats that could not be loaded
 */
router.post("/sets", async (req, res) =>
{
    const names = req.body.species;
    if (!Array.isArray(names) || names.length < 1 || names.length > MAX_SPECIES
        || names.some((name) => typeof name !== "string" || !name.trim() || name.length > MAX_NAME_LENGTH))
        throw new ApiError(StatusCode.ClientErrorBadRequest, "INVALID_REQUEST", `Species must contain 1 to ${MAX_SPECIES} non-empty names of at most ${MAX_NAME_LENGTH} characters.`);

    const progress = registerRequestProgress(req, res, PROGRESS_LABELS.listing);
    try
    {
        const result = await getSmogonSource().getSets(names, { progress });
        progress?.complete();
        res.status(StatusCode.SuccessOK).send(result);
    }
    catch (error)
    {
        progress?.fail();
        throw error;
    }
});

module.exports = router;
