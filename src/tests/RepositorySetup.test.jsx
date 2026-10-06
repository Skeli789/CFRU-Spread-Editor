import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios from "axios";
import { StatusCode } from "status-code-enum";
import { vi } from "vitest";

import App from "../App";
import { DiagnosticList } from "../components/RepositorySetup";
import { formatExportDate } from "../components/SpreadFileImportDialog";
import { SETTINGS_STORAGE_KEY, SETTINGS_VERSION, SpreadEditorProvider, useSpreadEditor } from "../SpreadEditorState";
import OperationProgress from "../subcomponents/OperationProgress";
import { APP_THEME } from "../Theme";
import { ARCHIVE_ROUTE, CATALOG_ROUTE, PATHS, SAVE_ROUTE, apiError, createCatalog, createSpreads, createWorkspace, mockServer } from "./EditorFixtures";

vi.mock("axios", () => ({ default: { post: vi.fn() } }));

const LABELS = { cfru: /^Complete Fire Red Upgrade/, dpe: /^Dynamic Pokemon Expansion/, cloud: /^Unbound Cloud/ };
const SETUP_TITLE = "Connect Repositories";
const GAME_TITLE = "Choose Game";
const SPREAD_COUNT = 6;
const FIRST_SET_COUNT = 3;
const CATALOG_WARNING = "69 moves in this game are not in CFRU's src/Tables/battle_moves.c.";
const DOWNLOAD_LABEL = "Download Required Files";
const CACHED_PATHS = { cfru: "C:\\Cache\\Imported\\CFRU", dpe: "C:\\Cache\\Imported\\DPE", cloud: "C:\\Cache\\Imported\\Cloud" };

/**
 * Builds a server import response with cached repository roots.
 *
 * @param {string} [gameId] The optional manifest game.
 * @returns {object} The imported workspace.
 */
function importedWorkspace(gameId)
{
    return { ...createWorkspace("imported-workspace"), gameId,
        repositories: Object.fromEntries(Object.entries(CACHED_PATHS).map(([kind, path]) => [kind, { path, label: kind }])) };
}

/**
 * Stubs browser downloads while retaining the clicked anchor for cleanup assertions.
 *
 * @param {boolean} [failClick] Whether clicking the anchor fails.
 * @returns {object} The captured anchor and browser spies.
 */
function mockDownload(failClick = false)
{
    const download = { anchor: null, create: vi.fn(() => "blob:archive"), revoke: vi.fn() };
    vi.stubGlobal("URL", class extends URL
    {
        static createObjectURL = download.create;
        static revokeObjectURL = download.revoke;
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function ()
    {
        download.anchor = this;
        if (failClick)
            throw new Error("The browser blocked the download.");
    });
    return download;
}

/**
 * Opens the archive menu action.
 *
 * @param {object} user The user-event instance.
 */
async function chooseDownload(user)
{
    await user.click(await screen.findByRole("button", { name: "Unbound menu" }));
    await user.click(screen.getByRole("menuitem", { name: DOWNLOAD_LABEL }));
}

/**
 * Creates a valid unsaved draft through the card editor.
 *
 * @param {object} user The user-event instance.
 */
async function changeSpread(user)
{
    const card = screen.getAllByRole("article", { name: "Charizard spread" })[0];
    await user.click(within(card).getByRole("heading", { name: "Charizard" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Charizard" });
    const field = within(dialog).getByLabelText("Charizard Attack IV");
    await user.clear(field);
    await user.type(field, "0");
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
}

/**
 * Saves settings as a previous session would have.
 *
 * @param {object} settings The settings to save.
 */
function saveSettings(settings)
{
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ version: SETTINGS_VERSION, ...settings }));
}

/**
 * Returns the saved settings.
 *
 * @returns {object} The parsed settings.
 */
function getSavedSettings()
{
    return JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY));
}

/**
 * Exposes operation controls and progress without waiting on dialog transitions.
 *
 * @returns {JSX.Element} The provider test controls.
 */
function ProgressHarness()
{
    const editor = useSpreadEditor();
    return <>
        <button onClick={editor.loadRepositories}>Check Roots</button>
        <button onClick={() => editor.importArchive(new File(["1234567890"], "required.zip"))}>Import Archive</button>
        <button onClick={editor.downloadArchive}>Export Archive</button>
        <div data-testid="phase">{editor.state.phase}</div>
        <div data-testid="error">{editor.state.error?.message ?? editor.state.archiveError?.message}</div>
        <OperationProgress progress={editor.state.archiveProgress ?? editor.state.setupProgress} />
    </>;
}

/**
 * Creates a controlled request for progress and cleanup assertions.
 *
 * @returns {object} The promise and its completion callbacks.
 */
function deferredRequest()
{
    let resolve;
    let reject;
    const promise = new Promise((finish, fail) => { resolve = finish; reject = fail; });
    return { promise, resolve, reject };
}

/**
 * Advances the polling clock and flushes request updates.
 *
 * @param {number} [milliseconds] The time to advance.
 * @returns {Promise<void>} Resolves after React commits updates.
 */
async function advanceProgress(milliseconds = 250)
{
    await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); });
}

describe("Tracked repository and archive progress", () =>
{
    beforeEach(() =>
    {
        localStorage.clear();
        vi.spyOn(axios, "post").mockReset();
        vi.useFakeTimers();
    });

    afterEach(() =>
    {
        cleanup();
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    test("checks roots with sequential polling, missing-record tolerance, monotonic percentages and final success", async () =>
    {
        saveSettings({ paths: PATHS, gameId: "" });
        const main = deferredRequest();
        const poll = deferredRequest();
        let polls = 0;
        const calls = mockServer({
            "/workspaces/load": () => main.promise,
            "/progress/:id": () =>
            {
                polls++;
                if (polls === 1)
                    throw apiError(404, "PROGRESS_NOT_FOUND", "Not started");
                if (polls === 2)
                    return poll.promise;
                return { percentage: 20, label: "Earlier roots", status: "running" };
            },
        });
        render(<SpreadEditorProvider><ProgressHarness /></SpreadEditorProvider>);
        await advanceProgress(0);
        expect(screen.getByRole("progressbar", { name: "Checking repositories..." })).toHaveAttribute("aria-valuenow", "0");
        await advanceProgress();
        await advanceProgress();
        await advanceProgress(1000);
        expect(polls).toBe(2);
        await act(async () => { poll.resolve({ percentage: 65, label: "Checking game files...", status: "running" }); });
        expect(screen.getByRole("progressbar", { name: "Checking game files..." })).toHaveAttribute("aria-valuenow", "65");
        expect(screen.getByText("Checking game files... 65%")).toBeInTheDocument();
        await advanceProgress();
        expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "65");
        expect(screen.queryByText(/Earlier roots/)).not.toBeInTheDocument();
        const load = calls.find((call) => call.route === "/workspaces/load");
        expect(calls.filter((call) => call.route.startsWith("/progress/")).every((call) =>
            call.route === `/progress/${load.params.progressId}` && call.token === "token-1" && JSON.stringify(call.body) === "{}")).toBe(true);
        expect(calls.filter((call) => call.route === "/session")).toHaveLength(1);
        await act(async () => { main.resolve(createWorkspace()); });
        expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
        const completedCalls = calls.length;
        await advanceProgress(1000);
        expect(calls).toHaveLength(completedCalls);
    });

    test("maps ZIP bytes to twenty percent, uses server stages, never completes failures and resets retry", async () =>
    {
        const first = deferredRequest();
        const retry = deferredRequest();
        const latePoll = deferredRequest();
        let imports = 0;
        let polls = 0;
        const calls = mockServer({
            "/workspaces/import": () => (++imports === 1 ? first.promise : retry.promise),
            "/progress/:id": () => ++polls === 1
                ? { percentage: 55, label: "Extracting ZIP...", status: "running" } : latePoll.promise,
        });
        render(<SpreadEditorProvider><ProgressHarness /></SpreadEditorProvider>);
        await advanceProgress(0);
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Import Archive" })); });
        const upload = calls.find((call) => call.route === "/workspaces/import");
        expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
        act(() => upload.options.onUploadProgress({ loaded: 5 }));
        expect(screen.getByRole("progressbar", { name: "Uploading ZIP..." })).toHaveAttribute("aria-valuenow", "10");
        act(() => upload.options.onUploadProgress({ loaded: 10, total: 10 }));
        expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "20");
        await advanceProgress();
        expect(screen.getByRole("progressbar", { name: "Extracting ZIP..." })).toHaveAttribute("aria-valuenow", "55");
        act(() => upload.options.onUploadProgress({ loaded: 10, total: 10 }));
        expect(screen.getByRole("progressbar", { name: "Extracting ZIP..." })).toHaveAttribute("aria-valuenow", "55");
        await advanceProgress();
        const pollOptions = calls.filter((call) => call.route.startsWith("/progress/")).at(-1).options;
        await act(async () => { first.reject(apiError(422, "ARCHIVE_INVALID", "Invalid ZIP")); });
        expect(screen.getByTestId("error")).toHaveTextContent("Invalid ZIP");
        expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "55");
        expect(pollOptions.signal.aborted).toBe(true);
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Import Archive" })); });
        expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
        const uploads = calls.filter((call) => call.route === "/workspaces/import");
        expect(uploads[1].params.progressId).not.toBe(upload.params.progressId);
        act(() => upload.options.onUploadProgress({ loaded: 10, total: 10 }));
        await act(async () => { latePoll.resolve({ percentage: 99, label: "Old operation", status: "complete" }); });
        expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
        expect(screen.queryByText(/Old operation/)).not.toBeInTheDocument();
        await act(async () => { retry.resolve(importedWorkspace()); });
        expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    });

    test("shows download collection and compression and reserves one hundred for successful download", async () =>
    {
        saveSettings({ paths: PATHS, gameId: "unbound" });
        const main = deferredRequest();
        const download = mockDownload();
        let polls = 0;
        const calls = mockServer({
            [ARCHIVE_ROUTE]: () => main.promise,
            "/progress/:id": () => ++polls === 1
                ? { percentage: 45, label: "Collecting source files...", status: "running" }
                : { percentage: 100, label: "Compressing ZIP...", status: "complete" },
        });
        render(<SpreadEditorProvider><ProgressHarness /></SpreadEditorProvider>);
        await advanceProgress(0);
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Export Archive" })); });
        expect(screen.getByRole("progressbar", { name: "Preparing download..." })).toHaveAttribute("aria-valuenow", "0");
        await advanceProgress();
        expect(screen.getByRole("progressbar", { name: "Collecting source files..." })).toHaveAttribute("aria-valuenow", "45");
        await advanceProgress();
        expect(screen.getByRole("progressbar", { name: "Compressing ZIP..." })).toHaveAttribute("aria-valuenow", "99");
        expect(download.create).not.toHaveBeenCalled();
        await act(async () => { main.resolve(new Blob(["ZIP"])); });
        expect(screen.getByRole("progressbar", { name: "Compressing ZIP..." })).toHaveAttribute("aria-valuenow", "100");
        expect(download.create).toHaveBeenCalledOnce();
        const count = calls.length;
        await advanceProgress(1000);
        expect(calls).toHaveLength(count);
    });

    test("cancels pending polls and ignores late callbacks and phase changes after unmount", async () =>
    {
        const main = deferredRequest();
        const poll = deferredRequest();
        const calls = mockServer({ "/workspaces/import": () => main.promise, "/progress/:id": () => poll.promise });
        const view = render(<SpreadEditorProvider><ProgressHarness /></SpreadEditorProvider>);
        await advanceProgress(0);
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Import Archive" })); });
        await advanceProgress();
        const polling = calls.find((call) => call.route.startsWith("/progress/"));
        const upload = calls.find((call) => call.route === "/workspaces/import");
        view.unmount();
        expect(polling.options.signal.aborted).toBe(true);
        render(<SpreadEditorProvider><ProgressHarness /></SpreadEditorProvider>);
        await advanceProgress(0);
        const count = calls.length;
        await act(async () =>
        {
            upload.options.onUploadProgress({ loaded: 10, total: 10 });
            poll.resolve({ percentage: 99, label: "Old upload", status: "running" });
            main.resolve(importedWorkspace("unbound"));
        });
        await advanceProgress(1000);
        expect(screen.getByTestId("phase")).toHaveTextContent("setup");
        expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
        expect(calls).toHaveLength(count);
    });

    test("shares session renewal between main and poll retries without resetting byte progress", async () =>
    {
        const main = deferredRequest();
        const poll = deferredRequest();
        const session = deferredRequest();
        const retriedMain = deferredRequest();
        let sessions = 0;
        const calls = mockServer({
            "/session": () => ++sessions === 1 ? { token: "token-1" } : session.promise,
            "/workspaces/import": (body, token) => token === "token-1" ? main.promise : retriedMain.promise,
            "/progress/:id": (body, token) => token === "token-1" ? poll.promise
                : { percentage: 30, label: "Validating ZIP...", status: "running" },
        });
        render(<SpreadEditorProvider><ProgressHarness /></SpreadEditorProvider>);
        await advanceProgress(0);
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Import Archive" })); });
        const upload = calls.find((call) => call.route === "/workspaces/import");
        act(() => upload.options.onUploadProgress({ loaded: 5, total: 10 }));
        await advanceProgress();
        await act(async () =>
        {
            main.reject(apiError(401, "SESSION_INVALID", "Restarted"));
            poll.reject(apiError(401, "SESSION_INVALID", "Restarted"));
        });
        expect(sessions).toBe(2);
        expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "10");
        await act(async () => { session.resolve({ token: "token-2" }); });
        expect(screen.getByRole("progressbar", { name: "Validating ZIP..." })).toHaveAttribute("aria-valuenow", "30");
        const imports = calls.filter((call) => call.route === "/workspaces/import");
        expect(imports.map((call) => call.token)).toEqual(["token-1", "token-2"]);
        expect(imports[1].params).toEqual(imports[0].params);
        expect(sessions).toBe(2);
        await act(async () => { retriedMain.resolve(importedWorkspace()); });
        expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    });

    test("keeps failed download below one hundred and resets a retry to zero", async () =>
    {
        saveSettings({ paths: PATHS, gameId: "unbound" });
        const first = deferredRequest();
        const retry = deferredRequest();
        let requests = 0;
        mockDownload();
        mockServer({
            [ARCHIVE_ROUTE]: () => ++requests === 1 ? first.promise : retry.promise,
            "/progress/:id": () => ({ percentage: 100, label: "Compressing ZIP...", status: "failed" }),
        });
        render(<SpreadEditorProvider><ProgressHarness /></SpreadEditorProvider>);
        await advanceProgress(0);
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Export Archive" })); });
        await advanceProgress();
        await act(async () => { first.reject(apiError(500, "ARCHIVE_FAILED", "Compression failed")); });
        expect(screen.getByTestId("error")).toHaveTextContent("Compression failed");
        expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "99");
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Export Archive" })); });
        expect(screen.getByRole("progressbar", { name: "Preparing download..." })).toHaveAttribute("aria-valuenow", "0");
        await act(async () => { retry.resolve(new Blob(["ZIP"])); });
        expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    });
});

/**
 * Types all three repository paths into the setup dialog.
 *
 * @param {object} user The user-event instance.
 * @param {object} dialog The setup dialog element.
 */
async function enterPaths(user, dialog)
{
    for (const [kind, path] of Object.entries(PATHS))
    {
        const field = within(dialog).getByLabelText(LABELS[kind]);
        await user.clear(field);
        await user.type(field, path);
    }
}

describe("Repository setup", () =>
{
    test("lists each diagnostic detail separately and falls back to the message", () =>
    {
        render(<DiagnosticList diagnostics={[
            { message: "Two differences", details: ["MOVE_FLY (pp differs)", "MOVE_FLY (type differs)"] },
            { message: "File missing" },
        ]} />);

        expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
            "MOVE_FLY (pp differs)", "MOVE_FLY (type differs)", "File missing",
        ]);
    });

    beforeEach(() =>
    {
        localStorage.clear();
        vi.spyOn(axios, "post").mockReset();
    });

    afterEach(() =>
    {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    test("explains ZIP uploads on keyboard focus without a persistent info alert or native title", async () =>
    {
        mockServer();
        render(<App />);
        const dialog = await screen.findByRole("dialog", { name: SETUP_TITLE });
        const help = within(dialog).getByRole("button", { name: "About ZIP Uploads" });
        expect(help).not.toHaveAttribute("title");
        expect(within(dialog).queryByRole("note")).not.toBeInTheDocument();
        expect(screen.queryByText(/persistent local cache/)).not.toBeInTheDocument();
        fireEvent.keyDown(document, { key: "Tab" });
        act(() => { help.focus(); });
        const tooltip = await screen.findByRole("tooltip");
        expect(tooltip).toHaveTextContent("Use the archive from Download Required Files.");
        expect(tooltip).toHaveTextContent("validated and kept in a persistent local cache");
        expect(tooltip).toHaveTextContent("not the original ZIP or checkout");
        expect(tooltip).toHaveTextContent("Re-download Required Files");
        expect(tooltip).toHaveTextContent("local server is still required");
        expect(tooltip).toHaveTextContent("128 MiB");
        expect(help).not.toHaveAttribute("title");
    });

    test("uploads on first launch without paths, selects the manifest game and reloads cached roots", async () =>
    {
        const user = userEvent.setup();
        const calls = mockServer({ "/workspaces/import": () => importedWorkspace("unbound") });
        render(<App />);
        const dialog = await screen.findByRole("dialog", { name: SETUP_TITLE });
        const input = within(dialog).getByLabelText("Upload ZIP");
        expect(input).toHaveAttribute("accept", ".zip,application/zip");
        expect(within(dialog).getByRole("button", { name: "Upload ZIP" })).toBeEnabled();
        expect(within(dialog).getByRole("button", { name: "Load" })).toBeDisabled();
        expect(within(dialog).getByText("Or upload a required-files ZIP without entering folder paths.")).toBeInTheDocument();
        expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
        const help = within(dialog).getByRole("button", { name: "About ZIP Uploads" });
        await user.hover(help);
        expect(await screen.findByRole("tooltip")).toHaveTextContent(/Save writes the cached CFRU copy/);
        await user.unhover(help);
        const file = new File(["ZIP"], "required.ZIP", { type: "application/zip" });
        await user.upload(input, file);
        expect(await screen.findByRole("button", { name: "Unbound menu" })).toBeInTheDocument();
        const upload = calls.find((call) => call.route === "/workspaces/import");
        expect(upload.body).toBe(file);
        expect(upload.token).toBe("token-1");
        expect(upload.options.headers["Content-Type"]).toBe("application/zip");
        expect(upload.params.progressId).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i);
        expect(input.value).toBe("");
        expect(getSavedSettings()).toEqual({ version: SETTINGS_VERSION, paths: CACHED_PATHS, gameId: "unbound" });
        expect(calls.some((call) => call.route === "/workspaces/load")).toBe(false);

        cleanup();
        const reloadCalls = mockServer({ "/workspaces/load": () => importedWorkspace("unbound") });
        render(<App />);
        await screen.findByRole("button", { name: "Unbound menu" });
        expect(reloadCalls.find((call) => call.route === "/workspaces/load").body).toEqual({ paths: CACHED_PATHS });
    });

    test.each([undefined, "missing-game"])("asks for a game when manifest game %s cannot be auto-selected", async (gameId) =>
    {
        const user = userEvent.setup();
        mockServer({ "/workspaces/import": () => importedWorkspace(gameId) });
        render(<App />);
        const setup = await screen.findByRole("dialog", { name: SETUP_TITLE });
        await user.upload(within(setup).getByLabelText("Upload ZIP"), new File(["ZIP"], "required.zip"));
        const dialog = await screen.findByRole("dialog", { name: GAME_TITLE });
        expect(within(dialog).getByRole("button", { name: "Unbound" })).toBeEnabled();
        expect(getSavedSettings()).toEqual({ version: SETTINGS_VERSION, paths: CACHED_PATHS, gameId: "" });
        await user.click(within(dialog).getByRole("button", { name: "Change Repositories" }));
        const cachedSetup = await screen.findByRole("dialog", { name: SETUP_TITLE });
        expect(within(cachedSetup).getByLabelText(LABELS.cfru)).toHaveValue(CACHED_PATHS.cfru);
    });

    test.each(["extension", "empty", "oversize"])("rejects an invalid %s ZIP without losing entered paths", async (invalid) =>
    {
        const user = userEvent.setup({ applyAccept: false });
        const calls = mockServer();
        render(<App />);
        const dialog = await screen.findByRole("dialog", { name: SETUP_TITLE });
        await user.type(within(dialog).getByLabelText(LABELS.cfru), PATHS.cfru);
        const file = new File(invalid === "empty" ? [] : ["ZIP"], invalid === "extension" ? "required.txt" : "required.zip");
        if (invalid === "oversize")
            Object.defineProperty(file, "size", { value: 128 * 1024 * 1024 + 1 });
        await user.upload(within(dialog).getByLabelText("Upload ZIP"), file);
        expect(await within(dialog).findByText(/non-empty ZIP file no larger than 128 MiB/)).toBeInTheDocument();
        expect(within(dialog).getByLabelText(LABELS.cfru)).toHaveValue(PATHS.cfru);
        expect(within(dialog).getByRole("button", { name: "Upload ZIP" })).toBeEnabled();
        expect(calls).toHaveLength(0);
    });

    test("failed import retains entered paths and the existing catalog, allowing same-file retry or Cancel", async () =>
    {
        saveSettings({ paths: PATHS, gameId: "unbound" });
        const user = userEvent.setup();
        const calls = mockServer({ "/workspaces/import": () =>
        {
            throw apiError(StatusCode.ClientErrorUnprocessableEntity, "ARCHIVE_INVALID", "This ZIP is missing required files.");
        } });
        render(<App />);
        await user.click(await screen.findByRole("button", { name: "Unbound menu" }));
        await user.click(screen.getByRole("menuitem", { name: "Change Repositories" }));
        const dialog = await screen.findByRole("dialog", { name: SETUP_TITLE });
        await user.type(within(dialog).getByLabelText(LABELS.dpe), "-edited");
        const input = within(dialog).getByLabelText("Upload ZIP");
        const file = new File(["ZIP"], "required.zip");
        await user.upload(input, file);
        expect(await within(dialog).findByText("This ZIP is missing required files.")).toBeInTheDocument();
        expect(within(dialog).getByLabelText(LABELS.dpe)).toHaveValue(`${PATHS.dpe}-edited`);
        expect(getSavedSettings().paths).toEqual(PATHS);
        await user.upload(input, file);
        await waitFor(() => expect(calls.filter((call) => call.route === "/workspaces/import")).toHaveLength(2));
        await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        expect(screen.getByRole("button", { name: "Unbound menu" })).toBeInTheDocument();
        expect(screen.getAllByRole("article")).toHaveLength(FIRST_SET_COUNT);
    });

    test("malformed import responses return to setup without changing paths or stored settings", async () =>
    {
        const user = userEvent.setup();
        mockServer({ "/workspaces/import": () => ({ workspaceId: "invalid-workspace" }) });
        render(<App />);
        const dialog = await screen.findByRole("dialog", { name: SETUP_TITLE });
        await user.type(within(dialog).getByLabelText(LABELS.cloud), PATHS.cloud);
        await user.upload(within(dialog).getByLabelText("Upload ZIP"), new File(["ZIP"], "required.zip"));
        expect(await within(dialog).findByText("The editor server returned an unexpected import response.")).toBeInTheDocument();
        expect(within(dialog).getByLabelText(LABELS.cloud)).toHaveValue(PATHS.cloud);
        expect(within(dialog).getByRole("button", { name: "Upload ZIP" })).toBeEnabled();
        expect(getSavedSettings()).toBeNull();
    });

    test("upload retries an expired session and disables setup actions while loading", async () =>
    {
        const user = userEvent.setup();
        let finish;
        let sessionCount = 0;
        const calls = mockServer({
            "/session": () => ({ token: `token-${++sessionCount}` }),
            "/workspaces/import": (body, token) =>
            {
                if (token === "token-1")
                    throw apiError(StatusCode.ClientErrorUnauthorized, "SESSION_INVALID", "Expired");
                return new Promise((resolve) => { finish = resolve; });
            },
        });
        render(<App />);
        const dialog = await screen.findByRole("dialog", { name: SETUP_TITLE });
        await user.upload(within(dialog).getByLabelText("Upload ZIP"), new File(["ZIP"], "required.zip"));
        await waitFor(() => expect(finish).toBeTypeOf("function"));
        expect(within(dialog).getByRole("button", { name: "Upload ZIP" })).toBeDisabled();
        expect(within(dialog).getByLabelText("Upload ZIP")).toBeDisabled();
        expect(within(dialog).getByLabelText(LABELS.cfru)).toBeDisabled();
        expect(within(dialog).getByRole("button", { name: "Load" })).toBeDisabled();
        expect(within(dialog).getByRole("progressbar")).toBeInTheDocument();
        finish(importedWorkspace("unbound"));
        await screen.findByRole("button", { name: "Unbound menu" });
        expect(calls.filter((call) => call.route === "/workspaces/import").map((call) => call.token)).toEqual(["token-1", "token-2"]);
    });

    test("downloads saved sources with token, Blob response and fixed ZIP filename even without warnings", async () =>
    {
        saveSettings({ paths: PATHS, gameId: "unbound" });
        const download = mockDownload();
        const blob = new Blob(["ZIP"], { type: "application/zip" });
        const calls = mockServer({ [ARCHIVE_ROUTE]: () => blob });
        render(<App />);
        await chooseDownload(userEvent.setup());
        await waitFor(() => expect(download.create).toHaveBeenCalledWith(blob));
        const request = calls.find((call) => call.route.endsWith("/archive"));
        expect(request.body).toEqual({ gameId: "unbound" });
        expect(request.token).toBe("token-1");
        expect(request.options.responseType).toBe("blob");
        expect(download.anchor.download).toBe("spread-editor-reqs.zip");
        expect(download.anchor.href).toBe("blob:archive");
        expect(download.anchor.isConnected).toBe(false);
        expect(download.revoke).toHaveBeenCalledWith("blob:archive");
        expect(screen.getByText(/ZIP contains saved source files, not unsaved drafts/)).toBeInTheDocument();
    });

    test("places spread file actions beneath required files and exports the spread-only ZIP", async () =>
    {
        saveSettings({ paths: PATHS, gameId: "unbound" });
        const user = userEvent.setup();
        const download = mockDownload();
        const calls = mockServer({ "/workspaces/workspace-1/spread-files/export": () => new Blob(["SPREAD ZIP"]) });
        render(<App />);
        await user.click(await screen.findByRole("button", { name: "Unbound menu" }));
        const labels = screen.getAllByRole("menuitem").map((item) => item.textContent);
        expect(labels.slice(labels.indexOf(DOWNLOAD_LABEL), labels.indexOf(DOWNLOAD_LABEL) + 3))
            .toEqual([DOWNLOAD_LABEL, "Export Spread Files", "Import Spread Files"]);
        await user.click(screen.getByRole("menuitem", { name: "Export Spread Files" }));
        const dialog = await screen.findByRole("dialog", { name: "Export Spread Files" });
        expect(download.create).not.toHaveBeenCalled();
        await user.type(within(dialog).getByRole("textbox", { name: "Export Name" }), "  October Collaboration  ");
        await user.click(within(dialog).getByRole("button", { name: "Export", exact: true }));
        await waitFor(() => expect(download.create).toHaveBeenCalledOnce());
        expect(download.anchor.download).toBe("spread-files.zip");
        expect(within(dialog).getByText("The ZIP contains your saved CFRU spread files.")).toBeInTheDocument();
        expect(within(dialog).queryByText(/local cached copy/)).not.toBeInTheDocument();
        expect(calls.find((call) => call.route.endsWith("/spread-files/export")).options.responseType).toBe("blob");
        expect(calls.find((call) => call.route.endsWith("/spread-files/export")).body.name).toBe("October Collaboration");
    });

    test("keeps the export name when retrying a failed spread download", async () =>
    {
        saveSettings({ paths: PATHS, gameId: "unbound" });
        const user = userEvent.setup();
        const download = mockDownload();
        let attempts = 0;
        const calls = mockServer({ "/workspaces/workspace-1/spread-files/export": () =>
        {
            if (++attempts === 1)
                throw apiError(503, "EXPORT_FAILED", "Could not prepare this export.");
            return new Blob(["SPREAD ZIP"]);
        } });
        render(<App />);
        await user.click(await screen.findByRole("button", { name: "Unbound menu" }));
        await user.click(screen.getByRole("menuitem", { name: "Export Spread Files" }));
        const dialog = await screen.findByRole("dialog", { name: "Export Spread Files" });
        await user.type(within(dialog).getByRole("textbox", { name: "Export Name" }), "Partner Review");
        await user.click(within(dialog).getByRole("button", { name: "Export", exact: true }));
        expect(await within(dialog).findByText("Could not prepare this export.")).toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: "Retry" }));
        await waitFor(() => expect(download.create).toHaveBeenCalledOnce());
        expect(calls.filter((call) => call.route.endsWith("/spread-files/export")).map((call) => call.body.name))
            .toEqual(["Partner Review", "Partner Review"]);
    });

    test("confirms spread-file overwrite, uploads a ZIP, and refreshes the editor", async () =>
    {
        saveSettings({ paths: PATHS, gameId: "unbound" });
        const user = userEvent.setup();
        const spreads = createSpreads("imported-revision");
        spreads.entries[0].fields.atkIv = 7;
        const calls = mockServer({ "/workspaces/workspace-1/spread-files/import": () => ({ revision: createSpreads().revision,
            operations: [{ type: "update", entryId: spreads.entries[0].id, fields: { atkIv: 7 } }], files: [], backupId: null }) });
        render(<App />);
        await user.click(await screen.findByRole("button", { name: "Unbound menu" }));
        await user.click(screen.getByRole("menuitem", { name: "Import Spread Files" }));
        const dialog = await screen.findByRole("dialog", { name: "Import Spread Files" });
        expect(within(dialog).getByText(/Files are not written until Save Changes/)).toBeInTheDocument();
        const confirm = within(dialog).getByRole("button", { name: "Import And Overwrite" });
        expect(confirm).toHaveClass("MuiButton-outlined");
        expect(confirm).toBeDisabled();
        const file = new File(["ZIP"], "spreads.zip", { type: "application/zip" });
        await user.upload(within(dialog).getByLabelText("Choose Spread Files ZIP"), file);
        expect(calls.some((call) => call.route.endsWith("/spread-files/import"))).toBe(false);
        await user.click(confirm);
        expect(await within(dialog).findByText("Changes imported as unsaved edits.")).toBeInTheDocument();
        expect(calls.some((call) => call.route.endsWith("/save"))).toBe(false);
        const request = calls.find((call) => call.route.endsWith("/spread-files/import"));
        expect(request.body).toBe(file);
        expect(request.options.headers["Content-Type"]).toBe("application/zip");
        expect(request.params.revision).toBe(createSpreads().revision);
        await user.click(within(dialog).getByRole("button", { name: "Close" }));
        const card = (await screen.findAllByRole("article", { name: "Charizard spread" }))[0];
        expect(screen.getByRole("button", { name: /^Save Changes/ })).toBeEnabled();
        await user.click(within(card).getByRole("heading", { name: "Charizard" }));
        const edit = await screen.findByRole("dialog", { name: "Edit Charizard" });
        expect(within(edit).getByLabelText("Charizard Attack IV")).toHaveValue("7");
    });

    test("stages full-overwrite additions and reorders without movement metadata or saving", async () =>
    {
        saveSettings({ paths: PATHS, gameId: "unbound" });
        const user = userEvent.setup();
        const spreads = createSpreads();
        const set = spreads.sets[0];
        const entry = spreads.entries.find((entry) => entry.id === set.entryIds[0]);
        const tempId = "new-full-import";
        const order = [tempId, ...set.entryIds.slice(1), entry.id];
        const operations = [
            { type: "update", entryId: entry.id, fields: { atkIv: 7 } },
            { type: "add", tempId, setId: set.id, fields: { ...entry.fields, atkIv: 9 } },
            { type: "reorder", setId: set.id, order },
        ];
        const calls = mockServer({ "/workspaces/workspace-1/spread-files/import": () => ({ revision: spreads.revision,
            operations, files: [], backupId: null }) });
        render(<App />);
        await user.click(await screen.findByRole("button", { name: "Unbound menu" }));
        await user.click(screen.getByRole("menuitem", { name: "Import Spread Files" }));
        let dialog = await screen.findByRole("dialog", { name: "Import Spread Files" });
        await user.upload(within(dialog).getByLabelText("Choose Spread Files ZIP"), new File(["ZIP"], "full-import.zip"));
        await user.click(within(dialog).getByRole("button", { name: "Import And Overwrite" }));
        dialog = await screen.findByRole("dialog", { name: "Import Results" });
        expect(within(dialog).getByText("Changes imported as unsaved edits.")).toBeInTheDocument();
        const stored = JSON.parse(localStorage.getItem("cfruSpreadEditor.unsavedChanges"));
        expect(stored.orders[set.id]).toEqual(order);
        expect(stored.drafts[entry.id].atkIv).toBe(7);
        expect(stored.newEntries[tempId].fields.atkIv).toBe(9);
        expect(calls.some((call) => call.route.endsWith("/save"))).toBe(false);
        await user.click(within(dialog).getByRole("button", { name: "Close", exact: true }));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        const newIndicator = screen.getByRole("img", { name: "New Spread" });
        const newCard = newIndicator.closest("article");
        expect(newCard).not.toHaveAttribute("data-highlighted-fields");
        expect(newCard.querySelector("[data-highlighted-field]")).toBeNull();
        expect(screen.getByRole("button", { name: /^Save Changes/ })).toBeEnabled();
    });

    test("formats export dates as YYYY/MM/DD with local 12-hour time and AM or PM", () =>
    {
        expect(formatExportDate(new Date(2026, 9, 5, 21, 42, 17).toISOString())).toBe("2026/10/05 09:42:17 PM");
        expect(formatExportDate(new Date(2026, 9, 5, 0, 5, 0).toISOString())).toBe("2026/10/05 12:05:00 AM");
        expect(formatExportDate(new Date(2026, 9, 5, 12, 5, 0).toISOString())).toBe("2026/10/05 12:05:00 PM");
    });

    test("shows loading stages with determinate percentages", () =>
    {
        render(<OperationProgress progress={{ percentage: 54, label: "Comparing Whole Spreads..." }} />);
        expect(screen.getByRole("status")).toHaveTextContent("Comparing Whole Spreads... 54%");
        expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "54");
    });

    test("displays the reported comparison percentage while the ZIP is loading", async () =>
    {
        saveSettings({ paths: PATHS, gameId: "unbound" });
        const user = userEvent.setup();
        let finishImport;
        mockServer({
            "/workspaces/:id/spread-files/exports": () => ({ exports: [{ id: "baseline", exportedAt: "2026-10-05T10:30:00.000Z" }] }),
            "/workspaces/workspace-1/spread-files/import": () => new Promise((resolve) => { finishImport = resolve; }),
            "/progress/:id": () => ({ percentage: 63, label: "Comparing Whole Spreads...", status: "running" }),
        });
        render(<App />);
        await user.click(await screen.findByRole("button", { name: "Unbound menu" }));
        await user.click(screen.getByRole("menuitem", { name: "Import Spread Files" }));
        const dialog = await screen.findByRole("dialog", { name: "Import Spread Files" });
        await user.upload(within(dialog).getByLabelText("Choose Spread Files ZIP"), new File(["ZIP"], "returned.zip"));
        await user.click(within(dialog).getByRole("button", { name: "Preview Changes" }));
        expect(await within(dialog).findByText("Comparing Whole Spreads... 63%")).toBeInTheDocument();
        expect(within(dialog).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "63");
        await act(async () => finishImport({ previewId: "progress-preview", changes: [], conflicts: [] }));
        await screen.findByRole("dialog", { name: "Import Results" });
    });

    test("selects a dated baseline, previews smart changes, and imports explicit conflict choices", async () =>
    {
        saveSettings({ paths: PATHS, gameId: "unbound" });
        const user = userEvent.setup();
        const baselineId = "export-baseline-1";
        const conflictId = "spread:0";
        const version = { fields: createSpreads().entries[0].fields,
            set: { name: "gFrontierSpreads", file: "src/Tables/battle_tower_spreads.h", littleCup: false }, diagnostics: [], line: 1 };
        const preview = { previewId: "merge-preview-1", changedFiles: ["src/Tables/battle_tower_spreads.h"],
            changes: [],
            conflicts: [{ id: conflictId, file: version.set.file, setName: version.set.name, label: "SPECIES_CHARIZARD / gFrontierSpreads",
                operations: [{ type: "update", entryId: createSpreads().entries[0].id, fields: { atkIv: 7 } }],
                spreads: { original: [version], current: [{ ...version, fields: { ...version.fields, atkIv: 0 } }],
                    incoming: [{ ...version, fields: { ...version.fields, atkIv: 7 } }] } }] };
        const calls = mockServer({
            "/workspaces/:id/spread-files/exports": () => ({ exports: [
                { id: "newer-export", exportedAt: "2026-10-05T12:30:00.000Z" },
                { id: baselineId, exportedAt: "2026-10-05T10:30:00.000Z" },
            ] }),
            "/workspaces/workspace-1/spread-files/import": () => preview,
            "/workspaces/workspace-1/spread-files/merge": () => ({ revision: createSpreads().revision,
                operations: [{ type: "update", entryId: createSpreads().entries[0].id, fields: { atkIv: 7 } }],
                acceptedCount: 1, rejectedCount: 0, files: [{ path: version.set.file, status: "staged" }], backupId: null }),
        });
        render(<App />);
        await user.click(await screen.findByRole("button", { name: "Unbound menu" }));
        await user.click(screen.getByRole("menuitem", { name: "Import Spread Files" }));
        const dialog = await screen.findByRole("dialog", { name: "Import Spread Files" });
        await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "Export" })).toBeEnabled());
        expect(within(dialog).getByRole("button", { name: "Smart Import" })).toHaveAttribute("aria-pressed", "true");
        await user.clear(within(dialog).getByRole("combobox", { name: "Export" }));
        await user.click(within(dialog).getByRole("combobox", { name: "Export" }));
        await user.click(await screen.findByRole("option", { name: formatExportDate("2026-10-05T10:30:00.000Z") }));
        const file = new File(["ZIP"], "returned-spreads.zip");
        await user.upload(within(dialog).getByLabelText("Choose Spread Files ZIP"), file);
        expect(within(dialog).getByRole("button", { name: file.name })).toHaveClass("MuiButton-colorFocus");
        expect(within(dialog).queryByRole("button", { name: "Choose ZIP" })).not.toBeInTheDocument();
        expect(within(dialog).getByRole("button", { name: "Preview Changes" })).toHaveClass("MuiButton-colorFocus");
        await user.click(within(dialog).getByRole("button", { name: "Preview Changes" }));
        expect(await within(dialog).findByText("1 conflict.")).toBeInTheDocument();
        expect(screen.getByRole("dialog", { name: "Review Spread Changes" })).toBeInTheDocument();
        expect(within(dialog).getAllByRole("article", { name: "Charizard spread" })).toHaveLength(3);
        expect(within(dialog).queryByRole("combobox", { name: "Export" })).not.toBeInTheDocument();
        expect(calls.find((call) => call.route.endsWith("/spread-files/import")).params.baselineId).toBe(baselineId);
        expect(calls.some((call) => call.route.endsWith("/spread-files/merge"))).toBe(false);
        expect(within(dialog).queryByRole("button", { name: "Import Changes" })).not.toBeInTheDocument();
        const cards = within(dialog).getAllByRole("article", { name: "Charizard spread" });
        expect(cards[1]).toHaveAttribute("data-highlighted-fields", "atkIv");
        expect(cards[2]).toHaveAttribute("data-highlighted-fields", "atkIv");
        expect(cards[1].querySelector('[data-highlighted-field="atkIv"]')).not.toBeNull();
        expect(cards[2].querySelector('[data-highlighted-field="atkIv"]')).not.toBeNull();
        expect(within(cards[1].parentElement).getByRole("button", { name: "Keep Current" })).toBeInTheDocument();
        expect(within(cards[2].parentElement).getByRole("button", { name: "Keep Incoming" })).toBeInTheDocument();
        expect(within(dialog).queryByRole("tab")).not.toBeInTheDocument();
        expect(within(dialog).getByRole("heading", { name: "Original", level: 4 })).toHaveStyle({ fontWeight: 700 });
        await user.click(within(dialog).getByRole("button", { name: "Keep Incoming" }));
        expect(await within(dialog).findByText("Changes imported as unsaved edits.")).toBeInTheDocument();
        expect(screen.getByRole("dialog", { name: "Import Results" })).toBeInTheDocument();
        expect(within(dialog).getByText(/1 accepted; 0 rejected/)).toBeInTheDocument();
        expect(calls.some((call) => call.route.endsWith("/save"))).toBe(false);
        expect(calls.some((call) => call.route.endsWith("/spread-files/merge"))).toBe(false);
        await user.click(within(dialog).getByRole("button", { name: "Back" }));
        expect(screen.getByRole("dialog", { name: "Import Spread Files" })).toBeInTheDocument();
        expect(within(dialog).getByText(file.name)).toBeInTheDocument();
    });

    test("searches named exports and selects the first matching baseline with Enter", async () =>
    {
        saveSettings({ paths: PATHS, gameId: "unbound" });
        const user = userEvent.setup();
        const calls = mockServer({
            "/workspaces/:id/spread-files/exports": () => ({ exports: [
                { id: "newest", name: "Raid Review", exportedAt: "2026-10-06T10:30:00.000Z" },
                { id: "round-first", name: "Round One", exportedAt: "2026-10-05T10:30:00.000Z" },
                { id: "round-second", name: "Round One", exportedAt: "2026-10-04T10:30:00.000Z" },
            ] }),
            "/workspaces/workspace-1/spread-files/import": () => ({ previewId: "named-preview", changes: [], conflicts: [] }),
        });
        render(<App />);
        await user.click(await screen.findByRole("button", { name: "Unbound menu" }));
        await user.click(screen.getByRole("menuitem", { name: "Import Spread Files" }));
        const dialog = await screen.findByRole("dialog", { name: "Import Spread Files" });
        const input = within(dialog).getByRole("combobox", { name: "Export" });
        await waitFor(() => expect(input).toHaveValue("Raid Review"));
        await user.clear(input);
        await user.type(input, "Round One");
        const options = await screen.findAllByRole("option");
        expect(options).toHaveLength(2);
        expect(within(options[0]).getByText(formatExportDate("2026-10-05T10:30:00.000Z"))).toBeInTheDocument();
        expect(within(options[1]).getByText(formatExportDate("2026-10-04T10:30:00.000Z"))).toBeInTheDocument();
        await user.keyboard("{Enter}");
        expect(input).toHaveValue("Round One");
        await user.upload(within(dialog).getByLabelText("Choose Spread Files ZIP"), new File(["ZIP"], "returned.zip"));
        await user.click(within(dialog).getByRole("button", { name: "Preview Changes" }));
        await screen.findByRole("dialog", { name: "Import Results" });
        expect(calls.find((call) => call.route.endsWith("/spread-files/import")).params.baselineId).toBe("round-first");
    });

    test("groups paginated conflict triples by spread set without tabs or accordions", async () =>
    {
        saveSettings({ paths: PATHS, gameId: "unbound" });
        const user = userEvent.setup();
        const spreads = createSpreads();
        const regular = spreads.sets.find((set) => set.name === "gFrontierSpreads");
        const special = spreads.sets.find((set) => set.name.includes("Palmer"));
        const version = { fields: spreads.entries[0].fields, diagnostics: [], line: 1, set: regular };
        const changes = Array.from({ length: 7 }, (_, index) => ({ file: regular.file, setName: regular.name, label: `Change ${index}`,
            spreads: { original: [version], current: [], incoming: [{ ...version, fields: { ...version.fields, atkIv: index } }] } }));
        changes.unshift({ file: special.file, setName: special.name, label: "Special change",
            spreads: { original: [{ ...version, set: special }], current: [], incoming: [{ ...version, set: special }] } });
        mockServer({
            "/workspaces/:id/spread-files/exports": () => ({ exports: [{ id: "baseline", exportedAt: "2026-10-05T10:30:00.000Z" }] }),
            "/workspaces/workspace-1/spread-files/import": () => ({ previewId: "pagination-preview", changes: [], conflicts: changes, changedFiles: [regular.file, special.file] }),
        });
        render(<App />);
        await user.click(await screen.findByRole("button", { name: "Unbound menu" }));
        await user.click(screen.getByRole("menuitem", { name: "Import Spread Files" }));
        const dialog = await screen.findByRole("dialog", { name: "Import Spread Files" });
        await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "Export" })).toBeEnabled());
        await user.upload(within(dialog).getByLabelText("Choose Spread Files ZIP"), new File(["ZIP"], "changes.zip"));
        await user.click(within(dialog).getByRole("button", { name: "Preview Changes" }));
        expect(await within(dialog).findByText("8 conflicts.")).toBeInTheDocument();
        expect(within(dialog).getAllByRole("article", { name: "Charizard spread" })).toHaveLength(12);
        expect(within(dialog).getByRole("heading", { name: "Frontier Spreads" })).toBeInTheDocument();
        expect(dialog.querySelectorAll(".MuiAccordion-root")).toHaveLength(0);
        expect([...dialog.querySelectorAll(".spread-import-comparison-row")].every((row) => row.dataset.columns === "3")).toBe(true);
        expect(within(dialog).queryByRole("tab")).not.toBeInTheDocument();
        const pagination = within(dialog).getByRole("navigation", { name: "Spread Comparison Pagination" });
        await user.click(within(pagination).getByRole("button", { name: "Go to page 2" }));
        expect(within(dialog).getAllByRole("article", { name: "Charizard spread" })).toHaveLength(4);
        expect(within(dialog).getAllByRole("heading", { level: 3 }).filter((heading) => !heading.closest("article")).map((heading) => heading.textContent))
            .toEqual(["Frontier Spreads", "Special Spread Palmer 1"]);
    });

    test("does not import an unchanged returned ZIP and resets review when changing its export date", async () =>
    {
        saveSettings({ paths: PATHS, gameId: "unbound" });
        const user = userEvent.setup();
        const calls = mockServer({
            "/workspaces/:id/spread-files/exports": () => ({ exports: [
                { id: "export-newer", exportedAt: "2026-10-05T12:30:00.000Z" },
                { id: "export-older", exportedAt: "2026-10-04T12:30:00.000Z" },
            ] }),
            "/workspaces/workspace-1/spread-files/import": () => ({ previewId: "no-changes", changedFiles: [], changes: [], conflicts: [] }),
        });
        render(<App />);
        await user.click(await screen.findByRole("button", { name: "Unbound menu" }));
        await user.click(screen.getByRole("menuitem", { name: "Import Spread Files" }));
        const dialog = await screen.findByRole("dialog", { name: "Import Spread Files" });
        await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "Export" })).toBeEnabled());
        await user.upload(within(dialog).getByLabelText("Choose Spread Files ZIP"), new File(["ZIP"], "unchanged.zip"));
        await user.click(within(dialog).getByRole("button", { name: "Preview Changes" }));
        expect(await within(dialog).findByText("No incoming changes since this export.")).toBeInTheDocument();
        expect(within(dialog).queryByRole("button", { name: "Import Changes" })).not.toBeInTheDocument();
        expect(calls.some((call) => call.route.endsWith("/spread-files/merge"))).toBe(false);
        await user.click(within(dialog).getByRole("button", { name: "Back" }));
        await user.clear(within(dialog).getByRole("combobox", { name: "Export" }));
        await user.click(within(dialog).getByRole("combobox", { name: "Export" }));
        await user.click(await screen.findByRole("option", { name: formatExportDate("2026-10-04T12:30:00.000Z") }));
        expect(within(dialog).queryByText("No incoming changes since this export.")).not.toBeInTheDocument();
        expect(within(dialog).getByRole("button", { name: "Preview Changes" })).toBeEnabled();
    });

    test("shows export-history errors and can retry without overwriting files", async () =>
    {
        saveSettings({ paths: PATHS, gameId: "unbound" });
        const user = userEvent.setup();
        let attempts = 0;
        const calls = mockServer({ "/workspaces/:id/spread-files/exports": () =>
        {
            if (++attempts === 1)
                throw apiError(503, "EXPORT_READ_FAILED", "Export history is unavailable.");
            return { exports: [{ id: "export-retry", exportedAt: "2026-10-05T10:30:00.000Z" }] };
        } });
        render(<App />);
        await user.click(await screen.findByRole("button", { name: "Unbound menu" }));
        await user.click(screen.getByRole("menuitem", { name: "Import Spread Files" }));
        const dialog = await screen.findByRole("dialog", { name: "Import Spread Files" });
        expect(await within(dialog).findByText("Export history is unavailable.")).toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: "Retry" }));
        await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "Export" })).toBeEnabled());
        expect(within(dialog).queryByText("Export history is unavailable.")).not.toBeInTheDocument();
        expect(calls.some((call) => call.route.endsWith("/spread-files/import"))).toBe(false);
    });

    test.each(["Export Spread Files"])("guards %s and keeps drafts on cancellation", async (label) =>
    {
        saveSettings({ paths: PATHS, gameId: "unbound" });
        const user = userEvent.setup();
        const calls = mockServer();
        render(<App />);
        await screen.findByRole("button", { name: "Unbound menu" });
        await changeSpread(user);
        await user.click(await screen.findByRole("button", { name: "Unbound menu" }));
        await user.click(screen.getByRole("menuitem", { name: label }));
        const guard = await screen.findByRole("dialog", { name: "Unsaved Changes" });
        await user.click(within(guard).getByRole("button", { name: "Cancel" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        expect(screen.getByRole("button", { name: /^Save Changes/ })).toBeEnabled();
        expect(calls.some((call) => call.route.includes("/spread-files/"))).toBe(false);
    });

    test("automatically imports ordinary changes, preserves drafts, and highlights the main grid", async () =>
    {
        saveSettings({ paths: PATHS, gameId: "unbound" });
        const user = userEvent.setup();
        const spreads = createSpreads();
        const first = spreads.entries[0];
        const second = spreads.entries[1];
        const set = spreads.sets.find((set) => set.id === first.setId);
        const comparison = (entry, id, atkIv) => ({ id, file: set.file, setName: set.name, label: entry.fields.species,
            operations: [{ type: "update", entryId: entry.id, fields: { atkIv } }],
            spreads: { original: [{ fields: entry.fields, set }], current: [], incoming: [{ fields: { ...entry.fields, atkIv }, set }] } });
        const changes = [comparison(second, "change-second", 9)];
        let currentOperations = [];
        const calls = mockServer({
            "/workspaces/:id/spread-files/exports": () => ({ exports: [{ id: "baseline", exportedAt: "2026-10-05T10:30:00.000Z" }] }),
            "/workspaces/:id/spread-files/current": (body) => { currentOperations = body.operations; return { currentId: "effective-current" }; },
            "/workspaces/workspace-1/spread-files/import": () => ({ previewId: "selective-preview", conflicts: [], changedFiles: [set.file],
                changes: changes.filter(() => !currentOperations.some((operation) => operation.entryId === second.id && operation.fields?.atkIv === 9)) }),
            "/workspaces/workspace-1/spread-files/merge": () => ({ revision: spreads.revision,
                operations: [{ type: "update", entryId: first.id, fields: { atkIv: 7 } }], acceptedCount: 1, rejectedCount: 1,
                files: [{ path: set.file, status: "staged" }] }),
        });
        render(<App />);
        await screen.findByRole("button", { name: "Unbound menu" });
        await changeSpread(user);
        await user.click(await screen.findByRole("button", { name: "Unbound menu" }));
        await user.click(screen.getByRole("menuitem", { name: "Import Spread Files" }));
        let dialog = await screen.findByRole("dialog", { name: "Import Spread Files" });
        expect(screen.queryByRole("dialog", { name: "Unsaved Changes" })).not.toBeInTheDocument();
        await user.upload(within(dialog).getByLabelText("Choose Spread Files ZIP"), new File(["ZIP"], "returned.zip"));
        await user.click(within(dialog).getByRole("button", { name: "Preview Changes" }));
        dialog = await screen.findByRole("dialog", { name: "Import Results" });
        expect(screen.queryByRole("dialog", { name: "Review Spread Changes" })).not.toBeInTheDocument();
        expect(within(dialog).getByText(/1 accepted; 0 rejected/)).toBeInTheDocument();
        expect(calls.some((call) => call.route.endsWith("/spread-files/merge"))).toBe(false);
        expect(calls.some((call) => call.route.endsWith("/save"))).toBe(false);
        const stored = JSON.parse(localStorage.getItem("cfruSpreadEditor.unsavedChanges"));
        expect(stored.drafts[first.id].atkIv).toBe(0);
        expect(stored.drafts[second.id].atkIv).toBe(9);
        await user.click(within(dialog).getByRole("button", { name: "Back" }));
        await user.click(within(dialog).getByRole("button", { name: "Preview Changes" }));
        dialog = await screen.findByRole("dialog", { name: "Import Results" });
        expect(within(dialog).getByText("No incoming changes since this export.")).toBeInTheDocument();
        expect(currentOperations.some((operation) => operation.entryId === second.id && operation.fields.atkIv === 9)).toBe(true);
        await user.click(within(dialog).getByRole("button", { name: "Close", exact: true }));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        const cards = screen.getAllByRole("article");
        expect(cards.filter((card) => card.dataset.highlightedFields?.includes("atkIv"))).toHaveLength(2);
        expect(cards.some((card) => card.querySelector('[data-highlighted-field="atkIv"]'))).toBe(true);
        await user.click(await screen.findByRole("button", { name: /^Save Changes/ }));
        await waitFor(() => expect(calls.some((call) => call.route.endsWith("/save"))).toBe(true));
        expect(calls.find((call) => call.route.endsWith("/save")).body.operations)
            .toEqual([{ type: "update", entryId: first.id, fields: { atkIv: 0 } }, { type: "update", entryId: second.id, fields: { atkIv: 9 } }]);
    });

    test("accepts consecutive comparisons locally even when the server is unavailable", async () =>
    {
        saveSettings({ paths: PATHS, gameId: "unbound" });
        const user = userEvent.setup();
        const spreads = createSpreads();
        const entries = spreads.entries.slice(0, 2);
        const set = spreads.sets.find((set) => set.id === entries[0].setId);
        const changes = entries.map((entry, index) => ({ id: `immediate-${index}`, file: set.file, setName: set.name,
            operations: [{ type: "update", entryId: entry.id, fields: { atkIv: 7 + index } }],
            spreads: { original: [{ fields: entry.fields, set }], current: [], incoming: [{ fields: { ...entry.fields, atkIv: 7 + index }, set }] } }));
        const calls = mockServer({
            "/workspaces/:id/spread-files/exports": () => ({ exports: [{ id: "baseline", exportedAt: "2026-10-05T10:30:00.000Z" }] }),
            "/workspaces/workspace-1/spread-files/import": () => ({ previewId: "immediate-preview", changes: [], conflicts: changes, changedFiles: [set.file] }),
            "/workspaces/workspace-1/spread-files/merge": (body) =>
            {
                throw apiError(503, "SERVER_UNAVAILABLE", "The server is unavailable.");
            },
        });
        render(<App />);
        await user.click(await screen.findByRole("button", { name: "Unbound menu" }));
        await user.click(screen.getByRole("menuitem", { name: "Import Spread Files" }));
        let dialog = await screen.findByRole("dialog", { name: "Import Spread Files" });
        await user.upload(within(dialog).getByLabelText("Choose Spread Files ZIP"), new File(["ZIP"], "returned.zip"));
        await user.click(within(dialog).getByRole("button", { name: "Preview Changes" }));
        dialog = await screen.findByRole("dialog", { name: "Review Spread Changes" });
        await user.click(within(dialog).getAllByRole("button", { name: "Keep Incoming", exact: true })[0]);
        await waitFor(() => expect(within(dialog).getAllByRole("button", { name: "Keep Incoming", exact: true })).toHaveLength(1));
        expect(within(dialog).queryByRole("progressbar")).not.toBeInTheDocument();
        expect(JSON.parse(localStorage.getItem("cfruSpreadEditor.unsavedChanges")).drafts[entries[0].id].atkIv).toBe(7);
        await user.click(within(dialog).getByRole("button", { name: "Keep Incoming", exact: true }));
        dialog = await screen.findByRole("dialog", { name: "Import Results" });
        expect(within(dialog).getByText(/2 accepted; 0 rejected/)).toBeInTheDocument();
        const drafts = JSON.parse(localStorage.getItem("cfruSpreadEditor.unsavedChanges")).drafts;
        expect(drafts[entries[0].id].atkIv).toBe(7);
        expect(drafts[entries[1].id].atkIv).toBe(8);
        expect(calls.some((call) => call.route.endsWith("/spread-files/merge"))).toBe(false);
        expect(calls.some((call) => call.route.endsWith("/save"))).toBe(false);
    });

    test.each([false, true])("locally stages additions in incoming order when accepted in reverse order: %s", async (reverse) =>
    {
        saveSettings({ paths: PATHS, gameId: "unbound" });
        const user = userEvent.setup();
        const spreads = createSpreads();
        const set = spreads.sets[0];
        const fields = spreads.entries.find((entry) => entry.setId === set.id).fields;
        const additionOrder = ["new-incoming-first", "new-incoming-second"];
        const changes = additionOrder.map((tempId, index) => ({ id: tempId, file: set.file, setName: set.name, additionOrder,
            operations: [{ type: "add", tempId, setId: set.id, afterEntryId: set.entryIds[0], fields: { ...fields, atkIv: 7 + index } }],
            spreads: { original: [], current: [], incoming: [{ fields: { ...fields, atkIv: 7 + index }, set }] } }));
        const calls = mockServer({
            "/workspaces/:id/spread-files/exports": () => ({ exports: [{ id: "baseline", exportedAt: "2026-10-05T10:30:00.000Z" }] }),
            "/workspaces/workspace-1/spread-files/import": () => ({ previewId: "additions-preview", changes: [], conflicts: changes, changedFiles: [set.file] }),
        });
        render(<App />);
        await user.click(await screen.findByRole("button", { name: "Unbound menu" }));
        await user.click(screen.getByRole("menuitem", { name: "Import Spread Files" }));
        let dialog = await screen.findByRole("dialog", { name: "Import Spread Files" });
        await user.upload(within(dialog).getByLabelText("Choose Spread Files ZIP"), new File(["ZIP"], "returned.zip"));
        await user.click(within(dialog).getByRole("button", { name: "Preview Changes" }));
        dialog = await screen.findByRole("dialog", { name: "Review Spread Changes" });
        await user.click(within(dialog).getAllByRole("button", { name: "Keep Incoming", exact: true })[reverse ? 1 : 0]);
        await user.click(within(dialog).getByRole("button", { name: "Keep Incoming", exact: true }));
        await screen.findByRole("dialog", { name: "Import Results" });
        const stored = JSON.parse(localStorage.getItem("cfruSpreadEditor.unsavedChanges"));
        expect(stored.orders[set.id]).toEqual([set.entryIds[0], ...additionOrder, ...set.entryIds.slice(1)]);
        expect(stored.newEntries[additionOrder[0]].fields.atkIv).toBe(7);
        expect(stored.newEntries[additionOrder[1]].fields.atkIv).toBe(8);
        expect(calls.some((call) => call.route.endsWith("/merge") || call.route.endsWith("/save"))).toBe(false);
    });

    test.each(["current", "incoming"])("confirms all %s conflict choices while ordinary changes are already imported", async (choice) =>
    {
        saveSettings({ paths: PATHS, gameId: "unbound" });
        const user = userEvent.setup();
        const spreads = createSpreads();
        const entries = spreads.entries.slice(0, 3);
        const set = spreads.sets[0];
        const comparisons = entries.map((entry, index) => ({ id: `bulk-${index}`, file: set.file, setName: set.name,
            operations: [{ type: "update", entryId: entry.id, fields: { atkIv: 7 + index } }],
            spreads: { original: [{ fields: entry.fields, set }], current: [{ fields: entry.fields, set }],
                incoming: [{ fields: { ...entry.fields, atkIv: 7 + index }, set }] } }));
        const calls = mockServer({
            "/workspaces/:id/spread-files/exports": () => ({ exports: [{ id: "baseline", exportedAt: "2026-10-05T10:30:00.000Z" }] }),
            "/workspaces/workspace-1/spread-files/import": () => ({ previewId: "bulk-preview", changes: comparisons.slice(2),
                conflicts: comparisons.slice(0, 2), changedFiles: [set.file] }),
        });
        render(<App />);
        await user.click(await screen.findByRole("button", { name: "Unbound menu" }));
        await user.click(screen.getByRole("menuitem", { name: "Import Spread Files" }));
        let dialog = await screen.findByRole("dialog", { name: "Import Spread Files" });
        await user.upload(within(dialog).getByLabelText("Choose Spread Files ZIP"), new File(["ZIP"], "returned.zip"));
        await user.click(within(dialog).getByRole("button", { name: "Preview Changes" }));
        dialog = await screen.findByRole("dialog", { name: "Review Spread Changes" });
        expect(within(dialog).getByText("2 conflicts.")).toBeInTheDocument();
        expect(within(dialog).getAllByRole("article")).toHaveLength(6);
        expect(JSON.parse(localStorage.getItem("cfruSpreadEditor.unsavedChanges")).drafts[entries[2].id].atkIv).toBe(9);
        const label = choice === "incoming" ? "Keep All Incoming" : "Keep All Current";
        await user.click(within(dialog).getByRole("button", { name: label }));
        let confirmation = await screen.findByRole("dialog", { name: label });
        await user.click(within(confirmation).getByRole("button", { name: "Cancel" }));
        await waitFor(() => expect(screen.queryByRole("dialog", { name: label })).not.toBeInTheDocument());
        dialog = await screen.findByRole("dialog", { name: "Review Spread Changes" });
        expect(JSON.parse(localStorage.getItem("cfruSpreadEditor.unsavedChanges")).drafts[entries[0].id]).toBeUndefined();
        await user.click(within(dialog).getByRole("button", { name: label }));
        confirmation = await screen.findByRole("dialog", { name: label });
        await user.click(within(confirmation).getByRole("button", { name: label }));
        dialog = await screen.findByRole("dialog", { name: "Import Results" });
        expect(within(dialog).getByText(choice === "incoming" ? /3 accepted; 0 rejected/ : /1 accepted; 2 rejected/)).toBeInTheDocument();
        const drafts = JSON.parse(localStorage.getItem("cfruSpreadEditor.unsavedChanges")).drafts;
        expect(drafts[entries[0].id]?.atkIv).toBe(choice === "incoming" ? 7 : undefined);
        expect(drafts[entries[1].id]?.atkIv).toBe(choice === "incoming" ? 8 : undefined);
        expect(drafts[entries[2].id].atkIv).toBe(9);
        expect(calls.some((call) => call.route.endsWith("/merge") || call.route.endsWith("/save"))).toBe(false);
    });

    test("does not partially stage an invalid automatic import batch", async () =>
    {
        saveSettings({ paths: PATHS, gameId: "unbound" });
        const user = userEvent.setup();
        const entry = createSpreads().entries[0];
        mockServer({
            "/workspaces/:id/spread-files/exports": () => ({ exports: [{ id: "baseline", exportedAt: "2026-10-05T10:30:00.000Z" }] }),
            "/workspaces/workspace-1/spread-files/import": () => ({ previewId: "invalid-batch", conflicts: [], changes: [
                { id: "valid", operations: [{ type: "update", entryId: entry.id, fields: { atkIv: 7 } }] },
                { id: "invalid" },
            ] }),
        });
        render(<App />);
        await user.click(await screen.findByRole("button", { name: "Unbound menu" }));
        await user.click(screen.getByRole("menuitem", { name: "Import Spread Files" }));
        const dialog = await screen.findByRole("dialog", { name: "Import Spread Files" });
        await user.upload(within(dialog).getByLabelText("Choose Spread Files ZIP"), new File(["ZIP"], "returned.zip"));
        await user.click(within(dialog).getByRole("button", { name: "Preview Changes" }));
        expect(await within(dialog).findByText("This preview does not contain local edits. Preview the ZIP again.")).toBeInTheDocument();
        expect(localStorage.getItem("cfruSpreadEditor.unsavedChanges")).toBeNull();
        expect(within(dialog).getByRole("button", { name: "Preview Changes" })).toBeEnabled();
    });

    test("Keep Current dismisses a conflict without staging or saving changes", async () =>
    {
        saveSettings({ paths: PATHS, gameId: "unbound" });
        const user = userEvent.setup();
        const spreads = createSpreads();
        const set = spreads.sets[0];
        const version = { fields: spreads.entries[0].fields, set };
        const calls = mockServer({
            "/workspaces/:id/spread-files/exports": () => ({ exports: [{ id: "baseline", exportedAt: "2026-10-05T10:30:00.000Z" }] }),
            "/workspaces/workspace-1/spread-files/import": () => ({ previewId: "dismiss-preview", changedFiles: [set.file], changes: [],
                conflicts: [{ id: "dismiss-conflict", file: set.file, setName: set.name,
                    spreads: { original: [version], current: [version], incoming: [{ ...version, fields: { ...version.fields, atkIv: 7 } }] } }] }),
        });
        render(<App />);
        await user.click(await screen.findByRole("button", { name: "Unbound menu" }));
        await user.click(screen.getByRole("menuitem", { name: "Import Spread Files" }));
        let dialog = await screen.findByRole("dialog", { name: "Import Spread Files" });
        await user.upload(within(dialog).getByLabelText("Choose Spread Files ZIP"), new File(["ZIP"], "returned.zip"));
        await user.click(within(dialog).getByRole("button", { name: "Preview Changes" }));
        dialog = await screen.findByRole("dialog", { name: "Review Spread Changes" });
        await user.click(within(dialog).getByRole("button", { name: "Keep Current" }));
        dialog = await screen.findByRole("dialog", { name: "Import Results" });
        expect(within(dialog).getByText(/0 accepted; 1 rejected/)).toBeInTheDocument();
        expect(within(dialog).queryByRole("article")).not.toBeInTheDocument();
        expect(calls.some((call) => call.route.endsWith("/merge") || call.route.endsWith("/save"))).toBe(false);
        expect(localStorage.getItem("cfruSpreadEditor.unsavedChanges")).toBeNull();
    });

    test("shows spread import errors and allows retry without leaving the editor", async () =>
    {
        saveSettings({ paths: PATHS, gameId: "unbound" });
        const user = userEvent.setup();
        let attempts = 0;
        mockServer({ "/workspaces/workspace-1/spread-files/import": () =>
        {
            if (++attempts === 1)
                throw apiError(422, "ARCHIVE_INVALID", "The ZIP contains an unknown spread file.");
            return { revision: createSpreads().revision, operations: [], files: [] };
        } });
        render(<App />);
        await user.click(await screen.findByRole("button", { name: "Unbound menu" }));
        await user.click(screen.getByRole("menuitem", { name: "Import Spread Files" }));
        const dialog = await screen.findByRole("dialog", { name: "Import Spread Files" });
        await user.upload(within(dialog).getByLabelText("Choose Spread Files ZIP"), new File(["ZIP"], "spreads.zip"));
        await user.click(within(dialog).getByRole("button", { name: "Import And Overwrite" }));
        expect(await within(dialog).findByText("The ZIP contains an unknown spread file.")).toBeInTheDocument();
        expect(within(dialog).getByRole("button", { name: "Import And Overwrite" })).toBeEnabled();
        await user.click(within(dialog).getByRole("button", { name: "Import And Overwrite" }));
        expect(await within(dialog).findByText("Changes imported as unsaved edits.")).toBeInTheDocument();
        expect(attempts).toBe(2);
    });

    test("parses Blob errors and recovers both session and workspace after restart", async () =>
    {
        saveSettings({ paths: PATHS, gameId: "unbound" });
        const download = mockDownload();
        let sessionCount = 0;
        let archiveCount = 0;
        const calls = mockServer({
            "/session": () => ({ token: `token-${++sessionCount}` }),
            "/workspaces/load": () => createWorkspace(sessionCount === 1 ? "workspace-1" : "workspace-2"),
            [ARCHIVE_ROUTE]: () =>
            {
                archiveCount++;
                if (archiveCount <= 2)
                    throw { response: { status: archiveCount === 1 ? StatusCode.ClientErrorUnauthorized : StatusCode.ClientErrorNotFound,
                        data: new Blob([JSON.stringify({ error: { code: archiveCount === 1 ? "SESSION_INVALID" : "WORKSPACE_NOT_FOUND", message: "Restarted" } })]) } };
                return new Blob(["ZIP"]);
            },
        });
        render(<App />);
        await chooseDownload(userEvent.setup());
        await waitFor(() => expect(download.create).toHaveBeenCalledOnce());
        expect(calls.filter((call) => call.route.endsWith("/archive")).map((call) => [call.route, call.token])).toEqual([
            ["/workspaces/workspace-1/archive", "token-1"],
            ["/workspaces/workspace-1/archive", "token-2"],
            ["/workspaces/workspace-2/archive", "token-2"],
        ]);
        expect(getSavedSettings()).toEqual({ version: SETTINGS_VERSION, paths: PATHS, gameId: "unbound" });
    });

    test("shows structured Blob download errors without creating a URL and permits retry", async () =>
    {
        saveSettings({ paths: PATHS, gameId: "unbound" });
        const user = userEvent.setup();
        const download = mockDownload();
        let fail = true;
        mockServer({ [ARCHIVE_ROUTE]: () =>
        {
            if (fail)
                throw { response: { status: StatusCode.ServerErrorInternal, data: new Blob([JSON.stringify({ error: { code: "ARCHIVE_FAILED", message: "A source file could not be read." } })]) } };
            return new Blob(["ZIP"]);
        } });
        render(<App />);
        await chooseDownload(user);
        const dialog = await screen.findByRole("dialog", { name: DOWNLOAD_LABEL });
        expect(await within(dialog).findByText("A source file could not be read.")).toBeInTheDocument();
        expect(download.create).not.toHaveBeenCalled();
        expect(download.revoke).not.toHaveBeenCalled();
        fail = false;
        await user.click(within(dialog).getByRole("button", { name: "Retry" }));
        await waitFor(() => expect(download.create).toHaveBeenCalledOnce());
    });

    test("cleans up the object URL and anchor when browser download fails", async () =>
    {
        saveSettings({ paths: PATHS, gameId: "unbound" });
        const download = mockDownload(true);
        mockServer();
        render(<App />);
        await chooseDownload(userEvent.setup());
        expect(await screen.findByText("The browser blocked the download.")).toBeInTheDocument();
        expect(download.anchor.isConnected).toBe(false);
        expect(download.revoke).toHaveBeenCalledWith("blob:archive");
    });

    test.each(["Cancel", "Discard", "Save"])("guards archive export with unsaved changes using %s", async (decision) =>
    {
        saveSettings({ paths: PATHS, gameId: "unbound" });
        const user = userEvent.setup();
        const download = mockDownload();
        const calls = mockServer();
        render(<App />);
        await screen.findByRole("button", { name: "Unbound menu" });
        await changeSpread(user);
        await chooseDownload(user);
        const guard = await screen.findByRole("dialog", { name: "Unsaved Changes" });
        expect(calls.some((call) => call.route.endsWith("/archive"))).toBe(false);
        await user.click(within(guard).getByRole("button", { name: decision }));
        if (decision === "Cancel")
        {
            await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
            expect(download.create).not.toHaveBeenCalled();
            expect(screen.getByRole("button", { name: /^Save Changes/ })).toBeEnabled();
        }
        else
        {
            await waitFor(() => expect(download.create).toHaveBeenCalledOnce());
            const routes = calls.map((call) => call.route);
            const saveIndex = routes.findIndex((route) => route.endsWith("/save"));
            if (decision === "Save")
            {
                expect(saveIndex).toBeGreaterThan(-1);
                expect(saveIndex).toBeLessThan(routes.findIndex((route) => route.endsWith("/archive")));
                expect(calls[saveIndex].body.operations[0].fields.atkIv).toBe(0);
            }
            else
                expect(saveIndex).toBe(-1);
        }
    });

    test("invalid drafts disable Save in the archive unsaved-change guard", async () =>
    {
        saveSettings({ paths: PATHS, gameId: "unbound" });
        const user = userEvent.setup();
        const spreads = createSpreads();
        Object.assign(spreads.entries[0].fields, { hpEv: 252, atkEv: 252, spdEv: 252 });
        const calls = mockServer({ "/workspaces/load": () => createWorkspace("workspace-1", spreads) });
        render(<App />);
        await screen.findByRole("button", { name: "Unbound menu" });
        const card = screen.getAllByRole("article", { name: "Charizard spread" })[0];
        await user.click(within(card).getByRole("heading", { name: "Charizard" }));
        const edit = await screen.findByRole("dialog", { name: "Edit Charizard" });
        await user.click(within(edit).getByRole("checkbox", { name: "Shiny" }));
        await user.click(within(edit).getByRole("button", { name: "Done" }));
        await chooseDownload(user);
        const guard = await screen.findByRole("dialog", { name: "Unsaved Changes" });
        expect(within(guard).getByRole("button", { name: "Save" })).toBeDisabled();
        expect(calls.some((call) => call.route.endsWith("/archive"))).toBe(false);
    });

    test("failed guard save leaves drafts and never downloads", async () =>
    {
        saveSettings({ paths: PATHS, gameId: "unbound" });
        const user = userEvent.setup();
        const calls = mockServer({ [SAVE_ROUTE]: () => { throw apiError(StatusCode.ClientErrorConflict, "SAVE_CONFLICT", "Files changed on disk."); } });
        render(<App />);
        await screen.findByRole("button", { name: "Unbound menu" });
        await changeSpread(user);
        await chooseDownload(user);
        const guard = await screen.findByRole("dialog", { name: "Unsaved Changes" });
        await user.click(within(guard).getByRole("button", { name: "Save" }));
        expect(await within(guard).findByText("Files changed on disk.")).toBeInTheDocument();
        expect(calls.some((call) => call.route.endsWith("/archive"))).toBe(false);
    });

    test("disables downloading while saving, and shows busy feedback during the archive request", async () =>
    {
        saveSettings({ paths: PATHS, gameId: "unbound" });
        const user = userEvent.setup();
        const download = mockDownload();
        let finishSave;
        let finishDownload;
        mockServer({
            [SAVE_ROUTE]: () => new Promise((resolve) => { finishSave = resolve; }),
            [ARCHIVE_ROUTE]: () => new Promise((resolve) => { finishDownload = resolve; }),
        });
        render(<App />);
        await screen.findByRole("button", { name: "Unbound menu" });
        await changeSpread(user);
        await user.click(screen.getByRole("button", { name: /^Save Changes/ }));
        await waitFor(() => expect(finishSave).toBeTypeOf("function"));
        await user.click(screen.getByRole("button", { name: "Unbound menu" }));
        expect(screen.getByRole("menuitem", { name: DOWNLOAD_LABEL })).toHaveAttribute("aria-disabled", "true");
        fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
        finishSave({ spreads: createSpreads("revision-2"), createdIds: {} });
        await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
        await waitFor(() => expect(screen.queryByRole("button", { name: /^Save Changes/ })).not.toBeInTheDocument());
        await chooseDownload(user);
        const dialog = await screen.findByRole("dialog", { name: DOWNLOAD_LABEL });
        await waitFor(() => expect(finishDownload).toBeTypeOf("function"));
        expect(within(dialog).getByRole("status")).toHaveTextContent("Preparing download... 0%");
        expect(within(dialog).getByRole("button", { name: "Close" })).toBeDisabled();
        finishDownload(new Blob(["ZIP"]));
        await waitFor(() => expect(download.create).toHaveBeenCalledOnce());
        expect(within(dialog).getByRole("button", { name: "Close" })).toBeEnabled();
    });

    test("first launch requires all three repositories, then a game", async () =>
    {
        const user = userEvent.setup();
        const calls = mockServer();
        render(<App />);

        const dialog = await screen.findByRole("dialog", { name: SETUP_TITLE });
        const loadButton = within(dialog).getByRole("button", { name: "Load" });
        expect(loadButton).toBeDisabled();
        const asterisks = dialog.querySelectorAll("label .MuiFormLabel-asterisk");
        expect(asterisks).toHaveLength(3);
        for (const asterisk of asterisks)
            expect(asterisk).toHaveStyle({ color: APP_THEME.palette.error.main });
        expect(calls).toHaveLength(0);

        await enterPaths(user, dialog);
        await user.type(within(dialog).getByLabelText(LABELS.cloud), "  ");
        expect(loadButton).toBeEnabled();
        await user.click(loadButton);

        const gameDialog = await screen.findByRole("dialog", { name: GAME_TITLE });
        expect(calls.find((call) => call.route === "/workspaces/load").body).toEqual({ paths: PATHS });
        expect(calls.find((call) => call.route === "/workspaces/load").token).toBe("token-1");
        expect(within(gameDialog).queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();

        await user.click(within(gameDialog).getByRole("button", { name: "Unbound" }));

        expect(await screen.findByRole("button", { name: "Unbound menu" })).toBeInTheDocument();
        expect(screen.queryByText(`${FIRST_SET_COUNT} of ${SPREAD_COUNT} spreads match`)).not.toBeInTheDocument();
        expect(screen.getAllByRole("article")).toHaveLength(FIRST_SET_COUNT);
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(getSavedSettings()).toEqual({ version: SETTINGS_VERSION, paths: PATHS, gameId: "unbound" });
    });

    test("returning launch revalidates saved repositories and reopens the saved game", async () =>
    {
        saveSettings({ paths: PATHS, gameId: "unbound" });
        const calls = mockServer();
        render(<App />);

        expect(await screen.findByRole("button", { name: "Unbound menu" })).toBeInTheDocument();
        expect(calls.map((call) => call.route)).toEqual(["/session", "/workspaces/load", "/workspaces/workspace-1/catalog"]);
        expect(calls[2].body).toEqual({ gameId: "unbound" });
    });

    test("shows warnings about the game's catalog", async () =>
    {
        saveSettings({ paths: PATHS, gameId: "unbound" });
        mockServer({ [CATALOG_ROUTE]: (body) => createCatalog(body.gameId, [{ severity: "warning", code: "MOVE_DETAILS_MISSING", message: CATALOG_WARNING }]) });
        render(<App />);

        const user = userEvent.setup();
        await user.click(await screen.findByRole("button", { name: "Unbound menu" }));
        await user.click(screen.getByRole("menuitem", { name: "View Load Warnings" }));
        const dialog = await screen.findByRole("dialog", { name: "Load Warnings" });
        expect(within(dialog).queryByText(CATALOG_WARNING)).not.toBeVisible();
        await user.click(within(dialog).getByRole("button", { name: /MOVE DETAILS MISSING \(1\)/ }));
        expect(within(dialog).getByText(CATALOG_WARNING)).toBeVisible();
    });

    test("groups mismatches by source and category with each change on a separate line", async () =>
    {
        saveSettings({ paths: PATHS, gameId: "unbound" });
        mockServer({ [CATALOG_ROUTE]: (body) => createCatalog(body.gameId,
        [
            { severity: "warning", repository: "cfru", file: "src/Tables/battle_moves.c", code: "MOVE_DATA_MISMATCH", message: "2 differences", details: ["MOVE_FLY (pp 15 in CFRU, 10 in Cloud)", "MOVE_FLY (type TYPE_FLYING in CFRU, TYPE_NORMAL in Cloud)"] },
            { severity: "warning", repository: "cfru", file: "src/Tables/battle_moves.c", code: "MOVE_DATA_MISMATCH", message: "Another difference", details: ["MOVE_POUND (pp 35 in CFRU, 30 in Cloud)"] },
            { severity: "warning", repository: "cloud", code: "CATALOG_FILE_MISSING", message: "File missing" },
        ]) });
        render(<App />);

        const user = userEvent.setup();
        await user.click(await screen.findByRole("button", { name: "Unbound menu" }));
        await user.click(screen.getByRole("menuitem", { name: "View Load Warnings" }));
        const dialog = await screen.findByRole("dialog", { name: "Load Warnings" });
        expect(within(dialog).queryByText("MOVE_FLY (pp 15 in CFRU, 10 in Cloud)")).not.toBeVisible();
        await user.click(within(dialog).getByRole("button", { name: /MOVE DATA MISMATCH \(3\)/ }));
        expect(within(dialog).getAllByRole("listitem")).toHaveLength(3);
        expect(within(dialog).getByText("MOVE_FLY (pp 15 in CFRU, 10 in Cloud)")).toBeVisible();
        expect(within(dialog).getByText("MOVE_FLY (type TYPE_FLYING in CFRU, TYPE_NORMAL in Cloud)")).toBeVisible();
        expect(within(dialog).getByText("MOVE_POUND (pp 35 in CFRU, 30 in Cloud)")).toBeVisible();
        expect(within(dialog).queryByText("2 differences")).not.toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: /MOVE DATA MISMATCH \(3\)/ }));
        expect(within(dialog).queryByText("MOVE_FLY (pp 15 in CFRU, 10 in Cloud)")).not.toBeVisible();
        await user.click(within(dialog).getByRole("button", { name: /CATALOG FILE MISSING \(1\)/ }));
        expect(within(dialog).getByText("File missing").closest("li")).toBeVisible();
    });

    test("explains when a workspace response lacks spreads", async () =>
    {
        saveSettings({ paths: PATHS, gameId: "unbound" });
        mockServer({ "/workspaces/load": () =>
        {
            const { spreads, ...workspace } = createWorkspace();
            return workspace;
        } });
        render(<App />);

        expect(await screen.findByRole("button", { name: "Unbound menu" })).toBeInTheDocument();
        expect(screen.getByText("The repositories did not provide any spreads.")).toBeInTheDocument();
        expect(screen.queryByRole("article")).not.toBeInTheDocument();
    });

    test("returning launch asks for a new game when the saved one is gone", async () =>
    {
        saveSettings({ paths: PATHS, gameId: "removed_game" });
        mockServer();
        render(<App />);

        const gameDialog = await screen.findByRole("dialog", { name: GAME_TITLE });
        expect(within(gameDialog).getByText(/previously selected game is no longer available/)).toBeInTheDocument();
        expect(getSavedSettings().gameId).toBe("");
    });

    test("returning launch with a moved repository keeps the entered values for correction", async () =>
    {
        const user = userEvent.setup();
        saveSettings({ paths: PATHS, gameId: "cfru" });
        let rejectLoad = true;
        mockServer(
        {
            "/workspaces/load": () =>
            {
                if (!rejectLoad)
                    return createWorkspace();

                throw apiError(StatusCode.ClientErrorUnprocessableEntity, "REPOSITORY_VALIDATION_FAILED", "Some repository folders need to be corrected.",
                    { fields: { cfru: { code: "REPOSITORY_NOT_FOUND", message: "This folder does not exist." } } });
            },
        });
        render(<App />);

        const dialog = await screen.findByRole("dialog", { name: SETUP_TITLE });
        const cfruField = within(dialog).getByLabelText(LABELS.cfru);
        expect(cfruField).toHaveValue(PATHS.cfru);
        expect(cfruField).toHaveAttribute("aria-invalid", "true");
        expect(within(dialog).getByText("This folder does not exist.")).toBeInTheDocument();
        expect(within(dialog).getByLabelText(LABELS.dpe)).toHaveValue(PATHS.dpe);

        await user.type(cfruField, "2");
        expect(cfruField).toHaveAttribute("aria-invalid", "false");

        rejectLoad = false;
        await user.click(within(dialog).getByRole("button", { name: "Load" }));
        expect(await screen.findByRole("button", { name: "Official Games menu" })).toBeInTheDocument();
        expect(getSavedSettings().paths.cfru).toBe(`${PATHS.cfru}2`);
    });

    test.each(
    [
        ["malformed", "{not json"],
        ["outdated", JSON.stringify({ version: SETTINGS_VERSION + 1, paths: PATHS })],
        ["wrongly typed", JSON.stringify({ version: SETTINGS_VERSION, paths: { cfru: 5, dpe: null }, gameId: 7 })],
    ])("ignores %s saved settings", async (name, rawSettings) =>
    {
        localStorage.setItem(SETTINGS_STORAGE_KEY, rawSettings);
        const calls = mockServer();
        render(<App />);

        const dialog = await screen.findByRole("dialog", { name: SETUP_TITLE });
        expect(within(dialog).getByLabelText(LABELS.cfru)).toHaveValue("");
        expect(calls).toHaveLength(0);
    });

    test("works when the browser blocks storage", async () =>
    {
        const user = userEvent.setup();
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
        mockServer();
        render(<App />);

        const dialog = await screen.findByRole("dialog", { name: SETUP_TITLE });
        await enterPaths(user, dialog);
        await user.click(within(dialog).getByRole("button", { name: "Load" }));
        await user.click(await screen.findByRole("button", { name: "Official Games" }));

        expect(await screen.findByRole("button", { name: "Official Games menu" })).toBeInTheDocument();
        expect(screen.getByText(/blocked saving settings/)).toBeInTheDocument();
    });

    test("browse fills a path from the folder dialog and ignores cancellation", async () =>
    {
        const user = userEvent.setup();
        let pickResult = { status: "selected", path: "D:\\Picked\\Código DPE" };
        const calls = mockServer({ "/repositories/pick": () => pickResult });
        render(<App />);

        const dialog = await screen.findByRole("dialog", { name: SETUP_TITLE });
        const dpeField = within(dialog).getByLabelText(LABELS.dpe);
        await user.click(within(dialog).getByRole("button", { name: /Browse for Dynamic Pokemon Expansion/ }));
        await waitFor(() => expect(dpeField).toHaveValue("D:\\Picked\\Código DPE"));
        expect(calls.find((call) => call.route === "/repositories/pick").body).toEqual({ repository: "dpe", startPath: undefined });

        pickResult = { status: "cancelled" };
        await user.click(within(dialog).getByRole("button", { name: /Browse for Dynamic Pokemon Expansion/ }));
        await waitFor(() => expect(calls.filter((call) => call.route === "/repositories/pick")).toHaveLength(2));
        expect(calls.at(-1).body.startPath).toBe("D:\\Picked\\Código DPE");
        expect(dpeField).toHaveValue("D:\\Picked\\Código DPE");
        expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
    });

    test("browse shows picker errors so the path can be typed instead", async () =>
    {
        const user = userEvent.setup();
        mockServer({ "/repositories/pick": () => { throw apiError(StatusCode.ServerErrorNotImplemented, "PICKER_UNSUPPORTED", "Folder browsing is only available on Windows. Type the folder path instead."); } });
        render(<App />);

        const dialog = await screen.findByRole("dialog", { name: SETUP_TITLE });
        await user.click(within(dialog).getByRole("button", { name: /Browse for Unbound Cloud/ }));
        expect(await within(dialog).findByText(/Type the folder path instead/)).toBeInTheDocument();
        expect(within(dialog).getByLabelText(LABELS.cloud)).toBeEnabled();
    });

    test("recovers transparently when the server restarts", async () =>
    {
        saveSettings({ paths: PATHS, gameId: "cfru" });
        let restarted = false;
        const calls = mockServer(
        {
            "/session": () => ({ token: restarted ? "token-2" : "token-1" }),
            "/workspaces/load": (body, token) =>
            {
                if (restarted && token !== "token-2")
                    throw apiError(StatusCode.ClientErrorUnauthorized, "SESSION_INVALID", "Expired");
                return createWorkspace(restarted ? "workspace-2" : "workspace-1");
            },
            [CATALOG_ROUTE]: (body) =>
            {
                if (!restarted)
                {
                    restarted = true;
                    throw apiError(StatusCode.ClientErrorNotFound, "WORKSPACE_NOT_FOUND", "The repositories need to be loaded again.");
                }
                return createCatalog(body.gameId);
            },
        });
        render(<App />);

        expect(await screen.findByRole("button", { name: "Official Games menu" })).toBeInTheDocument();
        expect(calls.map((call) => call.route)).toEqual(
        [
            "/session",
            "/workspaces/load",
            "/workspaces/workspace-1/catalog",
            "/workspaces/load",
            "/session",
            "/workspaces/load",
            "/workspaces/workspace-2/catalog",
        ]);
        expect(calls.at(-1).token).toBe("token-2");
    });

    test("explains when the local server is not running", async () =>
    {
        const user = userEvent.setup();
        axios.post.mockRejectedValue({ request: {} });
        render(<App />);

        const dialog = await screen.findByRole("dialog", { name: SETUP_TITLE });
        await enterPaths(user, dialog);
        await user.click(within(dialog).getByRole("button", { name: "Load" }));

        expect(await within(dialog).findByText(/Could not reach the local editor server/)).toBeInTheDocument();
        expect(within(dialog).getByLabelText(LABELS.cfru)).toHaveValue(PATHS.cfru);
    });

    test("change game and change repositories can be cancelled", async () =>
    {
        const user = userEvent.setup();
        saveSettings({ paths: PATHS, gameId: "unbound" });
        const calls = mockServer();
        render(<App />);
        await screen.findByRole("button", { name: "Unbound menu" });

        await user.click(screen.getByRole("button", { name: "Unbound menu" }));
        await user.click(screen.getByRole("menuitem", { name: "Change Game" }));
        const gameDialog = await screen.findByRole("dialog", { name: GAME_TITLE });
        expect(within(gameDialog).getByRole("button", { name: "Unbound" })).toHaveClass("Mui-selected");
        await user.click(within(gameDialog).getByRole("button", { name: "Cancel" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

        await user.click(screen.getByRole("button", { name: "Unbound menu" }));
        await user.click(screen.getByRole("menuitem", { name: "Change Repositories" }));
        const setupDialog = await screen.findByRole("dialog", { name: SETUP_TITLE });
        await user.type(within(setupDialog).getByLabelText(LABELS.dpe), "-edited");
        await user.click(within(setupDialog).getByRole("button", { name: "Cancel" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        expect(screen.getByRole("button", { name: "Unbound menu" })).toBeInTheDocument();
        expect(calls.filter((call) => call.route === "/workspaces/load")).toHaveLength(1);

        await user.click(screen.getByRole("button", { name: "Unbound menu" }));
        await user.click(screen.getByRole("menuitem", { name: "Change Game" }));
        await user.click(within(await screen.findByRole("dialog", { name: GAME_TITLE })).getByRole("button", { name: "Official Games" }));
        expect(await screen.findByRole("button", { name: "Official Games menu" })).toBeInTheDocument();
        expect(getSavedSettings().gameId).toBe("cfru");
    });
});
