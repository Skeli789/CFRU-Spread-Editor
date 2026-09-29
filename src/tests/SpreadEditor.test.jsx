import React from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios from "axios";
import { StatusCode } from "status-code-enum";
import { vi } from "vitest";

import App from "../App";
import { DRAFTS_STORAGE_KEY, SETTINGS_STORAGE_KEY, SETTINGS_VERSION } from "../SpreadEditorState";
import { PATHS, SAVE_ROUTE, apiError, createFields, createSpreads, createWorkspace, mockServer } from "./EditorFixtures";

vi.mock("axios", () => ({ default: { post: vi.fn() } }));

const SAVE_BUTTON = /^Save Changes/;
const UNSAVED_TITLE = "Unsaved Changes";
const GAME_TITLE = "Choose Game";


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
        await user.click(within(await editCard(user, "Charizard")).getByRole("button", { name: "Revert Charizard" }));
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
        expect(getCard("Venusaur").parentElement).toBe(getCard("Charizard").parentElement);

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
        expect(within(charizard).getByText("Singles & Doubles")).toBeInTheDocument();
        expect(within(charizard).getByText("Modify Doubles")).toBeInTheDocument();
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
        expect(within(getCard("Charizard")).getByText("Revert")).toBeInTheDocument();

        await user.click(within(getCard("Charizard")).getByRole("button", { name: "Revert Charizard" }));
        expect(screen.queryByRole("button", { name: SAVE_BUTTON })).not.toBeInTheDocument();

        // Changing a value back also removes the unsaved change
        const card = await editCard(user, "Charizard");
        await user.click(within(card).getByRole("button", { name: "Lower HP EVs" }));
        expect(within(card).getByLabelText("Charizard HP EVs")).toHaveValue("0");
        expect(within(card).getByRole("button", { name: "Revert Charizard" })).toBeInTheDocument();
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
        await user.click(within(editable).getByRole("button", { name: "Delete Charizard" }));
        await user.click(within(screen.getByRole("dialog", { name: "Delete Charizard?" })).getByRole("button", { name: "Delete" }));
        expect(card).toHaveClass("spread-card-deleted");
        expect(card.querySelector(".spread-card-content")).toHaveTextContent("Charizard");
        expect(card.querySelector(".spread-card-content")).toHaveAttribute("inert");
        expect(screen.getByRole("button", { name: "Save Changes (1)" })).toBeInTheDocument();
        await user.click(within(card).getByRole("button", { name: "Restore" }));
        expect(card).not.toHaveClass("spread-card-deleted");
        expect(screen.queryByRole("button", { name: SAVE_BUTTON })).not.toBeInTheDocument();

        await user.click(within(await editCard(user, "Charizard")).getByRole("button", { name: "Delete Charizard" }));
        await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
        await user.click(screen.getByRole("button", { name: "Save Changes (1)" }));
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

    test("keeps entered IVs and EVs within their limits", async () =>
    {
        const { user } = await openEditor();

        const card = await editCard(user, "Charizard");
        await user.clear(within(card).getByLabelText("Charizard Defense IV"));
        await user.type(within(card).getByLabelText("Charizard Defense IV"), "99");
        expect(within(card).getByLabelText("Charizard Defense IV")).toHaveValue("31");

        await user.clear(within(card).getByLabelText("Charizard HP EVs"));
        await user.type(within(card).getByLabelText("Charizard HP EVs"), "300");
        expect(within(card).getByLabelText("EV total 510 of 510")).toBeInTheDocument();
        expect(within(card).getByRole("button", { name: "Raise HP EVs" })).toBeDisabled();
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

    test("previews the IV auto-fix for every matching spread before applying it", async () =>
    {
        const { user } = await openEditor();

        await user.click(screen.getByRole("button", { name: "Auto-Fix IVs" }));
        const dialog = await screen.findByRole("dialog", { name: "Auto-Fix IVs" });
        const changes = within(dialog).getByRole("list", { name: "Spreads that will change" });
        expect(within(changes).getAllByRole("listitem")).toHaveLength(3);
        expect(within(changes).getByText("Charizard (gFrontierSpreads, line 10)").nextElementSibling).toHaveTextContent("Atk 31 to 0");
        expect(within(dialog).queryByText(/cannot be changed safely/)).not.toBeInTheDocument();

        await user.click(within(dialog).getByRole("button", { name: "Apply" }));
        expect(screen.getByRole("button", { name: "Save Changes (3)" })).toBeInTheDocument();
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
