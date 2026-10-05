/**
 * Builds small resources in the format consumed by the real Smogon library.
 *
 * @param {string[]} [formats] Indexed format IDs.
 * @returns {object} Resource paths mapped to JSON fixtures.
 */
function createSmogonFixtures(formats = ["championsou", "gen9ou", "gen9vgc2024"])
{
    const resources = { "/sets/index.json": Object.fromEntries(formats.map((format) => [`${format}.json`, {}])) };
    for (const format of formats)
    {
        const sets =
        {
            "Drought Offense":
            {
                moves: ["Flamethrower", ["Solar Beam", "Air Slash"]],
                ability: "Blaze",
                item: ["Charizardite Y"],
                nature: ["Timid", "Modest"],
                evs: [{ spa: 32, spe: 32 }],
                outdated: true,
            },
            "Fallback": { moves: ["Fire Blast"], ability: "Blaze", item: "Leftovers", nature: "Timid", evs: { spa: 252 } },
        };
        resources[`/sets/${format}.json`] = { Charizard: sets, "Charizard-Mega-X": { "Drought Offense": { ...sets["Drought Offense"], item: ["Charizardite X"] } } };
        resources[`/analyses/${format}.json`] =
        {
            Charizard: { sets: { "Drought Offense": { description: "<p>Use &amp; win.</p><ul><li>Stay fast.</li></ul>" } } },
            "Charizard-Mega-X": { sets: { "Drought Offense": { description: "<p>Mega set.</p>" } } },
        };
    }
    return resources;
}
module.exports.createSmogonFixtures = createSmogonFixtures;

/**
 * Creates an injectable downloader recording each normalized request.
 *
 * @param {object} resources Resource fixtures.
 * @returns {Function} A fetch-compatible fake with calls and offline controls.
 */
function createSmogonFetch(resources)
{
    /**
     * Returns a fixture response or simulates an unavailable resource.
     *
     * @param {string} url The requested URL.
     * @param {object} options Fetch options.
     * @returns {Promise<Response>} The JSON response.
     */
    async function fetchResource(url, options)
    {
        fetchResource.calls.push({ url, options });
        if (fetchResource.offline)
            throw new Error("Offline");
        const resource = resources[new URL(url).pathname];
        return new Response(JSON.stringify(resource ?? {}), { status: resource === undefined ? 404 : 200, headers: { "Content-Type": "application/json" } });
    }
    fetchResource.calls = [];
    fetchResource.offline = false;
    return fetchResource;
}
module.exports.createSmogonFetch = createSmogonFetch;
