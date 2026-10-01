/**
 * Real HTTP progress polling and upload receipt against disposable repositories.
 */
const crypto = require("crypto");
const express = require("express");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { expect } = require("chai");
const request = require("supertest");
const { createFixtureRepositories } = require("../helpers/fixture-repositories");

const SERVER_ROOT = path.resolve(__dirname, "../..");
const ORIGIN = "http://localhost:3000";
const SESSION_HEADER = "X-Session-Token";
const ORIGINAL_DATA_DIRECTORY = process.env.SPREAD_EDITOR_DATA_DIR;
const IMPORT_ROUTE = "/api/workspaces/import";

/**
 * Reloads runtime modules after setting fixture-local storage.
 * @returns {object} The fresh Express application.
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
 * Collects exact ZIP response bytes.
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

describe("Authenticated operation progress", function ()
{
    this.timeout(30000);
    let fixture;
    let app;
    let token;
    let snapshot;
    let bytes;

    /**
     * Sends a protected JSON request.
     * @param {string} route The API path.
     * @param {object} [body] The JSON object.
     * @returns {object} The Supertest request.
     */
    function post(route, body = {})
    {
        return request(app).post(route).set("Origin", ORIGIN).set(SESSION_HEADER, token).send(body);
    }

    /**
     * Polls a registered or not-yet-registered operation.
     * @param {string} id The operation UUID.
     * @returns {object} The Supertest request.
     */
    function poll(id)
    {
        return post(`/api/progress/${id}`);
    }

    /**
     * Sends a tracked raw ZIP import.
     * @param {string} id The operation UUID.
     * @param {Buffer} [body] The uploaded ZIP.
     * @returns {object} The Supertest request.
     */
    function upload(id, body = bytes)
    {
        return request(app).post(IMPORT_ROUTE).query({ progressId: id }).set("Origin", ORIGIN)
            .set(SESSION_HEADER, token).set("Content-Type", "application/zip").send(body);
    }

    /**
     * Polls while actual server work proceeds, without waits or synthetic timers.
     * @param {object} operation The main HTTP request.
     * @param {string} id The operation UUID.
     * @returns {Promise<object>} The main response and all observed snapshots.
     */
    async function observe(operation, id)
    {
        const snapshots = [];
        let settled = false;
        const pending = operation.then((response) =>
        {
            settled = true;
            return response;
        }, (error) =>
        {
            settled = true;
            throw error;
        });
        while (!settled)
        {
            const response = await poll(id);
            if (response.status === 200)
                snapshots.push(response.body);
            else
                expect(response.body.error.code).to.equal("PROGRESS_NOT_FOUND");
        }
        const response = await pending;
        const final = await poll(id);
        expect(final.status).to.equal(200);
        snapshots.push(final.body);
        let previous = 0;
        for (const progress of snapshots)
        {
            expect(progress).to.have.all.keys("percentage", "label", "status");
            expect(Number.isInteger(progress.percentage)).to.equal(true);
            expect(progress.percentage).to.be.within(previous, 100);
            if (progress.status !== "complete")
                expect(progress.percentage).to.be.lessThan(100);
            expect(JSON.stringify(progress)).not.to.include(fixture.base);
            previous = progress.percentage;
        }
        return { response, snapshots };
    }

    beforeEach(async () =>
    {
        fixture = createFixtureRepositories();
        process.env.SPREAD_EDITOR_DATA_DIR = path.join(fixture.base, "editor data");
        fs.writeFileSync(path.join(fixture.paths.cloud, "src/data/alpha/BaseStats.json"), "{}");
        app = startServer();
        token = (await request(app).post("/api/session").set("Origin", ORIGIN)).body.token;
        snapshot = (await post("/api/workspaces/load", { paths: fixture.paths })).body;
        expect(snapshot).to.have.property("workspaceId");
        bytes = await require("../../services/archives").exportArchive(require("../../services/repositories").getWorkspace(snapshot.workspaceId));
    });

    afterEach(() =>
    {
        fixture?.cleanup();
        if (ORIGINAL_DATA_DIRECTORY === undefined)
            delete process.env.SPREAD_EDITOR_DATA_DIR;
        else
            process.env.SPREAD_EDITOR_DATA_DIR = ORIGINAL_DATA_DIRECTORY;
    });

    it("keeps polling behind Host, Origin, session and JSON guards", async () =>
    {
        const id = crypto.randomUUID();
        expect((await request(app).post(`/api/progress/${id}`).send({})).status).to.equal(401);
        expect((await poll(id).set("Host", "evil.example")).status).to.equal(403);
        expect((await poll(id).set("Origin", "https://evil.example")).status).to.equal(403);
        expect((await poll(id).set(SESSION_HEADER, "invalid")).status).to.equal(401);
        expect((await post(`/api/progress/${id}`, [])).status).to.equal(400);
        expect((await request(app).post(`/api/progress/${id}`).set(SESSION_HEADER, token).set("Content-Type", "text/plain").send("x")).status).to.equal(415);
        expect((await request(app).post(`/api/progress/${id}`).set(SESSION_HEADER, token).set("Content-Type", "application/json").send("{")).status).to.equal(400);
        expect((await post(`/api/progress/${id}`, { padding: "x".repeat(4 * 1024 * 1024) })).status).to.equal(413);
        const missing = await poll(id);
        expect(missing.status).to.equal(404);
        expect(missing.body.error.code).to.equal("PROGRESS_NOT_FOUND");
    });

    it("rejects invalid optional IDs without altering legacy requests", async () =>
    {
        for (const id of ["invalid", "", crypto.randomUUID() + "x"])
        {
            expect((await poll(id || "invalid")).status).to.equal(400);
            const loaded = await post("/api/workspaces/load?progressId=" + id, { paths: fixture.paths });
            expect(loaded.status).to.equal(400);
            expect(loaded.body.error.code).to.equal("INVALID_PROGRESS_ID");
            expect((await post(`/api/workspaces/${snapshot.workspaceId}/archive?progressId=${id}`)).status).to.equal(400);
            expect((await upload(id)).status).to.equal(400);
        }
        expect((await post("/api/workspaces/load?progressId=a&progressId=b", { paths: fixture.paths })).status).to.equal(400);
        const legacy = await post("/api/workspaces/load", { paths: fixture.paths });
        expect(legacy.status).to.equal(200);
        expect(legacy.body).to.have.all.keys("workspaceId", "repositories", "games", "spreads", "diagnostics");
    });

    it("exposes real intermediate repo checks and preserves the load response", async () =>
    {
        const id = crypto.randomUUID();
        const observed = await observe(post("/api/workspaces/load").query({ progressId: id }).send({ paths: fixture.paths }), id);
        expect(observed.response.status).to.equal(200);
        expect(observed.response.body).to.have.all.keys("workspaceId", "repositories", "games", "spreads", "diagnostics");
        expect(observed.snapshots.some((progress) => progress.status === "running" && progress.percentage > 0)).to.equal(true);
        expect(observed.snapshots.at(-1)).to.deep.equal({ percentage: 100, label: "Complete", status: "complete" });
    });

    it("allows polling during real asynchronous ZIP compression and roundtrip import", async () =>
    {
        const exportId = crypto.randomUUID();
        const exported = await observe(post(`/api/workspaces/${snapshot.workspaceId}/archive`).query({ progressId: exportId }).buffer(true).parse(parseBinary), exportId);
        expect(exported.response.status).to.equal(200);
        expect(exported.response.headers["content-type"]).to.equal("application/zip");
        expect(exported.snapshots.some((progress) => progress.label === "Compressing ZIP" && progress.percentage >= 45 && progress.percentage < 100)).to.equal(true);
        const importId = crypto.randomUUID();
        const imported = await observe(upload(importId, exported.response.body), importId);
        expect(imported.response.status).to.equal(200);
        expect(imported.response.body.spreads.entries).to.deep.equal(snapshot.spreads.entries);
        expect(imported.snapshots.some((progress) => progress.percentage > 20 && progress.percentage <= 40)).to.equal(true);
        expect(imported.snapshots.some((progress) => progress.percentage > 40 && progress.percentage < 100)).to.equal(true);
        expect(imported.snapshots.at(-1).status).to.equal("complete");
    });

    it("marks validation, missing workspace, content guard and oversized upload failures below 100", async () =>
    {
        const operations =
        [
            (id) => post("/api/workspaces/load").query({ progressId: id }).send({ paths: {} }),
            (id) => post(`/api/workspaces/${crypto.randomUUID()}/archive`).query({ progressId: id }),
            (id) => upload(id, Buffer.from("not a ZIP")),
            (id) => upload(id).set("Content-Encoding", "gzip"),
            (id) => upload(id).set("Content-Length", String(require("../../services/archives").MAX_COMPRESSED_BYTES + 1)),
        ];
        for (const operation of operations)
        {
            const id = crypto.randomUUID();
            expect((await operation(id)).status).to.be.within(400, 499);
            const progress = (await poll(id)).body;
            expect(progress.status).to.equal("failed");
            expect(progress.percentage).to.be.lessThan(100);
            expect(progress.label).to.equal("Operation Failed");
        }
    });

    it("marks raw parser 413 failures without overwriting completed retry IDs", async () =>
    {
        const originalRaw = express.raw;
        try
        {
            express.raw = (options) => originalRaw({ ...options, limit: 4 });
            app = startServer();
        }
        finally
        {
            express.raw = originalRaw;
        }
        token = (await request(app).post("/api/session").set("Origin", ORIGIN)).body.token;
        const id = crypto.randomUUID();
        expect((await upload(id)).status).to.equal(413);
        const failed = (await poll(id)).body;
        expect(failed.status).to.equal("failed");
        expect(failed.percentage).to.be.lessThan(100);
        expect((await upload(id)).status).to.equal(409);
        expect((await poll(id)).body).to.deep.equal(failed);
        const loadId = crypto.randomUUID();
        expect((await post("/api/workspaces/load").query({ progressId: loadId }).send({ paths: fixture.paths })).status).to.equal(200);
        const completed = (await poll(loadId)).body;
        expect((await post("/api/workspaces/load").query({ progressId: loadId }).send({ paths: {} })).status).to.equal(409);
        expect((await poll(loadId)).body).to.deep.equal(completed);
    });

    for (const knownLength of [true, false])
    {
        it(`tracks real streamed bytes ${knownLength ? "with" : "without"} Content-Length and cleans receipt listeners`, async () =>
        {
            const server = app.listen(0, "127.0.0.1");
            await new Promise((resolve) => server.once("listening", resolve));
            let incoming;
            let received = 0;
            server.on("request", (req) =>
            {
                incoming = req;
                req.on("data", (chunk) => { received += chunk.length; });
            });
            const id = crypto.randomUUID();
            const headers = { Origin: ORIGIN, [SESSION_HEADER]: token, "Content-Type": "application/zip" };
            if (knownLength)
                headers["Content-Length"] = bytes.length;
            const client = http.request({ host: "127.0.0.1", port: server.address().port, method: "POST", path: `${IMPORT_ROUTE}?progressId=${id}`, headers });
            const response = new Promise((resolve, reject) =>
            {
                client.once("error", reject);
                client.once("response", (res) =>
                {
                    res.resume();
                    res.once("end", () => resolve(res.statusCode));
                });
            });
            try
            {
                const sent = Math.floor(bytes.length / 2);
                client.write(bytes.subarray(0, sent));
                let progress;
                do
                {
                    progress = await poll(id);
                } while (progress.status === 404 || received < sent);
                expect(progress.status).to.equal(200);
                expect(progress.body.status).to.equal("running");
                expect(progress.body.label).to.equal(knownLength ? "Receiving ZIP" : "Receiving ZIP (Size Unknown)");
                expect(progress.body.percentage).to.equal(Math.min(19, Math.floor(20 * sent / (knownLength ? bytes.length : require("../../services/archives").MAX_COMPRESSED_BYTES))));
                client.end(bytes.subarray(sent));
                expect(await response).to.equal(200);
                expect((await poll(id)).body.percentage).to.equal(100);
                expect(incoming.stopProgressUpload).to.equal(undefined);
                for (const event of ["data", "end", "aborted", "error"])
                    expect(incoming.listeners(event).some((listener) => ["data", "end", "failed"].includes(listener.name))).to.equal(false);
            }
            finally
            {
                client.destroy();
                await new Promise((resolve) => server.close(resolve));
            }
        });
    }

    it("fails an aborted partial upload and removes receipt listeners", async () =>
    {
        const server = app.listen(0, "127.0.0.1");
        await new Promise((resolve) => server.once("listening", resolve));
        let incoming;
        let received = 0;
        const aborted = new Promise((resolve) =>
        {
            server.on("request", (req) =>
            {
                incoming = req;
                req.on("data", (chunk) => { received += chunk.length; });
                req.once("aborted", resolve);
            });
        });
        const id = crypto.randomUUID();
        const client = http.request(
        {
            host: "127.0.0.1", port: server.address().port, method: "POST", path: `${IMPORT_ROUTE}?progressId=${id}`,
            headers: { Origin: ORIGIN, [SESSION_HEADER]: token, "Content-Type": "application/zip", "Content-Length": bytes.length },
        });
        client.on("error", () => {});
        try
        {
            const sent = Math.floor(bytes.length / 2);
            client.write(bytes.subarray(0, sent));
            let progress;
            do
            {
                progress = await poll(id);
            } while (progress.status === 404 || received < sent);
            expect(progress.body.status).to.equal("running");
            client.destroy();
            await aborted;
            expect((await poll(id)).body.status).to.equal("failed");
            expect((await poll(id)).body.percentage).to.be.lessThan(20);
            expect(incoming.stopProgressUpload).to.equal(undefined);
            for (const event of ["data", "end", "aborted", "error"])
                expect(incoming.listeners(event).some((listener) => ["data", "end", "failed"].includes(listener.name))).to.equal(false);
            expect(fs.existsSync(path.join(process.env.SPREAD_EDITOR_DATA_DIR, "imports"))).to.equal(false);
        }
        finally
        {
            client.destroy();
            await new Promise((resolve) => server.close(resolve));
        }
    });
});
