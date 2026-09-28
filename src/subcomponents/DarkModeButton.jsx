/**
 * This file defines the DarkModeButton component.
 * It is used to turn dark mode for the site on and off.
 */

import React from 'react';
import { IconButton, Tooltip } from '@mui/material';

import { MdSunny, MdModeNight } from 'react-icons/md';


/**
 * Represents the DarkModeButton component.
 * @constructor
 * @param {boolean} props.darkMode - Indicates if dark mode is enabled.
 * @param {Function} props.toggleParentDarkMode - Function to toggle dark mode in the App component.
 * @returns {JSX.Element} The rendered DarkModeButton component.
 */
const DarkModeButton = ({ darkMode, toggleParentDarkMode }) =>
{
    const size = 42;
    const id = "dark-mode-button";
    const tooltip = (darkMode) ? "Light Mode" : "Dark Mode";

    return (
        <Tooltip title={tooltip} placement="bottom" arrow enterTouchDelay={0} >
            <IconButton id={id} data-testid={id}
                className="button"
                aria-label="Toggle Dark Mode"
                onClick={toggleParentDarkMode}>
                {darkMode ? <MdSunny size={size} /> : <MdModeNight size={size} />}
            </IconButton>
        </Tooltip>
    );
}

export default DarkModeButton;
