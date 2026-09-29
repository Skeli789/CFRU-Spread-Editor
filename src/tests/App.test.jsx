import React from "react";
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
    const defaultPageDiv = getByTestId("default-page");
    expect(defaultPageDiv).toBeInTheDocument();
});

test("uses the red light theme and persists a dark mode toggle", () =>
{
    const { container, getByTestId } = render(<App />);
    const app = container.querySelector(".app");
    expect(app.style.getPropertyValue("--theme")).toBe("#ff0000");
    expect(app.style.getPropertyValue("--app-background")).toBe("#f8f9fa");
    expect(app.style.getPropertyValue("--focus")).toBe("#1976d2");

    fireEvent.click(getByTestId("dark-mode-button"));
    expect(localStorage.getItem("darkMode")).toBe("true");
    expect(app.style.getPropertyValue("--app-background")).toBe("#262626");

    fireEvent.click(getByTestId("dark-mode-button"));
    expect(localStorage.getItem("darkMode")).toBe("false");
    expect(app.style.getPropertyValue("--theme")).toBe("#ff0000");
});

test("uses a saved preference instead of the system preference", () =>
{
    localStorage.setItem("darkMode", "false");
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));

    const { container } = render(<App />);
    expect(container.querySelector(".app").style.getPropertyValue("--theme")).toBe("#ff0000");
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

    const { container, unmount } = render(<App />);
    const app = container.querySelector(".app");
    expect(app.style.getPropertyValue("--app-background")).toBe("#262626");

    act(() => onChange({ matches: false }));
    expect(app.style.getPropertyValue("--theme")).toBe("#ff0000");
    unmount();
    expect(removeEventListener).toHaveBeenCalledWith("change", onChange);
});
