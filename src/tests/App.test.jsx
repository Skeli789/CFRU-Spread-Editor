import React from "react";
import { readFileSync } from "node:fs";
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

import App from "../App";

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

test("uses the red light theme and persists a dark mode toggle", () =>
{
    const { getByTestId } = render(<App />);
    const app = document.documentElement;
    expect(app.style.getPropertyValue("--theme")).toBe("#ff0000");
    expect(app.style.getPropertyValue("--app-background")).toBe("#f8f9fa");
    expect(app.style.getPropertyValue("--focus")).toBe("#1976d2");

    fireEvent.click(getByTestId("dark-mode-button"));
    expect(localStorage.getItem("darkMode")).toBe("true");
    expect(app.style.getPropertyValue("--app-background")).toBe("#262626");
    expect(app.style.getPropertyValue("--theme")).toBe("#800000");
    expect(app.style.getPropertyValue("--focus")).toBe("#90caf9");

    fireEvent.click(getByTestId("dark-mode-button"));
    expect(localStorage.getItem("darkMode")).toBe("false");
    expect(app.style.getPropertyValue("--theme")).toBe("#ff0000");
});

test("uses a saved preference instead of the system preference", () =>
{
    localStorage.setItem("darkMode", "false");
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));

    render(<App />);
    expect(document.documentElement.style.getPropertyValue("--theme")).toBe("#ff0000");
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
    expect(app.style.getPropertyValue("--theme")).toBe("#ff0000");
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
