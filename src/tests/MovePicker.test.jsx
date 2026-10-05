import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { readFileSync } from "node:fs";

import ItemPicker, { getChooserItems, getItemTypeLabel } from "../subcomponents/ItemPicker";
import { TypeIcon } from "../subcomponents/CatalogDisplay";
import MoveEditor, { formatAccuracy, formatBoostedPower, formatPower, getChooserRows, getLearnableMoveOptions, getMoveOption } from "../subcomponents/MovePicker";
import { createCatalog, createFields } from "./EditorFixtures";
import { LEGALITY, getMoveLegality } from "../../shared/catalog.mjs";

const CATALOG = createCatalog();
const NAME_SORT = { key: "name", direction: "asc" };
const NO_FILTERS = { search: "", type: null, split: null, target: null, sort: NAME_SORT };
const EXTRA_MOVE_COUNT = 150;
const COSPLAY_SIGNATURES =
[
    ["SPECIES_PIKACHU_LIBRE", "Pikachu Libre", "MOVE_FLYINGPRESS", "Flying Press"],
    ["SPECIES_PIKACHU_ROCK_STAR", "Pikachu Rock Star", "MOVE_METEORMASH", "Meteor Mash"],
    ["SPECIES_PIKACHU_BELLE", "Pikachu Belle", "MOVE_ICICLECRASH", "Icicle Crash"],
    ["SPECIES_PIKACHU_POP_STAR", "Pikachu Pop Star", "MOVE_DRAININGKISS", "Draining Kiss"],
    ["SPECIES_PIKACHU_PHD", "Pikachu PhD", "MOVE_FLAMETHROWER", "Flamethrower"],
];

// Rendering a few hundred table rows is slow when every test file runs at once
const LONG_TEST_TIMEOUT = 30000;

test("left-aligns wrapped move names in the chooser", () =>
{
    const styles = readFileSync("src/styles/SpreadEditorPage.css", "utf8");
    const rule = styles.match(/\.move-table-select\s*\{([^}]+)\}/)[1];
    expect(rule).toMatch(/text-align:\s*left\s*!important/);
    expect(rule).toMatch(/justify-content:\s*flex-start\s*!important/);
});


/**
 * Creates a browser catalog with the server's form-local cosplay learnset shape.
 *
 * @returns {object} The synthetic Unbound catalog.
 */
function createCosplayCatalog()
{
    const catalog = { ...CATALOG, species: { ...CATALOG.species }, moves: { ...CATALOG.moves }, learnsets: { ...CATALOG.learnsets } };
    for (const [species, name, move, moveName] of COSPLAY_SIGNATURES)
    {
        catalog.species[species] = { ...CATALOG.species.SPECIES_CHARIZARD, name };
        catalog.moves[move] = { ...CATALOG.moves.MOVE_FLAMETHROWER, name: moveName };
        catalog.learnsets[species] = { status: "complete", moves: { [move]: ["formChange"] }, unknown: {} };
    }
    return catalog;
}

/**
 * Renders the move editor for a Charizard.
 *
 * @param {object} [fields] The spread's values.
 * @param {object} [catalog] The game catalog.
 * @returns {{user: object, onChange: Function}} The user-event instance and the change handler.
 */
function renderEditor(fields = createFields(), catalog = CATALOG)
{
    const onChange = vi.fn();
    render(<MoveEditor catalog={catalog} fields={fields} onChange={onChange} />);
    return { user: userEvent.setup(), onChange };
}

/**
 * Opens the Choose Moves dialog from a move slot.
 *
 * @param {object} user The user-event instance.
 * @param {number} [slot] The move slot, from 1.
 * @returns {Promise<HTMLElement>} The dialog.
 */
async function openChooser(user, slot = 1)
{
    await user.click(screen.getByRole("button", { name: `Advanced search for Move ${slot}` }));
    return screen.findByRole("dialog", { name: "Choose Moves for Charizard" });
}

/**
 * Returns the names of the listed autocomplete moves.
 *
 * @returns {Array<string>} The names.
 */
function getOptionNames()
{
    return screen.getAllByRole("option").map((option) => option.querySelector(".move-option-name").textContent);
}

/**
 * Returns the names of the moves in the Choose Moves table.
 *
 * @param {HTMLElement} dialog The dialog.
 * @returns {Array<string>} The names.
 */
function getRowNames(dialog)
{
    return [...dialog.querySelectorAll("[data-move-key]")].map((row) => within(row).getAllByRole("button")[0].textContent);
}

describe("Move options", () =>
{
    it("list learnable moves by name, with a Hidden Power for each type", () =>
    {
        const { options, complete } = getLearnableMoveOptions(CATALOG, "SPECIES_CHARIZARD");
        const names = options.map((option) => option.name);

        expect(complete).toBe(true);
        expect(names).toContain("Flamethrower");
        expect(names).not.toContain("Giga Drain");
        expect(names.filter((name) => name.startsWith("Hidden Power"))).toHaveLength(16);
        expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    });

    it("offer every move when the learnset is unknown", () =>
    {
        expect(getLearnableMoveOptions(CATALOG, "SPECIES_GARCHOMP").complete).toBe(false);
        expect(getLearnableMoveOptions(CATALOG, "SPECIES_GARCHOMP").options.map((option) => option.name)).toContain("Giga Drain");
    });

    it("show Hidden Power with the type its IVs give and keep unknown moves", () =>
    {
        expect(getMoveOption(CATALOG, createFields({ atkIv: 30, defIv: 30 }), "MOVE_HIDDENPOWER").name).toBe("Hidden Power [Ice]");
        expect(getMoveOption(CATALOG, createFields(), "MOVE_MISSING")).toMatchObject({ name: "MOVE_MISSING", type: null });
        expect(getMoveOption(CATALOG, createFields(), 0)).toBeNull();
    });

    it("tell no damage, variable power and always hitting apart", () =>
    {
        expect(formatPower(CATALOG.moves.MOVE_PROTECT)).toBe("-");
        expect(formatPower(CATALOG.moves.MOVE_GYROBALL)).toBe("Varies");
        expect(formatPower({ power: null })).toBe("?");
        expect(formatAccuracy(CATALOG.moves.MOVE_PROTECT)).toBe("-");
        expect(formatAccuracy(CATALOG.moves.MOVE_AIRSLASH)).toBe("95%");
        expect(formatBoostedPower(CATALOG.moves.MOVE_EARTHQUAKE, "zMovePower")).toBe("200");
        expect(formatBoostedPower(CATALOG.moves.MOVE_PROTECT, "maxMovePower")).toBe("-");
        expect(formatPower({ ...CATALOG.moves.MOVE_PROTECT, power: 80 })).toBe("-");
        expect(formatBoostedPower({ ...CATALOG.moves.MOVE_PROTECT, zMovePower: 180, maxMovePower: 130 }, "zMovePower")).toBe("-");
        expect(formatBoostedPower({ zMovePower: null }, "zMovePower")).toBe("?");
    });

    it("list learnable moves first, then moves starting with the search before those containing it", () =>
    {
        const learnable = getLearnableMoveOptions(CATALOG, "SPECIES_CHARIZARD");
        const rows = getChooserRows(CATALOG, learnable, { ...NO_FILTERS, search: "dr" });

        expect(rows.map((row) => [row.option.name, row.learnable])).toEqual([["Dragon Claw", true], ["Hidden Power [Dragon]", true], ["Giga Drain", false]]);
        expect(getChooserRows(CATALOG, learnable, NO_FILTERS).findIndex((row) => !row.learnable)).toBe(learnable.options.length);
    });

    it("never offers Struggle even when present in the catalog", () =>
    {
        const catalog = { ...CATALOG, moves: { ...CATALOG.moves, MOVE_STRUGGLE: { ...CATALOG.moves.MOVE_FLY, name: "Struggle" } } };
        expect(getChooserRows(catalog, getLearnableMoveOptions(catalog, "SPECIES_CHARIZARD"), NO_FILTERS).map((row) => row.option.name)).not.toContain("Struggle");
        expect(getLearnableMoveOptions(catalog, "SPECIES_GARCHOMP").options.map((option) => option.name)).not.toContain("Struggle");
    });

    it("shows only a labeled type symbol, not the banner image", () =>
    {
        const catalog = { ...CATALOG, types: { ...CATALOG.types, TYPE_FIRE: { name: "Fire", symbol: "/api/images/workspace-1/types/symbol/fire.png", icon: "/api/images/workspace-1/types/full/fire.png" } } };
        render(<TypeIcon catalog={catalog} type="TYPE_FIRE" />);
        expect(screen.getByRole("img", { name: "Fire" })).toHaveClass("type-symbol");
        expect(screen.getByRole("img", { name: "Fire" }).querySelector("img")).toHaveAttribute("src", expect.stringContaining("/api/images/workspace-1/types/symbol/fire.png"));
        expect(screen.queryByRole("img", { name: "Fire" }).querySelector("img")).not.toHaveAttribute("src", expect.stringContaining("/types/full/"));
    });

    it("shows the full type banner when requested", () =>
    {
        const catalog = { ...CATALOG, types: { ...CATALOG.types, TYPE_FIRE: { name: "Fire", symbol: "/api/images/workspace-1/types/symbol/fire.png", icon: "/api/images/workspace-1/types/full/fire.png" } } };
        render(<TypeIcon catalog={catalog} type="TYPE_FIRE" full />);
        expect(screen.getByRole("img", { name: "Fire" }).querySelector("img")).toHaveAttribute("src", expect.stringContaining("/api/images/workspace-1/types/full/fire.png"));
    });
});

describe("Move picker", () =>
{
    it.each(COSPLAY_SIGNATURES)("offers %s's signature in the inline picker and marks it legal in Choose Moves", async (species, name, move, moveName) =>
    {
        const catalog = createCosplayCatalog();
        const learnable = getLearnableMoveOptions(catalog, species);
        expect(learnable.complete).toBe(true);
        expect(learnable.options.map((option) => option.move)).toContain(move);
        expect(getChooserRows(catalog, learnable, NO_FILTERS).find((row) => row.option.move === move).learnable).toBe(true);
        expect(getMoveLegality(catalog, species, move).status).toBe(LEGALITY.ALLOWED);

        const { user } = renderEditor(createFields({ species, moves: [move, 0, 0, 0] }), catalog);
        const field = screen.getByRole("combobox", { name: "Move 1" });
        expect(field).toHaveValue(moveName);
        expect(field.closest(".move-input")).toHaveClass("move-status-allowed");
        await user.click(field);
        expect(screen.getByRole("option", { name: moveName })).not.toHaveClass("move-illegal");
        await user.keyboard("{Escape}");
        await user.click(screen.getByRole("button", { name: "Advanced search for Move 1" }));
        const dialog = await screen.findByRole("dialog", { name: `Choose Moves for ${name}` });
        expect(within(dialog).getByRole("button", { name: moveName }).closest("tr")).not.toHaveClass("move-illegal");
    });

    it("offers only learnable moves with type symbols and keeps an illegal current move highlighted", async () =>
    {
        const { user, onChange } = renderEditor(createFields({ moves: ["MOVE_FLY", 0, 0, 0] }));

        expect(screen.getByRole("combobox", { name: "Move 1" })).toHaveValue("Fly");
        expect(screen.getByRole("combobox", { name: "Move 1" }).closest(".move-input")).toHaveClass("move-status-illegal");

        await user.click(screen.getByRole("combobox", { name: "Move 1" }));
        const names = getOptionNames();
        expect(names).toContain("Fly");
        expect(names).not.toContain("Giga Drain");
        expect(screen.getByRole("option", { name: "Fly" })).toHaveClass("move-illegal");
        expect(screen.getByRole("option", { name: "Flamethrower" }).querySelector(".type-symbol")).not.toBeNull();

        await user.click(screen.getByRole("option", { name: "Hidden Power [Ice]" }));
        expect(onChange).toHaveBeenCalledWith(0, "MOVE_HIDDENPOWER", "TYPE_ICE");
    });

    it("lists moves starting with the search before those containing it", async () =>
    {
        const { user } = renderEditor(createFields({ moves: [0, 0, 0, 0] }));

        await user.type(screen.getByRole("combobox", { name: "Move 1" }), "dr");
        expect(getOptionNames()).toEqual(["Dragon Claw", "Hidden Power [Dragon]"]);
    });

    it("shows the selected move type symbol alongside the advanced button", () =>
    {
        renderEditor();
        const field = screen.getByRole("combobox", { name: "Move 1" });
        expect(field.closest(".MuiInputBase-root").querySelector(".type-symbol")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Advanced search for Move 1" })).toBeInTheDocument();
        expect(screen.getByRole("combobox", { name: "Move 2" }).closest(".MuiInputBase-root").querySelector(".type-symbol")).toBeInTheDocument();
    });
});

describe("Choose Moves dialog", () =>
{
    it("uses the full type banner in the move table without changing slot symbols", async () =>
    {
        const catalog = { ...CATALOG, types: { ...CATALOG.types, TYPE_FIRE: { name: "Fire", symbol: "/symbol.png", icon: "/banner.png" } } };
        const { user } = renderEditor(createFields(), catalog);
        const dialog = await openChooser(user);
        expect(dialog.querySelector("[data-move-key='MOVE_FLAMETHROWER'] .type-symbol img"))
            .toHaveAttribute("src", expect.stringContaining("banner.png"));
        expect(within(dialog).getByRole("textbox", { name: "Move 1" }).closest(".MuiInputBase-root").querySelector(".type-symbol img"))
            .toHaveAttribute("src", expect.stringContaining("symbol.png"));
    });

    it("fills each slot in turn from one list, learnable moves first", async () =>
    {
        const { user, onChange } = renderEditor();

        const dialog = await openChooser(user);
        expect(within(dialog).getByRole("textbox", { name: "Move 1" })).toHaveAttribute("aria-current", "true");
        expect(within(dialog).getByRole("textbox", { name: "Move 1" })).toHaveValue("Flamethrower");
        expect(within(dialog).getByRole("status")).toHaveTextContent("30 moves");

        // Moves the species cannot learn follow the learnable ones, highlighted but in the normal text color
        const names = getRowNames(dialog);
        expect(names.indexOf("Giga Drain")).toBeGreaterThan(names.indexOf("Scorching Sands"));
        expect(within(dialog).getByText("Moves Charizard can't learn")).toBeInTheDocument();
        expect(within(dialog).getByRole("button", { name: "Giga Drain" }).closest("tr")).toHaveClass("move-illegal");
        expect(within(dialog).getByRole("button", { name: "Giga Drain" })).toHaveClass("MuiButton-colorInherit");

        // Choosing a move moves on to the next slot, which takes the typing
        await user.click(within(dialog).getByRole("button", { name: "Earthquake" }));
        expect(onChange).toHaveBeenLastCalledWith(0, "MOVE_EARTHQUAKE", null);
        expect(within(dialog).getByRole("textbox", { name: "Move 2" })).toHaveAttribute("aria-current", "true");
        expect(within(dialog).getByRole("textbox", { name: "Move 2" })).toHaveFocus();
        expect(within(dialog).getByRole("textbox", { name: "Move 2" })).toHaveValue("Air Slash");
        expect(within(dialog).queryByRole("textbox", { name: "Search" })).not.toBeInTheDocument();

        await user.click(within(dialog).getByRole("textbox", { name: "Move 4" }));
        expect(within(dialog).getByRole("textbox", { name: "Move 4" })).toHaveAttribute("aria-current", "true");
        expect(within(dialog).getByRole("textbox", { name: "Move 4" })).toHaveFocus();
        expect(dialog.querySelector("[data-move-key='MOVE_PROTECT']")).toHaveClass("Mui-selected");

        await user.click(within(dialog).getByRole("button", { name: "Clear Move 3" }));
        expect(onChange).toHaveBeenLastCalledWith(2, null, null);
    }, LONG_TEST_TIMEOUT);

    it("returns the move list to the top when advancing to an empty slot", async () =>
    {
        const { user } = renderEditor(createFields({ moves: ["MOVE_FLAMETHROWER", 0, 0, 0] }));
        const dialog = await openChooser(user);
        const table = dialog.querySelector(".move-table");
        table.scrollTop = 200;
        await user.click(within(dialog).getByRole("button", { name: "Earthquake" }));
        expect(within(dialog).getByRole("textbox", { name: "Move 2" })).toHaveAttribute("aria-current", "true");
        expect(table.scrollTop).toBe(0);
        expect(within(dialog).getByRole("textbox", { name: "Move 2" })).toHaveFocus();
    });

    it("searches from the active slot and clears it with its adornment", async () =>
    {
        const { user, onChange } = renderEditor();
        const dialog = await openChooser(user);
        const slot = within(dialog).getByRole("textbox", { name: "Move 1" });
        expect(slot).toHaveFocus();
        await user.keyboard("air");
        expect(slot).toHaveValue("air");
        expect(getRowNames(dialog)).toEqual(["Air Slash"]);
        dialog.querySelector(".move-table").scrollTop = 200;
        await user.click(within(dialog).getByRole("button", { name: "Clear Move 1" }));
        expect(onChange).toHaveBeenLastCalledWith(0, null, null);
        expect(dialog.querySelector(".move-table").scrollTop).toBe(0);
        expect(slot).toHaveFocus();
    });

    it("keeps an untouched slot's move and moves on when Enter is pressed", async () =>
    {
        const { user, onChange } = renderEditor();
        const dialog = await openChooser(user);
        expect(dialog.querySelector('[data-highlighted="true"]')).toHaveAttribute("data-move-key", "MOVE_FLAMETHROWER");
        await user.keyboard("{Enter}");
        expect(onChange).not.toHaveBeenCalled();
        expect(within(dialog).getByRole("textbox", { name: "Move 2" })).toHaveAttribute("aria-current", "true");
        expect(within(dialog).getByRole("textbox", { name: "Move 2" })).toHaveFocus();
    });

    it("chooses the highlighted move when Enter is pressed on an empty slot", async () =>
    {
        const { user, onChange } = renderEditor(createFields({ moves: [0, 0, 0, 0] }));
        const dialog = await openChooser(user);
        const [move, type] = dialog.querySelector('[data-highlighted="true"]').dataset.moveKey.split(":");
        await user.keyboard("{Enter}");
        expect(onChange).toHaveBeenLastCalledWith(0, move, type ?? null);
    });

    it("starts arrow navigation from the active slot's move", async () =>
    {
        const { user } = renderEditor();
        const dialog = await openChooser(user);
        const keys = [...dialog.querySelectorAll("[data-move-key]")].map((row) => row.dataset.moveKey);
        await user.keyboard("{ArrowDown}");
        expect(dialog.querySelector('[data-highlighted="true"]')).toHaveAttribute("data-move-key", keys[keys.indexOf("MOVE_FLAMETHROWER") + 1]);
    });

    it("hides every power for status moves even when other powers are visible", async () =>
    {
        const { user } = renderEditor();
        const dialog = await openChooser(user);
        await user.click(within(dialog).getByRole("checkbox", { name: "Other Powers" }));
        const protect = dialog.querySelector("[data-move-key='MOVE_PROTECT']");
        expect([...protect.querySelectorAll("td")].slice(3, 6).map((cell) => cell.textContent)).toEqual(["-", "-", "-"]);
    });

    it("hides the power columns and disables Other Powers when filtering to status moves", async () =>
    {
        const { user } = renderEditor();
        const dialog = await openChooser(user);
        const table = within(dialog).getByRole("table", { name: "Moves" });
        await user.click(within(dialog).getByRole("checkbox", { name: "Other Powers" }));
        await user.click(within(dialog).getByRole("combobox", { name: "Category" }));
        await user.click(await screen.findByRole("option", { name: "Status" }));

        for (const column of ["Power", "Z-Power", "Max Power"])
            expect(within(table).queryByRole("button", { name: column })).not.toBeInTheDocument();
        expect(within(dialog).getByRole("checkbox", { name: "Other Powers" })).toBeDisabled();
    });

    it("filters by type, sorts by power and shows targets, Z-Move and Max Move powers", async () =>
    {
        const { user } = renderEditor();

        const dialog = await openChooser(user);
        await user.click(within(dialog).getByRole("combobox", { name: "Type" }));
        await user.click(await screen.findByRole("option", { name: "Ground" }));
        expect(getRowNames(dialog)).toEqual(["Earthquake", "Hidden Power [Ground]", "Scorching Sands"]);
        expect(within(dialog).getByRole("status")).toHaveTextContent("3 moves");

        const table = within(dialog).getByRole("table", { name: "Moves" });
        await user.click(within(table).getByRole("button", { name: "Power" }));
        expect(getRowNames(dialog)).toEqual(["Hidden Power [Ground]", "Scorching Sands", "Earthquake"]);
        await user.click(within(table).getByRole("button", { name: "Power" }));
        expect(getRowNames(dialog)).toEqual(["Earthquake", "Scorching Sands", "Hidden Power [Ground]"]);

        const earthquake = dialog.querySelector("[data-move-key='MOVE_EARTHQUAKE']");
        expect(within(earthquake).getByText("Foes And Ally")).toBeInTheDocument();
        expect(within(table).queryByRole("button", { name: "Z-Power" })).not.toBeInTheDocument();
        await user.click(within(dialog).getByRole("checkbox", { name: "Other Powers" }));
        expect(within(earthquake).getByText("200")).toBeInTheDocument();
        expect(within(earthquake).getByText("140")).toBeInTheDocument();
    });

    it("shows category symbols and names, formats Both Foes, and clears every filter", async () =>
    {
        const catalog = { ...CATALOG, moves: { ...CATALOG.moves, MOVE_BOTH: { ...CATALOG.moves.MOVE_FLY, name: "Both Move", target: "MOVE_TARGET_BOTH" } } };
        const { user } = renderEditor(createFields(), catalog);
        const dialog = await openChooser(user);
        const table = within(dialog).getByRole("table", { name: "Moves" });
        expect(within(table).getByRole("button", { name: "Category" })).toBeInTheDocument();
        expect(within(dialog.querySelector("[data-move-key='MOVE_EARTHQUAKE']")).getByRole("img", { name: "Physical" }).querySelector("img"))
            .toHaveAttribute("src", "https://play.pokemonshowdown.com/sprites/categories/Physical.png");
        expect(within(dialog.querySelector("[data-move-key='MOVE_BOTH']")).getByText("Both Foes")).toBeInTheDocument();

        await user.click(within(dialog).getByRole("combobox", { name: "Category" }));
        expect(screen.getByRole("option", { name: "Special" }).querySelector("img")).toHaveAttribute("src", "https://play.pokemonshowdown.com/sprites/categories/Special.png");
        await user.click(screen.getByRole("option", { name: "Physical" }));
        expect(within(dialog).getByRole("combobox", { name: "Category" }).closest(".MuiInputBase-root").querySelector(".type-symbol img"))
            .toHaveAttribute("src", "https://play.pokemonshowdown.com/sprites/categories/Physical.png");
        await user.click(within(dialog).getByRole("combobox", { name: "Type" }));
        await user.click(screen.getByRole("option", { name: "Ground" }));
        expect(within(dialog).getByRole("combobox", { name: "Type" }).closest(".MuiInputBase-root").querySelector(".type-symbol")).toBeInTheDocument();
        await user.click(within(dialog).getByRole("combobox", { name: "Target" }));
        await user.click(screen.getByRole("option", { name: "Foes And Ally" }));
        const slot = within(dialog).getByRole("textbox", { name: "Move 1" });
        await user.clear(slot);
        await user.type(slot, "earth");
        await user.click(within(dialog).getByRole("checkbox", { name: "Other Powers" }));
        await user.click(within(dialog).getByRole("button", { name: "Clear Filters" }));
        expect(slot).toHaveValue("Flamethrower");
        expect(within(dialog).getByRole("combobox", { name: "Type" })).toHaveValue("");
        expect(within(dialog).getByRole("combobox", { name: "Category" })).toHaveValue("");
        expect(within(dialog).getByRole("combobox", { name: "Target" })).toHaveValue("");
        expect(within(dialog).getByRole("checkbox", { name: "Other Powers" })).not.toBeChecked();
        expect(within(dialog).getByRole("status")).toHaveTextContent("31 moves");
    }, LONG_TEST_TIMEOUT);

    it("highlights matching moves, navigates with arrows, and selects with Enter", async () =>
    {
        const { user, onChange } = renderEditor(createFields({ moves: ["MOVE_FLAMETHROWER", "MOVE_PROTECT", 0, 0] }));
        const dialog = await openChooser(user);
        const selected = dialog.querySelector("[data-move-key='MOVE_PROTECT']");
        expect(selected).not.toHaveClass("Mui-selected");
        expect(window.getComputedStyle(selected).backgroundColor).toBe("rgba(142, 68, 173, 0.18)");

        const search = within(dialog).getByRole("textbox", { name: "Move 1" });
        dialog.querySelector(".move-table").scrollTop = 200;
        await user.clear(search);
        await user.type(search, "dr");
        expect(dialog.querySelector(".move-table").scrollTop).toBe(0);
        expect(dialog.querySelector('[data-highlighted="true"]')).toHaveAttribute("data-move-key", "MOVE_DRAGONCLAW");
        await user.keyboard("{ArrowDown}");
        expect(dialog.querySelector('[data-highlighted="true"]')).toHaveAttribute("data-move-key", "MOVE_HIDDENPOWER:TYPE_DRAGON");
        await user.keyboard("{ArrowUp}");
        expect(dialog.querySelector('[data-highlighted="true"]')).toHaveAttribute("data-move-key", "MOVE_DRAGONCLAW");
        await user.keyboard("{Enter}");
        expect(onChange).toHaveBeenLastCalledWith(0, "MOVE_DRAGONCLAW", null);
        const next = within(dialog).getByRole("textbox", { name: "Move 2" });
        expect(next).toHaveAttribute("aria-current", "true");
        expect(next).toHaveValue("Protect");
        expect(next.selectionStart).toBe(0);
        expect(next.selectionEnd).toBe("Protect".length);
        await user.keyboard("air");
        expect(next).toHaveValue("air");
    }, LONG_TEST_TIMEOUT);

    it("loads additional rows while navigating beyond the first page", async () =>
    {
        const extra = Object.fromEntries(Array.from({ length: EXTRA_MOVE_COUNT }, (_, index) =>
            [`MOVE_EXTRA_${index}`, { ...CATALOG.moves.MOVE_FLY, name: `Extra Move ${String(index).padStart(3, "0")}` }]));
        const catalog = { ...CATALOG, moves: { ...CATALOG.moves, ...extra } };
        const { user } = renderEditor(createFields(), catalog);
        const dialog = await openChooser(user);
        const search = within(dialog).getByRole("textbox", { name: "Move 1" });
        const rows = getChooserRows(catalog, getLearnableMoveOptions(catalog, "SPECIES_CHARIZARD"), NO_FILTERS);
        fireEvent.keyDown(search, { key: "End" });

        expect(dialog.querySelector('[data-highlighted="true"]')).toHaveAttribute("data-move-key", rows.at(-1).option.key);
        expect(getRowNames(dialog).length).toBeGreaterThan(100);
        fireEvent.keyDown(search, { key: "ArrowUp" });
        expect(dialog.querySelector('[data-highlighted="true"]')).toHaveAttribute("data-move-key", rows.at(-2).option.key);
        expect(dialog.querySelector(".move-table")).toBeInTheDocument();
    }, LONG_TEST_TIMEOUT);

    it("shows 100 moves at a time and loads more on request or when scrolled", async () =>
    {
        const extra = Object.fromEntries(Array.from({ length: EXTRA_MOVE_COUNT }, (_, index) =>
            [`MOVE_EXTRA_${index}`, { ...CATALOG.moves.MOVE_FLY, name: `Extra Move ${String(index).padStart(3, "0")}` }]));
        const { user } = renderEditor(createFields(), { ...CATALOG, moves: { ...CATALOG.moves, ...extra } });

        const dialog = await openChooser(user);
        expect(getRowNames(dialog)).toHaveLength(100);
        await user.click(within(dialog).getByRole("button", { name: "Load More" }));
        expect(getRowNames(dialog)).toHaveLength(180);
        expect(within(dialog).queryByRole("button", { name: "Load More" })).not.toBeInTheDocument();

        const slot = within(dialog).getByRole("textbox", { name: "Move 1" });
        await user.clear(slot);
        await user.type(slot, "e");
        expect(getRowNames(dialog)).toHaveLength(100);
        fireEvent.scroll(dialog.querySelector(".move-table"));
        expect(getRowNames(dialog).length).toBeGreaterThan(100);
    }, LONG_TEST_TIMEOUT);

    it("searches from the move list popup and returns focus to the slot when closed", async () =>
    {
        const { user } = renderEditor();

        await user.click(screen.getByRole("combobox", { name: "Move 2" }));
        await user.click(screen.getByRole("button", { name: "Advanced" }));
        const dialog = await screen.findByRole("dialog", { name: "Choose Moves for Charizard" });
        expect(within(dialog).getByRole("textbox", { name: "Move 2" })).toHaveAttribute("aria-current", "true");
        const slot = within(dialog).getByRole("textbox", { name: "Move 2" });
        await user.clear(slot);
        await user.type(slot, "air");
        expect(getRowNames(dialog)).toEqual(["Air Slash"]);

        await user.click(within(dialog).getByRole("button", { name: "Close" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        await waitFor(() => expect(screen.getByRole("combobox", { name: "Move 2" })).toHaveFocus());
    });
});

describe("Item picker", () =>
{
    it("names item types and lists items in sections by type with No Item first", () =>
    {
        expect(getItemTypeLabel("ITEM_TYPE_Z_CRYSTAL")).toBe("Z-Crystal");
        expect(getItemTypeLabel(null)).toBe("Other");
        expect(getChooserItems(CATALOG, "", null).map((option) => option.name)).toEqual(
            ["No Item", "Heavy-Duty Boots", "Leftovers", "Life Orb", "Charizardite X", "Charizardite Y", "Venusaurite", "Firium Z"]);
        expect(getChooserItems(CATALOG, "", "Mega Stone").map((option) => option.name)).toEqual(["Charizardite X", "Charizardite Y", "Venusaurite"]);
        expect(getChooserItems(CATALOG, "ite", null).map((option) => option.name)).toEqual(["No Item", "Charizardite X", "Charizardite Y", "Venusaurite"]);
        expect(getChooserItems(CATALOG, "or", null).map((option) => option.name)).toEqual(["Life Orb"]);
    });

    it("chooses an item from the sectioned dialog, filtered by item type", async () =>
    {
        const onChange = vi.fn();
        const user = userEvent.setup();
        render(<ItemPicker catalog={CATALOG} value="ITEM_HEAVYDUTYBOOTS" onChange={onChange} />);

        await user.click(screen.getByRole("combobox", { name: "Item" }));
        await user.click(screen.getByRole("button", { name: "Advanced" }));
        const dialog = await screen.findByRole("dialog", { name: "Choose Item" });
        expect(within(dialog).getAllByRole("listitem").filter((item) => item.classList.contains("item-list-heading")).map((item) => item.textContent))
            .toEqual(["Held Item", "Mega Stone", "Z-Crystal"]);
        expect(within(dialog).getByRole("button", { name: "Heavy-Duty Boots" })).toHaveClass("Mui-selected");

        await user.click(within(dialog).getByRole("combobox", { name: "Item Type" }));
        await user.click(await screen.findByRole("option", { name: "Mega Stone" }));
        expect(within(dialog).getByRole("status")).toHaveTextContent("3 items");

        await user.click(within(dialog).getByRole("button", { name: "Charizardite Y" }));
        expect(onChange).toHaveBeenCalledWith("ITEM_CHARIZARDITE_Y");
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });
});
