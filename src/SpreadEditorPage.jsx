/**
 * This file defines the SpreadEditorPage component.
 * It is the spread editor page, which requires repositories and a game to be loaded first.
 */

import React, { useMemo, useRef, useState } from 'react';
import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Fab, Stack, Tooltip, Typography } from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import UndoIcon from '@mui/icons-material/Undo';
import { toast } from 'react-toastify';

import { EV_FIELDS, IV_FIELDS, getSpreadLevel } from '../shared/pokemon-mechanics.mjs';
import { DEFAULT_FILTERS, DEFAULT_PAGE_SIZE, createFilterContext, getDefaultFilters, matchesFilters } from '../shared/spread-layout.mjs';
import { AUTO_FIX_CATEGORY, BATTLE_TYPES, MOVE_REMOVAL, compactMoves, createNewSpreadFields, getBattleType, planSpreadAutoFix, setMove } from '../shared/spread-model.mjs';
import RepositorySetup from './components/RepositorySetup';
import SpreadCard from './components/SpreadCard';
import { AddSpreadDialog, AutoFixDialog, DiscardNewSpreadDialog, EditSpreadDialog, ExportSpreadsDialog } from './components/SpreadDialogs';
import SpreadFilters, { getSetDisplayName } from './components/SpreadFilters';
import SpreadGrid from './components/SpreadGrid';
import { EDITOR_PHASE, findSaveProblems, useSpreadEditor } from './SpreadEditorState';
import { STAT_SHORT_LABELS, getLabel, getSpeciesFormName } from './subcomponents/CatalogDisplay';
import { getLearnableMoveOptions } from './subcomponents/MovePicker';

import "./styles/SpreadEditorPage.css";

const STORAGE_WARNING = "This browser blocked saving settings, so the repository folders will need to be entered again next time.";
const NO_SPREADS_MESSAGE = "The repositories did not provide any spreads.";
const MAX_LISTED_PROBLEMS = 10;
const IV_FIELD_STATS = { atkIv: "atk", spAtkIv: "spAtk", spdIv: "spd" };
const NO_PROBLEMS = [];
const SAVE_BLUE = "#1976d2";
const SAVE_BLUE_HOVER = "#1565c0";
const SAVE_BUTTON_STYLE = { bgcolor: SAVE_BLUE, color: "#fff", "&:hover": { bgcolor: SAVE_BLUE_HOVER } };
const PENDING_ID = "pending-spread";
const LOCKED_REASON = "This spread's source cannot be changed safely.";
const AUTO_FIX_LABELS = { [AUTO_FIX_CATEGORY.MOVES]: "moves", [AUTO_FIX_CATEGORY.IVS]: "IVs", [AUTO_FIX_CATEGORY.EVS]: "EVs" };
const REMOVAL_REASONS =
{
    [MOVE_REMOVAL.ILLEGAL]: "unlearnable",
    [MOVE_REMOVAL.UNDEFINED]: "undefined",
    [MOVE_REMOVAL.DUPLICATE]: "repeated",
};


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
    const { state, dirtyCount, movedIds, movedGroups, movedSpreadIds, transferredIds, saveProblems, saveChanges } = editor;
    const { workspace, catalog, spreadIndex, drafts, newEntries, orders, editing, preview } = state;
    const spreads = workspace.spreads;
    const defaultFilters = useMemo(() => getDefaultFilters(spreads), [spreads]);
    const [filters, setFilters] = useState(defaultFilters);
    const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
    const [autoFix, setAutoFix] = useState(null);
    const [showProblems, setShowProblems] = useState(false);
    const [confirmRevert, setConfirmRevert] = useState(false);
    const [addOpen, setAddOpen] = useState(false);
    const [exportEntries, setExportEntries] = useState(null);
    const [reveal, setReveal] = useState(null);
    const [pending, setPending] = useState(null);
    const [confirmDiscard, setConfirmDiscard] = useState(false);
    const editingId = editing.values().next().value;

    // A spread chosen in Add Spread is only edited here until its own Add button puts it in the set
    const pendingEntry = useMemo(() => pending && { id: PENDING_ID, setId: pending.setId, fields: pending.fields,
        line: spreadIndex.sets.get(pending.setId).line, editable: true, isNew: true, diagnostics: [] }, [pending, spreadIndex]);
    const pendingProblems = useMemo(() => pendingEntry
        ? findSaveProblems({ [PENDING_ID]: pendingEntry.fields }, new Map([[PENDING_ID, pendingEntry]]), catalog) : NO_PROBLEMS, [pendingEntry, catalog]);
    const pendingActions = useMemo(() =>
    ({
        updateSpread: (id, change) => setPending((current) =>
        {
            // Like saved spreads, leaving Both remembers its Modify Moves Doubles value for coming back
            const fields = change(current.fields, current.fields, current.memory);
            const leftBoth = getBattleType(current.fields) === BATTLE_TYPES.BOTH && getBattleType(fields) !== BATTLE_TYPES.BOTH;
            return { ...current, fields, memory: leftBoth ? current.fields.modifyMovesDoubles : current.memory };
        }),
        setEditing: () => {},
        deleteSpread: () => setPending(null),
        restoreSpread: () => {},
        loadSmogonSets: editor.loadSmogonSets,
    }), [editor.loadSmogonSets]);

    // Results change when the filters do, not while a spread is being edited, so a card never vanishes mid-edit
    const draftsRef = useRef(drafts);
    draftsRef.current = drafts;
    const filterContext = useMemo(() => createFilterContext(spreads), [spreads]);
    const { results, availableSpreads } = useMemo(() =>
    {
        const current = draftsRef.current;
        const context = { ...filterContext, catalog, teamTypes: spreads.teamTypes, isChanged: (id) => Object.hasOwn(current, id) || movedIds.has(id) };
        // A spread moved to another set is only shown there
        const visible = [...spreads.entries, ...Object.values(newEntries)].filter((entry) => !transferredIds.has(entry.id))
            .map((entry) => ({ id: entry.id, species: (current[entry.id] ?? entry.fields).species, setId: entry.setId }));
        const positions = new Map(Object.entries(orders).flatMap(([setId, order]) => order.map((id, index) => [id, { setId, index }])));
        visible.sort((first, second) =>
        {
            if (first.setId !== second.setId)
                return spreads.sets.findIndex((set) => set.id === first.setId) - spreads.sets.findIndex((set) => set.id === second.setId);
            const order = orders[first.setId] ?? spreadIndex.sets.get(first.setId).entryIds;
            return (positions.get(first.id)?.index ?? order.indexOf(first.id)) - (positions.get(second.id)?.index ?? order.indexOf(second.id));
        });
        return { availableSpreads: visible, results: visible.filter(({ id }) =>
        {
            const entry = spreadIndex.entries.get(id);
            return matchesFilters(entry, current[id] ?? entry.fields, filters, context);
        }) };
    }, [spreads, catalog, filters, filterContext, newEntries, orders, spreadIndex, movedIds, transferredIds]);

    const activeSet = results.length > 0 && results.every((item) => item.setId === results[0].setId)
        ? spreadIndex.sets.get(results[0].setId) : null;

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

    /**
     * Adds the new spread being edited to its set, with its moves shifted up over any blank slot.
     */
    const addPending = () =>
    {
        const [id] = editor.addSpreads(pending.setId, [compactMoves(pending.fields)]);
        setPending(null);
        setReveal({ id, key: Date.now() });
    };

    /**
     * Returns whether a spread has changes Revert can undo. A new spread is deleted instead, unless it was moved
     * from another set, where Revert puts it back.
     *
     * @param {string} id The spread.
     * @returns {boolean} Whether it can be reverted.
     */
    const canRevert = (id) =>
    {
        const entry = spreadIndex.entries.get(id);
        if (entry.isNew)
            return entry.movedFrom != null;
        return Object.hasOwn(drafts, id) || movedSpreadIds.has(id);
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
     *
     * @returns {void} Opens the preview without applying changes.
     */
    const openAutoFix = () =>
    {
        const matching = results.map(({ id }) => spreadIndex.entries.get(id)).filter((entry) => !entry.placeholder);
        const editable = matching.filter((entry) => entry.editable);
        const entries = editable.map((entry) => ({ id: entry.id, fields: drafts[entry.id] ?? entry.fields }));
        const plans = Object.fromEntries(Object.values(AUTO_FIX_CATEGORY).map((category) => [category, planSpreadAutoFix(catalog, entries, category, spreads.teamTypes)]));

        /**
         * Names a spread in the preview.
         * @param {string} id The spread ID.
         * @returns {string} The source label.
         */
        const label = (id) => describeSpread(catalog, spreadIndex.entries.get(id), spreadIndex.sets.get(spreadIndex.entries.get(id).setId));

        /**
         * Reads the current draft or saved values.
         * @param {string} id The spread ID.
         * @returns {object} The current fields.
         */
        const current = (id) => drafts[id] ?? spreadIndex.entries.get(id).fields;

        /**
         * Names an IV or EV field's stat.
         * @param {string} field The IV or EV field.
         * @returns {string} The short stat label.
         */
        const statLabel = (field) => STAT_SHORT_LABELS[Object.keys(IV_FIELDS).find((stat) => IV_FIELDS[stat] === field || EV_FIELDS[stat] === field)];

        /**
         * Describes a plan using the same move context as its applied changes.
         * @param {object} plan The category or combined plan.
         * @returns {Array<object>} The categorized preview entries.
         */
        const describeChanges = (plan) => plan.changes.map(({ id, cappedIvs, removedMoves, compacted, ivFix, evFix }) => (
            {
                id,
                label: label(id),
                descriptions:
                {
                    moves:
                    [
                        ...removedMoves.map(({ move, reason }) => `Removing ${REMOVAL_REASONS[reason]} move ${getLabel(catalog.moves, move)}`),
                        ...(compacted && removedMoves.length === 0 ? ["Shifting moves up over a blank slot"] : []),
                    ],
                    ivs:
                    [
                        ...cappedIvs.map((field) => `Lowering ${statLabel(field)} IV ${current(id)[field]} to 31`),
                        ...Object.entries(ivFix.changes).map(([field, value]) =>
                            `${value < Math.min(current(id)[field], 31) ? "Lowering" : "Raising"} ${STAT_SHORT_LABELS[IV_FIELD_STATS[field]]} IV ${Math.min(current(id)[field], 31)} to ${value}${ivFix.hiddenPowerIvs.includes(field) ? ` (kept ${value % 2 === 1 ? "odd" : "even"} for Hidden Power)` : ""}`),
                    ],
                    evs: Object.entries(evFix).map(([field, value]) => `Lowering ${statLabel(field)} EVs ${current(id)[field]} to ${value}`),
                },
            }));

        /**
         * Describes unknown attacking stats for a plan.
         * @param {object} plan The category or combined plan.
         * @returns {Array<object>} The skipped-stat entries.
         */
        const describeSkipped = (plan) => plan.skipped.map(({ id, stats }) => (
            {
                id,
                label: label(id),
                descriptions: stats.map((stat) => `Keeping ${STAT_SHORT_LABELS[stat]} IV unchanged (unknown move details)`),
            }));

        setAutoFix(
        {
            plans,
            changes: describeChanges(plans[AUTO_FIX_CATEGORY.ALL]),
            categoryChanges: Object.fromEntries(Object.entries(plans).map(([category, plan]) => [category, describeChanges(plan)])),
            skipped: describeSkipped(plans[AUTO_FIX_CATEGORY.ALL]),
            categorySkipped: Object.fromEntries(Object.entries(plans).map(([category, plan]) => [category, describeSkipped(plan)])),
            locked: matching.filter((entry) => !entry.editable).map((entry) => (
            {
                id: entry.id,
                label: label(entry.id),
                reason: [LOCKED_REASON, ...(entry.diagnostics ?? []).map((diagnostic) => diagnostic.message)].join(" "),
            })),
        });
    };

    /**
     * Applies only the selected category, then closes its preview.
     * @param {string} category The selected category.
     * @returns {void} Updates drafts and reports the affected spread count.
     */
    const applyAutoFix = (category) =>
    {
        const changes = autoFix.plans[category].changes;
        editor.applyChanges(changes);
        setAutoFix(null);
        const count = changes.length === 1 ? "1 spread" : `${changes.length} spreads`;
        toast.success(category === AUTO_FIX_CATEGORY.ALL ? `Fixed ${count}.` : `Fixed ${AUTO_FIX_LABELS[category]} in ${count}.`);
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
                changed={Object.hasOwn(drafts, id) || state.deleted.has(id) || movedIds.has(id)}
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
                onAddSpread={() => setAddOpen(true)}
                onExport={() => setExportEntries(results.map(({ id }) =>
                {
                    const entry = spreadIndex.entries.get(id);
                    const set = spreadIndex.sets.get(entry.setId);
                    return { id, label: describeSpread(catalog, entry, set), fields: drafts[id] ?? entry.fields, level: getSpreadLevel(set, preview.level) };
                }))}
            />
            <SpreadGrid
                spreads={results}
                availableSpreads={availableSpreads}
                renderCard={renderCard}
                getSetHeading={getSetHeading}
                pageSize={pageSize}
                onPageSizeChange={setPageSize}
                resetKey={JSON.stringify(filters)}
                onClearFilters={() => setFilters(DEFAULT_FILTERS)}
                getSpeciesName={(species) => getSpeciesFormName(catalog, species)}
                reveal={reveal}
                orders={orders}
                allEntries={spreadIndex.entries}
                sets={spreadIndex.sets}
                activeSet={activeSet}
                onOrder={(setId, order, id, moved) =>
                {
                    editor.orderSet(setId, order, moved);
                    setReveal({ id, key: Date.now() });
                }}
                onRevertOrder={editor.revertOrder}
                movedGroups={movedGroups}
                movedSpreadIds={movedSpreadIds}
                onRevertGroup={editor.revertGroup}
                onRevertSpread={editor.revertSpreadOrder}
                hiddenIds={transferredIds}
                getTransferProblem={editor.getTransferProblem}
                onTransfer={editor.transferSpread}
                onAdd={(setId) => setAddOpen({ setId })}
            />
            {addOpen && <AddSpreadDialog sets={spreads.sets} defaultSetId={addOpen.setId ?? filters.setId} catalog={catalog}
                preview={preview} teamTypes={spreads.teamTypes} loadSmogonSets={editor.loadSmogonSets}
                defaultSpecies={filters.species.length === 1 ? filters.species[0] : undefined}
                onClose={() => setAddOpen(false)} onAdd={(setId, species) =>
                {
                    // The first move is filled in, so pressing Enter again adds the spread
                    const [firstMove] = getLearnableMoveOptions(catalog, species).options;
                    const fields = createNewSpreadFields(species, catalog.species[species]);
                    setPending({ setId, fields: firstMove ? setMove(fields, 0, firstMove.move, firstMove.hiddenPowerType) : fields, memory: undefined });
                    setAddOpen(false);
                }} onImport={(setId, fieldsList) =>
                {
                    const ids = editor.addSpreads(setId, fieldsList);
                    setReveal({ id: ids[0], key: Date.now() });
                    setAddOpen(false);
                    toast.success(ids.length === 1 ? "Imported 1 spread." : `Imported ${ids.length} spreads.`);
                }} />}
            {exportEntries != null &&
                <ExportSpreadsDialog title={exportEntries.length === 1 ? "Export 1 Spread to Showdown" : `Export ${exportEntries.length} Spreads to Showdown`}
                                     catalog={catalog} entries={exportEntries} onClose={() => setExportEntries(null)} />}
            {pendingEntry != null &&
                <EditSpreadDialog name={getLabel(catalog.species, pendingEntry.fields.species)} adding sets={spreads.sets} setId={pendingEntry.setId}
                                  getSetProblem={(setId) =>
                                  {
                                      const set = spreadIndex.sets.get(setId);
                                      return set.canInsert ? "" : set.insertBlockedReason ?? "Spreads cannot be added to this set.";
                                  }}
                                  onSetChange={(setId) => setPending((current) => ({ ...current, setId }))}
                                  onClose={() => setConfirmDiscard(true)}
                                  onSubmit={() => pendingProblems.length === 0 && addPending()}
                                  actions={<>
                                      <Button onClick={() => setConfirmDiscard(true)}>Cancel</Button>
                                      <Tooltip title={pendingProblems.map((problem) => problem.message).join(" ")}><span>
                                          <Button variant="contained" color="focus" disabled={pendingProblems.length > 0} onClick={addPending}>Add</Button>
                                      </span></Tooltip>
                                  </>}>
                    <SpreadCard
                        entry={pendingEntry}
                        fields={pendingEntry.fields}
                        set={spreadIndex.sets.get(pendingEntry.setId)}
                        catalog={catalog}
                        teamTypes={spreads.teamTypes}
                        preview={preview}
                        editing
                        changed={false}
                        problems={pendingProblems}
                        actions={pendingActions}
                    />
                </EditSpreadDialog>}
            {confirmDiscard && pendingEntry != null &&
                <DiscardNewSpreadDialog name={getLabel(catalog.species, pendingEntry.fields.species)} onCancel={() => setConfirmDiscard(false)}
                                        onDiscard={() =>
                                        {
                                            setConfirmDiscard(false);
                                            setPending(null);
                                        }} />}
            {editingId != null &&
                <EditSpreadDialog name={getLabel(catalog.species, (drafts[editingId] ?? spreadIndex.entries.get(editingId).fields).species)}
                                  sets={spreads.sets} setId={spreadIndex.entries.get(editingId).setId}
                                  getSetProblem={(setId) => editor.getTransferProblem(editingId, setId)}
                                  onSetChange={(setId) => editor.transferSpread(editingId, setId)}
                                  onRevert={canRevert(editingId) ? () => editor.revertSpread(editingId) : null}
                                  onClose={() => editor.setEditing(editingId, false)}>
                    <SpreadCard
                        entry={spreadIndex.entries.get(editingId)}
                        fields={drafts[editingId] ?? spreadIndex.entries.get(editingId).fields}
                        set={spreadIndex.sets.get(spreadIndex.entries.get(editingId).setId)}
                        catalog={catalog}
                        teamTypes={spreads.teamTypes}
                        preview={preview}
                        editing
                        changed={Object.hasOwn(drafts, editingId) || state.deleted.has(editingId) || movedIds.has(editingId)}
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
                    categoryChanges={autoFix.categoryChanges}
                    skipped={autoFix.skipped}
                    categorySkipped={autoFix.categorySkipped}
                    locked={autoFix.locked}
                    onClose={() => setAutoFix(null)}
                    onApply={applyAutoFix}
                />}
        </>
    );
};

/**
 * The spread editor page: repository setup, then the editor once a game is loaded.
 * @component
 * @returns {JSX.Element} The page.
 */
const SpreadEditorPage = () =>
{
    const { state } = useSpreadEditor();
    const ready = state.phase === EDITOR_PHASE.READY;

    return (
        <div className="page-content" id="spread-editor-page" data-testid="spread-editor-page">
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

export default SpreadEditorPage;
