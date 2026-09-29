/**
 * This file defines the spread editor's dialogs: the IV auto-fix preview and the unsaved changes prompt.
 */

import React from "react";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, List, ListItem, ListItemText, Typography, useMediaQuery, useTheme } from "@mui/material";

// Long previews are cut short so the dialog stays responsive
const MAX_PREVIEW_ITEMS = 200;
const EDIT_DIALOG_MAX_WIDTH = 650;


/**
 * Shows the editable spread in a modal while its grid card remains in view mode.
 *
 * @component
 * @param {Object} props The component props.
 * @param {string} props.name The species name.
 * @param {React.ReactNode} props.children The edit-mode card.
 * @param {Function} props.onClose Closes the editor without discarding drafts.
 * @returns {JSX.Element} The dialog.
 */
export const EditSpreadDialog = ({ name, children, onClose }) =>
{
    const theme = useTheme();
    const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));

    return (
        <Dialog open onClose={onClose} fullWidth maxWidth={false} fullScreen={fullScreen} aria-labelledby="edit-spread-title"
                slotProps={{ paper: { sx: { maxWidth: fullScreen ? undefined : EDIT_DIALOG_MAX_WIDTH, "--theme": theme.palette.primary.main, "--focus": theme.palette.focus.main } } }}>
            <DialogTitle id="edit-spread-title">Edit {name}</DialogTitle>
            <DialogContent dividers className="edit-spread-content">{children}</DialogContent>
            <DialogActions><Button variant="contained" onClick={onClose}>Done</Button></DialogActions>
        </Dialog>
    );
};

/**
 * A list of spreads with a description of each, cut short when very long.
 *
 * @component
 * @param {Object} props - The component props
 * @param {Array<{id: string, label: string, text: string}>} props.items - The spreads.
 * @param {string} props.label - The list's accessible name.
 * @returns {JSX.Element} The list.
 */
const PreviewList = ({ items, label }) =>
{
    return (
        <>
            <List dense disablePadding aria-label={label} className="preview-list">
                {items.slice(0, MAX_PREVIEW_ITEMS).map((item) => (
                    <ListItem key={item.id} disableGutters>
                        <ListItemText primary={item.label} secondary={item.text} />
                    </ListItem>
                ))}
            </List>
            {items.length > MAX_PREVIEW_ITEMS && <Typography variant="body2" color="text.secondary">And {items.length - MAX_PREVIEW_ITEMS} more.</Typography>}
        </>
    );
};

/**
 * The preview shown before auto-fixing attacking IVs.
 *
 * @component
 * @param {Object} props - The component props
 * @param {boolean} props.open - Whether the dialog is open.
 * @param {Array<{id: string, label: string, text: string}>} props.changes - The spreads that would change.
 * @param {Array<{id: string, label: string, text: string}>} props.skipped - The spreads with stats left alone.
 * @param {number} props.lockedCount - How many matching spreads cannot be changed.
 * @param {Function} props.onApply - Applies the changes.
 * @param {Function} props.onClose - Closes without changing anything.
 * @returns {JSX.Element} The dialog.
 */
export const AutoFixDialog = ({ open, changes, skipped, lockedCount, onApply, onClose }) =>
{
    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="auto-fix-title">
            <DialogTitle id="auto-fix-title">Auto-Fix IVs</DialogTitle>
            <DialogContent dividers>
                <DialogContentText>
                    Attacking IVs that no move uses, and Speed for spreads with Gyro Ball or Trick Room, are lowered to 0, or to 1 where Hidden Power needs it. Attacking IVs that a move uses are raised to 31, or to 30 where Hidden Power needs it. This applies to every matching spread on every page.
                </DialogContentText>
                {changes.length === 0
                    ? <Alert severity="info" sx={{ mt: 2 }}>No matching spread needs its IVs changed.</Alert>
                    : <>
                        <Typography variant="subtitle2" sx={{ mt: 2 }}>{changes.length} spreads will change</Typography>
                        <PreviewList items={changes} label="Spreads that will change" />
                    </>}
                {skipped.length > 0 &&
                    <>
                        <Typography variant="subtitle2" sx={{ mt: 2 }}>{skipped.length} spreads have stats left alone</Typography>
                        <PreviewList items={skipped} label="Spreads left alone" />
                    </>}
                {lockedCount > 0 && <Alert severity="warning" sx={{ mt: 2 }}>{lockedCount} matching spreads cannot be changed safely and are left alone.</Alert>}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" onClick={onApply} disabled={changes.length === 0}>Apply</Button>
            </DialogActions>
        </Dialog>
    );
};

/**
 * Asks whether to save or discard unsaved changes before continuing.
 *
 * @component
 * @param {Object} props - The component props
 * @param {boolean} props.open - Whether the dialog is open.
 * @param {number} props.count - How many spreads have unsaved changes.
 * @param {boolean} props.saving - Whether a save is in progress.
 * @param {boolean} props.canSave - Whether the changes can be saved.
 * @param {object|null} props.error - The last save error.
 * @param {Function} props.onSave - Saves, then continues.
 * @param {Function} props.onDiscard - Discards the changes, then continues.
 * @param {Function} props.onCancel - Stays with the changes.
 * @returns {JSX.Element} The dialog.
 */
export const UnsavedChangesDialog = ({ open, count, saving, canSave, error, onSave, onDiscard, onCancel }) =>
{
    return (
        <Dialog open={open} onClose={() => !saving && onCancel()} aria-labelledby="unsaved-changes-title">
            <DialogTitle id="unsaved-changes-title">Unsaved Changes</DialogTitle>
            <DialogContent>
                <DialogContentText>
                    {count === 1 ? "1 spread has" : `${count} spreads have`} unsaved changes. Save them before continuing?
                </DialogContentText>
                {!canSave && <Alert severity="error" sx={{ mt: 2 }}>Some changes have problems that must be fixed before they can be saved.</Alert>}
                {error != null && <Alert severity="error" sx={{ mt: 2 }}>{error.message}</Alert>}
            </DialogContent>
            <DialogActions>
                <Button onClick={onCancel} disabled={saving}>Cancel</Button>
                <Button color="error" onClick={onDiscard} disabled={saving}>Discard</Button>
                <Button variant="contained" onClick={onSave} disabled={saving || !canSave}>{saving ? "Saving..." : "Save"}</Button>
            </DialogActions>
        </Dialog>
    );
};
