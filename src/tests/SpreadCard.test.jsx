import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@mui/material/styles";
import { vi } from "vitest";

import SpreadCard from "../components/SpreadCard";
import { APP_THEME } from "../Theme";
import { createCatalog, createFields, createSpreads } from "./EditorFixtures";

const PREVIEW = { level: 50 };


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
    render(<ThemeProvider theme={APP_THEME}><SpreadCard {...cardProps} /></ThemeProvider>);
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

describe("Spread card", () =>
{
    it("shows view details in the requested order without random ball, nature, or final stats", async () =>
    {
        const { card, actions, user } = renderCard({ fields: createFields({ item: "ITEM_CHARIZARDITE_X", gigantamax: true }), changed: true });
        const header = card.querySelector(".spread-card-header");
        const side = card.querySelector(".spread-card-side");
        const name = within(card).getByRole("heading", { name: "Charizard" });

        expect(precedes(within(card).getByRole("img", { name: "Gigantamax" }), name)).toBe(true);
        expect(within(header).queryByText("Doubles Only")).not.toBeInTheDocument();
        expect(within(header).getByText("Singles & Doubles")).toBeInTheDocument();
        expect(within(header).queryByRole("switch", { name: "Mega Stats" })).not.toBeInTheDocument();
        expect(within(card).queryByRole("columnheader", { name: "Final" })).not.toBeInTheDocument();
        expect(card.querySelector(".side-nature")).toHaveTextContent(/^Modest$/);
        expect(within(side).queryByText("Random Ball")).not.toBeInTheDocument();
        expect(within(card).queryByRole("button", { name: "Edit Charizard" })).not.toBeInTheDocument();

        await user.click(within(card).getByRole("button", { name: "Revert Charizard" }));
        expect(actions.revertSpread).toHaveBeenCalledWith("e2");
        await user.click(name);
        expect(actions.setEditing).toHaveBeenCalledWith("e2", true);

        actions.setEditing.mockClear();
        card.focus();
        await user.keyboard("{Enter}");
        expect(actions.setEditing).toHaveBeenCalledWith("e2", true);
    });

    it("puts trainer chips before the battle type and ability slots in the icon column", () =>
    {
        const spreads = createSpreads();
        const set = { ...spreads.sets[0], usages: [{ trainerName: "Palmer", ranks: null }] };
        const { card } = renderCard({ set });
        const chips = [...card.querySelectorAll(".battle-chips .MuiChip-root")].map((chip) => chip.textContent);
        expect(chips.slice(0, 2)).toEqual(["Palmer", "Doubles Only"]);
        expect(card.querySelector(".side-ability .ability-slot")).toHaveTextContent("[1]");
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

    it("shows sprite options and stat steppers while editing without inline move clear buttons", () =>
    {
        const catalog = createCatalog();
        catalog.balls.BALL_TYPE_POKE_BALL.icon = "/poke-ball.png";
        catalog.types.TYPE_FIRE.icon = "/fire-banner.png";
        catalog.types.TYPE_FIRE.symbol = "/fire-symbol.png";
        const { card } = renderCard({ editing: true, fields: createFields({ ball: "BALL_TYPE_POKE_BALL", item: "ITEM_CHARIZARDITE_X" }), catalog });
        const side = card.querySelector(".spread-card-side");
        const details = card.querySelector(".spread-details-edit");
        const lower = within(card).getByRole("button", { name: "Lower Attack IV" });
        const raise = within(card).getByRole("button", { name: "Raise Attack IV" });

        expect(within(side).getByRole("combobox", { name: "Ball" })).toBeInTheDocument();
        expect(within(side).getByRole("combobox", { name: "Ball" }).closest(".MuiInputBase-root").querySelector(".game-image")).toBeInTheDocument();
        expect(within(card).getByRole("switch", { name: "Mega Stats" })).toBeChecked();
        expect(within(side).getByRole("checkbox", { name: "Shiny" })).toBeInTheDocument();
        expect(within(side).getByRole("checkbox", { name: "Gigantamax" })).toBeInTheDocument();
        expect(within(details).getByRole("combobox", { name: "Ability" })).toBeInTheDocument();
        expect(within(details).getByRole("combobox", { name: "Item" })).toBeInTheDocument();
        expect(within(card).getByRole("columnheader", { name: "Final" })).toBeInTheDocument();
        // Original types stay as symbols when the Mega's types follow as full banners
        const typeSources = [...card.querySelectorAll(".spread-card-title .type-symbol img")].map((image) => image.getAttribute("src"));
        expect(typeSources[0]).toContain("fire-symbol.png");
        expect(typeSources.slice(1).some((source) => source.includes("fire-banner.png"))).toBe(true);
        const subtitle = card.querySelector(".spread-card-subtitle");
        expect(subtitle.querySelector(".spread-badges")).toBeInTheDocument();
        expect(within(subtitle).getByRole("switch", { name: "Mega Stats" })).toBeInTheDocument();
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

    it("confirms deletion and restores the pending card without opening its fields", async () =>
    {
        const { card, actions, user } = renderCard({ editing: true, changed: true });
        const actionButtons = [...card.querySelectorAll(".spread-card-actions button")];
        expect(actionButtons.at(-1)).toHaveAccessibleName("Delete Charizard");
        expect(actionButtons.at(-1)).toHaveClass("MuiIconButton-colorError");
        await user.click(within(card).getByRole("button", { name: "Delete Charizard" }));
        expect(screen.getByRole("dialog", { name: "Delete Charizard?" })).toHaveTextContent("removed from its file");
        await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
        expect(actions.deleteSpread).toHaveBeenCalledWith("e2");
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

    it("repeats a held stat button and stops when the pointer leaves", () =>
    {
        vi.useFakeTimers();
        try
        {
            const { card, actions } = renderCard({ editing: true });
            const button = within(card).getByRole("button", { name: "Lower Attack IV" });
            fireEvent.pointerDown(button);
            expect(actions.updateSpread).toHaveBeenCalledTimes(1);
            act(() => vi.advanceTimersByTime(500));
            expect(actions.updateSpread.mock.calls.length).toBeGreaterThan(1);
            fireEvent.pointerLeave(button);
            const count = actions.updateSpread.mock.calls.length;
            act(() => vi.advanceTimersByTime(500));
            expect(actions.updateSpread).toHaveBeenCalledTimes(count);
        }
        finally
        {
            vi.useRealTimers();
        }
    });
});
