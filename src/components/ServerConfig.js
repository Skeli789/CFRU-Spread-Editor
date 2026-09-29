/**
 * Configuration file for connecting to the development server.
 */

const DEV_SERVER = import.meta.env.VITE_DEV_SERVER ?? ""; // If it's an environment variable, then use it
const API_PATH_PREFIX = "/api/";

export const config =
{
    devServer: DEV_SERVER,
};

/**
 * Returns a URL the browser can load, sending paths on the editor server, such as local images, to it.
 *
 * @param {string|null} url The URL or server path.
 * @returns {string|null} The URL.
 */
export function resolveServerUrl(url)
{
    return typeof url === "string" && url.startsWith(API_PATH_PREFIX) ? `${config.devServer}${url}` : url;
}
