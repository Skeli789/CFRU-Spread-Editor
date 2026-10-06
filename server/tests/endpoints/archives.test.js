/**
 * Isolated archive service and API coverage using disposable source repositories.
 */

const AdmZip = require("adm-zip");
const { expect } = require("chai");
const fs = require("fs");
const path = require("path");
const request = require("supertest");
const { createFixtureRepositories } = require("../helpers/fixture-repositories");

const SERVER_ROOT = path.resolve(__dirname, "../..");
const ORIGIN = "http://localhost:3000";
const SESSION_HEADER = "X-Session-Token";
const IMPORT_ROUTE = "/api/workspaces/import";
const SPREAD_FILE = "src/Tables/battle_tower_spreads.h";
const OPTIONAL_IMAGE = "public/images/items/archive-test.png";
const OPTIONAL_BYTES = Buffer.from([0, 255, 128, 13, 10, 0, 1]);
const ORIGINAL_DATA_DIRECTORY = process.env.SPREAD_EDITOR_DATA_DIR;

/**
 * Simulates a server restart, keeping third-party modules and disposable filesystem state.
 *
 * @returns {object} A fresh server app.
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

/**
 * Locates central headers for metadata corruption tests without allocating large payloads.
 *
 * @param {Buffer} bytes A standard ZIP container.
 * @returns {Array<number>} Central header offsets.
 */
function centralOffsets(bytes)
{
    const end = bytes.length - 22;
    let offset = bytes.readUInt32LE(end + 16);
    const offsets = [];
    for (let index = 0; index < bytes.readUInt16LE(end + 10); index++)
    {
        offsets.push(offset);
        offset += 46 + bytes.readUInt16LE(offset + 28) + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
    }
    return offsets;
}

/**
 * Collects binary responses without Superagent's MIME-specific text parser.
 *
 * @param {object} res The response stream.
 * @param {Function} callback The parser callback.
 */
function parseBinary(res, callback)
{
    const chunks = [];
    res.on("data", (chunk) => chunks.push(chunk));
    res.on("end", () => callback(null, Buffer.concat(chunks)));
    res.on("error", callback);
}

describe("Source archive exchange", function ()
{
    this.timeout(30000);
    let fixture;
    let app;
    let token;
    let source;
    let bytes;
    let archiveService;

    /**
     * Sends a protected JSON request.
     * @param {string} route The API route.
     * @param {object} body The body.
     * @returns {object} The Supertest request.
     */
    function post(route, body)
    {
        return request(app).post(route).set("Origin", ORIGIN).set(SESSION_HEADER, token).send(body);
    }

    /**
     * Sends a protected raw ZIP request.
     * @param {Buffer} body The ZIP bytes.
     * @returns {object} The Supertest request.
     */
    function upload(body)
    {
        return request(app).post(IMPORT_ROUTE).set("Origin", ORIGIN).set(SESSION_HEADER, token).set("Content-Type", "application/zip").send(body);
    }

    /**
     * Lists cached imports without requiring the parent directory to exist.
     * @returns {Array<string>} Imported UUID directory names.
     */
    function imports()
    {
        const directory = path.join(process.env.SPREAD_EDITOR_DATA_DIR, "imports");
        return fs.existsSync(directory) ? fs.readdirSync(directory).sort() : [];
    }

    beforeEach(async () =>
    {
        fixture = createFixtureRepositories();
        process.env.SPREAD_EDITOR_DATA_DIR = path.join(fixture.base, "editor data");
        // The shared fixture intentionally has an invalid Alpha catalog for other suites.
        fs.writeFileSync(path.join(fixture.paths.cloud, "src/data/alpha/BaseStats.json"), "{}");
        fs.writeFileSync(path.join(fixture.paths.cloud, OPTIONAL_IMAGE), OPTIONAL_BYTES);
        fs.writeFileSync(path.join(fixture.paths.cloud, "src/data/private-secret.json"), "SECRET");
        fs.writeFileSync(path.join(fixture.paths.dpe, "graphics/frontspr/private.txt"), "SECRET");
        app = startServer();
        token = (await request(app).post("/api/session").set("Origin", ORIGIN)).body.token;
        source = (await post("/api/workspaces/load", { paths: fixture.paths })).body;
        expect(source).to.have.property("workspaceId");
        archiveService = require("../../services/archives");
        bytes = await archiveService.exportArchive(require("../../services/repositories").getWorkspace(source.workspaceId), "cfru");
    });

    afterEach(() =>
    {
        fixture?.cleanup();
        if (ORIGINAL_DATA_DIRECTORY === undefined)
            delete process.env.SPREAD_EDITOR_DATA_DIR;
        else
            process.env.SPREAD_EDITOR_DATA_DIR = ORIGINAL_DATA_DIRECTORY;
    });

    it("prepares imported field operations without writing files or changing the loaded revision", async () =>
    {
        const { getWorkspace } = require("../../services/repositories");
        const { prepareEditorChanges, prepareSpreadFiles } = require("../../services/spread-store");
        const workspace = getWorkspace(source.workspaceId);
        const original = fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE));
        const entry = source.spreads.entries.find((entry) => entry.fields.species === "SPECIES_VENUSAUR");
        const current = await prepareEditorChanges(workspace, { revision: source.spreads.revision,
            operations: [{ type: "update", entryId: entry.id, fields: { hpEv: 248 } }] });
        expect(current.spreads.entries.find((candidate) => candidate.id === entry.id).fields.hpEv).to.equal(248);
        const result = await prepareSpreadFiles(workspace, new Map([[SPREAD_FILE,
            Buffer.from(original.toString("utf8").replace(".hpEv = 252", ".hpEv = 244"))]]), source.spreads.revision, current);
        expect(result.operations).to.deep.equal([{ type: "update", entryId: entry.id, fields: { hpEv: 244 } }]);
        expect(result.backupId).to.equal(null);
        expect(fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE)).equals(original)).to.equal(true);
        expect(workspace.spreads.revision).to.equal(source.spreads.revision);
    });

    it("selectively stages imports and offers only rejected changes on reimport before saving", async () =>
    {
        const exported = await post(`/api/workspaces/${source.workspaceId}/spread-files/export`, {}).buffer(true).parse(parseBinary);
        const baseline = (await post(`/api/workspaces/${source.workspaceId}/spread-files/exports`, {})).body.exports[0];
        const zip = new AdmZip(exported.body);
        const original = fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE));
        zip.updateFile(path.posix.basename(SPREAD_FILE), Buffer.from(original.toString("utf8")
            .replace(".hpEv = 252", ".hpEv = 248").replace(".spAtkEv = 252", ".spAtkEv = 248")));
        const uploaded = zip.toBuffer();
        const preview = await request(app).post(`/api/workspaces/${source.workspaceId}/spread-files/import`)
            .query({ revision: source.spreads.revision, baselineId: baseline.id }).set("Origin", ORIGIN).set(SESSION_HEADER, token)
            .set("Content-Type", "application/zip").send(uploaded);
        expect(preview.status, JSON.stringify(preview.body)).to.equal(200);
        expect(preview.body.changes).to.have.length(2);
        expect(preview.body.conflicts).to.deep.equal([]);
        const accepted = preview.body.changes.find((change) => change.spreads.incoming[0].fields.species === "SPECIES_VENUSAUR");
        const choices = Object.fromEntries(preview.body.changes.map((change) => [change.id, change.id === accepted.id ? "incoming" : "current"]));
        const staged = await post(`/api/workspaces/${source.workspaceId}/spread-files/merge`, { previewId: preview.body.previewId, choices });
        expect(staged.status, JSON.stringify(staged.body)).to.equal(200);
        expect(staged.body.operations).to.have.length(1);
        expect(staged.body.backupId).to.equal(null);
        expect(fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE)).equals(original)).to.equal(true);
        const current = await post(`/api/workspaces/${source.workspaceId}/spread-files/current`,
            { revision: source.spreads.revision, operations: staged.body.operations });
        expect(current.status, JSON.stringify(current.body)).to.equal(200);
        const repeated = await request(app).post(`/api/workspaces/${source.workspaceId}/spread-files/import`)
            .query({ revision: source.spreads.revision, baselineId: baseline.id, currentId: current.body.currentId }).set("Origin", ORIGIN).set(SESSION_HEADER, token)
            .set("Content-Type", "application/zip").send(uploaded);
        expect(repeated.status, JSON.stringify(repeated.body)).to.equal(200);
        expect(repeated.body.changes).to.have.length(1);
        expect(repeated.body.changes[0].spreads.incoming[0].fields.species).to.equal("SPECIES_CHARIZARD");
        expect(repeated.body.conflicts).to.deep.equal([]);
        expect(fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE)).equals(original)).to.equal(true);
        const saved = await post(`/api/workspaces/${source.workspaceId}/save`, { revision: source.spreads.revision, operations: staged.body.operations });
        expect(saved.status, JSON.stringify(saved.body)).to.equal(200);
        expect(fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE), "utf8")).to.equal(original.toString("utf8").replace(".hpEv = 252", ".hpEv = 248"));
    });

    it("stages individual accepted comparisons immediately and retains remaining preview decisions", async () =>
    {
        const exported = await post(`/api/workspaces/${source.workspaceId}/spread-files/export`, {}).buffer(true).parse(parseBinary);
        const baseline = (await post(`/api/workspaces/${source.workspaceId}/spread-files/exports`, {})).body.exports[0];
        const zip = new AdmZip(exported.body);
        const original = fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE));
        zip.updateFile(path.posix.basename(SPREAD_FILE), Buffer.from(original.toString("utf8")
            .replace(".hpEv = 252", ".hpEv = 248").replace(".spAtkEv = 252", ".spAtkEv = 248")));
        const preview = await request(app).post(`/api/workspaces/${source.workspaceId}/spread-files/import`)
            .query({ revision: source.spreads.revision, baselineId: baseline.id }).set("Origin", ORIGIN).set(SESSION_HEADER, token)
            .set("Content-Type", "application/zip").send(zip.toBuffer());
        expect(preview.status).to.equal(200);
        expect(preview.body.changes).to.have.length(2);
        const staged = [];
        for (const change of preview.body.changes)
        {
            const result = await post(`/api/workspaces/${source.workspaceId}/spread-files/merge`,
                { previewId: preview.body.previewId, decisionId: change.id, choices: { [change.id]: "incoming" } });
            expect(result.status, JSON.stringify(result.body)).to.equal(200);
            expect(result.body.acceptedCount).to.equal(1);
            expect(result.body.operations).to.have.length(1);
            staged.push(...result.body.operations);
            expect(fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE)).equals(original)).to.equal(true);
        }
        const duplicate = await post(`/api/workspaces/${source.workspaceId}/spread-files/merge`,
            { previewId: preview.body.previewId, decisionId: preview.body.changes[0].id, choices: { [preview.body.changes[0].id]: "incoming" } });
        expect(duplicate.status).to.equal(409);
        const saved = await post(`/api/workspaces/${source.workspaceId}/save`, { revision: source.spreads.revision, operations: staged });
        expect(saved.status, JSON.stringify(saved.body)).to.equal(200);
    });

    it("keeps incoming order when additions sharing one anchor are accepted separately", async () =>
    {
        const exported = await post(`/api/workspaces/${source.workspaceId}/spread-files/export`, {}).buffer(true).parse(parseBinary);
        const baseline = (await post(`/api/workspaces/${source.workspaceId}/spread-files/exports`, {})).body.exports[0];
        const zip = new AdmZip(exported.body);
        const original = fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE), "utf8");
        const workspace = require("../../services/repositories").getWorkspace(source.workspaceId);
        const model = require("../../services/spread-parser").parseSpreadFile(original, workspace.spreads.macros);
        const first = model.sets.find((set) => set.name === "gFrontierSpreads").entries[0];
        const entry = original.slice(first.start, first.end);
        zip.updateFile(path.posix.basename(SPREAD_FILE), Buffer.from(original.slice(0, first.end)
            + `,\r\n\t${entry.replace("SPECIES_VENUSAUR", "SPECIES_BLASTOISE")},\r\n\t${entry.replace("SPECIES_VENUSAUR", "SPECIES_IVYSAUR")}` + original.slice(first.end)));
        const preview = await request(app).post(`/api/workspaces/${source.workspaceId}/spread-files/import`)
            .query({ revision: source.spreads.revision, baselineId: baseline.id }).set("Origin", ORIGIN).set(SESSION_HEADER, token)
            .set("Content-Type", "application/zip").send(zip.toBuffer());
        expect(preview.status, JSON.stringify(preview.body)).to.equal(200);
        expect(preview.body.changes).to.have.length(2);
        const operations = [];
        for (const change of preview.body.changes)
        {
            const staged = await post(`/api/workspaces/${source.workspaceId}/spread-files/merge`,
                { previewId: preview.body.previewId, decisionId: change.id, choices: { [change.id]: "incoming" } });
            expect(staged.status, JSON.stringify(staged.body)).to.equal(200);
            operations.push(...staged.body.operations);
        }
        const effective = await require("../../services/spread-store").prepareEditorChanges(workspace,
            { revision: source.spreads.revision, operations });
        const set = effective.spreads.sets.find((set) => set.name === "gFrontierSpreads");
        const species = set.entryIds.map((id) => effective.spreads.entries.find((entry) => entry.id === id).fields.species);
        expect(species.slice(0, 3)).to.deep.equal(["SPECIES_VENUSAUR", "SPECIES_BLASTOISE", "SPECIES_IVYSAUR"]);
        expect(fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE), "utf8")).to.equal(original);
    });

    it("does not reoffer accepted default values or empty move slots before saving", async () =>
    {
        const exported = await post(`/api/workspaces/${source.workspaceId}/spread-files/export`, {}).buffer(true).parse(parseBinary);
        const baseline = (await post(`/api/workspaces/${source.workspaceId}/spread-files/exports`, {})).body.exports[0];
        const zip = new AdmZip(exported.body);
        const original = fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE));
        zip.updateFile(path.posix.basename(SPREAD_FILE), Buffer.from(original.toString("utf8")
            .replace(".hpEv = 252", ".hpEv = 248").replace(".ball = BALL_TYPE_RANDOM", ".ball = 0")
            .replace("MOVE_AIRSLASH,", "MOVE_AIRSLASH,\r\n\t\t\tMOVE_NONE,\r\n\t\t\tMOVE_NONE,")));
        const uploaded = zip.toBuffer();
        const preview = await request(app).post(`/api/workspaces/${source.workspaceId}/spread-files/import`)
            .query({ revision: source.spreads.revision, baselineId: baseline.id }).set("Origin", ORIGIN).set(SESSION_HEADER, token)
            .set("Content-Type", "application/zip").send(uploaded);
        expect(preview.status).to.equal(200);
        const staged = await post(`/api/workspaces/${source.workspaceId}/spread-files/merge`, { previewId: preview.body.previewId,
            choices: Object.fromEntries(preview.body.changes.map((change) => [change.id, "incoming"])) });
        expect(staged.status, JSON.stringify(staged.body)).to.equal(200);
        const current = await post(`/api/workspaces/${source.workspaceId}/spread-files/current`,
            { revision: source.spreads.revision, operations: staged.body.operations });
        expect(current.status).to.equal(200);
        const repeated = await request(app).post(`/api/workspaces/${source.workspaceId}/spread-files/import`)
            .query({ revision: source.spreads.revision, baselineId: baseline.id, currentId: current.body.currentId }).set("Origin", ORIGIN).set(SESSION_HEADER, token)
            .set("Content-Type", "application/zip").send(uploaded);
        expect(repeated.status, JSON.stringify(repeated.body)).to.equal(200);
        expect(repeated.body.changes).to.deep.equal([]);
        expect(repeated.body.conflicts).to.deep.equal([]);
        expect(fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE)).equals(original)).to.equal(true);
    });

    it("exports and stages only spread headers, backing up originals only on explicit save", async () =>
    {
        const { CFRU_SPREAD_FILES } = require("../../services/repositories");
        const exported = await post(`/api/workspaces/${source.workspaceId}/spread-files/export`, {}).buffer(true).parse(parseBinary);
        expect(exported.status).to.equal(200);
        expect(exported.headers["content-disposition"]).to.include("spread-files.zip");
        const zip = new AdmZip(exported.body);
        expect(zip.getEntries().map((entry) => entry.entryName).sort()).to.deep.equal(CFRU_SPREAD_FILES.map((file) => path.posix.basename(file)).sort());
        const original = fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE));
        const replacement = Buffer.from(original.toString("utf8").replace(".hpEv = 252", ".hpEv = 248"));
        zip.updateFile(path.posix.basename(SPREAD_FILE), replacement);
        const res = await request(app).post(`/api/workspaces/${source.workspaceId}/spread-files/import`)
            .query({ revision: source.spreads.revision }).set("Origin", ORIGIN).set(SESSION_HEADER, token)
            .set("Content-Type", "application/zip").send(zip.toBuffer());
        expect(res.status, JSON.stringify(res.body)).to.equal(200);
        expect(fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE)).equals(original)).to.equal(true);
        expect(res.body.revision).to.equal(source.spreads.revision);
        expect(res.body.backupId).to.equal(null);
        const saved = await post(`/api/workspaces/${source.workspaceId}/save`, { revision: source.spreads.revision, operations: res.body.operations });
        expect(saved.status, JSON.stringify(saved.body)).to.equal(200);
        expect(fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE)).equals(replacement)).to.equal(true);
        expect(saved.body.backupId).to.be.a("string");
        expect(fs.readFileSync(path.join(process.env.SPREAD_EDITOR_DATA_DIR, "backups", saved.body.backupId, SPREAD_FILE.replaceAll("/", "__"))).equals(original)).to.equal(true);
    });

    it("retains a dated export baseline across restarts and scopes it to the CFRU root", async () =>
    {
        const exported = await post(`/api/workspaces/${source.workspaceId}/spread-files/export`, { name: "  Collaboration Round One  " }).buffer(true).parse(parseBinary);
        expect(exported.status).to.equal(200);
        const list = await post(`/api/workspaces/${source.workspaceId}/spread-files/exports`, {});
        expect(list.status).to.equal(200);
        expect(list.body.exports).to.have.length(1);
        const baseline = list.body.exports[0];
        expect(baseline.name).to.equal("Collaboration Round One");
        expect(Number.isFinite(Date.parse(baseline.exportedAt))).to.equal(true);
        expect(JSON.stringify(baseline)).not.to.include(fixture.paths.cfru);
        app = startServer();
        token = (await request(app).post("/api/session").set("Origin", ORIGIN)).body.token;
        source = (await post("/api/workspaces/load", { paths: fixture.paths })).body;
        const exchange = require("../../services/spread-exchange");
        const workspace = require("../../services/repositories").getWorkspace(source.workspaceId);
        expect(await exchange.listSpreadExports(workspace)).to.deep.equal([baseline]);
        expect((await exchange.readSpreadExport(workspace, baseline.id)).equals(exported.body)).to.equal(true);
        expect(await exchange.listSpreadExports({ roots: { cfru: path.join(fixture.base, "another CFRU") } })).to.deep.equal([]);
        try
        {
            await exchange.readSpreadExport({ roots: { cfru: path.join(fixture.base, "another CFRU") } }, baseline.id);
            throw new Error("Foreign baseline was accepted");
        }
        catch (error)
        {
            expect(error.code).to.equal("EXPORT_NOT_FOUND");
        }
    });

    it("rejects invalid export names before retaining a baseline and keeps blank names optional", async () =>
    {
        for (const name of [null, 7, "x".repeat(129), "Invalid\nName", "Invalid\u0000Name"])
        {
            const rejected = await post(`/api/workspaces/${source.workspaceId}/spread-files/export`, { name });
            expect(rejected.status, JSON.stringify(rejected.body)).to.equal(422);
            expect(rejected.body.error.code).to.equal("INVALID_EXPORT_NAME");
        }
        const empty = await post(`/api/workspaces/${source.workspaceId}/spread-files/exports`, {});
        expect(empty.body.exports).to.deep.equal([]);
        const exported = await post(`/api/workspaces/${source.workspaceId}/spread-files/export`, { name: "   " }).buffer(true).parse(parseBinary);
        expect(exported.status).to.equal(200);
        const history = await post(`/api/workspaces/${source.workspaceId}/spread-files/exports`, {});
        expect(history.body.exports).to.have.length(1);
        expect(history.body.exports[0]).not.to.have.property("name");
    });

    it("smart imports changed spreads while preserving local edits to other spreads", async () =>
    {
        const exported = await post(`/api/workspaces/${source.workspaceId}/spread-files/export`, {}).buffer(true).parse(parseBinary);
        const baseline = (await post(`/api/workspaces/${source.workspaceId}/spread-files/exports`, {})).body.exports[0];
        const zip = new AdmZip(exported.body);
        const original = zip.readAsText(path.posix.basename(SPREAD_FILE));
        zip.updateFile(path.posix.basename(SPREAD_FILE), Buffer.from(original.replace(".hpEv = 252", ".hpEv = 248")));
        fs.writeFileSync(path.join(fixture.paths.cfru, SPREAD_FILE), original.replace(".gigantamax = TRUE", ".gigantamax = FALSE"));
        source = (await post("/api/workspaces/load", { paths: fixture.paths })).body;
        const before = fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE));
        const preview = await request(app).post(`/api/workspaces/${source.workspaceId}/spread-files/import`)
            .query({ revision: source.spreads.revision, baselineId: baseline.id }).set("Origin", ORIGIN).set(SESSION_HEADER, token)
            .set("Content-Type", "application/zip").send(zip.toBuffer());
        expect(preview.status, JSON.stringify(preview.body)).to.equal(200);
        expect(preview.body.conflicts).to.deep.equal([]);
        expect(preview.body.changedFiles).to.deep.equal([SPREAD_FILE]);
        expect(preview.body.changes[0].label).to.include("SPECIES_VENUSAUR");
        expect(fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE)).equals(before)).to.equal(true);
        const applied = await post(`/api/workspaces/${source.workspaceId}/spread-files/merge`, { previewId: preview.body.previewId,
            choices: Object.fromEntries(preview.body.changes.map((change) => [change.id, "incoming"])) });
        expect(applied.status, JSON.stringify(applied.body)).to.equal(200);
        expect(fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE)).equals(before)).to.equal(true);
        expect((await post(`/api/workspaces/${source.workspaceId}/save`, { revision: source.spreads.revision, operations: applied.body.operations })).status).to.equal(200);
        expect(fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE), "utf8")).to.equal(original
            .replace(".hpEv = 252", ".hpEv = 248").replace(".gigantamax = TRUE", ".gigantamax = FALSE"));
    });

    it("requires a whole-spread choice when both sides edit a spread", async () =>
    {
        const exported = await post(`/api/workspaces/${source.workspaceId}/spread-files/export`, {}).buffer(true).parse(parseBinary);
        const baseline = (await post(`/api/workspaces/${source.workspaceId}/spread-files/exports`, {})).body.exports[0];
        const zip = new AdmZip(exported.body);
        const original = zip.readAsText(path.posix.basename(SPREAD_FILE));
        zip.updateFile(path.posix.basename(SPREAD_FILE), Buffer.from(original.replace(".hpEv = 252", ".hpEv = 248")));
        fs.writeFileSync(path.join(fixture.paths.cfru, SPREAD_FILE), original.replace(".hpEv = 252", ".hpEv = 244")
            .replace(".item = ITEM_BLACK_SLUDGE", ".item = ITEM_LIFE_ORB"));
        source = (await post("/api/workspaces/load", { paths: fixture.paths })).body;
        const before = fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE));
        const preview = await request(app).post(`/api/workspaces/${source.workspaceId}/spread-files/import`)
            .query({ revision: source.spreads.revision, baselineId: baseline.id }).set("Origin", ORIGIN).set(SESSION_HEADER, token)
            .set("Content-Type", "application/zip").send(zip.toBuffer());
        expect(preview.status, JSON.stringify(preview.body)).to.equal(200);
        expect(preview.body.conflicts).to.have.length(1);
        expect(preview.body.conflicts[0].current).to.include("244");
        expect(preview.body.conflicts[0].incoming).to.include("248");
        expect(preview.body.conflicts[0].original).to.include(".species = SPECIES_VENUSAUR");
        const unresolved = await post(`/api/workspaces/${source.workspaceId}/spread-files/merge`, { previewId: preview.body.previewId });
        expect(unresolved.status).to.equal(422);
        expect(fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE)).equals(before)).to.equal(true);
        const applied = await post(`/api/workspaces/${source.workspaceId}/spread-files/merge`,
            { previewId: preview.body.previewId, choices: { [preview.body.conflicts[0].id]: "incoming" } });
        expect(applied.status, JSON.stringify(applied.body)).to.equal(200);
        expect(fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE)).equals(before)).to.equal(true);
        expect((await post(`/api/workspaces/${source.workspaceId}/save`, { revision: source.spreads.revision, operations: applied.body.operations })).status).to.equal(200);
        expect(fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE), "utf8")).to.equal(original
            .replace(".hpEv = 252", ".hpEv = 248"));
    });

    it("smart import returns individual parsed cards and conflicts for adjacent edited spreads", async () =>
    {
        const exported = await post(`/api/workspaces/${source.workspaceId}/spread-files/export`, {}).buffer(true).parse(parseBinary);
        const baseline = (await post(`/api/workspaces/${source.workspaceId}/spread-files/exports`, {})).body.exports[0];
        const zip = new AdmZip(exported.body);
        const original = zip.readAsText(path.posix.basename(SPREAD_FILE));
        zip.updateFile(path.posix.basename(SPREAD_FILE), Buffer.from(original.replace(".hpEv = 252", ".hpEv = 248")
            .replace(".gigantamax = TRUE", ".gigantamax = FALSE")));
        fs.writeFileSync(path.join(fixture.paths.cfru, SPREAD_FILE), original.replace(".item = ITEM_BLACK_SLUDGE", ".item = ITEM_LIFE_ORB")
            .replace(".specificTeamType = DOUBLES_SUN_TEAM", ".specificTeamType = 0"));
        source = (await post("/api/workspaces/load", { paths: fixture.paths })).body;
        const preview = await request(app).post(`/api/workspaces/${source.workspaceId}/spread-files/import`)
            .query({ revision: source.spreads.revision, baselineId: baseline.id }).set("Origin", ORIGIN).set(SESSION_HEADER, token)
            .set("Content-Type", "application/zip").send(zip.toBuffer());
        expect(preview.status, JSON.stringify(preview.body)).to.equal(200);
        expect(preview.body.changes).to.have.length(0);
        expect(preview.body.conflicts).to.have.length(2);
        for (const conflict of preview.body.conflicts)
        {
            expect(conflict.spreads.original).to.have.length(1);
            expect(conflict.spreads.current).to.have.length(1);
            expect(conflict.spreads.incoming).to.have.length(1);
            expect(conflict.spreads.original[0].set.name).to.equal("gFrontierSpreads");
        }
    });

    it("smart import does not reoffer incoming spreads already loaded identically", async () =>
    {
        const exported = await post(`/api/workspaces/${source.workspaceId}/spread-files/export`, {}).buffer(true).parse(parseBinary);
        const baseline = (await post(`/api/workspaces/${source.workspaceId}/spread-files/exports`, {})).body.exports[0];
        const zip = new AdmZip(exported.body);
        const changed = zip.readAsText(path.posix.basename(SPREAD_FILE)).replace(".hpEv = 252", ".hpEv = 248");
        zip.updateFile(path.posix.basename(SPREAD_FILE), Buffer.from(changed));
        fs.writeFileSync(path.join(fixture.paths.cfru, SPREAD_FILE), changed);
        source = (await post("/api/workspaces/load", { paths: fixture.paths })).body;
        const preview = await request(app).post(`/api/workspaces/${source.workspaceId}/spread-files/import`)
            .query({ revision: source.spreads.revision, baselineId: baseline.id }).set("Origin", ORIGIN).set(SESSION_HEADER, token)
            .set("Content-Type", "application/zip").send(zip.toBuffer());
        expect(preview.status, JSON.stringify(preview.body)).to.equal(200);
        expect(preview.body.conflicts).to.have.length(0);
        expect(preview.body.changes).to.have.length(0);
    });

    it("smart import keeps the API responsive and reports real parsing/comparison stages", async function ()
    {
        this.timeout(60000);
        const entries = Array.from({ length: 1200 }, (_, index) =>
            `    { .species = SPECIES_VENUSAUR, .hpEv = ${index % 252}, .moves = { MOVE_GIGADRAIN }, .forSingles = TRUE, /* Spread ${index} */ },`);
        fs.writeFileSync(path.join(fixture.paths.cfru, SPREAD_FILE), `const struct BattleTowerSpread gFrontierSpreads[] =\n{\n${entries.join("\n")}\n};\n`);
        source = (await post("/api/workspaces/load", { paths: fixture.paths })).body;
        const workspace = require("../../services/repositories").getWorkspace(source.workspaceId);
        const exported = await archiveService.exportArchive(workspace, undefined, undefined, true);
        const baseline = (await require("../../services/spread-exchange").listSpreadExports(workspace))[0];
        const zip = new AdmZip(exported);
        zip.updateFile(path.posix.basename(SPREAD_FILE), Buffer.from(zip.readAsText(path.posix.basename(SPREAD_FILE)).replace(".hpEv = 0", ".hpEv = 4")));
        const smallHeader = zip.getEntries().find((entry) => entry.entryName !== path.posix.basename(SPREAD_FILE));
        zip.updateFile(smallHeader.entryName, Buffer.from(zip.readAsText(smallHeader.entryName) + "\n// Small incoming change\n"));
        const progress = [];
        let heartbeats = 0;
        const interval = setInterval(() => { heartbeats++; }, 1);
        let preview;
        try
        {
            preview = await archiveService.importSpreadFiles(workspace, zip.toBuffer(), source.spreads.revision,
                (event) => progress.push(event), baseline.id);
        }
        finally
        {
            clearInterval(interval);
        }
        expect(preview.changes).to.have.length(1);
        expect(heartbeats).to.be.greaterThan(2);
        expect(progress.some((event) => event.percentage > 50 && event.percentage < 99)).to.equal(true);
        expect(progress.map((event) => event.label)).to.include("Comparing Whole Spreads...");
        const firstParse = progress.findIndex((event) => event.label === "Reading Current Spreads...");
        expect(Math.max(...progress.slice(0, firstParse).map((event) => event.percentage))).to.be.at.most(30);
        const matchingProgress = progress.filter((event) => event.label === "Comparing Whole Spreads...");
        expect(new Set(matchingProgress.map((event) => event.percentage)).size).to.be.greaterThan(10);
        expect(progress.find((event) => event.label === "Preparing Spread Comparisons...").percentage).to.be.greaterThan(90);
        for (let index = 1; index < progress.length; index++)
            expect(progress[index].percentage).to.be.at.least(progress[index - 1].percentage);
    });

    it("smart import keeps local edits when the collaborator returns an unchanged export", async () =>
    {
        const exported = await post(`/api/workspaces/${source.workspaceId}/spread-files/export`, {}).buffer(true).parse(parseBinary);
        const baseline = (await post(`/api/workspaces/${source.workspaceId}/spread-files/exports`, {})).body.exports[0];
        fs.appendFileSync(path.join(fixture.paths.cfru, SPREAD_FILE), "\r\n// Local work after export\r\n");
        source = (await post("/api/workspaces/load", { paths: fixture.paths })).body;
        const before = fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE));
        const preview = await request(app).post(`/api/workspaces/${source.workspaceId}/spread-files/import`)
            .query({ revision: source.spreads.revision, baselineId: baseline.id }).set("Origin", ORIGIN).set(SESSION_HEADER, token)
            .set("Content-Type", "application/zip").send(exported.body);
        expect(preview.status, JSON.stringify(preview.body)).to.equal(200);
        expect(preview.body.changes).to.deep.equal([]);
        expect(preview.body.changedFiles).to.deep.equal([]);
        const applied = await post(`/api/workspaces/${source.workspaceId}/spread-files/merge`, { previewId: preview.body.previewId });
        expect(applied.status).to.equal(200);
        expect(applied.body.backupId).to.equal(null);
        expect(fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE)).equals(before)).to.equal(true);
    });

    it("smart import treats different-field edits to the same spread as a whole-spread conflict", async () =>
    {
        const exported = await post(`/api/workspaces/${source.workspaceId}/spread-files/export`, {}).buffer(true).parse(parseBinary);
        const baseline = (await post(`/api/workspaces/${source.workspaceId}/spread-files/exports`, {})).body.exports[0];
        const zip = new AdmZip(exported.body);
        const original = zip.readAsText(path.posix.basename(SPREAD_FILE));
        zip.updateFile(path.posix.basename(SPREAD_FILE), Buffer.from(original.replace(".item = ITEM_BLACK_SLUDGE", ".item = ITEM_LIFE_ORB")));
        fs.writeFileSync(path.join(fixture.paths.cfru, SPREAD_FILE), original.replace(".hpEv = 252", ".hpEv = 244"));
        source = (await post("/api/workspaces/load", { paths: fixture.paths })).body;
        const preview = await request(app).post(`/api/workspaces/${source.workspaceId}/spread-files/import`)
            .query({ revision: source.spreads.revision, baselineId: baseline.id }).set("Origin", ORIGIN).set(SESSION_HEADER, token)
            .set("Content-Type", "application/zip").send(zip.toBuffer());
        expect(preview.status, JSON.stringify(preview.body)).to.equal(200);
        expect(preview.body.conflicts).to.have.length(1);
        expect(preview.body.conflicts[0].current).to.include(".species = SPECIES_VENUSAUR");
        expect(preview.body.conflicts[0].incoming).to.include(".species = SPECIES_VENUSAUR");
        const applied = await post(`/api/workspaces/${source.workspaceId}/spread-files/merge`,
            { previewId: preview.body.previewId, choices: { [preview.body.conflicts[0].id]: "current" } });
        expect(applied.status, JSON.stringify(applied.body)).to.equal(200);
        expect(fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE), "utf8")).to.equal(original
            .replace(".hpEv = 252", ".hpEv = 244"));
    });

    it("smart import merges incoming additions and deletions with local edits to other spreads", async () =>
    {
        const exported = await post(`/api/workspaces/${source.workspaceId}/spread-files/export`, {}).buffer(true).parse(parseBinary);
        const baseline = (await post(`/api/workspaces/${source.workspaceId}/spread-files/exports`, {})).body.exports[0];
        const zip = new AdmZip(exported.body);
        const original = zip.readAsText(path.posix.basename(SPREAD_FILE));
        const start = original.indexOf("\t{\r\n\t\t.species = SPECIES_VENUSAUR");
        const end = original.indexOf("\t//Gen 8", start);
        const entry = original.slice(start, end);
        const model = require("../../services/spread-parser").parseSpreadFile(original,
            require("../../services/repositories").getWorkspace(source.workspaceId).spreads.macros);
        const removed = model.sets.find((set) => set.name === "gFrontierSpreads").entries.find((entry) => entry.fields.species === "SPECIES_CHARIZARD");
        const placeholderStart = original.lastIndexOf("\n", removed.start) + 1;
        const placeholderEnd = original.indexOf("\n", removed.end) + 1;
        const remote = original.slice(0, placeholderStart) + original.slice(placeholderEnd);
        zip.updateFile(path.posix.basename(SPREAD_FILE), Buffer.from(remote.slice(0, end) + entry.replace("SPECIES_VENUSAUR", "SPECIES_BLASTOISE") + remote.slice(end)));
        fs.writeFileSync(path.join(fixture.paths.cfru, SPREAD_FILE), original.replace(".hpEv = 252", ".hpEv = 248"));
        source = (await post("/api/workspaces/load", { paths: fixture.paths })).body;
        const preview = await request(app).post(`/api/workspaces/${source.workspaceId}/spread-files/import`)
            .query({ revision: source.spreads.revision, baselineId: baseline.id }).set("Origin", ORIGIN).set(SESSION_HEADER, token)
            .set("Content-Type", "application/zip").send(zip.toBuffer());
        expect(preview.status, JSON.stringify(preview.body)).to.equal(200);
        expect(preview.body.conflicts).to.deep.equal([]);
        const applied = await post(`/api/workspaces/${source.workspaceId}/spread-files/merge`, { previewId: preview.body.previewId,
            choices: Object.fromEntries(preview.body.changes.map((change) => [change.id, "incoming"])) });
        expect(applied.status, JSON.stringify(applied.body)).to.equal(200);
        const saved = await post(`/api/workspaces/${source.workspaceId}/save`, { revision: source.spreads.revision, operations: applied.body.operations });
        expect(saved.status, JSON.stringify(saved.body)).to.equal(200);
        const set = saved.body.spreads.sets.find((set) => set.file === SPREAD_FILE && set.name === "gFrontierSpreads");
        const entries = saved.body.spreads.entries.filter((entry) => entry.setId === set.id);
        expect(entries.some((entry) => entry.fields.species === "SPECIES_BLASTOISE")).to.equal(true);
        expect(entries.some((entry) => entry.fields.species === "SPECIES_CHARIZARD")).to.equal(false);
        expect(entries.find((entry) => entry.fields.species === "SPECIES_VENUSAUR").fields.hpEv).to.equal(248);
    });

    it("merges an incoming move edit into a locally reordered spread without a structural review", async () =>
    {
        const exported = await post(`/api/workspaces/${source.workspaceId}/spread-files/export`, {}).buffer(true).parse(parseBinary);
        const baseline = (await post(`/api/workspaces/${source.workspaceId}/spread-files/exports`, {})).body.exports[0];
        const zip = new AdmZip(exported.body);
        const original = zip.readAsText(path.posix.basename(SPREAD_FILE));
        const set = source.spreads.sets.find((set) => set.name === "gFrontierSpreads");
        const movedId = set.entryIds[0];
        const moved = source.spreads.entries.find((entry) => entry.id === movedId);
        const incomingMoves = [...moved.fields.moves];
        incomingMoves[0] = "MOVE_TACKLE";
        zip.updateFile(path.posix.basename(SPREAD_FILE), Buffer.from(original.replace(moved.fields.moves[0], incomingMoves[0])));
        const order = [...set.entryIds.slice(1), movedId];
        const localOperations = [{ type: "reorder", setId: set.id, order }];
        const context = await post(`/api/workspaces/${source.workspaceId}/spread-files/current`,
            { revision: source.spreads.revision, operations: localOperations });
        expect(context.status, JSON.stringify(context.body)).to.equal(200);
        const preview = await request(app).post(`/api/workspaces/${source.workspaceId}/spread-files/import`)
            .query({ revision: source.spreads.revision, baselineId: baseline.id, currentId: context.body.currentId })
            .set("Origin", ORIGIN).set(SESSION_HEADER, token).set("Content-Type", "application/zip").send(zip.toBuffer());
        expect(preview.status, JSON.stringify(preview.body)).to.equal(200);
        expect(preview.body.conflicts).to.deep.equal([]);
        expect(preview.body.changes).to.have.length(1);
        expect(preview.body.changes[0].operations).to.deep.equal([{ type: "update", entryId: movedId, fields: { moves: incomingMoves } }]);
        const applied = await post(`/api/workspaces/${source.workspaceId}/spread-files/merge`, { previewId: preview.body.previewId,
            choices: { [preview.body.changes[0].id]: "incoming" } });
        expect(applied.status, JSON.stringify(applied.body)).to.equal(200);
        expect(fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE), "utf8")).to.equal(original);
        const saved = await post(`/api/workspaces/${source.workspaceId}/save`,
            { revision: source.spreads.revision, operations: [...localOperations, ...applied.body.operations] });
        expect(saved.status, JSON.stringify(saved.body)).to.equal(200);
        expect(saved.body.spreads.sets.find((candidate) => candidate.id === set.id).entryIds).to.deep.equal(order);
        expect(saved.body.spreads.entries.find((entry) => entry.id === movedId).fields.moves).to.deep.equal(incomingMoves);
    });

    it("shows current edits for a spread that was both moved and edited locally", async () =>
    {
        const exported = await post(`/api/workspaces/${source.workspaceId}/spread-files/export`, {}).buffer(true).parse(parseBinary);
        const baseline = (await post(`/api/workspaces/${source.workspaceId}/spread-files/exports`, {})).body.exports[0];
        const zip = new AdmZip(exported.body);
        const original = zip.readAsText(path.posix.basename(SPREAD_FILE));
        const set = source.spreads.sets.find((set) => set.name === "gFrontierSpreads");
        const movedId = set.entryIds[0];
        const moved = source.spreads.entries.find((entry) => entry.id === movedId);
        const incomingMoves = [...moved.fields.moves];
        incomingMoves[0] = "MOVE_TACKLE";
        const currentMoves = [...moved.fields.moves];
        currentMoves[0] = "MOVE_PROTECT";
        zip.updateFile(path.posix.basename(SPREAD_FILE), Buffer.from(original.replace(moved.fields.moves[0], incomingMoves[0])));
        const context = await post(`/api/workspaces/${source.workspaceId}/spread-files/current`, { revision: source.spreads.revision, operations: [
            { type: "update", entryId: movedId, fields: { moves: currentMoves } },
            { type: "reorder", setId: set.id, order: [...set.entryIds.slice(1), movedId] },
        ] });
        expect(context.status, JSON.stringify(context.body)).to.equal(200);
        const preview = await request(app).post(`/api/workspaces/${source.workspaceId}/spread-files/import`)
            .query({ revision: source.spreads.revision, baselineId: baseline.id, currentId: context.body.currentId })
            .set("Origin", ORIGIN).set(SESSION_HEADER, token).set("Content-Type", "application/zip").send(zip.toBuffer());
        expect(preview.status, JSON.stringify(preview.body)).to.equal(200);
        expect(preview.body.changes).to.deep.equal([]);
        expect(preview.body.conflicts).to.have.length(1);
        const conflict = preview.body.conflicts[0];
        expect(conflict.spreads.current).to.have.length(1);
        expect(conflict.spreads.current[0].entryId).to.equal(movedId);
        expect(conflict.spreads.current[0].fields.moves).to.deep.equal(currentMoves);
        expect(conflict.operations).to.deep.equal([{ type: "update", entryId: movedId, fields: { moves: incomingMoves } }]);
        expect(fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE), "utf8")).to.equal(original);
    });

    it("keeps a locally reordered large same-species pool to one compact incoming edit", async () =>
    {
        const entries = Array.from({ length: 600 }, (_, index) =>
            `    { .species = SPECIES_VENUSAUR, .hpEv = ${index % 252}, .atkIv = ${Math.floor(index / 252)}, .moves = { MOVE_GIGADRAIN }, .forSingles = TRUE },`);
        const original = `const struct BattleTowerSpread gFrontierSpreads[] =\n{\n${entries.join("\n")}\n};\n`;
        fs.writeFileSync(path.join(fixture.paths.cfru, SPREAD_FILE), original);
        source = (await post("/api/workspaces/load", { paths: fixture.paths })).body;
        const exported = await post(`/api/workspaces/${source.workspaceId}/spread-files/export`, {}).buffer(true).parse(parseBinary);
        const baseline = (await post(`/api/workspaces/${source.workspaceId}/spread-files/exports`, {})).body.exports[0];
        const zip = new AdmZip(exported.body);
        zip.updateFile(path.posix.basename(SPREAD_FILE), Buffer.from(original.replace("MOVE_GIGADRAIN", "MOVE_TACKLE")));
        const set = source.spreads.sets.find((set) => set.name === "gFrontierSpreads");
        const movedId = set.entryIds[0];
        const context = await post(`/api/workspaces/${source.workspaceId}/spread-files/current`, { revision: source.spreads.revision,
            operations: [{ type: "reorder", setId: set.id, order: [...set.entryIds.slice(1), movedId] }] });
        expect(context.status, JSON.stringify(context.body)).to.equal(200);
        const preview = await request(app).post(`/api/workspaces/${source.workspaceId}/spread-files/import`)
            .query({ revision: source.spreads.revision, baselineId: baseline.id, currentId: context.body.currentId })
            .set("Origin", ORIGIN).set(SESSION_HEADER, token).set("Content-Type", "application/zip").send(zip.toBuffer());
        expect(preview.status, JSON.stringify(preview.body)).to.equal(200);
        expect(preview.body.conflicts).to.deep.equal([]);
        expect(preview.body.changes).to.have.length(1);
        expect(preview.body.changes[0].operations).to.deep.equal([{ type: "update", entryId: movedId,
            fields: { moves: ["MOVE_TACKLE", 0, 0, 0] } }]);
        expect(Buffer.byteLength(JSON.stringify(preview.body))).to.be.lessThan(128 * 1024);
        expect(fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE), "utf8")).to.equal(original);
    });

    it("stages incoming order changes with the same entry IDs and no automatic save", async () =>
    {
        const exported = await post(`/api/workspaces/${source.workspaceId}/spread-files/export`, {}).buffer(true).parse(parseBinary);
        const baseline = (await post(`/api/workspaces/${source.workspaceId}/spread-files/exports`, {})).body.exports[0];
        const zip = new AdmZip(exported.body);
        const original = zip.readAsText(path.posix.basename(SPREAD_FILE));
        const workspace = require("../../services/repositories").getWorkspace(source.workspaceId);
        const parsed = require("../../services/spread-parser").parseSpreadFile(original, workspace.spreads.macros);
        const [first, second] = parsed.sets.find((set) => set.name === "gFrontierSpreads").entries;
        zip.updateFile(path.posix.basename(SPREAD_FILE), Buffer.from(original.slice(0, first.start) + original.slice(second.start, second.end)
            + original.slice(first.end, second.start) + original.slice(first.start, first.end) + original.slice(second.end)));
        const preview = await request(app).post(`/api/workspaces/${source.workspaceId}/spread-files/import`)
            .query({ revision: source.spreads.revision, baselineId: baseline.id }).set("Origin", ORIGIN).set(SESSION_HEADER, token)
            .set("Content-Type", "application/zip").send(zip.toBuffer());
        expect(preview.status).to.equal(200);
        expect(preview.body.conflicts).to.have.length(1);
        const staged = await post(`/api/workspaces/${source.workspaceId}/spread-files/merge`,
            { previewId: preview.body.previewId, choices: { [preview.body.conflicts[0].id]: "incoming" } });
        expect(staged.status, JSON.stringify(staged.body)).to.equal(200);
        const set = source.spreads.sets.find((set) => set.name === "gFrontierSpreads");
        expect(staged.body.operations).to.deep.equal([{ type: "reorder", setId: set.id, order: [set.entryIds[1], set.entryIds[0], ...set.entryIds.slice(2)] }]);
        expect(preview.body.conflicts[0].operations).to.deep.equal(staged.body.operations);
        expect(fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE), "utf8")).to.equal(original);
    });

    it("smart import requires review for reordering alongside local edits instead of duplicating spreads", async () =>
    {
        const exported = await post(`/api/workspaces/${source.workspaceId}/spread-files/export`, {}).buffer(true).parse(parseBinary);
        const baseline = (await post(`/api/workspaces/${source.workspaceId}/spread-files/exports`, {})).body.exports[0];
        const zip = new AdmZip(exported.body);
        const original = zip.readAsText(path.posix.basename(SPREAD_FILE));
        const workspace = require("../../services/repositories").getWorkspace(source.workspaceId);
        const parsed = require("../../services/spread-parser").parseSpreadFile(original, workspace.spreads.macros);
        const [first, second] = parsed.sets.find((set) => set.name === "gFrontierSpreads").entries;
        const reordered = original.slice(0, first.start) + original.slice(second.start, second.end)
            + original.slice(first.end, second.start) + original.slice(first.start, first.end) + original.slice(second.end);
        zip.updateFile(path.posix.basename(SPREAD_FILE), Buffer.from(reordered));
        const local = original.replace(".hpEv = 252", ".hpEv = 248");
        fs.writeFileSync(path.join(fixture.paths.cfru, SPREAD_FILE), local);
        source = (await post("/api/workspaces/load", { paths: fixture.paths })).body;
        const preview = await request(app).post(`/api/workspaces/${source.workspaceId}/spread-files/import`)
            .query({ revision: source.spreads.revision, baselineId: baseline.id }).set("Origin", ORIGIN).set(SESSION_HEADER, token)
            .set("Content-Type", "application/zip").send(zip.toBuffer());
        expect(preview.status, JSON.stringify(preview.body)).to.equal(200);
        expect(preview.body.conflicts).to.have.length(1);
        expect(preview.body.conflicts[0].label).to.equal("Spread Order And Concurrent Edits");
        const applied = await post(`/api/workspaces/${source.workspaceId}/spread-files/merge`,
            { previewId: preview.body.previewId, choices: { [preview.body.conflicts[0].id]: "current" } });
        expect(applied.status, JSON.stringify(applied.body)).to.equal(200);
        expect(fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE), "utf8")).to.equal(local);
    });

    it("smart import reviews edits to indistinguishable duplicate spreads", async () =>
    {
        const original = fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE), "utf8");
        const start = original.indexOf("\t{\r\n\t\t.species = SPECIES_VENUSAUR");
        const end = original.indexOf("\t//Gen 8", start);
        const duplicateSource = original.slice(0, end) + original.slice(start, end) + original.slice(end);
        fs.writeFileSync(path.join(fixture.paths.cfru, SPREAD_FILE), duplicateSource);
        source = (await post("/api/workspaces/load", { paths: fixture.paths })).body;
        const exported = await post(`/api/workspaces/${source.workspaceId}/spread-files/export`, {}).buffer(true).parse(parseBinary);
        const baseline = (await post(`/api/workspaces/${source.workspaceId}/spread-files/exports`, {})).body.exports[0];
        const zip = new AdmZip(exported.body);
        zip.updateFile(path.posix.basename(SPREAD_FILE), Buffer.from(duplicateSource.replace(".hpEv = 252", ".hpEv = 248")));
        fs.writeFileSync(path.join(fixture.paths.cfru, SPREAD_FILE), duplicateSource.replace(".item = ITEM_BLACK_SLUDGE", ".item = ITEM_LIFE_ORB"));
        source = (await post("/api/workspaces/load", { paths: fixture.paths })).body;
        const preview = await request(app).post(`/api/workspaces/${source.workspaceId}/spread-files/import`)
            .query({ revision: source.spreads.revision, baselineId: baseline.id }).set("Origin", ORIGIN).set(SESSION_HEADER, token)
            .set("Content-Type", "application/zip").send(zip.toBuffer());
        expect(preview.status, JSON.stringify(preview.body)).to.equal(200);
        expect(preview.body.conflicts).to.have.length(1);
        expect(preview.body.conflicts[0].label).to.equal("Ambiguous Duplicate Spreads");
    });

    it("rejects stale and foreign smart previews and tampered export baselines", async () =>
    {
        const exported = await post(`/api/workspaces/${source.workspaceId}/spread-files/export`, {}).buffer(true).parse(parseBinary);
        const baseline = (await post(`/api/workspaces/${source.workspaceId}/spread-files/exports`, {})).body.exports[0];
        const zip = new AdmZip(exported.body);
        zip.updateFile(path.posix.basename(SPREAD_FILE), Buffer.from(zip.readAsText(path.posix.basename(SPREAD_FILE)).replace(".hpEv = 252", ".hpEv = 248")));
        const preview = await request(app).post(`/api/workspaces/${source.workspaceId}/spread-files/import`)
            .query({ revision: source.spreads.revision, baselineId: baseline.id }).set("Origin", ORIGIN).set(SESSION_HEADER, token)
            .set("Content-Type", "application/zip").send(zip.toBuffer());
        expect(preview.status).to.equal(200);
        const foreign = await require("../../services/spread-exchange").applySpreadMerge({ roots: { cfru: path.join(fixture.base, "other") } },
            { previewId: preview.body.previewId }).then(() => null, (error) => error);
        expect(foreign.code).to.equal("MERGE_PREVIEW_EXPIRED");
        fs.appendFileSync(path.join(fixture.paths.cfru, SPREAD_FILE), "\r\n// Changed after preview\r\n");
        const before = fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE));
        const stale = await post(`/api/workspaces/${source.workspaceId}/spread-files/merge`, { previewId: preview.body.previewId,
            choices: Object.fromEntries(preview.body.changes.map((change) => [change.id, "incoming"])) });
        expect(stale.status).to.equal(409);
        expect(fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE)).equals(before)).to.equal(true);
        const directory = path.join(process.env.SPREAD_EDITOR_DATA_DIR, "spread-exports");
        const bucket = fs.readdirSync(directory)[0];
        fs.appendFileSync(path.join(directory, bucket, baseline.id, "spread-files.zip"), "tampered");
        const damaged = await require("../../services/spread-exchange").readSpreadExport(require("../../services/repositories").getWorkspace(source.workspaceId), baseline.id)
            .then(() => null, (error) => error);
        expect(damaged.code).to.equal("EXPORT_INVALID");
    });

    it("rejects unknown files and duplicate spread aliases before overwriting", async () =>
    {
        const original = fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE));
        for (const extra of ["src/config.h", SPREAD_FILE])
        {
            const zip = new AdmZip();
            zip.addFile(`cfru/${SPREAD_FILE}`, original);
            zip.addFile(extra, original);
            const res = await request(app).post(`/api/workspaces/${source.workspaceId}/spread-files/import`)
                .query({ revision: source.spreads.revision }).set("Origin", ORIGIN).set(SESSION_HEADER, token)
                .set("Content-Type", "application/zip").send(zip.toBuffer());
            expect(res.status).to.equal(422);
            expect(fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE)).equals(original)).to.equal(true);
        }
    });

    it("imports a single bare header without changing omitted spread files or reference repositories", async () =>
    {
        const originals = new Map(Object.entries(fixture.paths).flatMap(([kind, root]) =>
            (kind === "cfru" ? require("../../services/repositories").CFRU_SPREAD_FILES : [kind === "dpe" ? "src/Learnsets.c" : "src/PokemonUtil.jsx"])
                .map((file) => [path.join(root, file), fs.readFileSync(path.join(root, file))])));
        const zip = new AdmZip();
        const replacement = Buffer.from(originals.get(path.join(fixture.paths.cfru, SPREAD_FILE)).toString("utf8") + "\r\n// Single header\r\n");
        zip.addFile(path.posix.basename(SPREAD_FILE), replacement);
        const res = await request(app).post(`/api/workspaces/${source.workspaceId}/spread-files/import`)
            .query({ revision: source.spreads.revision }).set("Origin", ORIGIN).set(SESSION_HEADER, token)
            .set("Content-Type", "application/zip").send(zip.toBuffer());
        expect(res.status, JSON.stringify(res.body)).to.equal(200);
        for (const [file, original] of originals)
            expect(fs.readFileSync(file).equals(original)).to.equal(true);
    });

    it("rejects malformed, unsafe, non-UTF8, and stale spread imports without changing files", async () =>
    {
        const original = fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE));
        for (const [name, contents, revision, status] of [
            [SPREAD_FILE, Buffer.from("const struct BattleTowerSpread gBroken[] = { ."), source.spreads.revision, 422],
            [SPREAD_FILE, Buffer.from([255, 254, 0]), source.spreads.revision, 422],
            ["../battle_tower_spreads.h", original, source.spreads.revision, 422],
            [SPREAD_FILE, original, "old-revision", 409],
        ])
        {
            const zip = new AdmZip();
            zip.addFile("entry", contents).entryName = name;
            const res = await request(app).post(`/api/workspaces/${source.workspaceId}/spread-files/import`)
                .query({ revision }).set("Origin", ORIGIN).set(SESSION_HEADER, token)
                .set("Content-Type", "application/zip").send(zip.toBuffer());
            expect(res.status, JSON.stringify(res.body)).to.equal(status);
            expect(fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE)).equals(original)).to.equal(true);
        }
        const zip = new AdmZip();
        zip.addFile(SPREAD_FILE, original);
        fs.appendFileSync(path.join(fixture.paths.cfru, SPREAD_FILE), "\n// External change\n");
        const externallyChanged = fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE));
        const res = await request(app).post(`/api/workspaces/${source.workspaceId}/spread-files/import`)
            .query({ revision: source.spreads.revision }).set("Origin", ORIGIN).set(SESSION_HEADER, token)
            .set("Content-Type", "application/zip").send(zip.toBuffer());
        expect(res.status).to.equal(409);
        expect(fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE)).equals(externallyChanged)).to.equal(true);
    });

    it("protects spread-file imports with session, origin, host, and content-type checks", async () =>
    {
        const route = `/api/workspaces/${source.workspaceId}/spread-files/import`;
        const zip = new AdmZip();
        zip.addFile(SPREAD_FILE, fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE)));
        const body = zip.toBuffer();
        expect((await request(app).post(route).set("Content-Type", "application/zip").send(body)).status).to.equal(401);
        expect((await request(app).post(route).set(SESSION_HEADER, token).set("Origin", "https://evil.example").send(body)).status).to.equal(403);
        expect((await request(app).post(route).set(SESSION_HEADER, token).set("Host", "evil.example").send(body)).status).to.equal(403);
        expect((await post(route, {})).status).to.equal(415);
        expect((await post(`/api/workspaces/${source.workspaceId}/spread-files/export`, {})).status).to.equal(200);
    });

    it("exports only exact editor sources and all games with a path-free manifest", async () =>
    {
        const res = await post(`/api/workspaces/${source.workspaceId}/archive`, { gameId: "cfru" }).buffer(true).parse(parseBinary);
        expect(res.status).to.equal(200);
        expect(res.headers["content-type"]).to.equal("application/zip");
        expect(res.headers["content-disposition"]).to.include('attachment; filename="spread-editor-reqs.zip"');
        const zip = new AdmZip(res.body);
        expect(JSON.parse(zip.readAsText("manifest.json"))).to.deep.equal({ format: "cfru-spread-editor", version: 1, gameId: "cfru" });
        expect(zip.getEntry("cloud/.env")).to.equal(null);
        expect(zip.getEntry("cloud/src/data/private-secret.json")).to.equal(null);
        expect(zip.getEntry("dpe/graphics/frontspr/private.txt")).to.equal(null);
        for (const game of ["cfru", "alpha", "zeta"])
            expect(zip.getEntry(`cloud/src/data/${game}/BaseStats.json`)).not.to.equal(null);
        expect(zip.getEntry("cfru/src/Tables/item_tables.c")).not.to.equal(null);
        expect(zip.getEntry("dpe/src/defines.h")).not.to.equal(null);
        expect(zip.readFile(`cloud/${OPTIONAL_IMAGE}`).equals(OPTIONAL_BYTES)).to.equal(true);
        expect(zip.getEntry("dpe/graphics/frontspr/gFrontSprite003Venusaur.png")).not.to.equal(null);
        for (const entry of zip.getEntries().filter((entry) => !entry.isDirectory && entry.entryName !== "manifest.json"))
        {
            const [kind, ...parts] = entry.entryName.split("/");
            expect(entry.getData().equals(fs.readFileSync(path.join(fixture.paths[kind], ...parts)))).to.equal(true);
        }
    });

    it("roundtrips a repository with only one spread header", async () =>
    {
        const { CFRU_SPREAD_FILES, getWorkspace } = require("../../services/repositories");
        const onlyFile = "src/Tables/raid_rush_spreads.h";
        for (const file of CFRU_SPREAD_FILES.filter((file) => file !== onlyFile))
            fs.unlinkSync(path.join(fixture.paths.cfru, file));
        const loaded = await post("/api/workspaces/load", { paths: fixture.paths });
        expect(loaded.status, JSON.stringify(loaded.body)).to.equal(200);
        const exported = await archiveService.exportArchive(getWorkspace(loaded.body.workspaceId));
        const zip = new AdmZip(exported);
        for (const file of CFRU_SPREAD_FILES)
            expect(zip.getEntry(`cfru/${file}`) != null).to.equal(file === onlyFile);
        const imported = await upload(exported);
        expect(imported.status, JSON.stringify(imported.body)).to.equal(200);
        expect(imported.body.spreads.files.map((file) => file.path)).to.deep.equal([onlyFile]);
        expect(imported.body.spreads.sets).to.deep.equal(loaded.body.spreads.sets);
    });

    it("roundtrips binaries, empty compatibility directories and normal spreads", async () =>
    {
        for (const folder of ["src/tm_compatibility", "src/tutor_compatibility"])
        {
            fs.rmSync(path.join(fixture.paths.dpe, folder), { recursive: true });
            fs.mkdirSync(path.join(fixture.paths.dpe, folder));
        }
        const exported = await archiveService.exportArchive(require("../../services/repositories").getWorkspace(source.workspaceId));
        const res = await upload(exported);
        expect(res.status, JSON.stringify(res.body)).to.equal(200);
        expect(res.body).to.have.all.keys("workspaceId", "repositories", "games", "spreads", "diagnostics");
        expect(res.body.spreads.entries).to.deep.equal(source.spreads.entries);
        expect(res.body.games).to.deep.equal(source.games);
        for (const folder of ["src/tm_compatibility", "src/tutor_compatibility"])
            expect(fs.readdirSync(path.join(res.body.repositories.dpe.path, folder))).to.deep.equal([]);
        expect(fs.readFileSync(path.join(res.body.repositories.cloud.path, OPTIONAL_IMAGE)).equals(OPTIONAL_BYTES)).to.equal(true);
        expect(imports()).to.have.length(1);
        for (const repository of Object.values(res.body.repositories))
        {
            const parent = fs.realpathSync.native(path.join(process.env.SPREAD_EDITOR_DATA_DIR, "imports"));
            expect(path.relative(parent, fs.realpathSync.native(repository.path)), `${parent}: ${repository.path}`).not.to.match(/^\.\./);
        }
    });

    it("reports real asynchronous compression item completions and yielding pre-extraction validation", async () =>
    {
        const { PROGRESS_LABELS } = require("../../services/progress");
        const exportEvents = [];
        let compressionYielded = false;
        const exported = await archiveService.exportArchive(require("../../services/repositories").getWorkspace(source.workspaceId), "cfru", (event) =>
        {
            exportEvents.push(event);
            if (event.label === PROGRESS_LABELS.compression && event.percentage === 45)
                setImmediate(() => { compressionYielded = true; });
            if (event.label === PROGRESS_LABELS.compression && event.percentage > 45)
                expect(compressionYielded).to.equal(true);
        });
        const compressionEvents = exportEvents.filter((event) => event.label === PROGRESS_LABELS.compression);
        expect(compressionEvents).to.have.length(new AdmZip(exported).getEntryCount() + 1);
        expect(compressionEvents.at(-1).percentage).to.equal(99);
        expect(exportEvents.some((event) => event.percentage > 5 && event.percentage < 45)).to.equal(true);

        const importEvents = [];
        let validationYielded = false;
        const imported = await archiveService.importArchive(exported, (event) =>
        {
            importEvents.push(event);
            if (event.percentage === 20)
                setImmediate(() => { validationYielded = true; });
            if (event.label === PROGRESS_LABELS.validation)
            {
                expect(validationYielded).to.equal(true);
                expect(imports()).to.deep.equal([]);
            }
        });
        expect(imported.spreads.entries).to.deep.equal(source.spreads.entries);
        for (const label of [PROGRESS_LABELS.headers, PROGRESS_LABELS.paths, PROGRESS_LABELS.validation,
            PROGRESS_LABELS.extraction, PROGRESS_LABELS.repositories, PROGRESS_LABELS.catalog, PROGRESS_LABELS.spreads])
            expect(importEvents.some((event) => event.label === label), label).to.equal(true);
        for (const events of [exportEvents, importEvents])
        {
            let previous = 0;
            for (const event of events)
            {
                expect(Number.isInteger(event.percentage)).to.equal(true);
                expect(event.percentage).to.be.within(previous, 99);
                previous = event.percentage;
                expect(JSON.stringify(event)).not.to.include(fixture.base);
            }
        }
        expect(importEvents.at(-1).percentage).to.equal(99);
    });

    it("reports completed repository roots and sentinel checks with the optional load callback", async () =>
    {
        const { loadWorkspace, REPOSITORY_KINDS, REPOSITORY_SENTINELS } = require("../../services/repositories");
        const { PROGRESS_LABELS } = require("../../services/progress");
        const events = [];
        const snapshot = await loadWorkspace(fixture.paths, (event) => events.push(event));
        expect(snapshot.games).to.deep.equal(source.games);
        const totalChecks = REPOSITORY_KINDS.reduce((total, kind) => total + 1 + REPOSITORY_SENTINELS[kind].length, 0);
        expect(events.filter((event) => event.label === PROGRESS_LABELS.repositories)).to.have.length(totalChecks + 1);
        expect(events.map((event) => event.label)).to.include.members([PROGRESS_LABELS.games, PROGRESS_LABELS.access, PROGRESS_LABELS.spreads]);
        expect(events.at(-1).percentage).to.equal(95);
    });

    it("keeps cached CFRU writable across restarts without changing original repositories", async () =>
    {
        const imported = (await upload(bytes)).body;
        expect(imported.gameId).to.equal("cfru");
        const original = fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE));
        const entry = imported.spreads.entries.find((candidate) => candidate.fields.species === "SPECIES_VENUSAUR");
        const saved = await post(`/api/workspaces/${imported.workspaceId}/save`,
            { revision: imported.spreads.revision, gameId: "cfru", operations: [{ type: "update", entryId: entry.id, fields: { hpEv: 248 } }] });
        expect(saved.status, JSON.stringify(saved.body)).to.equal(200);
        expect(fs.readFileSync(path.join(fixture.paths.cfru, SPREAD_FILE)).equals(original)).to.equal(true);
        const paths = Object.fromEntries(Object.entries(imported.repositories).map(([kind, repository]) => [kind, repository.path]));
        app = startServer();
        token = (await request(app).post("/api/session").set("Origin", ORIGIN)).body.token;
        const reloaded = await post("/api/workspaces/load", { paths });
        expect(reloaded.status).to.equal(200);
        expect(reloaded.body.spreads.entries.find((candidate) => candidate.id === entry.id).fields.hpEv).to.equal(248);
    });

    it("discovers custom nested JSON imports and present sources for unavailable declared games", async () =>
    {
        const config = path.join(fixture.paths.cloud, "src/PokemonUtil.jsx");
        const oldFile = path.join(fixture.paths.cloud, "src/data/zeta/BaseStats.json");
        const newFile = path.join(fixture.paths.cloud, "src/data/custom/deep/Stats.json");
        fs.mkdirSync(path.dirname(newFile), { recursive: true });
        fs.renameSync(oldFile, newFile);
        fs.writeFileSync(config, fs.readFileSync(config, "utf8").replace("./data/zeta/BaseStats.json", "./data/custom/deep/Stats.json"));
        fs.mkdirSync(path.join(fixture.paths.cloud, "src/data/missing"));
        fs.writeFileSync(path.join(fixture.paths.cloud, "src/data/missing/BaseStats.json"), "{}");
        const snapshot = await require("../../services/repositories").loadWorkspace(fixture.paths);
        const exported = await archiveService.exportArchive(require("../../services/repositories").getWorkspace(snapshot.workspaceId), "zeta");
        expect(new AdmZip(exported).getEntry("cloud/src/data/missing/BaseStats.json")).not.to.equal(null);
        const imported = await upload(exported);
        expect(imported.status, JSON.stringify(imported.body)).to.equal(200);
        expect(imported.body.gameId).to.equal("zeta");
        expect(fs.readFileSync(path.join(imported.body.repositories.cloud.path, "src/data/custom/deep/Stats.json"), "utf8")).to.equal(fs.readFileSync(newFile, "utf8"));
    });

    for (const unsafe of ["../escape", "/absolute", "C:/drive", "cloud\\evil", "cloud/src/data/../secret.json", "cloud/.env", "cloud/src/data/secret.json", "cloud/public/images/CON.png", "cloud/public/images/evil.png."])
    {
        it(`rejects unsafe or non-allowlisted entry ${unsafe}`, async () =>
        {
            const zip = new AdmZip(bytes);
            // Assign the raw name after addFile because the library sanitizes writer input.
            zip.addFile("malicious", Buffer.from("SECRET")).entryName = unsafe;
            const res = await upload(zip.toBuffer());
            expect(res.status).to.equal(422);
            expect(res.body.error.code).to.equal("ARCHIVE_INVALID");
            expect(imports()).to.deep.equal([]);
        });
    }

    it("rejects duplicate files and case-colliding implicit ancestors", async () =>
    {
        for (const name of [`cloud/${OPTIONAL_IMAGE}`, `Cloud/${OPTIONAL_IMAGE}`])
        {
            const zip = new AdmZip(bytes);
            zip.addFile("malicious", OPTIONAL_BYTES).entryName = name;
            const res = await upload(zip.toBuffer());
            expect(res.status).to.equal(422);
            expect(res.body.error.code).to.equal("ARCHIVE_INVALID");
            expect(imports()).to.deep.equal([]);
        }
    });

    it("rejects symlinks, nonregular types, encryption and unsupported methods", async () =>
    {
        for (const change of [
            (entry) => { entry.header.attr = (0o120777 << 16) >>> 0; },
            (entry) => { entry.header.attr = (0o020600 << 16) >>> 0; },
            (entry) => { entry.header.flags |= 1; },
            (entry) => { entry.header.method = 99; },
        ])
        {
            const zip = new AdmZip(bytes);
            change(zip.getEntry(`cloud/${OPTIONAL_IMAGE}`));
            const res = await upload(zip.toBuffer());
            expect(res.status).to.equal(422);
            expect(imports()).to.deep.equal([]);
        }
    });

    it("rejects malformed manifests, unavailable selections and missing required sources", async () =>
    {
        for (const change of [
            (zip) => zip.deleteFile("manifest.json"),
            (zip) => zip.updateFile("manifest.json", Buffer.from("{")),
            (zip) => zip.updateFile("manifest.json", Buffer.from(JSON.stringify({ format: "cfru-spread-editor", version: 2 }))),
            (zip) => zip.updateFile("manifest.json", Buffer.from(JSON.stringify({ format: "cfru-spread-editor", version: 1, paths: fixture.paths }))),
            (zip) => zip.updateFile("manifest.json", Buffer.from(JSON.stringify({ format: "cfru-spread-editor", version: 1, gameId: "missing" }))),
            (zip) => zip.deleteFile("dpe/src/Learnsets.c"),
        ])
        {
            const zip = new AdmZip(bytes);
            change(zip);
            expect((await upload(zip.toBuffer())).status).to.equal(422);
            expect(imports()).to.deep.equal([]);
        }
    });

    it("cleans failed catalog and spread loads while preserving earlier cached imports", async () =>
    {
        const previous = await upload(bytes);
        expect(previous.status, JSON.stringify(previous.body)).to.equal(200);
        const retained = imports();
        for (const [name, contents] of [
            ["cloud/src/data/alpha/BaseStats.json", "[1,2]"],
            ["cloud/src/data/MoveNames.json", "bad json"],
            [`cfru/${SPREAD_FILE}`, "const struct BattleTowerSpread gBroken[] = { ."],
        ])
        {
            const zip = new AdmZip(bytes);
            zip.updateFile(name, Buffer.from(contents));
            expect((await upload(zip.toBuffer())).status).to.equal(422);
            expect(imports()).to.deep.equal(retained);
        }
        expect(fs.existsSync(path.join(previous.body.repositories.cfru.path, SPREAD_FILE))).to.equal(true);
    });

    it("rejects corrupt payloads, checksums, lengths and truncated containers", async () =>
    {
        const central = centralOffsets(bytes).find((offset) => bytes.toString("utf8", offset + 46, offset + 46 + bytes.readUInt16LE(offset + 28)) === `cloud/${OPTIONAL_IMAGE}`);
        const local = bytes.readUInt32LE(central + 42);
        const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
        for (const corrupted of [Buffer.from(bytes), bytes.subarray(0, -1)])
        {
            if (corrupted.length === bytes.length)
            {
                if (corrupted[start] === bytes[start])
                    corrupted[start] ^= 0xff;
            }
            expect((await upload(corrupted)).status).to.equal(422);
        }
        const badCrc = Buffer.from(bytes);
        badCrc.writeUInt32LE(1, central + 16);
        badCrc.writeUInt32LE(1, local + 14);
        expect((await upload(badCrc)).status).to.equal(422);
        const badSize = Buffer.from(bytes);
        badSize.writeUInt32LE(1, central + 24);
        badSize.writeUInt32LE(1, local + 22);
        expect((await upload(badSize)).status).to.equal(422);
        expect(imports()).to.deep.equal([]);
    });

    it("checks entry, file, expanded and compressed limits before inflation", async () =>
    {
        const limits = archiveService.ARCHIVE_LIMITS;
        const tooMany = Buffer.from(bytes);
        tooMany.writeUInt16LE(limits.entries + 1, tooMany.length - 22 + 8);
        tooMany.writeUInt16LE(limits.entries + 1, tooMany.length - 22 + 10);
        expect((await upload(tooMany)).status).to.equal(422);
        const oversizedFile = Buffer.from(bytes);
        oversizedFile.writeUInt32LE(limits.fileBytes + 1, centralOffsets(bytes)[0] + 24);
        expect((await upload(oversizedFile)).status).to.equal(422);
        const expanded = Buffer.from(bytes);
        for (const offset of centralOffsets(expanded).filter((candidate) => expanded.readUInt32LE(candidate + 24) > 0).slice(0, 17))
        {
            expanded.writeUInt32LE(limits.fileBytes, offset + 24);
            expanded.writeUInt32LE(limits.fileBytes, expanded.readUInt32LE(offset + 42) + 22);
        }
        expect((await upload(expanded)).status).to.equal(422);
        try
        {
            await archiveService.importArchive(Buffer.alloc(limits.compressedBytes + 1));
            throw new Error("Oversized archive was accepted");
        }
        catch (error)
        {
            expect(error.code).to.equal("ARCHIVE_INVALID");
        }
        expect(imports()).to.deep.equal([]);
    });

    it("requires session, trusted host/origin and raw ZIP only on the exact import POST", async () =>
    {
        expect((await request(app).post(IMPORT_ROUTE).set("Content-Type", "application/zip").send(bytes)).status).to.equal(401);
        expect((await upload(bytes).set("Origin", "https://evil.example")).status).to.equal(403);
        expect((await upload(bytes).set("Host", "evil.example:3001")).status).to.equal(403);
        expect((await post(IMPORT_ROUTE, {})).status).to.equal(415);
        expect((await upload(bytes).set("Content-Encoding", "gzip")).status).to.equal(415);
        for (const route of ["/api/workspaces/load", `${IMPORT_ROUTE}/extra`, `${IMPORT_ROUTE}/`, "/api/workspaces/IMPORT"])
            expect((await request(app).post(route).set(SESSION_HEADER, token).set("Content-Type", "application/zip").send(bytes)).status).to.equal(415);
        expect((await request(app).put(IMPORT_ROUTE).set(SESSION_HEADER, token).set("Content-Type", "application/zip").send(bytes)).status).to.equal(415);
        expect((await upload(Buffer.alloc(0))).status).to.equal(422);
        expect(imports()).to.deep.equal([]);
    });

    it("retains JSON object/size guards and rejects oversized ZIP before parsing", async () =>
    {
        expect((await post(`/api/workspaces/${source.workspaceId}/archive`, [])).status).to.equal(400);
        expect((await post(`/api/workspaces/${source.workspaceId}/archive`, { padding: "x".repeat(4 * 1024 * 1024) })).status).to.equal(413);
        expect((await upload(bytes).set("Content-Length", String(archiveService.MAX_COMPRESSED_BYTES + 1))).status).to.equal(413);
        expect((await post(`/api/workspaces/${source.workspaceId}/archive`, { gameId: "missing" })).status).to.equal(404);
        expect((await request(app).post(`/api/workspaces/${source.workspaceId}/archive`).send({})).status).to.equal(401);
        expect(imports()).to.deep.equal([]);
    });
});
