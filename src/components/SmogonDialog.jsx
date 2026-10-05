/**
 * This file defines the Smogon Sets dialog, which shows Smogon sets for a species as read-only spread cards so several
 * can be added at once, or one can overwrite the spread being edited.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack, Tab, Tabs, Tooltip, Typography } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import HelpOutlineIcon from "@mui/icons-material/HelpOutlineOutlined";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { SMOGON_CATEGORIES, SMOGON_TABS, expandSmogonSet, getSmogonSpeciesNames } from "../../shared/smogon.mjs";
import { applyOverwrite, resolveImportedSet } from "../../shared/showdown.mjs";
import { getIvAutoFix } from "../../shared/pokemon-mechanics.mjs";
import { getSpeciesFormName } from "../subcomponents/CatalogDisplay";
import OperationProgress from "../subcomponents/OperationProgress";
import SpreadCard from "./SpreadCard";
import { getImportWarnings } from "./SpreadDialogs";
import { MIN_CARD_WIDTH } from "./SpreadGrid";

const TITLE_ID = "smogon-dialog-title";
const EXPLANATION_TITLE_ID = "smogon-explanation-title";
const FOCUS_TABS =
{
    "& .MuiTab-root:not(.Mui-disabled)": { color: "text.primary", fontWeight: 500, opacity: 1 },
    "& .MuiTab-root.Mui-selected:not(.Mui-disabled)": { color: "focus.main", fontWeight: 600 },
    "& .MuiTab-root.Mui-disabled": { color: "text.disabled", fontWeight: 400, opacity: 0.45 },
    "& .MuiTabs-indicator": { backgroundColor: "focus.main" },
};
const MATCHES_SPREAD = "This set matches the spread already.";
const STALE_MESSAGE = "Showing saved Smogon sets because they could not be refreshed.";
const OPEN_KEYS = ["Enter", " "];
const EMPTY_ARRAY = [];
const DEFAULT_PREVIEW = { level: 50 };
const INITIAL_PROGRESS = { percentage: 0, label: "Loading Smogon Sets..." };


/**
 * Keeps preview cards inert even if an action is requested.
 *
 * @returns {void} Nothing.
 */
function noop()
{
}
const PREVIEW_ACTIONS = { updateSpread: noop, setEditing: noop, deleteSpread: noop, restoreSpread: noop };

/**
 * Browses resolved Smogon sets for adding several spreads or overwriting one.
 *
 * @param {object} props The dialog props.
 * @param {object} props.catalog The selected game catalog.
 * @param {string} props.species The base species constant.
 * @param {object} props.set The destination spread set.
 * @param {Array<object>} props.teamTypes The doubles team enum.
 * @param {object} props.preview The preview level.
 * @param {Function} props.loadSmogonSets Loads species names with an onProgress({percentage, label}) callback.
 * @param {boolean} props.multiple Whether to select multiple additions.
 * @param {object} props.currentFields Current overwrite values.
 * @param {object} props.savedFields Saved overwrite values.
 * @param {Function} props.onAdd Adds selected fields in selection order.
 * @param {Function} props.onChoose Applies one overwritten spread.
 * @param {Function} props.onClose Closes the dialog.
 * @returns {JSX.Element} The dialog.
 */
export default function SmogonDialog({ catalog, species, set, teamTypes = EMPTY_ARRAY, preview = DEFAULT_PREVIEW, loadSmogonSets,
    multiple = false, currentFields, savedFields, onAdd, onChoose, onClose })
{
    const [response, setResponse] = useState(null);
    const [error, setError] = useState(null);
    const [progress, setProgress] = useState(INITIAL_PROGRESS);
    const [retry, setRetry] = useState(0);
    const [tabChoice, setTabChoice] = useState(null);
    const [categoryChoice, setCategoryChoice] = useState(null);
    const [selected, setSelected] = useState([]);
    const [explanation, setExplanation] = useState(null);
    const name = getSpeciesFormName(catalog, species);

    /**
     * Loads a fresh response and ignores requests finishing after close or species changes.
     *
     * @returns {Function} Invalidates the request on cleanup.
     */
    useEffect(() =>
    {
        let active = true;
        setResponse(null);
        setError(null);
        setProgress(INITIAL_PROGRESS);
        setSelected([]);
        setExplanation(null);
        setTabChoice(null);
        setCategoryChoice(null);
        Promise.resolve().then(() => loadSmogonSets(getSmogonSpeciesNames(catalog, species), (update) =>
        {
            if (active)
                setProgress(update);
        })).then((result) =>
        {
            if (active)
            {
                active = false;
                setProgress(null);
                setResponse(result);
            }
        }).catch((failure) =>
        {
            if (active)
            {
                active = false;
                setProgress(null);
                setError(failure.message || failure.response?.data?.error?.message || "Smogon sets could not be loaded.");
            }
        });
        return () =>
        {
            active = false;
        };
    }, [catalog, species, loadSmogonSets, retry]);

    const choices = useMemo(() => (response?.sets ?? []).flatMap((entry, entryIndex) =>
        expandSmogonSet(catalog, species, entry).map((variant) =>
        {
            const resolved = resolveImportedSet(catalog, variant.set, { hiddenPower: "optimizeIvs" });
            const format = response.formats.find((candidate) => candidate.id === entry.format);
            let overwrite = !multiple && resolved.errors.length === 0
                ? applyOverwrite(catalog, currentFields, resolved.fields, { teamTypes, saved: savedFields, ballProvided: false }) : null;
            if (overwrite)
            {
                const optimizedFields = { ...overwrite.fields, ...getIvAutoFix(catalog, overwrite.fields, teamTypes).changes };
                overwrite = applyOverwrite(catalog, currentFields, optimizedFields, { teamTypes, saved: savedFields, ballProvided: false });
            }
            const fields = multiple && resolved.errors.length === 0
                ? resolved.fields
                : overwrite?.fields;
            return { ...variant, choiceId: `${entryIndex}|${entry.species}|${variant.id}`, formatInfo: format, fields,
                errors: resolved.errors.map((problem) => problem.message), warnings: getImportWarnings(resolved),
                disabled: !multiple && overwrite?.differences.length === 0 };
        })), [response, catalog, species, multiple, currentFields, savedFields, teamTypes]);
    const usable = choices.filter((choice) => choice.errors.length === 0 && choice.formatInfo);
    const skipped = choices.filter((choice) => choice.errors.length > 0);
    const tab = SMOGON_TABS.find((candidate) => candidate.id === tabChoice && usable.some((choice) => choice.formatInfo.tab === candidate.id))?.id
        ?? SMOGON_TABS.find((candidate) => usable.some((choice) => choice.formatInfo.tab === candidate.id))?.id;
    const category = SMOGON_CATEGORIES.find((candidate) => candidate.id === categoryChoice && usable.some((choice) => choice.formatInfo.tab === tab && choice.formatInfo.category === candidate.id))?.id
        ?? SMOGON_CATEGORIES.find((candidate) => usable.some((choice) => choice.formatInfo.tab === tab && choice.formatInfo.category === candidate.id))?.id;
    const formats = (response?.formats ?? []).filter((format) => format.tab === tab && format.category === category
        && usable.some((choice) => choice.format === format.id));

    /**
     * Toggles an addition or applies one overwrite.
     *
     * @param {object} choice The resolved variant.
     * @returns {void} Nothing.
     */
    const choose = (choice) =>
    {
        if (choice.disabled)
            return;
        if (multiple)
            setSelected((current) => current.includes(choice.choiceId) ? current.filter((id) => id !== choice.choiceId) : [...current, choice.choiceId]);
        else
            onChoose(choice.fields);
    };

    return (
        <>
            <Dialog open onClose={onClose} fullWidth maxWidth="lg" aria-labelledby={TITLE_ID}>
                <DialogTitle id={TITLE_ID}>Smogon Sets for {name}</DialogTitle>
                <DialogContent dividers>
                    <Stack spacing={2}>
                        {!response && !error && <OperationProgress progress={progress} />}
                        {error && <Alert severity="error" action={<Button color="inherit" onClick={() => setRetry((value) => value + 1)}>Retry</Button>}>{error}</Alert>}
                        {response?.stale && <Alert severity="info">{STALE_MESSAGE}</Alert>}
                        {response?.unavailable?.length > 0 && <Alert severity="info">Some Smogon formats are unavailable: {response.unavailable.join(", ")}.</Alert>}
                        {response && usable.length === 0 && <Typography>No Smogon sets for {name}.</Typography>}
                        {usable.length > 0 && <>
                            <Tabs value={tab} onChange={(event, value) => setTabChoice(value)} aria-label="Smogon Generation" sx={FOCUS_TABS} variant="scrollable" scrollButtons="auto">
                                {SMOGON_TABS.map((option) => <Tab key={option.id} value={option.id} label={option.label}
                                    disabled={!usable.some((choice) => choice.formatInfo.tab === option.id)} />)}
                            </Tabs>
                            <Tabs value={category} onChange={(event, value) => setCategoryChoice(value)} aria-label="Smogon Battle Category" sx={FOCUS_TABS}>
                                {SMOGON_CATEGORIES.map((option) => <Tab key={option.id} value={option.id} label={option.label}
                                    disabled={!usable.some((choice) => choice.formatInfo.tab === tab && choice.formatInfo.category === option.id)} />)}
                            </Tabs>
                            {formats.map((format) => <section key={format.id} className="spread-section">
                                <div className="spread-section-heading"><Typography component="h3" variant="h6" className="spread-section-title">{format.label}</Typography></div>
                                <Box className="smogon-grid" sx={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(${MIN_CARD_WIDTH}px, 100%), 1fr))` }}>
                                    {usable.filter((choice) => choice.format === format.id).map((choice) =>
                                    {
                                        const checked = selected.includes(choice.choiceId);
                                        return <Tooltip key={choice.choiceId} title={choice.disabled ? MATCHES_SPREAD : ""}>
                                            <Box className={`smogon-choice${checked ? " smogon-choice-selected" : ""}`} role={multiple ? "checkbox" : "button"}
                                                 aria-label={choice.title} aria-checked={multiple ? checked : undefined} aria-disabled={choice.disabled || undefined}
                                                 tabIndex={choice.disabled ? -1 : 0} onClick={() => choose(choice)} onKeyDown={(event) =>
                                                 {
                                                     if (event.target === event.currentTarget && OPEN_KEYS.includes(event.key))
                                                     {
                                                         event.preventDefault();
                                                         choose(choice);
                                                     }
                                                 }} sx={{ "&.smogon-choice-selected": { borderColor: "success.main" }, "&:focus-visible": { outlineColor: "focus.main" } }}>
                                                {checked && <CheckCircleIcon color="success" className="smogon-check" aria-label="Selected" />}
                                                <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", minHeight: 32, px: 1, py: 0.5 }}>
                                                    <Typography variant="subtitle2" sx={{ overflowWrap: "anywhere" }}>{choice.title}</Typography>
                                                    {choice.description && <Tooltip title="View Explanation">
                                                        <IconButton className="smogon-explanation-button" size="small" aria-label={`About ${choice.title}`} onClick={(event) =>
                                                        {
                                                            event.stopPropagation();
                                                            setExplanation({ title: choice.title, description: choice.description });
                                                        }}>
                                                            <HelpOutlineIcon fontSize="small" />
                                                        </IconButton>
                                                    </Tooltip>}
                                                    {choice.warnings.length > 0 && <Tooltip title={<Box sx={{ whiteSpace: "pre-line" }}>{choice.warnings.join("\n")}</Box>}>
                                                        <span role="img" aria-label={`Warnings for ${choice.title}`}><WarningAmberIcon color="warning" fontSize="small" /></span>
                                                    </Tooltip>}
                                                </Stack>
                                                <SpreadCard readOnly showBattleType={false} entry={{ id: choice.choiceId, fields: choice.fields, editable: true, diagnostics: [], line: 0 }}
                                                            fields={choice.fields} catalog={catalog} set={set} preview={preview} teamTypes={teamTypes}
                                                            editing={false} changed={false} problems={EMPTY_ARRAY} actions={PREVIEW_ACTIONS} />
                                            </Box>
                                        </Tooltip>;
                                    })}
                                </Box>
                            </section>)}
                        </>}
                        {skipped.length > 0 && <Tooltip placement="top-start" title={<Box sx={{ whiteSpace: "pre-line" }}>{skipped.map((choice) => `${choice.title}: ${choice.errors.join(", ")}`).join("\n")}</Box>}>
                            <Typography component="span" variant="caption" tabIndex={0} className="smogon-skipped-summary">{skipped.length} {skipped.length === 1 ? "set could" : "sets could"} not be used</Typography>
                        </Tooltip>}
                        <Typography variant="caption" color="text.secondary">Sets from Smogon University</Typography>
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={onClose}>Close</Button>
                    <Box sx={{ flex: 1 }} />
                    {multiple && <Button variant="contained" color="focus" disabled={selected.length === 0}
                        onClick={() => onAdd(selected.map((id) => usable.find((choice) => choice.choiceId === id).fields))}>
                        Add {selected.length} {selected.length === 1 ? "Spread" : "Spreads"}
                    </Button>}
                </DialogActions>
            </Dialog>
            {explanation && <Dialog open onClose={() => setExplanation(null)} fullWidth maxWidth="sm" aria-labelledby={EXPLANATION_TITLE_ID}>
                <DialogTitle id={EXPLANATION_TITLE_ID}>{explanation.title} Explanation</DialogTitle>
                <DialogContent dividers>
                    <Typography className="smogon-explanation-text">{explanation.description}</Typography>
                </DialogContent>
                <DialogActions sx={{ justifyContent: "flex-start" }}>
                    <Button onClick={() => setExplanation(null)}>Close</Button>
                </DialogActions>
            </Dialog>}
        </>
    );
}
