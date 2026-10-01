/**
 * This file defines the Header component.
 * It is used to display a header at the top of the page.
 */

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Accordion, AccordionDetails, AccordionSummary, Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Menu, MenuItem, Stack, Typography } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import MenuIcon from "@mui/icons-material/Menu";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";

import DarkModeButton from "../subcomponents/DarkModeButton";
import OperationProgress from "../subcomponents/OperationProgress";
import { EDITOR_PHASE, useSpreadEditor } from "../SpreadEditorState";
import { UnsavedChangesDialog } from "./SpreadDialogs";

import "../styles/HeaderFooter.css";

const UNKNOWN_SOURCE = "Game catalog";


/**
 * Groups load diagnostics by source file and category, retaining each individual detail.
 *
 * @param {Array<object>} diagnostics The load diagnostics.
 * @returns {Array<{title: string, lines: Array<string>}>} The warning sections.
 */
function groupDiagnostics(diagnostics)
{
    const groups = new Map();
    for (const diagnostic of diagnostics)
    {
        const hasDetails = Array.isArray(diagnostic.details) && diagnostic.details.length > 0;
        // Warnings without details name their own file, so they share one section per category
        const source = [diagnostic.repository, hasDetails ? diagnostic.file : null].filter(Boolean).join(" / ") || UNKNOWN_SOURCE;
        const category = diagnostic.code?.replaceAll("_", " ") ?? "Warning";
        const title = `${source} / ${category}`;
        if (!groups.has(title))
            groups.set(title, { title, lines: [] });
        groups.get(title).lines.push(...(hasDetails ? diagnostic.details : [diagnostic.message]));
    }
    return [...groups.values()];
}

/**
 * Represents the Header component.
 * @component
 * @param {Object} props - The component props
 * @param {boolean} props.darkMode - Indicates if dark mode is enabled
 * @param {Function} props.toggleParentDarkMode - Function to toggle dark mode in the parent component.
 * @returns {JSX.Element} The rendered Header component.
 */
const Header = ({ darkMode, toggleParentDarkMode }) =>
{
    const navigate = useNavigate();
    const editor = useSpreadEditor();
    const { state, dirtyCount, saveProblems, saveChanges, discardChanges } = editor;
    const [menuAnchor, setMenuAnchor] = useState(null);
    const [showWarnings, setShowWarnings] = useState(false);
    const [showDownload, setShowDownload] = useState(false);
    const [pendingAction, setPendingAction] = useState(null);
    const ready = state.phase === EDITOR_PHASE.READY;
    const diagnostics = ready ? [...(state.workspace?.diagnostics ?? []), ...(state.catalog?.diagnostics ?? [])] : [];
    const warningGroups = groupDiagnostics(diagnostics);
    const busy = state.saving || state.downloading || !ready;
    const { downloadArchive } = editor;

    /**
     * Starts exporting after the unsaved-change decision has committed to editor state.
     */
    useEffect(() =>
    {
        if (showDownload)
            downloadArchive();
    }, [showDownload, downloadArchive]);

    /**
     * Runs a menu action after asking about unsaved changes.
     *
     * @param {Function} action The action to run.
     */
    const chooseAction = (action) =>
    {
        setMenuAnchor(null);
        if (dirtyCount > 0)
            setPendingAction(() => action);
        else
            action();
    };

    const handleLogoClick = () =>
    {
        navigate('/');
    };

    return (
        <div className="header">
            <div className="logo-container" onClick={handleLogoClick} style={{ cursor: 'pointer' }}>
                <h2 className="logo-text">CFRU Spread Editor</h2>
            </div>
            <div className="buttons">
                {ready && <>
                    <Button className="header-game-button" color="inherit" startIcon={<MenuIcon />} onClick={(event) => setMenuAnchor(event.currentTarget)}
                            aria-label={`${state.catalog.name} menu`} aria-haspopup="menu" aria-expanded={menuAnchor != null}>
                        <span className="header-game-name">{state.catalog.name}</span>
                        {diagnostics.length > 0 && <WarningAmberIcon fontSize="small" role="img" aria-label={`${diagnostics.length} load warnings`} />}
                    </Button>
                    <Menu anchorEl={menuAnchor} open={menuAnchor != null} onClose={() => setMenuAnchor(null)}>
                        <MenuItem disabled={busy} onClick={() => chooseAction(editor.changeGame)}>Change Game</MenuItem>
                        <MenuItem disabled={busy} onClick={() => chooseAction(editor.changeRepositories)}>Change Repositories</MenuItem>
                        <MenuItem disabled={busy} onClick={() => chooseAction(() => setShowDownload(true))}>Download Required Files</MenuItem>
                        {diagnostics.length > 0 && <MenuItem onClick={() => { setMenuAnchor(null); setShowWarnings(true); }}>View Load Warnings</MenuItem>}
                    </Menu>
                    <Dialog open={showWarnings} onClose={() => setShowWarnings(false)} aria-labelledby="load-warnings-title" fullWidth maxWidth="sm" scroll="paper">
                        <DialogTitle id="load-warnings-title">Load Warnings</DialogTitle>
                        <DialogContent dividers>
                            {warningGroups.map((group) =>
                                <Accordion key={group.title} disableGutters>
                                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                        <Typography>{group.title} ({group.lines.length})</Typography>
                                    </AccordionSummary>
                                    <AccordionDetails>
                                        <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2 }}>
                                            {group.lines.map((line, index) => <li key={index}>{line}</li>)}
                                        </Stack>
                                    </AccordionDetails>
                                </Accordion>)}
                        </DialogContent>
                        <DialogActions><Button onClick={() => setShowWarnings(false)}>Close</Button></DialogActions>
                    </Dialog>
                    <Dialog open={showDownload} onClose={() => !state.downloading && setShowDownload(false)}
                            aria-labelledby="archive-download-title" fullWidth maxWidth="sm">
                        <DialogTitle id="archive-download-title">Download Required Files</DialogTitle>
                        <DialogContent>
                            <Stack spacing={2}>
                                <Typography variant="body2">
                                    The ZIP contains saved source files, not unsaved drafts. Uploaded archives are edited in a local cached copy.
                                    Saves only update that cache; re-download the ZIP to transfer your saved changes elsewhere.
                                </Typography>
                                <OperationProgress progress={state.archiveProgress} />
                                {state.archiveError && <Alert severity="error">{state.archiveError.message}</Alert>}
                            </Stack>
                        </DialogContent>
                        <DialogActions>
                            <Button disabled={state.downloading} onClick={() => setShowDownload(false)}>Close</Button>
                            {state.archiveError && <Button disabled={state.downloading || state.saving} onClick={downloadArchive}>Retry</Button>}
                        </DialogActions>
                    </Dialog>
                    <UnsavedChangesDialog open={pendingAction != null} count={dirtyCount} saving={state.saving} canSave={saveProblems.length === 0}
                                          error={state.saveError} onCancel={() => setPendingAction(null)}
                                          onDiscard={() => { discardChanges(); pendingAction(); setPendingAction(null); }}
                                          onSave={async () => { if (await saveChanges()) { pendingAction(); setPendingAction(null); } }} />
                </>}
                <DarkModeButton darkMode={darkMode}
                                toggleParentDarkMode={toggleParentDarkMode} />
            </div>
        </div>
    );
}

export default Header;
