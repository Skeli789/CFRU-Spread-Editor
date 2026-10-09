/**
 * This file defines the move editor. Each move slot has an autocomplete offering the moves the species can learn,
 * and the Choose Moves dialog edits all four slots from one list of every game move, learnable moves first, which
 * can be searched, filtered by type, category and target and sorted by any column.
 */

import React, { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import
{
    Alert, Autocomplete, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, Stack,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel, TextField, Tooltip, Typography,
} from "@mui/material";
import ClearIcon from "@mui/icons-material/Clear";
import TuneIcon from "@mui/icons-material/Tune";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import { alpha } from "@mui/material/styles";
import { DragDropProvider, useDraggable, useDroppable } from "@dnd-kit/react";
import { closestCenter } from "@dnd-kit/collision";

import { LEARNSET_COMPLETE, LEGALITY, POWER_KIND, alwaysHits, getMoveLegality, getPowerKind } from "../../shared/catalog.mjs";
import { HIDDEN_POWER_TYPES, MOVE_HIDDEN_POWER, getHiddenPowerType } from "../../shared/pokemon-mechanics.mjs";
import { MAX_MOVES } from "../../shared/spread-model.mjs";
import { AdvancedPaper, SplitIcon, TypeIcon, filterBySearch, getEntry, getLabel, getSearchRank, scrollToEntry, useIncrementalList } from "./CatalogDisplay";

const SORT_ASCENDING = "asc";
const SORT_DESCENDING = "desc";
const HIDDEN_POWER_KEY_SEPARATOR = ":";
const MOVE_NONE = "MOVE_NONE";
const MOVE_STRUGGLE = "MOVE_STRUGGLE";
const EMPTY_MOVE = 0;
const TARGET_PREFIX = "MOVE_TARGET_";
const TARGET_BOTH = "MOVE_TARGET_BOTH";
const SPLIT_STATUS = "SPLIT_STATUS";
const SPLIT_LABELS = { SPLIT_PHYSICAL: "Physical", SPLIT_SPECIAL: "Special", [SPLIT_STATUS]: "Status" };
const VARIABLE_POWER_LABEL = "Varies";
const NO_POWER_LABEL = "-";
const UNKNOWN_LABEL = "?";
const DIALOG_TITLE = "Choose Moves";
const OTHER_POWERS_LABEL = "Other Powers";
const FILTER_WIDTHS = { Type: 170, Category: 185, Target: 215 };
const DUPLICATE_MOVE_LABEL = "Duplicate move";
const EMPTY_SLOT_LABEL = "None";
const KEY_ENTER = "Enter";
const KEY_DOWN = "ArrowDown";
const KEY_UP = "ArrowUp";
const KEY_END = "End";
const KEY_HOME = "Home";
const DRAG_MOVE = "moveSlot";
const SELECTED_MOVE_COLORS = { light: "#8e44ad", dark: "#c58bf5" };
const SELECTED_MOVE_OPACITY = 0.18;
const SELECTED_MOVE_HOVER_OPACITY = 0.27;

// The slot the list fills looks focused, in the theme's focus color
const ACTIVE_SLOT_STYLE = { "& .MuiOutlinedInput-notchedOutline": { borderColor: "focus.main", borderWidth: 2 } };

// Sort values placing moves with no damage before variable power, and always-hitting moves above 100%
const NO_POWER_SORT = 0;
const VARIABLE_POWER_SORT = 0.5;
const ALWAYS_HITS_SORT = 101;

// Z-Move and Max Move powers are extra columns shown together
const Z_MOVE_POWER = "zMovePower";
const MAX_MOVE_POWER = "maxMovePower";
const POWER_COLUMNS = new Set(["power", Z_MOVE_POWER, MAX_MOVE_POWER]);
const COLUMNS =
[
    { key: "name", label: "Name" },
    { key: "type", label: "Type" },
    { key: "split", label: "Category" },
    { key: "power", label: "Power", numeric: true },
    { key: Z_MOVE_POWER, label: "Z-Power", numeric: true },
    { key: MAX_MOVE_POWER, label: "Max Power", numeric: true },
    { key: "accuracy", label: "Accuracy", numeric: true },
    { key: "pp", label: "PP", numeric: true },
    { key: "target", label: "Target" },
];

const optionCache = new WeakMap();


/**
 * Returns a move target's readable name, such as Both Foes for MOVE_TARGET_BOTH.
 *
 * @param {string} target The MOVE_TARGET_* constant.
 * @returns {string} The name.
 */
function getTargetLabel(target)
{
    if (target === TARGET_BOTH)
        return "Both Foes";

    return target.replace(TARGET_PREFIX, "").toLowerCase().split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

/**
 * Returns a move's power as shown in the editor.
 *
 * @param {object} option The move option.
 * @returns {string} The power.
 */
export function formatPower(option)
{
    if (option.split === SPLIT_STATUS)
        return NO_POWER_LABEL;

    switch (getPowerKind(option))
    {
        case POWER_KIND.UNKNOWN:
            return UNKNOWN_LABEL;
        case POWER_KIND.NONE:
            return NO_POWER_LABEL;
        case POWER_KIND.VARIABLE:
            return VARIABLE_POWER_LABEL;
        default:
            return String(option.power);
    }
}

/**
 * Returns a move's Z-Move or Max Move power, which status moves do not have.
 *
 * @param {object} option The move option.
 * @param {string} key zMovePower or maxMovePower.
 * @returns {number|null} The power, 0 when there is none, or null when it is unknown.
 */
function getBoostedPower(option, key)
{
    const value = option[key];
    if (value == null)
        return null;

    return option.split === SPLIT_STATUS ? 0 : value;
}

/**
 * Returns a move's Z-Move or Max Move power as shown in the editor.
 *
 * @param {object} option The move option.
 * @param {string} key zMovePower or maxMovePower.
 * @returns {string} The power.
 */
export function formatBoostedPower(option, key)
{
    if (option.split === SPLIT_STATUS)
        return NO_POWER_LABEL;

    const value = getBoostedPower(option, key);
    if (value == null)
        return UNKNOWN_LABEL;

    return value === 0 ? NO_POWER_LABEL : String(value);
}

/**
 * Returns a move's accuracy as shown in the editor.
 *
 * @param {object} option The move option.
 * @returns {string} The accuracy.
 */
export function formatAccuracy(option)
{
    if (option.accuracy == null)
        return UNKNOWN_LABEL;

    return alwaysHits(option) ? NO_POWER_LABEL : `${option.accuracy}%`;
}

/**
 * Returns the value a column sorts by, with null for unknown values.
 *
 * @param {object} option The move option.
 * @param {string} key The column key.
 * @param {object} catalog The game catalog.
 * @returns {string|number|null} The sort value.
 */
function getSortValue(option, key, catalog)
{
    switch (key)
    {
        case "type":
            return option.type == null ? null : getLabel(catalog.types, option.type);
        case "split":
            return option.split == null ? null : SPLIT_LABELS[option.split] ?? option.split;
        case "power":
        {
            const kind = getPowerKind(option);
            if (kind === POWER_KIND.UNKNOWN)
                return null;
            return kind === POWER_KIND.NONE ? NO_POWER_SORT : kind === POWER_KIND.VARIABLE ? VARIABLE_POWER_SORT : option.power;
        }
        case Z_MOVE_POWER:
        case MAX_MOVE_POWER:
            return getBoostedPower(option, key);
        case "accuracy":
            return option.accuracy == null ? null : alwaysHits(option) ? ALWAYS_HITS_SORT : option.accuracy;
        case "pp":
            return option.pp;
        case "target":
            return option.target == null ? null : getTargetLabel(option.target);
        default:
            return option.name;
    }
}

/**
 * Returns every move in the game as an option, with Hidden Power split into one option per type.
 *
 * @param {object} catalog The game catalog.
 * @returns {Array<object>} The options, sorted by name.
 */
export function getMoveOptions(catalog)
{
    if (optionCache.has(catalog))
        return optionCache.get(catalog);

    const options = [];
    for (const [move, details] of Object.entries(catalog.moves))
    {
        if (move === MOVE_STRUGGLE)
            continue;

        if (move !== MOVE_HIDDEN_POWER)
        {
            options.push({ ...details, key: move, move, hiddenPowerType: null });
            continue;
        }

        for (const type of HIDDEN_POWER_TYPES)
            options.push({ ...details, key: `${move}${HIDDEN_POWER_KEY_SEPARATOR}${type}`, move, hiddenPowerType: type, type, name: `${details.name} [${getLabel(catalog.types, type)}]` });
    }

    options.sort((a, b) => a.name.localeCompare(b.name));
    optionCache.set(catalog, options);
    return options;
}

/**
 * Returns the moves a species can learn. When its learnset is missing, every move is offered.
 *
 * @param {object} catalog The game catalog.
 * @param {string} species The SPECIES_* constant.
 * @returns {{options: Array<object>, complete: boolean}} The options and whether the learnset is known.
 */
export function getLearnableMoveOptions(catalog, species)
{
    const learnset = getEntry(catalog.learnsets, species);
    if (learnset?.status !== LEARNSET_COMPLETE)
        return { options: getMoveOptions(catalog), complete: false };

    const options = getMoveOptions(catalog).filter((option) => Object.hasOwn(learnset.moves, option.move) || Object.hasOwn(learnset.unknown, option.move));
    return { options, complete: true };
}

/**
 * Returns the option shown for a move slot's value.
 *
 * @param {object} catalog The game catalog.
 * @param {object} fields The spread's values, which decide Hidden Power's type.
 * @param {string|number} move The slot's MOVE_* constant, or 0.
 * @returns {object|null} The option, or null for an empty slot.
 */
export function getMoveOption(catalog, fields, move)
{
    if (move === EMPTY_MOVE || move === MOVE_NONE)
        return null;

    const key = move === MOVE_HIDDEN_POWER ? `${move}${HIDDEN_POWER_KEY_SEPARATOR}${getHiddenPowerType(fields)}` : move;
    return getMoveOptions(catalog).find((option) => option.key === key)
        ?? { key: String(move), move, hiddenPowerType: null, name: String(move), type: null, split: null, power: null, accuracy: null, pp: null, target: null };
}

/**
 * Returns the chooser's matching learnable moves, searched learnable moves excluded by filters, then the rest. Each part
 * lists moves starting with the search before those only containing it, then follows the chosen column.
 *
 * @param {object} catalog The game catalog.
 * @param {{options: Array<object>}} learnable The learnable moves.
 * @param {object} filters The search text, the type, split and target or null for any, and the sort.
 * @returns {Array<{option: object, learnable: boolean, filteredOut: boolean}>} The moves.
 */
export function getChooserRows(catalog, learnable, { search, type, split, target, sort })
{
    const learnableKeys = new Set(learnable.options.map((option) => option.key));
    const direction = sort.direction === SORT_ASCENDING ? 1 : -1;
    const rows = [];
    for (const option of getMoveOptions(catalog))
    {
        const rank = getSearchRank(option.name, search);
        if (rank == null)
            continue;

        const canLearn = learnableKeys.has(option.key);
        const filteredOut = (type != null && option.type !== type) || (split != null && option.split !== split) || (target != null && option.target !== target);
        if (filteredOut && (!canLearn || search.trim() === ""))
            continue;

        rows.push({ option, learnable: canLearn, filteredOut, rank, value: getSortValue(option, sort.key, catalog) });
    }

    // Unknown values sort last in both directions, and equal values stay in name order
    rows.sort((a, b) =>
    {
        const group = b.learnable - a.learnable || a.filteredOut - b.filteredOut || a.rank - b.rank;
        if (group !== 0)
            return group;
        if (a.value == null || b.value == null)
            return (a.value == null) - (b.value == null) || a.option.name.localeCompare(b.option.name);

        const difference = typeof a.value === "string" ? a.value.localeCompare(b.value) : a.value - b.value;
        return difference * direction || a.option.name.localeCompare(b.option.name);
    });

    return rows.map((row) => ({ option: row.option, learnable: row.learnable, filteredOut: row.filteredOut }));
}

/**
 * A searchable filter in the Choose Moves dialog.
 *
 * @component
 * @param {Object} props - The component props
 * @param {string} props.label - The label.
 * @param {string|null} props.value - The chosen value, or null for all.
 * @param {Array<{value: string, name: string}>} props.options - The choices.
 * @param {Function} props.onChange - Called with the new value or null.
 * @param {Function} [props.renderIcon] - Returns an icon for an option.
 * @returns {JSX.Element} The filter.
 */
const ChooserFilter = ({ label, value, options, onChange, renderIcon }) =>
{
    const selected = options.find((option) => option.value === value) ?? null;
    return (
        <Autocomplete
            size="small"
            className="chooser-filter"
            sx={{ width: FILTER_WIDTHS[label] ?? 140 }}
            options={options}
            value={selected}
            onChange={(event, option) => onChange(option?.value ?? null)}
            getOptionLabel={(option) => option.name}
            isOptionEqualToValue={(option, selected) => option.value === selected.value}
            getOptionKey={(option) => option.value}
            renderOption={(props, option) =>
            {
                const { key, ...optionProps } = props;
                return (
                    <li key={key} {...optionProps} className={`${optionProps.className} option-with-icon`}>
                        {renderIcon?.(option)}
                        {option.name}
                    </li>
                );
            }}
            renderInput={(params) => <TextField {...params} label={label} slotProps={{ ...params.slotProps, input: { ...params.slotProps.input,
                startAdornment: selected != null ? renderIcon?.(selected) : null } }} />}
        />
    );
};

/**
 * Returns the move table's row styles, set once on the table instead of on every row.
 *
 * @param {object} theme The theme.
 * @returns {object} The styles.
 */
function getMoveTableStyles(theme)
{
    const chosen = SELECTED_MOVE_COLORS[theme.palette.mode];
    return {
        "& .move-row-chosen, & .move-row-chosen.Mui-selected": { backgroundColor: alpha(chosen, SELECTED_MOVE_OPACITY), boxShadow: `inset 4px 0 ${chosen}` },
        "& .move-row-chosen:hover, & .move-row-chosen.Mui-selected:hover": { backgroundColor: alpha(chosen, SELECTED_MOVE_HOVER_OPACITY) },
        "& .move-row-highlighted": { outline: `2px solid ${theme.palette.focus?.main ?? theme.palette.primary.main}`, outlineOffset: -2 },
    };
}

/**
 * Returns a move table cell's contents.
 *
 * @param {object} catalog The game catalog.
 * @param {object} option The move option.
 * @param {string} key The column key.
 * @param {Function} onChoose Called with the option when its name is clicked.
 * @returns {React.ReactNode} The contents.
 */
function renderMoveCell(catalog, option, key, onChoose)
{
    switch (key)
    {
        case "name":
            return (
                <Button size="small" color="inherit" className="move-table-select" disableRipple onClick={(event) =>
                {
                    event.stopPropagation();
                    onChoose(option);
                }}>
                    {option.name}
                </Button>
            );
        case "type":
            return <TypeIcon catalog={catalog} type={option.type} full />;
        case "split":
            return <SplitIcon split={option.split} />;
        case "power":
            return formatPower(option);
        case Z_MOVE_POWER:
        case MAX_MOVE_POWER:
            return formatBoostedPower(option, key);
        case "accuracy":
            return formatAccuracy(option);
        case "pp":
            return option.pp ?? UNKNOWN_LABEL;
        default:
            return option.target == null ? UNKNOWN_LABEL : getTargetLabel(option.target);
    }
}

/**
 * One move in the Choose Moves table. Only rows whose state changes re-render, which keeps arrow keys quick.
 *
 * @component
 * @param {Object} props - The component props
 * @param {object} props.option - The move option.
 * @param {object} props.catalog - The game catalog.
 * @param {Array<object>} props.columns - The shown columns.
 * @param {boolean} props.highlighted - Whether the keyboard highlight is on it.
 * @param {boolean} props.active - Whether it is the active slot's move.
 * @param {boolean} props.chosen - Whether any slot has it.
 * @param {boolean} props.illegal - Whether the species cannot learn it.
 * @param {Function} props.onChoose - Called with the option when it is clicked.
 * @returns {JSX.Element} The row.
 */
const MoveRow = memo(({ option, catalog, columns, highlighted, active, chosen, illegal, onChoose }) =>
{
    return (
        <TableRow hover selected={active} data-move-key={option.key} data-highlighted={highlighted ? "true" : undefined}
                  className={`move-table-row${illegal ? " move-illegal" : ""}${chosen ? " move-row-chosen" : ""}${highlighted ? " move-row-highlighted" : ""}`}
                  onClick={() => onChoose(option)}>
            {columns.map((column) => (
                <TableCell key={column.key} align={column.numeric ? "right" : "left"}>{renderMoveCell(catalog, option, column.key, onChoose)}</TableCell>
            ))}
        </TableRow>
    );
});

/**
 * The Choose Moves dialog's slots, search, filters and table, which only exist while the dialog is open.
 *
 * @component
 * @param {Object} props - The component props
 * @param {object} props.catalog - The game catalog.
 * @param {object} props.fields - The spread's values.
 * @param {number} props.initialSlot - The slot chosen first.
 * @param {Function} props.onChange - Called with the slot, the MOVE_* constant or null, and the Hidden Power type.
 * @param {Function} props.onClose - Closes the dialog.
 * @returns {JSX.Element} The dialog content.
 */
const MoveChooserContent = ({ catalog, fields, initialSlot, onChange, onClose }) =>
{
    const [activeSlot, setActiveSlot] = useState(initialSlot);
    // Null until the user types, so the active slot shows its move and the list stays unfiltered
    const [typed, setTyped] = useState(null);
    const [selectRequest, setSelectRequest] = useState(0);
    const [type, setType] = useState(null);
    const [split, setSplit] = useState(null);
    const [target, setTarget] = useState(null);
    const [showOtherPowers, setShowOtherPowers] = useState(false);
    const [sort, setSort] = useState({ key: "name", direction: SORT_ASCENDING });
    const [highlight, setHighlight] = useState({ key: "", index: 0 });
    const [scrollTarget, setScrollTarget] = useState(() => getMoveOption(catalog, fields, fields.moves[initialSlot])?.key ?? null);
    const slotRefs = useRef([]);
    const tableRef = useRef(null);
    const search = typed ?? "";
    const learnable = useMemo(() => getLearnableMoveOptions(catalog, fields.species), [catalog, fields.species]);
    const rows = useMemo(() => getChooserRows(catalog, learnable, { search, type, split, target, sort }), [catalog, learnable, search, type, split, target, sort]);
    const list = useIncrementalList(rows.length, JSON.stringify([search, type, split, target, sort]));
    const highlightKey = JSON.stringify([search, type, split, target, sort]);
    const navKey = `${highlightKey}${activeSlot}`;
    const activeKey = getMoveOption(catalog, fields, fields.moves[activeSlot])?.key ?? null;
    const activeIndex = typed == null && activeKey != null ? Math.max(0, rows.findIndex((row) => row.option.key === activeKey)) : 0;
    const highlightedIndex = highlight.key === navKey ? Math.min(highlight.index, Math.max(0, rows.length - 1)) : activeIndex;
    const shownRows = rows.slice(0, list.count);
    const selectedKeys = new Set(fields.moves.map((move) => getMoveOption(catalog, fields, move)?.key).filter((key) => key != null));

    const options = useMemo(() =>
    {
        const moves = Object.values(catalog.moves);
        return {
            types: Object.entries(catalog.types).map(([value, entry]) => ({ value, name: entry.name })),
            splits: Object.entries(SPLIT_LABELS).map(([value, name]) => ({ value, name })),
            targets: [...new Set(moves.map((move) => move.target).filter((value) => value != null))].sort().map((value) => ({ value, name: getTargetLabel(value) })),
        };
    }, [catalog]);
    const statusOnly = split === SPLIT_STATUS;
    const columns = useMemo(() => COLUMNS.filter((column) => (statusOnly
        ? !POWER_COLUMNS.has(column.key)
        : (column.key !== Z_MOVE_POWER && column.key !== MAX_MOVE_POWER) || showOtherPowers)), [statusOnly, showOtherPowers]);
    const speciesName = getLabel(catalog.species, fields.species);

    /**
     * Starts a changed search or filter at the first result.
     */
    useEffect(() =>
    {
        if (tableRef.current != null)
            tableRef.current.scrollTop = 0;
    }, [highlightKey]);

    /**
     * Scrolls the active slot's move into view, first showing enough of the list to include it.
     */
    useEffect(() =>
    {
        if (scrollTarget == null)
            return;

        const index = rows.findIndex((row) => row.option.key === scrollTarget);
        if (index >= list.count)
        {
            list.showAtLeast(index);
            return;
        }

        const row = [...(tableRef.current?.querySelectorAll("[data-move-key]") ?? [])].find((element) => element.dataset.moveKey === scrollTarget);
        scrollToEntry(tableRef.current, row);
        setScrollTarget(null);
    }, [scrollTarget, rows, list]);

    /**
     * Keeps the keyboard highlight visible without moving the dialog itself.
     */
    useEffect(() =>
    {
        if (highlight.key !== navKey || highlightedIndex >= list.count)
            return;

        const row = tableRef.current?.querySelector('[data-highlighted="true"]');
        scrollToEntry(tableRef.current, row);
    }, [highlight, navKey, highlightedIndex, list.count]);

    /**
     * Focuses the active slot with its text selected, so typing replaces it.
     */
    const focusSearch = () => setSelectRequest((count) => count + 1);

    /**
     * Makes a slot the one the list fills, and shows its move in the list.
     *
     * @param {number} slot The slot.
     */
    const activate = (slot) =>
    {
        setActiveSlot(slot);
        setTyped(null);
        const option = getMoveOption(catalog, fields, fields.moves[slot]);
        setScrollTarget(option?.key ?? null);
        if (option == null && tableRef.current != null)
            tableRef.current.scrollTop = 0;
    };

    /**
     * Fills the active slot with a move, then moves on to the next slot.
     *
     * @param {object} option The move option.
     */
    const choose = (option) =>
    {
        if (option.key !== activeKey)
            onChange(activeSlot, option.move, option.hiddenPowerType);
        if (activeSlot < MAX_MOVES - 1)
            activate(activeSlot + 1);
        else
            setTyped(null);
        focusSearch();
    };

    // Rows keep one handler, so choosing never re-renders every row
    const chooseRef = useRef(choose);
    chooseRef.current = choose;
    const chooseOption = useCallback((option) => chooseRef.current(option), []);

    /**
     * Selects the active slot's text after React updates the controlled input.
     */
    useEffect(() =>
    {
        slotRefs.current[activeSlot]?.focus();
        slotRefs.current[activeSlot]?.select();
    }, [activeSlot, selectRequest]);

    /**
     * Selects or navigates rows from the active slot. The highlight starts on the slot's move, so Enter without typing
     * keeps it and moves on.
     *
     * @param {React.KeyboardEvent} event The key event.
     */
    const handleSearchKeyDown = (event) =>
    {
        if (event.key === KEY_ENTER)
        {
            event.preventDefault();
            if (rows.length > 0)
                choose(rows[highlightedIndex].option);
        }
        else if ([KEY_DOWN, KEY_UP, KEY_END, KEY_HOME].includes(event.key) && rows.length > 0)
        {
            event.preventDefault();
            const next = event.key === KEY_END ? rows.length - 1 : event.key === KEY_HOME ? 0
                : Math.max(0, Math.min(rows.length - 1, highlightedIndex + (event.key === KEY_DOWN ? 1 : -1)));
            setScrollTarget(null);
            setHighlight({ key: navKey, index: next });
            list.showAtLeast(next);
        }
    };

    /**
     * Resets every chooser filter and the optional columns.
     */
    const clearFilters = () =>
    {
        setTyped(null);
        setType(null);
        setSplit(null);
        setTarget(null);
        setShowOtherPowers(false);
        focusSearch();
    };

    /**
     * Makes a slot active when it gains focus.
     *
     * @param {number} slot The slot.
     */
    const pickSlot = (slot) =>
    {
        if (slot !== activeSlot)
            activate(slot);
    };

    /**
     * Sorts by a column, reversing the order when it is already sorted by it.
     *
     * @param {string} key The column key.
     */
    const handleSort = (key) =>
    {
        setSort((current) => ({ key, direction: current.key === key && current.direction === SORT_ASCENDING ? SORT_DESCENDING : SORT_ASCENDING }));
    };


    return (
        <>
            <DialogContent dividers>
                <Stack spacing={1.5} className="chooser-body">
                    <div className="move-slot-fields" role="group" aria-label="Move slots">
                        {Array.from({ length: MAX_MOVES }, (_, slot) =>
                        {
                            const option = getMoveOption(catalog, fields, fields.moves[slot]);
                            const label = `Move ${slot + 1}`;
                            const active = slot === activeSlot;
                            const text = active && typed != null ? typed : option?.name ?? "";
                            return (
                                <TextField
                                    key={slot}
                                    size="small"
                                    label={label}
                                    value={text}
                                    placeholder={EMPTY_SLOT_LABEL}
                                    className="move-slot-field"
                                    sx={active ? ACTIVE_SLOT_STYLE : undefined}
                                    inputRef={(element) => { slotRefs.current[slot] = element; }}
                                    onFocus={() => pickSlot(slot)}
                                    onChange={(event) =>
                                    {
                                        pickSlot(slot);
                                        setTyped(event.target.value);
                                    }}
                                    onKeyDown={handleSearchKeyDown}
                                    slotProps={{
                                        htmlInput: { "aria-current": active ? "true" : undefined },
                                        inputLabel: { shrink: true },
                                        input:
                                        {
                                            startAdornment: option != null && !(active && typed != null)
                                                ? <span className="move-slot-type"><TypeIcon catalog={catalog} type={option.type} decorative /></span> : null,
                                            endAdornment: text !== ""
                                                ? <IconButton size="small" aria-label={`Clear ${label}`} onClick={(event) =>
                                                {
                                                    event.stopPropagation();
                                                    onChange(slot, null, null);
                                                    if (active)
                                                        setTyped(null);
                                                    if (tableRef.current != null)
                                                        tableRef.current.scrollTop = 0;
                                                    slotRefs.current[slot]?.focus();
                                                }}>
                                                    <ClearIcon fontSize="small" />
                                                </IconButton>
                                                : null,
                                        },
                                    }}
                                />
                            );
                        })}
                    </div>
                    {!learnable.complete &&
                        <Alert severity="info">This species has no known learnset, so every move is listed as learnable.</Alert>}
                    <div className="chooser-filters">
                        <ChooserFilter label="Type" value={type} options={options.types} onChange={setType}
                                       renderIcon={(option) => <TypeIcon catalog={catalog} type={option.value} decorative />} />
                        <ChooserFilter label="Category" value={split} options={options.splits} onChange={setSplit}
                                       renderIcon={(option) => <SplitIcon split={option.value} decorative />} />
                        <ChooserFilter label="Target" value={target} options={options.targets} onChange={setTarget} />
                        <FormControlLabel label={OTHER_POWERS_LABEL} disabled={statusOnly}
                                          control={<Checkbox size="small" checked={showOtherPowers} onChange={(event) => setShowOtherPowers(event.target.checked)} />} />
                        <Button size="small" className="chooser-clear-filters" onClick={clearFilters}>Clear Filters</Button>
                    </div>
                    <Typography variant="body2" color="text.secondary" role="status">
                        {rows.length === 1 ? "1 move" : `${rows.length} moves`}
                    </Typography>
                    <TableContainer className="move-table" ref={tableRef} onScroll={list.onScroll}>
                        <Table size="small" stickyHeader aria-label="Moves" sx={getMoveTableStyles}>
                            <TableHead>
                                <TableRow>
                                    {columns.map((column) => (
                                        <TableCell key={column.key} align={column.numeric ? "right" : "left"} sortDirection={sort.key === column.key ? sort.direction : false}>
                                            <TableSortLabel active={sort.key === column.key} direction={sort.key === column.key ? sort.direction : SORT_ASCENDING}
                                                            onClick={() => handleSort(column.key)}>
                                                {column.label}
                                            </TableSortLabel>
                                        </TableCell>
                                    ))}
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {shownRows.map(({ option, learnable: canLearn, filteredOut }, index) =>
                                {
                                    const firstUnlearnable = !canLearn && (index === 0 || shownRows[index - 1].learnable);
                                    const firstFilteredOut = filteredOut && (index === 0 || !shownRows[index - 1].filteredOut);
                                    return (
                                        <React.Fragment key={option.key}>
                                            {firstFilteredOut &&
                                                <TableRow className="move-table-divider">
                                                    <TableCell colSpan={columns.length}>Moves {speciesName} can learn that have been filtered out</TableCell>
                                                </TableRow>}
                                            {firstUnlearnable &&
                                                <TableRow className="move-table-divider">
                                                    <TableCell colSpan={columns.length}>Moves {speciesName} can't learn</TableCell>
                                                </TableRow>}
                                            <MoveRow option={option} catalog={catalog} columns={columns} onChoose={chooseOption}
                                                     highlighted={index === highlightedIndex} active={option.key === activeKey} chosen={selectedKeys.has(option.key)}
                                                     illegal={getMoveLegality(catalog, fields.species, option.move).status === LEGALITY.ILLEGAL} />
                                        </React.Fragment>
                                    );
                                })}
                            </TableBody>
                        </Table>
                        {list.count < rows.length &&
                            <div className="load-more">
                                <Button size="small" onClick={list.loadMore}>Load More</Button>
                            </div>}
                    </TableContainer>
                </Stack>
            </DialogContent>
            <DialogActions sx={{ justifyContent: "flex-start" }}>
                <Button onClick={onClose}>Close</Button>
            </DialogActions>
        </>
    );
};

/**
 * The Choose Moves dialog. Closing it returns focus to the move slot it was opened from.
 *
 * @component
 * @param {Object} props - The component props
 * @param {boolean} props.open - Whether the dialog is open.
 * @param {object} props.catalog - The game catalog.
 * @param {object} props.fields - The spread's values.
 * @param {number} props.initialSlot - The slot chosen first.
 * @param {Function} props.onChange - Called with the slot, the MOVE_* constant or null, and the Hidden Power type.
 * @param {Function} props.onClose - Closes the dialog.
 * @param {Function} props.onExited - Called once the dialog has finished closing.
 * @returns {JSX.Element} The dialog.
 */
export const MoveChooserDialog = ({ open, catalog, fields, initialSlot, onChange, onClose, onExited }) =>
{
    const titleId = `move-chooser-title-${useId()}`;

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg" aria-labelledby={titleId} disableRestoreFocus
                slotProps={{ transition: { onExited }, paper: { className: "chooser-dialog" } }}>
            <DialogTitle id={titleId}>{`${DIALOG_TITLE} for ${getLabel(catalog.species, fields.species)}`}</DialogTitle>
            <MoveChooserContent catalog={catalog} fields={fields} initialSlot={initialSlot} onChange={onChange} onClose={onClose} />
        </Dialog>
    );
};

/**
 * One move slot's autocomplete.
 *
 * @component
 * @param {Object} props - The component props
 * @param {object} props.catalog - The game catalog.
 * @param {object} props.fields - The spread's values.
 * @param {number} props.slot - The move slot, 0 to 3.
 * @param {Function} props.onChange - Called with the slot, the MOVE_* constant or null, and the Hidden Power type.
 * @param {Function} props.onAdvanced - Opens the Choose Moves dialog at this slot.
 * @param {Function} [props.onFieldCommit] Advances focus after an inline option selection.
 * @returns {JSX.Element} The picker.
 */
const MovePicker = ({ catalog, fields, slot, onChange, onAdvanced, onFieldCommit }) =>
{
    const [open, setOpen] = useState(false);
    const label = `Move ${slot + 1}`;
    const value = getMoveOption(catalog, fields, fields.moves[slot]);
    const status = getMoveLegality(catalog, fields.species, fields.moves[slot]).status;
    const learnable = useMemo(() => getLearnableMoveOptions(catalog, fields.species).options, [catalog, fields.species]);

    // The current move stays listed even when the species cannot learn it
    const options = value != null && !learnable.some((option) => option.key === value.key) ? [value, ...learnable] : learnable;

    /**
     * Opens the Choose Moves dialog in place of the popup.
     */
    const openAdvanced = () =>
    {
        setOpen(false);
        onAdvanced();
    };

    return (
        <div className="move-picker" data-advance-field={label}>
            <Autocomplete
                size="small"
                options={options}
                value={value}
                disableClearable
                autoHighlight
                open={open}
                onOpen={() => setOpen(true)}
                onClose={() => setOpen(false)}
                onChange={(event, option, reason) =>
                {
                    onChange(slot, option?.move ?? null, option?.hiddenPowerType ?? null);
                    if (reason === "selectOption" && option != null)
                        onFieldCommit?.(event, label);
                }}
                filterOptions={(choices, state) => filterBySearch(choices, state.inputValue, (option) => option.name)}
                getOptionLabel={(option) => option.name}
                isOptionEqualToValue={(option, selected) => option.key === selected.key}
                getOptionKey={(option) => option.key}
                slots={{ paper: AdvancedPaper }}
                slotProps={{ paper: { onAdvanced: openAdvanced } }}
                renderOption={(props, option) =>
                {
                    const { key, ...optionProps } = props;
                    const illegal = getMoveLegality(catalog, fields.species, option.move).status === LEGALITY.ILLEGAL;
                    return (
                        <li key={key} {...optionProps} className={`${optionProps.className} move-option${illegal ? " move-illegal" : ""}`}>
                            <TypeIcon catalog={catalog} type={option.type} decorative />
                            <span className="move-option-name">{option.name}</span>
                        </li>
                    );
                }}
                renderInput={(params) => (
                    <TextField
                        {...params}
                        label={label}
                        className={`move-input move-status-${status}`}
                        slotProps={{
                            ...params.slotProps,
                            input:
                            {
                                ...params.slotProps.input,
                                startAdornment: <>{value != null && <TypeIcon catalog={catalog} type={value.type} decorative />}{params.slotProps.input.startAdornment}</>,
                                endAdornment:
                                    <>
                                        <Tooltip title={DIALOG_TITLE}>
                                            <IconButton size="small" aria-label={`Advanced search for ${label}`} onClick={openAdvanced}
                                                        onMouseDown={(event) => event.stopPropagation()}>
                                                <TuneIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                        {params.slotProps.input.endAdornment}
                                    </>,
                            },
                        }}
                    />
                )}
            />
        </div>
    );
};

/**
 * Adds a handle and drop target to an inline move slot.
 *
 * @param {object} props The component props.
 * @param {number} props.slot The zero-based move slot.
 * @param {React.ReactNode} props.children The move field.
 * @returns {JSX.Element} The draggable slot.
 */
const DraggableMoveSlot = ({ slot, children }) =>
{
    const drag = useDraggable({ id: `${DRAG_MOVE}:${slot}`, type: DRAG_MOVE, data: { slot } });
    const drop = useDroppable({ id: `drop:${slot}`, accept: DRAG_MOVE, data: { slot }, collisionDetector: closestCenter });
    const { ref: dragRef } = drag;
    const { ref: dropRef } = drop;
    /**
     * Registers the move field as both a drag source and drop target.
     * @param {HTMLElement|null} element The slot wrapper.
     */
    const ref = useCallback((element) =>
    {
        dragRef(element);
        dropRef(element);
    }, [dragRef, dropRef]);

    return (
           <Box ref={ref} className={`draggable-move-slot${drag.isDragSource ? " is-dragging" : ""}${drop.isDropTarget ? " is-drop-target" : ""}`}
               sx={{ "&.is-drop-target .MuiOutlinedInput-notchedOutline": { borderColor: "focus.main", borderWidth: 2 } }}>
            <div className="draggable-move-field">{children}</div>
            <Tooltip title={`Reorder Move ${slot + 1}`}>
                <IconButton ref={drag.handleRef} size="small" className="move-drag-handle" aria-label={`Drag Move ${slot + 1}`}>
                    <DragIndicatorIcon fontSize="small" />
                </IconButton>
            </Tooltip>
        </Box>
    );
};

/**
 * Represents the MoveEditor component: the four move slots and their Choose Moves dialog.
 *
 * @component
 * @param {Object} props - The component props
 * @param {object} props.catalog - The game catalog.
 * @param {object} props.fields - The spread's values.
 * @param {Function} props.onChange - Called with the slot, the MOVE_* constant or null, and the Hidden Power type.
 * @param {Function} props.onReorder Replaces the move array after a drag.
 * @param {Function} [props.onFieldCommit] Advances focus after an inline option selection.
 * @returns {JSX.Element} The move slots.
 */
const MoveEditor = ({ catalog, fields, onChange, onReorder, onFieldCommit }) =>
{
    const [dialog, setDialog] = useState({ open: false, slot: 0 });
    const rootRef = useRef(null);

    /**
     * Moves a slot to its dropped position without changing move values or IVs.
     * @param {object} event The completed drag operation.
     */
    const reorderMoves = (event) =>
    {
        const source = event.operation.source?.data?.slot;
        const target = event.operation.target?.data?.slot;
        if (event.canceled || source == null || target == null || source === target)
            return;
        const moves = Array.from({ length: MAX_MOVES }, (_, slot) => fields.moves[slot] ?? EMPTY_MOVE);
        const [move] = moves.splice(source, 1);
        moves.splice(target, 0, move);
        onReorder?.(moves);
    };

    /**
     * Clears a move when its inline input is emptied and committed.
     *
     * @param {React.SyntheticEvent} event The blur or Enter event.
     * @param {number} slot The move slot.
     */
    const clearEmpty = (event, slot) =>
    {
        if (event.target.tagName === "INPUT" && event.target.value.trim() === "")
            onChange(slot, null, null);
    };

    return (
        <DragDropProvider onDragEnd={reorderMoves}>
        <div ref={rootRef} className="move-editor">
            {Array.from({ length: MAX_MOVES }, (_, slot) =>
            {
                const move = fields.moves[slot];
                const duplicate = move != null && move !== 0 && move !== MOVE_NONE && fields.moves.indexOf(move) < slot;
                const field =
                    <div className={duplicate ? "move-status-illegal" : undefined}
                         onBlurCapture={(event) => clearEmpty(event, slot)}
                         onKeyDownCapture={(event) => { if (event.key === KEY_ENTER) clearEmpty(event, slot); }}>
                        <MovePicker catalog={catalog} fields={fields} slot={slot} onChange={onChange} onFieldCommit={onFieldCommit}
                                    onAdvanced={() => setDialog({ open: true, slot })} />
                    </div>;
                return (
                    <DraggableMoveSlot key={slot} slot={slot}>
                        {duplicate ? <Tooltip title={DUPLICATE_MOVE_LABEL}>{field}</Tooltip> : field}
                    </DraggableMoveSlot>
                );
            })}
            <MoveChooserDialog
                open={dialog.open}
                catalog={catalog}
                fields={fields}
                initialSlot={dialog.slot}
                onChange={onChange}
                onClose={() => setDialog({ ...dialog, open: false })}
                onExited={() => rootRef.current?.querySelectorAll(".move-picker input")[dialog.slot]?.focus()}
            />
        </div>
        </DragDropProvider>
    );
};

export default MoveEditor;
