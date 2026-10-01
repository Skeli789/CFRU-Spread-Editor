import React from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios from "axios";
import { vi } from "vitest";

import App from "../App";
import { DRAFTS_STORAGE_KEY, DRAFTS_VERSION, SETTINGS_STORAGE_KEY, SETTINGS_VERSION } from "../SpreadEditorState";
import { FRONTIER_SET, LITTLE_CUP_SET, PALMER_SET, PATHS, SAVE_ROUTE, createFields, createSpreads, createWorkspace, mockServer } from "./EditorFixtures";

vi.mock("axios", () => ({ default: { post: vi.fn() } }));

const HIDDEN_SPREADS_REASON = "Some spreads are hidden by the filters.";
const GROUP_MOVE_TOOLTIP = "Choose a new place for every Charizard spread";

/**
 * Loads the editor with the standard fixture or a custom workspace.
 *
 * @param {object} [spreads] The spread snapshot.
 * @param {object} [overrides] The mocked API handlers.
 * @returns {Promise<{user: object, calls: Array<object>}>} The user and recorded calls.
 */
async function openEditor(spreads = createSpreads(), overrides = {})
{
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ version: SETTINGS_VERSION, paths: PATHS, gameId: "unbound" }));
    const calls = mockServer({ "/workspaces/load": () => createWorkspace("workspace-1", spreads), ...overrides });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: "Unbound menu" });
    return { user, calls };
}

/**
 * Stores an unsaved order for a set, as if the user had dragged spreads within their species before reloading.
 *
 * @param {object} spreads The spread snapshot.
 * @param {string} setId The set.
 * @param {Array<string>} order The set's new order.
 * @param {Array<string>} moved The spreads the user moved.
 */
function storeOrder(spreads, setId, order, moved)
{
    const saved = Object.fromEntries(spreads.entries.filter((entry) => entry.setId === setId).map((entry) => [entry.id, { setId, fields: entry.fields }]));
    localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(
    {
        version: DRAFTS_VERSION, revision: spreads.revision, drafts: {}, newEntries: {}, orders: { [setId]: order }, orderMoves: { [setId]: moved },
        deleted: [], modifyMemory: {}, saved,
    }));
}

/**
 * Opens the add dialog and chooses a species.
 *
 * @param {object} user The user-event instance.
 * @param {string} name The species name.
 */
async function chooseSpecies(user, name)
{
    await user.click(screen.getByRole("button", { name: "Add Spread" }));
    await user.click(screen.getByRole("combobox", { name: "Species" }));
    await user.click(await screen.findByRole("option", { name }));
}

/**
 * Adds a Pichu with Thunderbolt through the Add Spread dialog and its Add Pichu editor.
 *
 * @param {object} user The user-event instance.
 */
async function addPichu(user)
{
    await chooseSpecies(user, "Pichu");
    await user.click(within(screen.getByRole("dialog", { name: "Add Spread" })).getByRole("button", { name: "Add", exact: true }));
    const dialog = screen.getByRole("dialog", { name: "Add Pichu" });
    await user.click(within(dialog).getByRole("combobox", { name: /Move 1/ }));
    await user.click(await screen.findByRole("option", { name: /Thunderbolt/ }));
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add Pichu" })).not.toBeInTheDocument());
}

/**
 * Finds a Charizard's controls after row keys change during a move.
 * @param {string} nature The spread's nature.
 * @returns {object} Queries scoped to the spread and its controls.
 */
function getCharizardControls(nature)
{
    const card = screen.getAllByRole("article", { name: "Charizard spread" }).find((candidate) => candidate.textContent.includes(nature));
    return within(card.closest(".movable-spread"));
}

describe("Adding and reordering spreads", () =>
{
    beforeEach(() =>
    {
        localStorage.clear();
        axios.post.mockReset();
    });

    afterEach(() => cleanup());

    test("drops a cached saved order and does not offer a no-op Revert Order", async () =>
    {
        const spreads = createSpreads();
        storeOrder(spreads, FRONTIER_SET, spreads.sets[0].entryIds, ["e0"]);
        await openEditor(spreads);
        expect(screen.queryByRole("button", { name: "Revert Order" })).not.toBeInTheDocument();
        expect(localStorage.getItem(DRAFTS_STORAGE_KEY)).toBeNull();
    });

    test("reorders species peers with multiple sets visible and Revert Order restores saved slots", async () =>
    {
        const { user } = await openEditor();
        expect(screen.queryByRole("button", { name: "Revert Order" })).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "More Filters" }));
        const setFilter = screen.getByRole("combobox", { name: "Spread Set" });
        await user.click(setFilter.closest(".MuiAutocomplete-root").querySelector(".MuiAutocomplete-clearIndicator"));
        expect(screen.getAllByRole("region", { name: /spreads$/ })).toHaveLength(3);
        const right = getCharizardControls("Adamant").getByRole("button", { name: "Move Charizard Spread Left" });
        expect(right).toBeEnabled();
        await user.click(right);
        expect(JSON.parse(localStorage.getItem(DRAFTS_STORAGE_KEY)).orders[FRONTIER_SET]).toEqual(["e2", "e1", "e0"]);
        await user.click(screen.getByRole("button", { name: "Revert Order" }));
        expect(screen.queryByRole("button", { name: "Revert Order" })).not.toBeInTheDocument();
        expect(localStorage.getItem(DRAFTS_STORAGE_KEY)).toBeNull();
        expect(within(screen.getByRole("region", { name: "Frontier Spreads spreads" })).getAllByRole("article", { name: "Charizard spread" })[0]).toHaveTextContent("Modest");
    });

    test("offers Add Spread in each filtered section with that set preselected", async () =>
    {
        const { user } = await openEditor();
        await user.click(screen.getByRole("button", { name: "More Filters" }));
        const setFilter = screen.getByRole("combobox", { name: "Spread Set" });
        await user.click(setFilter.closest(".MuiAutocomplete-root").querySelector(".MuiAutocomplete-clearIndicator"));
        await user.click(screen.getByRole("combobox", { name: "Species" }));
        await user.click(await screen.findByRole("option", { name: "Charizard" }));
        const sections = screen.getAllByRole("region", { name: /spreads$/ });
        expect(sections).toHaveLength(2);
        for (const section of sections)
        {
            await user.click(within(section).getByRole("button", { name: "Add Spread at the End" }));
            const dialog = screen.getByRole("dialog", { name: "Add Spread" });
            expect(within(dialog).getByRole("combobox", { name: "Spread Set" }).value).toBe(section.getAttribute("aria-label").replace(/ spreads$/, ""));
            await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
            await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add Spread" })).not.toBeInTheDocument());
        }
    });

    test("defaults to the filtered set, previews only after selection, and requires an explicit Add", async () =>
    {
        const { user } = await openEditor();
        await user.click(screen.getByRole("button", { name: "Add Spread" }));
        const dialog = screen.getByRole("dialog", { name: "Add Spread" });
        expect(within(dialog).getByRole("combobox", { name: "Spread Set" })).toHaveValue("Frontier Spreads");
        expect(within(dialog).queryByLabelText("Species preview")).not.toBeInTheDocument();
        expect(within(dialog).getByRole("button", { name: "Add", exact: true })).toBeDisabled();
        await user.click(within(dialog).getByRole("combobox", { name: "Species" }));
        await user.click(await screen.findByRole("option", { name: "Pichu" }));
        expect(within(dialog).getByLabelText("Species preview")).toHaveTextContent("Static");
        expect(within(dialog).getByLabelText("Species preview")).toHaveTextContent(/Stats: \d+\/\d+\/\d+\/\d+\/\d+\/\d+/);
        expect(within(dialog).getAllByRole("tab")[0].compareDocumentPosition(within(dialog).getByRole("combobox", { name: "Spread Set" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        await user.click(within(dialog).getByRole("button", { name: "Add", exact: true }));

        // The spread is only added once its own Add button is pressed, and starts with its first learnable move
        const adding = await screen.findByRole("dialog", { name: "Add Pichu" });
        expect(within(adding).queryByRole("button", { name: "Revert Pichu" })).not.toBeInTheDocument();
        expect(within(adding).getByRole("combobox", { name: /Move 1/ })).toHaveValue("Fake Out");
        expect(within(adding).getByRole("button", { name: "Add" })).toBeEnabled();
        expect(screen.queryByRole("button", { name: /Save Changes/ })).not.toBeInTheDocument();
        await user.keyboard("{Escape}");
        const discard = await screen.findByRole("dialog", { name: "Discard New Pichu?" });
        await user.click(within(discard).getByRole("button", { name: "Keep Editing" }));
        await user.click(within(adding).getByRole("combobox", { name: /Move 1/ }));
        await user.click(await screen.findByRole("option", { name: /Thunderbolt/ }));
        await user.click(within(adding).getByRole("button", { name: "Add" }));
        await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add Pichu" })).not.toBeInTheDocument());
        expect(within(screen.getByRole("region", { name: "Frontier Spreads spreads" })).getByRole("img", { name: "New Spread" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Save Changes \(1\)/ })).toBeInTheDocument();
    });

    test("adds a species with Enter alone, starting at its first move selected so typing replaces it", async () =>
    {
        const { user } = await openEditor();
        await user.click(screen.getByRole("button", { name: "Add Spread at the End" }));
        const dialog = screen.getByRole("dialog", { name: "Add Spread" });
        await user.type(within(dialog).getByRole("combobox", { name: "Species" }), "Pich{Enter}");
        expect(within(dialog).getByLabelText("Species preview")).toHaveTextContent("Pichu");
        await user.keyboard("{Enter}");
        const adding = await screen.findByRole("dialog", { name: "Add Pichu" });
        const move = within(adding).getByRole("combobox", { name: /Move 1/ });
        await waitFor(() => expect(move).toHaveFocus());
        expect([move.selectionStart, move.selectionEnd]).toEqual([0, "Fake Out".length]);
        await user.keyboard("{Enter}");
        await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add Pichu" })).not.toBeInTheDocument());
        expect(within(screen.getByRole("region", { name: "Frontier Spreads spreads" })).getByRole("img", { name: "New Spread" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Save Changes \(1\)/ })).toBeInTheDocument();
    });

    test("gives the edit dialog a blue Done button", async () =>
    {
        const { user } = await openEditor();
        await addPichu(user);
        await user.click(screen.getByRole("heading", { name: "Pichu" }));
        expect(within(screen.getByRole("dialog", { name: "Edit Pichu" })).getByRole("button", { name: "Done" })).toHaveClass("MuiButton-colorFocus");
    });

    test("discards a chosen species after confirming when its editor is closed before Add", async () =>
    {
        const { user } = await openEditor();
        await chooseSpecies(user, "Pichu");
        await user.click(within(screen.getByRole("dialog", { name: "Add Spread" })).getByRole("button", { name: "Add", exact: true }));
        await user.click(within(screen.getByRole("dialog", { name: "Add Pichu" })).getByRole("button", { name: "Cancel" }));
        await user.click(within(screen.getByRole("dialog", { name: "Discard New Pichu?" })).getByRole("button", { name: "Discard" }));
        await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add Pichu" })).not.toBeInTheDocument());
        expect(screen.queryByRole("article", { name: "Pichu spread" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Save Changes/ })).not.toBeInTheDocument();
    });

    test("requires another set when the default is blocked and lists only out-of-battle species by name", async () =>
    {
        const spreads = createSpreads();
        spreads.sets[0].canInsert = false;
        spreads.sets[0].insertBlockedReason = "Fixed-size array";
        const { user } = await openEditor(spreads);
        await user.click(screen.getByRole("button", { name: "Add Spread" }));
        const dialog = screen.getByRole("dialog", { name: "Add Spread" });
        expect(within(dialog).getByText("Fixed-size array")).toBeInTheDocument();
        expect(within(dialog).getByRole("button", { name: "Add", exact: true })).toBeDisabled();
        await user.click(within(dialog).getByRole("combobox", { name: "Spread Set" }));
        await user.click(await screen.findByRole("option", { name: "Little Cup Spreads (Lv. 5)" }));
        expect(within(dialog).queryByRole("button", { name: "Dex Number" })).not.toBeInTheDocument();
        await user.click(within(dialog).getByRole("combobox", { name: "Species" }));
        const names = (await screen.findAllByRole("option")).map((option) => option.textContent);
        expect(names).toEqual(["Charizard", "Garchomp", "Pichu", "Venusaur"]);
    });

    test("imports any number of pasted Showdown sets, reverting battle-only forms and skipping bad sets", async () =>
    {
        const { user } = await openEditor();
        await user.click(screen.getByRole("button", { name: "Add Spread" }));
        const dialog = screen.getByRole("dialog", { name: "Add Spread" });
        await user.click(within(dialog).getByRole("tab", { name: "Import Showdown Text" }));
        await user.click(within(dialog).getByRole("textbox", { name: "Showdown Text" }));
        await user.paste("Mega Charizard X @ Charizardite X\nAbility: Tough Claws\n- Flamethrower\n\nPichu @ Life Orb\nAbility: Static\n- Thunderbolt\n\nUnknownmon\n- Tackle");
        const preview = await within(dialog).findByRole("list", { name: "Import Problems" });
        expect(preview).toHaveTextContent("1. Charizard");
        expect(preview).toHaveTextContent("Mega Charizard X imported as Charizard (battle-only form)");
        expect(preview).not.toHaveTextContent("Pichu");
        expect(preview).toHaveTextContent("3. Unknownmon (Skipped)");
        expect([...preview.children].filter((child) => child.tagName === "LI")).toHaveLength(2);
        await user.click(within(dialog).getByRole("button", { name: "Import 2 Spreads" }));
        expect(screen.queryByRole("dialog", { name: "Add Spread" })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Save Changes \(2\)/ })).toBeInTheDocument();
        expect(within(screen.getByRole("region", { name: "Frontier Spreads spreads" })).getAllByRole("img", { name: "New Spread" })).toHaveLength(2);
        const stored = JSON.parse(localStorage.getItem(DRAFTS_STORAGE_KEY));
        expect(Object.values(stored.drafts).map((fields) => [fields.species, fields.item])).toEqual(
            [["SPECIES_CHARIZARD", "ITEM_CHARIZARDITE_X"], ["SPECIES_PICHU", "ITEM_LIFEORB"]]);
    });

    test("new spreads are cached, have no Revert, and can be deleted without a delete operation", async () =>
    {
        const { user, calls } = await openEditor();
        await addPichu(user);
        await waitFor(() => expect(JSON.parse(localStorage.getItem(DRAFTS_STORAGE_KEY)).newEntries["new-1"]).toBeDefined());
        await user.click(screen.getByRole("heading", { name: "Pichu" }));
        const dialog = screen.getByRole("dialog", { name: "Edit Pichu" });
        expect(within(dialog).queryByRole("button", { name: "Revert Pichu" })).not.toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: "Spread Actions" }));
        await user.click(screen.getByRole("menuitem", { name: "Delete" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        expect(screen.queryByRole("button", { name: /Save Changes/ })).not.toBeInTheDocument();
        expect(calls.filter((call) => call.route.endsWith("/save"))).toHaveLength(0);
        await waitFor(() => expect(localStorage.getItem(DRAFTS_STORAGE_KEY)).toBeNull());
    });

    test("sends only an add when the new spread keeps its default place, and maps created IDs after save", async () =>
    {
        const saved = createSpreads("revision-2");
        const { user, calls } = await openEditor(createSpreads(),
        {
            [SAVE_ROUTE]: (body) =>
            {
                const addition = body.operations.find((operation) => operation.type === "add");
                const entry = { id: "e6", setId: FRONTIER_SET, fields: addition.fields, editable: true, diagnostics: [], line: 90 };
                saved.entries.push(entry);
                saved.sets[0].entryIds.push("e6");
                return { spreads: saved, createdIds: { [addition.tempId]: "e6" } };
            },
        });
        await addPichu(user);
        await user.click(screen.getByRole("button", { name: /Save Changes/ }));
        await waitFor(() => expect(calls.some((call) => call.route.endsWith("/save"))).toBe(true));
        const operations = calls.find((call) => call.route.endsWith("/save")).body.operations;
        expect(operations.map((operation) => operation.type)).toEqual(["add"]);
        expect(operations[0].afterEntryId).toBe("e2");
        await waitFor(() => expect(screen.queryByRole("button", { name: /Save Changes/ })).not.toBeInTheDocument());
        expect(screen.queryByRole("img", { name: "New Spread" })).not.toBeInTheDocument();
    });

    test("has no up/down or group arrow buttons, and whole-group moves of interleaved spreads ask confirmation", async () =>
    {
        const spreads = createSpreads();
        storeOrder(spreads, FRONTIER_SET, ["e2", "e1", "e0"], ["e0"]);
        const { user, calls } = await openEditor(spreads);
        expect(screen.queryByRole("button", { name: /^Move .* Spread (Up|Down)$/ })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /^Move .* Group (Left|Right|Up|Down)$/ })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Save Changes \(2\)/ })).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Move Charizard Group" }));
        expect(screen.getByText(/Choose Move Here where the Charizard group should go/)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Move Here, before Venusaur" })).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Move Here, at the end" }));
        expect(screen.getByRole("dialog", { name: "Move Species Group?" })).toHaveTextContent("interleaved");
        await user.click(within(screen.getByRole("dialog", { name: "Move Species Group?" })).getByRole("button", { name: "Move Group" }));
        await waitFor(() => expect(screen.queryByRole("dialog", { name: "Move Species Group?" })).not.toBeInTheDocument());
        await user.click(screen.getByRole("button", { name: /Save Changes/ }));
        await waitFor(() => expect(calls.some((call) => call.route.endsWith("/save"))).toBe(true));
        expect(calls.find((call) => call.route.endsWith("/save")).body.operations).toEqual([{ type: "reorder", setId: FRONTIER_SET, order: ["e1", "e2", "e0"] }]);
    });

    test("left/right arrows move only species peers, track the clicked spread, and revert its order", async () =>
    {
        const { user } = await openEditor();
        const wrappers = screen.getAllByRole("article", { name: "Charizard spread" }).map((card) => card.closest(".movable-spread"));
        const first = within(wrappers[0]);
        const last = within(wrappers[1]);
        expect(first.getByRole("button", { name: "Move Charizard Spread Left" })).toBeDisabled();
        expect(first.getByRole("button", { name: "Move Charizard Spread Right" })).toBeEnabled();
        expect(last.getByRole("button", { name: "Move Charizard Spread Left" })).toBeEnabled();
        expect(last.getByRole("button", { name: "Move Charizard Spread Right" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Move Venusaur Spread Left" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Move Venusaur Spread Right" })).toBeDisabled();
        await user.hover(first.getByRole("button", { name: "Move Charizard Spread Left" }).parentElement);
        expect(await screen.findByRole("tooltip")).toHaveTextContent("first spread in its species group");
        await user.unhover(first.getByRole("button", { name: "Move Charizard Spread Left" }).parentElement);

        await user.click(first.getByRole("button", { name: "Move Charizard Spread Right" }));
        expect(JSON.parse(localStorage.getItem(DRAFTS_STORAGE_KEY)).orders[FRONTIER_SET]).toEqual(["e2", "e1", "e0"]);
        expect(getCharizardControls("Modest").getByRole("button", { name: "Revert Charizard Spread Order" })).toBeInTheDocument();
        expect(screen.getAllByRole("button", { name: "Revert Charizard Spread Order" })).toHaveLength(1);
        await user.click(getCharizardControls("Modest").getByRole("button", { name: "Revert Charizard Spread Order" }));
        expect(screen.queryByRole("button", { name: /Save Changes/ })).not.toBeInTheDocument();

        await user.click(getCharizardControls("Adamant").getByRole("button", { name: "Move Charizard Spread Left" }));
        expect(JSON.parse(localStorage.getItem(DRAFTS_STORAGE_KEY)).orders[FRONTIER_SET]).toEqual(["e2", "e1", "e0"]);
        expect(getCharizardControls("Adamant").getByRole("button", { name: "Revert Charizard Spread Order" })).toBeInTheDocument();
        await user.click(getCharizardControls("Adamant").getByRole("button", { name: "Revert Charizard Spread Order" }));
        expect(screen.queryByRole("button", { name: /Save Changes/ })).not.toBeInTheDocument();
    });

    test("disables spread arrows for an uneditable source with an explanatory tooltip", async () =>
    {
        const spreads = createSpreads();
        spreads.entries[0].editable = false;
        const { user } = await openEditor(spreads);
        const first = within(screen.getAllByRole("article", { name: "Charizard spread" })[0].closest(".movable-spread"));
        const right = first.getByRole("button", { name: "Move Charizard Spread Right" });
        expect(first.getByRole("button", { name: "Move Charizard Spread Left" })).toBeDisabled();
        expect(right).toBeDisabled();
        await user.hover(right.parentElement);
        expect(await screen.findByRole("tooltip")).toHaveTextContent("This spread's source cannot be changed safely.");
    });

    test("a spread moved within its species gets its own Revert, and the edit dialog's Revert also puts it back", async () =>
    {
        const spreads = createSpreads();
        const natures = ["NATURE_HARDY", "NATURE_ADAMANT", "NATURE_BOLD", "NATURE_TIMID", "NATURE_MODEST"];
        const charizards = natures.map((nature, index) => ({ ...spreads.entries[0], id: `c${index}`, line: index + 1, fields: createFields({ nature }) }));
        spreads.entries = [...charizards, spreads.entries[1], ...spreads.entries.slice(3)];
        spreads.sets[0].entryIds = [...charizards.map((entry) => entry.id), "e1"];
        const natureOrder = () => within(screen.getByRole("region", { name: "Frontier Spreads spreads" })).getAllByRole("article")
            .map((card) => ["Venusaur", "Hardy", "Adamant", "Bold", "Timid", "Modest"].find((name) => card.textContent.includes(name)));
        const before = ["Hardy", "Adamant", "Bold", "Timid", "Modest", "Venusaur"];
        storeOrder(spreads, FRONTIER_SET, ["c1", "c2", "c3", "c0", "c4", "e1"], ["c0"]);
        const { user } = await openEditor(spreads);
        expect(natureOrder()).toEqual(["Adamant", "Bold", "Timid", "Hardy", "Modest", "Venusaur"]);
        expect(screen.getByRole("button", { name: /Save Changes \(1\)/ })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Revert Charizard Group Order" })).not.toBeInTheDocument();
        const reverts = screen.getAllByRole("button", { name: "Revert Charizard Spread Order" });
        expect(reverts).toHaveLength(1);
        expect(reverts[0].closest(".movable-spread")).toHaveTextContent("Hardy");
        await user.click(reverts[0]);
        expect(natureOrder()).toEqual(before);
        expect(screen.queryByRole("button", { name: /Save Changes/ })).not.toBeInTheDocument();

        cleanup();
        storeOrder(spreads, FRONTIER_SET, ["c1", "c2", "c3", "c0", "c4", "e1"], ["c0"]);
        const again = await openEditor(spreads);
        const moved = screen.getAllByRole("article", { name: "Charizard spread" }).find((card) => card.textContent.includes("Hardy"));
        await again.user.click(within(moved).getByRole("heading", { name: "Charizard" }));
        await again.user.click(within(screen.getByRole("dialog", { name: "Edit Charizard" })).getByRole("button", { name: "Revert Charizard" }));
        await again.user.click(within(screen.getByRole("dialog", { name: "Edit Charizard" })).getByRole("button", { name: "Done" }));
        await waitFor(() => expect(natureOrder()).toEqual(before));
    });

    test("reverting a moved group keeps a spread moved within it", async () =>
    {
        const spreads = createSpreads();
        const charizards = ["NATURE_HARDY", "NATURE_ADAMANT"].map((nature, index) => ({ ...spreads.entries[0], id: `c${index}`, line: index + 1, fields: createFields({ nature }) }));
        spreads.entries = [...charizards, spreads.entries[1], ...spreads.entries.slice(3)];
        spreads.sets[0].entryIds = ["c0", "c1", "e1"];
        const natureOrder = () => within(screen.getByRole("region", { name: "Frontier Spreads spreads" })).getAllByRole("article")
            .map((card) => ["Venusaur", "Hardy", "Adamant"].find((name) => card.textContent.includes(name)));
        storeOrder(spreads, FRONTIER_SET, ["c1", "c0", "e1"], ["c0"]);
        const { user } = await openEditor(spreads);
        await user.click(screen.getByRole("button", { name: "Move Charizard Group" }));
        await user.click(screen.getByRole("button", { name: "Move Here, at the end" }));
        expect(natureOrder()).toEqual(["Venusaur", "Adamant", "Hardy"]);
        expect(screen.getByRole("button", { name: "Revert Charizard Group Order" })).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Revert Charizard Group Order" }));
        expect(natureOrder()).toEqual(["Adamant", "Hardy", "Venusaur"]);
        expect(screen.queryByRole("button", { name: "Revert Charizard Group Order" })).not.toBeInTheDocument();
        expect(screen.getAllByRole("button", { name: "Revert Charizard Spread Order" })).toHaveLength(1);
    });

    test("places Move Here bars between groups that share a row", async () =>
    {
        const spreads = createSpreads();
        spreads.entries[2] = { ...spreads.entries[2], fields: { ...spreads.entries[2].fields, species: "SPECIES_GARCHOMP" } };
        const { user } = await openEditor(spreads);
        const rows = () => document.querySelectorAll(".spread-section .spread-row");
        await user.click(screen.getByRole("button", { name: "Move Charizard Group" }));
        expect(rows()).toHaveLength(1);
        expect(within(rows()[0]).getAllByRole("article")).toHaveLength(3);
        const gaps = within(rows()[0]).getAllByRole("button", { name: /^Move Here/ });
        expect(gaps.map((gap) => gap.getAttribute("aria-label"))).toEqual(["Move Here, before Garchomp", "Move Here, at the end"]);
        expect(gaps[0]).toHaveClass("group-gap-vertical");
        expect(gaps[1]).toHaveClass("group-gap-vertical");
        expect(screen.getAllByRole("button", { name: /^Move Here/ })).toHaveLength(2);
    });

    test("single-species rows use horizontal places after complete groups without duplicates", async () =>
    {
        const spreads = createSpreads();
        const charizards = Array.from({ length: 4 }, (_, index) =>
            ({ ...spreads.entries[0], id: `c${index}`, line: index + 1 }));
        spreads.entries = [...charizards, spreads.entries[1], { ...spreads.entries[2], fields: createFields({ species: "SPECIES_GARCHOMP" }) }, ...spreads.entries.slice(3)];
        spreads.sets[0].entryIds = [...charizards.map((entry) => entry.id), "e1", "e2"];
        const { user } = await openEditor(spreads);
        await user.click(screen.getByRole("button", { name: "Move Garchomp Group" }));
        const rows = [...document.querySelectorAll(".spread-section .spread-row")];
        expect(rows.map((row) => within(row).getAllByRole("article").length)).toEqual([3, 1, 2]);
        const beforeCharizard = screen.getByRole("button", { name: "Move Here, before Charizard" });
        const beforeVenusaur = screen.getByRole("button", { name: "Move Here, before Venusaur" });
        expect(beforeCharizard).not.toHaveClass("group-gap-vertical");
        expect(beforeVenusaur).not.toHaveClass("group-gap-vertical");
        expect(beforeCharizard.nextElementSibling).toBe(rows[0]);
        expect(beforeVenusaur.previousElementSibling).toBe(rows[1]);
        expect(beforeVenusaur.nextElementSibling).toBe(rows[2]);
        expect(screen.getAllByRole("button", { name: /^Move Here/ })).toHaveLength(2);
        expect(rows[0].querySelector(".group-gap-vertical")).toBeNull();
        expect(rows[1].querySelector(".group-gap-vertical")).toBeNull();
    });

    test("a shared row owns its vertical trailing place before a single-species row", async () =>
    {
        const spreads = createSpreads();
        const pichus = Array.from({ length: 3 }, (_, index) =>
            ({ ...spreads.entries[0], id: `p${index}`, line: 100 + index, fields: createFields({ species: "SPECIES_PICHU" }) }));
        spreads.entries = [spreads.entries[0], spreads.entries[1], { ...spreads.entries[2], fields: createFields({ species: "SPECIES_GARCHOMP" }) }, ...pichus, ...spreads.entries.slice(3)];
        spreads.sets[0].entryIds = ["e0", "e1", "e2", ...pichus.map((entry) => entry.id)];
        const { user } = await openEditor(spreads);
        await user.click(screen.getByRole("button", { name: "Move Charizard Group" }));
        const rows = [...document.querySelectorAll(".spread-section .spread-row")];
        const beforePichu = screen.getByRole("button", { name: "Move Here, before Pichu" });
        expect(beforePichu).toHaveClass("group-gap-vertical");
        expect(beforePichu.closest(".spread-row")).toBe(rows[0]);
        expect(screen.getAllByRole("button", { name: "Move Here, before Pichu" })).toHaveLength(1);
        const atEnd = screen.getByRole("button", { name: "Move Here, at the end" });
        expect(atEnd).not.toHaveClass("group-gap-vertical");
        expect(atEnd.previousElementSibling).toBe(rows[1]);
    });

    test("moving a species group marks only that group", async () =>
    {
        const spreads = createSpreads();
        spreads.entries[2] = { ...spreads.entries[2], fields: { ...spreads.entries[2].fields, species: "SPECIES_GARCHOMP" } };
        const { user } = await openEditor(spreads);
        await user.click(screen.getByRole("button", { name: "Move Garchomp Group" }));
        expect(screen.getAllByRole("button", { name: /^Move Here/ }).map((button) => button.getAttribute("aria-label")))
            .toEqual(["Move Here, before Charizard", "Move Here, before Venusaur"]);
        await user.click(screen.getByRole("button", { name: "Cancel Moving Garchomp Group" }));
        expect(screen.queryByRole("button", { name: /^Move Here/ })).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Move Garchomp Group" }));
        await user.click(screen.getByRole("button", { name: "Move Here, before Venusaur" }));
        expect(screen.getByRole("button", { name: /Save Changes \(1\)/ })).toBeInTheDocument();
        expect(screen.getAllByRole("button", { name: /Group Order$/ }).map((button) => button.getAttribute("aria-label")))
            .toEqual(["Revert Garchomp Group Order"]);
        expect(screen.queryByRole("button", { name: /^Revert (Charizard|Venusaur|Garchomp)$/ })).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Revert Garchomp Group Order" }));
        expect(screen.queryByRole("button", { name: /Save Changes/ })).not.toBeInTheDocument();
    });

    test("reverts a whole moved group of several spreads from its group heading", async () =>
    {
        const spreads = createSpreads();
        spreads.entries[2] = { ...spreads.entries[2], fields: { ...spreads.entries[2].fields, species: "SPECIES_GARCHOMP" } };
        const pichus = Array.from({ length: 4 }, (_, index) => ({ ...spreads.entries[1], id: `p${index}`, line: 50 + index,
            fields: createFields({ species: "SPECIES_PICHU", nature: "NATURE_TIMID" }) }));
        spreads.entries = [...pichus, ...spreads.entries];
        spreads.sets[0].entryIds = [...pichus.map((entry) => entry.id), ...spreads.sets[0].entryIds];
        const { user } = await openEditor(spreads);
        await user.click(screen.getByRole("button", { name: "Move Pichu Group" }));
        await user.click(screen.getByRole("button", { name: "Move Here, before Garchomp" }));
        expect(screen.getByRole("button", { name: /Save Changes \(4\)/ })).toBeInTheDocument();
        expect(screen.getAllByRole("button", { name: /Group Order$/ })).toHaveLength(1);
        await user.click(screen.getByRole("button", { name: "Revert Pichu Group Order" }));
        expect(screen.queryByRole("button", { name: /Save Changes/ })).not.toBeInTheDocument();
    });

    test("moves a spread to another set from the edit dialog, saving it as an add and a delete, and Revert brings it back", async () =>
    {
        const { user, calls } = await openEditor();
        await user.click(screen.getByRole("button", { name: "More Filters" }));
        const setFilter = screen.getByRole("combobox", { name: "Spread Set" });
        await user.click(setFilter.closest(".MuiAutocomplete-root").querySelector(".MuiAutocomplete-clearIndicator"));
        await user.click(screen.getAllByRole("article", { name: "Charizard spread" })[0]);
        const dialog = await screen.findByRole("dialog", { name: "Edit Charizard" });
        await user.click(within(dialog).getByRole("combobox", { name: "Spread Set" }));
        await user.click(await screen.findByRole("option", { name: "Little Cup Spreads (Lv. 5)" }));
        expect(within(screen.getByRole("dialog", { name: "Edit Charizard" })).getByRole("combobox", { name: "Spread Set" })).toHaveValue("Little Cup Spreads (Lv. 5)");
        await user.click(within(screen.getByRole("dialog", { name: "Edit Charizard" })).getByRole("button", { name: "Done" }));
        expect(within(screen.getByRole("region", { name: "Frontier Spreads spreads" })).getAllByRole("article")).toHaveLength(2);
        expect(within(screen.getByRole("region", { name: "Little Cup Spreads (Lv. 5) spreads" })).getAllByRole("article", { name: "Charizard spread" })).toHaveLength(1);
        expect(screen.getByRole("button", { name: /Save Changes \(1\)/ })).toBeInTheDocument();

        const movedCard = within(screen.getByRole("region", { name: "Little Cup Spreads (Lv. 5) spreads" })).getByRole("article", { name: "Charizard spread" });
        expect(within(movedCard).queryByRole("img", { name: "New Spread" })).not.toBeInTheDocument();
        await user.click(within(movedCard).getByRole("heading", { name: "Charizard" }));
        await user.click(within(screen.getByRole("dialog", { name: "Edit Charizard" })).getByRole("button", { name: "Revert Charizard" }));
        await waitFor(() => expect(within(screen.getByRole("region", { name: "Frontier Spreads spreads" })).getAllByRole("article")).toHaveLength(3));
        expect(screen.queryByRole("button", { name: /Save Changes/ })).not.toBeInTheDocument();

        await user.click(screen.getAllByRole("article", { name: "Charizard spread" })[0]);
        const again = await screen.findByRole("dialog", { name: "Edit Charizard" });
        await user.click(within(again).getByRole("combobox", { name: "Spread Set" }));
        await user.click(await screen.findByRole("option", { name: "Little Cup Spreads (Lv. 5)" }));
        await user.click(within(screen.getByRole("dialog", { name: "Edit Charizard" })).getByRole("button", { name: "Done" }));
        await user.click(screen.getByRole("button", { name: /Save Changes/ }));
        await waitFor(() => expect(calls.some((call) => call.route.endsWith("/save"))).toBe(true));
        const operations = calls.find((call) => call.route.endsWith("/save")).body.operations;
        expect(operations.map((operation) => [operation.type, operation.entryId ?? operation.setId])).toEqual([["delete", "e0"], ["add", LITTLE_CUP_SET]]);
        expect(operations[1].fields.species).toBe("SPECIES_CHARIZARD");
    });

    test("keeps a group being moved while changing pages", async () =>
    {
        const spreads = createSpreads();
        const species = ["SPECIES_PICHU", "SPECIES_GARCHOMP", "SPECIES_VENUSAUR"];
        const extra = Array.from({ length: 12 }, (_, index) => ({ ...spreads.entries[1], id: `x${index}`, line: 100 + index,
            fields: createFields({ species: species[index % species.length], nature: "NATURE_BOLD" }) }));
        spreads.entries = [spreads.entries[0], ...extra, ...spreads.entries.slice(3)];
        spreads.sets[0].entryIds = ["e0", ...extra.map((entry) => entry.id)];
        const { user } = await openEditor(spreads);
        expect(screen.queryByRole("button", { name: "Add Spread at the End" })).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Move Charizard Group" }));

        // The page's last place is before the first group on the next page
        const lastPlace = screen.getAllByRole("button", { name: /^Move Here/ }).at(-1).getAttribute("aria-label");
        expect(lastPlace).toMatch(/^Move Here, before /);
        await user.click(screen.getAllByRole("button", { name: "Go to next page" })[0]);
        expect(screen.getByText(/Choose Move Here where the Charizard group should go/)).toBeInTheDocument();
        expect(screen.getAllByRole("button", { name: /^Move Here/ })[0]).toHaveAccessibleName(lastPlace);
        expect(screen.queryByRole("button", { name: "Add Spread at the End" })).not.toBeInTheDocument();
        await user.click(screen.getAllByRole("button", { name: /^Move Here/ }).at(-1));
        expect(screen.queryByText(/Choose Move Here/)).not.toBeInTheDocument();
    });

    test("disables group movement when the set cannot reorder", async () =>
    {
        const spreads = createSpreads();
        spreads.sets[0].canReorder = false;
        const { user } = await openEditor(spreads);
        expect(screen.getByRole("button", { name: "Move Charizard Group" })).toBeDisabled();
        expect(screen.getAllByRole("button", { name: "Move Charizard Spread Left" }).every((button) => button.disabled)).toBe(true);
        expect(screen.getAllByRole("button", { name: "Move Charizard Spread Right" }).every((button) => button.disabled)).toBe(true);
        expect(screen.getAllByRole("button", { name: "Drag Charizard spread" })[0]).toBeEnabled();
        await user.click(screen.getByRole("button", { name: "More Filters" }));
        expect(screen.getByRole("combobox", { name: "Spread Set" })).toHaveValue("Frontier Spreads");
        expect(spreads.sets[1].id).toBe(LITTLE_CUP_SET);
    });

    test("restores new drafts and their order from local storage after reload", async () =>
    {
        const { user } = await openEditor();
        await addPichu(user);
        await user.click(screen.getByRole("button", { name: "Move Charizard Group" }));
        await user.click(screen.getByRole("button", { name: "Move Here, at the end" }));
        await user.click(within(screen.getByRole("dialog", { name: "Move Species Group?" })).getByRole("button", { name: "Move Group" }));
        const count = (await screen.findByRole("button", { name: /Save Changes/ })).textContent;
        await waitFor(() => expect(JSON.parse(localStorage.getItem(DRAFTS_STORAGE_KEY)).orders[FRONTIER_SET]).toEqual(["e1", "new-1", "e0", "e2"]));
        cleanup();
        await openEditor();
        expect(within(screen.getByRole("region", { name: "Frontier Spreads spreads" })).getByRole("img", { name: "New Spread" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Save Changes/ })).toHaveTextContent(count);
        expect(screen.getByRole("button", { name: "Revert Charizard Group Order" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Revert Order" })).toBeInTheDocument();
    });

    test("species filtering keeps dragging but disables whole-group moves", async () =>
    {
        const { user } = await openEditor();
        await user.click(screen.getByRole("button", { name: "More Filters" }));
        await user.click(screen.getByRole("combobox", { name: "Species" }));
        await user.click(await screen.findByRole("option", { name: "Charizard" }));
        expect(screen.getByRole("button", { name: "Move Charizard Group" })).toBeDisabled();
        expect(screen.getAllByRole("button", { name: "Drag Charizard spread" })[0]).toBeEnabled();
    });

    test.each(["Clear Filters", "Species control"])("restores group movement after species filtering using %s", async (clearMethod) =>
    {
        const { user } = await openEditor();
        await user.click(screen.getByRole("button", { name: "More Filters" }));
        expect(screen.getByRole("combobox", { name: "Spread Set" })).toHaveValue("Frontier Spreads");
        await user.click(screen.getByRole("combobox", { name: "Species" }));
        await user.click(await screen.findByRole("option", { name: "Charizard" }));
        const filteredMove = screen.getByRole("button", { name: "Move Charizard Group" });
        expect(filteredMove).toBeDisabled();
        await user.hover(filteredMove.parentElement);
        expect(await screen.findByRole("tooltip")).toHaveTextContent(HIDDEN_SPREADS_REASON);
        await user.unhover(filteredMove.parentElement);
        expect(getCharizardControls("Modest").getByRole("button", { name: "Move Charizard Spread Right" })).toBeEnabled();
        expect(getCharizardControls("Modest").getByRole("button", { name: "Drag Charizard spread" })).toBeEnabled();

        if (clearMethod === "Clear Filters")
            await user.click(screen.getByRole("button", { name: "Clear Filters" }));
        else
            await user.click(screen.getByRole("combobox", { name: "Species" }).closest(".MuiAutocomplete-root").querySelector(".MuiAutocomplete-clearIndicator"));

        const frontier = screen.getByRole("region", { name: "Frontier Spreads spreads" });
        const restoredMove = within(frontier).getByRole("button", { name: "Move Charizard Group" });
        expect(restoredMove).toBeEnabled();
        await user.hover(restoredMove.parentElement);
        expect(await screen.findByRole("tooltip")).toHaveTextContent(GROUP_MOVE_TOOLTIP);
        await user.unhover(restoredMove.parentElement);
        const controls = within(within(frontier).getAllByRole("article", { name: "Charizard spread" })[0].closest(".movable-spread"));
        expect(controls.getByRole("button", { name: "Move Charizard Spread Right" })).toBeEnabled();
        expect(controls.getByRole("button", { name: "Drag Charizard spread" })).toBeEnabled();
        await user.click(restoredMove);
        const places = screen.getAllByRole("button", { name: /^Move Here/ });
        expect(places.every((place) => frontier.contains(place))).toBe(true);
        await user.click(within(frontier).getByRole("button", { name: "Move Here, at the end" }));
        await user.click(within(screen.getByRole("dialog", { name: "Move Species Group?" })).getByRole("button", { name: "Move Group" }));
        expect(JSON.parse(localStorage.getItem(DRAFTS_STORAGE_KEY)).orders).toEqual({ [FRONTIER_SET]: ["e1", "e0", "e2"] });
    });

    test("clearing the default set filter enables each set's groups and cancels placement", async () =>
    {
        const { user } = await openEditor();
        expect(screen.getByRole("button", { name: "Move Charizard Group" })).toBeEnabled();
        await user.click(screen.getByRole("button", { name: "Move Charizard Group" }));
        expect(screen.getByRole("button", { name: "Cancel Moving Charizard Group" })).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Clear Filters" }));
        expect(screen.getAllByRole("region", { name: /spreads$/ })).toHaveLength(3);
        expect(screen.queryByRole("button", { name: /^Move Here/ })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /^Cancel Moving/ })).not.toBeInTheDocument();
        expect(screen.getAllByRole("button", { name: /^Move .* Group$/ }).every((button) => !button.disabled)).toBe(true);
        const palmer = screen.getByRole("region", { name: "Special Spread Palmer 1 spreads" });
        await user.click(within(palmer).getByRole("button", { name: "Move Garchomp Group" }));
        expect(screen.getAllByRole("button", { name: /^Move Here/ }).every((place) => palmer.contains(place))).toBe(true);
        await user.click(within(palmer).getByRole("button", { name: "Move Here, at the end" }));
        expect(JSON.parse(localStorage.getItem(DRAFTS_STORAGE_KEY)).orders).toEqual({ [PALMER_SET]: ["e5", "e4"] });
    });

    test("Revert Order discards order changes without discarding a new spread", async () =>
    {
        const { user } = await openEditor();
        await addPichu(user);
        expect(screen.queryByRole("button", { name: "Revert Order" })).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Move Charizard Group" }));
        await user.click(screen.getByRole("button", { name: "Move Here, at the end" }));
        await user.click(within(screen.getByRole("dialog", { name: "Move Species Group?" })).getByRole("button", { name: "Move Group" }));
        await user.click(await screen.findByRole("button", { name: "Revert Order" }));
        expect(screen.queryByRole("button", { name: "Revert Order" })).not.toBeInTheDocument();
        expect(JSON.parse(localStorage.getItem(DRAFTS_STORAGE_KEY)).orderMoves[FRONTIER_SET]).toBeUndefined();
        expect(screen.getByRole("button", { name: /Save Changes \(1\)/ })).toBeInTheDocument();
        expect(within(screen.getByRole("region", { name: "Frontier Spreads spreads" })).getByRole("img", { name: "New Spread" })).toBeInTheDocument();
    });
});
