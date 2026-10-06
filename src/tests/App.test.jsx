import React from "react";
import { readFileSync } from "node:fs";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { Autocomplete, Paper, TextField, ThemeProvider } from "@mui/material";
import userEvent from "@testing-library/user-event";

import App from "../App";
import { APP_THEME, DARK_APP_THEME, createRankedFilterOptions } from "../Theme";
import PrivacyPolicy from "../components/PrivacyPolicy";
import TermsOfService from "../components/TermsOfService";

beforeEach(() =>
{
    localStorage.clear();
});

afterEach(() =>
{
    vi.unstubAllGlobals();
});

test("renders app", () =>
{
    const { getByTestId } = render(<App />);
    expect(getByTestId("spread-editor-page")).toBeInTheDocument();
});

test.each([APP_THEME, DARK_APP_THEME])("autocomplete ranks prefixes first and Enter selects the first result in either theme", async (theme) =>
{
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ThemeProvider theme={theme}>
        <Autocomplete autoHighlight options={["Great Ball", "Ultra Ball", "Ball", "Ball Capsule", "Potion"]}
            onChange={onChange} renderInput={(params) => <TextField {...params} label="Search" />} />
    </ThemeProvider>);

    const input = screen.getByRole("combobox", { name: "Search" });
    await user.type(input, "bAlL");
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Ball", "Ball Capsule", "Great Ball", "Ultra Ball"]);
    await user.keyboard("{Enter}");
    expect(input).toHaveValue("Ball");
    expect(onChange.mock.calls[0][1]).toBe("Ball");
});

test("ranked autocomplete filters preserve normalization, empty searches and custom searchable text", () =>
{
    const options = [{ name: "Cafe Special", date: "2026" }, { name: "Special Cafe", date: "2025" }, { name: "Cafeteria", date: "2024" }];
    const filter = createRankedFilterOptions({ stringify: (option) => `${option.name} ${option.date}` });
    const state = { inputValue: "  CAFÉ  ", getOptionLabel: (option) => option.name };

    expect(filter(options, state)).toEqual([options[0], options[2], options[1]]);
    expect(filter(options, { ...state, inputValue: " " })).toEqual(options);
    expect(filter(options, { ...state, inputValue: "2025" })).toEqual([options[1]]);
    expect(filter(options, { ...state, inputValue: "missing" })).toEqual([]);
});

test("privacy policy explains local hosting, stored data, and removal", () =>
{
    render(<PrivacyPolicy />);

    expect(screen.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeInTheDocument();
    expect(screen.getByText("Last updated: October 5, 2026")).toBeInTheDocument();
    expect(screen.getByText(/CFRU Spread Editor is a locally hosted web app/)).toHaveTextContent("There are no user accounts, analytics, tracking cookies");
    expect(screen.getByText(/Browser localStorage remembers repository paths/)).toHaveTextContent("unsaved spread changes");
    expect(screen.getByText(/The local API reads the CFRU/)).toHaveTextContent("DPE and Unbound Cloud remain read-only");
    expect(screen.getByText(/The API stores parsed source caches/)).toHaveTextContent("SPREAD_EDITOR_DATA_DIR");
    expect(screen.getByText(/Upload ZIP sends your chosen archive to your local API/)).toHaveTextContent("not the original ZIP");
    expect(screen.getByText(/To remove browser preferences and cached drafts/)).toHaveTextContent("Clearing browser storage does not remove API data");
    expect(screen.queryByText(/does not collect, store, or process any personal data/)).not.toBeInTheDocument();
});

test("privacy policy discloses external requests and local security limitations", () =>
{
    render(<PrivacyPolicy />);

    const requests = screen.getByText(/Local hosting does not mean every feature is offline/);
    expect(requests).toHaveTextContent("pokeapi.co");
    expect(requests).toHaveTextContent("raw.githubusercontent.com");
    expect(requests).toHaveTextContent("play.pokemonshowdown.com");
    expect(requests).toHaveTextContent("data.pkmn.cc");
    expect(screen.getByText(/These providers receive normal network request information/)).toHaveTextContent("public IP address");
    expect(screen.getByText(/These providers receive normal network request information/)).toHaveTextContent("does not send repository files, local paths, or spread edits");
    expect(screen.getByText(/The API checks local hosts/)).toHaveTextContent("Local data is not encrypted by the app");
    expect(screen.queryByText(/The API binds to/)).not.toBeInTheDocument();
    expect(screen.getByText(/Raise questions with the maintainers/)).toHaveTextContent("Issues and attachments may be public");
});

test("terms describe repository editing responsibilities instead of hosted accounts", () =>
{
    render(<TermsOfService />);

    expect(screen.getByRole("heading", { level: 1, name: "Terms of Service" })).toBeInTheDocument();
    expect(screen.getByText("Last updated: October 1, 2026")).toBeInTheDocument();
    expect(screen.getByText(/These terms describe use of CFRU Spread Editor/)).toHaveTextContent("There is no hosted account");
    expect(screen.getByText(/CFRU Spread Editor loads regular battle facility/)).toHaveTextContent("four supported CFRU spread headers, not a compiled game or ROM");
    expect(screen.getByText(/CFRU Spread Editor loads regular battle facility/)).toHaveTextContent("local extracted copy");
    expect(screen.getByText(/Choose the game that matches your CFRU build/)).toHaveTextContent("review Load Warnings");
    expect(screen.getByText(/Inspect source diffs/)).toHaveTextContent("compile your project");
    expect(screen.getByText(/Saving changes modifies source files/)).toHaveTextContent("not a substitute for Git commits or independent backups");
    expect(screen.queryByRole("heading", { name: "Account Termination" })).not.toBeInTheDocument();
    expect(screen.queryByText(/account suspension or ban|reverse engineer or hack/i)).not.toBeInTheDocument();
});

test("terms explain local-only use, license rights, and qualified disclaimers", () =>
{
    render(<TermsOfService />);

    expect(screen.getByText(/Keep the browser app and API local/)).toHaveTextContent("public tunnel, port forwarding, or a LAN service");
    expect(screen.getByText(/Availability depends on your local browser/)).toHaveTextContent("There is no hosted uptime commitment");
    expect(screen.getByText(/The editor's package metadata/)).toHaveTextContent("MIT");
    expect(screen.getByText(/The editor's package metadata/)).toHaveTextContent("do not replace or restrict rights");
    expect(screen.getByText(/To the extent permitted by applicable law/)).toHaveTextContent("Nothing in these terms excludes rights or liabilities");
    expect(screen.getByText(/Terms may be updated with future app versions/)).toHaveTextContent("there is no account to close");
});

test("uses the softened maroon light theme and persists a dark mode toggle", () =>
{
    const { getByTestId } = render(<App />);
    const app = document.documentElement;
    expect(app.style.getPropertyValue("--theme")).toBe("#800000");
    expect(app.style.getPropertyValue("--app-background")).toBe("#e8edf1");
    expect(app.style.getPropertyValue("--focus")).toBe("#1976d2");

    fireEvent.click(getByTestId("dark-mode-button"));
    expect(localStorage.getItem("darkMode")).toBe("true");
    expect(app.style.getPropertyValue("--app-background")).toBe("#262626");
    expect(app.style.getPropertyValue("--theme")).toBe("#800000");
    expect(app.style.getPropertyValue("--focus")).toBe("#90caf9");

    fireEvent.click(getByTestId("dark-mode-button"));
    expect(localStorage.getItem("darkMode")).toBe("false");
    expect(app.style.getPropertyValue("--theme")).toBe("#800000");
    expect(app.style.getPropertyValue("--app-background")).toBe("#e8edf1");
});

test.each([
    { theme: APP_THEME, paper: "#f1f4f6", card: "#dae6f0" },
    { theme: DARK_APP_THEME, paper: "#2f2f2f", card: "#2f2f2f" },
])("spread previews are tinted but editing cards match dialog paper in $theme.palette.mode mode", ({ theme, paper, card }) =>
{
    render(<ThemeProvider theme={theme}>
        <Paper data-testid="plain-paper">Dialog Surface</Paper>
        <Paper component="article" className="spread-card">Spread Preview</Paper>
        <Paper component="article" className="spread-card spread-card-editing">Edit Spread</Paper>
    </ThemeProvider>);

    expect(screen.getByTestId("plain-paper")).toHaveStyle({ backgroundColor: paper });
    expect(screen.getByText("Spread Preview")).toHaveStyle({ backgroundColor: card });
    expect(screen.getByText("Edit Spread")).toHaveStyle({ backgroundColor: paper });
    expect(theme.palette.primary.main).toBe("#800000");
});

test("uses a saved preference instead of the system preference", () =>
{
    localStorage.setItem("darkMode", "false");
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));

    render(<App />);
    expect(document.documentElement.style.getPropertyValue("--theme")).toBe("#800000");
    expect(document.documentElement.style.getPropertyValue("--app-background")).toBe("#e8edf1");
});

test("follows system preference changes when there is no saved preference", () =>
{
    let onChange;
    const removeEventListener = vi.fn();
    vi.stubGlobal("matchMedia", vi.fn(() => ({
        matches: true,
        addEventListener: (event, listener) => { onChange = listener; },
        removeEventListener,
    })));

    const { unmount } = render(<App />);
    const app = document.documentElement;
    expect(app.style.getPropertyValue("--app-background")).toBe("#262626");

    act(() => onChange({ matches: false }));
    expect(app.style.getPropertyValue("--theme")).toBe("#800000");
    expect(app.style.getPropertyValue("--app-background")).toBe("#e8edf1");
    unmount();
    expect(removeEventListener).toHaveBeenCalledWith("change", onChange);
});

test("keeps page and dialog scrollbars themed and only textarea scrollbars focused", () =>
{
    const styles = readFileSync("src/styles/App.css", "utf8");
    const dialogs = readFileSync("src/components/SpreadDialogs.jsx", "utf8");
    expect(styles).toMatch(/html, html \*\s*\{\s*scrollbar-width: thin;\s*scrollbar-color: var\(--theme\) transparent;/);
    const focusRules = [...styles.matchAll(/([^{}]+)\{([^{}]*var\(--focus\)[^{}]*)\}/g)];
    expect(focusRules).toHaveLength(2);
    expect(focusRules.map((match) => match[1].trim().replace(/\s+/g, " "))).toEqual([
        "html textarea",
        "html textarea::-webkit-scrollbar-thumb, html textarea::-webkit-scrollbar-thumb:hover",
    ]);
    expect(focusRules[0][2]).toContain("scrollbar-color: var(--focus) transparent;");
    expect(focusRules[1][2]).toContain("background: var(--focus);");
    expect(dialogs).not.toMatch(/"--theme":\s*theme\.palette\.focus/);
});
