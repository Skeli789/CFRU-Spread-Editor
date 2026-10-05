/**
 * This file defines the spread editor's dialogs: adding and importing spreads, editing a spread, the IV auto-fix
 * preview and the unsaved changes prompt.
 */

import React, { useCallback, useDeferredValue, useMemo, useState } from "react";
import
{
    Accordion, AccordionDetails, AccordionSummary, Alert, Autocomplete, Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, IconButton, List, ListItem, ListItemText, Stack, Tab, Tabs,
    TextField, Tooltip, Typography, useMediaQuery, useTheme,
} from "@mui/material";
import UndoIcon from "@mui/icons-material/Undo";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import HelpOutlineIcon from "@mui/icons-material/HelpOutlineOutlined";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { toast } from "react-toastify";

import { isBattleOnlySpecies } from "../../shared/catalog.mjs";
import { EV_FIELDS, IV_FIELDS, STATS, getAbilityOptions, getEffectiveAbility } from "../../shared/pokemon-mechanics.mjs";
import { MAX_SHOWDOWN_LENGTH, SHOWDOWN_PLACEHOLDER_ERROR, applyOverwrite, exportSpread, parseShowdownText, resolveImportedSet } from "../../shared/showdown.mjs";
import { getFieldSymbol, getTeamType, getTeamTypeLabel } from "../../shared/spread-model.mjs";
import { GameImage, STAT_SHORT_LABELS, TypeIcon, getLabel, getSpeciesFormName, useIncrementalList } from "../subcomponents/CatalogDisplay";
import { getFileLabel, getSetDisplayName } from "./SpreadFilters";
import SmogonDialog from "./SmogonDialog";
import TravelExploreIcon from "@mui/icons-material/TravelExplore";

// Long previews are cut short so the dialog stays responsive
const MAX_PREVIEW_ITEMS = 200;
const AUTO_FIX_LOCKED_EXPLANATION = "These spreads are left alone because their source cannot be interpreted and rewritten safely. Changing them could overwrite source the editor does not understand.";
const AUTO_FIX_DESCRIPTION = "Removes moves that can't be used and fixes IVs and EVs for every matching spread on every page.";
const AUTO_FIX_ALL = "all";
const AUTO_FIX_APPLY_LABELS = { all: "Apply All", moves: "Apply Moves", ivs: "Apply IVs", evs: "Apply EVs" };
const AUTO_FIX_CATEGORIES = [{ value: "moves", label: "Moves" }, { value: "ivs", label: "IVs" }, { value: "evs", label: "EVs" }];
const AUTO_FIX_PANEL_ID = "auto-fix-changes-panel";
const AUTO_FIX_HELP_LABEL = "How Auto-Fix Works";
const AUTO_FIX_HELP_MAX_WIDTH = 360;
const AUTO_FIX_HELP_LINES =
[
    "Removes unlearnable, undefined and repeated moves.",
    "Shifts remaining moves up so blank slots come last.",
    "Lowers IVs over 31 to 31.",
    "Caps EVs at 252 per stat and 510 in total.",
    "Reduces smallest non-maxed EV investments before maxed stats.",
    "Lowers unused attacking IVs to 0.",
    "Lowers Speed IV to 0 for Gyro Ball or Trick Room.",
    "Raises used attacking IVs to 31.",
    "Uses 1 or 30 instead when needed to preserve Hidden Power.",
    "Keeps attacking IVs unchanged when move details are unknown.",
];
// Wide enough for the 200px sprite column beside the stats table, with the dialog's scrollbar showing
const EDIT_DIALOG_MAX_WIDTH = 700;
const EDIT_ADVANCE_FIELDS = ["Ball", "Nature", "Move 1", "Move 2", "Move 3", "Move 4", "Item", "Ability", "Battle Type", "Doubles Team Type", "Spread Set"];
const SPECIES_ICON_SIZE = 24;
const SPECIES_PREVIEW_SIZE = 96;
const TAB_SPECIES = "species";
const TAB_IMPORT = "import";
const RAID_RUSH_CATEGORY = "raidRush";
const SPECIES_ETERNAMAX = "SPECIES_ETERNATUS_ETERNAMAX";
const IMPORT_MIN_ROWS = 8;
const IMPORT_MAX_ROWS = 16;
const IMPORT_PROBLEMS_TITLE_ID = "import-problems-title";
const IMPORT_PLACEHOLDER = "Charizard @ Heavy-Duty Boots\nAbility: Solar Power\nEVs: 252 SpA / 4 SpD / 252 Spe\nTimid Nature\n- Flamethrower";
const HIDDEN_POWER_OPTIMIZE = "optimizeIvs";
const FOCUS_TABS = { "& .MuiTab-root.Mui-selected": { color: "focus.main" }, "& .MuiTabs-indicator": { backgroundColor: "focus.main" } };
const UNSUPPORTED_LABELS =
{
    level: "Level",
    happiness: "Happiness",
    "dynamax level": "Dynamax Level",
    dynamaxLevel: "Dynamax Level",
    "tera type": "Tera Type",
    teraType: "Tera Type",
    gender: "Gender",
    name: "Nickname",
};
const EXPORT_MIME_TYPE = "text/plain";
const EXPORT_FILE_NAME = "spreads.txt";
const KEY_ENTER = "Enter";
const MATCHES_SPREAD = "This set matches the spread already.";
const MOVE_NONE = "MOVE_NONE";
const NONE_LABEL = "None";
const TEAM_TYPE_FIELD = "specificTeamType";
const FIELD_TABLES = { nature: "natures", item: "items", ball: "balls" };
const FIELD_LABELS =
{
    species: "Species",
    nature: "Nature",
    ability: "Ability",
    item: "Item",
    ball: "Ball",
    shiny: "Shiny",
    gigantamax: "Gigantamax",
    moves: "Moves",
    [TEAM_TYPE_FIELD]: "Doubles Team",
    ...Object.fromEntries(STATS.flatMap((stat) => [[IV_FIELDS[stat], `${STAT_SHORT_LABELS[stat]} IV`], [EV_FIELDS[stat], `${STAT_SHORT_LABELS[stat]} EVs`]])),
};

/**
 * Formats the same compact warnings for import and overwrite previews.
 *
 * @param {object} result The resolved Showdown set.
 * @returns {Array<string>} The warning messages.
 */
export function getImportWarnings(result)
{
    const unsupported = result.unsupported.filter((entry) => entry.field !== "happiness" || !result.warnings.some((warning) => warning.field === "happiness"));
    return [...result.warnings.map((warning) => warning.message), ...result.ambiguities.map((ambiguity) => ambiguity.message),
        ...unsupported.map((entry) => `${UNSUPPORTED_LABELS[entry.field] ?? entry.field}${entry.field === "level" ? ` ${entry.value}` : ""} not saved`)];
}

/**
 * Describes what happened to each pasted Showdown set, resolving ambiguities with their first choice.
 *
 * @param {object} catalog The game catalog.
 * @param {string} text The pasted text.
 * @returns {{sets: Array<{name: string, fields: object|null, errors: Array<string>, warnings: Array<string>}>, errors: Array<string>}}
 *          Each set with its values when it can be imported, and problems with the text as a whole.
 */
function resolveShowdownText(catalog, text)
{
    if (!text.trim())
        return { sets: [], errors: [] };

    const parsed = parseShowdownText(text);
    const sets = parsed.sets.map((set) =>
    {
        const result = resolveImportedSet(catalog, set, { hiddenPower: HIDDEN_POWER_OPTIMIZE });
        const warnings = getImportWarnings(result);
        const name = result.fields && catalog.species[result.fields.species] ? getSpeciesFormName(catalog, result.fields.species) : set.set?.species || "Unknown";
        return { name, fields: result.errors.length === 0 ? result.fields : null, errors: result.errors.map((error) => error.message), warnings };
    });

    return { sets, errors: parsed.errors.map((error) => error.message) };
}

/**
 * Chooses a spread set, grouped by file, with sets that cannot be chosen shown disabled with their reason.
 *
 * @component
 * @param {Object} props The props.
 * @param {Array<object>} props.sets The sets.
 * @param {string} props.value The chosen set ID, or an empty string.
 * @param {Function} props.onChange Called with the chosen set ID.
 * @param {Function} props.getProblem Returns why a set cannot be chosen, or nothing.
 * @param {string} [props.helperText] Text shown under the field.
 * @param {string} [props.size] The field size.
 * @returns {JSX.Element} The field.
 */
const SetPicker = ({ sets, value, onChange, getProblem, helperText = "", size = "medium" }) =>
{
    const options = useMemo(() => sets.map((set) => ({ ...set, label: getSetDisplayName(set), group: getFileLabel(set.file) })), [sets]);
    return (
        <Autocomplete size={size} data-advance-field="Spread Set" autoHighlight disableClearable={value !== ""} options={options} value={options.find((option) => option.id === value) ?? null}
                      groupBy={(option) => option.group} getOptionLabel={(option) => option.label} isOptionEqualToValue={(option, choice) => option.id === choice.id}
                      getOptionDisabled={(option) => option.id !== value && Boolean(getProblem(option))} onChange={(event, option) => onChange(option?.id ?? "")}
                      renderOption={(props, option) =>
                      {
                          const { key, ...optionProps } = props;
                          const problem = option.id !== value ? getProblem(option) : "";
                          return <li key={key} {...optionProps}>{option.label}{problem && <Typography variant="caption" sx={{ ml: 1 }}>{problem}</Typography>}</li>;
                      }}
                      renderInput={(params) => <TextField {...params} label="Spread Set" helperText={helperText} />} />
    );
};

/**
 * Chooses a destination set, then either a species for one new spread or Showdown text for any number of them.
 *
 * @component
 * @param {Object} props The props.
 * @param {Array<object>} props.sets The existing sets.
 * @param {string} props.defaultSetId The filtered set, when selected.
 * @param {string} [props.defaultSpecies] The only filtered species, when selected.
 * @param {object} props.catalog The game catalog.
 * @param {object} props.preview The preview level.
 * @param {Array<object>} props.teamTypes The doubles team types.
 * @param {Function} props.loadSmogonSets Loads Smogon sets through the editor session.
 * @param {Function} props.onAdd Creates one spread of a species.
 * @param {Function} props.onImport Creates spreads from imported values.
 * @param {Function} props.onClose Closes the dialog.
 * @returns {JSX.Element} The dialog.
 */
export const AddSpreadDialog = ({ sets, defaultSetId, defaultSpecies, catalog, preview, teamTypes, loadSmogonSets, onAdd, onImport, onClose }) =>
{
    const preferred = sets.find((set) => set.id === defaultSetId) ?? sets[0];
    const [setId, setSetId] = useState(preferred?.canInsert ? preferred.id : "");
    const [speciesOpen, setSpeciesOpen] = useState(false);
    const [tab, setTab] = useState(TAB_SPECIES);
    const [text, setText] = useState("");
    const [smogonOpen, setSmogonOpen] = useState(false);
    const deferredText = useDeferredValue(text);

    const selectedSet = sets.find((set) => set.id === setId) ?? null;
    const speciesOptions = useMemo(() => Object.entries(catalog.species).filter(([value]) =>
        value === SPECIES_ETERNAMAX ? selectedSet?.category === RAID_RUSH_CATEGORY : !isBattleOnlySpecies(catalog, value))
        .map(([value, info], index) => ({ value, name: getSpeciesFormName(catalog, value), info, index }))
        .sort((first, second) => first.name.localeCompare(second.name) || first.index - second.index), [catalog, selectedSet?.category]);
    const [species, setSpecies] = useState(() => speciesOptions.find((option) => option.value === defaultSpecies) ?? null);
    const imported = useMemo(() => resolveShowdownText(catalog, deferredText), [catalog, deferredText]);
    const ready = imported.sets.filter((set) => set.fields != null);
    const reported = imported.sets.map((set, index) => ({ ...set, number: index + 1 })).filter((set) => set.errors.length > 0 || set.warnings.length > 0);
    const hasImportErrors = reported.some((set) => set.errors.length > 0);
    const selectedSpecies = speciesOptions.find((option) => option.value === species?.value)?.info;
    const importLabel = ready.length === 1 ? "Import 1 Spread" : `Import ${ready.length} Spreads`;
    const canAddSpecies = Boolean(selectedSet?.canInsert && selectedSpecies);

    return (
        <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="add-spread-title" className="showdown-dialog">
            <DialogTitle id="add-spread-title">Add Spread</DialogTitle>
            <DialogContent dividers>
                <Stack spacing={2}>
                    <Tabs value={tab} onChange={(event, value) => setTab(value)} aria-label="How to add spreads" sx={FOCUS_TABS}>
                        <Tab value={TAB_SPECIES} label="Choose Species" />
                        <Tab value={TAB_IMPORT} label="Import Showdown Text" />
                    </Tabs>
                    <SetPicker sets={sets} value={setId} onChange={setSetId} getProblem={(set) => set.canInsert ? "" : set.insertBlockedReason}
                               helperText={!selectedSet && preferred && !preferred.canInsert ? preferred.insertBlockedReason : ""} />
                    {tab === TAB_SPECIES && <>
                        <Autocomplete autoHighlight options={speciesOptions} value={speciesOptions.find((option) => option.value === species?.value) ?? null}
                                      open={speciesOpen} onOpen={() => setSpeciesOpen(true)} onClose={() => setSpeciesOpen(false)}
                                      onKeyDown={(event) =>
                                      {
                                          // Enter picks a species, and Enter again once the list has closed adds it
                                          if (event.key === "Enter" && !speciesOpen && canAddSpecies)
                                          {
                                              event.preventDefault();
                                              onAdd(setId, species.value);
                                          }
                                      }}
                                      onChange={(event, option) => setSpecies(option)} getOptionLabel={(option) => option.name}
                                      isOptionEqualToValue={(option, choice) => option.value === choice.value} getOptionKey={(option) => option.value}
                                      renderOption={(props, option) =>
                                      {
                                          const { key, ...optionProps } = props;
                                          return <li key={key} {...optionProps}><Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                              <GameImage src={[option.info.icon, option.info.sprite?.normal, option.info.sprite?.fallback?.normal]} alt="" decorative width={SPECIES_ICON_SIZE} height={SPECIES_ICON_SIZE} />
                                              {option.name}</Box></li>;
                                      }} renderInput={(params) => <TextField {...params} label="Species" autoFocus />} />
                        {selectedSpecies && <Stack direction="row" spacing={2} sx={{ alignItems: "center" }} aria-label="Species preview">
                            <GameImage src={[selectedSpecies.sprite?.normal, selectedSpecies.sprite?.fallback?.normal]} alt={species.name} width={SPECIES_PREVIEW_SIZE} height={SPECIES_PREVIEW_SIZE} />
                            <Stack spacing={0.5}>
                                <Typography variant="subtitle2">{species.name}</Typography>
                                <Stack direction="row" spacing={0.5}>{[...new Set(selectedSpecies.types ?? [])].map((type) => <TypeIcon key={type} catalog={catalog} type={type} full />)}</Stack>
                                {selectedSpecies.baseStats &&
                                    <Typography variant="body2">Stats: {STATS.map((stat) => selectedSpecies.baseStats[stat] ?? "?").join("/")}</Typography>}
                                <Typography variant="body2">{getAbilityOptions(selectedSpecies).map((option) => getLabel(catalog.abilities, option.ability)).join(", ")}</Typography>
                            </Stack>
                        </Stack>}
                    </>}
                    {tab === TAB_IMPORT && <>
                        <TextField label="Showdown Text" multiline minRows={IMPORT_MIN_ROWS} maxRows={IMPORT_MAX_ROWS} value={text}
                                   onChange={(event) => setText(event.target.value)} placeholder={IMPORT_PLACEHOLDER}
                                   slotProps={{ htmlInput: { maxLength: MAX_SHOWDOWN_LENGTH, spellCheck: false } }} />
                        {imported.errors.map((error) => <Alert key={error} severity="error">{error}</Alert>)}
                        {reported.length > 0 &&
                            <Box>
                                <Typography component="h3" variant="subtitle1" id={IMPORT_PROBLEMS_TITLE_ID} className="import-preview-heading" sx={{ fontWeight: 600, borderTop: 1, borderColor: "divider" }}>
                                    {hasImportErrors ? <ErrorOutlineIcon color="error" /> : <WarningAmberIcon color="warning" />}
                                    {hasImportErrors ? "Import Problems" : "Import Warnings"}
                                </Typography>
                                <List dense aria-labelledby={IMPORT_PROBLEMS_TITLE_ID} className="import-preview">
                                    {reported.slice(0, MAX_PREVIEW_ITEMS).map((set) => (
                                        <ListItem key={set.number} disableGutters>
                                            <ListItemText primary={`${set.number}. ${set.name}${set.fields ? "" : " (Skipped)"}`}
                                                          secondary={<Box component="ul" className="import-preview-messages">
                                                              {set.errors.map((error, index) => <Typography component="li" variant="body2" color="error" key={`error-${index}`}>{error}</Typography>)}
                                                              {set.warnings.map((warning, index) => <Typography component="li" variant="body2" color="warning" key={`warning-${index}`}>{warning}</Typography>)}
                                                          </Box>}
                                                          slotProps={{ secondary: { component: "div" } }} />
                                        </ListItem>
                                    ))}
                                </List>
                            </Box>}
                    </>}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                {tab === TAB_SPECIES
                    ? <>
                        <Button startIcon={<TravelExploreIcon />} disabled={!canAddSpecies} onClick={() => setSmogonOpen(true)}>Smogon</Button>
                        <Button variant="contained" disabled={!canAddSpecies} onClick={() => onAdd(setId, species.value)}>Add</Button>
                    </>
                    : <Button variant="contained" disabled={!selectedSet?.canInsert || ready.length === 0}
                              onClick={() => onImport(setId, ready.map((set) => set.fields))}>{importLabel}</Button>}
            </DialogActions>
            {smogonOpen && <SmogonDialog catalog={catalog} species={species.value} set={selectedSet} preview={preview} teamTypes={teamTypes}
                                        loadSmogonSets={loadSmogonSets} multiple onClose={() => setSmogonOpen(false)}
                                        onAdd={(fieldsList) =>
                                        {
                                            setSmogonOpen(false);
                                            onImport(setId, fieldsList);
                                        }} />}
        </Dialog>
    );
};


/**
 * Shows the editable spread in a modal while its grid card remains in view mode.
 *
 * @component
 * @param {Object} props The component props.
 * @param {string} props.name The species name.
 * @param {Array<object>} props.sets The spread sets.
 * @param {string} props.setId The spread's set.
 * @param {Function} props.getSetProblem Returns why the spread cannot move into a set, or nothing.
 * @param {Function} props.onSetChange Moves the spread into another set.
 * @param {React.ReactNode} props.children The edit-mode card.
 * @param {Function} props.onClose Closes the editor without discarding drafts.
 * @param {boolean} [props.adding] Whether the spread is new and not added yet.
 * @param {Function|null} [props.onRevert] Reverts the spread's changes, or nothing when it has none to revert.
 * @param {React.ReactNode} [props.actions] Buttons that replace Done.
 * @param {Function} [props.onSubmit] Called when Enter is pressed and no field uses it, such as to add a new spread.
 * @returns {JSX.Element} The dialog.
 */
export const EditSpreadDialog = ({ name, sets, setId, getSetProblem, onSetChange, children, onClose, adding = false, onRevert = null, actions = null,
    onSubmit = null }) =>
{
    const theme = useTheme();
    const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));

    const dialogContentRef = React.useRef(null);

    /**
     * Focuses portaled content after mounting, starting new spreads at Move 1.
     *
     * @param {HTMLElement|null} element The dialog content.
     * @returns {void} Nothing.
     */
    const contentRef = useCallback((element) =>
    {
        dialogContentRef.current = element;
        const input = adding ? element?.querySelector(".move-picker input") : null;
        input?.focus();
        input?.select();
    }, [adding]);

    /**
     * Advances only committed inline choices, after their popup finishes handling the event.
     *
     * @param {React.SyntheticEvent} event The selection event.
     * @param {string} field The committed field label.
     * @returns {void} Nothing.
     */
    const advanceField = (event, field) =>
    {
        event?.preventDefault();
        event?.stopPropagation();
        queueMicrotask(() =>
        {
            const nextFields = EDIT_ADVANCE_FIELDS.slice(EDIT_ADVANCE_FIELDS.indexOf(field) + 1);
            const targets = [...(dialogContentRef.current?.querySelectorAll("[data-advance-field]") ?? [])];
            const next = nextFields.map((label) => targets.find((target) => target.dataset.advanceField === label)).find(Boolean);
            const input = next?.querySelector("input:not([aria-hidden='true']), [role='combobox']");
            input?.focus();
            input?.select?.();
        });
    };

    /**
     * Submits on Enter unless a field or button used it. Nested dialogs are portaled, so they are not inside this one.
     *
     * @param {React.KeyboardEvent} event The key press.
     */
    const handleKeyDown = (event) =>
    {
        if (onSubmit != null && event.key === KEY_ENTER && !event.defaultPrevented && event.currentTarget.contains(event.target)
            && event.target.closest("button, [role='button'], [role='option'], textarea") == null)
        {
            event.preventDefault();
            onSubmit();
        }
    };

    return (
        <Dialog open onClose={onClose} fullWidth maxWidth={false} fullScreen={fullScreen} aria-labelledby="edit-spread-title" onKeyDown={handleKeyDown}
                slotProps={{ paper: { sx: { maxWidth: fullScreen ? undefined : EDIT_DIALOG_MAX_WIDTH, "--theme": theme.palette.primary.main, "--focus": theme.palette.focus.main } } }}>
            <DialogTitle id="edit-spread-title">{adding ? "Add" : "Edit"} {name}</DialogTitle>
            {onRevert != null &&
                <Button size="small" variant="outlined" color="warning" startIcon={<UndoIcon />} aria-label={`Revert ${name}`} onClick={onRevert}
                        className="edit-spread-revert">Revert</Button>}
            <DialogContent dividers className="edit-spread-content" ref={contentRef}>
                {React.Children.map(children, (child) => React.isValidElement(child) ? React.cloneElement(child, { onFieldCommit: advanceField }) : child)}
                <div className="edit-spread-set">
                    <SetPicker size="small" sets={sets} value={setId} onChange={(id) => id !== setId && onSetChange(id)} getProblem={(set) => getSetProblem(set.id)} />
                </div>
            </DialogContent>
            <DialogActions>{actions ?? <Button variant="contained" color="focus" onClick={onClose}>Done</Button>}</DialogActions>
        </Dialog>
    );
};

/**
 * Asks before throwing away a new spread that has not been added yet.
 *
 * @component
 * @param {Object} props The props.
 * @param {string} props.name The species name.
 * @param {Function} props.onDiscard Throws the spread away.
 * @param {Function} props.onCancel Keeps editing it.
 * @returns {JSX.Element} The dialog.
 */
export const DiscardNewSpreadDialog = ({ name, onDiscard, onCancel }) =>
    <Dialog open onClose={onCancel} aria-labelledby="discard-new-spread-title">
        <DialogTitle id="discard-new-spread-title">Discard New {name}?</DialogTitle>
        <DialogContent>
            <DialogContentText>This {name} spread has not been added yet. Choose Add to keep it, or Discard to throw it away.</DialogContentText>
        </DialogContent>
        <DialogActions>
            <Button onClick={onCancel}>Keep Editing</Button>
            <Button color="error" onClick={onDiscard}>Discard</Button>
        </DialogActions>
    </Dialog>;

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
 * Shows spreads as Showdown text to copy or download, listing any spread that cannot be exported.
 *
 * @component
 * @param {Object} props - The component props
 * @param {string} props.title - The dialog title.
 * @param {object} props.catalog - The game catalog.
 * @param {Array<{id: string, label: string, fields: object, level: number}>} props.entries - The spreads, in order.
 * @param {Function} props.onClose - Closes the dialog.
 * @returns {JSX.Element} The dialog.
 */
export const ExportSpreadsDialog = ({ title, catalog, entries, onClose }) =>
{
    const results = useMemo(() => entries.map((entry) => ({ ...entry, ...exportSpread(catalog, entry.fields, { level: entry.level }) })), [catalog, entries]);
    const text = results.map((result) => result.text).filter(Boolean).join("\n\n");
    const placeholders = results.filter((result) => result.errors.some((error) => error.code === SHOWDOWN_PLACEHOLDER_ERROR));
    const skipped = results.filter((result) => result.errors.length > 0 && !result.errors.some((error) => error.code === SHOWDOWN_PLACEHOLDER_ERROR))
        .map((result) => ({ id: result.id, label: result.label, text: result.errors.map((error) => error.message).join(" ") }));
    const trimmed = results.filter((result) => result.text && result.warnings.length > 0)
        .map((result) => ({ id: result.id, label: result.label, text: result.warnings.map((warning) => warning.message).join(", ") }));

    /**
     * Copies the text to the clipboard.
     *
     * @returns {Promise<void>} Resolves once the copy finishes or fails.
     */
    const copy = async () =>
    {
        try
        {
            await navigator.clipboard.writeText(text);
            toast.success("Copied to the clipboard.");
        }
        catch
        {
            toast.error("The browser did not allow copying. Select the text and copy it instead.");
        }
    };

    /**
     * Saves the text as a file.
     */
    const download = () =>
    {
        const url = URL.createObjectURL(new Blob([text], { type: EXPORT_MIME_TYPE }));
        const link = document.createElement("a");
        link.href = url;
        link.download = EXPORT_FILE_NAME;
        link.click();
        URL.revokeObjectURL(url);
    };

    return (
        <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="export-spreads-title" className="showdown-dialog">
            <DialogTitle id="export-spreads-title">{title}</DialogTitle>
            <DialogContent dividers>
                <Stack spacing={2}>
                    <TextField label="Showdown Text" multiline minRows={IMPORT_MIN_ROWS} maxRows={IMPORT_MAX_ROWS} value={text} className="export-text"
                               slotProps={{ htmlInput: { readOnly: true, spellCheck: false, onClick: () => text && copy() } }} />
                    {placeholders.length > 0 &&
                        <Alert severity="warning">{placeholders.length === 1 ? "1 placeholder was left out" : `${placeholders.length} placeholders were left out`}</Alert>}
                    {skipped.length > 0 &&
                        <>
                            <Alert severity="warning">{skipped.length === 1 ? "1 spread was left out:" : `${skipped.length} spreads were left out:`}</Alert>
                            <PreviewList items={skipped} label="Spreads left out" />
                        </>}
                    {trimmed.length > 0 &&
                        <>
                            <Alert severity="info">{trimmed.length === 1 ? "1 spread was exported without some moves:" : `${trimmed.length} spreads were exported without some moves:`}</Alert>
                            <PreviewList items={trimmed} label="Spreads exported without some moves" />
                        </>}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Close</Button>
                <Button onClick={download} disabled={!text}>Download</Button>
                <Button variant="contained" color="focus" onClick={copy} disabled={!text}>Copy</Button>
            </DialogActions>
        </Dialog>
    );
};

/**
 * Returns a spread value as readable text.
 *
 * @param {object} catalog The game catalog.
 * @param {string} field The field.
 * @param {object} fields The spread holding the value.
 * @param {Array<object>} teamTypes The doubles team types.
 * @returns {string} The text.
 */
function formatFieldValue(catalog, field, fields, teamTypes)
{
    const value = fields[field];
    switch (field)
    {
        case "species":
            return getSpeciesFormName(catalog, value);
        case "nature":
        case "item":
        case "ball":
            return getLabel(catalog[FIELD_TABLES[field]], getFieldSymbol(fields, field));
        case "ability":
            return getLabel(catalog.abilities, getEffectiveAbility(catalog.species[fields.species], value) ?? String(value));
        case "moves":
            return value.filter((move) => move && move !== MOVE_NONE).map((move) => getLabel(catalog.moves, move)).join(", ") || NONE_LABEL;
        case TEAM_TYPE_FIELD:
        {
            const teamType = getTeamType(fields, teamTypes);
            return teamType != null ? getTeamTypeLabel(teamType) : String(value);
        }
        default:
            return typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
    }
}

/**
 * Reads one pasted Showdown set and works out how it would overwrite a spread.
 *
 * @param {object} catalog The game catalog.
 * @param {string} text The pasted text.
 * @param {object} fields The spread's current values.
 * @param {object} saved The spread's saved values.
 * @param {Array<object>} teamTypes The doubles team types.
 * @returns {{fields: object|null, differences: Array<object>, errors: Array<string>, warnings: Array<string>}} The result.
 */
function resolveOverwrite(catalog, text, fields, saved, teamTypes)
{
    const result = { fields: null, differences: [], errors: [], warnings: [] };
    if (!text.trim())
        return result;

    const parsed = parseShowdownText(text);
    result.errors = parsed.errors.map((error) => error.message);
    if (result.errors.length === 0 && parsed.sets.length !== 1)
        result.errors.push(`Paste exactly one set (found ${parsed.sets.length})`);
    if (result.errors.length > 0)
        return result;

    const resolved = resolveImportedSet(catalog, parsed.sets[0], { existingFields: fields, hiddenPower: HIDDEN_POWER_OPTIMIZE });
    result.errors = resolved.errors.map((error) => error.message);
    result.warnings = getImportWarnings(resolved);
    if (result.errors.length > 0)
        return result;

    const overwrite = applyOverwrite(catalog, fields, resolved.fields, { teamTypes, saved, ballProvided: Boolean(parsed.sets[0].set.pokeball) });
    result.fields = overwrite.fields;
    result.differences = overwrite.differences.map(({ field }) => ({ field, label: FIELD_LABELS[field] ?? field,
        before: formatFieldValue(catalog, field, fields, teamTypes), after: formatFieldValue(catalog, field, overwrite.fields, teamTypes) }));
    return result;
}

/**
 * Replaces one spread's values with a pasted Showdown set, previewing each change first.
 *
 * @component
 * @param {Object} props - The component props
 * @param {string} props.name - The spread's species name.
 * @param {object} props.catalog - The game catalog.
 * @param {object} props.fields - The spread's current values.
 * @param {object} props.saved - The spread's saved values.
 * @param {Array<object>} props.teamTypes - The doubles team types.
 * @param {number} props.level - The spread's level, for the current set shown as the placeholder.
 * @param {Function} props.onApply - Called with the new values.
 * @param {Function} props.onClose - Closes the dialog.
 * @returns {JSX.Element} The dialog.
 */
export const OverwriteSpreadDialog = ({ name, catalog, fields, saved, teamTypes, level, onApply, onClose }) =>
{
    const [text, setText] = useState("");
    const deferredText = useDeferredValue(text);
    const result = useMemo(() => resolveOverwrite(catalog, deferredText, fields, saved, teamTypes), [catalog, deferredText, fields, saved, teamTypes]);
    const placeholder = useMemo(() =>
    {
        const current = exportSpread(catalog, fields, { level });
        return current.errors.length === 0 ? current.text : IMPORT_PLACEHOLDER;
    }, [catalog, fields, level]);
    const unchanged = result.fields != null && result.differences.length === 0;

    return (
        <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="overwrite-spread-title" className="showdown-dialog">
            <DialogTitle id="overwrite-spread-title">Overwrite {name} From Showdown</DialogTitle>
            <DialogContent dividers>
                <Stack spacing={2}>
                    <TextField label="Showdown Text" multiline minRows={IMPORT_MIN_ROWS} maxRows={IMPORT_MAX_ROWS} value={text} autoFocus
                               onChange={(event) => setText(event.target.value)} placeholder={placeholder}
                               slotProps={{ htmlInput: { maxLength: MAX_SHOWDOWN_LENGTH, spellCheck: false } }} />
                    {result.errors.map((error) => <Alert key={error} severity="error">{error}</Alert>)}
                    {result.warnings.map((warning) => <Alert key={warning} severity="warning">{warning}</Alert>)}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Tooltip title={unchanged ? MATCHES_SPREAD : ""}><span>
                    <Button variant="contained" disabled={result.fields == null || unchanged} onClick={() => onApply(result.fields)}>Overwrite</Button>
                </span></Tooltip>
            </DialogActions>
        </Dialog>
    );
};

/**
 * Loads spread descriptions in batches on the scrolling list itself.
 *
 * @component
 * @param {object} props The component props.
 * @param {Array<{id: string, label: string, descriptions?: Array<string>, reason?: string}>} props.items The spreads.
 * @param {string} props.label The list's accessible name.
 * @returns {JSX.Element} The incremental list.
 */
const AutoFixList = ({ items, label }) =>
{
    const { count, onScroll } = useIncrementalList(items.length, items);

    return (
        <List dense disablePadding aria-label={label} className="auto-fix-list" onScroll={onScroll} tabIndex={0}>
            {items.slice(0, count).map((item) => (
                <ListItem key={item.id} disableGutters>
                    <ListItemText primary={item.label} secondary={
                        <ul className="auto-fix-descriptions">
                            {(item.descriptions ?? [item.reason]).map((description, index) => <li key={index}>{description}</li>)}
                        </ul>}
                                  slotProps={{ secondary: { component: "div" } }} />
                </ListItem>
            ))}
        </List>
    );
};

/**
 * The preview shown before auto-fixing spreads' moves, IVs and EVs.
 *
 * @component
 * @param {Object} props - The component props
 * @param {boolean} props.open - Whether the dialog is open.
 * @param {Array<{id: string, label: string, descriptions: {moves: Array<string>, ivs: Array<string>, evs: Array<string>}}>} props.changes The categorized changes.
 * @param {object} [props.categoryChanges] Independent previews keyed by category.
 * @param {Array<{id: string, label: string, descriptions: Array<string>}>} props.skipped - The spreads with stats left alone.
 * @param {object} [props.categorySkipped] Independent skipped-stat lists keyed by category.
 * @param {Array<{id: string, label: string, reason: string}>} props.locked - Matching spreads that cannot be changed and why.
 * @param {Function} props.onApply Applies the selected category's changes.
 * @param {Function} props.onClose - Closes without changing anything.
 * @returns {JSX.Element} The dialog.
 */
export const AutoFixDialog = ({ open, changes, skipped, locked, onApply, onClose, categoryChanges = null, categorySkipped = null }) =>
{
    const [helpOpen, setHelpOpen] = useState(false);
    const [tab, setTab] = useState(AUTO_FIX_ALL);
    const lists = useMemo(() => Object.fromEntries(
        [AUTO_FIX_ALL, ...AUTO_FIX_CATEGORIES.map((category) => category.value)].map((category) =>
        [
            category,
            (categoryChanges?.[category] ?? changes).map((item) => (
            {
                ...item,
                descriptions: category === AUTO_FIX_ALL ? AUTO_FIX_CATEGORIES.flatMap(({ value }) => item.descriptions[value] ?? [])
                    : item.descriptions[category] ?? [],
            })).filter((item) => item.descriptions.length > 0),
        ])), [changes, categoryChanges]);
    const visible = lists[tab];
    const visibleSkipped = categorySkipped?.[tab] ?? skipped;
    const hasChanges = Object.values(lists).some((items) => items.length > 0);

    /**
        * Selects the preview and the category applied on confirmation.
     *
     * @param {object} event The tab selection event.
     * @param {string} value The category key.
     * @returns {void} Updates the preview category.
     */
    const changeTab = (event, value) =>
    {
        setTab(value);
    };

    /**
     * Opens the help on hover, focus or click.
     *
     * @returns {void} Shows the detailed rules.
     */
    const openHelp = () =>
    {
        setHelpOpen(true);
    };

    /**
     * Closes the help when hover or focus leaves, or Escape is pressed.
     *
     * @returns {void} Hides the detailed rules.
     */
    const closeHelp = () =>
    {
        setHelpOpen(false);
    };

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="auto-fix-title" className="auto-fix-dialog">
            <DialogTitle id="auto-fix-title">Auto-Fix Spreads</DialogTitle>
            <DialogContent dividers className="auto-fix-content">
                <DialogContentText>
                    {AUTO_FIX_DESCRIPTION}
                    <Tooltip open={helpOpen} onOpen={openHelp} onClose={closeHelp}
                             title={<Box component="ul" sx={{ m: 0, pl: 2 }}>{AUTO_FIX_HELP_LINES.map((line) => <li key={line}>{line}</li>)}</Box>}
                             slotProps={{ tooltip: { sx: { maxWidth: AUTO_FIX_HELP_MAX_WIDTH } } }}>
                        <IconButton size="small" aria-label={AUTO_FIX_HELP_LABEL} onClick={openHelp} onFocus={openHelp} onBlur={closeHelp}>
                            <HelpOutlineIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </DialogContentText>
                {!hasChanges
                    ? <Alert severity="info" sx={{ mt: 2 }}>No matching spread needs fixing.</Alert>
                    : <>
                        <Tabs value={tab} onChange={changeTab} aria-label="Auto-Fix Categories" sx={FOCUS_TABS}
                              variant="scrollable" scrollButtons="auto" className="auto-fix-tabs">
                            <Tab value={AUTO_FIX_ALL} label={`All (${lists[AUTO_FIX_ALL].length})`} id={`auto-fix-tab-${AUTO_FIX_ALL}`} aria-controls={AUTO_FIX_PANEL_ID} />
                            {AUTO_FIX_CATEGORIES.filter(({ value }) => lists[value].length > 0 || value === tab).map(({ value, label }) =>
                                <Tab key={value} value={value} label={`${label} (${lists[value].length})`} id={`auto-fix-tab-${value}`} aria-controls={AUTO_FIX_PANEL_ID} />)}
                        </Tabs>
                        <Box role="tabpanel" id={AUTO_FIX_PANEL_ID} aria-labelledby={`auto-fix-tab-${tab}`}>
                            <Typography variant="subtitle2" sx={{ mt: 2 }}>{visible.length} spreads will change</Typography>
                            <AutoFixList key={tab} items={visible} label="Spreads that will change" />
                        </Box>
                    </>}
                {visibleSkipped.length > 0 &&
                    <>
                        <Typography variant="subtitle2" sx={{ mt: 2 }}>{visibleSkipped.length} spreads have stats left alone</Typography>
                        <AutoFixList items={visibleSkipped} label="Spreads left alone" />
                    </>}
                {locked.length > 0 &&
                    <Accordion sx={{ mt: 2 }} slotProps={{ transition: { unmountOnExit: true } }}>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />} aria-controls="auto-fix-locked-details" id="auto-fix-locked-summary">
                            <Typography>{locked.length === 1 ? "1 matching spread cannot" : `${locked.length} matching spreads cannot`} be changed safely</Typography>
                        </AccordionSummary>
                        <AccordionDetails id="auto-fix-locked-details">
                            <Alert severity="warning">{AUTO_FIX_LOCKED_EXPLANATION}</Alert>
                            <AutoFixList items={locked} label="Spreads that cannot be changed" />
                        </AccordionDetails>
                    </Accordion>}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" onClick={() => onApply(tab)} disabled={visible.length === 0}>{AUTO_FIX_APPLY_LABELS[tab]}</Button>
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
