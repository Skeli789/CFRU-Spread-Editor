import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import SpreadGrid from "../components/SpreadGrid";

const PAGE_COUNT = 30;
const PAGE_SIZE = 12;

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
                            getSetHeading={() => ({ title: "Spreads", file: "test.h" })} onPageSizeChange={() => {}} onClearFilters={() => {}} />);

        await user.click(screen.getAllByRole("button", { name: "Jump to Page" })[0]);
        const dialog = screen.getByRole("dialog", { name: `Jump to Page (${PAGE_COUNT} Pages)` });
        const input = within(dialog).getByRole("spinbutton", { name: "Page" });
        expect(within(dialog).queryByText(`Page (1-${PAGE_COUNT})`)).not.toBeInTheDocument();
        expect(within(dialog).getByRole("button", { name: "Go" })).toHaveClass("MuiButton-colorFocus");
        await user.clear(input);
        expect(within(dialog).getByRole("button", { name: "Go" })).toBeDisabled();
        await user.type(input, "1.5");
        expect(within(dialog).getByRole("button", { name: "Go" })).toBeDisabled();
        await user.clear(input);
        await user.type(input, "999{Enter}");
        await waitFor(() => expect(screen.queryByRole("dialog", { name: `Jump to Page (${PAGE_COUNT} Pages)` })).not.toBeInTheDocument());
        expect(screen.getByRole("status")).toHaveTextContent("Showing 349-360 of 360 spreads");

        await user.click(screen.getAllByRole("button", { name: "Jump to Page" })[0]);
        const nextDialog = screen.getByRole("dialog", { name: `Jump to Page (${PAGE_COUNT} Pages)` });
        await user.clear(within(nextDialog).getByRole("spinbutton"));
        await user.type(within(nextDialog).getByRole("spinbutton"), "999");
        expect(within(nextDialog).getByRole("spinbutton")).toHaveValue(PAGE_COUNT);
        await user.clear(within(nextDialog).getByRole("spinbutton"));
        await user.type(within(nextDialog).getByRole("spinbutton"), "0");
        await user.click(within(nextDialog).getByRole("button", { name: "Go" }));
        await waitFor(() => expect(screen.queryByRole("dialog", { name: `Jump to Page (${PAGE_COUNT} Pages)` })).not.toBeInTheDocument());
        expect(screen.getByRole("status")).toHaveTextContent("Showing 1-12 of 360 spreads");

        await user.click(screen.getAllByRole("button", { name: "Jump to Page" })[0]);
        await user.click(within(screen.getByRole("dialog", { name: `Jump to Page (${PAGE_COUNT} Pages)` })).getByRole("button", { name: "Cancel" }));
        await waitFor(() => expect(screen.queryByRole("dialog", { name: `Jump to Page (${PAGE_COUNT} Pages)` })).not.toBeInTheDocument());
        expect(screen.getByRole("status")).toHaveTextContent("Showing 1-12 of 360 spreads");
    });
});
