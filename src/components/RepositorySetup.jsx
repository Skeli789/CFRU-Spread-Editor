/**
 * This file defines the RepositorySetup component.
 * It asks for the three repository folders and the game to edit before the editor opens.
 */

import React, { useRef } from "react";
import
{
    Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton,
    InputAdornment, LinearProgress, List, ListItemButton, ListItemText, Stack, TextField, Tooltip, Typography,
} from "@mui/material";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import HelpOutlineIcon from "@mui/icons-material/HelpOutlineOutlined";

import { EDITOR_PHASE, REPOSITORY_KINDS, REPOSITORY_LABELS, hasAllPaths, useSpreadEditor } from "../SpreadEditorState";
import OperationProgress from "../subcomponents/OperationProgress";

const REPOSITORY_HINTS =
{
    cfru: "The folder containing src/Tables/battle_tower_spreads.h. Spread files here are saved when you choose Save.",
    dpe: "The folder containing src/Learnsets.c. It is only read.",
    cloud: "The folder containing src/PokemonUtil.jsx. It is only read.",
};

const SETUP_TITLE_ID = "repository-setup-title";
const GAME_TITLE_ID = "game-select-title";
const SEVERITY_WARNING = "warning";
const PICKER_PROGRESS_SIZE = 20;
const ARCHIVE_INPUT_ID = "repository-archive-upload";
const ZIP_UPLOAD_HELP = "Use the archive from Download Required Files. Uploaded roots are validated and kept in a persistent local cache. Save writes the cached CFRU copy, not the original ZIP or checkout. Re-download Required Files to transfer saved changes. The local server is still required. Maximum ZIP size: 128 MiB.";


/**
 * Returns the warnings from a workspace load.
 *
 * @param {object|null} workspace The workspace snapshot.
 * @returns {Array<object>} Warning diagnostics.
 */
function getWarnings(workspace)
{
    return (workspace?.diagnostics ?? []).filter((diagnostic) => diagnostic.severity === SEVERITY_WARNING);
}

/**
 * Shows load diagnostics as a compact warning list.
 *
 * @component
 * @param {Object} props - The component props
 * @param {Array<object>} props.diagnostics - The diagnostics to show.
 * @returns {JSX.Element|null} The rendered warnings.
 */
export const DiagnosticList = ({ diagnostics }) =>
{
    if (diagnostics.length === 0)
        return null;

    return (
        <Alert severity="warning">
            <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2 }}>
                {diagnostics.flatMap((diagnostic) =>
                    Array.isArray(diagnostic.details) && diagnostic.details.length > 0 ? diagnostic.details : [diagnostic.message])
                    .map((detail, index) => <li key={index}>{detail}</li>)}
            </Stack>
        </Alert>
    );
};

/**
 * The dialog for entering repository folders.
 *
 * @component
 * @returns {JSX.Element} The rendered dialog.
 */
const RepositoryDialog = () =>
{
    const { state, setPath, browse, loadRepositories, importArchive, cancelChange } = useSpreadEditor();
    const archiveInputRef = useRef(null);
    const loading = state.phase === EDITOR_PHASE.LOADING;
    const busy = loading || state.pickingKind != null || state.saving || state.downloading;
    const canCancel = state.catalog != null && !busy;
    const open = state.phase === EDITOR_PHASE.SETUP || loading;

    /**
     * Starts loading the entered repositories.
     *
     * @param {React.FormEvent} event The submit event.
     */
    const handleSubmit = (event) =>
    {
        event.preventDefault();
        if (!busy && hasAllPaths(state.paths))
            loadRepositories();
    };

    /**
     * Uploads the selected ZIP and clears the input so the same file can be retried.
     *
     * @param {React.ChangeEvent<HTMLInputElement>} event The file selection.
     */
    const handleUpload = (event) =>
    {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file && !busy)
            importArchive(file);
    };

    return (
        <Dialog open={open} fullWidth maxWidth="sm" aria-labelledby={SETUP_TITLE_ID}
                onClose={() => canCancel && cancelChange()}>
            <form onSubmit={handleSubmit} noValidate>
                <DialogTitle id={SETUP_TITLE_ID}>Connect Repositories</DialogTitle>
                <DialogContent>
                    <Stack spacing={2}>
                        <Typography variant="body2" color="text.secondary">
                            Choose the local folder for each repository. The editor checks the folders every time it opens.
                        </Typography>
                        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                            <Typography variant="body2" color="text.secondary">
                                Or upload a required-files ZIP without entering folder paths.
                            </Typography>
                            <Tooltip title={ZIP_UPLOAD_HELP}>
                                <IconButton size="small" aria-label="About ZIP Uploads">
                                    <HelpOutlineIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        </Stack>
                        <input ref={archiveInputRef} id={ARCHIVE_INPUT_ID} type="file" accept=".zip,application/zip"
                               aria-label="Upload ZIP" hidden disabled={busy} onChange={handleUpload} />
                        <Button variant="outlined" disabled={busy} onClick={() => archiveInputRef.current?.click()}>Upload ZIP</Button>
                        {REPOSITORY_KINDS.map((kind) =>
                        {
                            const label = REPOSITORY_LABELS[kind];
                            const fieldError = state.fieldErrors[kind];

                            return (
                                <TextField
                                    key={kind}
                                    id={`repository-path-${kind}`}
                                    label={label}
                                    value={state.paths[kind]}
                                    onChange={(event) => setPath(kind, event.target.value)}
                                    error={fieldError != null}
                                    helperText={fieldError?.message ?? REPOSITORY_HINTS[kind]}
                                    disabled={busy}
                                    size="small"
                                    fullWidth
                                    required
                                    slotProps={{
                                        input:
                                        {
                                            endAdornment:
                                                <InputAdornment position="end">
                                                    <Tooltip title="Browse">
                                                        <span>
                                                            <IconButton edge="end" aria-label={`Browse for ${label}`} disabled={busy}
                                                                        onClick={() => browse(kind, state.paths[kind])}>
                                                                {state.pickingKind === kind
                                                                    ? <CircularProgress size={PICKER_PROGRESS_SIZE} aria-label="Waiting for folder selection" />
                                                                    : <FolderOpenIcon />}
                                                            </IconButton>
                                                        </span>
                                                    </Tooltip>
                                                </InputAdornment>,
                                        },
                                    }}
                                />
                            );
                        })}
                        {state.error != null && <Alert severity="error">{state.error.message}</Alert>}
                        <DiagnosticList diagnostics={state.error?.details?.diagnostics ?? []} />
                        {loading && <OperationProgress progress={state.setupProgress} />}
                    </Stack>
                </DialogContent>
                <DialogActions>
                    {canCancel && <Button onClick={cancelChange}>Cancel</Button>}
                    <Button type="submit" variant="contained" disabled={busy || !hasAllPaths(state.paths)}>
                        Load
                    </Button>
                </DialogActions>
            </form>
        </Dialog>
    );
};

/**
 * The dialog for choosing which Unbound Cloud game's data to use.
 *
 * @component
 * @returns {JSX.Element} The rendered dialog.
 */
const GameDialog = () =>
{
    const { state, selectGame, changeRepositories, cancelChange } = useSpreadEditor();
    const loading = state.phase === EDITOR_PHASE.LOADING_CATALOG;
    const canCancel = state.catalog != null && !loading;
    const open = state.phase === EDITOR_PHASE.SELECT_GAME || loading;

    return (
        <Dialog open={open} fullWidth maxWidth="xs" aria-labelledby={GAME_TITLE_ID}
                onClose={() => canCancel && cancelChange()}>
            <DialogTitle id={GAME_TITLE_ID}>Choose Game</DialogTitle>
            <DialogContent>
                <Stack spacing={2}>
                    <Typography variant="body2" color="text.secondary">
                        The game supplies species stats, abilities, names and available items.
                    </Typography>
                    {state.notice != null && <Alert severity="info">{state.notice}</Alert>}
                    <List dense disablePadding aria-label="Games">
                        {(state.workspace?.games ?? []).map((game) => (
                            <ListItemButton key={game.id} selected={game.id === state.gameId} disabled={loading}
                                            onClick={() => selectGame(game.id)}>
                                <ListItemText primary={game.name} />
                            </ListItemButton>
                        ))}
                    </List>
                    {state.error != null && <Alert severity="error">{state.error.message}</Alert>}
                    <DiagnosticList diagnostics={getWarnings(state.workspace)} />
                    {loading &&
                        <Stack spacing={1}>
                            <Typography variant="body2">Loading game data...</Typography>
                            <LinearProgress />
                        </Stack>}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={changeRepositories} disabled={loading}>Change Repositories</Button>
                {canCancel && <Button onClick={cancelChange}>Cancel</Button>}
            </DialogActions>
        </Dialog>
    );
};

/**
 * Represents the RepositorySetup component.
 *
 * @component
 * @returns {JSX.Element} The rendered setup dialogs.
 */
const RepositorySetup = () =>
{
    return (
        <>
            <RepositoryDialog />
            <GameDialog />
        </>
    );
};

export default RepositorySetup;
