/**
 * This file defines the ItemPicker component: an autocomplete of the game's items, and the Choose Item dialog,
 * which lists items in sections by CFRU's item types and can filter by type.
 */

import React, { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import
{
    Autocomplete, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, List, ListItemButton, ListSubheader, Stack, TextField, Tooltip, Typography,
} from "@mui/material";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import TuneIcon from "@mui/icons-material/Tune";

import { AdvancedPaper, GameImage, filterBySearch, scrollToEntry, useIncrementalList } from "./CatalogDisplay";

export const ITEM_NONE = "ITEM_NONE";
export const NO_ITEM_LABEL = "No Item";
const OTHER_ITEM_TYPE = "Other";
const DIALOG_TITLE = "Choose Item";
const ICON_SIZE = 24;
const BERRY_SUFFIX = "_BERRY";
const ITEM_GROUPS = ["Held Item", "Gem", "Berries", "Incense", "Plate", "Drive", "Memory", "Mega Stone", "Primal Orb", "Z-Crystal", OTHER_ITEM_TYPE];
const ITEM_TYPE_GROUPS =
{
    ITEM_TYPE_HELD_ITEM: "Held Item",
    ITEM_TYPE_GEM: "Gem",
    ITEM_TYPE_BERRY: "Berries",
    ITEM_TYPE_BERRIES: "Berries",
    ITEM_TYPE_INCENSE: "Incense",
    ITEM_TYPE_PLATE: "Plate",
    ITEM_TYPE_DRIVE: "Drive",
    ITEM_TYPE_MEMORY: "Memory",
    ITEM_TYPE_MEGA_STONE: "Mega Stone",
    ITEM_TYPE_PRIMAL_ORB: "Primal Orb",
    ITEM_TYPE_Z_CRYSTAL: "Z-Crystal",
};
const HELD_ITEM_EXCEPTIONS = new Set(["King's Rock", "Metal Coat", "Razor Claw", "Razor Fang"]);
const KEY_ENTER = "Enter";
const KEY_DOWN = "ArrowDown";
const KEY_UP = "ArrowUp";
const KEY_HOME = "Home";
const KEY_END = "End";
const NAVIGATION_KEYS = [KEY_DOWN, KEY_UP, KEY_HOME, KEY_END];
const SCROLL_END_TOLERANCE = 1;

const itemOptionCache = new WeakMap();


/**
 * Returns an allowed item type's readable name, or Other for unlisted types.
 *
 * @param {string|null} itemType The ITEM_TYPE_* constant, or null when CFRU does not list the item.
 * @returns {string} The name.
 */
export function getItemTypeLabel(itemType)
{
    return ITEM_TYPE_GROUPS[itemType] ?? OTHER_ITEM_TYPE;
}

/**
 * Returns the game's items as options, with No Item first and the rest by name.
 *
 * @param {object} catalog The game catalog.
 * @returns {Array<{value: string, name: string, icon: string|null, typeLabel: string}>} The options.
 */
export function getItemOptions(catalog)
{
    if (!itemOptionCache.has(catalog))
    {
        const options = Object.entries(catalog.items).map(([value, item]) =>
            ({ value, name: value === ITEM_NONE ? NO_ITEM_LABEL : item.name, icon: item.icon,
                typeLabel: HELD_ITEM_EXCEPTIONS.has(item.name) ? "Held Item" : value.endsWith(BERRY_SUFFIX) ? "Berries" : getItemTypeLabel(item.itemType ?? null) }));
        options.sort((a, b) => (b.value === ITEM_NONE) - (a.value === ITEM_NONE) || a.name.localeCompare(b.name));
        itemOptionCache.set(catalog, options);
    }

    return itemOptionCache.get(catalog);
}

/**
 * Returns the items the Choose Item dialog lists, in sections by item type with Other last, each section in the
 * order of a search's matches. No Item comes before every section.
 *
 * @param {object} catalog The game catalog.
 * @param {string} search The search text.
 * @param {string|null} typeLabel The item type to show, or null for all.
 * @returns {Array<object>} The item options.
 */
export function getChooserItems(catalog, search, typeLabel)
{
    const [none, ...items] = getItemOptions(catalog);
    const matches = filterBySearch(items.filter((option) => typeLabel == null || option.typeLabel === typeLabel), search, (option) => option.name);
    const sections = ITEM_GROUPS.filter((group) => matches.some((option) => option.typeLabel === group));

    const noItem = none?.value === ITEM_NONE && typeLabel == null && filterBySearch([none], search, (option) => option.name).length > 0 ? [none] : [];
    return [...noItem, ...sections.flatMap((section) => matches.filter((option) => option.typeLabel === section))];
}

/**
 * An item's icon and name.
 *
 * @component
 * @param {Object} props - The component props
 * @param {object} props.option - The item option.
 * @returns {JSX.Element} The label.
 */
const ItemLabel = ({ option }) =>
{
    return (
        <span className="option-with-icon">
            <GameImage src={option.icon} alt="" decorative width={ICON_SIZE} height={ICON_SIZE} />
            {option.name}
        </span>
    );
};

/**
 * Returns the item list's styles, set once on the list instead of on every row.
 *
 * @param {object} theme The theme.
 * @returns {object} The styles.
 */
export function getItemListStyles(theme)
{
    const styles =
    {
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        overflowX: "hidden",
        scrollbarGutter: "stable",
        "& .item-row-highlighted": { outline: `2px solid ${theme.palette.focus?.main ?? theme.palette.primary.main}`, outlineOffset: -2 },
    };
    return styles;
}

/**
 * One item in the Choose Item list. Only rows whose state changes re-render, which keeps arrow keys quick.
 *
 * @component
 * @param {Object} props - The component props
 * @param {object} props.option - The item option.
 * @param {boolean} props.selected - Whether it is the chosen item.
 * @param {boolean} props.highlighted - Whether the keyboard highlight is on it.
 * @param {Function} props.onSelect - Called with the item's ITEM_* constant.
 * @returns {JSX.Element} The row.
 */
const ItemRow = memo(({ option, selected, highlighted, onSelect }) =>
{
    return (
        <ListItemButton selected={selected} aria-selected={selected} data-item={option.value} data-highlighted={highlighted ? "true" : undefined}
                        className={highlighted ? "item-row-highlighted" : undefined} onClick={() => onSelect(option.value)}>
            <ItemLabel option={option} />
        </ListItemButton>
    );
});

/**
 * The Choose Item dialog's search, type filter and sectioned list, which only exist while the dialog is open.
 *
 * @component
 * @param {Object} props - The component props
 * @param {object} props.catalog - The game catalog.
 * @param {string} props.value - The chosen ITEM_* constant.
 * @param {Function} props.onSelect - Called with the chosen ITEM_* constant.
 * @param {Function} props.onClose - Closes the dialog.
 * @returns {JSX.Element} The dialog content.
 */
const ItemChooserContent = ({ catalog, value, onSelect, onClose }) =>
{
    const [search, setSearch] = useState("");
    const [typeLabel, setTypeLabel] = useState(null);
    const listRef = useRef(null);
    const searchRef = useRef(null);
    const items = useMemo(() => getChooserItems(catalog, search, typeLabel), [catalog, search, typeLabel]);
    const typeLabels = useMemo(() => ITEM_GROUPS.filter((group) => getItemOptions(catalog).some((option) => option.value !== ITEM_NONE && option.typeLabel === group)), [catalog]);
    const list = useIncrementalList(items.length, JSON.stringify([search, typeLabel]));
    const shown = items.slice(0, list.count);
    const [scrollPending, setScrollPending] = useState(true);
    const [scrolled, setScrolled] = useState(false);
    const [atBottom, setAtBottom] = useState(false);
    const [highlight, setHighlight] = useState({ key: "", index: 0 });
    const navKey = JSON.stringify([search, typeLabel]);
    // Until the user types or moves, the highlight rests on the chosen item
    const chosenIndex = search === "" ? Math.max(0, items.findIndex((option) => option.value === value)) : 0;
    const highlightedIndex = highlight.key === navKey ? Math.min(highlight.index, Math.max(0, items.length - 1)) : chosenIndex;
    const selectRef = useRef(onSelect);
    selectRef.current = onSelect;
    const selectItem = useCallback((item) => selectRef.current(item), []);

    /**
     * Keeps the keyboard highlight visible without moving the dialog itself.
     */
    useEffect(() =>
    {
        if (highlight.key !== navKey || highlightedIndex >= list.count)
            return;

        scrollToEntry(listRef.current, listRef.current?.querySelector('[data-highlighted="true"]'));
    }, [highlight, navKey, highlightedIndex, list.count]);

    /**
     * Selects or navigates items from the search field.
     *
     * @param {React.KeyboardEvent} event The key event.
     */
    const handleSearchKeyDown = (event) =>
    {
        if (items.length === 0)
            return;

        if (event.key === KEY_ENTER)
        {
            event.preventDefault();
            onSelect(items[highlightedIndex].value);
        }
        else if (NAVIGATION_KEYS.includes(event.key))
        {
            event.preventDefault();
            const next = event.key === KEY_END ? items.length - 1 : event.key === KEY_HOME ? 0
                : Math.max(0, Math.min(items.length - 1, highlightedIndex + (event.key === KEY_DOWN ? 1 : -1)));
            setHighlight({ key: navKey, index: next });
            list.showAtLeast(next);
        }
    };

    /**
     * Shows the chosen item when the dialog opens.
     */
    useEffect(() =>
    {
        if (!scrollPending)
            return;

        const index = items.findIndex((option) => option.value === value);
        if (index >= list.count)
        {
            list.showAtLeast(index);
            return;
        }

        scrollToEntry(listRef.current, listRef.current?.querySelector("[aria-selected='true']"));
        setScrolled((listRef.current?.scrollTop ?? 0) > 0);
        setScrollPending(false);
    }, [scrollPending, items, value, list]);

    /**
     * Tracks loading and the bottom-only fallback control.
     *
     * @param {React.UIEvent} event The list scroll.
     * @returns {void} Nothing.
     */
    const handleScroll = (event) =>
    {
        list.onScroll(event);
        const element = event.currentTarget;
        setScrolled(element.scrollTop > 0);
        setAtBottom(element.scrollTop > 0 && element.scrollTop + element.clientHeight >= element.scrollHeight - SCROLL_END_TOLERANCE);
    };

    /**
     * Returns the item list to its first entry.
     */
    const scrollToTop = () =>
    {
        if (listRef.current != null)
            listRef.current.scrollTop = 0;
        setScrolled(false);
        setAtBottom(false);
    };

    /**
     * Starts each new search or type filter at the top of the list, after the opening scroll to the chosen item.
     */
    const filtersRef = useRef(null);
    useEffect(() =>
    {
        const key = JSON.stringify([search, typeLabel]);
        if (filtersRef.current != null && filtersRef.current !== key)
            scrollToTop();
        filtersRef.current = key;
    }, [search, typeLabel]);

    return (
        <>
            <DialogContent dividers>
                <Stack spacing={1.5} className="chooser-body">
                    <div className="chooser-filters">
                        <TextField size="small" label="Search" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={handleSearchKeyDown}
                                   inputRef={searchRef} autoFocus sx={{ flex: "1 1 200px" }} />
                        <Autocomplete
                            size="small"
                            autoHighlight
                            sx={{ flex: "0 1 220px" }}
                            options={typeLabels}
                            value={typeLabel}
                            onChange={(event, option) =>
                            {
                                setTypeLabel(option);
                                searchRef.current?.focus();
                            }}
                            renderInput={(params) => <TextField {...params} label="Item Type" />}
                        />
                    </div>
                    <Typography variant="body2" color="text.secondary" role="status">
                        {items.length === 1 ? "1 item" : `${items.length} items`}
                    </Typography>
                    <Box className="item-list-viewport">
                        <List dense disablePadding className="item-list" ref={listRef} onScroll={handleScroll} aria-label="Items" sx={getItemListStyles}>
                            {shown.map((option, index) =>
                            {
                                const heading = option.value !== ITEM_NONE && (index === 0 || shown[index - 1].typeLabel !== option.typeLabel || shown[index - 1].value === ITEM_NONE);
                                return (
                                    <React.Fragment key={option.value}>
                                        {heading && <ListSubheader className="item-list-heading" sx={{ bgcolor: "background.paper", zIndex: 2, position: "sticky", top: 0 }}>{option.typeLabel}</ListSubheader>}
                                        <ItemRow option={option} selected={option.value === value} highlighted={index === highlightedIndex} onSelect={selectItem} />
                                    </React.Fragment>
                                );
                            })}
                            {atBottom && list.count < items.length &&
                                <li className="load-more">
                                    <Button size="small" onClick={() =>
                                    {
                                        list.loadMore();
                                        setAtBottom(false);
                                    }}>Load More</Button>
                                </li>}
                        </List>
                        {scrolled &&
                            <Tooltip title="Scroll to top">
                                <IconButton size="small" aria-label="Scroll to top" onClick={scrollToTop}
                                            sx={{ position: "absolute", right: 8, bottom: 8, zIndex: 3, bgcolor: "background.paper", boxShadow: 2, "&:hover": { bgcolor: "background.paper" } }}>
                                    <ArrowUpwardIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>}
                    </Box>
                </Stack>
            </DialogContent>
            <DialogActions sx={{ justifyContent: "flex-start" }}>
                <Button onClick={onClose}>Close</Button>
            </DialogActions>
        </>
    );
};

/**
 * Represents the ItemPicker component.
 *
 * @component
 * @param {Object} props - The component props
 * @param {object} props.catalog - The game catalog.
 * @param {string|number} props.value - The held item's ITEM_* constant, or a raw value the game does not name.
 * @param {Function} props.onChange - Called with the chosen ITEM_* constant.
 * @param {string} [props.speciesName] - The species display name for the dialog title.
 * @param {Function} [props.onFieldCommit] Advances focus after an inline option selection.
 * @returns {JSX.Element} The picker.
 */
const ItemPicker = ({ catalog, value, onChange, speciesName, onFieldCommit }) =>
{
    const [open, setOpen] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const rootRef = useRef(null);
    const titleId = `item-chooser-title-${useId()}`;
    const options = getItemOptions(catalog);
    const selected = options.find((option) => option.value === value) ?? { value, name: String(value), icon: null, typeLabel: OTHER_ITEM_TYPE };

    /**
     * Opens the Choose Item dialog in place of the popup.
     */
    const openAdvanced = () =>
    {
        setOpen(false);
        setDialogOpen(true);
    };

    return (
        <div ref={rootRef} className="item-picker" data-advance-field="Item">
            <Autocomplete
                size="small"
                autoHighlight
                options={options}
                value={selected}
                open={open}
                onOpen={() => setOpen(true)}
                onClose={() => setOpen(false)}
                disableClearable
                onChange={(event, option, reason) =>
                {
                    onChange(option.value);
                    if (reason === "selectOption")
                        onFieldCommit?.(event, "Item");
                }}
                filterOptions={(choices, state) => filterBySearch(choices, state.inputValue, (option) => option.name)}
                getOptionLabel={(option) => option.name}
                isOptionEqualToValue={(option, choice) => option.value === choice.value}
                getOptionKey={(option) => option.value}
                slots={{ paper: AdvancedPaper }}
                slotProps={{ paper: { onAdvanced: openAdvanced }, popper: { className: "wide-popper", placement: "bottom-start" } }}
                renderOption={(props, option) =>
                {
                    const { key, ...optionProps } = props;
                    return <li key={key} {...optionProps}><ItemLabel option={option} /></li>;
                }}
                renderInput={(params) =>
                    <TextField {...params} label="Item" slotProps={{ ...params.slotProps, input: { ...params.slotProps.input,
                        startAdornment: <>{selected.icon != null && <Box component="span" sx={{ display: "inline-flex" }}><GameImage src={selected.icon} alt="" decorative width={ICON_SIZE} height={ICON_SIZE} /></Box>}{params.slotProps.input.startAdornment}</>,
                        endAdornment: <>
                            <Tooltip title={DIALOG_TITLE}>
                                <IconButton size="small" aria-label="Advanced search for Item" onClick={openAdvanced} onMouseDown={(event) => event.stopPropagation()}>
                                    <TuneIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                            {params.slotProps.input.endAdornment}
                        </>,
                    } }} />}
            />
            <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth maxWidth="sm" aria-labelledby={titleId} disableRestoreFocus
                    slotProps={{ transition: { onExited: () => rootRef.current?.querySelector("input")?.focus() }, paper: { className: "chooser-dialog" } }}>
                <DialogTitle id={titleId}>{speciesName ? `${DIALOG_TITLE} for ${speciesName}` : DIALOG_TITLE}</DialogTitle>
                <ItemChooserContent catalog={catalog} value={value} onClose={() => setDialogOpen(false)} onSelect={(item) =>
                {
                    onChange(item);
                    setDialogOpen(false);
                }} />
            </Dialog>
        </div>
    );
};

export default ItemPicker;
