/**
 * This file defines the the application start point.
 * It contains the main component and also handles dark mode settings.
 */

import React, { useEffect, useState } from "react";
import { Navigate, Route, BrowserRouter as Router, Routes } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import { ThemeProvider } from '@mui/material/styles';

import DefaultPage from "./DefaultPage";
import { SpreadEditorProvider } from "./SpreadEditorState";
import { APP_THEME, DARK_APP_THEME } from "./Theme";
import Footer from "./components/Footer";
import Header from "./components/Header";
import PrivacyPolicy from "./components/PrivacyPolicy";
import TermsOfService from "./components/TermsOfService";

// This CSS must go below the module imports!
import './styles/App.css';


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
 * Renders the application with its selected color scheme.
 *
 * @returns {JSX.Element} The application.
 */
function App()
{
    const [darkMode, setDarkMode] = useState(getInitialDarkMode);

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
                <Router>
                    <div className="app" style={{ "--theme": theme.palette.primary.main, "--app-background": theme.palette.background.default, color: theme.palette.text.primary }}>
                        <Header
                            darkMode={darkMode}
                            toggleParentDarkMode={toggleDarkMode}
                        />
                        <div className="main-container" id="main-container">
                            <Routes>
                                {/* Fill in more routes here */}
                                <Route path="/privacy" element={<PrivacyPolicy />} />
                                <Route path="/terms" element={<TermsOfService />} />
                                <Route path="/" element={<DefaultPage />} />
                                <Route path="*" element={<Navigate to={"/"} replace />} />
                            </Routes>
                            <Footer />
                        </div>
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
                </Router>
            </SpreadEditorProvider>
        </ThemeProvider>
    );
}

export default App;
