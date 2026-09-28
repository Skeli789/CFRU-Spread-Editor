/**
 * This file defines the main theme for the application.
 */

import { createTheme } from '@mui/material/styles';


/**
 * Creates the application theme for a color scheme.
 *
 * @param {"light" | "dark"} mode The palette mode.
 * @returns {import('@mui/material/styles').Theme} The application theme.
 */
function createAppTheme(mode)
{
    return createTheme({
    palette:
    {
        mode,
        primary: { main: mode === "light" ? "#ff0000" : "#d32f2f" },
        background: { default: mode === "light" ? "#f8f9fa" : "#121212" },
    },
    components:
    {
        MuiFormLabel:
        {
            styleOverrides:
            {
                asterisk: ({ theme }) => ({ color: theme.palette.error.main }),
            },
        },
    },
    });
}

export const APP_THEME = createAppTheme("light");
export const DARK_APP_THEME = createAppTheme("dark");
