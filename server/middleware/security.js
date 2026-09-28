/**
 * Middleware that limits the server to the local editor page.
 */

const cors = require("cors");
const express = require("express");
const { StatusCode } = require("status-code-enum");

const { ApiError } = require("./errors");
const { SESSION_HEADER, isValidSessionToken } = require("../services/session");

const DEFAULT_CLIENT_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"];
const ALLOWED_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);
// Saving changes to every spread at once can exceed 1 MB
const JSON_BODY_LIMIT = "4mb";
const JSON_CONTENT_TYPE = "application/json";

// Read when the module loads, so dotenv must be configured before this file is required
const ALLOWED_ORIGINS = new Set(process.env.CLIENT_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? []);
if (ALLOWED_ORIGINS.size === 0)
    DEFAULT_CLIENT_ORIGINS.forEach((origin) => ALLOWED_ORIGINS.add(origin));


/**
 * Rejects requests addressed to a non-local host name, which blocks DNS rebinding.
 *
 * @param {object} req The request.
 * @param {object} res The response.
 * @param {Function} next The next handler.
 */
function allowLocalHostsOnly(req, res, next)
{
    const hostname = (req.headers.host ?? "").replace(/:\d+$/, "").toLowerCase();
    if (!ALLOWED_HOSTNAMES.has(hostname))
        throw new ApiError(StatusCode.ClientErrorForbidden, "HOST_NOT_ALLOWED", "This server only accepts local requests.");

    next();
}
module.exports.allowLocalHostsOnly = allowLocalHostsOnly;

/**
 * Rejects requests sent by other websites.
 *
 * @param {object} req The request.
 * @param {object} res The response.
 * @param {Function} next The next handler.
 */
function allowEditorOriginsOnly(req, res, next)
{
    const origin = req.headers.origin;
    if (origin !== undefined && !ALLOWED_ORIGINS.has(origin))
        throw new ApiError(StatusCode.ClientErrorForbidden, "ORIGIN_NOT_ALLOWED", "This website is not allowed to use the editor server.");

    next();
}
module.exports.allowEditorOriginsOnly = allowEditorOriginsOnly;

/**
 * Allows the editor page to call the API when it is served from a different port.
 */
const editorCors = cors({ origin: [...ALLOWED_ORIGINS], allowedHeaders: ["Content-Type", SESSION_HEADER] });
module.exports.editorCors = editorCors;

/**
 * Rejects request bodies that are not JSON.
 *
 * @param {object} req The request.
 * @param {object} res The response.
 * @param {Function} next The next handler.
 */
function requireJsonBody(req, res, next)
{
    // Empty POST requests still send Content-Length: 0
    const hasContent = req.headers["transfer-encoding"] !== undefined || Number(req.headers["content-length"]) > 0;
    if (hasContent && !req.is(JSON_CONTENT_TYPE))
        throw new ApiError(StatusCode.ClientErrorUnsupportedMediaType, "UNSUPPORTED_MEDIA_TYPE", "Requests must be sent as JSON.");

    next();
}
module.exports.requireJsonBody = requireJsonBody;

/**
 * Parses JSON request bodies up to a bounded size.
 */
const parseJsonBody = express.json({ limit: JSON_BODY_LIMIT });
module.exports.parseJsonBody = parseJsonBody;

/**
 * Rejects JSON bodies that are not objects, so routes can destructure them safely.
 *
 * @param {object} req The request.
 * @param {object} res The response.
 * @param {Function} next The next handler.
 */
function requireObjectBody(req, res, next)
{
    if (req.body !== undefined && (req.body === null || typeof req.body !== "object" || Array.isArray(req.body)))
        throw new ApiError(StatusCode.ClientErrorBadRequest, "INVALID_REQUEST", "The request body must be a JSON object.");

    next();
}
module.exports.requireObjectBody = requireObjectBody;

/**
 * Requires this server process's session token.
 *
 * @param {object} req The request.
 * @param {object} res The response.
 * @param {Function} next The next handler.
 */
function requireSession(req, res, next)
{
    if (!isValidSessionToken(req.get(SESSION_HEADER)))
        throw new ApiError(StatusCode.ClientErrorUnauthorized, "SESSION_INVALID", "The editor session has expired. Reconnecting will start a new one.");

    next();
}
module.exports.requireSession = requireSession;
