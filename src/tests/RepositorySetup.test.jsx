import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios from "axios";
import { StatusCode } from "status-code-enum";
import { vi } from "vitest";

import App from "../App";
import { SETTINGS_STORAGE_KEY, SETTINGS_VERSION } from "../SpreadEditorState";
import { APP_THEME } from "../Theme";

vi.mock("axios", () => ({ default: { post: vi.fn() } }));

const PATHS = { cfru: "C:\\Code\\CFRU", dpe: "C:\\Code\\DPE", cloud: "C:\\Code\\Cloud" };
const LABELS = { cfru: /^Complete Fire Red Upgrade/, dpe: /^Dynamic Pokemon Expansion/, cloud: /^Unbound Cloud/ };
const GAMES = [{ id: "cfru", name: "Official Games" }, { id: "unbound", name: "Unbound" }];
const CATALOG_ROUTE = "/workspaces/:id/catalog";
const SETUP_TITLE = "Connect Repositories";
const GAME_TITLE = "Choose Game";
const SPREAD_SET_COUNT = 7;
const SPREAD_COUNT = 56;
const LEARNSET_COUNT = 9;
const CATALOG_WARNING = "69 moves in this game are not in CFRU's src/Tables/battle_moves.c.";


/**
 * Returns a catalog like the server's, without the per-species data the summary does not use.
 *
 * @param {string} gameId The game ID.
 * @param {Array<object>} [diagnostics] The catalog diagnostics.
 * @returns {object} The catalog.
 */
function createCatalog(gameId, diagnostics = [])
{
    return {
        gameId,
        name: GAMES.find((game) => game.id === gameId).name,
        entryCounts: { baseStats: 12, moves: 34, items: 5, ballTypes: 2, learnsets: LEARNSET_COUNT },
        diagnostics,
    };
}

/**
 * Returns a workspace snapshot like the server's.
 *
 * @param {string} workspaceId The workspace ID.
 * @returns {object} The workspace.
 */
function createWorkspace(workspaceId = "workspace-1")
{
    return {
        workspaceId,
        repositories: Object.fromEntries(Object.entries(PATHS).map(([kind, path]) => [kind, { path, label: `${kind} label` }])),
        games: GAMES,
        diagnostics: [],
        spreads:
        {
            revision: "revision-1",
            sets: Array.from({ length: SPREAD_SET_COUNT }, (_, index) => ({ id: `set-${index}` })),
            entries: Array.from({ length: SPREAD_COUNT }, (_, index) => ({ id: `entry-${index}` })),
            trainers: [],
        },
    };
}

/**
 * Creates an axios-style error response.
 *
 * @param {number} status The HTTP status.
 * @param {string} code The error code.
 * @param {string} message The error message.
 * @param {object} [details] The error details.
 * @returns {object} The error.
 */
function apiError(status, code, message, details)
{
    return { response: { status, data: { error: { code, message, details } } } };
}

/**
 * Routes mocked axios requests to handlers, recording each call.
 *
 * @param {Object<string, Function>} [overrides] Handlers replacing the defaults.
 * @returns {Array<{route: string, body: object, token: string}>} The recorded calls.
 */
function mockServer(overrides = {})
{
    const calls = [];
    const handlers =
    {
        "/session": () => ({ token: "token-1" }),
        "/workspaces/load": () => createWorkspace(),
        [CATALOG_ROUTE]: (body) => createCatalog(body.gameId),
        "/repositories/pick": () => ({ status: "cancelled" }),
        ...overrides,
    };

    axios.post.mockImplementation(async (url, body, options) =>
    {
        const route = url.replace(/^.*\/api/, "");
        const handlerRoute = /^\/workspaces\/[^/]+\/catalog$/.test(route) ? CATALOG_ROUTE : route;
        const token = options?.headers?.["X-Session-Token"];
        calls.push({ route, body, token });
        return { data: await handlers[handlerRoute](body, token) };
    });

    return calls;
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
    beforeEach(() =>
    {
        localStorage.clear();
        axios.post.mockReset();
    });

    afterEach(() =>
    {
        vi.restoreAllMocks();
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

        expect(await screen.findByRole("heading", { name: "Unbound" })).toBeInTheDocument();
        expect(screen.getByText(PATHS.cfru)).toBeInTheDocument();
        expect(screen.getByText("12")).toBeInTheDocument();
        expect(screen.getByText("Learnsets").nextElementSibling).toHaveTextContent(String(LEARNSET_COUNT));
        expect(screen.getByText("Spread Sets").nextElementSibling).toHaveTextContent(String(SPREAD_SET_COUNT));
        expect(screen.getByText("Spreads").nextElementSibling).toHaveTextContent(String(SPREAD_COUNT));
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(getSavedSettings()).toEqual({ version: SETTINGS_VERSION, paths: PATHS, gameId: "unbound" });
    });

    test("returning launch revalidates saved repositories and reopens the saved game", async () =>
    {
        saveSettings({ paths: PATHS, gameId: "unbound" });
        const calls = mockServer();
        render(<App />);

        expect(await screen.findByRole("heading", { name: "Unbound" })).toBeInTheDocument();
        expect(calls.map((call) => call.route)).toEqual(["/session", "/workspaces/load", "/workspaces/workspace-1/catalog"]);
        expect(calls[2].body).toEqual({ gameId: "unbound" });
    });

    test("shows warnings about the game's catalog", async () =>
    {
        saveSettings({ paths: PATHS, gameId: "unbound" });
        mockServer({ [CATALOG_ROUTE]: (body) => createCatalog(body.gameId, [{ severity: "warning", code: "MOVE_DETAILS_MISSING", message: CATALOG_WARNING }]) });
        render(<App />);

        expect(await screen.findByText(CATALOG_WARNING)).toBeInTheDocument();
    });

    test("does not render spread counts when a workspace response lacks spreads", async () =>
    {
        saveSettings({ paths: PATHS, gameId: "unbound" });
        mockServer({ "/workspaces/load": () =>
        {
            const { spreads, ...workspace } = createWorkspace();
            return workspace;
        } });
        render(<App />);

        expect(await screen.findByRole("heading", { name: "Unbound" })).toBeInTheDocument();
        expect(screen.queryByText("Spread Sets")).not.toBeInTheDocument();
        expect(screen.queryByText("Spreads")).not.toBeInTheDocument();
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
        expect(await screen.findByRole("heading", { name: "Official Games" })).toBeInTheDocument();
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

        expect(await screen.findByRole("heading", { name: "Official Games" })).toBeInTheDocument();
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

        expect(await screen.findByRole("heading", { name: "Official Games" })).toBeInTheDocument();
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
        await screen.findByRole("heading", { name: "Unbound" });

        await user.click(screen.getByRole("button", { name: "Change Game" }));
        const gameDialog = await screen.findByRole("dialog", { name: GAME_TITLE });
        expect(within(gameDialog).getByRole("button", { name: "Unbound" })).toHaveClass("Mui-selected");
        await user.click(within(gameDialog).getByRole("button", { name: "Cancel" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

        await user.click(screen.getByRole("button", { name: "Change Repositories" }));
        const setupDialog = await screen.findByRole("dialog", { name: SETUP_TITLE });
        await user.type(within(setupDialog).getByLabelText(LABELS.dpe), "-edited");
        await user.click(within(setupDialog).getByRole("button", { name: "Cancel" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        expect(screen.getByRole("heading", { name: "Unbound" })).toBeInTheDocument();
        expect(calls.filter((call) => call.route === "/workspaces/load")).toHaveLength(1);

        await user.click(screen.getByRole("button", { name: "Change Game" }));
        await user.click(within(await screen.findByRole("dialog", { name: GAME_TITLE })).getByRole("button", { name: "Official Games" }));
        expect(await screen.findByRole("heading", { name: "Official Games" })).toBeInTheDocument();
        expect(getSavedSettings().gameId).toBe("cfru");
    });
});
