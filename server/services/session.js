/**
 * The session token that authorizes the editor page to use filesystem routes.
 * A new token is created each time the server starts.
 */

const crypto = require("crypto");

const SESSION_HEADER = "X-Session-Token";
module.exports.SESSION_HEADER = SESSION_HEADER;
const SESSION_TOKEN_BYTES = 32;
const SESSION_TOKEN = crypto.randomBytes(SESSION_TOKEN_BYTES).toString("hex");


/**
 * Returns this server process's session token.
 *
 * @returns {string} The token.
 */
function getSessionToken()
{
    return SESSION_TOKEN;
}
module.exports.getSessionToken = getSessionToken;

/**
 * Returns whether a provided value is this server process's session token.
 *
 * @param {*} value The provided token.
 * @returns {boolean} Whether the token is valid.
 */
function isValidSessionToken(value)
{
    const provided = Buffer.from(String(value ?? ""));
    const expected = Buffer.from(SESSION_TOKEN);
    return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}
module.exports.isValidSessionToken = isValidSessionToken;
