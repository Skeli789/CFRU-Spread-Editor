import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios from "axios";
import { StatusCode } from "status-code-enum";
import { vi } from "vitest";

import { getHiddenPowerType } from "../../shared/pokemon-mechanics.mjs";
import App from "../App";
import { AutoFixDialog } from "../components/SpreadDialogs";
import { LIST_PAGE_SIZE } from "../subcomponents/CatalogDisplay";
import { DRAFTS_STORAGE_KEY, EDITOR_PHASE, SETTINGS_STORAGE_KEY, SETTINGS_VERSION, SpreadEditorProvider, useSpreadEditor } from "../SpreadEditorState";
import { CATALOG_ROUTE, PATHS, SAVE_ROUTE, apiError, createCatalog, createFields, createSpreads, createWorkspace, mockServer } from "./EditorFixtures";

vi.mock("axios", () => ({ default: { post: vi.fn() } }));

const SAVE_BUTTON = /^Save Changes/;
const UNSAVED_TITLE = "Unsaved Changes";
const GAME_TITLE = "Choose Game";
const AUTO_FIX_BATCH_TOTAL = LIST_PAGE_SIZE * 2 + 1;
const SCROLL_CLIENT_HEIGHT = 200;
const SCROLL_HEIGHT = 1000;
const PROGRESS_POLL_INTERVAL = 250;


/**
 * Opens the editor with saved repositories and game.
 *
 * @param {Object<string, Function>} [overrides] Server handlers replacing the defaults.
 * @returns {Promise<{user: object, calls: Array<object>}>} The user-event instance and recorded server calls.
 */
async function openEditor(overrides = {})
{
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ version: SETTINGS_VERSION, paths: PATHS, gameId: "unbound" }));
    const calls = mockServer(overrides);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: "Unbound menu" });
    return { user, calls };
}

/**
 * Returns a spread's card.
 *
 * @param {string} name The species name.
 * @param {number} [index] Which of that species' cards.
 * @returns {HTMLElement} The card.
 */
function getCard(name, index = 0)
{
    return screen.getAllByRole("article", { name: `${name} spread` })[index];
}

/**
 * Opens the spread editor and returns its editable card.
 *
 * @param {object} user The user-event instance.
 * @param {string} name The species name.
 * @param {number} [index] Which card of that species.
 * @returns {Promise<HTMLElement>} The editable card.
 */
async function editCard(user, name, index = 0)
{
    await user.click(within(getCard(name, index)).getByRole("heading", { name }));
    return within(screen.getByRole("dialog", { name: `Edit ${name}` })).getByRole("article", { name: `${name} spread` });
}

/**
 * Closes the ordinary edit dialog through one of its shared close paths.
 *
 * @param {object} user The user-event instance.
 * @param {string} method Done, Escape or backdrop.
 * @returns {Promise<void>} Resolves once the dialog has closed.
 */
async function closeEditDialog(user, method)
{
    const dialog = screen.getByRole("dialog", { name: "Edit Charizard" });
    if (method === "Done")
        await user.click(within(dialog).getByRole("button", { name: "Done" }));
    else if (method === "Escape")
        await user.keyboard("{Escape}");
    else
        await user.click(dialog.parentElement);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit Charizard" })).not.toBeInTheDocument());
}

/**
 * Returns a select's accessible name pattern, which also includes its chosen value.
 *
 * @param {string} label The select's label.
 * @returns {RegExp} The pattern.
 */
function selectName(label)
{
    return new RegExp(`^${label}`);
}

/**
 * Chooses an option from a select in a card.
 *
 * @param {object} user The user-event instance.
 * @param {HTMLElement} card The card.
 * @param {string} label The select's label.
 * @param {string} option The option to choose.
 */
async function choose(user, card, label, option)
{
    await user.click(within(card).getByRole("combobox", { name: selectName(label) }));
    await user.click(await screen.findByRole("option", { name: option }));
}

/**
 * Makes an unsaved change to the first Charizard, lowering its Attack IV to 0.
 *
 * @param {object} user The user-event instance.
 */
async function changeCharizard(user)
{
    const card = await editCard(user, "Charizard");
    const field = within(card).getByLabelText("Charizard Attack IV");
    await user.clear(field);
    await user.type(field, "0");
    await user.click(within(screen.getByRole("dialog", { name: "Edit Charizard" })).getByRole("button", { name: "Done" }));
}

/**
 * Opens the filters and clears the spread set filter, which starts on the first set.
 *
 * @param {object} user The user-event instance.
 */
async function showAllSets(user)
{
    await user.click(screen.getByRole("button", { name: "More Filters" }));
    // The clear button only shows while the field is hovered or focused
    const field = screen.getByRole("combobox", { name: "Spread Set" });
    await user.click(field.closest(".MuiAutocomplete-root").querySelector(".MuiAutocomplete-clearIndicator"));
}

/**
 * Returns the names of the spread set sections shown.
 *
 * @returns {Array<string>} The section names.
 */
function getSectionNames()
{
    return screen.getAllByRole("region").filter((section) => section.classList.contains("spread-section")).map((section) => section.getAttribute("aria-label"));
}

/**
 * Returns the base stat shown for a stat in a card.
 *
 * @param {HTMLElement} card The card.
 * @param {string} stat The stat's label.
 * @returns {string} The base stat.
 */
function getBaseStat(card, stat)
{
    return within(card).getByText(stat, { selector: ".stat-label" }).closest("tr").querySelector("td").textContent;
}

/**
 * Scrolls a list to its bottom using explicit dimensions because jsdom does not lay out CSS.
 *
 * @param {HTMLElement} list The scrolling list.
 * @returns {void} Dispatches the scroll event.
 */
function scrollPreviewToBottom(list)
{
    Object.defineProperties(list,
    {
        clientHeight: { configurable: true, value: SCROLL_CLIENT_HEIGHT },
        scrollHeight: { configurable: true, value: SCROLL_HEIGHT },
    });
    fireEvent.scroll(list, { target: { scrollTop: SCROLL_HEIGHT - SCROLL_CLIENT_HEIGHT } });
}

/**
 * Opens the provider without dialog rendering so request lifecycle tests stay isolated.
 *
 * @param {object} overrides Mock server handlers.
 * @returns {Promise<object>} Live editor access, recorded requests and unmount cleanup.
 */
async function openProgressEditor(overrides)
{
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ version: SETTINGS_VERSION, paths: PATHS, gameId: "unbound" }));
    const calls = mockServer(overrides);
    let editor;

    /**
     * Captures the latest provider value.
     *
     * @returns {null} No rendered content.
     */
    function Probe()
    {
        editor = useSpreadEditor();
        return null;
    }
    const { unmount } = render(<SpreadEditorProvider><Probe /></SpreadEditorProvider>);
    await waitFor(() => expect(editor.state.phase).toBe(EDITOR_PHASE.READY));
    return { getEditor: () => editor, calls, unmount };
}

/**
 * Creates a controllable server response.
 *
 * @returns {object} The promise and its resolve/reject functions.
 */
function deferredResponse()
{
    let resolve;
    let reject;
    const promise = new Promise((onResolve, onReject) =>
    {
        resolve = onResolve;
        reject = onReject;
    });
    return { promise, resolve, reject };
}

describe("Smogon request progress", () =>
{
    beforeEach(() =>
    {
        localStorage.clear();
        axios.post.mockReset();
    });

    afterEach(() =>
    {
        cleanup();
        vi.useRealTimers();
    });

    test("emits immediate and real polled progress without resetting the loaded editor", async () =>
    {
        const response = deferredResponse();
        const percentages = [33, 10, 100];
        const { getEditor, calls } = await openProgressEditor(
        {
            "/smogon/sets": () => response.promise,
            "/progress/:id": () => ({ percentage: percentages.shift(), label: "Reading Required Files" }),
        });
        const initial = getEditor().state;
        const onProgress = vi.fn();
        vi.useFakeTimers();
        let pending;
        await act(async () => { pending = getEditor().loadSmogonSets(["Charmander"], onProgress); });
        expect(onProgress).toHaveBeenCalledWith({ percentage: 0, label: "Loading Smogon Sets..." });
        expect(calls.filter((call) => call.route.startsWith("/progress/"))).toHaveLength(0);
        for (let poll = 0; poll < 3; poll++)
            await act(async () => { await vi.advanceTimersByTimeAsync(PROGRESS_POLL_INTERVAL); });
        expect(onProgress.mock.calls.map(([event]) => event.percentage)).toEqual([0, 33, 99]);
        const request = calls.find((call) => call.route === "/smogon/sets");
        expect(request.body).toEqual({ species: ["Charmander"] });
        expect(request.params.progressId).toMatch(/^[a-f0-9-]{36}$/);
        expect(calls.filter((call) => call.route.startsWith("/progress/")).every((call) => call.route.endsWith(request.params.progressId))).toBe(true);
        const result = { formats: [], sets: [], stale: false, unavailable: [] };
        await act(async () =>
        {
            response.resolve(result);
            expect(await pending).toBe(result);
        });
        expect(onProgress).toHaveBeenLastCalledWith({ percentage: 100, label: "Complete" });
        expect(getEditor().state.workspace).toBe(initial.workspace);
        expect(getEditor().state.catalog).toBe(initial.catalog);
        expect(getEditor().state.setupProgress).toBe(initial.setupProgress);
        expect(getEditor().state.phase).toBe(EDITOR_PHASE.READY);
        const count = calls.length;
        await act(async () => { await vi.advanceTimersByTimeAsync(PROGRESS_POLL_INTERVAL * 3); });
        expect(calls).toHaveLength(count);
    });

    test.each([false, true])("keeps unavailable polling optional and cleans up when failed=%s", async (failed) =>
    {
        const response = deferredResponse();
        const { getEditor, calls } = await openProgressEditor(
        {
            "/smogon/sets": () => response.promise,
            "/progress/:id": () => { throw apiError(404, "PROGRESS_NOT_FOUND", "Unavailable"); },
        });
        const onProgress = vi.fn();
        vi.useFakeTimers();
        let pending;
        await act(async () => { pending = getEditor().loadSmogonSets(["Charmander"], onProgress).catch((error) => error); });
        await act(async () => { await vi.advanceTimersByTimeAsync(PROGRESS_POLL_INTERVAL); });
        expect(onProgress).toHaveBeenCalledTimes(1);
        await act(async () =>
        {
            if (failed)
                response.reject(apiError(503, "SMOGON_UNAVAILABLE", "Offline"));
            else
                response.resolve({ sets: [] });
            const result = await pending;
            expect(result).toEqual(failed ? { status: 503, code: "SMOGON_UNAVAILABLE", message: "Offline", details: undefined } : { sets: [] });
        });
        expect(onProgress).toHaveBeenLastCalledWith({ percentage: failed ? 0 : 100, label: failed ? "Operation Failed" : "Complete" });
        const count = calls.length;
        await act(async () => { await vi.advanceTimersByTimeAsync(PROGRESS_POLL_INTERVAL * 3); });
        expect(calls).toHaveLength(count);
    });

    test("aborts in-flight polling and ignores late results after provider unmount", async () =>
    {
        const response = deferredResponse();
        const poll = deferredResponse();
        const { getEditor, calls, unmount } = await openProgressEditor(
        {
            "/smogon/sets": () => response.promise,
            "/progress/:id": () => poll.promise,
        });
        const onProgress = vi.fn();
        vi.useFakeTimers();
        let pending;
        await act(async () => { pending = getEditor().loadSmogonSets(["Charmander"], onProgress).catch((error) => error); });
        await act(async () => { await vi.advanceTimersByTimeAsync(PROGRESS_POLL_INTERVAL); });
        const request = calls.find((call) => call.route.startsWith("/progress/"));
        unmount();
        expect(request.options.signal.aborted).toBe(true);
        await act(async () =>
        {
            poll.resolve({ percentage: 66, label: "Reading Required Files" });
            response.resolve({ sets: [] });
            expect(await pending).toEqual({ code: "OPERATION_CANCELLED" });
            await vi.advanceTimersByTimeAsync(PROGRESS_POLL_INTERVAL * 3);
        });
        expect(onProgress).toHaveBeenCalledTimes(1);
        expect(calls.filter((call) => call.route.startsWith("/progress/"))).toHaveLength(1);
    });

    test("supersedes earlier Smogon loads and suppresses their late callbacks", async () =>
    {
        const first = deferredResponse();
        const second = deferredResponse();
        const { getEditor, calls } = await openProgressEditor({ "/smogon/sets": (body) => body.species[0] === "Charmander" ? first.promise : second.promise });
        const firstProgress = vi.fn();
        const secondProgress = vi.fn();
        let earlier;
        let later;
        await act(async () =>
        {
            earlier = getEditor().loadSmogonSets(["Charmander"], firstProgress).catch((error) => error);
            later = getEditor().loadSmogonSets(["Charizard"], secondProgress);
        });
        await act(async () =>
        {
            first.resolve({ sets: ["old"] });
            second.resolve({ sets: ["new"] });
            expect(await earlier).toEqual({ code: "OPERATION_CANCELLED" });
            expect(await later).toEqual({ sets: ["new"] });
        });
        expect(firstProgress).toHaveBeenCalledTimes(1);
        expect(secondProgress).toHaveBeenLastCalledWith({ percentage: 100, label: "Complete" });
        const requests = calls.filter((call) => call.route === "/smogon/sets");
        expect(requests[0].params.progressId).not.toBe(requests[1].params.progressId);
    });

    test("supports existing callers and ignores exceptions from optional observers", async () =>
    {
        const { getEditor } = await openProgressEditor({ "/smogon/sets": () => ({ sets: [] }) });
        await act(async () =>
        {
            expect(await getEditor().loadSmogonSets(["Charmander"])).toEqual({ sets: [] });
            expect(await getEditor().loadSmogonSets(["Charmander"], () => { throw new Error("Observer closed"); })).toEqual({ sets: [] });
        });
        expect(getEditor().state.smogonProgress).toEqual({ percentage: 100, label: "Complete" });
    });
});

describe("Spread editor", () =>
{
    beforeEach(() =>
    {
        localStorage.clear();
        axios.post.mockReset();
    });

    test("shows the first spread set in its own section, read-only until edited", async () =>
    {
        const { user } = await openEditor();

        expect(screen.getByRole("region", { name: "Frontier Spreads spreads" })).toBeInTheDocument();
        expect(screen.getAllByRole("article").map((card) => card.getAttribute("aria-label"))).toEqual(["Charizard spread", "Charizard spread", "Venusaur spread"]);
        expect(screen.queryByText("3 of 6 spreads match")).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "More Filters" })).toHaveAttribute("aria-expanded", "false");
        expect(within(getCard("Charizard")).getByText("Heavy-Duty Boots")).toBeInTheDocument();
        expect(getCard("Charizard").querySelector(".side-ability")).toHaveTextContent("[1]Blaze");
        expect(within(getCard("Charizard")).queryByText("gFrontierSpreads")).not.toBeInTheDocument();
        expect(getCard("Charizard", 1).querySelector(".side-mega-ability")).toHaveTextContent("[M]Tough Claws");
        expect(within(getCard("Charizard", 1)).getByText("Fly").closest(".move-slot")).toHaveClass("move-status-illegal");
        expect(screen.queryByLabelText("Charizard Attack EVs")).not.toBeInTheDocument();

        await user.click(within(getCard("Charizard")).getByText("Heavy-Duty Boots"));
        expect(within(screen.getByRole("dialog", { name: "Edit Charizard" })).getByLabelText("Charizard Attack EVs")).toBeInTheDocument();
        expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Done" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: SAVE_BUTTON })).not.toBeInTheDocument();
    });

    test("keeps a single draft through Done and Escape while the grid card stays read-only", async () =>
    {
        const { user } = await openEditor();
        const card = await editCard(user, "Charizard");
        await user.click(within(card).getByRole("button", { name: "Lower Attack IV" }));
        expect(screen.getAllByRole("dialog", { name: "Edit Charizard" })).toHaveLength(1);
        expect(document.querySelector(".spread-grid .spread-card input[aria-label='Charizard Attack IV']")).toBeNull();

        await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Done" }));
        expect(screen.getByRole("button", { name: "Save Changes (1)" })).toBeInTheDocument();
        expect(within(await editCard(user, "Charizard")).getByLabelText("Charizard Attack IV")).toHaveValue("30");
        await user.keyboard("{Escape}");
        expect(screen.queryByRole("dialog", { name: "Edit Charizard" })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Save Changes (1)" })).toBeInTheDocument();
        await editCard(user, "Charizard");
        await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Revert Charizard" }));
        await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Done" }));
        expect(screen.queryByRole("button", { name: SAVE_BUTTON })).not.toBeInTheDocument();
    });

    test("shows every set in sections with readable names, leaving out a chosen trainer", async () =>
    {
        const { user } = await openEditor();

        await showAllSets(user);
        expect(getSectionNames()).toEqual(
            ["Frontier Spreads spreads", "Little Cup Spreads (Lv. 5) spreads", "Special Spread Palmer 1 spreads"]);
        expect(screen.getAllByRole("article").map((card) => card.getAttribute("aria-label"))).toEqual(
            ["Charizard spread", "Charizard spread", "Venusaur spread", "Pichu spread", "Garchomp spread", "Charizard spread"]);
        expect(within(getCard("Pichu")).getByText("Lv. 5")).toBeInTheDocument();
        expect(within(getCard("Charizard", 2)).getByRole("img", { name: /cannot be changed safely/ })).toBeInTheDocument();

        // Different species share a row when they fit
        expect(getCard("Venusaur").closest(".spread-row")).toBe(getCard("Charizard").closest(".spread-row"));

        await user.click(screen.getByRole("combobox", { name: "Trainer" }));
        await user.click(await screen.findByRole("option", { name: /^Palmer/ }));
        expect(getSectionNames()).toEqual(["Special Spread 1 spreads"]);
        expect(screen.getByRole("combobox", { name: "Spread Set" })).toHaveValue("");

        await user.click(screen.getByRole("button", { name: "Clear Filters" }));
        expect(screen.getByRole("combobox", { name: "Spread Set" })).toHaveValue("");
        expect(screen.getAllByRole("article")).toHaveLength(6);
        expect(screen.getByRole("button", { name: "Clear Filters" })).toBeDisabled();
    });

    test("shows the spread's details with symbols, chips and nature highlights", async () =>
    {
        const spreads = createSpreads();
        spreads.entries[1].fields = { ...spreads.entries[1].fields, ball: 0, gigantamax: true };
        await openEditor({ "/workspaces/load": () => createWorkspace("workspace-1", spreads) });

        const charizard = getCard("Charizard");
        expect(within(charizard).getByText("Sp. Atk")).toHaveClass("stat-label-raised");
        expect(within(charizard).getByText("Attack")).toHaveClass("stat-label-lowered");
        expect(charizard.querySelector(".battle-chips .MuiChip-label")).toHaveTextContent(/^Singles & Doubles \(Modify\)$/);
        expect(within(charizard).queryByText("Modify Doubles")).not.toBeInTheDocument();
        expect(within(charizard).queryByText(/Not Shiny|Not Gigantamax/)).not.toBeInTheDocument();
        expect(within(charizard).queryByRole("img", { name: "Shiny" })).not.toBeInTheDocument();

        expect(within(getCard("Charizard", 1)).getByRole("img", { name: "Shiny" })).toBeInTheDocument();
        const venusaur = getCard("Venusaur");
        expect(within(venusaur).getByText("Doubles Only")).toBeInTheDocument();
        expect(within(venusaur).getByText("Doubles Team: Sun")).toBeInTheDocument();
        expect(within(venusaur).queryByText("Random Ball")).not.toBeInTheDocument();
        expect(within(venusaur).getByRole("img", { name: "Gigantamax" })).toBeInTheDocument();
        expect(within(venusaur).getByText("This species cannot Gigantamax.")).toBeInTheDocument();
    });

    test("switches one Mega spread between Mega and base stats", async () =>
    {
        const { user } = await openEditor();

        const mega = getCard("Charizard", 1);
        expect(within(getCard("Charizard")).queryByRole("switch", { name: "Mega Stats" })).not.toBeInTheDocument();
        expect(getBaseStat(mega, "Attack")).toBe("130");

        const editable = await editCard(user, "Charizard", 1);
        await user.click(within(editable).getByRole("switch", { name: "Mega Stats" }));
        expect(getBaseStat(editable, "Attack")).toBe("84");
        expect(within(editable).getByRole("switch", { name: "Mega Stats" })).not.toBeChecked();
        await user.keyboard("{Escape}");
        expect(screen.queryByRole("dialog", { name: "Edit Charizard" })).not.toBeInTheDocument();
        expect(getBaseStat(mega, "Attack")).toBe("130");
    });

    test("edits with +/- buttons, selects typed fields and offers Gigantamax only when possible", async () =>
    {
        const { user, calls } = await openEditor();

        const charizard = await editCard(user, "Charizard");
        expect(within(charizard).getByRole("checkbox", { name: "Gigantamax" })).toBeInTheDocument();
        await user.click(within(charizard).getByRole("button", { name: "Lower Attack IV" }));
        expect(within(charizard).getByLabelText("Charizard Attack IV")).toHaveValue("30");
        expect(within(charizard).getByRole("button", { name: "Raise Speed IV" })).toBeDisabled();

        const hp = within(charizard).getByLabelText("Charizard HP EVs");
        await user.click(hp);
        expect([hp.selectionStart, hp.selectionEnd]).toEqual([0, 1]);

        await choose(user, charizard, "Nature", "Timid (+Spe, -Atk)");
        await choose(user, charizard, "Ball", "Poke Ball");
        await choose(user, charizard, "Ability", "[H] Solar Power");

        await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Done" }));
        const venusaur = await editCard(user, "Venusaur");
        expect(within(venusaur).queryByRole("checkbox", { name: "Gigantamax" })).not.toBeInTheDocument();

        await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Done" }));
        await user.click(screen.getByRole("button", { name: "Save Changes (1)" }));
        await waitFor(() => expect(calls.some((call) => call.route.endsWith("/save"))).toBe(true));
        expect(calls.find((call) => call.route.endsWith("/save")).body.operations).toEqual(
            [{ type: "update", entryId: "e0", fields: { atkIv: 30, nature: "NATURE_TIMID", ball: "BALL_TYPE_POKE_BALL", ability: 0 } }]);
        expect(screen.queryByRole("dialog", { name: "Edit Venusaur" })).not.toBeInTheDocument();
    });

    test("tracks unsaved changes and forgets them when reverted", async () =>
    {
        const { user } = await openEditor();

        await changeCharizard(user);
        expect(screen.getByRole("button", { name: "Save Changes (1)" })).toBeInTheDocument();
        expect(within(getCard("Charizard")).queryByText("Revert")).not.toBeInTheDocument();

        await editCard(user, "Charizard");
        const revert = within(screen.getByRole("dialog")).getByRole("button", { name: "Revert Charizard" });
        expect(revert.previousElementSibling).toHaveTextContent("Edit Charizard");
        await user.click(revert);
        expect(within(screen.getByRole("dialog")).queryByRole("button", { name: "Revert Charizard" })).not.toBeInTheDocument();
        await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Done" }));
        expect(screen.queryByRole("button", { name: SAVE_BUTTON })).not.toBeInTheDocument();

        // Changing a value back also removes the unsaved change
        const card = await editCard(user, "Charizard");
        await user.click(within(card).getByRole("button", { name: "Lower HP EVs" }));
        expect(within(card).getByLabelText("Charizard HP EVs")).toHaveValue("0");
        expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Revert Charizard" })).toBeInTheDocument();
        await user.click(within(card).getByRole("button", { name: "Raise HP EVs" }));
        await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Done" }));
        expect(screen.queryByRole("button", { name: SAVE_BUTTON })).not.toBeInTheDocument();
    });

    test("shows the doubles team type only for Doubles Only and resets it when leaving", async () =>
    {
        const { user, calls } = await openEditor();

        expect(within(getCard("Venusaur")).getByText("Doubles Team: Sun")).toBeInTheDocument();
        expect(within(getCard("Charizard")).queryByText(/Doubles Team/)).not.toBeInTheDocument();

        const venusaur = await editCard(user, "Venusaur");
        expect(within(venusaur).getByRole("combobox", { name: selectName("Doubles Team Type") })).toHaveTextContent("Sun");

        await choose(user, venusaur, "Battle Type", "Singles & Doubles");
        expect(within(venusaur).queryByRole("combobox", { name: selectName("Doubles Team Type") })).not.toBeInTheDocument();
        expect(within(venusaur).getByRole("checkbox", { name: "Modify Moves Doubles" })).toBeChecked();

        await choose(user, venusaur, "Battle Type", "Doubles Only");
        expect(within(venusaur).getByRole("combobox", { name: selectName("Doubles Team Type") })).toHaveTextContent("Any");
        await choose(user, venusaur, "Doubles Team Type", "Trick Room");
        await choose(user, venusaur, "Battle Type", "Singles Only");

        await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Done" }));
        await user.click(screen.getByRole("button", { name: "Save Changes (1)" }));
        await waitFor(() => expect(calls.some((call) => call.route.endsWith("/save"))).toBe(true));
        const save = calls.find((call) => call.route.endsWith("/save"));
        expect(save.body.operations).toEqual([{ type: "update", entryId: "e1", fields: { forSingles: true, forDoubles: false, modifyMovesDoubles: true, specificTeamType: "DOUBLES_ANY_TEAM" } }]);
    });

    test("saves only the changed fields and keeps changes when saving fails", async () =>
    {
        const { user, calls } = await openEditor(
        {
            [SAVE_ROUTE]: () =>
            {
                throw apiError(StatusCode.ClientErrorConflict, "SAVE_CONFLICT", "src/Tables/battle_tower_spreads.h changed outside the editor.");
            },
        });

        await changeCharizard(user);
        await user.click(screen.getByRole("button", { name: "Save Changes (1)" }));
        expect(await screen.findByText(/changed outside the editor/)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Save Changes (1)" })).toBeInTheDocument();

        const save = calls.find((call) => call.route === "/workspaces/workspace-1/save");
        expect(save.body).toEqual({ revision: "revision-1", gameId: "unbound", operations: [{ type: "update", entryId: "e0", fields: { atkIv: 0 } }] });
    });

    test("keeps a deleted card in place until save and restores it without saving", async () =>
    {
        const { user, calls } = await openEditor();
        const card = getCard("Charizard");
        const editable = await editCard(user, "Charizard");
        await user.click(within(editable).getByRole("button", { name: "Spread Actions" }));
        await user.click(screen.getByRole("menuitem", { name: "Delete" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        expect(card).toHaveClass("spread-card-deleted");
        expect(card.querySelector(".spread-card-content")).toHaveTextContent("Charizard");
        expect(card.querySelector(".spread-card-content")).toHaveAttribute("inert");
        expect(screen.getByRole("button", { name: "Save Changes (1)" })).toBeInTheDocument();
        await user.click(within(card).getByRole("button", { name: "Restore" }));
        expect(card).not.toHaveClass("spread-card-deleted");
        expect(screen.queryByRole("button", { name: SAVE_BUTTON })).not.toBeInTheDocument();

        await user.click(within(await editCard(user, "Charizard")).getByRole("button", { name: "Spread Actions" }));
        await user.click(screen.getByRole("menuitem", { name: "Delete" }));
        await user.click(await screen.findByRole("button", { name: "Save Changes (1)" }));
        await waitFor(() => expect(calls.some((call) => call.route.endsWith("/save"))).toBe(true));
        expect(calls.find((call) => call.route.endsWith("/save")).body.operations).toEqual([{ type: "delete", entryId: "e0" }]);
    });

    test("keeps unsaved changes across a reload and clears them once saved", async () =>
    {
        const first = await openEditor();
        await changeCharizard(first.user);
        expect(JSON.parse(localStorage.getItem(DRAFTS_STORAGE_KEY)).revision).toBe("revision-1");

        cleanup();
        const { user } = await openEditor();
        expect(await screen.findByRole("button", { name: "Save Changes (1)" })).toBeInTheDocument();
        expect(getCard("Charizard")).toHaveClass("spread-card-changed");

        await user.click(screen.getByRole("button", { name: "Save Changes (1)" }));
        await waitFor(() => expect(screen.queryByRole("button", { name: SAVE_BUTTON })).not.toBeInTheDocument());
        expect(localStorage.getItem(DRAFTS_STORAGE_KEY)).toBeNull();
    });

    test("ignores stored changes once the spread files have changed", async () =>
    {
        const first = await openEditor();
        await changeCharizard(first.user);
        const stored = JSON.parse(localStorage.getItem(DRAFTS_STORAGE_KEY));
        localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify({ ...stored, revision: "revision-0" }));

        cleanup();
        await openEditor();
        expect(screen.queryByRole("button", { name: SAVE_BUTTON })).not.toBeInTheDocument();
        await waitFor(() => expect(localStorage.getItem(DRAFTS_STORAGE_KEY)).toBeNull());
    });

    test("reverts every change after confirming Revert All", async () =>
    {
        const { user } = await openEditor();
        await changeCharizard(user);
        await user.click(screen.getByRole("button", { name: "Revert All" }));
        const dialog = screen.getByRole("dialog", { name: "Revert All Changes?" });
        await user.click(within(dialog).getByRole("button", { name: "Revert All" }));
        await waitFor(() => expect(screen.queryByRole("button", { name: SAVE_BUTTON })).not.toBeInTheDocument());
        expect(localStorage.getItem(DRAFTS_STORAGE_KEY)).toBeNull();
    });

    test("clears saved changes and keeps the new snapshot", async () =>
    {
        const { user, calls } = await openEditor();

        await changeCharizard(user);
        await user.click(screen.getByRole("button", { name: "Save Changes (1)" }));
        await waitFor(() => expect(screen.queryByRole("button", { name: SAVE_BUTTON })).not.toBeInTheDocument());
        expect(within(getCard("Charizard")).queryByLabelText("Charizard Attack IV")).not.toBeInTheDocument();

        // The next save uses the revision the server returned
        await changeCharizard(user);
        await user.click(screen.getByRole("button", { name: "Save Changes (1)" }));
        await waitFor(() => expect(calls.filter((call) => call.route.endsWith("/save"))).toHaveLength(2));
        expect(calls.filter((call) => call.route.endsWith("/save"))[1].body.revision).toBe("revision-2");
    });

    test("caps entered IVs but retains illegal EVs and blocks saving them", async () =>
    {
        const { user, calls } = await openEditor();

        const card = await editCard(user, "Charizard");
        await user.clear(within(card).getByLabelText("Charizard Defense IV"));
        await user.type(within(card).getByLabelText("Charizard Defense IV"), "99");
        expect(within(card).getByLabelText("Charizard Defense IV")).toHaveValue("31");

        await user.clear(within(card).getByLabelText("Charizard HP EVs"));
        await user.type(within(card).getByLabelText("Charizard HP EVs"), "300");
        expect(within(card).getByLabelText("Charizard HP EVs")).toHaveValue("300");
        expect(within(card).getByLabelText("Charizard HP EVs")).toHaveAttribute("aria-invalid", "true");
        expect(within(card).getByRole("button", { name: "Raise HP EVs" })).toBeDisabled();
        await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Done" }));
        await user.click(screen.getByRole("button", { name: "Save Changes (1)" }));
        expect(screen.getByText("Fix these problems before saving:")).toBeInTheDocument();
        expect(calls.some((call) => call.route.endsWith("/save"))).toBe(false);
    });

    test("blocks saving changes to a spread that is still invalid and lists the problems", async () =>
    {
        const spreads = createSpreads();
        spreads.entries[0].fields = createFields({ hpEv: 252, atkEv: 252, spdEv: 252 });
        const { user, calls } = await openEditor({ "/workspaces/load": () => createWorkspace("workspace-1", spreads) });

        expect(within(getCard("Charizard")).getByLabelText("EV total 756 of 510")).toHaveClass("ev-total-error");
        const card = await editCard(user, "Charizard");
        await user.click(within(card).getByRole("checkbox", { name: "Shiny" }));
        expect(within(card).getByText(/The EVs add up to 756/)).toBeInTheDocument();

        await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Done" }));
        await user.click(screen.getByRole("button", { name: "Save Changes (1)" }));
        expect(screen.getByText("Fix these problems before saving:")).toBeInTheDocument();
        expect(calls.some((call) => call.route.endsWith("/save"))).toBe(false);
    });

    test("filters by species without losing unsaved changes", async () =>
    {
        const { user } = await openEditor();

        await changeCharizard(user);
        await user.click(screen.getByRole("button", { name: "More Filters" }));
        await user.click(screen.getByRole("combobox", { name: "Species" }));
        await user.click(await screen.findByRole("option", { name: "Venusaur" }));
        expect(screen.queryByText("1 of 6 spreads match")).not.toBeInTheDocument();
        expect(screen.getAllByRole("article")).toHaveLength(1);
        expect(screen.getByRole("button", { name: "Save Changes (1)" })).toBeInTheDocument();

        await user.click(screen.getAllByRole("button", { name: "Clear Filters" })[0]);
        expect(screen.getAllByRole("article")).toHaveLength(6);
        expect(within(await editCard(user, "Charizard")).getByLabelText("Charizard Attack IV")).toHaveValue("0");
    });

    test("auto-fixes illegal and repeated moves, blank slots and over-cap IVs and EVs with categorized previews", async () =>
    {
        const spreads = createSpreads();
        spreads.entries[0].fields = createFields({ moves: ["MOVE_FLAMETHROWER", "MOVE_MADEUP", "MOVE_THUNDERBOLT", "MOVE_FLAMETHROWER"], hpIv: 40, spAtkEv: 255 });
        const { user } = await openEditor({ "/workspaces/load": () => createWorkspace("workspace-1", spreads) });

        await user.click(screen.getByRole("button", { name: "Auto-Fix" }));
        const dialog = await screen.findByRole("dialog", { name: "Auto-Fix Spreads" });
        const text = within(dialog).getByText("Charizard (gFrontierSpreads, line 10)").nextElementSibling;
        expect(text).toHaveTextContent("Removing unlearnable move Thunderbolt");
        expect(text).toHaveTextContent("Removing undefined move");
        expect(text).toHaveTextContent("Removing repeated move Flamethrower");
        expect(text).toHaveTextContent("Lowering HP IV 40 to 31");
        expect(text).toHaveTextContent("Lowering Atk IV 31 to 0");
        expect(text).toHaveTextContent("Lowering SpA EVs 255 to 252");
        expect(within(text).getAllByRole("listitem")).toHaveLength(6);
        await user.click(within(dialog).getByRole("tab", { name: "Moves (2)" }));
        expect(within(dialog).getByRole("tabpanel")).toHaveTextContent("Removing unlearnable move Thunderbolt");
        expect(within(dialog).getByRole("tabpanel")).not.toHaveTextContent("Lowering HP IV");
        await user.click(within(dialog).getByRole("tab", { name: "EVs (1)" }));
        const evPanel = within(dialog).getByRole("tabpanel");
        expect(evPanel).toHaveTextContent("Lowering SpA EVs 255 to 252");
        expect(evPanel).not.toHaveTextContent("Removing");
        expect(evPanel).not.toHaveTextContent("Lowering Atk IV");
        await user.click(within(dialog).getByRole("tab", { name: /^All/ }));
        await user.click(within(dialog).getByRole("button", { name: "Apply All" }));
        await waitFor(() => expect(screen.queryByRole("dialog", { name: "Auto-Fix Spreads" })).not.toBeInTheDocument());

        const card = await editCard(user, "Charizard");
        expect(within(card).getByRole("combobox", { name: "Move 1" })).toHaveValue("Flamethrower");
        expect(within(card).getByRole("combobox", { name: "Move 2" })).toHaveValue("");
        expect(within(card).getByLabelText("Charizard HP IV")).toHaveValue("31");
        expect(within(card).getByLabelText("Charizard Sp. Atk EVs")).toHaveValue("252");
    });

    test("Apply EVs changes only EVs and closes with a category-specific toast", async () =>
    {
        const spreads = createSpreads();
        spreads.entries[0].fields = createFields({ moves: ["MOVE_FLAMETHROWER", "MOVE_PROTECT", "MOVE_THUNDERBOLT", "MOVE_FLAMETHROWER"], hpIv: 40,
            hpEv: 8, atkEv: 252, defEv: 8, spAtkEv: 0, spDefEv: 0, spdEv: 252 });
        const { user } = await openEditor({ "/workspaces/load": () => createWorkspace("workspace-1", spreads) });

        await user.click(screen.getByRole("button", { name: "Auto-Fix" }));
        const dialog = await screen.findByRole("dialog", { name: "Auto-Fix Spreads" });
        await user.click(within(dialog).getByRole("tab", { name: "EVs (1)" }));
        await user.click(within(dialog).getByRole("button", { name: "Apply EVs" }));
        await waitFor(() => expect(screen.queryByRole("dialog", { name: "Auto-Fix Spreads" })).not.toBeInTheDocument());
        expect(await screen.findByText("Fixed EVs in 1 spread.")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Save Changes (1)" })).toBeInTheDocument();

        const card = await editCard(user, "Charizard");
        expect(within(card).getByRole("combobox", { name: "Move 3" })).toHaveValue("Thunderbolt");
        expect(within(card).getByRole("combobox", { name: "Move 4" })).toHaveValue("Flamethrower");
        expect(within(card).getByLabelText("Charizard HP IV")).toHaveValue("40");
        expect(within(card).getByLabelText("Charizard Attack IV")).toHaveValue("31");
        expect(within(card).getByLabelText("Charizard HP EVs")).toHaveValue("0");
        expect(within(card).getByLabelText("Charizard Defense EVs")).toHaveValue("6");
        expect(within(card).getByLabelText("Charizard Attack EVs")).toHaveValue("252");
        expect(within(card).getByLabelText("Charizard Speed EVs")).toHaveValue("252");
    });

    test("Apply Moves leaves IVs and EVs unchanged", async () =>
    {
        const spreads = createSpreads();
        spreads.entries[0].fields = createFields({ moves: ["MOVE_FLAMETHROWER", "MOVE_THUNDERBOLT", "MOVE_FLAMETHROWER", 0], hpIv: 40, spAtkEv: 255 });
        const { user } = await openEditor({ "/workspaces/load": () => createWorkspace("workspace-1", spreads) });

        await user.click(screen.getByRole("button", { name: "Auto-Fix" }));
        const dialog = await screen.findByRole("dialog", { name: "Auto-Fix Spreads" });
        await user.click(within(dialog).getByRole("tab", { name: /^Moves/ }));
        await user.click(within(dialog).getByRole("button", { name: "Apply Moves" }));
        const card = await editCard(user, "Charizard");
        expect(within(card).getByRole("combobox", { name: "Move 1" })).toHaveValue("Flamethrower");
        expect(within(card).getByRole("combobox", { name: "Move 2" })).toHaveValue("");
        expect(within(card).getByLabelText("Charizard HP IV")).toHaveValue("40");
        expect(within(card).getByLabelText("Charizard Attack IV")).toHaveValue("31");
        expect(within(card).getByLabelText("Charizard Sp. Atk EVs")).toHaveValue("255");
    });

    test("the IVs preview and Apply IVs use current moves instead of removed moves", async () =>
    {
        const spreads = createSpreads();
        spreads.entries[0].fields = createFields({ moves: ["MOVE_GYROBALL", "MOVE_FLAMETHROWER", 0, 0], atkIv: 0, spAtkEv: 255 });
        const { user } = await openEditor({ "/workspaces/load": () => createWorkspace("workspace-1", spreads) });

        await user.click(screen.getByRole("button", { name: "Auto-Fix" }));
        const dialog = await screen.findByRole("dialog", { name: "Auto-Fix Spreads" });
        const allDescriptions = within(dialog).getByText("Charizard (gFrontierSpreads, line 10)").nextElementSibling;
        expect(allDescriptions).not.toHaveTextContent("Raising Atk IV");
        expect(allDescriptions).not.toHaveTextContent("Lowering Spe IV");
        await user.click(within(dialog).getByRole("tab", { name: /^IVs/ }));
        const descriptions = within(dialog).getByText("Charizard (gFrontierSpreads, line 10)").nextElementSibling;
        expect(descriptions).toHaveTextContent("Raising Atk IV 0 to 31");
        expect(descriptions).toHaveTextContent("Lowering Spe IV 31 to 0");
        expect(descriptions).not.toHaveTextContent("Removing");
        await user.click(within(dialog).getByRole("button", { name: "Apply IVs" }));
        const card = await editCard(user, "Charizard");
        expect(within(card).getByRole("combobox", { name: "Move 1" })).toHaveValue("Gyro Ball");
        expect(within(card).getByLabelText("Charizard Attack IV")).toHaveValue("31");
        expect(within(card).getByLabelText("Charizard Speed IV")).toHaveValue("0");
        expect(within(card).getByLabelText("Charizard Sp. Atk EVs")).toHaveValue("255");
    });

    test("shifts moves up over a blank slot when editing ends", async () =>
    {
        const { user } = await openEditor();
        const card = await editCard(user, "Charizard");
        const second = within(card).getByRole("combobox", { name: "Move 2" }).value;
        await user.clear(within(card).getByRole("combobox", { name: "Move 1" }));
        await user.tab();
        expect(within(card).getByRole("combobox", { name: "Move 1" })).toHaveValue("");
        await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Done" }));
        expect(JSON.parse(localStorage.getItem(DRAFTS_STORAGE_KEY)).drafts.e0.moves).toEqual(
            ["MOVE_AIRSLASH", "MOVE_SCORCHINGSANDS", "MOVE_PROTECT", 0]);
        expect(within(await editCard(user, "Charizard")).getByRole("combobox", { name: "Move 1" })).toHaveValue(second);
    });

    test.each(["Done", "Escape", "backdrop"])("fills the first name-sorted picker move after clearing all moves and closing with %s", async (method) =>
    {
        const spreads = createSpreads();
        const saved = { ...spreads.entries[0].fields, moves: [...spreads.entries[0].fields.moves] };
        const { user, calls } = await openEditor({ "/workspaces/load": () => createWorkspace("workspace-1", spreads) });
        const card = await editCard(user, "Charizard");
        await user.click(within(card).getByRole("button", { name: "Lower Attack IV" }));
        for (const label of ["Move 1", "Move 2", "Move 3", "Move 4"])
        {
            await user.clear(within(card).getByRole("combobox", { name: label }));
            await user.tab();
        }
        expect(within(card).getByRole("combobox", { name: "Move 1" })).toHaveValue("");

        await closeEditDialog(user, method);
        expect(within(getCard("Charizard")).getByText("Air Slash")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Save Changes (1)" })).toBeEnabled();
        expect(JSON.parse(localStorage.getItem(DRAFTS_STORAGE_KEY)).drafts.e0).toEqual(
            { ...saved, atkIv: 30, moves: ["MOVE_AIRSLASH", 0, 0, 0] });
        expect(spreads.entries[0].fields).toEqual(saved);

        await user.click(screen.getByRole("button", { name: "Save Changes (1)" }));
        await waitFor(() => expect(calls.some((call) => call.route.endsWith("/save"))).toBe(true));
        expect(calls.find((call) => call.route.endsWith("/save")).body.operations).toEqual(
            [{ type: "update", entryId: "e0", fields: { atkIv: 30, moves: ["MOVE_AIRSLASH", 0, 0, 0] } }]);
    });

    test("creates a default move draft when an originally empty spread is opened and closed without edits", async () =>
    {
        const spreads = createSpreads();
        spreads.entries[0].fields = createFields({ moves: [0, "MOVE_NONE", 0, "MOVE_NONE"] });
        const saved = spreads.entries[0].fields;
        const { user } = await openEditor({ "/workspaces/load": () => createWorkspace("workspace-1", spreads) });
        await editCard(user, "Charizard");
        expect(screen.queryByRole("button", { name: SAVE_BUTTON })).not.toBeInTheDocument();
        expect(localStorage.getItem(DRAFTS_STORAGE_KEY)).toBeNull();

        await closeEditDialog(user, "Done");
        expect(JSON.parse(localStorage.getItem(DRAFTS_STORAGE_KEY)).drafts.e0).toEqual(
            { ...saved, moves: ["MOVE_AIRSLASH", "MOVE_NONE", 0, "MOVE_NONE"] });
        expect(saved.moves).toEqual([0, "MOVE_NONE", 0, "MOVE_NONE"]);
        const card = await editCard(user, "Charizard");
        expect(within(card).getByRole("combobox", { name: "Move 1" })).toHaveValue("Air Slash");
        expect(within(card).getByRole("combobox", { name: "Move 2" })).toHaveValue("");
    });

    test.each(["empty complete learnset", "empty game moves"])("leaves originally empty moves unchanged with %s", async (reason) =>
    {
        const spreads = createSpreads();
        spreads.entries[0].fields = createFields({ moves: [0, 0, 0, 0] });
        const catalog = createCatalog();
        if (reason === "empty complete learnset")
            catalog.learnsets.SPECIES_CHARIZARD = { status: "complete", moves: {}, unknown: {} };
        else
            catalog.moves = {};
        const { user } = await openEditor(
        {
            "/workspaces/load": () => createWorkspace("workspace-1", spreads),
            [CATALOG_ROUTE]: () => catalog,
        });
        await editCard(user, "Charizard");
        await closeEditDialog(user, "Done");
        expect(screen.queryByRole("button", { name: SAVE_BUTTON })).not.toBeInTheDocument();
        expect(localStorage.getItem(DRAFTS_STORAGE_KEY)).toBeNull();
        expect(spreads.entries[0].fields.moves).toEqual([0, 0, 0, 0]);
    });

    test("keeps cleared move drafts empty when the picker has no learnable options", async () =>
    {
        const catalog = createCatalog();
        catalog.learnsets.SPECIES_CHARIZARD = { status: "complete", moves: {}, unknown: {} };
        const { user } = await openEditor({ [CATALOG_ROUTE]: () => catalog });
        const card = await editCard(user, "Charizard");
        for (const label of ["Move 1", "Move 2", "Move 3", "Move 4"])
        {
            await user.clear(within(card).getByRole("combobox", { name: label }));
            await user.tab();
        }
        await closeEditDialog(user, "Done");
        expect(JSON.parse(localStorage.getItem(DRAFTS_STORAGE_KEY)).drafts.e0.moves).toEqual([0, 0, 0, 0]);
        expect(screen.getByRole("button", { name: "Save Changes (1)" })).toBeEnabled();
    });

    test.each(["missing", "incomplete", "conditional unknown"])("uses Add Spread's first picker option with a %s learnset", async (kind) =>
    {
        const spreads = createSpreads();
        spreads.entries[0].fields = createFields({ moves: [0, 0, 0, 0] });
        const catalog = createCatalog();
        if (kind === "missing")
            delete catalog.learnsets.SPECIES_CHARIZARD;
        else
            catalog.learnsets.SPECIES_CHARIZARD = { status: kind === "incomplete" ? "incomplete" : "complete", moves: {}, unknown: { MOVE_AIRSLASH: ["conditional"] } };
        const { user } = await openEditor(
        {
            "/workspaces/load": () => createWorkspace("workspace-1", spreads),
            [CATALOG_ROUTE]: () => catalog,
        });
        await editCard(user, "Charizard");
        await closeEditDialog(user, "Done");
        expect(JSON.parse(localStorage.getItem(DRAFTS_STORAGE_KEY)).drafts.e0.moves).toEqual(["MOVE_AIRSLASH", 0, 0, 0]);
    });

    test("sets the first Hidden Power option's type through IVs without mutating saved fields", async () =>
    {
        const spreads = createSpreads();
        spreads.entries[0].fields = createFields({ moves: [0, 0, 0, 0] });
        const saved = { ...spreads.entries[0].fields, moves: [...spreads.entries[0].fields.moves] };
        const catalog = createCatalog();
        catalog.types.TYPE_BUG = { name: "Bug", icon: null, symbol: null };
        catalog.learnsets.SPECIES_CHARIZARD = { status: "complete", moves: { MOVE_HIDDENPOWER: ["level"] }, unknown: {} };
        const { user } = await openEditor(
        {
            "/workspaces/load": () => createWorkspace("workspace-1", spreads),
            [CATALOG_ROUTE]: () => catalog,
        });
        await editCard(user, "Charizard");
        await closeEditDialog(user, "Done");
        const fields = JSON.parse(localStorage.getItem(DRAFTS_STORAGE_KEY)).drafts.e0;
        expect(fields.moves).toEqual(["MOVE_HIDDENPOWER", 0, 0, 0]);
        expect(getHiddenPowerType(fields)).toBe("TYPE_BUG");
        expect(spreads.entries[0].fields).toEqual(saved);
        expect(within(await editCard(user, "Charizard")).getByRole("combobox", { name: "Move 1" })).toHaveValue("Hidden Power [Bug]");
    });

    test("does not draft or replace existing moves when an untouched sparse spread closes", async () =>
    {
        const spreads = createSpreads();
        spreads.entries[0].fields = createFields({ moves: [0, "MOVE_PROTECT", 0, 0] });
        const { user } = await openEditor({ "/workspaces/load": () => createWorkspace("workspace-1", spreads) });
        await editCard(user, "Charizard");
        await closeEditDialog(user, "Done");
        expect(screen.queryByRole("button", { name: SAVE_BUTTON })).not.toBeInTheDocument();
        expect(localStorage.getItem(DRAFTS_STORAGE_KEY)).toBeNull();
        expect(spreads.entries[0].fields.moves).toEqual([0, "MOVE_PROTECT", 0, 0]);
    });

    test("does not default empty moves when reverting or deleting a spread", async () =>
    {
        const spreads = createSpreads();
        spreads.entries[0].fields = createFields({ moves: [0, 0, 0, 0] });
        const { user, calls } = await openEditor({ "/workspaces/load": () => createWorkspace("workspace-1", spreads) });
        const card = await editCard(user, "Charizard");
        await user.click(within(card).getByRole("button", { name: "Lower Attack IV" }));
        await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Revert Charizard" }));
        expect(within(card).getByRole("combobox", { name: "Move 1" })).toHaveValue("");
        expect(localStorage.getItem(DRAFTS_STORAGE_KEY)).toBeNull();
        await user.click(within(card).getByRole("button", { name: "Spread Actions" }));
        await user.click(screen.getByRole("menuitem", { name: "Delete" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        expect(JSON.parse(localStorage.getItem(DRAFTS_STORAGE_KEY)).drafts).toEqual({});
        await user.click(screen.getByRole("button", { name: "Save Changes (1)" }));
        await waitFor(() => expect(calls.some((call) => call.route.endsWith("/save"))).toBe(true));
        expect(calls.find((call) => call.route.endsWith("/save")).body.operations).toEqual([{ type: "delete", entryId: "e0" }]);
    });

    test("previews the IV auto-fix for every matching spread before applying it", async () =>
    {
        const { user } = await openEditor();

        await user.click(screen.getByRole("button", { name: "Auto-Fix" }));
        const dialog = await screen.findByRole("dialog", { name: "Auto-Fix Spreads" });
        const changes = within(dialog).getByRole("list", { name: "Spreads that will change" });
        expect(changes.children).toHaveLength(3);
        const descriptions = within(changes).getByText("Charizard (gFrontierSpreads, line 10)").nextElementSibling;
        expect(within(descriptions).getAllByRole("listitem")).toHaveLength(1);
        expect(descriptions).toHaveTextContent("Lowering Atk IV 31 to 0");
        expect(within(dialog).queryByText(/cannot be changed safely/)).not.toBeInTheDocument();

        await user.click(within(dialog).getByRole("button", { name: "Apply All" }));
        expect(await screen.findByRole("button", { name: "Save Changes (3)" })).toBeInTheDocument();
    });

    test.each(["All", "IVs"])("applies bulk %s to numeric and symbolic Trick Room teams without changing team fields", async (category) =>
    {
        const spreads = createSpreads();
        const team = spreads.teamTypes.find(({ name }) => name === "DOUBLES_TRICK_ROOM_TEAM");
        const current = createFields({ specificTeamType: team.value, forSingles: false, forDoubles: true,
            modifyMovesDoubles: false, atkIv: 0, moves: ["MOVE_FLAMETHROWER", 0, 0, 0], hpEv: category === "All" ? 253 : 252 });
        spreads.entries[0].fields = current;
        spreads.entries[1].fields = { ...current, specificTeamType: team.name, hpEv: 0, moves: ["MOVE_HIDDENPOWER", 0, 0, 0] };
        spreads.entries[2].fields = { ...current, specificTeamType: "DOUBLES_SUN_TEAM", hpEv: 0 };
        const before = JSON.stringify(spreads);
        const { user, calls } = await openEditor({ "/workspaces/load": () => createWorkspace("workspace-1", spreads) });
        await user.click(screen.getByRole("button", { name: "Auto-Fix" }));
        const dialog = await screen.findByRole("dialog", { name: "Auto-Fix Spreads" });
        if (category === "IVs")
            await user.click(within(dialog).getByRole("tab", { name: /^IVs/ }));
        expect(within(dialog).getByText("Lowering Spe IV 31 to 0")).toBeInTheDocument();
        expect(within(dialog).getByText("Lowering Spe IV 31 to 1 (kept odd for Hidden Power)")).toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: `Apply ${category}` }));
        await user.click(await screen.findByRole("button", { name: "Save Changes (2)" }));
        await waitFor(() => expect(calls.some((call) => call.route.endsWith("/save"))).toBe(true));
        expect(calls.find((call) => call.route.endsWith("/save")).body.operations).toEqual(
        [
            { type: "update", entryId: "e0", fields: category === "All" ? { hpEv: 252, spdIv: 0 } : { spdIv: 0 } },
            { type: "update", entryId: "e1", fields: { spdIv: 1 } },
        ]);
        expect(JSON.stringify(spreads)).toBe(before);
    });

    test("lists only unsafe active spreads and excludes placeholders from every auto-fix count", async () =>
    {
        const spreads = createSpreads();
        spreads.entries[0].editable = false;
        spreads.entries[0].diagnostics = [{ message: "Line 10: unsupported source expression." }];
        spreads.entries[1].editable = false;
        spreads.entries[1].placeholder = true;
        const { user } = await openEditor({ "/workspaces/load": () => createWorkspace("workspace-1", spreads) });

        await user.click(screen.getByRole("button", { name: "Auto-Fix" }));
        const dialog = await screen.findByRole("dialog", { name: "Auto-Fix Spreads" });
        const summary = within(dialog).getByRole("button", { name: "1 matching spread cannot be changed safely" });
        expect(summary).toHaveAttribute("aria-expanded", "false");
        expect(within(dialog).queryByRole("list", { name: "Spreads that cannot be changed" })).not.toBeInTheDocument();
        expect(within(dialog).getByText("1 spreads will change")).toBeInTheDocument();
        expect(within(dialog).queryByText("Venusaur (gFrontierSpreads, line 30)")).not.toBeInTheDocument();

        await user.click(summary);
        const locked = await within(dialog).findByRole("list", { name: "Spreads that cannot be changed" });
        expect(summary).toHaveAttribute("aria-expanded", "true");
        expect(within(dialog).getByRole("alert")).toHaveTextContent("Changing them could overwrite source the editor does not understand.");
        expect(locked.children).toHaveLength(1);
        expect(within(locked).getByText("Charizard (gFrontierSpreads, line 10)")).toBeInTheDocument();
        expect(within(locked).getByText(/unsupported source expression/)).toHaveTextContent("This spread's source cannot be changed safely.");
        expect(within(dialog).queryByText(/placeholder|unused spread/)).not.toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
        await waitFor(() => expect(screen.queryByRole("dialog", { name: "Auto-Fix Spreads" })).not.toBeInTheDocument());
        expect(screen.queryByRole("button", { name: SAVE_BUTTON })).not.toBeInTheDocument();
    });

    test("describes move shifts and IV increases while keeping Hidden Power annotations", async () =>
    {
        const spreads = createSpreads();
        spreads.entries[0].fields = createFields({ moves: [0, "MOVE_HIDDENPOWER", 0, 0], spAtkIv: 0 });
        const { user } = await openEditor({ "/workspaces/load": () => createWorkspace("workspace-1", spreads) });

        await user.click(screen.getByRole("button", { name: "Auto-Fix" }));
        const dialog = await screen.findByRole("dialog", { name: "Auto-Fix Spreads" });
        const descriptions = within(dialog).getByText("Charizard (gFrontierSpreads, line 10)").nextElementSibling;
        expect(descriptions).toHaveTextContent("Shifting moves up over a blank slot");
        expect(descriptions).toHaveTextContent("Lowering Atk IV 31 to 1 (kept odd for Hidden Power)");
        expect(descriptions).toHaveTextContent("Raising SpA IV 0 to 30 (kept even for Hidden Power)");
    });

    test("ignores placeholders even if marked editable", async () =>
    {
        const spreads = createSpreads();
        for (const entry of spreads.entries)
            entry.placeholder = true;
        const { user } = await openEditor({ "/workspaces/load": () => createWorkspace("workspace-1", spreads) });

        await user.click(screen.getByRole("button", { name: "Auto-Fix" }));
        const dialog = await screen.findByRole("dialog", { name: "Auto-Fix Spreads" });
        expect(within(dialog).getByText("No matching spread needs fixing.")).toBeInTheDocument();
        expect(within(dialog).queryByRole("list")).not.toBeInTheDocument();
        expect(within(dialog).queryByText(/spreads will change|stats left alone|cannot be changed safely|placeholder/)).not.toBeInTheDocument();
        expect(within(dialog).getByRole("button", { name: "Apply All" })).toBeDisabled();
    });

    test.each(["hover", "focus", "click"])("shows detailed auto-fix rules through help %s", async (interaction) =>
    {
        const user = userEvent.setup();
        render(<AutoFixDialog open changes={[]} skipped={[]} locked={[]} onApply={vi.fn()} onClose={vi.fn()} />);
        const dialog = screen.getByRole("dialog", { name: "Auto-Fix Spreads" });
        expect(within(dialog).getByText("Removes moves that can't be used and fixes IVs and EVs for every matching spread on every page.")).toBeInTheDocument();
        expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
        const help = within(dialog).getByRole("button", { name: "How Auto-Fix Works" });
        expect(help).not.toHaveAttribute("title");

        if (interaction === "hover")
            await user.hover(help);
        else if (interaction === "focus")
            await user.tab();
        else
            fireEvent.click(help);

        if (interaction === "focus")
            expect(help).toHaveFocus();
        const tooltip = await screen.findByRole("tooltip");
        expect(within(tooltip).getAllByRole("listitem")).toHaveLength(10);
        expect(tooltip).toHaveTextContent("Caps EVs at 252 per stat and 510 in total.");
        expect(tooltip).toHaveTextContent("Reduces smallest non-maxed EV investments before maxed stats.");
        expect(tooltip).toHaveTextContent("Removes unlearnable, undefined and repeated moves.");
        expect(tooltip).toHaveTextContent("Lowers Speed IV to 0 for Gyro Ball or Trick Room.");
        expect(tooltip).toHaveTextContent("Uses 1 or 30 instead when needed to preserve Hidden Power.");
        expect(tooltip).toHaveTextContent("Keeps attacking IVs unchanged when move details are unknown.");
    });

    test("counts affected spreads per category and filters both entries and bullets", async () =>
    {
        const changes =
        [
            { id: "mixed", label: "Mixed Spread", descriptions: { moves: ["Removing repeated move Protect"], ivs: ["Lowering Atk IV 31 to 0"], evs: ["Lowering SpA EVs 255 to 252"] } },
            { id: "moves", label: "Move Spread", descriptions: { moves: ["Shifting moves up over a blank slot"], ivs: [], evs: [] } },
            { id: "ivs", label: "IV Spread", descriptions: { moves: [], ivs: ["Raising SpA IV 0 to 31"], evs: [] } },
        ];
        const skipped = [{ id: "skip", label: "Unknown Spread", descriptions: ["Keeping SpA IV unchanged (unknown move details)"] }];
        const user = userEvent.setup();
        render(<AutoFixDialog open changes={changes} skipped={skipped} locked={[]} onApply={vi.fn()} onClose={vi.fn()} />);
        const dialog = screen.getByRole("dialog", { name: "Auto-Fix Spreads" });
        expect(within(dialog).getByRole("tab", { name: "All (3)" })).toHaveAttribute("aria-selected", "true");
        expect(within(dialog).getByRole("tab", { name: "Moves (2)" })).toBeInTheDocument();
        expect(within(dialog).getByRole("tab", { name: "IVs (2)" })).toBeInTheDocument();
        expect(within(dialog).getByRole("tab", { name: "EVs (1)" })).toBeInTheDocument();
        expect(within(dialog).getByRole("button", { name: "Apply All" })).toBeEnabled();

        await user.click(within(dialog).getByRole("tab", { name: "Moves (2)" }));
        expect(within(dialog).getByRole("button", { name: "Apply Moves" })).toBeEnabled();

        await user.click(within(dialog).getByRole("tab", { name: "IVs (2)" }));
        expect(within(dialog).getByRole("button", { name: "Apply IVs" })).toBeEnabled();
        let panel = within(dialog).getByRole("tabpanel");
        expect(panel).toHaveTextContent("Mixed Spread");
        expect(panel).toHaveTextContent("IV Spread");
        expect(panel).not.toHaveTextContent("Move Spread");
        expect(panel).not.toHaveTextContent("Removing repeated move");
        expect(panel).not.toHaveTextContent("EVs 255");
        expect(within(panel).getByRole("list", { name: "Spreads that will change" }).children).toHaveLength(2);
        expect(within(dialog).getByRole("list", { name: "Spreads left alone" })).toHaveTextContent("Unknown Spread");

        await user.click(within(dialog).getByRole("tab", { name: "EVs (1)" }));
        expect(within(dialog).getByRole("button", { name: "Apply EVs" })).toBeEnabled();
        panel = within(dialog).getByRole("tabpanel");
        expect(panel).toHaveTextContent("Mixed Spread");
        expect(panel).toHaveTextContent("Lowering SpA EVs 255 to 252");
        expect(panel).not.toHaveTextContent("IV Spread");
        expect(panel).not.toHaveTextContent("Lowering Atk IV");

        await user.click(within(dialog).getByRole("tab", { name: "All (3)" }));
        expect(within(dialog).getByRole("button", { name: "Apply All" })).toBeEnabled();
        panel = within(dialog).getByRole("tabpanel");
        expect(panel).toHaveTextContent("Removing repeated move Protect");
        expect(panel).toHaveTextContent("Lowering Atk IV 31 to 0");
        expect(panel).toHaveTextContent("Lowering SpA EVs 255 to 252");
        expect(within(panel).getByRole("list", { name: "Spreads that will change" }).children).toHaveLength(3);
    });

    test("disables Apply for the current category when its changes become empty", async () =>
    {
        const changes = [{ id: "evs", label: "EV Spread", descriptions: { moves: [], ivs: [], evs: ["Lowering SpA EVs 255 to 252"] } }];
        const onApply = vi.fn();
        const user = userEvent.setup();
        const { rerender } = render(<AutoFixDialog open changes={changes} skipped={[]} locked={[]} onApply={onApply} onClose={vi.fn()} />);
        const dialog = screen.getByRole("dialog", { name: "Auto-Fix Spreads" });
        await user.click(within(dialog).getByRole("tab", { name: "EVs (1)" }));
        await user.click(within(dialog).getByRole("button", { name: "Apply EVs" }));
        expect(onApply).toHaveBeenCalledWith("evs");

        rerender(<AutoFixDialog open changes={changes} categoryChanges={{ evs: [] }} skipped={[]} locked={[]} onApply={onApply} onClose={vi.fn()} />);
        expect(within(dialog).getByRole("tab", { name: "EVs (0)" })).toHaveAttribute("aria-selected", "true");
        expect(within(dialog).getByRole("button", { name: "Apply EVs" })).toBeDisabled();
    });

    test("loads every auto-fix list in scroll batches without a truncated remainder", async () =>
    {
        const changes = Array.from({ length: AUTO_FIX_BATCH_TOTAL }, (_, index) => (
        {
            id: `change-${index}`,
            label: `Changed spread ${index}`,
            descriptions: { moves: [], ivs: ["Lowering Atk IV 31 to 0"], evs: [] },
        }));
        const skipped = changes.map((item, index) => (
        {
            id: `skip-${index}`,
            label: `Skipped spread ${index}`,
            descriptions: ["Keeping SpA IV unchanged (unknown move details)"],
        }));
        const locked = changes.map((item, index) => ({ id: `locked-${index}`, label: `Locked spread ${index}`, reason: "Unsupported initializer." }));
        const user = userEvent.setup();
        render(<AutoFixDialog open changes={changes} skipped={skipped} locked={locked} onApply={vi.fn()} onClose={vi.fn()} />);
        const dialog = screen.getByRole("dialog", { name: "Auto-Fix Spreads" });
        expect(within(dialog).queryByRole("tab", { name: /^Moves/ })).not.toBeInTheDocument();
        expect(within(dialog).queryByRole("tab", { name: /^EVs/ })).not.toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: `${AUTO_FIX_BATCH_TOTAL} matching spreads cannot be changed safely` }));

        for (const name of ["Spreads that will change", "Spreads left alone", "Spreads that cannot be changed"])
        {
            const list = await within(dialog).findByRole("list", { name });
            expect(list.children).toHaveLength(LIST_PAGE_SIZE);
            expect(within(list.children[0]).getAllByRole("listitem")).toHaveLength(1);
            scrollPreviewToBottom(list);
            await waitFor(() => expect(list.children).toHaveLength(LIST_PAGE_SIZE * 2));
            scrollPreviewToBottom(list);
            await waitFor(() => expect(list.children).toHaveLength(AUTO_FIX_BATCH_TOTAL));
        }

        expect(within(dialog).queryByText(/And \d+ more/)).not.toBeInTheDocument();
        await user.click(within(dialog).getByRole("tab", { name: `IVs (${AUTO_FIX_BATCH_TOTAL})` }));
        const filtered = within(dialog).getByRole("list", { name: "Spreads that will change" });
        expect(filtered.children).toHaveLength(LIST_PAGE_SIZE);
        scrollPreviewToBottom(filtered);
        await waitFor(() => expect(filtered.children).toHaveLength(LIST_PAGE_SIZE * 2));
    });

    test("asks before changing the game with unsaved changes", async () =>
    {
        const { user } = await openEditor();

        await changeCharizard(user);
        await user.click(screen.getByRole("button", { name: "Unbound menu" }));
        await user.click(screen.getByRole("menuitem", { name: "Change Game" }));
        let dialog = await screen.findByRole("dialog", { name: UNSAVED_TITLE });
        await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
        await waitFor(() => expect(screen.queryByRole("dialog", { name: UNSAVED_TITLE })).not.toBeInTheDocument());
        expect(screen.getByRole("button", { name: "Save Changes (1)" })).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Unbound menu" }));
        await user.click(screen.getByRole("menuitem", { name: "Change Game" }));
        dialog = await screen.findByRole("dialog", { name: UNSAVED_TITLE });
        await user.click(within(dialog).getByRole("button", { name: "Discard" }));
        expect(await screen.findByRole("dialog", { name: GAME_TITLE })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: SAVE_BUTTON })).not.toBeInTheDocument();
    });

    test("asks before leaving the page with unsaved changes", async () =>
    {
        const { user } = await openEditor();

        const clean = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(clean);
        expect(clean.defaultPrevented).toBe(false);

        await changeCharizard(user);
        const dirty = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(dirty);
        expect(dirty.defaultPrevented).toBe(true);

        await user.click(screen.getByRole("link", { name: "Privacy Policy" }));
        const dialog = await screen.findByRole("dialog", { name: UNSAVED_TITLE });
        await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
        await waitFor(() => expect(screen.queryByRole("dialog", { name: UNSAVED_TITLE })).not.toBeInTheDocument());
        expect(screen.getAllByRole("article")).toHaveLength(3);

        await user.click(screen.getByRole("link", { name: "Privacy Policy" }));
        await user.click(within(await screen.findByRole("dialog", { name: UNSAVED_TITLE })).getByRole("button", { name: "Discard" }));
        await waitFor(() => expect(screen.queryByRole("article")).not.toBeInTheDocument());
    });
});
