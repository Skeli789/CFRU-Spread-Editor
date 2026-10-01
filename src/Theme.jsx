/**
 * This file defines the main theme for the application.
 */

import { alpha, createTheme } from '@mui/material/styles';
import { autocompleteClasses, formLabelClasses, inputClasses, listItemButtonClasses, menuItemClasses, outlinedInputClasses, tableRowClasses } from '@mui/material';

// Focused fields and chosen entries use Material UI's standard blue rather than the red theme color
const FOCUS_COLORS = { light: "#1976d2", dark: "#90caf9" };
const FOCUS_PALETTES =
{
    light: { main: FOCUS_COLORS.light, light: "#42a5f5", dark: "#1565c0", contrastText: "#fff" },
    dark: { main: FOCUS_COLORS.dark, light: "#e3f2fd", dark: "#42a5f5", contrastText: "rgba(0, 0, 0, 0.87)" },
};
const SELECTED_OPACITY = 0.16;
const SELECTED_HOVER_OPACITY = 0.24;
const BACKGROUND_COLORS = { light: "#f8f9fa", dark: "#262626" };
const PAPER_COLORS = { light: "#ffffff", dark: "#2f2f2f" };
const PRIMARY_COLORS = { light: { main: "#ff0000" }, dark: { main: "#800000", light: "#e57373" } };
const OUTLINE_OPACITY = 0.5;


/**
 * Returns styles that swap maroon for its lighter tone where it would sit on the dark background as text or a control.
 *
 * @param {object} options The component's owner state and theme.
 * @param {object} options.ownerState The component's props.
 * @param {object} options.theme The theme.
 * @param {Function} styles Returns the styles given the lighter tone.
 * @returns {object} The styles, or none outside dark mode.
 */
function readableOnDark({ ownerState, theme }, styles)
{
    return theme.palette.mode === "dark" && (ownerState.color ?? "primary") === "primary" ? styles(theme.palette.primary.light) : {};
}

/**
 * Returns styles giving a selected entry the focus color.
 *
 * @param {string} selectedClass The component's selected class.
 * @param {string} focus The focus color.
 * @returns {object} The styles.
 */
function selectedStyles(selectedClass, focus)
{
    return {
        [`&.${selectedClass}`]: { backgroundColor: alpha(focus, SELECTED_OPACITY) },
        [`&.${selectedClass}:hover`]: { backgroundColor: alpha(focus, SELECTED_HOVER_OPACITY) },
    };
}

/**
 * Creates the application theme for a color scheme.
 *
 * @param {"light" | "dark"} mode The palette mode.
 * @returns {import('@mui/material/styles').Theme} The application theme.
 */
function createAppTheme(mode)
{
    const focus = FOCUS_COLORS[mode];

    return createTheme({
    palette:
    {
        mode,
        primary: PRIMARY_COLORS[mode],
        focus: FOCUS_PALETTES[mode],
        background: { default: BACKGROUND_COLORS[mode], paper: PAPER_COLORS[mode] },
    },
    components:
    {
        MuiButton:
        {
            styleOverrides:
            {
                root: (props) => (props.ownerState.variant === "contained" ? {} : readableOnDark(props, (color) =>
                    ({ color, ...(props.ownerState.variant === "outlined" && { borderColor: alpha(color, OUTLINE_OPACITY) }) }))),
            },
        },
        MuiToggleButton: { styleOverrides: { root: (props) => readableOnDark(props, (color) => ({ "&.Mui-selected": { color } })) } },
        MuiCheckbox: { styleOverrides: { root: (props) => readableOnDark(props, (color) => ({ "&.Mui-checked": { color } })) } },
        MuiSwitch:
        {
            styleOverrides:
            {
                switchBase: (props) => readableOnDark(props, (color) => ({ "&.Mui-checked": { color }, "&.Mui-checked + .MuiSwitch-track": { backgroundColor: color } })),
            },
        },
        MuiFormLabel:
        {
            styleOverrides:
            {
                root: { [`&.${formLabelClasses.focused}:not(.${formLabelClasses.error})`]: { color: focus } },
                asterisk: ({ theme }) => ({ color: theme.palette.error.main }),
            },
        },
        MuiOutlinedInput:
        {
            styleOverrides:
            {
                root: { [`&.${outlinedInputClasses.focused}:not(.${outlinedInputClasses.error}) .${outlinedInputClasses.notchedOutline}`]: { borderColor: focus } },
            },
        },
        MuiInput:
        {
            styleOverrides:
            {
                root: { [`&.${inputClasses.focused}:not(.${inputClasses.error})::after`]: { borderBottomColor: focus } },
            },
        },
        MuiMenuItem: { styleOverrides: { root: selectedStyles(menuItemClasses.selected, focus) } },
        MuiListItemButton: { styleOverrides: { root: selectedStyles(listItemButtonClasses.selected, focus) } },
        MuiTableRow: { styleOverrides: { root: selectedStyles(tableRowClasses.selected, focus) } },
        MuiAutocomplete:
        {
            // Its buttons are already labelled, and their native titles would show browser tooltips
            defaultProps: { slotProps: { popupIndicator: { title: undefined }, clearIndicator: { title: undefined } } },
            styleOverrides:
            {
                option:
                {
                    [`&[aria-selected="true"], &[aria-selected="true"].${autocompleteClasses.focused}`]: { backgroundColor: `${alpha(focus, SELECTED_OPACITY)} !important` },
                },
            },
        },
    },
    });
}

export const APP_THEME = createAppTheme("light");
export const DARK_APP_THEME = createAppTheme("dark");
