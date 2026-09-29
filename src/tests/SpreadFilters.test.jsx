import React, { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { getDefaultFilters } from "../../shared/spread-layout.mjs";
import SpreadFilters from "../components/SpreadFilters";
import { createCatalog, createSpreads } from "./EditorFixtures";

/**
 * Hosts the filters with observable local state.
 *
 * @param {object} props Component props.
 * @returns {JSX.Element} The filter toolbar.
 */
function FiltersHarness({ spreads, catalog })
{
    const defaults = getDefaultFilters(spreads);
    const [filters, setFilters] = useState(defaults);
    return <SpreadFilters spreads={spreads} catalog={catalog} filters={filters} onFiltersChange={setFilters}
                          resultCount={spreads.entries.length} preview={{ level: 50 }} onPreviewChange={() => {}} onAutoFix={() => {}} />;
}

describe("Spread filters", () =>
{
    test("lists alternate forms in the species filter by their form names", async () =>
    {
        const user = userEvent.setup();
        const catalog = createCatalog();
        const spreads = createSpreads();
        catalog.species.SPECIES_CHARIZARD_MEGA_X = { ...catalog.species.SPECIES_CHARIZARD, showdownName: "Charizard-Mega-X" };
        spreads.entries[1] = { ...spreads.entries[1], fields: { ...spreads.entries[1].fields, species: "SPECIES_CHARIZARD_MEGA_X" } };
        render(<FiltersHarness spreads={spreads} catalog={catalog} />);
        await user.click(screen.getByRole("button", { name: "More Filters" }));
        await user.click(screen.getByRole("combobox", { name: "Species" }));
        expect(await screen.findByRole("option", { name: "Charizard" })).toBeInTheDocument();
        expect(screen.getByRole("option", { name: "Charizard Mega X" })).toBeInTheDocument();
    });

    test("keeps the unsaved toggle spaced from the fields without bulk editing controls", async () =>
    {
        const user = userEvent.setup();
        render(<FiltersHarness spreads={createSpreads()} catalog={createCatalog()} />);

        expect(screen.queryByRole("button", { name: /^(Edit All|Lock All)$/ })).not.toBeInTheDocument();
        // The starting spread set counts as an active filter
        expect(screen.getByRole("button", { name: "Clear Filters" })).toBeEnabled();
        expect(document.querySelector(".MuiBadge-badge")).toHaveTextContent("1");
        await user.click(screen.getByRole("button", { name: "More Filters" }));
        const unsaved = screen.getByRole("switch", { name: "Unsaved Changes" });
        expect(unsaved.closest("label")).toHaveStyle({ paddingLeft: "8px" });
        await user.click(unsaved);
        expect(unsaved).toBeChecked();
    });

    test("uses readable filenames, one team catch-all and image-backed option rows", async () =>
    {
        const user = userEvent.setup();
        const catalog = createCatalog();
        catalog.species.SPECIES_CHARIZARD.icon = "/icons/charizard.png";
        catalog.species.SPECIES_CHARIZARD.sprite.normal = "/sprites/charizard.png";
        catalog.items.ITEM_HEAVYDUTYBOOTS.icon = "/icons/boots.png";
        catalog.types.TYPE_FIRE.symbol = "/icons/fire.png";
        render(<FiltersHarness spreads={createSpreads()} catalog={catalog} />);

        expect(screen.queryByText(/spreads match/)).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "More Filters" }));
        const rows = [...document.querySelectorAll(".toolbar-fields")].map((row) => [...row.querySelectorAll("label")].map((label) => label.textContent.trim()).filter(Boolean));
        expect(rows).toEqual([
            ["Species", "Ability", "Item", "Moves"],
            ["Shiny", "Mega Stone", "Z-Crystal", "Gigantamax", "Battle Type", "Doubles Team Type"],
            ["File", "Spread Set", "Trainer", "Unsaved Changes", "Illegal Moves"],
        ]);
        await user.click(screen.getByRole("combobox", { name: "File" }));
        expect(screen.getByRole("option", { name: "Battle Tower Spreads" })).toBeInTheDocument();
        await user.keyboard("{Escape}");
        await user.click(screen.getByRole("combobox", { name: "Doubles Team Type" }));
        expect(screen.queryByRole("option", { name: "All" })).not.toBeInTheDocument();
        expect(screen.queryByRole("option", { name: "Any" })).not.toBeInTheDocument();
        await user.keyboard("{Escape}");

        await user.click(screen.getByRole("combobox", { name: "Species" }));
        const speciesIcon = (await screen.findByRole("option", { name: "Charizard" })).querySelector("img");
        expect(speciesIcon).toHaveAttribute("src", expect.stringContaining("/icons/charizard.png"));
        fireEvent.error(speciesIcon);
        expect(speciesIcon).toHaveAttribute("src", expect.stringContaining("/sprites/charizard.png"));
        await user.keyboard("{Escape}");
        await user.click(screen.getByRole("combobox", { name: "Item" }));
        expect((await screen.findByRole("option", { name: "Heavy-Duty Boots" })).querySelector("img")).toHaveAttribute("src", expect.stringContaining("boots.png"));
        await user.keyboard("{Escape}");
        await user.click(screen.getByRole("combobox", { name: "Moves" }));
        expect((await screen.findByRole("option", { name: "Flamethrower" })).querySelector("img")).toHaveAttribute("src", expect.stringContaining("fire.png"));
    });

    test("highlights the first matching filter option for Enter and allows clearing team type", async () =>
    {
        const user = userEvent.setup();
        render(<FiltersHarness spreads={createSpreads()} catalog={createCatalog()} />);
        await user.click(screen.getByRole("button", { name: "More Filters" }));
        const teamType = screen.getByRole("combobox", { name: "Doubles Team Type" });
        await user.type(teamType, "Sun");
        expect(screen.getByRole("option", { name: /Sun/i })).toBeInTheDocument();
        await user.keyboard("{Enter}");
        expect(teamType).toHaveValue("Sun");
        await user.click(within(teamType.closest(".MuiAutocomplete-root")).getByRole("button", { name: "Clear" }));
        expect(teamType).toHaveValue("");

        const species = screen.getByRole("combobox", { name: "Species" });
        await user.type(species, "Charizard{Enter}");
        expect(within(species.closest(".MuiAutocomplete-root")).getByText("Charizard")).toBeInTheDocument();
    });

    test("shows the trainer section in the selected value but not in unique option rows and clears the set on trainer change", async () =>
    {
        const user = userEvent.setup();
        const spreads = createSpreads();
        spreads.trainers.push({ ...spreads.trainers[0], id: "second-trainer", name: "Second", links: spreads.trainers[0].links });
        render(<FiltersHarness spreads={spreads} catalog={createCatalog()} />);
        await user.click(screen.getByRole("button", { name: "More Filters" }));
        await user.click(screen.getByRole("combobox", { name: "Trainer" }));
        await user.click(await screen.findByRole("option", { name: "Second" }));
        expect(screen.getByRole("combobox", { name: "Trainer" })).toHaveValue("Second [Special Trainer]");
        expect(screen.getByRole("combobox", { name: "Spread Set" })).toHaveValue("");
    });
});
