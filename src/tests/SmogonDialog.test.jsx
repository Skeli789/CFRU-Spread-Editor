import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@mui/material/styles";
import axios from "axios";
import { vi } from "vitest";
import { readFileSync } from "node:fs";
import App from "../App";
import SmogonDialog from "../components/SmogonDialog";
import { AddSpreadDialog } from "../components/SpreadDialogs";
import { APP_THEME } from "../Theme";
import { SETTINGS_STORAGE_KEY, SETTINGS_VERSION } from "../SpreadEditorState";
import { resolveImportedSet } from "../../shared/showdown.mjs";
import { getHiddenPowerType } from "../../shared/pokemon-mechanics.mjs";
import { FRONTIER_SET, PATHS, apiError, createCatalog, createFields, createSpreads, mockServer } from "./EditorFixtures";

vi.mock("axios", () => ({ default: { post: vi.fn() } }));

const SPECIES = "SPECIES_CHARIZARD";
const TITLE = "Smogon Sets for Charizard";
const DESCRIPTION = "Keeps offensive pressure.\nUse Protect against faster foes.";
const SMOGON_ROUTE = "/smogon/sets";


/**
 * Creates formats with one singles set and one doubles set.
 *
 * @returns {object} The API response fixture.
 */
function response()
{
    return {
        formats: [{ id: "championsou", tab: "champions", category: "singles", label: "OU" },
            { id: "gen9doublesou", tab: "gen9", category: "doubles", label: "Doubles OU" }],
        sets: [{ format: "championsou", species: "Charizard", name: "Offense", description: DESCRIPTION,
            moveset: { moves: ["Flamethrower", "Air Slash"], ability: "Blaze", nature: "Timid", item: "Life Orb", evs: { hp: 2, spa: 32, spe: 32 } } },
        { format: "gen9doublesou", species: "Charizard", name: "Support", description: null,
            moveset: { moves: ["Flamethrower", "Protect"], ability: "Solar Power", nature: "Modest", item: "Leftovers" } }],
        stale: false,
        unavailable: [],
    };
}

/**
 * Renders the standalone browser with stable catalog and callbacks.
 *
 * @param {object} overrides Props to replace.
 * @returns {object} Props and user-event instance.
 */
function renderBrowser(overrides = {})
{
    const spreads = createSpreads();
    const props = { catalog: createCatalog(), species: SPECIES, set: spreads.sets[0], preview: { level: 50 }, teamTypes: spreads.teamTypes,
        loadSmogonSets: vi.fn().mockResolvedValue(response()), multiple: true, onAdd: vi.fn(), onChoose: vi.fn(), onClose: vi.fn(), ...overrides };
    const view = render(<ThemeProvider theme={APP_THEME}><SmogonDialog {...props} /></ThemeProvider>);
    return { ...props, user: userEvent.setup(), rerender: (updates) =>
        view.rerender(<ThemeProvider theme={APP_THEME}><SmogonDialog {...props} {...updates} /></ThemeProvider>) };
}

/**
 * Opens the provider-backed editor with a mocked Smogon route.
 *
 * @param {object} overrides Optional route handlers.
 * @returns {Promise<object>} User events and recorded requests.
 */
async function openEditor(overrides = {})
{
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ version: SETTINGS_VERSION, paths: PATHS, gameId: "unbound" }));
    const calls = mockServer({ [SMOGON_ROUTE]: () => response(), ...overrides });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: "Unbound menu" });
    return { user, calls };
}

describe("Smogon sets browser", () =>
{
    beforeEach(() =>
    {
        localStorage.clear();
        axios.post.mockReset();
    });

    afterEach(() => cleanup());

    test("enables Smogon only after an insertable set and species are chosen", async () =>
    {
        const user = userEvent.setup();
        const spreads = createSpreads();
        spreads.sets[0].canInsert = false;
        render(<ThemeProvider theme={APP_THEME}><AddSpreadDialog sets={spreads.sets} defaultSetId={FRONTIER_SET} defaultSpecies={SPECIES}
            catalog={createCatalog()} onAdd={vi.fn()} onImport={vi.fn()} onClose={vi.fn()} /></ThemeProvider>);
        expect(screen.getByRole("button", { name: "Smogon" })).toBeDisabled();
        await user.click(screen.getByRole("combobox", { name: "Spread Set" }));
        await user.click(screen.getByRole("option", { name: "Little Cup Spreads (Lv. 5)" }));
        expect(screen.getByRole("button", { name: "Smogon" })).toBeEnabled();
        await user.click(screen.getByRole("combobox", { name: "Species" }));
        await user.clear(screen.getByRole("combobox", { name: "Species" }));
        await user.keyboard("{Escape}");
        expect(screen.getByRole("button", { name: "Smogon" })).toBeDisabled();
        await user.click(screen.getByRole("tab", { name: "Import Showdown Text" }));
        expect(screen.queryByRole("button", { name: "Smogon" })).not.toBeInTheDocument();
    });

    test("defaults to usable tabs, disables empty tabs and shows description only where provided", async () =>
    {
        const { user, loadSmogonSets } = renderBrowser();
        await screen.findByRole("checkbox", { name: "Offense" });
        expect(loadSmogonSets).toHaveBeenCalledWith(["Charizard", "Mega Charizard X", "Mega Charizard Y"], expect.any(Function));
        expect(screen.getByRole("tab", { name: "Champions" })).toHaveAttribute("aria-selected", "true");
        expect(screen.getByRole("tab", { name: "SwSh" })).toBeDisabled();
        expect(screen.getByRole("tab", { name: "Doubles" })).toBeDisabled();
        fireEvent.click(screen.getByRole("tab", { name: "SwSh" }));
        fireEvent.click(screen.getByRole("tab", { name: "Doubles" }));
        expect(screen.getByRole("tab", { name: "Champions" })).toHaveAttribute("aria-selected", "true");
        expect(screen.getByRole("tab", { name: "Singles" })).toHaveAttribute("aria-selected", "true");
        const help = screen.getByRole("button", { name: "About Offense" });
        await user.hover(help);
        expect(await screen.findByRole("tooltip")).toHaveTextContent("View Explanation");
        expect(screen.queryByText(DESCRIPTION)).not.toBeInTheDocument();
        await user.unhover(help);
        await user.click(screen.getByRole("tab", { name: "SV" }));
        expect(screen.getByRole("tab", { name: "Doubles" })).toHaveAttribute("aria-selected", "true");
        expect(screen.queryByRole("button", { name: /About/ })).not.toBeInTheDocument();
    });

    test("toggles by click, Space and Enter, retains selection across tabs and adds in selection order", async () =>
    {
        const { user, onAdd } = renderBrowser();
        const offense = await screen.findByRole("checkbox", { name: "Offense" });
        expect(within(offense).queryByText(/Singles Only|Doubles Only|Singles & Doubles/)).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Add 0 Spreads" })).toBeDisabled();
        await user.click(offense);
        expect(offense).toHaveAttribute("aria-checked", "true");
        expect(within(offense).getByLabelText("Selected")).toHaveClass("smogon-check");
        offense.focus();
        await user.keyboard(" ");
        expect(offense).toHaveAttribute("aria-checked", "false");
        await user.click(screen.getByRole("tab", { name: "SV" }));
        const support = screen.getByRole("checkbox", { name: "Support" });
        expect(within(support).queryByText(/Singles Only|Doubles Only|Singles & Doubles/)).not.toBeInTheDocument();
        support.focus();
        await user.keyboard("{Enter}");
        await user.click(screen.getByRole("tab", { name: "Champions" }));
        await user.click(screen.getByRole("checkbox", { name: "Offense" }));
        await user.click(screen.getByRole("button", { name: "Add 2 Spreads" }));
        const fields = onAdd.mock.calls[0][0];
        expect(fields.map((value) => value.item)).toEqual(["ITEM_LEFTOVERS", "ITEM_LIFEORB"]);
        for (const value of fields)
            expect(value).toMatchObject({ forSingles: true, forDoubles: true, modifyMovesDoubles: true });
        expect(fields[1]).toMatchObject({ hpEv: 6, spAtkEv: 252, spdEv: 252 });
        expect(fields.map((value) => value.atkIv)).toEqual([31, 31]);
    });

    test("shows real determinate progress and ignores a request finishing after close", async () =>
    {
        let finish;
        let reportProgress;
        const load = vi.fn((names, onProgress) => new Promise((resolve) =>
        {
            finish = resolve;
            reportProgress = onProgress;
        }));
        const { onClose, user } = renderBrowser({ loadSmogonSets: load });
        expect(screen.getByRole("progressbar", { name: "Loading Smogon Sets..." })).toHaveAttribute("aria-valuenow", "0");
        await waitFor(() => expect(load).toHaveBeenCalled());
        act(() => reportProgress({ percentage: 37, label: "Loading Formats" }));
        expect(screen.getByRole("progressbar", { name: "Loading Formats" })).toHaveAttribute("aria-valuenow", "37");
        expect(screen.getByRole("status")).toHaveTextContent("Loading Formats 37%");
        await user.click(screen.getByRole("button", { name: "Close" }));
        expect(onClose).toHaveBeenCalledOnce();
        cleanup();
        await act(async () =>
        {
            reportProgress({ percentage: 90, label: "Finishing" });
            finish(response());
        });
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    test("retries errors and displays saved-cache and unavailable-format notes", async () =>
    {
        const load = vi.fn().mockRejectedValueOnce({ message: "Offline with no saved sets." })
            .mockResolvedValue({ ...response(), stale: true, unavailable: ["gen8ou"] });
        const { user } = renderBrowser({ loadSmogonSets: load });
        expect(await screen.findByText("Offline with no saved sets.")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Retry" }));
        await screen.findByRole("checkbox", { name: "Offense" });
        expect(load).toHaveBeenCalledTimes(2);
        expect(screen.getByText("Showing saved Smogon sets because they could not be refreshed.")).toBeInTheDocument();
        expect(screen.getByText(/Some Smogon formats are unavailable: gen8ou/)).toBeInTheDocument();
        expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    });

    test("resets progress on retry and ignores updates from failed requests", async () =>
    {
        const requests = [];
        const load = vi.fn((names, onProgress) => new Promise((resolve, reject) =>
        {
            requests.push({ onProgress, resolve, reject });
        }));
        const { user } = renderBrowser({ loadSmogonSets: load });
        await waitFor(() => expect(requests).toHaveLength(1));
        act(() => requests[0].onProgress({ percentage: 62, label: "Loading Analyses" }));
        await act(async () => requests[0].reject(new Error("Offline")));
        expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Retry" }));
        await waitFor(() => expect(requests).toHaveLength(2));
        act(() => requests[0].onProgress({ percentage: 99, label: "Old Request" }));
        expect(screen.getByRole("progressbar", { name: "Loading Smogon Sets..." })).toHaveAttribute("aria-valuenow", "0");
        act(() => requests[1].onProgress({ percentage: 48, label: "Loading Sets" }));
        expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "48");
        await act(async () => requests[1].resolve(response()));
        act(() => requests[1].onProgress({ percentage: 100, label: "Late Update" }));
        expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
        expect(screen.getByRole("checkbox", { name: "Offense" })).toBeInTheDocument();
    });

    test("resets progress and ignores the old species request after a species change", async () =>
    {
        const requests = [];
        const load = vi.fn((names, onProgress) => new Promise((resolve) =>
        {
            requests.push({ names, onProgress, resolve });
        }));
        const { rerender } = renderBrowser({ loadSmogonSets: load });
        await waitFor(() => expect(requests).toHaveLength(1));
        act(() => requests[0].onProgress({ percentage: 71, label: "Loading Charizard" }));
        rerender({ species: "SPECIES_BULBASAUR" });
        await waitFor(() => expect(requests).toHaveLength(2));
        await act(async () =>
        {
            requests[0].onProgress({ percentage: 98, label: "Old Species" });
            requests[0].resolve(response());
        });
        expect(screen.getByRole("progressbar", { name: "Loading Smogon Sets..." })).toHaveAttribute("aria-valuenow", "0");
        expect(screen.queryByRole("checkbox", { name: "Offense" })).not.toBeInTheDocument();
        act(() => requests[1].onProgress({ percentage: 23, label: "Loading Bulbasaur" }));
        expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "23");
        await act(async () => requests[1].resolve({ ...response(), sets: [] }));
        expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    });

    test.each(["Close", "Escape", "Backdrop"])("%s dismisses only the explanation and preserves selection", async (method) =>
    {
        const { user, onClose, onAdd, onChoose } = renderBrowser();
        const offense = await screen.findByRole("checkbox", { name: "Offense" });
        await user.click(offense);
        await user.click(screen.getByRole("button", { name: "About Offense" }));
        const explanation = screen.getByRole("dialog", { name: "Offense Explanation" });
        expect(within(explanation).getByText(/Keeps offensive pressure/).textContent).toBe(DESCRIPTION);
        expect(explanation.querySelector(".smogon-explanation-text").children).toHaveLength(0);
        if (method === "Close")
            await user.click(within(explanation).getByRole("button", { name: "Close" }));
        else if (method === "Escape")
            await user.keyboard("{Escape}");
        else
            await user.click(explanation.closest(".MuiDialog-root").querySelector(".MuiDialog-container"));
        await waitFor(() => expect(screen.queryByRole("dialog", { name: "Offense Explanation" })).not.toBeInTheDocument());
        expect(screen.getByRole("dialog", { name: TITLE })).toBeInTheDocument();
        expect(offense).toHaveAttribute("aria-checked", "true");
        expect(screen.getByRole("button", { name: "Add 1 Spread" })).toBeEnabled();
        expect(onClose).not.toHaveBeenCalled();
        expect(onAdd).not.toHaveBeenCalled();
        expect(onChoose).not.toHaveBeenCalled();
    });

    test.each(["{Enter}", " "])("%s opens an explanation without selecting the underlying card", async (key) =>
    {
        const { user, onChoose } = renderBrowser();
        const offense = await screen.findByRole("checkbox", { name: "Offense" });
        screen.getByRole("button", { name: "About Offense" }).focus();
        await user.keyboard(key);
        const explanation = screen.getByRole("dialog", { name: "Offense Explanation" });
        await user.click(within(explanation).getByRole("button", { name: "Close" }));
        expect(offense).toHaveAttribute("aria-checked", "false");
        expect(screen.getByRole("button", { name: "Add 0 Spreads" })).toBeDisabled();
        expect(onChoose).not.toHaveBeenCalled();
    });

    test("uses shared theme-aware tab contrast and compact wrapping tooltip and explanation styles", () =>
    {
        const source = readFileSync("src/components/SmogonDialog.jsx", "utf8");
        const css = readFileSync("src/styles/SpreadEditorPage.css", "utf8").replace(/\s+/g, " ");
        expect(source.match(/sx=\{FOCUS_TABS\}/g)).toHaveLength(2);
        expect(source).toContain('"& .MuiTab-root:not(.Mui-disabled)": { color: "text.primary", fontWeight: 500, opacity: 1 }');
        expect(source).toContain('"& .MuiTab-root.Mui-selected:not(.Mui-disabled)": { color: "focus.main", fontWeight: 600 }');
        expect(source).toContain('"& .MuiTab-root.Mui-disabled": { color: "text.disabled", fontWeight: 400, opacity: 0.45 }');
        expect(source).toContain('placement="top-start"');
        expect(css).toContain(".smogon-skipped-summary { display: inline-flex; align-self: flex-start; max-width: 100%; }");
        expect(css).toContain(".smogon-explanation-text { text-align: justify; white-space: pre-line; overflow-wrap: anywhere; }");
        expect(css).toContain('.smogon-choice[aria-disabled="true"] .smogon-explanation-button * { cursor: pointer; }');
    });

    test("opens an enabled overwrite choice's explanation without applying the overwrite", async () =>
    {
        const catalog = createCatalog();
        const fields = resolveImportedSet(catalog, { species: "Charizard", ...response().sets[1].moveset }).fields;
        const { user, onChoose, onClose } = renderBrowser({ catalog, multiple: false, currentFields: fields, savedFields: fields });
        const choice = await screen.findByRole("button", { name: "Offense" });
        expect(choice).not.toHaveAttribute("aria-disabled", "true");
        await user.click(screen.getByRole("button", { name: "About Offense" }));
        const explanation = screen.getByRole("dialog", { name: "Offense Explanation" });
        await user.click(within(explanation).getByRole("button", { name: "Close" }));
        expect(screen.getByRole("dialog", { name: TITLE })).toBeInTheDocument();
        expect(screen.getByText("Sets from Smogon University")).toBeInTheDocument();
        expect(onChoose).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });

    test("omits invalid variants, shows their errors and renders resolution warnings", async () =>
    {
        const data = response();
        data.sets.push({ ...data.sets[0], name: "Unavailable Item", moveset: { moves: ["Flamethrower"], item: "Missing Item" } });
        data.sets[0].moveset.moves.push("Ice Spinner");
        const { user } = renderBrowser({ loadSmogonSets: vi.fn().mockResolvedValue(data) });
        await screen.findByRole("checkbox", { name: "Offense" });
        expect(screen.queryByRole("checkbox", { name: "Unavailable Item" })).not.toBeInTheDocument();
        const skipped = screen.getByText("1 set could not be used");
        expect(skipped.tagName).toBe("SPAN");
        expect(skipped).toHaveAttribute("tabindex", "0");
        expect(skipped).toHaveClass("smogon-skipped-summary");
        expect(skipped).not.toHaveAttribute("role", "button");
        const matches = skipped.matches.bind(skipped);
        const focusVisible = vi.spyOn(skipped, "matches").mockImplementation((selector) => selector === ":focus-visible" || matches(selector));
        act(() => skipped.focus());
        expect(await screen.findByRole("tooltip")).toHaveTextContent("Unavailable Item: Unknown item");
        focusVisible.mockRestore();
        act(() => skipped.blur());
        await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
        await user.hover(skipped);
        expect(await screen.findByRole("tooltip")).toHaveTextContent("Unavailable Item: Unknown item");
        await user.unhover(screen.getByText("1 set could not be used"));
        await user.hover(screen.getByRole("img", { name: "Warnings for Offense" }));
        expect(await screen.findByRole("tooltip")).toHaveTextContent("Ice Spinner not in this game (left out)");
    });

    test("shows an empty result and defaults directly to the first available generation", async () =>
    {
        const data = response();
        data.sets = [data.sets[1]];
        renderBrowser({ loadSmogonSets: vi.fn().mockResolvedValue(data) });
        await screen.findByRole("checkbox", { name: "Support" });
        expect(screen.getByRole("tab", { name: "SV" })).toHaveAttribute("aria-selected", "true");
        cleanup();
        renderBrowser({ loadSmogonSets: vi.fn().mockResolvedValue({ ...data, sets: [] }) });
        expect(await screen.findByText("No Smogon sets for Charizard.")).toBeInTheDocument();
    });

    test("disables matching overwrites and explains the no-op", async () =>
    {
        const catalog = createCatalog();
        const data = response();
        data.sets = [data.sets[1]];
        data.sets[0].description = DESCRIPTION;
        const fields = resolveImportedSet(catalog, { species: "Charizard", ...data.sets[0].moveset }).fields;
        fields.atkIv = 0;
        const { user, onChoose } = renderBrowser({ catalog, multiple: false, currentFields: fields, savedFields: fields,
            loadSmogonSets: vi.fn().mockResolvedValue(data) });
        const choice = await screen.findByRole("button", { name: "Support" });
        expect(choice).toHaveAttribute("aria-disabled", "true");
        expect(choice).toHaveAttribute("tabindex", "-1");
        await user.click(choice);
        expect(onChoose).not.toHaveBeenCalled();
        await user.hover(choice);
        expect(await screen.findByRole("tooltip")).toHaveTextContent("This set matches the spread already.");
        await user.unhover(choice);
        await user.click(screen.getByRole("button", { name: "About Support" }));
        const explanation = screen.getByRole("dialog", { name: "Support Explanation" });
        expect(within(explanation).getByText(/Keeps offensive pressure/)).toBeInTheDocument();
        await user.click(within(explanation).getByRole("button", { name: "Close" }));
        expect(onChoose).not.toHaveBeenCalled();
        expect(screen.queryByRole("button", { name: /Add.*Spread/ })).not.toBeInTheDocument();
    });

    test.each([
        { name: "Singles Only", forSingles: true, forDoubles: false, modifyMovesDoubles: true },
        { name: "Doubles Only", forSingles: false, forDoubles: true, modifyMovesDoubles: false },
        { name: "Singles & Doubles (Exact)", forSingles: true, forDoubles: true, modifyMovesDoubles: false },
        { name: "Singles & Doubles (Modify)", forSingles: true, forDoubles: true, modifyMovesDoubles: true },
    ])("hides overwrite battle chips and preserves $name flags while lowering unused Attack", async ({ name, ...flags }) =>
    {
        const catalog = createCatalog();
        const fields = createFields(flags);
        const original = structuredClone(fields);
        const { user, onChoose } = renderBrowser({ catalog, multiple: false, currentFields: fields, savedFields: fields });
        const choice = await screen.findByRole("button", { name: "Offense" });
        expect(within(choice).queryByText(/Singles Only|Doubles Only|Singles & Doubles/)).not.toBeInTheDocument();
        await user.click(choice);
        expect(onChoose.mock.calls[0][0]).toMatchObject({ ...flags, atkIv: 0 });
        expect(fields).toEqual(original);
    });

    test("keeps an optimization-only overwrite selectable and lowers unused Attack", async () =>
    {
        const catalog = createCatalog();
        const data = response();
        data.sets = [data.sets[1]];
        const fields = resolveImportedSet(catalog, { species: "Charizard", ...data.sets[0].moveset }).fields;
        const { user, onChoose } = renderBrowser({ catalog, multiple: false, currentFields: fields, savedFields: fields,
            loadSmogonSets: vi.fn().mockResolvedValue(data) });
        const choice = await screen.findByRole("button", { name: "Support" });
        expect(choice).not.toHaveAttribute("aria-disabled", "true");
        expect(within(within(choice).getByRole("row", { name: /^Attack/ })).getAllByRole("cell")[2]).toHaveTextContent(/^0$/);
        await user.click(choice);
        expect(onChoose).toHaveBeenCalledWith({ ...fields, atkIv: 0 });
        expect(fields.atkIv).toBe(31);
    });

    test.each([
        { name: "special-only moves", moves: ["Flamethrower"], ivs: { spa: 12 }, expected: { atkIv: 0, spAtkIv: 31, spdIv: 31 } },
        { name: "physical-only moves", moves: ["Dragon Claw"], ivs: { atk: 12 }, expected: { atkIv: 31, spAtkIv: 0, spdIv: 31 } },
        { name: "Trick Room", moves: ["Flamethrower", "Trick Room"], expected: { atkIv: 0, spAtkIv: 31, spdIv: 0 } },
        { name: "Gyro Ball", moves: ["Gyro Ball"], expected: { atkIv: 31, spAtkIv: 0, spdIv: 0 } },
        { name: "unknown move details", moves: ["Air Slash"], ivs: { atk: 13, spa: 17 }, unknown: true,
            expected: { atkIv: 13, spAtkIv: 17, spdIv: 31 } },
    ])("previews and applies optimized IVs for $name using final moves and reset team type", async ({ moves, ivs, unknown, expected }) =>
    {
        const catalog = createCatalog();
        catalog.moves.MOVE_TRICKROOM = { ...catalog.moves.MOVE_PROTECT, name: "Trick Room" };
        if (unknown)
            catalog.moves.MOVE_AIRSLASH = { ...catalog.moves.MOVE_AIRSLASH, split: null };
        const data = response();
        data.sets = [{ ...data.sets[1], moveset: { ...data.sets[1].moveset, moves, ivs } }];
        const fields = createFields({ moves: ["MOVE_GYROBALL"], specificTeamType: 7, ball: "BALL_TYPE_MASTER_BALL" });
        const original = structuredClone(fields);
        const { user, onChoose } = renderBrowser({ catalog, multiple: false, currentFields: fields, savedFields: fields,
            loadSmogonSets: vi.fn().mockResolvedValue(data) });
        const choice = await screen.findByRole("button", { name: "Support" });
        const labels = { atkIv: "Attack", spAtkIv: "Sp. Atk", spdIv: "Speed" };
        for (const [field, value] of Object.entries(expected))
        {
            const row = within(choice).getAllByRole("row").find((candidate) => within(candidate).queryByRole("rowheader", { name: new RegExp(`^${labels[field]}`) }));
            expect(within(row).getAllByRole("cell")[2].textContent).toBe(String(value));
        }
        await user.click(choice);
        expect(onChoose).toHaveBeenCalledOnce();
        expect(onChoose.mock.calls[0][0]).toMatchObject({ ...expected, specificTeamType: "DOUBLES_ANY_TEAM", ball: fields.ball,
            forSingles: fields.forSingles, forDoubles: fields.forDoubles, modifyMovesDoubles: fields.modifyMovesDoubles });
        expect(onChoose.mock.calls[0][0].moves).toEqual(resolveImportedSet(catalog, { species: "Charizard", ...data.sets[0].moveset }).fields.moves);
        expect(fields).toEqual(original);
    });

    test("preserves Hidden Power type while optimizing attacking and slow Speed IVs", async () =>
    {
        const catalog = createCatalog();
        catalog.moves.MOVE_TRICKROOM = { ...catalog.moves.MOVE_PROTECT, name: "Trick Room" };
        const data = response();
        data.sets = [{ ...data.sets[1], moveset: { ...data.sets[1].moveset, moves: ["Hidden Power Fire", "Trick Room"], ivs: { spa: 12 } } }];
        const resolved = resolveImportedSet(catalog, { species: "Charizard", ...data.sets[0].moveset }, { hiddenPower: "optimizeIvs" }).fields;
        const fields = createFields();
        const { user, onChoose } = renderBrowser({ catalog, multiple: false, currentFields: fields, savedFields: fields,
            loadSmogonSets: vi.fn().mockResolvedValue(data) });
        const choice = await screen.findByRole("button", { name: "Support" });
        await user.click(choice);
        const applied = onChoose.mock.calls[0][0];
        expect(applied.moves).toContain("MOVE_HIDDENPOWER");
        expect(getHiddenPowerType(resolved)).toBe("TYPE_FIRE");
        expect(getHiddenPowerType(applied)).toBe(getHiddenPowerType(resolved));
        expect([0, 1]).toContain(applied.atkIv);
        expect(applied.spAtkIv).toBe(30);
        expect([0, 1]).toContain(applied.spdIv);
        expect(applied).toMatchObject({ hpIv: resolved.hpIv, defIv: resolved.defIv, spDefIv: resolved.spDefIv });
        for (const [label, field] of [["Attack", "atkIv"], ["Sp. Atk", "spAtkIv"], ["Speed", "spdIv"]])
        {
            const row = within(choice).getAllByRole("row").find((candidate) => within(candidate).queryByRole("rowheader", { name: new RegExp(`^${label}`) }));
            expect(within(row).getAllByRole("cell")[2].textContent).toBe(String(applied[field]));
        }
    });

    test("adds selected sets through the session-aware API and closes both dialogs", async () =>
    {
        const { user, calls } = await openEditor();
        await user.click(screen.getByRole("button", { name: "Add Spread" }));
        const add = screen.getByRole("dialog", { name: "Add Spread" });
        expect(within(add).getByRole("button", { name: "Smogon" })).toBeDisabled();
        await user.click(within(add).getByRole("combobox", { name: "Species" }));
        await user.click(screen.getByRole("option", { name: "Charizard" }));
        await user.click(within(add).getByRole("button", { name: "Smogon" }));
        const dialog = screen.getByRole("dialog", { name: TITLE });
        await user.click(await within(dialog).findByRole("checkbox", { name: "Offense" }));
        await user.click(within(dialog).getByRole("tab", { name: "SV" }));
        await user.click(within(dialog).getByRole("checkbox", { name: "Support" }));
        await user.click(within(dialog).getByRole("button", { name: "Add 2 Spreads" }));
        await waitFor(() => expect(screen.queryByRole("dialog", { name: TITLE })).not.toBeInTheDocument());
        expect(screen.queryByRole("dialog", { name: "Add Spread" })).not.toBeInTheDocument();
        expect(await screen.findByText("Imported 2 spreads.")).toBeInTheDocument();
        expect(calls.find((call) => call.route === SMOGON_ROUTE)).toMatchObject({ token: "token-1", body: { species: ["Charizard", "Mega Charizard X", "Mega Charizard Y"] } });
        await user.click(screen.getByRole("button", { name: "Save Changes (2)" }));
        await waitFor(() => expect(calls.some((call) => call.route.endsWith("/save"))).toBe(true));
        const additions = calls.find((call) => call.route.endsWith("/save")).body.operations.filter((operation) => operation.type === "add");
        expect(additions).toHaveLength(2);
        for (const addition of additions)
            expect(addition.fields).toMatchObject({ forSingles: true, forDoubles: true, modifyMovesDoubles: true });
    });

    test("overwrites from the card menu on click, preserves the ball and battle type, and closes", async () =>
    {
        const { user, calls } = await openEditor();
        await user.click(screen.getAllByRole("article", { name: "Charizard spread" })[0]);
        const edit = await screen.findByRole("dialog", { name: "Edit Charizard" });
        await user.click(within(edit).getByRole("button", { name: "Spread Actions" }));
        await user.click(screen.getByRole("menuitem", { name: "Overwrite From Smogon" }));
        await user.click(await screen.findByRole("button", { name: "Offense" }));
        await waitFor(() => expect(screen.queryByRole("dialog", { name: TITLE })).not.toBeInTheDocument());
        expect(within(edit).getByRole("combobox", { name: "Nature" })).toHaveValue("Timid (+Spe, -Atk)");
        await user.click(within(edit).getByRole("button", { name: "Done" }));
        await user.click(screen.getByRole("button", { name: "Save Changes (1)" }));
        await waitFor(() => expect(calls.some((call) => call.route.endsWith("/save"))).toBe(true));
        const operation = calls.find((call) => call.route.endsWith("/save")).body.operations[0];
        expect(operation.fields).toMatchObject({ item: "ITEM_LIFEORB", nature: "NATURE_TIMID" });
        expect(operation.fields).not.toHaveProperty("ball");
        expect(operation.fields).not.toHaveProperty("forSingles");
        expect(operation.fields).not.toHaveProperty("forDoubles");
        expect(operation.fields).not.toHaveProperty("modifyMovesDoubles");
    });

    test("surfaces a session-aware 503 message with Retry", async () =>
    {
        const { user } = await openEditor({ [SMOGON_ROUTE]: () => { throw apiError(503, "SMOGON_UNAVAILABLE", "No cached Smogon sets while offline."); } });
        await user.click(screen.getAllByRole("article", { name: "Charizard spread" })[0]);
        const edit = await screen.findByRole("dialog", { name: "Edit Charizard" });
        await user.click(within(edit).getByRole("button", { name: "Spread Actions" }));
        await user.click(screen.getByRole("menuitem", { name: "Overwrite From Smogon" }));
        expect(await screen.findByText("No cached Smogon sets while offline.")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    });
});
