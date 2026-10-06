import React, { useEffect, useRef, useState } from "react";
import { Alert, Autocomplete, Button, createFilterOptions, Dialog, DialogActions, DialogContent, DialogTitle,
    Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import CompareArrowsIcon from "@mui/icons-material/CompareArrows";
import CheckIcon from "@mui/icons-material/Check";
import { useSpreadEditor } from "../SpreadEditorState";
import OperationProgress from "../subcomponents/OperationProgress";
import SpreadFileReview from "./SpreadFileReview";

const MODE_SMART = "smart";
const MODE_OVERWRITE = "overwrite";
const PAGE_IMPORT = "import";
const PAGE_REVIEW = "review";
const PAGE_RESULTS = "results";
const CHOICE_CURRENT = "current";
const CHOICE_INCOMING = "incoming";
const DATE_LOCALE = "en";
const BULK_LABELS = { [CHOICE_CURRENT]: "Keep All Current", [CHOICE_INCOMING]: "Keep All Incoming" };
const FILTER_EXPORTS = createFilterOptions({ stringify: (entry) => `${getExportLabel(entry)} ${formatExportDate(entry.exportedAt)}` });


/**
 * Formats local export timestamps with an unambiguous year/month/day date.
 * @param {string} exportedAt The ISO export timestamp.
 * @returns {string} YYYY/MM/DD and 12-hour time with AM or PM.
 */
export function formatExportDate(exportedAt)
{
    const parts = Object.fromEntries(new Intl.DateTimeFormat(DATE_LOCALE, { year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h12" }).formatToParts(new Date(exportedAt))
        .map((part) => [part.type, part.value]));
    return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ${parts.dayPeriod}`;
}

/**
 * Uses a named baseline or falls back to its local export date.
 * @param {object} entry The retained baseline metadata.
 * @returns {string} The searchable display label.
 */
function getExportLabel(entry)
{
    return entry.name || formatExportDate(entry.exportedAt);
}

/**
 * Chooses a dated baseline, reviews collaborative changes, and imports resolved sources.
 * @param {object} props The dialog properties.
 * @param {boolean} props.open Whether the dialog is open.
 * @param {Function} props.onClose Closes the dialog.
 * @returns {JSX.Element} The spread-file import dialog.
 */
export default function SpreadFileImportDialog({ open, onClose })
{
    const editor = useSpreadEditor();
    const { state, listSpreadExports, clearArchiveFeedback } = editor;
    const [mode, setMode] = useState(MODE_SMART);
    const [exports, setExports] = useState([]);
    const [baselineId, setBaselineId] = useState("");
    const [loading, setLoading] = useState(false);
    const [historyError, setHistoryError] = useState(null);
    const [historyAttempt, setHistoryAttempt] = useState(0);
    const [file, setFile] = useState(null);
    const [preview, setPreview] = useState(null);
    const [page, setPage] = useState(PAGE_IMPORT);
    const [result, setResult] = useState(null);
    const [bulkChoice, setBulkChoice] = useState(null);
    const reviewRef = useRef(null);
    const busy = loading || state.downloading || state.saving;

    /** Initializes each opening and ignores late history responses after close. */
    useEffect(() =>
    {
        if (!open)
        {
            reviewRef.current = null;
            return;
        }

        // Reset every piece of dialog state
        let active = true;
        setFile(null);
        setPreview(null);
        reviewRef.current = null;
        setPage(PAGE_IMPORT);
        setResult(null);
        setBulkChoice(null);
        setExports([]);
        setBaselineId("");
        setMode(MODE_SMART);
        setHistoryError(null);
        setLoading(true);
        clearArchiveFeedback();

        // Load the export history and default to the newest baseline
        listSpreadExports().then((history) =>
        {
            if (!active)
                return;
            setExports(history);
            setBaselineId(history[0]?.id ?? "");
            setMode(history.length ? MODE_SMART : MODE_OVERWRITE);
        }).catch((error) =>
        {
            if (active)
                setHistoryError(error.message ?? "Could not load exports.");
        }).finally(() =>
        {
            if (active)
                setLoading(false);
        });
        return () =>
        {
            active = false;
        };
    }, [open, listSpreadExports, clearArchiveFeedback, historyAttempt]);

    /** Clears a preview whenever its source, mode, or baseline changes. */
    function resetPreview()
    {
        setPreview(null);
        reviewRef.current = null;
        setPage(PAGE_IMPORT);
        clearArchiveFeedback();
    }

    /** Stages ordinary changes and opens review only for conflicts. */
    async function previewChanges()
    {
        const incoming = await editor.importSpreadFiles(file, { baselineId });
        if (incoming)
        {
            // Stage the non-conflicting changes right away
            const staged = editor.acceptSpreadComparison(incoming.changes, incoming.editorOperationKey);
            if (!staged)
                return;

            // Keep only conflicts for review and show the summary
            const remaining = { ...incoming, changes: [], editorOperationKey: staged.editorOperationKey };
            setPreview(remaining);
            const summary = { ...staged, acceptedCount: incoming.changes.length, rejectedCount: 0, unchanged: !incoming.changes.length && !incoming.conflicts.length };
            reviewRef.current = { preview: remaining, summary, busy: false };
            setResult(summary);
            setPage(remaining.conflicts.length ? PAGE_REVIEW : PAGE_RESULTS);
        }
    }

    /**
     * Immediately stages one incoming comparison or dismisses a current-version choice.
     * @param {string} id The comparison ID.
     * @param {string} choice Incoming stages edits; current only dismisses the comparison.
     * @returns {void} Nothing.
     */
    function chooseComparison(id, choice)
    {
        chooseComparisons([id], choice);
    }

    /**
     * Applies a group of conflict choices atomically to local drafts.
     * @param {Array<string>} ids The conflict IDs.
     * @param {string} choice The current or incoming choice.
     * @returns {void} Nothing.
     */
    function chooseComparisons(ids, choice)
    {
        // Ignore empty or concurrent requests
        const review = reviewRef.current;
        const comparisons = review?.preview.conflicts.filter((row) => ids.includes(row.id));
        if (!comparisons?.length || review.busy || busy)
            return;
        review.busy = true;
        try
        {
            // Stage incoming choices; current choices only dismiss the conflicts
            let staged = null;
            if (choice === CHOICE_INCOMING)
            {
                staged = editor.acceptSpreadComparison(comparisons, review.preview.editorOperationKey);
                if (!staged || reviewRef.current !== review)
                    return;
            }
            else
                clearArchiveFeedback();

            // Remove resolved conflicts and update the running summary
            const remaining = { ...review.preview,
                editorOperationKey: staged?.editorOperationKey ?? review.preview.editorOperationKey,
                conflicts: review.preview.conflicts.filter((row) => !ids.includes(row.id)) };
            const summary = { operations: [...review.summary.operations, ...(staged?.operations ?? [])],
                files: [...new Map([...review.summary.files, ...(staged?.files ?? [])].map((file) => [file.path, file])).values()],
                acceptedCount: review.summary.acceptedCount + (choice === CHOICE_INCOMING ? comparisons.length : 0),
                rejectedCount: review.summary.rejectedCount + (choice === CHOICE_CURRENT ? comparisons.length : 0) };
            reviewRef.current = { preview: remaining, summary, busy: false };
            setPreview(remaining);
            setResult(summary);
            if (remaining.changes.length + remaining.conflicts.length === 0)
                setPage(PAGE_RESULTS);
        }
        finally
        {
            review.busy = false;
        }
    }

    /** Stages an explicitly selected full overwrite as unsaved editor changes. */
    async function importChanges()
    {
        const succeeded = await editor.importSpreadFiles(file);
        if (succeeded)
        {
            setResult(succeeded);
            setPage(PAGE_RESULTS);
        }
    }

    /** Returns to the import form while retaining the chosen ZIP and export date. */
    function backToImport()
    {
        resetPreview();
        setResult(null);
    }

    return <><Dialog open={open} onClose={() => !busy && onClose()} aria-labelledby="spread-import-title"
                   fullWidth maxWidth={page === PAGE_REVIEW ? "xl" : "sm"} scroll="paper">
        <DialogTitle id="spread-import-title">{page === PAGE_IMPORT ? "Import Spread Files" : page === PAGE_REVIEW ? "Review Spread Changes" : "Import Results"}</DialogTitle>
        <DialogContent>
            <Stack spacing={2}>
                {page === PAGE_IMPORT && <>
                    <ToggleButtonGroup exclusive value={mode} size="small" disabled={busy} aria-label="Import Mode"
                        onChange={(_, value) =>
                        {
                            if (!value)
                                return;
                            setMode(value);
                            resetPreview();
                        }}>
                        <ToggleButton value={MODE_SMART}>Smart Import</ToggleButton>
                        <ToggleButton value={MODE_OVERWRITE}>Full Overwrite</ToggleButton>
                    </ToggleButtonGroup>
                    {mode === MODE_SMART && <Autocomplete autoHighlight options={exports} value={exports.find((entry) => entry.id === baselineId) ?? null}
                        disabled={busy || exports.length === 0} getOptionLabel={getExportLabel} getOptionKey={(entry) => entry.id}
                        isOptionEqualToValue={(option, value) => option.id === value.id} filterOptions={FILTER_EXPORTS}
                        onChange={(_, entry) =>
                        {
                            setBaselineId(entry?.id ?? "");
                            resetPreview();
                        }} fullWidth
                        renderInput={(params) => <TextField {...params} label="Export" />}
                        renderOption={({ key, ...props }, entry) => <li key={key} {...props}><Stack sx={{ minWidth: 0 }}>
                            <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>{getExportLabel(entry)}</Typography>
                            {entry.name && <Typography variant="caption" color="text.secondary">{formatExportDate(entry.exportedAt)}</Typography>}
                        </Stack></li>} />}
                    {loading && <Typography role="status" variant="body2">Loading Exports...</Typography>}
                    {historyError && <Alert severity="error" action={<Button disabled={busy} onClick={() => setHistoryAttempt((attempt) => attempt + 1)}>Retry</Button>}>{historyError}</Alert>}
                    {mode === MODE_SMART && !loading && !historyError && exports.length === 0
                        && <Alert severity="info">No saved exports. Export spread files to create a dated baseline.</Alert>}
                    {mode === MODE_OVERWRITE && <Alert severity="warning">Import replaces matching spreads in the editor. Files are not written until Save Changes.</Alert>}
                    <Button component="label" color="focus" startIcon={<UploadFileIcon />} disabled={busy}
                        sx={{ textTransform: file ? "none" : undefined, overflowWrap: "anywhere", minWidth: 0 }}>
                        {file?.name ?? "Choose ZIP"}
                        <input type="file" hidden accept=".zip,application/zip" aria-label="Choose Spread Files ZIP"
                               onChange={(event) =>
                               {
                                   setFile(event.target.files?.[0] ?? null);
                                   resetPreview();
                                   event.target.value = "";
                               }} />
                    </Button>
                </>}
                {busy && page === PAGE_IMPORT && <OperationProgress progress={state.archiveProgress} />}
                {state.archiveError && <Alert severity="error">{state.archiveError.message}</Alert>}
                {page === PAGE_REVIEW && <SpreadFileReview preview={preview} busy={busy}
                    onChoose={chooseComparison} />}
                {page === PAGE_RESULTS && <>
                    <Alert severity={mode === MODE_SMART && result.acceptedCount === 0 ? "info" : "success"}>
                        {result.unchanged ? "No incoming changes since this export." : mode === MODE_SMART && result.acceptedCount === 0 ? "Review completed without importing changes." : "Changes imported as unsaved edits."}
                    </Alert>
                    <Typography variant="body2">{result.acceptedCount ?? result.operations.length} accepted; {result.rejectedCount ?? 0} rejected. Use Save Changes to write the files.</Typography>
                    {(result.files ?? []).map((file) => <Typography key={file.path} variant="body2" sx={{ overflowWrap: "anywhere" }}>{file.path}</Typography>)}
                </>}
            </Stack>
        </DialogContent>
        <DialogActions disableSpacing sx={{ flexWrap: "wrap", gap: 1 }}>
            <Button disabled={busy} onClick={onClose}>Close</Button>
            {page !== PAGE_IMPORT && <Button startIcon={<ArrowBackIcon />} disabled={busy} onClick={backToImport}>Back</Button>}
            {page === PAGE_REVIEW && <Stack direction="row" spacing={1} sx={{ ml: "auto", flexWrap: "wrap", justifyContent: "flex-end", gap: 1 }}>
                {[CHOICE_CURRENT, CHOICE_INCOMING].map((choice) => <Button key={choice} color="focus" variant="outlined"
                    startIcon={<CheckIcon />} disabled={busy} onClick={() => setBulkChoice(choice)}>{BULK_LABELS[choice]}</Button>)}
            </Stack>}
            {page === PAGE_IMPORT && mode === MODE_SMART && <Button variant="outlined" color="focus" startIcon={<CompareArrowsIcon />}
                disabled={busy || !file || !baselineId} onClick={previewChanges}>Preview Changes</Button>}
            {page === PAGE_IMPORT && mode === MODE_OVERWRITE && <Button variant="outlined" startIcon={<UploadFileIcon />}
                disabled={busy || !file} onClick={importChanges}>Import And Overwrite</Button>}
        </DialogActions>
    </Dialog>
    <Dialog open={open && bulkChoice !== null} onClose={() => setBulkChoice(null)} aria-labelledby="spread-bulk-title" maxWidth="xs" fullWidth>
        <DialogTitle id="spread-bulk-title">{BULK_LABELS[bulkChoice]}</DialogTitle>
        <DialogContent>
            <Typography>{bulkChoice === CHOICE_INCOMING ? `Replace all ${preview?.conflicts.length ?? 0} remaining conflicts with incoming spreads as unsaved edits?`
                : `Keep the current version of all ${preview?.conflicts.length ?? 0} remaining conflicts?`}</Typography>
        </DialogContent>
        <DialogActions>
            <Button autoFocus onClick={() => setBulkChoice(null)}>Cancel</Button>
            <Button color="focus" variant="outlined" onClick={() =>
            {
                chooseComparisons(reviewRef.current.preview.conflicts.map((row) => row.id), bulkChoice);
                setBulkChoice(null);
            }}>{BULK_LABELS[bulkChoice]}</Button>
        </DialogActions>
    </Dialog></>;
}
