const express = require("express");
const { StatusCode } = require("status-code-enum");
const { progressStore } = require("../services/progress");
const router = express.Router();


/**
 * Returns a path-free snapshot for an authenticated operation UUID.
 * @route POST /api/progress/:id
 * @returns {object} The percentage, label and status.
 */
router.post("/:id", (req, res) =>
{
    res.set("Cache-Control", "no-store").status(StatusCode.SuccessOK).send(progressStore.snapshot(req.params.id));
});

module.exports = router;
