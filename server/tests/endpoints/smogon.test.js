const { expect } = require("chai");
const fs = require("fs");
const os = require("os");
const path = require("path");
const request = require("supertest");
const { StatusCode } = require("status-code-enum");
const { createSmogonFixtures, createSmogonFetch } = require("../helpers/smogon-fixtures");

const ALLOWED_ORIGIN = "http://localhost:3000";
const SESSION_HEADER = "X-Session-Token";
const DATA_DIRECTORY_ENV = "SPREAD_EDITOR_DATA_DIR";
const SERVER_ROOT = path.resolve(__dirname, "..", "..");
const FIRST_LOAD_TIMEOUT_MS = 30000;
const PROGRESS_ID = "710fb1fa-4579-4ffd-8c20-dd72859f19f0";


/**
 * Loads a fresh server and session without invalidating dependencies or test modules.
 *
 * @returns {object} The Express app.
 */
function startServer()
{
    for (const modulePath of Object.keys(require.cache))
    {
        const relative = path.relative(SERVER_ROOT, modulePath);
        if (!relative.startsWith("..") && !relative.startsWith("node_modules") && !relative.startsWith("tests"))
            delete require.cache[modulePath];
    }
    return require("../../server").app;
}

describe("Smogon API endpoints", () =>
{
    let directory;
    let originalDirectory;
    let app;
    let token;
    let service;
    let fetchResource;

    beforeEach(async function ()
    {
        this.timeout(FIRST_LOAD_TIMEOUT_MS);
        directory = fs.mkdtempSync(path.join(os.tmpdir(), "smogon-endpoint-"));
        originalDirectory = process.env[DATA_DIRECTORY_ENV];
        process.env[DATA_DIRECTORY_ENV] = directory;
        app = startServer();
        service = require("../../services/smogon");
        fetchResource = createSmogonFetch(createSmogonFixtures());
        service.setSmogonSource(service.createSmogonSource({ fetchResource }));
        const response = await request(app).post("/api/session").set("Origin", ALLOWED_ORIGIN);
        expect(response.status).to.equal(StatusCode.SuccessOK);
        token = response.body.token;
    });

    afterEach(() =>
    {
        service?.setSmogonSource();
        if (originalDirectory === undefined)
            delete process.env[DATA_DIRECTORY_ENV];
        else
            process.env[DATA_DIRECTORY_ENV] = originalDirectory;
        fs.rmSync(directory, { recursive: true, force: true });
    });

    it("requires a session token before consulting the source", async () =>
    {
        const response = await request(app).post("/api/smogon/sets").set("Origin", ALLOWED_ORIGIN).send({ species: ["Charizard"] });
        expect(response.status).to.equal(StatusCode.ClientErrorUnauthorized);
        expect(response.body.error.code).to.equal("SESSION_INVALID");
        expect(fetchResource.calls).to.have.length(0);
    });

    for (const [label, body] of
    [
        ["missing species", {}],
        ["non-array species", { species: "Charizard" }],
        ["empty array", { species: [] }],
        ["too many names", { species: Array(17).fill("Charizard") }],
        ["empty name", { species: [""] }],
        ["whitespace name", { species: ["   "] }],
        ["non-string name", { species: [42] }],
        ["null name", { species: [null] }],
        ["overlong name", { species: ["a".repeat(65)] }],
    ])
    {
        it(`rejects ${label}`, async () =>
        {
            const response = await request(app).post("/api/smogon/sets").set("Origin", ALLOWED_ORIGIN).set(SESSION_HEADER, token).send(body);
            expect(response.status).to.equal(StatusCode.ClientErrorBadRequest);
            expect(response.body.error.code).to.equal("INVALID_REQUEST");
            expect(fetchResource.calls).to.have.length(0);
        });
    }

    it("returns the exact contract with plain descriptions and caches only in temporary storage", async () =>
    {
        const response = await request(app).post("/api/smogon/sets").set("Origin", ALLOWED_ORIGIN).set(SESSION_HEADER, token).send({ species: ["Charizard", "Charizard-Mega-X"] });
        expect(response.status).to.equal(StatusCode.SuccessOK);
        expect(response.body).to.have.all.keys("formats", "sets", "stale", "unavailable");
        expect(response.body.formats[0]).to.deep.equal({ id: "championsou", tab: "champions", category: "singles", label: "OU" });
        expect(response.body.sets[0]).to.have.all.keys("format", "species", "name", "description", "moveset");
        expect(response.body.sets[0].description).to.equal("Use & win.\n\n\u2022 Stay fast.");
        expect(response.body.sets[0].moveset.moves[1]).to.deep.equal(["Solar Beam", "Air Slash"]);
        expect(response.body.sets).to.have.length(9);
        expect(response.body.sets[2]).to.include({ species: "Charizard-Mega-X", name: "Drought Offense (Mega X)" });
        expect(response.body.stale).to.equal(false);
        expect(response.body.unavailable).to.deep.equal([]);
        expect(fs.existsSync(path.join(directory, "cache", "smogon", "sets", "index.json"))).to.equal(true);
    });

    it("accepts the maximum number and length of names", async () =>
    {
        const species = Array(16).fill("a".repeat(64));
        let queried;
        service.setSmogonSource(
        {
            /**
             * Records the validated endpoint arguments.
             *
             * @param {string[]} names The requested species names.
             * @returns {Promise<object>} An empty source result.
             */
            async getSets(names)
            {
                queried = names;
                return { formats: [], sets: [], stale: false, unavailable: [] };
            },
        });
        const response = await request(app).post("/api/smogon/sets").set("Origin", ALLOWED_ORIGIN).set(SESSION_HEADER, token).send({ species });
        expect(response.status).to.equal(StatusCode.SuccessOK);
        expect(queried).to.deep.equal(species);
    });

    it("returns the first-use offline message as a 503 API error", async () =>
    {
        fetchResource.offline = true;
        const response = await request(app).post("/api/smogon/sets").set("Origin", ALLOWED_ORIGIN).set(SESSION_HEADER, token).send({ species: ["Charizard"] });
        expect(response.status).to.equal(StatusCode.ServerErrorServiceUnavailable);
        expect(response.body.error).to.deep.equal({ code: "SMOGON_UNAVAILABLE", message: "Smogon sets need an internet connection the first time." });
    });

    it("tracks real running progress and completes the registered operation", async () =>
    {
        let release;
        let started;
        const gate = new Promise((resolve) => { release = resolve; });
        const loading = new Promise((resolve) => { started = resolve; });
        service.setSmogonSource(service.createSmogonSource(
        {
            /**
             * Pauses the second format until its running progress can be inspected.
             *
             * @param {string} url The fixture resource URL.
             * @param {object} options The fetch options.
             * @returns {Promise<Response>} The fake response.
             */
            async fetchResource(url, options)
            {
                if (new URL(url).pathname === "/sets/gen9ou.json")
                {
                    started();
                    await gate;
                }
                return fetchResource(url, options);
            },
        }));
        const pending = request(app).post("/api/smogon/sets").query({ progressId: PROGRESS_ID })
            .set("Origin", ALLOWED_ORIGIN).set(SESSION_HEADER, token).send({ species: ["Charizard"] }).then((response) => response);
        await loading;
        const { progressStore, PROGRESS_LABELS } = require("../../services/progress");
        let running;
        try
        {
            running = progressStore.snapshot(PROGRESS_ID);
        }
        finally
        {
            release();
        }
        const response = await pending;
        expect(running).to.deep.equal({ percentage: 33, label: PROGRESS_LABELS.reading, status: "running" });
        expect(response.status).to.equal(StatusCode.SuccessOK);
        expect(progressStore.snapshot(PROGRESS_ID)).to.deep.equal({ percentage: 100, label: PROGRESS_LABELS.complete, status: "complete" });
    });

    it("marks a registered operation failed when the source cannot load", async () =>
    {
        fetchResource.offline = true;
        const response = await request(app).post("/api/smogon/sets").query({ progressId: PROGRESS_ID })
            .set("Origin", ALLOWED_ORIGIN).set(SESSION_HEADER, token).send({ species: ["Charizard"] });
        const { progressStore, PROGRESS_LABELS } = require("../../services/progress");
        expect(response.status).to.equal(StatusCode.ServerErrorServiceUnavailable);
        expect(progressStore.snapshot(PROGRESS_ID)).to.deep.equal({ percentage: 0, label: PROGRESS_LABELS.failed, status: "failed" });
    });

    it("rejects invalid progress IDs before downloading", async () =>
    {
        const response = await request(app).post("/api/smogon/sets").query({ progressId: "invalid" })
            .set("Origin", ALLOWED_ORIGIN).set(SESSION_HEADER, token).send({ species: ["Charizard"] });
        expect(response.status).to.equal(StatusCode.ClientErrorBadRequest);
        expect(response.body.error.code).to.equal("INVALID_PROGRESS_ID");
        expect(fetchResource.calls).to.have.length(0);
    });
});
