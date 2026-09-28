/**
 * Test file for repositories.js
 * Tests the native folder picker without opening a real dialog, and listing repository folders.
 */

const { expect } = require("chai");
const fs = require("fs");
const path = require("path");
const { StatusCode } = require("status-code-enum");

const { createFixtureRepositories } = require("../helpers/fixture-repositories");
const { createFolderPicker, getWorkspace, listOwnedFiles, loadWorkspace } = require("../../services/repositories");

const PICKED_PATH = "C:\\Users\\Test\\Código\\CFRU Repo";


/**
 * Creates a fake execFile that records calls and completes with the given result.
 *
 * @param {Error|null} error The error to report.
 * @param {string} [stdout] The process output.
 * @returns {{runProcess: Function, calls: Array<object>}} The fake and its recorded calls.
 */
function createFakeProcess(error, stdout = "")
{
    const calls = [];
    const runProcess = (file, args, options, callback) =>
    {
        calls.push({ file, args, options });
        setImmediate(() => callback(error, stdout));
    };

    return { runProcess, calls };
}

describe("Folder picker", () =>
{
    it("should return a selected folder, including non-ASCII paths", async () =>
    {
        const { runProcess } = createFakeProcess(null, `\uFEFF${JSON.stringify({ status: "selected", path: PICKED_PATH })}\r\n`);
        const pick = createFolderPicker({ platform: "win32", runProcess });

        expect(await pick({ kind: "cfru" })).to.deep.equal({ status: "selected", path: PICKED_PATH });
    });

    it("should return cancellation as a distinct result", async () =>
    {
        const { runProcess } = createFakeProcess(null, "{\"status\":\"cancelled\"}");
        const pick = createFolderPicker({ platform: "win32", runProcess });

        expect(await pick({ kind: "dpe" })).to.deep.equal({ status: "cancelled" });
    });

    it("should run a fixed script and pass the start folder only through the environment", async () =>
    {
        const startPath = "C:\\Code'; Remove-Item C:\\ -Recurse; '";
        const { runProcess, calls } = createFakeProcess(null, "{\"status\":\"cancelled\"}");
        const pick = createFolderPicker({ platform: "win32", runProcess, timeoutMs: 1234 });

        await pick({ kind: "cloud", startPath });
        await pick({ kind: "cloud", startPath: "\\\\server\\share" });

        expect(calls[0].file).to.equal("powershell.exe");
        expect(calls[0].args).to.include("-STA").and.include("-EncodedCommand");
        expect(calls[0].args.join(" ")).to.not.include("Remove-Item");
        const script = Buffer.from(calls[0].args.at(-1), "base64").toString("utf16le");
        expect(script).to.include("FOS_PICKFOLDERS").and.not.include("FolderBrowserDialog");
        expect(calls[0].args).to.deep.equal(calls[1].args);
        expect(calls[0].options.env.CFRU_EDITOR_PICKER_START).to.equal(startPath);
        expect(calls[0].options.env.CFRU_EDITOR_PICKER_TITLE).to.include("Unbound Cloud");
        expect(calls[0].options.timeout).to.equal(1234);
        expect(calls[1].options.env.CFRU_EDITOR_PICKER_START).to.equal("");
    });

    it("should allow only one dialog at a time", async () =>
    {
        const { runProcess } = createFakeProcess(null, "{\"status\":\"cancelled\"}");
        const pick = createFolderPicker({ platform: "win32", runProcess });

        const first = pick({ kind: "cfru" });
        let busyError;
        try
        {
            await pick({ kind: "dpe" });
        }
        catch (error)
        {
            busyError = error;
        }

        expect(busyError.code).to.equal("PICKER_BUSY");
        expect(await first).to.deep.equal({ status: "cancelled" });
        expect(await pick({ kind: "dpe" })).to.deep.equal({ status: "cancelled" });
    });

    it("should close the dialog when its signal is aborted, freeing the picker", async () =>
    {
        const calls = [];
        const runProcess = (file, args, options, callback) =>
        {
            calls.push(options);
            options.signal?.addEventListener("abort", () => callback(Object.assign(new Error("Aborted"), { name: "AbortError" }), ""));
            if (options.signal == null)
                setImmediate(() => callback(null, "{\"status\":\"cancelled\"}"));
        };
        const pick = createFolderPicker({ platform: "win32", runProcess });
        const abortController = new AbortController();

        const first = pick({ kind: "cfru", signal: abortController.signal });
        abortController.abort();

        expect(await first).to.deep.equal({ status: "cancelled" });
        expect(calls[0].signal).to.equal(abortController.signal);
        expect(await pick({ kind: "cfru" })).to.deep.equal({ status: "cancelled" });
    });

    const failureCases =
    [
        { name: "a timeout", error: Object.assign(new Error("killed"), { killed: true }), code: "PICKER_TIMEOUT", status: StatusCode.ServerErrorGatewayTimeout },
        { name: "denied permissions", error: Object.assign(new Error("denied"), { code: "EACCES" }), code: "PICKER_PERMISSION_DENIED", status: StatusCode.ClientErrorForbidden },
        { name: "a missing PowerShell", error: Object.assign(new Error("missing"), { code: "ENOENT" }), code: "PICKER_UNAVAILABLE", status: StatusCode.ServerErrorInternal },
        { name: "unexpected output", error: null, stdout: "not json", code: "PICKER_FAILED", status: StatusCode.ServerErrorInternal },
    ];

    for (const { name, error, stdout, code, status } of failureCases)
    {
        it(`should report ${name} with an actionable error`, async () =>
        {
            const { runProcess } = createFakeProcess(error, stdout);
            const pick = createFolderPicker({ platform: "win32", runProcess });

            let thrown;
            try
            {
                await pick({ kind: "cfru" });
            }
            catch (caught)
            {
                thrown = caught;
            }

            expect(thrown.code).to.equal(code);
            expect(thrown.status).to.equal(status);
            expect(thrown.message).to.match(/Type the folder path instead|open too long/);
        });
    }

    it("should report unsupported platforms without running a process", async () =>
    {
        const { runProcess, calls } = createFakeProcess(null);
        const pick = createFolderPicker({ platform: "linux", runProcess });

        let thrown;
        try
        {
            await pick({ kind: "cfru" });
        }
        catch (error)
        {
            thrown = error;
        }

        expect(thrown.code).to.equal("PICKER_UNSUPPORTED");
        expect(calls).to.have.length(0);
    });
});

describe("Owned folder listing", () =>
{
    let fixture;
    let workspace;

    beforeEach(async () =>
    {
        fixture = createFixtureRepositories();
        workspace = getWorkspace((await loadWorkspace(fixture.paths)).workspaceId);
    });

    afterEach(() =>
    {
        fixture.cleanup();
    });

    it("should list only the files in a folder, in sorted order", async () =>
    {
        fs.mkdirSync(path.join(fixture.paths.dpe, "src", "tm_compatibility", "nested"));

        const names = await listOwnedFiles(workspace, "dpe", "src/tm_compatibility");
        expect(names).to.deep.equal(["1 - Focus Punch.txt", "2 - Hidden Power.txt", "3 - Cut.txt", "notes.md"]);
    });

    it("should return nothing for a missing folder", async () =>
    {
        expect(await listOwnedFiles(workspace, "cloud", "public/images/gen_9")).to.deep.equal([]);
    });

    it("should reject a folder that links outside the repository", async () =>
    {
        const outside = path.join(fixture.base, "outside images");
        fs.mkdirSync(outside);
        fs.writeFileSync(path.join(outside, "secret.png"), "png");
        fs.symlinkSync(outside, path.join(fixture.paths.cloud, "public", "images", "gen_9"), "junction");

        let thrown;
        try
        {
            await listOwnedFiles(workspace, "cloud", "public/images/gen_9");
        }
        catch (error)
        {
            thrown = error;
        }

        expect(thrown.code).to.equal("PATH_OUTSIDE_REPOSITORY");
        expect(thrown.status).to.equal(StatusCode.ClientErrorForbidden);
    });
});
