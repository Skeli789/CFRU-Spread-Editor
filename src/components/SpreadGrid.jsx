/**
 * This file defines the SpreadGrid component.
 * It shows spreads in a section per spread set, with rows that keep each species together, and pages through
 * them so only a limited number of cards is shown at once. A species is never split between pages.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, MenuItem, Pagination, PaginationItem, Select, Stack, TextField, Typography } from "@mui/material";

import { PAGE_SIZES, buildRows, findPage, getRowCapacity, groupSpreads, paginateRows } from "../../shared/spread-layout.mjs";

// The narrowest a card can be while keeping the sprite column beside the stats and their - and + buttons
export const MIN_CARD_WIDTH = 430;
const CARD_GAP = 8;

// Used until the container has been measured, such as in tests
const DEFAULT_CAPACITY = 3;
const FIRST_PAGE = 1;
const PAGE_NUMBER_PATTERN = /^\d+$/;


/**
 * Measures an element's width as it resizes.
 *
 * @param {React.RefObject<HTMLElement>} ref The element.
 * @returns {number} The width, or 0 before it is known.
 */
function useWidth(ref)
{
    const [width, setWidth] = useState(0);

    /**
     * Follows the element's size.
     */
    useEffect(() =>
    {
        const element = ref.current;
        if (element == null)
            return undefined;

        setWidth(element.clientWidth);
        if (typeof ResizeObserver === "undefined")
            return undefined;

        const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
        observer.observe(element);
        return () => observer.disconnect();
    }, [ref]);

    return width;
}

/**
 * Splits a page's rows into runs from the same set.
 *
 * @param {Array<object>} rows The page's rows.
 * @returns {Array<{setId: string, rows: Array<object>}>} The sections.
 */
function getSections(rows)
{
    const sections = [];
    for (const row of rows)
    {
        if (sections.at(-1)?.setId !== row.setId)
            sections.push({ setId: row.setId, rows: [] });
        sections.at(-1).rows.push(row);
    }

    return sections;
}

/**
 * Represents the SpreadGrid component.
 *
 * @component
 * @param {Object} props - The component props
 * @param {Array<{id: string, species: string, setId: string}>} props.spreads - The spreads to show, in source order.
 * @param {Function} props.renderCard - Returns the card for a spread ID.
 * @param {Function} props.getSetHeading - Returns a set's title and file for its section.
 * @param {number} props.pageSize - The most cards on a page, unless one species has more.
 * @param {Function} props.onPageSizeChange - Called with a new page size.
 * @param {string} props.resetKey - Changes whenever the results should go back to the first page.
 * @param {Function} props.onClearFilters - Clears the filters.
 * @returns {JSX.Element} The grid.
 */
const SpreadGrid = ({ spreads, renderCard, getSetHeading, pageSize, onPageSizeChange, resetKey, onClearFilters }) =>
{
    const containerRef = useRef(null);
    const width = useWidth(containerRef);
    const capacity = width > 0 ? getRowCapacity(width, MIN_CARD_WIDTH, CARD_GAP) : DEFAULT_CAPACITY;
    const pages = useMemo(() => paginateRows(buildRows(groupSpreads(spreads), capacity), pageSize), [spreads, capacity, pageSize]);

    // The page is remembered by its first spread, so resizing or a new page size keeps it in view
    const [anchor, setAnchor] = useState({ resetKey, id: null });
    const [jumpOpen, setJumpOpen] = useState(false);
    const [jumpValue, setJumpValue] = useState("");
    const pageIndex = findPage(pages, anchor.resetKey === resetKey ? anchor.id : null);
    const page = pages[pageIndex] ?? [];
    const firstShown = pages.slice(0, pageIndex).reduce((sum, rows) => sum + rows.reduce((count, row) => count + row.ids.length, 0), 0);
    const shownCount = page.reduce((count, row) => count + row.ids.length, 0);
    const continuedSet = pageIndex > 0 ? pages[pageIndex - 1].at(-1).setId : null;

    /**
     * Shows another page from its top.
     *
     * @param {number} index The page index.
     */
    const goToPage = (index) =>
    {
        setAnchor({ resetKey, id: pages[index][0].ids[0] });
        containerRef.current?.scrollIntoView?.({ block: "start" });
    };

    /** Opens the page picker at the current page. */
    const openJump = () =>
    {
        setJumpValue(String(pageIndex + FIRST_PAGE));
        setJumpOpen(true);
    };

    /**
     * Keeps a whole-number page entry within the available pages.
     *
     * @param {React.ChangeEvent<HTMLInputElement>} event The input change.
     */
    const changeJumpValue = (event) =>
    {
        const value = event.target.value;
        setJumpValue(PAGE_NUMBER_PATTERN.test(value) && Number(value) > pages.length ? String(pages.length) : value);
    };

    /**
     * Navigates to the requested page, keeping it within the available range.
     *
     * @param {React.FormEvent} event The form submission.
     */
    const submitJump = (event) =>
    {
        event.preventDefault();
        if (!PAGE_NUMBER_PATTERN.test(jumpValue) || pages.length < FIRST_PAGE)
            return;
        const target = Math.min(Math.max(Number(jumpValue), FIRST_PAGE), pages.length);
        goToPage(target - FIRST_PAGE);
        setJumpOpen(false);
    };

    const pagination = pages.length > 1 &&
        <Pagination size="small" count={pages.length} page={pageIndex + 1} onChange={(event, value) => goToPage(value - 1)} aria-label="Spread pages"
                    renderItem={(item) => item.type === "start-ellipsis" || item.type === "end-ellipsis"
                        ? <PaginationItem {...item} type="page" page="..." aria-label="Jump to Page" onClick={openJump} />
                        : <PaginationItem {...item} />} />;

    return (
        <div className="spread-grid" ref={containerRef}>
            <Stack direction="row" className="spread-grid-bar">
                <Typography variant="body2" role="status">
                    {spreads.length === 0 ? "No spreads" : `Showing ${firstShown + 1}-${firstShown + shownCount} of ${spreads.length} spreads`}
                </Typography>
                {pagination}
                <FormControl size="small" sx={{ minWidth: 100 }}>
                    <InputLabel id="page-size-label">Per Page</InputLabel>
                    <Select labelId="page-size-label" label="Per Page" value={pageSize} onChange={(event) => onPageSizeChange(event.target.value)}>
                        {PAGE_SIZES.map((size) => <MenuItem key={size} value={size}>{size}</MenuItem>)}
                    </Select>
                </FormControl>
            </Stack>
            {spreads.length === 0 &&
                <Stack spacing={1} className="spread-grid-empty">
                    <Typography>No spreads match these filters.</Typography>
                    <Button variant="outlined" size="small" onClick={onClearFilters}>Clear Filters</Button>
                </Stack>}
            {getSections(page).map((section, index) =>
            {
                const heading = getSetHeading(section.setId);
                return (
                    <section key={`${section.setId}-${section.rows[0].ids[0]}`} className="spread-section" aria-label={`${heading.title} spreads`}>
                        <div className="spread-section-heading">
                            <Typography component="h2" variant="subtitle1" className="spread-section-title">
                                {heading.title}{index === 0 && section.setId === continuedSet ? " (continued)" : ""}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">{heading.file}</Typography>
                        </div>
                        {section.rows.map((row) => (
                            <div key={row.ids[0]} className="spread-row" style={{ gridTemplateColumns: `repeat(${capacity}, minmax(0, 1fr))` }}>
                                {row.ids.map((id) => <React.Fragment key={id}>{renderCard(id)}</React.Fragment>)}
                            </div>
                        ))}
                    </section>
                );
            })}
            {pages.length > 1 && <Stack direction="row" className="spread-grid-bar spread-grid-bottom">{pagination}</Stack>}
            <Dialog open={jumpOpen} onClose={() => setJumpOpen(false)} aria-labelledby="jump-page-title" fullWidth maxWidth="xs">
                <form onSubmit={submitJump} noValidate>
                    <DialogTitle id="jump-page-title">Jump to Page ({pages.length} Pages)</DialogTitle>
                    <DialogContent>
                        <TextField autoFocus fullWidth type="number" value={jumpValue}
                                   onChange={changeJumpValue} error={jumpValue !== "" && !PAGE_NUMBER_PATTERN.test(jumpValue)}
                                   slotProps={{ htmlInput: { "aria-label": "Page", min: FIRST_PAGE, max: pages.length, step: 1 } }} />
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setJumpOpen(false)}>Cancel</Button>
                        <Button type="submit" color="focus" disabled={!PAGE_NUMBER_PATTERN.test(jumpValue)}>Go</Button>
                    </DialogActions>
                </form>
            </Dialog>
        </div>
    );
};

export default SpreadGrid;
