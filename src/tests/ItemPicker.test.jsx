import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { vi } from "vitest";

import ItemPicker, { getChooserItems, getItemOptions, getItemTypeLabel } from "../subcomponents/ItemPicker";
import { createCatalog } from "./EditorFixtures";

const BASE_CATALOG = createCatalog();
const ITEM_GROUPS = ["Held Item", "Gem", "Berries", "Incense", "Plate", "Drive", "Memory", "Mega Stone", "Primal Orb", "Z-Crystal", "Other"];
const ITEMS =
{
    ITEM_KINGS_ROCK: { name: "King's Rock", itemType: "ITEM_TYPE_EVOLUTION_ITEM" },
    ITEM_METAL_COAT: { name: "Metal Coat", itemType: "ITEM_TYPE_EVOLUTION_ITEM" },
    ITEM_RAZOR_CLAW: { name: "Razor Claw", itemType: "ITEM_TYPE_EVOLUTION_ITEM" },
    ITEM_RAZOR_FANG: { name: "Razor Fang", itemType: "ITEM_TYPE_EVOLUTION_ITEM" },
    ITEM_NORMAL_GEM: { name: "Normal Gem", itemType: "ITEM_TYPE_GEM" },
    ITEM_ORAN_BERRY: { name: "Oran Berry", itemType: null },
    ITEM_ODD_INCENSE: { name: "Odd Incense", itemType: "ITEM_TYPE_INCENSE" },
    ITEM_FLAME_PLATE: { name: "Flame Plate", itemType: "ITEM_TYPE_PLATE" },
    ITEM_BURN_DRIVE: { name: "Burn Drive", itemType: "ITEM_TYPE_DRIVE" },
    ITEM_FIRE_MEMORY: { name: "Fire Memory", itemType: "ITEM_TYPE_MEMORY" },
    ITEM_RED_ORB: { name: "Red Orb", itemType: "ITEM_TYPE_PRIMAL_ORB" },
    ITEM_POTION: { name: "Potion", itemType: "ITEM_TYPE_FIELD_USE" },
};
const CATALOG = { ...BASE_CATALOG, items: { ...BASE_CATALOG.items, ...Object.fromEntries(Object.entries(ITEMS).map(([key, item]) => [key, { icon: null, ...item }])) } };


describe("Item picker", () =>
{
    it("groups only requested item types in order and keeps evolution-item exceptions held", () =>
    {
        expect(getItemTypeLabel("ITEM_TYPE_FIELD_USE")).toBe("Other");
        const options = getItemOptions(CATALOG);
        for (const name of ["King's Rock", "Metal Coat", "Razor Claw", "Razor Fang"])
            expect(options.find((option) => option.name === name).typeLabel).toBe("Held Item");
        expect(options.find((option) => option.name === "Oran Berry").typeLabel).toBe("Berries");
        expect(getChooserItems(CATALOG, "", null).filter((option) => option.value !== "ITEM_NONE")
            .map((option) => option.typeLabel).filter((group, index, all) => index === 0 || group !== all[index - 1])).toEqual(ITEM_GROUPS);
        expect(getChooserItems(CATALOG, "potion", "Other").map((option) => option.name)).toEqual(["Potion"]);
    });

    it.each(["light", "dark"])("keeps sticky headings opaque in %s mode", async (mode) =>
    {
        const theme = createTheme({ palette: { mode } });
        const user = userEvent.setup();
        render(<ThemeProvider theme={theme}><ItemPicker catalog={CATALOG} value="ITEM_METAL_COAT" speciesName="Charizard" onChange={vi.fn()} /></ThemeProvider>);
        await user.click(screen.getByRole("combobox", { name: "Item" }));
        await user.click(screen.getByRole("button", { name: "Advanced" }));
        const dialog = await screen.findByRole("dialog", { name: "Choose Item for Charizard" });
        const heading = within(dialog).getAllByRole("listitem").find((item) => item.classList.contains("item-list-heading"));
        const list = within(dialog).getByRole("list", { name: "Items" });
        expect(list).not.toHaveClass("MuiList-padding");
        expect(heading.parentElement).toBe(list);
        expect(heading).toHaveStyle({ backgroundColor: theme.palette.background.paper, zIndex: "2", position: "sticky" });
        expect(within(dialog).getAllByRole("listitem").filter((item) => item.classList.contains("item-list-heading")).map((item) => item.textContent))
            .toEqual(ITEM_GROUPS);
    });

    it("highlights the first matching card option for Enter and preserves the default title", async () =>
    {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<ItemPicker catalog={CATALOG} value="ITEM_LEFTOVERS" onChange={onChange} />);
        const field = screen.getByRole("combobox", { name: "Item" });
        await user.clear(field);
        await user.type(field, "Metal Coat{Enter}");
        expect(onChange).toHaveBeenCalledWith("ITEM_METAL_COAT");
        await user.click(field);
        await user.click(screen.getByRole("button", { name: "Advanced" }));
        expect(await screen.findByRole("dialog", { name: "Choose Item" })).toBeInTheDocument();
    });

    it("shows the selected item's icon and opens the dialog from the field adornment", async () =>
    {
        const catalog = { ...CATALOG, items: { ...CATALOG.items, ITEM_LEFTOVERS: { ...CATALOG.items.ITEM_LEFTOVERS, icon: "/leftovers.png" } } };
        const user = userEvent.setup();
        render(<ItemPicker catalog={catalog} value="ITEM_LEFTOVERS" onChange={vi.fn()} />);
        const field = screen.getByRole("combobox", { name: "Item" });
        expect(field.closest(".MuiInputBase-root").querySelector("img")).toHaveAttribute("src", expect.stringContaining("leftovers.png"));
        await user.click(screen.getByRole("button", { name: "Advanced search for Item" }));
        expect(await screen.findByRole("dialog", { name: "Choose Item" })).toBeInTheDocument();
    });

    it("shows the return-to-top button after scrolling the item list", async () =>
    {
        const user = userEvent.setup();
        render(<ItemPicker catalog={CATALOG} value="ITEM_NONE" onChange={vi.fn()} />);
        await user.click(screen.getByRole("button", { name: "Advanced search for Item" }));
        const dialog = await screen.findByRole("dialog", { name: "Choose Item" });
        const list = within(dialog).getByRole("list", { name: "Items" });
        expect(within(dialog).queryByRole("button", { name: "Scroll to top" })).not.toBeInTheDocument();
        list.scrollTop = 120;
        fireEvent.scroll(list);
        await user.click(within(dialog).getByRole("button", { name: "Scroll to top" }));
        expect(list.scrollTop).toBe(0);
        expect(within(dialog).queryByRole("button", { name: "Scroll to top" })).not.toBeInTheDocument();
    });

    it("returns to the top of the list when a search starts", async () =>
    {
        const user = userEvent.setup();
        render(<ItemPicker catalog={CATALOG} value="ITEM_NONE" onChange={vi.fn()} />);
        await user.click(screen.getByRole("button", { name: "Advanced search for Item" }));
        const dialog = await screen.findByRole("dialog", { name: "Choose Item" });
        const list = within(dialog).getByRole("list", { name: "Items" });
        list.scrollTop = 120;
        await user.type(within(dialog).getByRole("textbox", { name: "Search" }), "o");
        expect(list.scrollTop).toBe(0);
    });

    it("navigates from the chosen item with the arrow keys and selects the highlight with Enter", async () =>
    {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<ItemPicker catalog={CATALOG} value="ITEM_LEFTOVERS" onChange={onChange} />);
        await user.click(screen.getByRole("button", { name: "Advanced search for Item" }));
        const dialog = await screen.findByRole("dialog", { name: "Choose Item" });
        const search = within(dialog).getByRole("textbox", { name: "Search" });
        expect(search).toHaveFocus();
        expect(dialog.querySelector('[data-highlighted="true"]')).toHaveAttribute("data-item", "ITEM_LEFTOVERS");

        const keys = [...dialog.querySelectorAll("[data-item]")].map((row) => row.dataset.item);
        await user.keyboard("{ArrowDown}");
        expect(dialog.querySelector('[data-highlighted="true"]')).toHaveAttribute("data-item", keys[keys.indexOf("ITEM_LEFTOVERS") + 1]);

        await user.type(search, "metal");
        expect(dialog.querySelector('[data-highlighted="true"]')).toHaveAttribute("data-item", "ITEM_METAL_COAT");
        await user.keyboard("{Enter}");
        expect(onChange).toHaveBeenCalledWith("ITEM_METAL_COAT");
    });

    it("returns focus to the search after choosing an item type so the arrows move through the list", async () =>
    {
        const user = userEvent.setup();
        render(<ItemPicker catalog={CATALOG} value="ITEM_NONE" onChange={vi.fn()} />);
        await user.click(screen.getByRole("button", { name: "Advanced search for Item" }));
        const dialog = await screen.findByRole("dialog", { name: "Choose Item" });
        await user.click(within(dialog).getByRole("combobox", { name: "Item Type" }));
        await user.click(await screen.findByRole("option", { name: "Gem" }));
        expect(within(dialog).getByRole("textbox", { name: "Search" })).toHaveFocus();
        await user.keyboard("{ArrowDown}");
        expect(dialog.querySelector('[data-highlighted="true"]')).toBeInTheDocument();
    });
});
