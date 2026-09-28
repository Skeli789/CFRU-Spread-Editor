/**
 * Test file for the session, repositories and workspaces endpoints.
 * Tests local access security, folder picking, repository loading and catalog loading.
 */

const { expect } = require("chai");
const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");
const request = require("supertest");
const { StatusCode } = require("status-code-enum");

const { createPokeApiFetch } = require("../helpers/catalog-fixtures");
const { createFixtureRepositories } = require("../helpers/fixture-repositories");

const ALLOWED_ORIGIN = "http://localhost:3000";
const SESSION_HEADER = "X-Session-Token";
const MISSING_WORKSPACE_ID = "00000000-0000-4000-8000-000000000000";
const SERVER_ROOT = path.resolve(__dirname, "..", "..");
const SERVER_ENTRY = path.join(SERVER_ROOT, "server.js");
const ORIGINAL_EXEC_FILE = childProcess.execFile;
const FIRST_LOAD_TIMEOUT_MS = 30000;
const ABANDON_REQUEST_MS = 200;
const DATA_DIRECTORY_ENV = "SPREAD_EDITOR_DATA_DIR";
const BATTLE_TOWER_FILE = "src/Tables/battle_tower_spreads.h";
const describeOnWindows = process.platform === "win32" ? describe : describe.skip;


/**
 * Loads the server as a newly started process would, with a new session token and no workspaces.
 *
 * @returns {object} The Express app.
 */
function startServer()
{
    for (const modulePath of Object.keys(require.cache))
    {
        const relativePath = path.relative(SERVER_ROOT, modulePath);
        const isServerModule = !relativePath.startsWith("..") && !relativePath.startsWith("node_modules") && !relativePath.startsWith("tests");
        if (isServerModule)
            delete require.cache[modulePath];
    }

    return require(SERVER_ENTRY).app;
}

/**
 * Replaces the folder dialog process with a fake that reports a fixed result.
 *
 * @param {Error|null} error The process error to report.
 * @param {string} [stdout] The process output.
 * @returns {Array<object>} The options of each recorded call.
 */
function stubPickerProcess(error, stdout = "")
{
    const calls = [];
    childProcess.execFile = (file, args, options, callback) =>
    {
        calls.push(options);
        setImmediate(() => callback(error, stdout));
    };

    return calls;
}

/**
 * Requests a session token from an app.
 *
 * @param {object} app The app.
 * @returns {Promise<string>} The token.
 */
async function getToken(app)
{
    const res = await request(app).post("/api/session").set("Origin", ALLOWED_ORIGIN);
    expect(res.status).to.equal(StatusCode.SuccessOK);
    return res.body.token;
}

/**
 * Sends an authorized JSON POST request.
 *
 * @param {object} app The app.
 * @param {string} token The session token.
 * @param {string} url The route.
 * @param {object} body The JSON body.
 * @returns {Promise<object>} The response.
 */
function post(app, token, url, body)
{
    return request(app).post(url).set("Origin", ALLOWED_ORIGIN).set(SESSION_HEADER, token).send(body);
}

describe("Workspace API Endpoints", () =>
{
    let fixture;
    let app;
    let token;
    const originalDataDirectory = process.env[DATA_DIRECTORY_ENV];

    before(function ()
    {
        // The first load includes dependencies such as the native parser; later restarts reuse them
        this.timeout(FIRST_LOAD_TIMEOUT_MS);
        startServer();
    });

    beforeEach(async () =>
    {
        // Backups and journals from saves stay inside the disposable fixture
        fixture = createFixtureRepositories();
        process.env[DATA_DIRECTORY_ENV] = path.join(fixture.base, "editor data");
        app = startServer();
        token = await getToken(app);
    });

    afterEach(() =>
    {
        childProcess.execFile = ORIGINAL_EXEC_FILE;
        fixture.cleanup();
    });

    after(() =>
    {
        if (originalDataDirectory === undefined)
            delete process.env[DATA_DIRECTORY_ENV];
        else
            process.env[DATA_DIRECTORY_ENV] = originalDataDirectory;
    });

    describe("Local access security", () =>
    {
        it("should reject a session request without an Origin", async () =>
        {
            const res = await request(app).post("/api/session");
            expect(res.status).to.equal(StatusCode.ClientErrorForbidden);
            expect(res.body.error.code).to.equal("ORIGIN_REQUIRED");
        });

        it("should reject requests from another website", async () =>
        {
            const res = await request(app).post("/api/session").set("Origin", "https://evil.example");
            expect(res.status).to.equal(StatusCode.ClientErrorForbidden);
            expect(res.body.error.code).to.equal("ORIGIN_NOT_ALLOWED");
            expect(res.body).to.not.have.property("token");
        });

        it("should reject requests addressed to a non-local host", async () =>
        {
            const res = await request(app).post("/api/session").set("Origin", ALLOWED_ORIGIN).set("Host", "evil.example:3001");
            expect(res.status).to.equal(StatusCode.ClientErrorForbidden);
            expect(res.body.error.code).to.equal("HOST_NOT_ALLOWED");
        });

        it("should allow CORS only for the editor origin", async () =>
        {
            const res = await request(app).options("/api/workspaces/load").set("Origin", ALLOWED_ORIGIN)
                .set("Access-Control-Request-Method", "POST").set("Access-Control-Request-Headers", `content-type,${SESSION_HEADER}`);
            expect(res.headers["access-control-allow-origin"]).to.equal(ALLOWED_ORIGIN);
            expect(res.headers["access-control-allow-headers"].toLowerCase()).to.include(SESSION_HEADER.toLowerCase());
        });

        it("should reject filesystem routes without a session token", async () =>
        {
            const res = await request(app).post("/api/workspaces/load").set("Origin", ALLOWED_ORIGIN).send({ paths: fixture.paths });
            expect(res.status).to.equal(StatusCode.ClientErrorUnauthorized);
            expect(res.body.error.code).to.equal("SESSION_INVALID");
        });

        it("should reject a wrong session token", async () =>
        {
            const res = await post(app, "a".repeat(token.length), "/api/workspaces/load", { paths: fixture.paths });
            expect(res.status).to.equal(StatusCode.ClientErrorUnauthorized);
        });

        it("should reject non-JSON bodies", async () =>
        {
            const res = await request(app).post("/api/workspaces/load").set("Origin", ALLOWED_ORIGIN).set(SESSION_HEADER, token)
                .set("Content-Type", "text/plain").send("paths");
            expect(res.status).to.equal(StatusCode.ClientErrorUnsupportedMediaType);
        });

        it("should reject malformed JSON", async () =>
        {
            const res = await request(app).post("/api/workspaces/load").set("Origin", ALLOWED_ORIGIN).set(SESSION_HEADER, token)
                .set("Content-Type", "application/json").send("{\"paths\":");
            expect(res.status).to.equal(StatusCode.ClientErrorBadRequest);
            expect(res.body.error.code).to.equal("INVALID_JSON");
        });

        it("should reject JSON bodies that are not objects", async () =>
        {
            const res = await post(app, token, "/api/workspaces/load", [fixture.paths.cfru]);
            expect(res.status).to.equal(StatusCode.ClientErrorBadRequest);
            expect(res.body.error.code).to.equal("INVALID_REQUEST");
        });

        it("should reject oversized bodies", async () =>
        {
            const res = await post(app, token, "/api/workspaces/load", { paths: fixture.paths, padding: "x".repeat(5 * 1024 * 1024) });
            expect(res.status).to.equal(StatusCode.ClientErrorPayloadTooLarge);
            expect(res.body.error.code).to.equal("REQUEST_TOO_LARGE");
        });

        it("should return JSON for unknown API routes", async () =>
        {
            const res = await post(app, token, "/api/workspaces", {});
            expect(res.status).to.equal(StatusCode.ClientErrorNotFound);
            expect(res.body.error.code).to.equal("NOT_FOUND");
        });
    });

    describeOnWindows("POST /api/repositories/pick", () =>
    {
        it("should return the selected folder", async () =>
        {
            const calls = stubPickerProcess(null, JSON.stringify({ status: "selected", path: fixture.paths.cfru }));

            const res = await post(app, token, "/api/repositories/pick", { repository: "cfru", startPath: fixture.base });
            expect(res.status).to.equal(StatusCode.SuccessOK);
            expect(res.body).to.deep.equal({ status: "selected", path: fixture.paths.cfru });
            expect(calls[0].env.CFRU_EDITOR_PICKER_START).to.equal(fixture.base);
            expect(calls[0].env.CFRU_EDITOR_PICKER_TITLE).to.include("Complete Fire Red Upgrade");
        });

        it("should report cancellation as a normal result", async () =>
        {
            stubPickerProcess(null, JSON.stringify({ status: "cancelled" }));

            const res = await post(app, token, "/api/repositories/pick", { repository: "dpe" });
            expect(res.status).to.equal(StatusCode.SuccessOK);
            expect(res.body).to.deep.equal({ status: "cancelled" });
        });

        it("should reject unknown repository types without opening a dialog", async () =>
        {
            const calls = stubPickerProcess(null, JSON.stringify({ status: "cancelled" }));

            const res = await post(app, token, "/api/repositories/pick", { repository: "../etc" });
            expect(res.status).to.equal(StatusCode.ClientErrorBadRequest);
            expect(res.body.error.code).to.equal("INVALID_REPOSITORY");
            expect(calls).to.have.length(0);
        });

        it("should report denied permissions", async () =>
        {
            stubPickerProcess(Object.assign(new Error("Denied"), { code: "EACCES" }));

            const res = await post(app, token, "/api/repositories/pick", { repository: "cloud" });
            expect(res.status).to.equal(StatusCode.ClientErrorForbidden);
            expect(res.body.error.code).to.equal("PICKER_PERMISSION_DENIED");
        });

        it("should close the dialog when the page stops waiting, so a reloaded page can open another", async () =>
        {
            let closeDialog;
            const dialogClosed = new Promise((resolve) => { closeDialog = resolve; });
            childProcess.execFile = (file, args, options, callback) =>
            {
                options.signal.addEventListener("abort", () =>
                {
                    callback(Object.assign(new Error("Aborted"), { name: "AbortError" }), "");
                    closeDialog();
                });
            };

            let abandoned;
            try
            {
                await post(app, token, "/api/repositories/pick", { repository: "cfru" }).timeout(ABANDON_REQUEST_MS);
            }
            catch (error)
            {
                abandoned = error;
            }
            expect(abandoned.timeout).to.equal(ABANDON_REQUEST_MS);
            await dialogClosed;

            stubPickerProcess(null, JSON.stringify({ status: "cancelled" }));
            const res = await post(app, token, "/api/repositories/pick", { repository: "cfru" });
            expect(res.status).to.equal(StatusCode.SuccessOK);
            expect(res.body).to.deep.equal({ status: "cancelled" });
        });
    });

    describe("POST /api/workspaces/load", () =>
    {
        it("should load valid repositories and list games in Cloud order", async () =>
        {
            const res = await post(app, token, "/api/workspaces/load", { paths: fixture.paths });
            expect(res.status).to.equal(StatusCode.SuccessOK);
            expect(res.body.workspaceId).to.match(/^[0-9a-f-]{36}$/);
            expect(res.body.games).to.deep.equal(
            [
                { id: "cfru", name: "Official Games" },
                { id: "alpha", name: "Alpha Version" },
                { id: "zeta", name: "Zeta Version" },
            ]);
            expect(res.body.repositories.cfru.path).to.equal(fs.realpathSync.native(fixture.paths.cfru));

            const unavailable = res.body.diagnostics.filter((diagnostic) => diagnostic.code === "GAME_UNAVAILABLE");
            expect(unavailable.map((diagnostic) => diagnostic.message).join(" ")).to.include("Missing Files").and.include("Unlisted Data");
        });

        it("should include the active spreads and their trainers", async () =>
        {
            const res = await post(app, token, "/api/workspaces/load", { paths: fixture.paths });
            const { spreads } = res.body;
            expect(spreads.revision).to.match(/^[0-9a-f]{64}$/);
            expect(spreads.entries).to.have.length(15);
            expect(spreads.sets.map((set) => set.name)).to.include.members(["gFrontierSpreads", "gMultiTowerSpread_Milo", "sRaidPartnerSpread_Catherine_Rank12"]);
            expect(spreads.trainers.map((trainer) => trainer.name)).to.include.members(["Palmer", "Milo", "Catherine"]);
            expect(res.body.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).to.deep.equal([]);
        });

        it("should canonicalize paths containing parent segments", async () =>
        {
            const indirect = path.join(fixture.paths.dpe, "..", path.basename(fixture.paths.cfru));
            const res = await post(app, token, "/api/workspaces/load", { paths: { ...fixture.paths, cfru: indirect } });
            expect(res.status).to.equal(StatusCode.SuccessOK);
            expect(res.body.repositories.cfru.path).to.equal(fs.realpathSync.native(fixture.paths.cfru));
        });

        it("should report every missing repository", async () =>
        {
            const res = await post(app, token, "/api/workspaces/load",
                { paths: { cfru: path.join(fixture.base, "nope"), dpe: "", cloud: fixture.paths.cloud } });
            expect(res.status).to.equal(StatusCode.ClientErrorUnprocessableEntity);
            expect(res.body.error.code).to.equal("REPOSITORY_VALIDATION_FAILED");
            expect(res.body.error.details.fields.cfru.code).to.equal("REPOSITORY_NOT_FOUND");
            expect(res.body.error.details.fields.dpe.code).to.equal("PATH_REQUIRED");
            expect(res.body.error.details.fields).to.not.have.property("cloud");
        });

        it("should report a repository that was moved after being saved", async () =>
        {
            const movedPath = `${fixture.paths.cfru} moved`;
            fs.renameSync(fixture.paths.cfru, movedPath);

            const res = await post(app, token, "/api/workspaces/load", { paths: fixture.paths });
            expect(res.body.error.details.fields.cfru.code).to.equal("REPOSITORY_NOT_FOUND");
        });

        it("should identify a repository entered in the wrong field", async () =>
        {
            const res = await post(app, token, "/api/workspaces/load",
                { paths: { cfru: fixture.paths.dpe, dpe: fixture.paths.cfru, cloud: fixture.paths.cloud } });
            const { cfru, dpe } = res.body.error.details.fields;
            expect(cfru.code).to.equal("REPOSITORY_INVALID_STRUCTURE");
            expect(cfru.message).to.include("looks like the Dynamic Pokemon Expansion repository");
            expect(dpe.message).to.include("looks like the Complete Fire Red Upgrade repository");
        });

        it("should reject relative, network and non-string paths", async () =>
        {
            const res = await post(app, token, "/api/workspaces/load",
                { paths: { cfru: "relative\\cfru", dpe: "\\\\server\\share\\dpe", cloud: 42 } });
            const { fields } = res.body.error.details;
            expect(fields.cfru.code).to.equal("PATH_NOT_ABSOLUTE");
            expect(fields.dpe.code).to.equal("PATH_UNSUPPORTED");
            expect(fields.cloud.code).to.equal("PATH_REQUIRED");
        });

        it("should reject a file given as a repository folder", async () =>
        {
            const res = await post(app, token, "/api/workspaces/load",
                { paths: { ...fixture.paths, cfru: path.join(fixture.paths.cfru, "src", "config.h") } });
            expect(res.body.error.details.fields.cfru.code).to.equal("PATH_NOT_DIRECTORY");
        });

        it("should reject required files that link outside the repository", async () =>
        {
            const tablesPath = path.join(fixture.paths.cfru, "src", "Tables");
            const outsidePath = path.join(fixture.base, "outside tables");
            fs.renameSync(tablesPath, outsidePath);
            fs.symlinkSync(outsidePath, tablesPath, "junction");

            const res = await post(app, token, "/api/workspaces/load", { paths: fixture.paths });
            const { cfru } = res.body.error.details.fields;
            expect(cfru.code).to.equal("REPOSITORY_INVALID_STRUCTURE");
            expect(cfru.missing.map((problem) => problem.code)).to.include("PATH_OUTSIDE_REPOSITORY");
        });

        it("should accept a repository folder that is itself a link", async () =>
        {
            const linkPath = path.join(fixture.base, "cfru link");
            fs.symlinkSync(fixture.paths.cfru, linkPath, "junction");

            const res = await post(app, token, "/api/workspaces/load", { paths: { ...fixture.paths, cfru: linkPath } });
            expect(res.status).to.equal(StatusCode.SuccessOK);
            expect(res.body.repositories.cfru.path).to.equal(fs.realpathSync.native(fixture.paths.cfru));
        });

        it("should reject a missing paths object", async () =>
        {
            const res = await post(app, token, "/api/workspaces/load", { paths: ["C:\\"] });
            expect(res.status).to.equal(StatusCode.ClientErrorBadRequest);
        });
    });

    describe("POST /api/workspaces/:id/catalog", () =>
    {
        const originalFetch = globalThis.fetch;
        let workspaceId;

        beforeEach(async () =>
        {
            globalThis.fetch = createPokeApiFetch();
            workspaceId = (await post(app, token, "/api/workspaces/load", { paths: fixture.paths })).body.workspaceId;
        });

        afterEach(() =>
        {
            globalThis.fetch = originalFetch;
        });

        it("should load the selected game's catalog", async () =>
        {
            const res = await post(app, token, `/api/workspaces/${workspaceId}/catalog`, { gameId: "cfru" });
            expect(res.status).to.equal(StatusCode.SuccessOK);
            expect(res.body).to.include({ gameId: "cfru", name: "Official Games" });
            expect(res.body.entryCounts).to.deep.equal({ baseStats: 18, moves: 30, items: 5, ballTypes: 2, learnsets: 12 });
            expect(res.body.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).to.deep.equal([]);
        });

        it("should describe species with Cloud's stats and names, DPE's battle forms and PokeAPI sprites", async () =>
        {
            const { species, diagnostics } = (await post(app, token, `/api/workspaces/${workspaceId}/catalog`, { gameId: "cfru" })).body;
            expect(species).to.not.have.property("SPECIES_NONE");
            expect(species.SPECIES_CHARIZARD).to.deep.include(
            {
                name: "Charizard",
                dex: "NATIONAL_DEX_CHARIZARD",
                dexNumber: 6,
                baseStats: { hp: 78, atk: 84, def: 78, spAtk: 109, spDef: 85, spd: 100 },
                types: ["TYPE_FIRE", "TYPE_FLYING"],
                abilities: ["ABILITY_SOLARPOWER", "ABILITY_BLAZE", null],
                gigantamax: { species: "SPECIES_CHARIZARD_GIGA", available: true },
            });
            expect(species.SPECIES_CHARIZARD.megas.map((mega) => [mega.item, mega.available])).to.deep.equal([["ITEM_CHARIZARDITE_X", true], ["ITEM_CHARIZARDITE_Y", false]]);
            expect(species.SPECIES_CHARIZARD.sprite.normal).to.equal("https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/6.png");
            expect(species.SPECIES_CHARIZARD_GIGA.sprite.normal).to.match(/\/10196\.png$/);
            expect(species.SPECIES_LYCANROC_N.sprite.normal).to.match(/\/10126\.png$/);
            expect(species.SPECIES_PIKACHU_SURFING).to.include({ name: "Pikachu", showdownName: "Pikachu-Surfing" });
            expect(species.SPECIES_PIKACHU_SURFING.sprite.source).to.equal("cloud");
            expect(species.SPECIES_IVYSAUR.name).to.equal("Ivysaur");

            // Missing values stay unknown instead of becoming zero
            expect(species.SPECIES_GARCHOMP.baseStats).to.deep.equal({ hp: 108, atk: null, def: null, spAtk: null, spDef: null, spd: null });
            expect(diagnostics.map((diagnostic) => diagnostic.code)).to.include.members(["CATALOG_SPECIES_INCOMPLETE", "BATTLE_FORM_UNAVAILABLE"]);
        });

        it("should take move details from CFRU's compiled branch and report differences from Cloud", async () =>
        {
            const { moves, diagnostics } = (await post(app, token, `/api/workspaces/${workspaceId}/catalog`, { gameId: "cfru" })).body;
            expect(moves.MOVE_FLY).to.include({ name: "Fly", power: 100, pp: 15, accuracy: 95, local: true });
            expect(moves.MOVE_SWIFT).to.include({ accuracy: 0, name: "Swift" });
            expect(moves.MOVE_TACKLE).to.include({ type: "TYPE_NORMAL", pp: 35, power: null, accuracy: null, local: false });
            expect(moves).to.not.have.any.keys("MOVE_NONE", "MOVE_REMOVED");

            const codes = diagnostics.map((diagnostic) => diagnostic.code);
            expect(codes).to.include.members(["MOVE_DETAILS_MISSING", "MOVE_DATA_MISMATCH"]);
            expect(diagnostics.find((diagnostic) => diagnostic.code === "MOVE_DATA_MISMATCH").message).to.include("MOVE_FLY (pp 15 in CFRU, 10 in Cloud)");
        });

        it("should list items, balls and types with their icons", async () =>
        {
            const { items, balls, types, assets } = (await post(app, token, `/api/workspaces/${workspaceId}/catalog`, { gameId: "cfru" })).body;
            expect(items.ITEM_LEFTOVERS).to.deep.equal({ name: "Leftovers", icon: "https://raw.githubusercontent.com/msikma/pokesprite/master/items/hold-item/leftovers.png" });
            expect(items.ITEM_CUSTOM_CHARM.icon).to.equal(`/api/images/${workspaceId}/items/ITEM_CUSTOM_CHARM.png`);
            expect(items.ITEM_UNNAMED_THING).to.deep.equal({ name: "Unnamed Thing", icon: null });
            expect(items.ITEM_NONE.icon).to.equal(null);
            expect(balls.BALL_TYPE_POKE_BALL).to.deep.equal({ name: "Poké Ball", icon: "https://raw.githubusercontent.com/msikma/pokesprite/master/items/ball/poke.png" });
            expect(balls.BALL_TYPE_RANDOM).to.deep.equal({ name: "Random", icon: null });
            expect(types.TYPE_FIRE.icon).to.match(/sword-shield\/10\.png$/);
            expect(assets.gigantamax).to.equal(`/api/images/${workspaceId}/root/gigantamax.png`);
        });

        it("should serve Cloud's images from the local repository without a session token", async () =>
        {
            const { species, items } = (await post(app, token, `/api/workspaces/${workspaceId}/catalog`, { gameId: "cfru" })).body;

            for (const url of [items.ITEM_CUSTOM_CHARM.icon, species.SPECIES_PIKACHU_SURFING.sprite.shiny])
            {
                const res = await request(app).get(url);
                expect(res.status).to.equal(StatusCode.SuccessOK);
                expect(res.headers["content-type"]).to.equal("image/png");
                expect(res.headers["cross-origin-resource-policy"]).to.equal("same-site");
                expect(res.body.toString()).to.equal("png");
            }
        });

        it("should serve only PNG files directly inside Cloud's image folders", async () =>
        {
            const base = `/api/images/${workspaceId}`;
            for (const url of [`${base}/root/missing.png`, `${base}/secret/gigantamax.png`, `${base}/root/..%2F..%2F.env`, `${base}/root/.env`, `${base}/items/ITEM_CUSTOM_CHARM.txt`])
            {
                const res = await request(app).get(url);
                expect(res.status).to.equal(StatusCode.ClientErrorNotFound);
                expect(res.body.error.code).to.equal("IMAGE_NOT_FOUND");
            }

            const unknownWorkspace = await request(app).get(`/api/images/${MISSING_WORKSPACE_ID}/root/gigantamax.png`);
            expect(unknownWorkspace.body.error.code).to.equal("WORKSPACE_NOT_FOUND");

            const otherHost = await request(app).get(`${base}/root/gigantamax.png`).set("Host", "evil.example:3001");
            expect(otherHost.status).to.equal(StatusCode.ClientErrorForbidden);
        });

        it("should not serve images through links that leave the Cloud repository", async () =>
        {
            const outside = path.join(fixture.base, "outside images");
            fs.mkdirSync(outside);
            fs.writeFileSync(path.join(outside, "secret.png"), "secret");
            fs.symlinkSync(outside, path.join(fixture.paths.cloud, "public", "images", "gen_9"), "junction");

            const res = await request(app).get(`/api/images/${workspaceId}/gen9/secret.png`);
            expect(res.status).to.equal(StatusCode.ClientErrorForbidden);
            expect(res.body.error.code).to.equal("PATH_OUTSIDE_REPOSITORY");
        });

        it("should include learnsets that decide move legality", async () =>
        {
            const catalog = (await post(app, token, `/api/workspaces/${workspaceId}/catalog`, { gameId: "cfru" })).body;
            const { getMoveLegality } = await import("../../../shared/catalog.mjs");
            expect(getMoveLegality(catalog, "SPECIES_VENUSAUR", "MOVE_LEECHSEED")).to.deep.equal({ status: "allowed", sources: ["prevolution"], reason: null });
            expect(getMoveLegality(catalog, "SPECIES_VENUSAUR", "MOVE_FLY").status).to.equal("illegal");
            expect(getMoveLegality(catalog, "SPECIES_DRAGONITE", "MOVE_DRACOMETEOR").status).to.equal("unknown");
            expect(getMoveLegality(catalog, "SPECIES_GARCHOMP", "MOVE_EARTHQUAKE").status).to.equal("unknown");
        });

        it("should report spread values the game does not have instead of matching them to something else", async () =>
        {
            const { unresolved, diagnostics } = (await post(app, token, `/api/workspaces/${workspaceId}/catalog`, { gameId: "cfru" })).body;
            expect(unresolved.species).to.include({ SPECIES_TYRANITAR: 1, SPECIES_RAICHU: 1 });
            expect(unresolved.species).to.not.have.any.keys("SPECIES_VENUSAUR", "SPECIES_GARCHOMP");
            expect(unresolved.items.ITEM_LIFE_ORB).to.be.above(1);
            expect(unresolved.balls).to.deep.equal({});
            expect(unresolved.natures).to.deep.equal({});
            expect(diagnostics.filter((diagnostic) => diagnostic.code === "UNRESOLVED_SYMBOL").map((diagnostic) => diagnostic.message).join(" ")).to.include("SPECIES_TYRANITAR");
        });

        it("should still load when PokeAPI cannot be reached", async () =>
        {
            globalThis.fetch = createPokeApiFetch({ fail: true });

            const res = await post(app, token, `/api/workspaces/${workspaceId}/catalog`, { gameId: "cfru" });
            expect(res.status).to.equal(StatusCode.SuccessOK);
            expect(res.body.diagnostics.map((diagnostic) => diagnostic.code)).to.include("SPRITES_OFFLINE");
            expect(res.body.species.SPECIES_CHARIZARD.sprite.normal).to.match(/\/6\.png$/);
            expect(res.body.species.SPECIES_CHARIZARD_GIGA.sprite).to.include({ source: "pokesprite" });
            expect(res.body.types.TYPE_FIRE.icon).to.match(/pokesprite.*fire\.png$/);
        });

        it("should reuse cached parses on the next load", async () =>
        {
            const first = await post(app, token, `/api/workspaces/${workspaceId}/catalog`, { gameId: "cfru" });
            const cache = path.join(process.env[DATA_DIRECTORY_ENV], "cache");
            expect(fs.readdirSync(cache)).to.include.members(["battle-moves", "dpe-data", "pokeapi-index.json"]);

            const second = await post(app, token, `/api/workspaces/${workspaceId}/catalog`, { gameId: "cfru" });
            expect(second.body).to.deep.equal(first.body);
            expect(globalThis.fetch.calls).to.have.length(2);
        });

        it("should reject games that are not available", async () =>
        {
            for (const gameId of ["missing", "unlisted", "nonexistent", "__proto__", 5])
            {
                const res = await post(app, token, `/api/workspaces/${workspaceId}/catalog`, { gameId });
                expect(res.status).to.equal(StatusCode.ClientErrorNotFound);
                expect(res.body.error.code).to.equal("GAME_NOT_FOUND");
            }
        });

        it("should report invalid game data", async () =>
        {
            const res = await post(app, token, `/api/workspaces/${workspaceId}/catalog`, { gameId: "alpha" });
            expect(res.status).to.equal(StatusCode.ClientErrorUnprocessableEntity);
            expect(res.body.error.code).to.equal("CATALOG_INVALID");
        });

        it("should report a Cloud repository moved after loading", async () =>
        {
            fs.renameSync(fixture.paths.cloud, `${fixture.paths.cloud} moved`);

            const res = await post(app, token, `/api/workspaces/${workspaceId}/catalog`, { gameId: "cfru" });
            expect(res.status).to.equal(StatusCode.ClientErrorConflict);
            expect(res.body.error.code).to.equal("REPOSITORY_FILE_UNAVAILABLE");
        });

        it("should reject unknown and malformed workspace IDs", async () =>
        {
            for (const id of [MISSING_WORKSPACE_ID, "not-a-workspace"])
            {
                const res = await post(app, token, `/api/workspaces/${id}/catalog`, { gameId: "cfru" });
                expect(res.status).to.equal(StatusCode.ClientErrorNotFound);
                expect(res.body.error.code).to.equal("WORKSPACE_NOT_FOUND");
            }
        });

        it("should invalidate tokens and workspaces when the server restarts", async () =>
        {
            const restarted = startServer();

            const staleToken = await post(restarted, token, `/api/workspaces/${workspaceId}/catalog`, { gameId: "cfru" });
            expect(staleToken.status).to.equal(StatusCode.ClientErrorUnauthorized);

            const newToken = await getToken(restarted);
            expect(newToken).to.not.equal(token);
            const staleWorkspace = await post(restarted, newToken, `/api/workspaces/${workspaceId}/catalog`, { gameId: "cfru" });
            expect(staleWorkspace.status).to.equal(StatusCode.ClientErrorNotFound);
            expect(staleWorkspace.body.error.code).to.equal("WORKSPACE_NOT_FOUND");
        });
    });

    describe("POST /api/workspaces/:id/save", () =>
    {
        let workspace;

        beforeEach(async () =>
        {
            workspace = (await post(app, token, "/api/workspaces/load", { paths: fixture.paths })).body;
        });

        it("should save a changed spread and return the new snapshot", async () =>
        {
            const entry = workspace.spreads.entries.find((candidate) => candidate.fields.species === "SPECIES_VENUSAUR");
            const res = await post(app, token, `/api/workspaces/${workspace.workspaceId}/save`,
                { revision: workspace.spreads.revision, gameId: "cfru", operations: [{ type: "update", entryId: entry.id, fields: { hpEv: 248 } }] });

            expect(res.status).to.equal(StatusCode.SuccessOK);
            expect(res.body.files).to.deep.equal([{ path: BATTLE_TOWER_FILE, status: "saved" }]);
            expect(res.body.spreads.entries.find((candidate) => candidate.id === entry.id).fields.hpEv).to.equal(248);
            expect(fs.readFileSync(path.join(fixture.paths.cfru, ...BATTLE_TOWER_FILE.split("/")), "utf8")).to.include(".hpEv = 248,");
            expect(fs.readdirSync(path.join(fixture.base, "editor data", "backups"))).to.deep.equal([res.body.backupId]);
        });

        it("should reject changes made to an older snapshot", async () =>
        {
            const res = await post(app, token, `/api/workspaces/${workspace.workspaceId}/save`, { revision: "0".repeat(64), operations: [] });
            expect(res.status).to.equal(StatusCode.ClientErrorConflict);
            expect(res.body.error.code).to.equal("SAVE_CONFLICT");
        });

        it("should reject invalid changes without writing", async () =>
        {
            const before = fs.readFileSync(path.join(fixture.paths.cfru, ...BATTLE_TOWER_FILE.split("/")));
            const entry = workspace.spreads.entries[0];
            const res = await post(app, token, `/api/workspaces/${workspace.workspaceId}/save`,
                { revision: workspace.spreads.revision, operations: [{ type: "update", entryId: entry.id, fields: { species: "SPECIES_A }; int x = {" } }] });

            expect(res.status).to.equal(StatusCode.ClientErrorUnprocessableEntity);
            expect(res.body.error.code).to.equal("INVALID_OPERATION");
            expect(fs.readFileSync(path.join(fixture.paths.cfru, ...BATTLE_TOWER_FILE.split("/"))).equals(before)).to.equal(true);
        });

        it("should reject unknown workspaces", async () =>
        {
            const res = await post(app, token, `/api/workspaces/${MISSING_WORKSPACE_ID}/save`, { revision: workspace.spreads.revision, operations: [] });
            expect(res.status).to.equal(StatusCode.ClientErrorNotFound);
            expect(res.body.error.code).to.equal("WORKSPACE_NOT_FOUND");
        });
    });
});
