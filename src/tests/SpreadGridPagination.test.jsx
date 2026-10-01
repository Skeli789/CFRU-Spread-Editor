import React from "react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import SpreadGrid from "../components/SpreadGrid";
import { FRONTIER_SET, LITTLE_CUP_SET, createSpreads } from "./EditorFixtures";

const PAGE_COUNT = 30;
const PAGE_SIZE = 12;
const FOUR_COLUMN_WIDTH = 1400;
const TEST_SPECIES = "SPECIES_CONKELDURR";
const dragEvents = vi.hoisted(() => ({ handlers: null, targets: new Map() }));

vi.mock("@dnd-kit/react", async (importOriginal) =>
{
    const original = await importOriginal();
    return (
    {
        ...original,
        /**
         * Captures provider events while retaining dnd-kit behavior.
         * @param {object} props The provider props.
         * @returns {JSX.Element} The provider.
         */
        DragDropProvider: (props) =>
        {
            dragEvents.handlers = props;
            return <original.DragDropProvider {...props} />;
        },
        /**
         * Records target eligibility for collision regression checks.
         * @param {object} input The droppable input.
         * @returns {object} The real droppable hook result.
         */
        useDroppable: (input) =>
        {
            dragEvents.targets.set(input.id, input);
            return original.useDroppable(input);
        },
    });
});

/**
 * Renders fixture spreads with every set available to the grid.
 * @param {object} [overrides] Grid prop overrides.
 * @returns {object} Render result and callbacks.
 */
function renderFixtureGrid(overrides = {})
{
    const snapshot = createSpreads();
    const onOrder = vi.fn();
    const onTransfer = vi.fn();
    const onAdd = vi.fn();
    const props =
    {
        spreads: snapshot.entries.map((entry) => ({ id: entry.id, setId: entry.setId, species: entry.fields.species })),
        renderCard: (id) => <div>{id}</div>,
        getSetHeading: (setId) => ({ title: setId, file: "test.h" }),
        pageSize: PAGE_SIZE,
        onPageSizeChange: vi.fn(),
        resetKey: "fixture",
        onClearFilters: vi.fn(),
        getSpeciesName: (species) => species,
        activeSet: null,
        allEntries: new Map(snapshot.entries.map((entry) => [entry.id, entry])),
        sets: new Map(snapshot.sets.map((set) => [set.id, set])),
        orders: {},
        onOrder,
        onRevertOrder: vi.fn(),
        onTransfer,
        getTransferProblem: () => "",
        onAdd,
        ...overrides,
    };
    return { ...render(<SpreadGrid {...props} />), props, onOrder, onTransfer, onAdd };
}

describe("Spread grid movement and section endings", () =>
{
    /**
     * Unmounts the grid and restores its measured width.
     * @returns {void} Nothing.
     */
    afterEach(() =>
    {
        cleanup();
        vi.restoreAllMocks();
    });

    /**
     * Checks spread-only widening with and without the insertion card.
     * @param {number} spreadCount The number of spreads in the row.
     * @param {boolean} withAdd Whether the Add Spread card is shown.
     * @param {number} columns The expected column count.
     * @returns {void} Nothing.
     */
    test.each([[2, true, 4], [3, true, 4], [3, false, 3], [2, false, 4]])(
        "uses %i spreads with Add card %s to produce %i columns at capacity four",
        (spreadCount, withAdd, columns) =>
        {
            vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(FOUR_COLUMN_WIDTH);
            const spreads = Array.from({ length: spreadCount }, (_, index) => ({ id: `spread-${index}`, species: TEST_SPECIES, setId: FRONTIER_SET }));
            const { container } = renderFixtureGrid({ spreads, onAdd: withAdd ? vi.fn() : null });
            const row = container.querySelector(".spread-row");
            expect(row.style.gridTemplateColumns).toBe(`repeat(${columns}, minmax(0, 1fr))`);
            expect(row.querySelectorAll(".movable-spread")).toHaveLength(spreadCount);
            expect(row.querySelectorAll(".add-spread-slot")).toHaveLength(withAdd ? 1 : 0);
        });

    test("handles peer and heading drop events without relying on drag highlight state", () =>
    {
        const { onOrder, onTransfer } = renderFixtureGrid();
        const source = { kind: "spread", id: "e0", setId: FRONTIER_SET, species: "SPECIES_CHARIZARD" };
        const target = { ...source, kind: "spreadTarget", id: "e2" };
        act(() => dragEvents.handlers.onDragEnd({ operation: { source: { data: source }, target: { data: target } } }));
        expect(onOrder).toHaveBeenCalledWith(FRONTIER_SET, ["e2", "e1", "e0"], "e0", ["e0"]);
        act(() => dragEvents.handlers.onDragEnd({ operation: { source: { data: source }, target: { data: { kind: "setTarget", setId: LITTLE_CUP_SET } } } }));
        expect(onTransfer).toHaveBeenCalledWith("e0", LITTLE_CUP_SET, null);
        onOrder.mockClear();
        act(() => dragEvents.handlers.onDragEnd({ canceled: true, operation: { source: { data: source }, target: { data: target } } }));
        expect(onOrder).not.toHaveBeenCalled();
    });

    test("excludes self and incompatible peers from collision detection", () =>
    {
        renderFixtureGrid();
        const source = { kind: "spread", id: "e0", setId: FRONTIER_SET, species: "SPECIES_CHARIZARD" };
        act(() => dragEvents.handlers.onDragStart({ operation: { source: { data: source } } }));
        expect(dragEvents.targets.get("spreadTarget:e0").disabled).toBe(true);
        expect(dragEvents.targets.get("spreadTarget:e1").disabled).toBe(true);
        expect(dragEvents.targets.get("spreadTarget:e2").disabled).toBe(false);
        expect(dragEvents.targets.get(`setTarget:${FRONTIER_SET}`).disabled).toBe(true);
        expect(dragEvents.targets.get(`setTarget:${LITTLE_CUP_SET}`).disabled).toBe(false);
    });

    test("checks hidden spreads and reorder restrictions independently for each visible set", async () =>
    {
        const user = userEvent.setup();
        const snapshot = createSpreads();
        snapshot.sets[1].canReorder = false;
        const { props, rerender } = renderFixtureGrid(
        {
            spreads: snapshot.entries.filter((entry) => entry.id !== "e1").map((entry) => ({ id: entry.id, setId: entry.setId, species: entry.fields.species })),
            sets: new Map(snapshot.sets.map((set) => [set.id, set])),
        });
        const frontier = screen.getByRole("region", { name: `${FRONTIER_SET} spreads` });
        const move = within(frontier).getByRole("button", { name: "Move SPECIES_CHARIZARD Group" });
        expect(move).toBeDisabled();
        await user.hover(move.parentElement);
        expect(await screen.findByRole("tooltip")).toHaveTextContent("Some spreads are hidden by the filters.");
        await user.unhover(move.parentElement);
        const blocked = screen.getByRole("button", { name: "Move SPECIES_PICHU Group" });
        expect(blocked).toBeDisabled();
        await user.hover(blocked.parentElement);
        expect(await screen.findByRole("tooltip")).toHaveTextContent("This spread set cannot be reordered safely.");
        await user.unhover(blocked.parentElement);
        expect(within(screen.getAllByRole("region")[2]).getByRole("button", { name: "Move SPECIES_CHARIZARD Group" })).toBeEnabled();

        rerender(<SpreadGrid {...props} hiddenIds={new Set(["e1"])} />);
        expect(within(frontier).getByRole("button", { name: "Move SPECIES_CHARIZARD Group" })).toBeEnabled();
    });

    test("refreshes peer drop targets and cancels invalid group placement when visible results change", async () =>
    {
        const user = userEvent.setup();
        const { props, rerender, onOrder } = renderFixtureGrid();
        const frontier = screen.getByRole("region", { name: `${FRONTIER_SET} spreads` });
        await user.click(within(frontier).getByRole("button", { name: "Move SPECIES_CHARIZARD Group" }));
        expect(screen.getByRole("button", { name: "Move Here, at the end" })).toBeInTheDocument();
        const source = { kind: "spread", id: "e0", setId: FRONTIER_SET, species: "SPECIES_CHARIZARD" };
        act(() => dragEvents.handlers.onDragStart({ operation: { source: { data: source } } }));
        expect(dragEvents.targets.get("spreadTarget:e2").disabled).toBe(false);
        rerender(<SpreadGrid {...props} spreads={props.spreads.filter((item) => item.id !== "e2")} />);
        expect(screen.queryByRole("button", { name: /^Move Here/ })).not.toBeInTheDocument();
        expect(within(frontier).getByRole("button", { name: "Move SPECIES_CHARIZARD Spread Right" })).toBeDisabled();
        const target = { ...source, kind: "spreadTarget", id: "e2" };
        act(() => dragEvents.handlers.onDragEnd({ operation: { source: { data: source }, target: { data: target } } }));
        expect(onOrder).not.toHaveBeenCalled();

        rerender(<SpreadGrid {...props} resetKey="cleared" />);
        expect(screen.queryByRole("button", { name: /^Move Here/ })).not.toBeInTheDocument();
        expect(within(frontier).getByRole("button", { name: "Move SPECIES_CHARIZARD Group" })).toBeEnabled();
        const buttons = within(frontier).getAllByRole("button", { name: "Move SPECIES_CHARIZARD Spread Right" });
        expect(buttons[0]).toBeEnabled();
        act(() => dragEvents.handlers.onDragStart({ operation: { source: { data: source } } }));
        expect(dragEvents.targets.get("spreadTarget:e2").disabled).toBe(false);
        act(() => dragEvents.handlers.onDragEnd({ operation: { source: { data: source }, target: { data: target } } }));
        expect(onOrder).toHaveBeenCalledWith(FRONTIER_SET, ["e2", "e1", "e0"], "e0", ["e0"]);
    });

    test("appends a card to every completed section and selects its set", async () =>
    {
        const user = userEvent.setup();
        const { onAdd } = renderFixtureGrid();
        const sections = screen.getAllByRole("region");
        expect(screen.getAllByRole("button", { name: "Add Spread at the End" })).toHaveLength(3);
        for (const section of sections)
        {
            const button = within(section).getByRole("button", { name: "Add Spread at the End" });
            expect(button.closest(".spread-row")).toBe(section.querySelector(".spread-row:last-child"));
            await user.click(button);
            expect(onAdd).toHaveBeenLastCalledWith(section.getAttribute("aria-label").replace(/ spreads$/, ""));
        }
    });

    test("only adds cards for sections ending on the current page", async () =>
    {
        const user = userEvent.setup();
        renderFixtureGrid({ pageSize: 3 });
        expect(screen.getAllByRole("button", { name: "Add Spread at the End" })).toHaveLength(1);
        await user.click(screen.getAllByRole("button", { name: "Go to next page" })[0]);
        expect(screen.getAllByRole("button", { name: "Add Spread at the End" })).toHaveLength(2);
    });

    test("disables insertion with the set's explanatory tooltip", async () =>
    {
        const user = userEvent.setup();
        const snapshot = createSpreads();
        snapshot.sets[0].canInsert = false;
        snapshot.sets[0].insertBlockedReason = "Fixed-size array";
        renderFixtureGrid({ sets: new Map(snapshot.sets.map((set) => [set.id, set])) });
        const button = within(screen.getByRole("region", { name: `${FRONTIER_SET} spreads` })).getByRole("button", { name: "Add Spread at the End" });
        expect(button).toBeDisabled();
        await user.hover(button.parentElement);
        expect(await screen.findByRole("tooltip")).toHaveTextContent("Fixed-size array");
    });
});

/**
 * Creates distinct species for a thirty-page grid.
 *
 * @returns {Array<object>} The test spreads.
 */
function createPages()
{
    return Array.from({ length: PAGE_COUNT * PAGE_SIZE }, (_, index) => ({ id: `spread-${index}`, species: `SPECIES_${index}`, setId: "set" }));
}

describe("Spread grid page jump", () =>
{
    test("opens from the ellipsis, validates input, caps the page and submits on Enter", async () =>
    {
        const user = userEvent.setup();
        render(<SpreadGrid spreads={createPages()} pageSize={PAGE_SIZE} resetKey="initial" renderCard={(id) => <div>{id}</div>}
                            getSetHeading={() => ({ title: "Spreads", file: "test.h" })} onPageSizeChange={() => {}} onClearFilters={() => {}}
                            getSpeciesName={(species) => species} activeSet={null} allEntries={new Map()} orders={{}}
                            onOrder={() => {}} onRevertOrder={() => {}} />);

        await user.click(screen.getAllByRole("button", { name: "Jump to Page" })[0]);
        const dialog = screen.getByRole("dialog", { name: `Jump to Page (${PAGE_COUNT} Pages)` });
        const input = within(dialog).getByRole("spinbutton", { name: "Page" });
        expect(within(dialog).queryByText(`Page (1-${PAGE_COUNT})`)).not.toBeInTheDocument();
        expect(within(dialog).getByRole("button", { name: "Go" })).toHaveClass("MuiButton-colorFocus");
        await waitFor(() => expect(input).toHaveFocus());
        await user.type(input, "3", { skipClick: true });
        expect(input).toHaveValue(3);
        await user.clear(input);
        expect(within(dialog).getByRole("button", { name: "Go" })).toBeDisabled();
        await user.type(input, "1.5");
        expect(within(dialog).getByRole("button", { name: "Go" })).toBeDisabled();
        await user.clear(input);
        await user.type(input, "999{Enter}");
        await waitFor(() => expect(screen.queryByRole("dialog", { name: `Jump to Page (${PAGE_COUNT} Pages)` })).not.toBeInTheDocument());
        expect(screen.getByText(/^Showing \d/)).toHaveTextContent("Showing 349-360 of 360 spreads");

        await user.click(screen.getAllByRole("button", { name: "Jump to Page" })[0]);
        const nextDialog = screen.getByRole("dialog", { name: `Jump to Page (${PAGE_COUNT} Pages)` });
        await user.clear(within(nextDialog).getByRole("spinbutton"));
        await user.type(within(nextDialog).getByRole("spinbutton"), "999");
        expect(within(nextDialog).getByRole("spinbutton")).toHaveValue(PAGE_COUNT);
        await user.clear(within(nextDialog).getByRole("spinbutton"));
        await user.type(within(nextDialog).getByRole("spinbutton"), "0");
        await user.click(within(nextDialog).getByRole("button", { name: "Go" }));
        await waitFor(() => expect(screen.queryByRole("dialog", { name: `Jump to Page (${PAGE_COUNT} Pages)` })).not.toBeInTheDocument());
        expect(screen.getByText(/^Showing \d/)).toHaveTextContent("Showing 1-12 of 360 spreads");

        await user.click(screen.getAllByRole("button", { name: "Jump to Page" })[0]);
        await user.click(within(screen.getByRole("dialog", { name: `Jump to Page (${PAGE_COUNT} Pages)` })).getByRole("button", { name: "Cancel" }));
        await waitFor(() => expect(screen.queryByRole("dialog", { name: `Jump to Page (${PAGE_COUNT} Pages)` })).not.toBeInTheDocument());
        expect(screen.getByText(/^Showing \d/)).toHaveTextContent("Showing 1-12 of 360 spreads");
    });

    test("widens a row one card short of full unless its species continues on another row", () =>
    {
        const spreads = [..."AA", ..."BBBB"].map((species, index) => ({ id: `spread-${index}`, species, setId: "set" }));
        render(<SpreadGrid spreads={spreads} pageSize={PAGE_SIZE} resetKey="initial" renderCard={(id) => <div>{id}</div>}
                            getSetHeading={() => ({ title: "Spreads", file: "test.h" })} onPageSizeChange={() => {}} onClearFilters={() => {}}
                            getSpeciesName={(species) => species} activeSet={null} allEntries={new Map()} orders={{}}
                            onOrder={() => {}} onRevertOrder={() => {}} />);
        const columns = [...document.querySelectorAll(".spread-row")].map((row) => row.style.gridTemplateColumns);
        expect(columns).toEqual(["repeat(2, minmax(0, 1fr))", "repeat(3, minmax(0, 1fr))", "repeat(3, minmax(0, 1fr))"]);
    });
});
