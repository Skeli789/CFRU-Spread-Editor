import React from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios from "axios";
import { vi } from "vitest";

import App from "../App";
import { AddSpreadDialog, ExportSpreadsDialog, OverwriteSpreadDialog } from "../components/SpreadDialogs";
import { SETTINGS_STORAGE_KEY, SETTINGS_VERSION } from "../SpreadEditorState";
import { FRONTIER_SET, PATHS, createCatalog, createFields, createSpreads, createWorkspace, mockServer } from "./EditorFixtures";

vi.mock("axios", () => ({ default: { post: vi.fn() } }));

const GARCHOMP_SET = "Garchomp @ Life Orb\nAbility: Rough Skin\nEVs: 252 Atk / 4 SpD / 252 Spe\nAdamant Nature\n- Earthquake\n- Dragon Claw";

/**
 * Loads the editor with the standard fixture.
 *
 * @returns {Promise<object>} The user-event instance.
 */
async function openEditor()
{
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ version: SETTINGS_VERSION, paths: PATHS, gameId: "unbound" }));
    mockServer({ "/workspaces/load": () => createWorkspace("workspace-1", createSpreads()) });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: "Unbound menu" });
    return user;
}

/**
 * Opens the first Charizard spread for editing.
 *
 * @param {object} user The user-event instance.
 * @returns {Promise<HTMLElement>} The edit dialog.
 */
async function editCharizard(user)
{
    await user.click(screen.getAllByRole("article", { name: "Charizard spread" })[0]);
    return screen.findByRole("dialog", { name: "Edit Charizard" });
}

describe("Showdown export and overwrite", () =>
{
    beforeEach(() =>
    {
        localStorage.clear();
        axios.post.mockReset();
    });

    afterEach(() => cleanup());

    test("exports every matching spread as Showdown text and copies it", async () =>
    {
        const user = await openEditor();
        await user.click(screen.getByRole("button", { name: "Export" }));
        const dialog = screen.getByRole("dialog", { name: /Export 3 Spreads to Showdown/ });
        const text = within(dialog).getByRole("textbox", { name: "Showdown Text" });
        expect(text.value).toContain("Charizard @ Heavy-Duty Boots");
        expect(text.value).toContain("Venusaur @ Venusaurite");
        expect(text.value.split("\n\n")).toHaveLength(3);
        expect(within(dialog).getByRole("button", { name: "Copy" })).toHaveClass("MuiButton-colorFocus");
        await user.click(within(dialog).getByRole("button", { name: "Copy" }));
        expect(await navigator.clipboard.readText()).toBe(text.value);
    });

    test("copies the export text when it is clicked", async () =>
    {
        const user = await openEditor();
        await navigator.clipboard.writeText("");
        await user.click(screen.getByRole("button", { name: "Export" }));
        const text = within(screen.getByRole("dialog", { name: /Export 3 Spreads/ })).getByRole("textbox", { name: "Showdown Text" });
        await user.click(text);
        expect(await navigator.clipboard.readText()).toBe(text.value);
        expect(await screen.findByText("Copied to the clipboard.")).toBeInTheDocument();
    });

    test("exports one spread from its edit dialog", async () =>
    {
        const user = await openEditor();
        const editor = await editCharizard(user);
        await user.click(within(editor).getByRole("button", { name: "Spread Actions" }));
        await user.click(screen.getByRole("menuitem", { name: "Export to Showdown" }));
        const dialog = screen.getByRole("dialog", { name: "Export Charizard to Showdown" });
        const text = within(dialog).getByRole("textbox", { name: "Showdown Text" }).value;
        expect(text).toMatch(/^Charizard @ Heavy-Duty Boots/);
        expect(text).toContain("Modest Nature");
        expect(text.split("\n\n")).toHaveLength(1);
    });

    test("overwrites one spread from a pasted set, showing the current set as the placeholder", async () =>
    {
        const user = await openEditor();
        const editor = await editCharizard(user);
        await user.click(within(editor).getByRole("button", { name: "Spread Actions" }));
        await user.click(screen.getByRole("menuitem", { name: "Overwrite From Showdown" }));
        const dialog = screen.getByRole("dialog", { name: "Overwrite Charizard From Showdown" });
        const input = within(dialog).getByRole("textbox", { name: "Showdown Text" });
        expect(input.getAttribute("placeholder")).toMatch(/^Charizard @ Heavy-Duty Boots/);
        expect(input.getAttribute("placeholder")).toContain("Modest Nature");
        expect(within(dialog).queryByText(/replaces the species/)).not.toBeInTheDocument();
        expect(within(dialog).getByRole("button", { name: "Overwrite" })).toBeDisabled();
        await user.click(input);
        await user.paste(`${GARCHOMP_SET}\n\n${GARCHOMP_SET}`);
        expect(await within(dialog).findByText(/Paste exactly one set/)).toBeInTheDocument();
        await user.clear(within(dialog).getByRole("textbox", { name: "Showdown Text" }));
        await user.paste(GARCHOMP_SET);
        await waitFor(() => expect(within(dialog).getByRole("button", { name: "Overwrite" })).toBeEnabled());
        expect(within(dialog).queryByRole("list", { name: "Changes" })).not.toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: "Overwrite" }));
        await waitFor(() => expect(screen.queryByRole("dialog", { name: /Overwrite/ })).not.toBeInTheDocument());
        const edited = screen.getByRole("dialog", { name: "Edit Garchomp" });
        await user.click(within(edited).getByRole("button", { name: "Done" }));
        expect(screen.getByRole("button", { name: /Save Changes \(1\)/ })).toBeInTheDocument();
    });

    test("shows each imported warning and error as a separate bullet below its species", async () =>
    {
        const user = await openEditor();
        await user.click(screen.getByRole("button", { name: "Add Spread" }));
        const dialog = screen.getByRole("dialog", { name: "Add Spread" });
        await user.click(within(dialog).getByRole("tab", { name: "Import Showdown Text" }));
        const input = within(dialog).getByRole("textbox", { name: "Showdown Text" });
        await user.click(input);
        await user.paste("Charizard @ Missing Item\nAbility: Sand Veil\nMystery: Yes\n- Flamethrower\n\nRaichu-Mega-X @ Raichunite X\nAbility: Electric Surge\n- Flamethrower");
        const preview = await within(dialog).findByRole("list", { name: "Import Problems" });
        const heading = within(dialog).getByRole("heading", { name: "Import Problems" });
        expect(heading.tagName).toBe("H3");
        expect(heading).toHaveClass("MuiTypography-subtitle1", "import-preview-heading");
        expect(heading).toHaveStyle({ fontWeight: 600 });
        expect(within(heading).getByTestId("ErrorOutlineOutlinedIcon")).toHaveClass("MuiSvgIcon-colorError");
        expect(heading.nextElementSibling).toBe(preview);
        expect(preview).toHaveAttribute("aria-labelledby", heading.id);
        const sets = Array.from(preview.children);
        expect(sets).toHaveLength(2);
        expect(sets[0]).toHaveTextContent("1. Charizard (Skipped)");
        const messages = within(sets[0]).getAllByRole("listitem");
        expect(messages.map((message) => message.textContent)).toEqual([
            "Unknown item: Missing Item",
            "Unknown line: Mystery: Yes",
            "Sand Veil not available (using Blaze)",
        ]);
        expect(messages.every((message) => message.parentElement.tagName === "UL")).toBe(true);
        expect(sets[1]).toHaveTextContent("2. Raichu-Mega-X (Skipped)");
        expect(within(sets[1]).getAllByRole("listitem").map((message) => message.textContent)).toEqual([
            "Unknown species: Raichu-Mega-X", "Unknown item: Raichunite X",
        ]);
    });

    test("imports a species with an unavailable ability instead of skipping it", async () =>
    {
        const onImport = vi.fn();
        const user = userEvent.setup();
        render(<AddSpreadDialog sets={createSpreads().sets} defaultSetId={FRONTIER_SET} catalog={createCatalog()}
                                onAdd={vi.fn()} onImport={onImport} onClose={vi.fn()} />);
        await user.click(screen.getByRole("tab", { name: "Import Showdown Text" }));
        expect(screen.queryByRole("heading", { name: /Import Warnings|Import Problems/ })).not.toBeInTheDocument();
        await user.click(screen.getByRole("textbox", { name: "Showdown Text" }));
        await user.paste("Charizard\nAbility: Sand Veil\n- Flamethrower");
        const button = await screen.findByRole("button", { name: "Import 1 Spread" });
        const preview = screen.getByRole("list", { name: "Import Warnings" });
        const heading = screen.getByRole("heading", { name: "Import Warnings" });
        expect(heading).toHaveClass("MuiTypography-subtitle1", "import-preview-heading");
        expect(within(heading).getByTestId("WarningAmberIcon")).toHaveClass("MuiSvgIcon-colorWarning");
        expect(heading.nextElementSibling).toBe(preview);
        expect(preview).toHaveAttribute("aria-labelledby", heading.id);
        expect(preview).not.toHaveTextContent("Skipped");
        expect(preview).toHaveTextContent("Sand Veil not available (using Blaze)");
        await user.click(button);
        expect(onImport).toHaveBeenCalledWith(FRONTIER_SET, [expect.objectContaining({ species: "SPECIES_CHARIZARD", ability: 1 })]);
    });

    test.each([1, 3])("groups %i placeholder export failures and preserves other errors", (count) =>
    {
        const placeholder = createFields(
        {
            nature: 0, item: 0, ball: 0, ability: 0, specificTeamType: 0,
            hpIv: 0, atkIv: 0, defIv: 0, spAtkIv: 0, spDefIv: 0, spdIv: 0,
            moves: [0, 0, 0, 0], forSingles: false, forDoubles: false, modifyMovesDoubles: false,
        });
        const entries = Array.from({ length: count }, (_, index) => ({ id: `placeholder-${index}`, label: `Placeholder ${index}`, fields: placeholder, level: 50 }));
        entries.push({ id: "invalid", label: "Unknown Species", fields: createFields({ species: "SPECIES_UNKNOWN" }), level: 50 });
        entries.push({ id: "valid", label: "Valid Charizard", fields: createFields(), level: 50 });
        render(<ExportSpreadsDialog title="Export to Showdown" catalog={createCatalog()} entries={entries} onClose={vi.fn()} />);
        const alerts = screen.getAllByRole("alert");
        expect(alerts).toHaveLength(2);
        expect(alerts[0]).toHaveTextContent(count === 1 ? "1 placeholder was left out" : "3 placeholders were left out");
        const skipped = screen.getByRole("list", { name: "Spreads left out" });
        expect(within(skipped).getAllByRole("listitem")).toHaveLength(1);
        expect(skipped).toHaveTextContent("Unknown Species");
        expect(skipped).not.toHaveTextContent("Placeholder");
        expect(screen.getByRole("textbox", { name: "Showdown Text" }).value).toContain("Charizard @ Heavy-Duty Boots");
    });

    test("includes illegal spreads in the export text without a skipped-spread warning", () =>
    {
        const entries = [
            { id: "illegal", label: "Illegal Charizard", fields: createFields({ moves: ["MOVE_THUNDERBOLT", 0, 0, 0], hpEv: 252, atkEv: 252, spdEv: 252, hpIv: 40 }), level: 50 },
            { id: "empty", label: "Incomplete Charizard", fields: createFields({ moves: [0, 0, 0, 0] }), level: 50 },
        ];
        render(<ExportSpreadsDialog title="Export to Showdown" catalog={createCatalog()} entries={entries} onClose={vi.fn()} />);
        const text = screen.getByRole("textbox", { name: "Showdown Text" }).value;
        expect(text.split("\n\n")).toHaveLength(2);
        expect(text).toContain("- Thunderbolt");
        expect(text).toContain("EVs: 252 HP / 252 Atk / 252 Spe");
        expect(text).toContain("IVs: 40 HP");
        expect(screen.queryByRole("list", { name: "Spreads left out" })).not.toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Copy" })).toBeEnabled();
    });

    test("exports spreads with unknown moves without those moves", () =>
    {
        const entries = [{ id: "unknown", label: "Odd Charizard", fields: createFields({ moves: ["MOVE_UNKNOWN", "MOVE_FLAMETHROWER", 0, 0] }), level: 50 }];
        render(<ExportSpreadsDialog title="Export to Showdown" catalog={createCatalog()} entries={entries} onClose={vi.fn()} />);
        expect(screen.getByRole("textbox", { name: "Showdown Text" }).value).toContain("- Flamethrower");
        expect(screen.getByRole("list", { name: "Spreads exported without some moves" })).toHaveTextContent("Unknown move MOVE_UNKNOWN left out");
        expect(screen.queryByRole("list", { name: "Spreads left out" })).not.toBeInTheDocument();
    });

    test("shows only one alert when every export entry is a placeholder", () =>
    {
        const fields = createFields(
        {
            nature: "NATURE_HARDY", item: "ITEM_NONE", ability: 0,
            hpIv: 0, atkIv: 0, defIv: 0, spAtkIv: 0, spDefIv: 0, spdIv: 0,
            moves: [0, 0, 0, 0], forSingles: false, forDoubles: false, modifyMovesDoubles: false,
        });
        const entries = Array.from({ length: 3 }, (_, index) => ({ id: String(index), label: "Placeholder", fields, level: 50 }));
        render(<ExportSpreadsDialog title="Export to Showdown" catalog={createCatalog()} entries={entries} onClose={vi.fn()} />);
        expect(screen.getAllByRole("alert")).toHaveLength(1);
        expect(screen.getByRole("alert")).toHaveTextContent("3 placeholders were left out");
        expect(screen.queryByRole("list", { name: "Spreads left out" })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Copy" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Download" })).toBeDisabled();
    });

    test.each(["import", "overwrite"])("uses short unsupported-field warnings in %s", async (mode) =>
    {
        const user = userEvent.setup();
        const catalog = createCatalog();
        catalog.moves.MOVE_RETURN = { name: "Return" };
        if (mode === "import")
            render(<AddSpreadDialog sets={createSpreads().sets} defaultSetId={FRONTIER_SET} catalog={catalog}
                                    onAdd={vi.fn()} onImport={vi.fn()} onClose={vi.fn()} />);
        else
            render(<OverwriteSpreadDialog name="Charizard" catalog={catalog} fields={createFields()} saved={createFields()}
                                          teamTypes={[]} level={50} onApply={vi.fn()} onClose={vi.fn()} />);
        if (mode === "import")
            await user.click(screen.getByRole("tab", { name: "Import Showdown Text" }));
        await user.click(screen.getByRole("textbox", { name: "Showdown Text" }));
        await user.paste("Charizard\nAbility: Sand Veil\nLevel: 50\nHappiness: 0\nDynamax Level: 10\nTera Type: Fire\n- Return\n- Invisible Beam");
        const messages = ["Sand Veil not available (using Blaze)", "Invisible Beam not in this game (left out)",
            "Happiness not saved (affects Return/Frustration)", "Level 50 not saved", "Dynamax Level not saved", "Tera Type not saved"];
        for (const message of messages)
            expect(await screen.findByText(message, { exact: true })).toBeInTheDocument();
        expect(screen.queryByText("Happiness not saved", { exact: true })).not.toBeInTheDocument();
        expect(screen.queryByText(/cannot be saved/)).not.toBeInTheDocument();
        const dialog = screen.getByRole("dialog");
        expect(dialog.style.getPropertyValue("--theme")).toBe("");
        expect(dialog.querySelector(".MuiDialogContent-root").style.getPropertyValue("--theme")).toBe("");
    });

    test.each(["Add Spread", "Add Spread at the End"])("defaults to the only filtered species from %s and adds it with Enter", async (buttonName) =>
    {
        const user = await openEditor();
        await user.click(screen.getByRole("button", { name: "More Filters" }));
        await user.click(screen.getByRole("combobox", { name: "Species" }));
        await user.click(await screen.findByRole("option", { name: "Venusaur" }));
        await user.keyboard("{Escape}");
        await user.click(screen.getByRole("button", { name: buttonName }));
        const dialog = screen.getByRole("dialog", { name: "Add Spread" });
        const species = within(dialog).getByRole("combobox", { name: "Species" });
        expect(species).toHaveValue("Venusaur");
        await waitFor(() => expect(species).toHaveFocus());
        await user.keyboard("{Enter}");
        expect(await screen.findByRole("dialog", { name: "Add Venusaur" })).toBeInTheDocument();
    });

    test("does not default a species when multiple species are filtered", async () =>
    {
        const user = await openEditor();
        await user.click(screen.getByRole("button", { name: "More Filters" }));
        const filter = screen.getByRole("combobox", { name: "Species" });
        await user.click(filter);
        await user.click(await screen.findByRole("option", { name: "Venusaur" }));
        await user.click(filter);
        await user.click(await screen.findByRole("option", { name: "Charizard" }));
        await user.keyboard("{Escape}");
        await user.click(screen.getByRole("button", { name: "Add Spread" }));
        const dialog = screen.getByRole("dialog", { name: "Add Spread" });
        expect(within(dialog).getByRole("combobox", { name: "Species" })).toHaveValue("");
        expect(within(dialog).getByRole("button", { name: "Add", exact: true })).toBeDisabled();
    });

    test.each([undefined, "SPECIES_UNKNOWN", "SPECIES_CHARIZARD_MEGA_X"])("ignores an unavailable or battle-only default species: %s", async (defaultSpecies) =>
    {
        render(<AddSpreadDialog sets={createSpreads().sets} defaultSetId={FRONTIER_SET} defaultSpecies={defaultSpecies}
                                catalog={createCatalog()} onAdd={vi.fn()} onImport={vi.fn()} onClose={vi.fn()} />);
        const species = screen.getByRole("combobox", { name: "Species" });
        expect(species).toHaveValue("");
        await waitFor(() => expect(species).toHaveFocus());
        expect(screen.getByRole("button", { name: "Add", exact: true })).toBeDisabled();
    });
});
