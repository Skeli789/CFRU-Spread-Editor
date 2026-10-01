import React, { useState } from "react";
import { readFileSync } from "node:fs";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, getContrastRatio } from "@mui/material/styles";
import { vi } from "vitest";

import { calculateSpreadStats, stepEv } from "../../shared/pokemon-mechanics.mjs";
import { getSuggestedSpread } from "../../shared/spread-suggestions.mjs";
import SpreadCard from "../components/SpreadCard";
import { EditSpreadDialog } from "../components/SpreadDialogs";
import { APP_THEME, DARK_APP_THEME } from "../Theme";
import { createCatalog, createFields, createSpreads } from "./EditorFixtures";

const PREVIEW = { level: 50 };
const HOLD_DURATION_MS = 1000;
const INITIAL_REPEAT_DELAY_MS = 150;
const REPEAT_INTERVAL_MS = 20;
const MIN_FAST_EV_CHANGE = 128;
const MIN_SUFFIX_CONTRAST = 3;
const SUFFIX_COLORS =
{
    modified: { light: "rgb(255, 204, 128)", dark: "rgb(143, 56, 0)" },
    exact: { light: "rgb(255, 255, 255)", dark: "rgb(0, 0, 0)" },
};
const EDIT_CARD_STACK_WIDTH = 595;
const EDIT_CARD_SIDE_WIDTH = 200;
const CARD_STYLES = readFileSync("src/styles/SpreadEditorPage.css", "utf8");


/**
 * Renders a card with a real catalog and spread fixture.
 *
 * @param {object} [options] Overrides for the card.
 * @returns {{card: HTMLElement, actions: object, user: object}} The card, actions and user.
 */
function renderCard(options = {})
{
    const spreads = createSpreads();
    const entry = spreads.entries[2];
    const actions = { updateSpread: vi.fn(), setEditing: vi.fn(), revertSpread: vi.fn(), deleteSpread: vi.fn(), restoreSpread: vi.fn() };
    const fields = options.fields ?? entry.fields;
    const cardProps =
    {
        entry, fields, set: spreads.sets[0], catalog: createCatalog(), teamTypes: spreads.teamTypes, preview: PREVIEW,
        editing: false, changed: false, problems: [], actions, ...options,
    };
    render(<ThemeProvider theme={options.theme ?? APP_THEME}><SpreadCard {...cardProps} /></ThemeProvider>);
    return { card: screen.getByRole("article", { name: "Charizard spread" }), actions, user: userEvent.setup() };
}

/**
 * Checks whether one element occurs before another in the card.
 *
 * @param {Element} first The first element.
 * @param {Element} second The second element.
 * @returns {boolean} Whether the first element precedes the second.
 */
function precedes(first, second)
{
    return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
}

/**
 * Applies held-button changes to real card state.
 *
 * @param {object} props The component props.
 * @param {object} props.initialFields The starting fields.
 * @returns {JSX.Element} The editable card.
 */
function HeldStatCard({ initialFields })
{
    const [fields, setFields] = useState(initialFields);
    const spreads = createSpreads();
    const actions =
    {
        updateSpread: (id, change) => setFields((current) => change(current, initialFields)),
        setEditing: vi.fn(),
    };

    return (
        <ThemeProvider theme={APP_THEME}>
            <SpreadCard entry={spreads.entries[2]} fields={fields} set={spreads.sets[0]} catalog={createCatalog()}
                        teamTypes={spreads.teamTypes} preview={PREVIEW} editing changed={false} problems={[]} actions={actions} />
        </ThemeProvider>
    );
}

describe("Spread card", () =>
{
    it("applies Suggested Spread to the displayed EVs, IVs and nature", async () =>
    {
        const user = userEvent.setup();
        render(<HeldStatCard initialFields={createFields({ hpEv: 252, spAtkEv: 252, spdEv: 4, atkIv: 7, nature: "NATURE_MODEST" })} />);
        const button = screen.getByRole("button", { name: "Timid: 4 HP / 252 SpA / 252 Spe" });
        expect(button.closest(".spread-edit-tools")).toBeInTheDocument();
        await user.click(button);
        expect(screen.getByRole("textbox", { name: "Charizard Sp. Atk EVs" })).toHaveValue("252");
        expect(screen.getByRole("textbox", { name: "Charizard Speed EVs" })).toHaveValue("252");
        expect(screen.getByRole("textbox", { name: "Charizard HP EVs" })).toHaveValue("4");
        expect(screen.getByRole("textbox", { name: "Charizard Attack IV" })).toHaveValue("0");
        expect(screen.getByRole("combobox", { name: "Nature" })).toHaveValue("Timid (+Spe, -Atk)");
        await user.hover(button);
        expect(await screen.findByRole("tooltip")).toHaveTextContent(/^Fast Special Attacker$/);
        expect(button).not.toHaveAttribute("title");
    });

    it("preserves unrelated draft fields and reads the latest moves when applying a suggestion", async () =>
    {
        const fields = createFields({ shiny: true, ball: "BALL_TYPE_POKE_BALL" });
        const { actions, user } = renderCard({ fields, editing: true });
        await user.click(screen.getByRole("button", { name: "Timid: 4 HP / 252 SpA / 252 Spe" }));
        const latest = { ...fields, moves: ["MOVE_DRAGONCLAW", "MOVE_EARTHQUAKE"], item: "ITEM_LEFTOVERS" };
        const result = actions.updateSpread.mock.calls[0][1](latest, fields);
        expect(result).toEqual({ ...latest, ...getSuggestedSpread(createCatalog(), latest).fields });
        expect(actions.setEditing).not.toHaveBeenCalled();
    });

    it("shows the defensive role and only its nonzero EV investments", () =>
    {
        renderCard({ editing: true, fields: createFields({ moves: ["MOVE_PROTECT"] }) });
        expect(screen.getByRole("button", { name: "Modest: 252 HP / 4 Def / 252 SpD" })).toBeEnabled();
    });

    it.each([{}, { usages: [{ trainerName: "Palmer", ranks: null }] }])("keeps Suggested Spread beside optional trainer chips $usages", (setOverrides) =>
    {
        const spreads = createSpreads();
        const { card } = renderCard({ editing: true, fields: createFields(), set: { ...spreads.sets[0], ...setOverrides } });
        const row = card.querySelector(".spread-edit-tools");
        expect(within(row).getByRole("button", { name: "Timid: 4 HP / 252 SpA / 252 Spe" })).toBeEnabled();
        expect(CARD_STYLES.replace(/\s+/g, " ")).toContain(".spread-suggestion-button { margin-left: auto;");
    });

    it("disables unsafe suggestions without a tooltip", async () =>
    {
        const { user } = renderCard({ editing: true, fields: createFields({ moves: ["MOVE_UNKNOWN"] }) });
        const button = screen.getByRole("button", { name: "No Suggested Spread" });
        expect(button).toBeDisabled();
        expect(screen.getByRole("button", { name: "Choose Preset Spread" })).toBeEnabled();
        await user.hover(button.parentElement);
        expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });

    it("does not show Suggested Spread on view cards", () =>
    {
        renderCard();
        expect(screen.queryByRole("button", { name: /Timid:|No Suggested Spread|Choose Preset Spread/ })).not.toBeInTheDocument();
    });

    it.each([{ moves: [0, 0, 0, 0] }, { moves: ["MOVE_UNKNOWN"] }])("keeps the preset chooser searchable without a suggestion for $moves", async (fields) =>
    {
        const { user, actions } = renderCard({ editing: true, fields: createFields(fields) });
        await user.click(screen.getByRole("button", { name: "Choose Preset Spread" }));
        const chooser = await screen.findByRole("dialog", { name: "Choose Preset Spread" });
        const search = within(chooser).getByRole("combobox", { name: "Preset Spread" });
        await waitFor(() => expect(search).toHaveFocus());
        expect(search.selectionStart).toBe(0);
        expect(search.selectionEnd).toBe(search.value.length);
        expect(within(chooser).getAllByRole("option").every((option) => option.getAttribute("aria-disabled") !== "true")).toBe(true);
        await user.keyboard("Fast Physical");
        expect(search).toHaveValue("Fast Physical");
        const option = within(chooser).getByRole("option", { name: "Fast Physical Attacker" });
        expect(option).not.toHaveAttribute("aria-disabled", "true");
        expect(actions.updateSpread).not.toHaveBeenCalled();
        await user.keyboard("{Enter}");
        await waitFor(() => expect(screen.queryByRole("dialog", { name: "Choose Preset Spread" })).not.toBeInTheDocument());
        const apply = screen.getByRole("button", { name: /252 Atk/ });
        expect(apply).toBeEnabled();
        expect(actions.updateSpread).toHaveBeenCalledTimes(1);
        const initial = createFields(fields);
        const result = actions.updateSpread.mock.calls.at(-1)[1](initial, initial);
        expect(result.atkEv).toBe(252);
        expect(result.atkIv).toBe(31);
        expect(result.moves).toEqual(initial.moves);
    });

    it("searches without changing drafts and immediately applies the selected preset and automatic option", async () =>
    {
        const user = userEvent.setup();
        render(<HeldStatCard initialFields={createFields()} />);
        const arrow = screen.getByRole("button", { name: "Choose Preset Spread" });
        const attackEvs = screen.getByRole("textbox", { name: "Charizard Sp. Atk EVs" });
        await user.click(arrow);
        const chooser = await screen.findByRole("dialog", { name: "Choose Preset Spread" });
        const search = within(chooser).getByRole("combobox", { name: "Preset Spread" });
        await waitFor(() => expect(search).toHaveFocus());
        expect(within(chooser).getByRole("listbox", { name: "Preset Spread" })).toBeInTheDocument();
        expect(within(chooser).getByRole("option", { name: "Fast Physical Attacker" })).not.toHaveAttribute("aria-disabled", "true");
        expect(attackEvs).toHaveValue("0");
        await user.clear(search);
        await user.type(search, "Physically{Enter}");
        await waitFor(() => expect(screen.queryByRole("dialog", { name: "Choose Preset Spread" })).not.toBeInTheDocument());
        const apply = screen.getByRole("button", { name: "Bold: 252 HP / 252 Def / 4 SpD" });
        expect(apply).toBeEnabled();
        expect(screen.getByRole("textbox", { name: "Charizard Defense EVs" })).toHaveValue("252");
        expect(screen.getByRole("combobox", { name: "Nature" })).toHaveValue("Bold (+Def, -Atk)");
        await user.click(arrow);
        const resetSearch = await screen.findByRole("combobox", { name: "Preset Spread" });
        await waitFor(() => expect(resetSearch).toHaveFocus());
        expect(resetSearch.selectionEnd).toBe(resetSearch.value.length);
        expect(resetSearch.selectionStart).toBe(0);
        await user.keyboard("Automatic{Enter}");
        expect(await screen.findByRole("button", { name: "Timid: 4 HP / 252 SpA / 252 Spe" })).toBeEnabled();
        expect(screen.getByRole("textbox", { name: "Charizard Defense EVs" })).toHaveValue("0");
    });

    it("immediately applies a preset chosen with the mouse", async () =>
    {
        const user = userEvent.setup();
        render(<HeldStatCard initialFields={createFields()} />);
        await user.click(screen.getByRole("button", { name: "Choose Preset Spread" }));
        await user.click(await screen.findByRole("option", { name: "Bulky Special Attacker" }));
        await waitFor(() => expect(screen.queryByRole("dialog", { name: "Choose Preset Spread" })).not.toBeInTheDocument());
        expect(screen.getByRole("textbox", { name: "Charizard HP EVs" })).toHaveValue("252");
        expect(screen.getByRole("textbox", { name: "Charizard Speed EVs" })).toHaveValue("0");
        expect(screen.getByRole("combobox", { name: "Nature" })).toHaveValue("Modest (+SpA, -Atk)");
    });

    it("closes the preset chooser with Escape without applying or selecting anything", async () =>
    {
        const { user, actions } = renderCard({ editing: true, fields: createFields() });
        await user.click(screen.getByRole("button", { name: "Choose Preset Spread" }));
        const search = await screen.findByRole("combobox", { name: "Preset Spread" });
        await user.clear(search);
        await user.type(search, "Bulky");
        await user.keyboard("{Escape}{Escape}");
        await waitFor(() => expect(screen.queryByRole("dialog", { name: "Choose Preset Spread" })).not.toBeInTheDocument());
        expect(actions.updateSpread).not.toHaveBeenCalled();
        expect(screen.getByRole("button", { name: "Timid: 4 HP / 252 SpA / 252 Spe" })).toBeEnabled();
    });

    it("tabs down EVs then IVs in both directions, skipping steppers and selecting each field", async () =>
    {
        const { card, user } = renderCard({ editing: true, fields: createFields({ hpEv: 4 }) });
        const inputs = [...card.querySelectorAll("input[data-stat-kind='ev']"), ...card.querySelectorAll("input[data-stat-kind='iv']")];
        expect(inputs).toHaveLength(12);
        await user.click(inputs[0]);
        for (const input of inputs.slice(1))
        {
            await user.tab();
            expect(input).toHaveFocus();
            expect(input.selectionStart).toBe(0);
            expect(input.selectionEnd).toBe(input.value.length);
        }
        await user.tab();
        expect(within(card).getByRole("combobox", { name: "Nature" })).toHaveFocus();
        await user.tab({ shift: true });
        expect(inputs.at(-1)).toHaveFocus();
        for (const input of inputs.slice(0, -1).reverse())
        {
            await user.tab({ shift: true });
            expect(input).toHaveFocus();
        }
        await user.tab({ shift: true });
        expect(within(card).getByRole("button", { name: "Reset IVs" })).toHaveFocus();
        expect([...card.querySelectorAll(".stat-stepper button")].every((button) => button.tabIndex === -1)).toBe(true);
    });

    it("keeps stat arrow keys available after tabbing down", async () =>
    {
        const { user, actions } = renderCard({ editing: true, fields: createFields() });
        await user.click(screen.getByRole("textbox", { name: "Charizard HP EVs" }));
        await user.tab();
        await user.keyboard("{ArrowUp}");
        expect(actions.updateSpread.mock.calls.at(-1)[1](createFields()).atkEv).toBe(4);
    });

    it.each([false, true])("advances portaled edit fields with doubles team shown: %s", async (doubles) =>
    {
        const spreads = createSpreads();
        const entry = spreads.entries[2];
        const fields = createFields({ forSingles: !doubles, forDoubles: true });
        const actions = { updateSpread: vi.fn(), setEditing: vi.fn() };
        const onSubmit = vi.fn();
        const user = userEvent.setup();
        render(<ThemeProvider theme={APP_THEME}>
            <EditSpreadDialog name="Charizard" sets={spreads.sets} setId={entry.setId} getSetProblem={() => ""}
                              onSetChange={vi.fn()} onClose={vi.fn()} onSubmit={onSubmit}>
                <SpreadCard entry={entry} fields={fields} set={spreads.sets[0]} catalog={createCatalog()} teamTypes={spreads.teamTypes}
                            preview={PREVIEW} editing changed={false} problems={[]} actions={actions} />
            </EditSpreadDialog>
        </ThemeProvider>);
        const dialog = await screen.findByRole("dialog", { name: "Edit Charizard" });
        /**
         * Finds an inline field in the edit dialog.
         *
         * @param {string} name The field label.
         * @returns {HTMLElement} The combobox.
         */
        const field = (name) => within(dialog).getByRole("combobox", { name });
        expect(field("Spread Set").closest(".MuiInputBase-root")).toHaveClass("MuiInputBase-sizeSmall");

        await user.clear(field("Nature"));
        await user.type(field("Nature"), "Timid");
        expect(field("Nature")).toHaveFocus();
        await user.keyboard("{Escape}");
        expect(field("Nature")).toHaveFocus();
        await user.click(field("Ball"));
        expect(field("Ball")).toHaveFocus();
        expect(field("Move 1")).not.toHaveFocus();
        await user.clear(field("Nature"));
        await user.type(field("Nature"), "Timid{Enter}");
        await waitFor(() => expect(field("Move 1")).toHaveFocus());
        await user.clear(field("Move 1"));
        await user.type(field("Move 1"), "Dragon Claw{Enter}");
        await waitFor(() => expect(field("Move 2")).toHaveFocus());
        await user.clear(field("Move 2"));
        await user.type(field("Move 2"), "Earthquake");
        await user.click(await screen.findByRole("option", { name: "Earthquake" }));
        await waitFor(() => expect(field("Move 3")).toHaveFocus());
        await user.clear(field("Move 3"));
        await user.type(field("Move 3"), "Protect{Enter}");
        await waitFor(() => expect(field("Move 4")).toHaveFocus());
        await user.clear(field("Move 4"));
        await user.type(field("Move 4"), "Dragon Claw{Enter}");
        await waitFor(() => expect(field("Item")).toHaveFocus());
        await user.clear(field("Item"));
        await user.type(field("Item"), "Leftovers{Enter}");
        await waitFor(() => expect(field("Ability")).toHaveFocus());
        await user.clear(field("Ability"));
        await user.type(field("Ability"), "Solar Power{Enter}");
        await waitFor(() => expect(field("Battle Type")).toHaveFocus());
        await user.click(field("Battle Type"));
        await user.click(await screen.findByRole("option", { name: doubles ? "Doubles Only" : "Singles Only" }));
        if (doubles)
        {
            await waitFor(() => expect(field("Doubles Team Type")).toHaveFocus());
            await user.click(field("Doubles Team Type"));
            await user.click(await screen.findByRole("option", { name: "Any" }));
        }
        await waitFor(() => expect(field("Spread Set")).toHaveFocus());
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it("shows view details in the requested order without random ball, nature, or final stats", async () =>
    {
        const { card, actions, user } = renderCard({ fields: createFields({ item: "ITEM_CHARIZARDITE_X", gigantamax: true }), changed: true });
        const header = card.querySelector(".spread-card-header");
        const side = card.querySelector(".spread-card-side");
        const name = within(card).getByRole("heading", { name: "Charizard" });

        expect(precedes(within(card).getByRole("img", { name: "Gigantamax" }), name)).toBe(true);
        expect(within(header).queryByText("Doubles Only")).not.toBeInTheDocument();
        expect(header.querySelector(".battle-chips .MuiChip-label")).toHaveTextContent(/^Singles & Doubles \(Modify\)$/);
        expect(within(header).queryByRole("switch", { name: "Mega Stats" })).not.toBeInTheDocument();
        expect(within(card).queryByRole("columnheader", { name: "Final" })).not.toBeInTheDocument();
        expect(within(card).getByRole("table")).toHaveClass("spread-stats-view");
        expect(within(card).getByRole("columnheader", { name: "Stat" }).closest("table")).toHaveClass("spread-stats-view");
        expect(card.querySelector(".side-nature")).toHaveTextContent(/^Modest$/);
        expect(within(side).queryByText("Random Ball")).not.toBeInTheDocument();
        expect(within(card).queryByRole("button", { name: "Edit Charizard" })).not.toBeInTheDocument();

        expect(within(card).queryByRole("button", { name: "Revert Charizard" })).not.toBeInTheDocument();
        await user.click(name);
        expect(actions.setEditing).toHaveBeenCalledWith("e2", true);

        actions.setEditing.mockClear();
        card.focus();
        await user.keyboard("{Enter}");
        expect(actions.setEditing).toHaveBeenCalledWith("e2", true);
    });

    it.each([
        [true, "light", APP_THEME],
        [false, "light", APP_THEME],
        [true, "dark", DARK_APP_THEME],
        [false, "dark", DARK_APP_THEME],
    ])("shows one readable Both chip with modified moves: %s in %s", (modifyMovesDoubles, mode, theme) =>
    {
        const { card } = renderCard({ fields: createFields({ modifyMovesDoubles }), theme });
        const chips = card.querySelector(".battle-chips");
        const chip = chips.querySelector(".MuiChip-root");
        const suffix = chip.querySelector(".battle-chip-suffix");
        const label = modifyMovesDoubles ? "Singles & Doubles (Modify)" : "Singles & Doubles (Exact)";
        expect(chips.querySelectorAll(".MuiChip-root")).toHaveLength(1);
        expect(chip).toHaveClass("MuiChip-colorSuccess");
        expect(chip.querySelector(".MuiChip-label").textContent).toBe(label);
        expect(suffix).toHaveTextContent(modifyMovesDoubles ? "(Modify)" : "(Exact)");
        expect(suffix.style.color).toBe(SUFFIX_COLORS[modifyMovesDoubles ? "modified" : "exact"][mode]);
        expect(suffix.style.fontWeight).toBe("600");
        expect(getContrastRatio(suffix.style.color, theme.palette.success.main)).toBeGreaterThanOrEqual(MIN_SUFFIX_CONTRAST);
        expect(within(card).queryByText("Modify Doubles")).not.toBeInTheDocument();
        expect(within(card).queryByText("Keep Doubles")).not.toBeInTheDocument();
    });

    it("groups trainer chips before battle chips below the title in view mode", () =>
    {
        const spreads = createSpreads();
        const set = { ...spreads.sets[0], usages: [{ trainerName: "Palmer", ranks: [1, 2] }] };
        const { card } = renderCard({ set });
        const chips = [...card.querySelectorAll(".battle-chips .MuiChip-root")].map((chip) => chip.textContent);
        expect(chips[0]).toBe("Doubles Only");
        const trainers = card.querySelector(".trainer-chips");
        expect(trainers.querySelector(".MuiChip-root")).toHaveTextContent("Palmer (Rank 1-2)");
        expect(trainers.querySelector(".MuiChip-root")).toHaveClass("MuiChip-outlined");
        expect(trainers.parentElement).toHaveClass("spread-card-chips");
        expect(trainers.parentElement).toContainElement(card.querySelector(".battle-chips"));
        expect(trainers.parentElement.parentElement.previousElementSibling).toHaveClass("spread-card-title");
        expect(precedes(trainers, card.querySelector(".battle-chips"))).toBe(true);
        expect(card.querySelector(".spread-card-side")).not.toHaveTextContent("Palmer");
        expect(card.querySelector(".side-ability .ability-slot")).toHaveTextContent("[1]");
    });

    it.each([{ usages: [] }, { usages: [{ trainerName: "Palmer", ranks: null }] }])("shows the Little Cup toggle in the stats footer with usages $usages", ({ usages }) =>
    {
        const spreads = createSpreads();
        const set = { ...spreads.sets[0], littleCup: true, usages };
        const { card } = renderCard({ set, editing: true, preview: { level: 100 } });
        const trainers = card.querySelector(".trainer-chips");
        const toggle = within(card.querySelector(".spread-stats tfoot")).getByRole("switch", { name: "Lv. 5" });

        expect(toggle).toBeChecked();
        expect(within(card).queryByText("Lv. 5")).not.toBeInTheDocument();
        if (usages.length)
        {
            expect(trainers.parentElement.previousElementSibling).toHaveClass("spread-card-title");
            expect(within(trainers).getByText("Palmer")).toBeInTheDocument();
        }
        else
            expect(trainers).toBeNull();
    });

    it.each([50, 100])("previews Little Cup stats at the page level %s when Lv. 5 is off", async (pageLevel) =>
    {
        const spreads = createSpreads();
        const fields = createFields();
        const catalog = createCatalog();
        const { card, actions, user } = renderCard({ fields, catalog, set: { ...spreads.sets[0], littleCup: true }, editing: true, preview: { level: pageLevel } });
        const toggle = within(card).getByRole("switch", { name: "Lv. 5" });
        const finalHp = within(card).getByText("HP", { selector: ".stat-label" }).closest("tr").querySelector(".stat-final");

        expect(finalHp).toHaveTextContent(String(calculateSpreadStats(catalog, fields, { level: 5 }).stats.hp));
        await user.click(toggle);
        expect(toggle).not.toBeChecked();
        expect(finalHp).toHaveTextContent(String(calculateSpreadStats(catalog, fields, { level: pageLevel }).stats.hp));
        expect(actions.updateSpread).not.toHaveBeenCalled();

        await user.click(within(card).getByRole("button", { name: "Raise HP EVs" }));
        const change = actions.updateSpread.mock.calls.at(-1)[1];
        expect(change(fields).hpEv).toBe(stepEv(fields, "hp", 1));

        await user.click(toggle);
        expect(toggle).toBeChecked();
        expect(finalHp).toHaveTextContent(String(calculateSpreadStats(catalog, fields, { level: 5 }).stats.hp));
    });

    it("keeps the Lv. 5 and Mega Stats footer toggles independent", async () =>
    {
        const spreads = createSpreads();
        const fields = createFields({ item: "ITEM_CHARIZARDITE_X" });
        const catalog = createCatalog();
        const { card, actions, user } = renderCard({ fields, catalog, set: { ...spreads.sets[0], littleCup: true }, editing: true });
        const footer = within(card.querySelector(".spread-stats tfoot"));
        const mega = footer.getByRole("switch", { name: "Mega Stats" });
        const level = footer.getByRole("switch", { name: "Lv. 5" });
        const finalAttack = within(card).getByText("Attack", { selector: ".stat-label" }).closest("tr").querySelector(".stat-final");

        await user.click(level);
        expect(mega).toBeChecked();
        expect(finalAttack).toHaveTextContent(String(calculateSpreadStats(catalog, fields, { level: 50 }).stats.atk));
        await user.click(mega);
        expect(level).not.toBeChecked();
        expect(finalAttack).toHaveTextContent(String(calculateSpreadStats(catalog, fields, { level: 50, mega: false }).stats.atk));
        expect(actions.updateSpread).not.toHaveBeenCalled();
    });

    it("updates the edit level toggle when the destination set or page level changes", async () =>
    {
        const spreads = createSpreads();
        const user = userEvent.setup();
        const props =
        {
            entry: spreads.entries[2], fields: createFields(), catalog: createCatalog(), teamTypes: spreads.teamTypes,
            preview: PREVIEW, editing: true, changed: false, problems: [], actions: { updateSpread: vi.fn(), setEditing: vi.fn() },
        };
        const { rerender } = render(<ThemeProvider theme={APP_THEME}><SpreadCard {...props} set={spreads.sets[0]} /></ThemeProvider>);
        expect(screen.queryByRole("switch", { name: "Lv. 5" })).not.toBeInTheDocument();
        const set = { ...spreads.sets[0], littleCup: true };
        rerender(<ThemeProvider theme={APP_THEME}><SpreadCard {...props} set={set} /></ThemeProvider>);
        expect(screen.getByRole("switch", { name: "Lv. 5" })).toBeChecked();
        await user.click(screen.getByRole("switch", { name: "Lv. 5" }));
        rerender(<ThemeProvider theme={APP_THEME}><SpreadCard {...props} set={set} preview={{ level: 100 }} /></ThemeProvider>);
        const finalHp = screen.getByText("HP", { selector: ".stat-label" }).closest("tr").querySelector(".stat-final");
        expect(finalHp).toHaveTextContent(String(calculateSpreadStats(props.catalog, props.fields, { level: 100 }).stats.hp));
        rerender(<ThemeProvider theme={APP_THEME}><SpreadCard {...props} set={spreads.sets[0]} /></ThemeProvider>);
        expect(screen.queryByRole("switch", { name: "Lv. 5" })).not.toBeInTheDocument();
    });

    it("keeps the Little Cup view chip in the battle chips", () =>
    {
        const spreads = createSpreads();
        const { card } = renderCard({ set: { ...spreads.sets[0], littleCup: true } });
        expect(within(card.querySelector(".battle-chips")).getByText("Lv. 5")).toBeInTheDocument();
        expect(within(card).getAllByText("Lv. 5")).toHaveLength(1);
    });

    it("puts trainer chips under the edit title and item and ability under the moves", () =>
    {
        const spreads = createSpreads();
        const set = { ...spreads.sets[0], usages: [{ trainerName: "Palmer", ranks: null }] };
        const { card } = renderCard({ set, editing: true, fields: createFields({ item: "ITEM_CHARIZARDITE_X" }) });
        const trainers = card.querySelector(".trainer-chips");
        expect(trainers.querySelector(".MuiChip-root")).toHaveTextContent("Palmer");
        expect(trainers.parentElement.previousElementSibling).toHaveClass("spread-card-title");
        expect(card.querySelector(".spread-side-checks").parentElement).not.toHaveTextContent("Palmer");
        const held = card.querySelector(".spread-card-held");
        expect(precedes(card.querySelector(".spread-card-moves"), held)).toBe(true);
        expect(within(held).getByRole("combobox", { name: "Item" })).toBeInTheDocument();
        expect(within(held).getByRole("combobox", { name: "Ability" })).toBeInTheDocument();
        expect(within(card.querySelector(".spread-stats tfoot")).getByRole("switch", { name: "Mega Stats" })).toBeChecked();
    });

    it("shows the nature name under the abilities and a full-name tooltip only for cut-off text", async () =>
    {
        const { card, user } = renderCard({ fields: createFields({ item: "ITEM_HEAVYDUTYBOOTS", nature: "NATURE_TIMID" }) });
        expect(card.querySelector(".side-nature")).toHaveTextContent(/^Timid$/);
        expect(card.querySelector(".side-nature").previousElementSibling).toHaveClass("side-ability");
        expect(card.querySelectorAll("[title]")).toHaveLength(0);

        const item = card.querySelector(".side-item .side-value-text");
        await user.hover(item);
        expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
        await user.unhover(item);

        // jsdom has no layout, so the text is made to report more width than it has
        Object.defineProperty(item, "scrollWidth", { configurable: true, value: 200 });
        Object.defineProperty(item, "clientWidth", { configurable: true, value: 100 });
        await user.hover(item);
        expect(await screen.findByRole("tooltip")).toHaveTextContent("Heavy-Duty Boots");
    });

    it("shows a chosen ball above the item with Mega stats by default", () =>
    {
        const { card } = renderCard({ fields: createFields({ item: "ITEM_CHARIZARDITE_X", ball: "BALL_TYPE_POKE_BALL" }) });
        const side = card.querySelector(".spread-card-side");

        expect(precedes(within(side).getByText("Poke Ball"), within(side).getByText("Charizardite X"))).toBe(true);
        expect(within(card).queryByRole("switch", { name: "Mega Stats" })).not.toBeInTheDocument();
        expect(within(card).getByText("Attack", { selector: ".stat-label" }).closest("tr").querySelector("td")).toHaveTextContent("130");
    });

    it("keeps Shiny and Gigantamax on one row beside the stats and stacks them only on narrow cards", () =>
    {
        const styles = CARD_STYLES.replace(/\s+/g, " ");
        expect(styles).toContain(`.spread-card-editing .spread-card-content { grid-template-columns: ${EDIT_CARD_SIDE_WIDTH}px minmax(0, 1fr);`);
        expect(styles).toContain(".spread-side-checks { display: flex; flex-wrap: wrap;");
        expect(styles).toContain(".spread-card-editing .spread-stats th, .spread-card-editing .spread-stats td { padding: 3px 7px;");
        expect(styles).toContain(`@container spread-edit-card (max-width: ${EDIT_CARD_STACK_WIDTH}px)`);
        expect(styles).toContain('"side header" "side appearance" "stats stats"');
        expect(styles).toContain(".spread-card-editing .spread-card-stats { justify-self: center; max-width: 100%; }");
    });

    it("shows sprite options and stat steppers while editing without inline move clear buttons", () =>
    {
        const catalog = createCatalog();
        catalog.balls.BALL_TYPE_POKE_BALL.icon = "/poke-ball.png";
        catalog.types.TYPE_FIRE.icon = "/fire-banner.png";
        catalog.types.TYPE_FIRE.symbol = "/fire-symbol.png";
        const { card } = renderCard({ editing: true, fields: createFields({ ball: "BALL_TYPE_POKE_BALL", item: "ITEM_CHARIZARDITE_X" }), catalog });
        const side = card.querySelector(".spread-card-side");
        const details = card.querySelector(".spread-card-held");
        const lower = within(card).getByRole("button", { name: "Lower Attack IV" });
        const raise = within(card).getByRole("button", { name: "Raise Attack IV" });

        expect(within(side).getByRole("combobox", { name: "Ball" })).toBeInTheDocument();
        expect(within(side).getByRole("combobox", { name: "Ball" }).closest(".MuiInputBase-root").querySelector(".game-image")).toBeInTheDocument();
        expect(within(card).getByRole("switch", { name: "Mega Stats" })).toBeChecked();
        expect(within(side).getByRole("checkbox", { name: "Shiny" })).toBeInTheDocument();
        expect(within(side).getByRole("checkbox", { name: "Gigantamax" })).toBeInTheDocument();
        const appearance = card.querySelector(".spread-card-appearance");
        expect(within(appearance).getByRole("combobox", { name: "Ball" })).toBeInTheDocument();
        expect(within(appearance).getAllByRole("checkbox")).toHaveLength(2);
        expect(within(appearance).queryByRole("table")).not.toBeInTheDocument();
        expect(card.querySelector(".spread-card-stats").parentElement).toHaveClass("spread-card-content");
        expect(within(details).getByRole("combobox", { name: "Ability" })).toBeInTheDocument();
        expect(within(details).getByRole("combobox", { name: "Item" })).toBeInTheDocument();
        expect(within(card).getByRole("columnheader", { name: "Final" })).toBeInTheDocument();
        expect(within(card).getByRole("table")).toHaveClass("spread-stats-editing");
        expect(within(card).getByRole("table")).not.toHaveClass("spread-stats-view");
        // Original types stay as symbols when the Mega's types follow as full banners
        const typeSources = [...card.querySelectorAll(".spread-card-title .type-symbol img")].map((image) => image.getAttribute("src"));
        expect(typeSources[0]).toContain("fire-symbol.png");
        expect(typeSources.slice(1).some((source) => source.includes("fire-banner.png"))).toBe(true);
        expect(within(card.querySelector(".spread-card-subtitle")).queryByRole("switch", { name: "Mega Stats" })).not.toBeInTheDocument();
        expect(within(card).getByLabelText("EV total 0 of 510")).toHaveTextContent("510 Left");
        expect(lower).toHaveClass("MuiIconButton-colorError");
        expect(raise).toHaveClass("MuiIconButton-colorSuccess");
        expect(within(card).getByRole("button", { name: "Raise Speed IV" })).toBeDisabled();
        expect(card.querySelectorAll(".move-picker .MuiAutocomplete-clearIndicator")).toHaveLength(0);
    });

    it("marks only later duplicate moves illegal and keeps the ability in the side column", async () =>
    {
        const fields = createFields({ item: "ITEM_CHARIZARDITE_X", moves: ["MOVE_FLAMETHROWER", "MOVE_AIRSLASH", "MOVE_FLAMETHROWER", 0] });
        const { card, user } = renderCard({ fields });
        const slots = card.querySelectorAll(".move-slot");
        expect(slots[0]).not.toHaveClass("move-status-illegal");
        expect(slots[2]).toHaveClass("move-status-illegal");
        await user.hover(slots[2]);
        expect(await screen.findByRole("tooltip")).toHaveTextContent("Duplicate move");
        expect(slots[3]).not.toHaveClass("move-status-illegal");
        expect(card.querySelector(".spread-card-mega")).not.toBeInTheDocument();
        expect(card.querySelector(".spread-card-side strong")).toHaveTextContent("[M]");
    });

    it("deletes from the actions menu without asking", async () =>
    {
        const { card, actions, user } = renderCard({ editing: true, changed: true });
        const actionButtons = [...card.querySelectorAll(".spread-card-actions button")];
        expect(actionButtons.map((button) => button.getAttribute("aria-label"))).toEqual(["Spread Actions"]);
        await user.click(within(card).getByRole("button", { name: "Spread Actions" }));
        expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Export to Showdown", "Overwrite From Showdown", "Delete"]);
        await user.click(screen.getByRole("menuitem", { name: "Delete" }));
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(actions.deleteSpread).toHaveBeenCalledWith("e2");
    });

    it("marks a new spread with the NEW symbol instead of a chip", () =>
    {
        const spreads = createSpreads();
        const { card } = renderCard({ entry: { ...spreads.entries[2], isNew: true }, changed: true });
        expect(within(card).getByRole("img", { name: "New Spread" }).querySelector("[data-testid='FiberNewIcon']")).toHaveClass("MuiSvgIcon-colorSuccess");
        expect(within(card).queryByText("New")).not.toBeInTheDocument();
    });

    it("shows a read-only source placeholder", async () =>
    {
        const spreads = createSpreads();
        const entry = { ...spreads.entries[2], editable: false, placeholder: true };
        const placeholder = renderCard({ entry });
        expect(within(placeholder.card).getByText("Placeholder").closest(".battle-chips").firstElementChild).toHaveTextContent("Placeholder");
        expect(placeholder.card).toHaveClass("spread-card-locked");
        await placeholder.user.click(within(placeholder.card).getByRole("heading", { name: "Charizard" }));
        expect(placeholder.actions.setEditing).not.toHaveBeenCalled();
    });

    it("resets every EV to 0 and every IV to 31 from the column headings", async () =>
    {
        const fields = createFields({ moves: ["MOVE_FLAMETHROWER", "MOVE_AIRSLASH", 0, 0], hpEv: 252, spAtkEv: 252, hpIv: 5, atkIv: 31, spdIv: 20 });
        const { card, actions, user } = renderCard({ editing: true, fields });

        await user.click(within(card).getByRole("button", { name: "Reset EVs" }));
        const evs = actions.updateSpread.mock.calls.at(-1)[1](fields);
        expect([evs.hpEv, evs.atkEv, evs.defEv, evs.spAtkEv, evs.spDefEv, evs.spdEv]).toEqual([0, 0, 0, 0, 0, 0]);

        await user.click(within(card).getByRole("button", { name: "Reset IVs" }));
        const ivs = actions.updateSpread.mock.calls.at(-1)[1](fields);
        expect([ivs.hpIv, ivs.atkIv, ivs.defIv, ivs.spAtkIv, ivs.spDefIv, ivs.spdIv]).toEqual([31, 0, 31, 31, 31, 31]);
    });

    it("disables the resets when nothing would change", () =>
    {
        const fields = createFields({ moves: ["MOVE_FLAMETHROWER", 0, 0, 0], atkIv: 0 });
        const { card } = renderCard({ editing: true, fields: { ...fields, hpEv: 0, atkEv: 0, defEv: 0, spAtkEv: 0, spDefEv: 0, spdEv: 0 } });
        expect(within(card).getByRole("button", { name: "Reset EVs" })).toBeDisabled();
        expect(within(card).getByRole("button", { name: "Reset IVs" })).toBeDisabled();
    });

    it("marks later inline duplicates and clears a move when its text is emptied", async () =>
    {
        const fields = createFields({ moves: ["MOVE_FLAMETHROWER", "MOVE_AIRSLASH", "MOVE_FLAMETHROWER", 0] });
        const { card, actions, user } = renderCard({ editing: true, fields });
        expect(card.querySelectorAll(".move-status-illegal")).toHaveLength(1);
        expect(card.querySelector("[title]")).toBeNull();
        const input = within(card).getByRole("combobox", { name: "Move 3" });
        await user.clear(input);
        fireEvent.blur(input);
        expect(actions.updateSpread).toHaveBeenCalled();
        const update = actions.updateSpread.mock.calls.at(-1)[1];
        expect(update(fields).moves[2]).toBe(0);
    });

    it("restores a deleted card without exposing its underlying fields", async () =>
    {
        const { card, actions, user } = renderCard({ deleted: true, changed: true });
        expect(card.querySelector(".spread-card-content")).toHaveAttribute("inert");
        expect(card).toHaveClass("spread-card-deleted");
        await user.click(within(card).getByRole("button", { name: "Restore" }));
        expect(actions.restoreSpread).toHaveBeenCalledWith("e2");
    });

    it.each([
        ["Raise Attack EVs", "Charizard Attack EVs", { atkEv: 0 }, "4", "8", "pointerUp"],
        ["Raise Attack EVs", "Charizard Attack EVs", { atkEv: 0 }, "4", "8", "pointerLeave"],
        ["Raise Attack EVs", "Charizard Attack EVs", { atkEv: 0 }, "4", "8", "pointerCancel"],
        ["Raise Attack IV", "Charizard Attack IV", { atkIv: 0 }, "1", "2", "pointerUp"],
        ["Lower Attack IV", "Charizard Attack IV", { atkIv: 31 }, "30", "29", "pointerCancel"],
    ])("repeats %s after 150ms at 20ms intervals until released", (label, inputLabel, overrides, initial, repeated, stopEvent) =>
    {
        vi.useFakeTimers();
        try
        {
            render(<HeldStatCard initialFields={createFields(overrides)} />);
            const input = screen.getByRole("textbox", { name: inputLabel });
            const button = screen.getByRole("button", { name: label });
            fireEvent.pointerDown(button);
            expect(input).toHaveValue(initial);
            act(() => vi.advanceTimersByTime(INITIAL_REPEAT_DELAY_MS));
            expect(input).toHaveValue(initial);
            act(() => vi.advanceTimersByTime(REPEAT_INTERVAL_MS - 1));
            expect(input).toHaveValue(initial);
            act(() => vi.advanceTimersByTime(1));
            expect(input).toHaveValue(repeated);
            act(() => vi.advanceTimersByTime(HOLD_DURATION_MS - INITIAL_REPEAT_DELAY_MS - REPEAT_INTERVAL_MS));
            if (inputLabel.endsWith("EVs"))
                expect(Number(input.value)).toBeGreaterThan(MIN_FAST_EV_CHANGE);
            fireEvent[stopEvent](button);
            const value = input.value;
            act(() => vi.advanceTimersByTime(HOLD_DURATION_MS));
            expect(input).toHaveValue(value);
        }
        finally
        {
            vi.useRealTimers();
        }
    });

    it.each([
        ["Raise Attack EVs", "Charizard Attack EVs", { atkEv: 248 }, "252"],
        ["Raise Attack EVs", "Charizard Attack EVs", { hpEv: 252, defEv: 252 }, "4"],
        ["Lower Attack EVs", "Charizard Attack EVs", { atkEv: 4 }, "0"],
        ["Raise Attack IV", "Charizard Attack IV", { atkIv: 0 }, "31"],
        ["Lower Attack IV", "Charizard Attack IV", { atkIv: 31 }, "0"],
    ])("keeps held %s within its limits", (label, inputLabel, overrides, expected) =>
    {
        vi.useFakeTimers();
        try
        {
            render(<HeldStatCard initialFields={createFields(overrides)} />);
            const button = screen.getByRole("button", { name: label });
            fireEvent.pointerDown(button);
            act(() => vi.advanceTimersByTime(HOLD_DURATION_MS * 2));
            expect(screen.getByRole("textbox", { name: inputLabel })).toHaveValue(expected);
            expect(button).toBeDisabled();
            act(() => vi.advanceTimersByTime(HOLD_DURATION_MS));
            expect(screen.getByRole("textbox", { name: inputLabel })).toHaveValue(expected);
        }
        finally
        {
            vi.useRealTimers();
        }
    });
});
