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
