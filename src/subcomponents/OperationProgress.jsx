import React from "react";
import { LinearProgress, Stack, Typography } from "@mui/material";

/**
 * Displays actual completed work as an accessible percentage.
 *
 * @param {object} props The component props.
 * @param {{percentage: number, label: string}|null} props.progress The current operation.
 * @returns {JSX.Element|null} The progress display.
 */
const OperationProgress = ({ progress }) =>
{
    if (progress == null)
        return null;

    return (
        <Stack spacing={1}>
            <Typography role="status" variant="body2">{progress.label} {progress.percentage}%</Typography>
            <LinearProgress variant="determinate" value={progress.percentage} aria-label={progress.label} />
        </Stack>
    );
};

export default OperationProgress;
