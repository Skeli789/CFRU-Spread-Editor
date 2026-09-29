/**
 * This file defines the the application start point.
 * It contains the main component and also handles dark mode settings.
 */

import React, { createContext, useContext, useEffect, useState } from "react";
import { Navigate, Outlet, RouterProvider, createBrowserRouter, useBlocker } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import { ThemeProvider } from '@mui/material/styles';

import DefaultPage from "./DefaultPage";
import { SpreadEditorProvider, useSpreadEditor } from "./SpreadEditorState";
import { APP_THEME, DARK_APP_THEME } from "./Theme";
import Footer from "./components/Footer";
import Header from "./components/Header";
import PrivacyPolicy from "./components/PrivacyPolicy";
import { UnsavedChangesDialog } from "./components/SpreadDialogs";
import TermsOfService from "./components/TermsOfService";

// This CSS must go below the module imports!
import './styles/App.css';

const BLOCKER_BLOCKED = "blocked";
const BEFORE_UNLOAD_EVENT = "beforeunload";

const AppShellContext = createContext(null);


/**
 * Reads the saved color scheme, falling back to the system preference.
 *
 * @returns {boolean} Whether dark mode is preferred.
 */
function getInitialDarkMode()
{
    try
    {
        const saved = localStorage.getItem("darkMode");
        if (saved !== null)
            return saved === "true";
    }
    catch
    {
        // Blocked storage falls back to the system color scheme.
    }

    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

/**
 * Warns before leaving the page or its route while spreads have unsaved changes.
 *
 * @component
 * @returns {JSX.Element} The unsaved changes prompt for route changes.
 */
const NavigationGuard = () =>
{
    const { state, dirtyCount, saveProblems, saveChanges, discardChanges } = useSpreadEditor();
    const dirty = dirtyCount > 0;
    const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);

    /**
     * Asks the browser to confirm closing or reloading the page.
     */
    useEffect(() =>
    {
        if (!dirty)
            return undefined;

        const warn = (event) =>
        {
            event.preventDefault();
            event.returnValue = "";
        };
        window.addEventListener(BEFORE_UNLOAD_EVENT, warn);
        return () => window.removeEventListener(BEFORE_UNLOAD_EVENT, warn);
    }, [dirty]);

    return (
        <UnsavedChangesDialog
            open={blocker.state === BLOCKER_BLOCKED}
            count={dirtyCount}
            saving={state.saving}
            canSave={saveProblems.length === 0}
            error={state.saveError}
            onCancel={() => blocker.reset()}
            onDiscard={() =>
            {
                discardChanges();
                blocker.proceed();
            }}
            onSave={async () =>
            {
                if (await saveChanges())
                    blocker.proceed();
            }}
        />
    );
};

/**
 * Lays out every route between the header and footer.
 *
 * @component
 * @returns {JSX.Element} The layout.
 */
const AppLayout = () =>
{
    const { darkMode, toggleDarkMode, theme } = useContext(AppShellContext);

    return (
        <div className="app" style={{ "--theme": theme.palette.primary.main, "--focus": theme.palette.focus.main, "--app-background": theme.palette.background.default, color: theme.palette.text.primary }}>
            <Header
                darkMode={darkMode}
                toggleParentDarkMode={toggleDarkMode}
            />
            <div className="main-container" id="main-container">
                <Outlet />
                <Footer />
            </div>
            <NavigationGuard />
            <ToastContainer 
                position="bottom-right"
                autoClose={3000}
                hideProgressBar={false}
                newestOnTop={false}
                closeOnClick
                rtl={false}
                pauseOnFocusLoss
                draggable
                pauseOnHover
                theme={darkMode ? "dark" : "light"}
            />
        </div>
    );
};

const ROUTES =
[
    {
        element: <AppLayout />,
        children:
        [
            // Fill in more routes here
            { path: "/privacy", element: <PrivacyPolicy /> },
            { path: "/terms", element: <TermsOfService /> },
            { path: "/", element: <DefaultPage /> },
            { path: "*", element: <Navigate to={"/"} replace /> },
        ],
    },
];

/**
 * Renders the application with its selected color scheme.
 *
 * @returns {JSX.Element} The application.
 */
function App()
{
    const [darkMode, setDarkMode] = useState(getInitialDarkMode);
    const [router] = useState(() => createBrowserRouter(ROUTES));

    useEffect(() =>
    {
        let saved = null;
        try
        {
            saved = localStorage.getItem("darkMode");
        }
        catch
        {
            // Blocked storage falls back to the system color scheme.
        }

        if (saved !== null || !window.matchMedia)
            return;

        const preference = window.matchMedia("(prefers-color-scheme: dark)");
        const updateSystemTheme = (event) => setDarkMode(event.matches);
        preference.addEventListener("change", updateSystemTheme);
        return () => preference.removeEventListener("change", updateSystemTheme);
    }, []);

    /** Switches theme and saves the explicit choice when storage is available. */
    function toggleDarkMode()
    {
        const nextDarkMode = !darkMode;
        try
        {
            localStorage.setItem("darkMode", String(nextDarkMode));
        }
        catch
        {
            // The toggle still works when storage is blocked.
        }
        setDarkMode(nextDarkMode);
    }

    const theme = darkMode ? DARK_APP_THEME : APP_THEME;

    return (
        <ThemeProvider theme={theme}>
            <SpreadEditorProvider>
                <AppShellContext.Provider value={{ darkMode, toggleDarkMode, theme }}>
                    <RouterProvider router={router} />
                </AppShellContext.Provider>
            </SpreadEditorProvider>
        </ThemeProvider>
    );
}

export default App;
