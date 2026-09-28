/**
 * Error types and the handlers that turn errors into JSON API responses.
 */

const { StatusCode } = require("status-code-enum");

const BODY_TOO_LARGE = "entity.too.large";
const BODY_PARSE_FAILED = "entity.parse.failed";


/**
 * An error with an HTTP status and a stable machine-readable code.
 */
class ApiError extends Error
{
    /**
     * Creates an API error.
     *
     * @param {number} status The HTTP status.
     * @param {string} code The machine-readable error code.
     * @param {string} message The user-facing message.
     * @param {object} [details] Optional structured details.
     */
    constructor(status, code, message, details)
    {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
    }
}
module.exports.ApiError = ApiError;

/**
 * Sends an error in the standard API error format.
 *
 * @param {object} res The response.
 * @param {number} status The HTTP status.
 * @param {string} code The machine-readable error code.
 * @param {string} message The user-facing message.
 * @param {object} [details] Optional structured details.
 */
function sendError(res, status, code, message, details)
{
    res.status(status).send({ error: { code, message, ...(details !== undefined ? { details } : {}) } });
}

/**
 * Responds to API routes that do not exist.
 *
 * @param {object} req The request.
 * @param {object} res The response.
 */
function handleUnknownApiRoute(req, res)
{
    sendError(res, StatusCode.ClientErrorNotFound, "NOT_FOUND", "This API route does not exist.");
}
module.exports.handleUnknownApiRoute = handleUnknownApiRoute;

/**
 * Converts thrown errors into the standard API error format.
 *
 * @param {Error} error The error.
 * @param {object} req The request.
 * @param {object} res The response.
 * @param {Function} next The next handler, required for Express to treat this as an error handler.
 */
function handleErrors(error, req, res, next)
{
    // Errors from the JSON body parser
    if (error.type === BODY_TOO_LARGE)
        return sendError(res, StatusCode.ClientErrorPayloadTooLarge, "REQUEST_TOO_LARGE", "The request is too large.");
    if (error.type === BODY_PARSE_FAILED)
        return sendError(res, StatusCode.ClientErrorBadRequest, "INVALID_JSON", "The request is not valid JSON.");

    // Expected errors raised by the editor
    if (error instanceof ApiError)
        return sendError(res, error.status, error.code, error.message, error.details);

    // Anything else is a bug, so keep the details out of the response
    console.error(error);
    sendError(res, StatusCode.ServerErrorInternal, "INTERNAL_ERROR", "The editor server hit an unexpected error.");
}
module.exports.handleErrors = handleErrors;
