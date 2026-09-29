/**
 * This file defines the DefaultPage component.
 * It is the spread editor page, which requires repositories and a game to be loaded first.
 */

import React, { useMemo, useRef, useState } from 'react';
import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Fab, Stack, Typography } from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import UndoIcon from '@mui/icons-material/Undo';
import { toast } from 'react-toastify';

import { planIvAutoFix } from '../shared/pokemon-mechanics.mjs';
import { DEFAULT_FILTERS, DEFAULT_PAGE_SIZE, createFilterContext, getDefaultFilters, matchesFilters } from '../shared/spread-layout.mjs';
import RepositorySetup from './components/RepositorySetup';
import SpreadCard from './components/SpreadCard';
import { AutoFixDialog, EditSpreadDialog } from './components/SpreadDialogs';
import SpreadFilters, { getSetDisplayName } from './components/SpreadFilters';
import SpreadGrid from './components/SpreadGrid';
import { EDITOR_PHASE, useSpreadEditor } from './SpreadEditorState';
import { STAT_SHORT_LABELS, getLabel } from './subcomponents/CatalogDisplay';

import "./styles/DefaultPage.css";

const STORAGE_WARNING = "This browser blocked saving settings, so the repository folders will need to be entered again next time.";
const NO_SPREADS_MESSAGE = "The repositories did not provide any spreads.";
const MAX_LISTED_PROBLEMS = 10;
const IV_FIELD_STATS = { atkIv: "atk", spAtkIv: "spAtk", spdIv: "spd" };
const NO_PROBLEMS = [];
const SAVE_BLUE = "#1976d2";
const SAVE_BLUE_HOVER = "#1565c0";
const SAVE_BUTTON_STYLE = { bgcolor: SAVE_BLUE, color: "#fff", "&:hover": { bgcolor: SAVE_BLUE_HOVER } };


/**
 * Describes where a spread comes from.
 *
 * @param {object} catalog The game catalog.
 * @param {object} entry The spread entry.
 * @param {object} set The spread's set.
 * @returns {string} The description.
 */
function describeSpread(catalog, entry, set)
{
    return `${getLabel(catalog.species, entry.fields.species)} (${set?.name}, line ${entry.line})`;
}

/**
 * The editor shown once a game is loaded.
 *
 * @component
 * @returns {JSX.Element} The editor.
 */
const SpreadEditorView = () =>
{
    const editor = useSpreadEditor();
    const { state, dirtyCount, saveProblems, saveChanges } = editor;
    const { workspace, catalog, spreadIndex, drafts, editing, preview } = state;
    const spreads = workspace.spreads;
    const defaultFilters = useMemo(() => getDefaultFilters(spreads), [spreads]);
    const [filters, setFilters] = useState(defaultFilters);
    const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
    const [autoFix, setAutoFix] = useState(null);
    const [showProblems, setShowProblems] = useState(false);
    const [confirmRevert, setConfirmRevert] = useState(false);
    const editingId = editing.values().next().value;

    // Results change when the filters do, not while a spread is being edited, so a card never vanishes mid-edit
    const draftsRef = useRef(drafts);
    draftsRef.current = drafts;
    const filterContext = useMemo(() => createFilterContext(spreads), [spreads]);
    const results = useMemo(() =>
    {
        const current = draftsRef.current;
        const context = { ...filterContext, catalog, teamTypes: spreads.teamTypes, isChanged: (id) => Object.hasOwn(current, id) };
        return spreads.entries.filter((entry) => matchesFilters(entry, current[entry.id] ?? entry.fields, filters, context))
            .map((entry) => ({ id: entry.id, species: (current[entry.id] ?? entry.fields).species, setId: entry.setId }));
    }, [spreads, catalog, filters, filterContext]);

    // Section headings leave out the trainer when only that trainer's sets are shown
    const trainerName = spreads.trainers.find((trainer) => trainer.id === filters.trainerId)?.name;

    /**
     * Returns the heading of a set's section.
     *
     * @param {string} setId The set ID.
     * @returns {{title: string, file: string}} The set's readable name and file.
     */
    const getSetHeading = (setId) =>
    {
        const set = spreadIndex.sets.get(setId);
        return { title: getSetDisplayName(set, trainerName), file: set.file };
    };

    const problemsById = useMemo(() =>
    {
        const byId = new Map();
        for (const problem of saveProblems)
            byId.set(problem.id, [...(byId.get(problem.id) ?? []), problem]);
        return byId;
    }, [saveProblems]);

    /**
     * Saves every change, reporting the result.
     *
     * @returns {Promise<boolean>} Whether the save succeeded.
     */
    const save = async () =>
    {
        const count = dirtyCount;
        const saved = await saveChanges();
        if (saved)
            toast.success(`Saved ${count === 1 ? "1 spread" : `${count} spreads`}.`);
        return saved;
    };

    /**
     * Works out the auto-fix for every matching spread and opens its preview.
     */
    const openAutoFix = () =>
    {
        const editable = results.map(({ id }) => spreadIndex.entries.get(id)).filter((entry) => entry.editable);
        const plan = planIvAutoFix(catalog, editable.map((entry) => ({ id: entry.id, fields: drafts[entry.id] ?? entry.fields })));
        const label = (id) => describeSpread(catalog, spreadIndex.entries.get(id), spreadIndex.sets.get(spreadIndex.entries.get(id).setId));
        const current = (id) => drafts[id] ?? spreadIndex.entries.get(id).fields;

        setAutoFix(
        {
            plan,
            lockedCount: results.length - editable.length,
            changes: plan.changes.map(({ id, fields, hiddenPowerIvs }) => (
            {
                id,
                label: label(id),
                text: Object.entries(fields).map(([field, value]) =>
                    `${STAT_SHORT_LABELS[IV_FIELD_STATS[field]]} ${current(id)[field]} to ${value}${hiddenPowerIvs.includes(field) ? ` (kept ${value % 2 === 1 ? "odd" : "even"} for Hidden Power)` : ""}`).join(", "),
            })),
            skipped: plan.skipped.map(({ id, stats }) => (
            {
                id,
                label: label(id),
                text: `A move's details are unknown, so ${stats.map((stat) => STAT_SHORT_LABELS[stat]).join(" and ")} stays as it is.`,
            })),
        });
    };

    /**
     * Renders one spread's card.
     *
     * @param {string} id The spread ID.
     * @returns {JSX.Element} The card.
     */
    const renderCard = (id) =>
    {
        const entry = spreadIndex.entries.get(id);
        return (
            <SpreadCard
                entry={entry}
                fields={drafts[id] ?? entry.fields}
                set={spreadIndex.sets.get(entry.setId)}
                catalog={catalog}
                teamTypes={spreads.teamTypes}
                preview={preview}
                editing={false}
                changed={Object.hasOwn(drafts, id) || state.deleted.has(id)}
                deleted={state.deleted.has(id)}
                problems={problemsById.get(id) ?? NO_PROBLEMS}
                actions={editor.cardActions}
            />
        );
    };

    return (
        <>
            <SpreadFilters
                spreads={spreads}
                catalog={catalog}
                filters={filters}
                onFiltersChange={setFilters}
                resultCount={results.length}
                preview={preview}
                onPreviewChange={editor.setPreview}
                onAutoFix={openAutoFix}
            />
            <SpreadGrid
                spreads={results}
                renderCard={renderCard}
                getSetHeading={getSetHeading}
                pageSize={pageSize}
                onPageSizeChange={setPageSize}
                resetKey={JSON.stringify(filters)}
                onClearFilters={() => setFilters(DEFAULT_FILTERS)}
            />
            {editingId != null &&
                <EditSpreadDialog name={getLabel(catalog.species, (drafts[editingId] ?? spreadIndex.entries.get(editingId).fields).species)}
                                  onClose={() => editor.setEditing(editingId, false)}>
                    <SpreadCard
                        entry={spreadIndex.entries.get(editingId)}
                        fields={drafts[editingId] ?? spreadIndex.entries.get(editingId).fields}
                        set={spreadIndex.sets.get(spreadIndex.entries.get(editingId).setId)}
                        catalog={catalog}
                        teamTypes={spreads.teamTypes}
                        preview={preview}
                        editing
                        changed={Object.hasOwn(drafts, editingId) || state.deleted.has(editingId)}
                        problems={problemsById.get(editingId) ?? NO_PROBLEMS}
                        actions={editor.cardActions}
                    />
                </EditSpreadDialog>}
            {(dirtyCount > 0 || state.saveError != null) &&
                <div className="save-area">
                    {state.saveError != null &&
                        <Alert severity="error" onClose={editor.clearSaveError} className="save-message">{state.saveError.message}</Alert>}
                    {showProblems && saveProblems.length > 0 &&
                        <Alert severity="error" onClose={() => setShowProblems(false)} className="save-message">
                            <Typography variant="body2">Fix these problems before saving:</Typography>
                            <ul className="save-problems">
                                {saveProblems.slice(0, MAX_LISTED_PROBLEMS).map((problem, index) => (
                                    <li key={index}>{describeSpread(catalog, spreadIndex.entries.get(problem.id), spreadIndex.sets.get(spreadIndex.entries.get(problem.id).setId))}: {problem.message}</li>
                                ))}
                            </ul>
                            <Button size="small" onClick={() => setFilters({ ...DEFAULT_FILTERS, unsaved: true })}>Show Unsaved Spreads</Button>
                        </Alert>}
                    {dirtyCount > 0 &&
                        <div className="save-buttons">
                            <Fab variant="extended" color="error" disabled={state.saving} onClick={() => setConfirmRevert(true)}>
                                <UndoIcon sx={{ mr: 1 }} />
                                Revert All
                            </Fab>
                            <Fab variant="extended" disabled={state.saving} sx={SAVE_BUTTON_STYLE}
                                 onClick={() => (saveProblems.length > 0 ? setShowProblems(true) : save())}>
                                {state.saving ? <CircularProgress size={20} color="inherit" sx={{ mr: 1 }} /> : <SaveIcon sx={{ mr: 1 }} />}
                                Save Changes ({dirtyCount})
                            </Fab>
                        </div>}
                </div>}
            <Dialog open={confirmRevert} onClose={() => setConfirmRevert(false)} aria-labelledby="revert-all-title" className="revert-all-dialog">
                <DialogTitle id="revert-all-title">Revert All Changes?</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        {dirtyCount === 1 ? "The unsaved change to 1 spread will be lost." : `The unsaved changes to ${dirtyCount} spreads will be lost.`}
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmRevert(false)}>Cancel</Button>
                    <Button color="error" onClick={() =>
                    {
                        editor.discardChanges();
                        setConfirmRevert(false);
                    }}>Revert All</Button>
                </DialogActions>
            </Dialog>
            {autoFix != null &&
                <AutoFixDialog
                    open
                    changes={autoFix.changes}
                    skipped={autoFix.skipped}
                    lockedCount={autoFix.lockedCount}
                    onClose={() => setAutoFix(null)}
                    onApply={() =>
                    {
                        editor.applyChanges(autoFix.plan.changes);
                        setAutoFix(null);
                    }}
                />}
        </>
    );
};

/**
 * Represents the DefaultPage component.
 * @component
 * @returns {JSX.Element} The rendered DefaultPage component.
 */
const DefaultPage = () =>
{
    const { state } = useSpreadEditor();
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
            {ready && state.workspace.spreads != null && <SpreadEditorView />}
            {ready && state.workspace.spreads == null &&
                <Stack spacing={2}>
                    <Alert severity="warning">{NO_SPREADS_MESSAGE}</Alert>
                </Stack>}
        </div>
    );
}

export default DefaultPage;
