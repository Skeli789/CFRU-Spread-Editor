/**
 * This file defines the DefaultPage component.
 * It is the spread editor page, which requires repositories and a game to be loaded first.
 */

import React from 'react';
import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';

import RepositorySetup, { DiagnosticList } from './components/RepositorySetup';
import { EDITOR_PHASE, REPOSITORY_KINDS, useSpreadEditor } from './SpreadEditorState';

import "./styles/DefaultPage.css";

const STORAGE_WARNING = "This browser blocked saving settings, so the repository folders will need to be entered again next time.";

/**
 * Represents the DefaultPage component.
 * @component
 * @returns {JSX.Element} The rendered DefaultPage component.
 */
const DefaultPage = () =>
{
    const { state, changeGame, changeRepositories } = useSpreadEditor();
    const { workspace, catalog } = state;
    const ready = state.phase === EDITOR_PHASE.READY;

    return (
        <div className="default-page" id="default-page" data-testid="default-page">
            <RepositorySetup />
            {state.storageUnavailable && <Alert severity="warning" className="editor-alert">{STORAGE_WARNING}</Alert>}
            {state.phase === EDITOR_PHASE.STARTING &&
                <Stack direction="row" spacing={1} className="editor-status">
                    <CircularProgress size={20} />
                    <Typography>Checking saved repositories...</Typography>
                </Stack>}
            {ready &&
                <Stack spacing={2}>
                    <Box className="editor-toolbar">
                        <Typography variant="h6" component="h1">{catalog.name}</Typography>
                        <Stack direction="row" spacing={1}>
                            <Button variant="outlined" size="small" onClick={changeGame}>Change Game</Button>
                            <Button variant="outlined" size="small" onClick={changeRepositories}>Change Repositories</Button>
                        </Stack>
                    </Box>
                    <Box component="dl" className="editor-summary">
                        {REPOSITORY_KINDS.map((kind) => (
                            <React.Fragment key={kind}>
                                <dt>{workspace.repositories[kind].label}</dt>
                                <dd>{workspace.repositories[kind].path}</dd>
                            </React.Fragment>
                        ))}
                        <dt>Species</dt>
                        <dd>{catalog.entryCounts.baseStats}</dd>
                        <dt>Moves</dt>
                        <dd>{catalog.entryCounts.moves}</dd>
                        {workspace.spreads && <>
                            <dt>Spread Sets</dt>
                            <dd>{workspace.spreads.sets.length}</dd>
                            <dt>Spreads</dt>
                            <dd>{workspace.spreads.entries.length}</dd>
                        </>}
                    </Box>
                    <DiagnosticList diagnostics={workspace.diagnostics} />
                </Stack>}
        </div>
    );
}

export default DefaultPage;
