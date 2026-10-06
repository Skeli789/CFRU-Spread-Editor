/**
 * This file defines the SpreadGrid component.
 * It shows spreads in a section per spread set, with rows that keep each species together, and pages through
 * them so only a limited number of cards is shown at once. A species is never split between pages.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, IconButton, InputLabel, MenuItem, Pagination, PaginationItem, Select, Stack, TextField, Tooltip, Typography } from "@mui/material";
import { DragDropProvider, DragOverlay, useDraggable, useDroppable } from "@dnd-kit/react";
import { closestCenter } from "@dnd-kit/collision";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import OpenWithIcon from "@mui/icons-material/OpenWith";
import UndoIcon from "@mui/icons-material/Undo";
import AddIcon from "@mui/icons-material/Add";
import ArrowLeftIcon from "@mui/icons-material/ArrowLeft";
import ArrowRightIcon from "@mui/icons-material/ArrowRight";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";

import { GROUP_MOVE_PREFIX, PAGE_SIZES, buildRows, canDropSpread, findPage, getGapTarget, getRowCapacity, groupSpreads, hasOrderChange, moveSpeciesGroup, moveSpread, paginateRows } from "../../shared/spread-layout.mjs";

// The narrowest a card can be while keeping the sprite column beside the stats and their - and + buttons
export const MIN_CARD_WIDTH = 340;
const CARD_GAP = 8;

// Used until the container has been measured, such as in tests
const DEFAULT_CAPACITY = 3;
const FIRST_PAGE = 1;
const PAGE_NUMBER_PATTERN = /^\d+$/;
const DRAG_SPREAD = "spread";
const DROP_SPREAD = "spreadTarget";
const DROP_SET = "setTarget";
const NO_IDS = new Set();
const NO_GROUPS = new Map();
const NO_SETS = new Map();
const UNEDITABLE_REASON = "This spread's source cannot be changed safely.";
const LEFT_EDGE_REASON = "This is the first spread in its species group.";
const RIGHT_EDGE_REASON = "This is the last spread in its species group.";
const REORDER_BLOCKED_REASON = "This spread set cannot be reordered safely.";
const HIDDEN_SPREADS_REASON = "Some spreads are hidden by the filters.";
const INSERT_BLOCKED_REASON = "Spreads cannot be added to this set.";

// A row one card short of full widens its cards to fill it, but a lone card never stretches across the page
const MIN_WIDENED_CAPACITY = 3;


/**
 * A spread that can be dragged by its handle onto another spread, in its own species or another set, with a
 * button to put it back once it has moved within its species.
 *
 * @component
 * @param {Object} props The props.
 * @param {object} props.item The visible spread.
 * @param {string} props.name The species name.
 * @param {string} props.dragReason Why it cannot be dragged, or nothing.
 * @param {boolean} props.dropAllowed Whether the spread being dragged can be dropped here.
 * @param {string} props.moveReason Why it cannot move within its species.
 * @param {string|null} props.leftId The preceding spread in its species.
 * @param {string|null} props.rightId The following spread in its species.
 * @param {Function} props.onMove Moves this spread onto a neighbor.
 * @param {Function|null} props.onRevert Puts the spread back in its saved place, or nothing when it has not moved.
 * @param {Function} props.renderCard Renders the spread.
 * @param {boolean} props.revealed Whether this spread was revealed outside the filters.
 * @returns {JSX.Element} The spread.
 */
const MovableSpread = ({ item, name, dragReason, dropAllowed, moveReason, leftId, rightId, onMove, onRevert, renderCard, revealed }) =>
{
    const data = useMemo(() => ({ kind: DRAG_SPREAD, id: item.id, setId: item.setId, species: item.species }), [item]);
    const targetData = useMemo(() => ({ ...data, kind: DROP_SPREAD }), [data]);
    const drag = useDraggable({ id: `${DRAG_SPREAD}:${item.id}`, type: DRAG_SPREAD, data, disabled: Boolean(dragReason) });
    const drop = useDroppable({ id: `${DROP_SPREAD}:${item.id}`, accept: DRAG_SPREAD, data: targetData, disabled: !dropAllowed, collisionDetector: closestCenter });
    const { ref: dragRef } = drag;
    const { ref: dropRef } = drop;
    /**
     * Registers the shared draggable and droppable element.
     * @param {HTMLElement|null} element The spread wrapper.
     * @returns {void} Nothing.
     */
    const ref = useCallback((element) =>
    {
        dragRef(element);
        dropRef(element);
    }, [dragRef, dropRef]);
    const className = ["movable-spread", revealed ? "is-filter-revealed" : "", drag.isDragSource ? "is-dragging" : "", drop.isDropTarget && dropAllowed ? "is-drop-target" : ""];

    return (
        <div ref={ref} className={className.filter(Boolean).join(" ")}>
            <div className="spread-order-controls">
                {onRevert != null &&
                    <Tooltip title={`Put this ${name} spread back in its saved place`}>
                        <Button size="small" color="warning" startIcon={<UndoIcon fontSize="small" />} aria-label={`Revert ${name} Spread Order`} onClick={onRevert}>
                            Revert
                        </Button>
                    </Tooltip>}
                <Tooltip title={dragReason || `Drag ${name} spread to another place or set`}><span>
                    <IconButton ref={drag.handleRef} size="small" disabled={Boolean(dragReason)} aria-label={`Drag ${name} spread`}><DragIndicatorIcon fontSize="small" /></IconButton>
                </span></Tooltip>
                <Tooltip title={moveReason || (leftId == null ? LEFT_EDGE_REASON : `Move ${name} spread one place earlier`)}><span>
                    <IconButton size="small" disabled={Boolean(moveReason) || leftId == null} aria-label={`Move ${name} Spread Left`} onClick={() => onMove(item.id, leftId)}>
                        <ArrowLeftIcon fontSize="small" />
                    </IconButton>
                </span></Tooltip>
                <Tooltip title={moveReason || (rightId == null ? RIGHT_EDGE_REASON : `Move ${name} spread one place later`)}><span>
                    <IconButton size="small" disabled={Boolean(moveReason) || rightId == null} aria-label={`Move ${name} Spread Right`} onClick={() => onMove(item.id, rightId)}>
                        <ArrowRightIcon fontSize="small" />
                    </IconButton>
                </span></Tooltip>
            </div>
            {renderCard(item.id)}
        </div>
    );
};

/**
 * A species group's heading, with a button to choose a new place for the whole group and, once the group has
 * moved, a button to put it back.
 *
 * @component
 * @param {Object} props The props.
 * @param {string} props.name The species name.
 * @param {string} props.reason Why it cannot move, or nothing.
 * @param {boolean} props.placing Whether this group is waiting for its new place.
 * @param {Function} props.onMove Starts or cancels choosing a place.
 * @param {Function|null} props.onRevert Puts the group back in its saved place, or nothing when it has not moved.
 * @param {boolean} props.expanded Whether filtered-out peers are shown.
 * @param {Function|null} props.onToggle Toggles filtered-out peers when available.
 * @returns {JSX.Element} The heading.
 */
const GroupHeader = ({ name, reason, placing, onMove, onRevert, expanded, onToggle }) =>
    <div className="species-order-controls">
        <Typography variant="caption">{name}</Typography>
        <Tooltip title={reason || (placing ? "Cancel moving this group" : `Choose a new place for every ${name} spread`)}><span>
            <Button size="small" variant={placing ? "contained" : "text"} startIcon={<OpenWithIcon fontSize="small" />} disabled={Boolean(reason)}
                    aria-label={placing ? `Cancel Moving ${name} Group` : `Move ${name} Group`} onClick={onMove}>
                {placing ? "Cancel" : "Move"}
            </Button>
        </span></Tooltip>
        {onToggle != null &&
            <Tooltip title={expanded ? `Hide ${name} spreads outside the filters` : `Show all ${name} spreads in this spread set`}>
                <Button size="small" startIcon={expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                        aria-label={`${expanded ? "Less" : "More"} ${name} Spreads`} aria-expanded={expanded} onClick={onToggle}>
                    {expanded ? "Less" : "More"}
                </Button>
            </Tooltip>}
        {onRevert != null &&
            <Tooltip title={`Put the ${name} group back in its saved place`}>
                <Button size="small" color="warning" startIcon={<UndoIcon fontSize="small" />} aria-label={`Revert ${name} Group Order`} onClick={onRevert}>
                    Revert
                </Button>
            </Tooltip>}
    </div>;

/**
 * A place between two species groups where the group being moved can go.
 *
 * @component
 * @param {Object} props The props.
 * @param {string} props.label The place's accessible name.
 * @param {Function} props.onPlace Moves the group here.
 * @param {boolean} [props.vertical] Whether it stands between two groups in one row.
 * @returns {JSX.Element} The button.
 */
const GroupGap = ({ label, onPlace, vertical = false }) =>
    <Button className={`group-gap${vertical ? " group-gap-vertical" : ""}`} variant="outlined" color="focus" fullWidth={!vertical} aria-label={label} onClick={onPlace}>
        Move Here
    </Button>;

/**
 * A placeholder card at the end of the spreads that opens Add Spread.
 *
 * @component
 * @param {Object} props The props.
 * @param {Function} props.onAdd Opens Add Spread.
 * @param {boolean} props.disabled Whether this set blocks insertion.
 * @param {string} props.reason Why insertion is blocked.
 * @returns {JSX.Element} The card.
 */
const AddSpreadCard = ({ onAdd, disabled, reason }) =>
    <div className="add-spread-slot">
        <div className="spread-order-controls" />
        <Tooltip title={disabled ? reason : ""}>
            <span className="add-spread-tooltip-target">
                <Button className="add-spread-card" variant="outlined" color="focus" startIcon={<AddIcon />} aria-label="Add Spread at the End" disabled={disabled} onClick={onAdd}>
                    Add Spread
                </Button>
            </span>
        </Tooltip>
    </div>;

/**
 * A set's heading, where a dragged spread can be dropped to move it into the set.
 *
 * @component
 * @param {Object} props The props.
 * @param {string} props.setId The set.
 * @param {boolean} props.dropAllowed Whether the spread being dragged can move into this set.
 * @param {React.ReactNode} props.children The heading content.
 * @returns {JSX.Element} The heading.
 */
const SetHeading = ({ setId, dropAllowed, children }) =>
{
    const data = useMemo(() => ({ kind: DROP_SET, setId }), [setId]);
    const drop = useDroppable({ id: `${DROP_SET}:${setId}`, accept: DRAG_SPREAD, data, disabled: !dropAllowed, collisionDetector: closestCenter });
    const className = ["spread-section-heading", dropAllowed ? "is-drop-allowed" : "", drop.isDropTarget && dropAllowed ? "is-drop-target" : ""];
    return <div ref={drop.ref} className={className.filter(Boolean).join(" ")}>{children}</div>;
};

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
 * @param {Array<object>} [props.availableSpreads] All nonhidden spreads in current source order, before filtering.
 * @param {Function} props.renderCard - Returns the card for a spread ID.
 * @param {Function} props.getSetHeading - Returns a set's title and file for its section.
 * @param {number} props.pageSize - The most cards on a page, unless one species has more.
 * @param {Function} props.onPageSizeChange - Called with a new page size.
 * @param {string} props.resetKey - Changes whenever the results should go back to the first page.
 * @param {Function} props.onClearFilters - Clears the filters.
 * @param {Function} props.getSpeciesName - Returns a species' display name.
 * @param {object|null} props.activeSet The only visible set.
 * @param {Map<string, object>} props.allEntries All saved and new entries.
 * @param {Map<string, object>} [props.sets] All sets, including sets visible together.
 * @param {Object<string, Array<string>>} props.orders Draft source orders.
 * @param {object|null} props.reveal A moved spread to reveal.
 * @param {Set<string>} [props.hiddenIds] Spreads kept in source orders but not shown, such as those moved to another set.
 * @param {Function} props.onOrder Accepts a proposed source order with the spreads, or group markers, the user moved.
 * @param {Function} props.onRevertOrder Restores a set's order.
 * @param {Map<string, Set<string>>} [props.movedGroups] The species groups the user moved, by set.
 * @param {Set<string>} [props.movedSpreadIds] The spreads the user moved within their species.
 * @param {Function} [props.onRevertGroup] Puts a set's species group back in its saved place.
 * @param {Function} [props.onRevertSpread] Puts a spread back in its saved place within its species.
 * @param {Function} [props.onTransfer] Moves a spread into another set, optionally before a spread there.
 * @param {Function} [props.getTransferProblem] Returns why a spread cannot move into a set, or nothing.
 * @param {Function} [props.onAdd] Opens Add Spread after each set's last visible spread.
 * @returns {JSX.Element} The grid.
 */
const SpreadGrid = ({ spreads, renderCard, getSetHeading, pageSize, onPageSizeChange, resetKey, onClearFilters, getSpeciesName,
    activeSet, allEntries, orders, reveal, hiddenIds = NO_IDS, onOrder, onRevertOrder, movedGroups = NO_GROUPS, movedSpreadIds = NO_IDS,
    onRevertGroup = null, onRevertSpread = null, onTransfer = null, getTransferProblem = null, onAdd = null, sets = NO_SETS, availableSpreads = spreads }) =>
{
    const containerRef = useRef(null);
    const width = useWidth(containerRef);
    const capacity = width > 0 ? getRowCapacity(width, MIN_CARD_WIDTH, CARD_GAP) : DEFAULT_CAPACITY;
    const [placing, setPlacing] = useState(null);
    // Show matching spreads, plus the filtered-out peers of any expanded species group that has a match
    const [expansion, setExpansion] = useState({ resetKey, keys: new Set() });
    const expandedKeys = expansion.resetKey === resetKey ? expansion.keys : NO_IDS;
    const matchingIds = useMemo(() => new Set(spreads.map(({ id }) => id)), [spreads]);
    const matchingGroups = useMemo(() => groupSpreads(spreads), [spreads]);
    const availableGroups = useMemo(() => new Map(groupSpreads(availableSpreads.filter(({ id }) => !hiddenIds.has(id)))
        .map((group) => [JSON.stringify([group.setId, group.species]), group])), [availableSpreads, hiddenIds]);
    const displayedSpreads = useMemo(() => availableSpreads.filter((item) => !hiddenIds.has(item.id) && (matchingIds.has(item.id)
        || (expandedKeys.has(JSON.stringify([item.setId, item.species])) && matchingGroups.some((group) => group.setId === item.setId && group.species === item.species)))),
    [availableSpreads, hiddenIds, matchingIds, expandedKeys, matchingGroups]);
    const items = useMemo(() => new Map(displayedSpreads.map((item) => [item.id, item])), [displayedSpreads]);
    const groups = useMemo(() => groupSpreads(displayedSpreads), [displayedSpreads]);

    /**
     * Clears group expansions when the filters change.
     */
    useEffect(() =>
    {
        setExpansion({ resetKey, keys: new Set() });
    }, [resetKey]);

    /**
     * Validates whole-group movement against each set's complete visible order.
     * @returns {Map<string, string>} The blocking reason for each visible set.
     */
    const reorderReasons = useMemo(() =>
    {
        const reasons = new Map();
        for (const { setId } of groups)
        {
            if (reasons.has(setId))
                continue;
            const set = sets.get(setId) ?? (activeSet?.id === setId ? activeSet : null);
            const full = (orders[setId] ?? set?.entryIds ?? []).filter((id) => !hiddenIds.has(id));
            const complete = full.every((id) => items.get(id)?.setId === setId);
            reasons.set(setId, !set?.canReorder ? REORDER_BLOCKED_REASON : !complete ? HIDDEN_SPREADS_REASON : "");
        }
        return reasons;
    }, [groups, sets, activeSet, orders, hiddenIds, items]);
    const placingGroup = placing != null && placing.resetKey === resetKey && reorderReasons.get(placing.setId) === "" ? placing : null;

    const rows = useMemo(() => buildRows(groups, capacity), [groups, capacity]);
    const blockSizes = useMemo(() => rows.reduce((sizes, row) => sizes.set(row.block, (sizes.get(row.block) ?? 0) + 1), new Map()), [rows]);
    const pages = useMemo(() => paginateRows(rows, pageSize), [rows, pageSize]);
    const [dragging, setDragging] = useState(null);
    const [pendingGroup, setPendingGroup] = useState(null);
    const [announcement, setAnnouncement] = useState("");

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
     * Reveals a moved spread even if its destination crossed a page boundary.
     */
    useEffect(() =>
    {
        if (reveal?.id)
            setAnchor({ resetKey, id: reveal.id });
    }, [reveal, resetKey]);

    /**
     * Returns why a spread cannot be moved within its species, or nothing when it can.
     *
     * @param {object} item The visible spread.
     * @returns {string} The reason.
     */
    const getMoveReason = (item) =>
    {
        const set = sets.get(item?.setId) ?? (activeSet?.id === item?.setId ? activeSet : null);
        if (!set?.canReorder)
            return REORDER_BLOCKED_REASON;
        const group = groups.find((candidate) => candidate.setId === item.setId && candidate.species === item.species);
        const full = (orders[item.setId] ?? set.entryIds).filter((entryId) => !hiddenIds.has(entryId));
        return group == null || group.ids.length !== full.filter((entryId) => (items.get(entryId)?.species ?? allEntries.get(entryId)?.fields.species) === item.species).length
            ? "Some spreads of this species are hidden by the filters." : "";
    };

    /**
     * Validates a drop for the dragged spread.
     *
     * @param {object} target The drop target.
     * @param {object|null} [source] The dragged spread.
     * @returns {boolean} Whether the drop is allowed.
     */
    const canDrop = (target, source = dragging) => canDropSpread(source, target,
        (id) => allEntries.get(id)?.editable === true && !getMoveReason(items.get(id)),
        onTransfer == null ? null : getTransferProblem);

    /**
     * Moves a spread within its own set when all its species peers are visible.
     *
     * @param {string} id The moving spread.
     * @param {string} targetId Its destination.
     * @returns {void} Nothing.
     */
    const moveEntry = (id, targetId) =>
    {
        const item = items.get(id);
        if (item == null || !allEntries.get(id)?.editable || item.species !== items.get(targetId)?.species || item.setId !== items.get(targetId)?.setId || getMoveReason(item))
            return;
        const set = sets.get(item.setId) ?? activeSet;
        const order = orders[set.id] ?? set.entryIds;
        const next = moveSpread(order, allEntries, id, targetId);
        if (next !== order)
        {
            onOrder(set.id, next, id, [id]);
            setAnnouncement(`Moved ${getSpeciesName(item.species)} spread.`);
        }
    };

    /**
     * Moves a whole species group before another group or to the end, asking first if interleaved source slots
     * would be coalesced.
     *
     * @param {string} setId The moving group's set.
     * @param {string} species The moving species.
     * @param {string|null} beforeSpecies The group to move before, or nothing for the end.
     * @returns {void} Nothing.
     */
    const moveGroup = (setId, species, beforeSpecies) =>
    {
        const set = sets.get(setId) ?? (activeSet?.id === setId ? activeSet : null);
        if (reorderReasons.get(setId) !== "" || !set)
            return;
        const order = orders[setId] ?? set.entryIds;
        const orderGroups = groupSpreads(order.map((id) => ({ id, species: allEntries.get(id).fields.species, setId })));
        const source = orderGroups.findIndex((group) => group.species === species);
        const gap = beforeSpecies == null ? orderGroups.length : orderGroups.findIndex((group) => group.species === beforeSpecies);
        const proposed = moveSpeciesGroup(order, allEntries, species, getGapTarget(source, gap));
        if (proposed.order === order)
            return;
        const moved = proposed.order.filter((id) => allEntries.get(id).fields.species === species);
        if (proposed.coalesces)
            setPendingGroup({ setId, ...proposed, moved, species });
        else
        {
            onOrder(setId, proposed.order, moved[0], [`${GROUP_MOVE_PREFIX}${species}`]);
            setAnnouncement(`Moved ${getSpeciesName(species)} group.`);
        }
    };

    /**
     * Places the group being moved before another group, or at the end of its set.
     *
     * @param {string|null} beforeSpecies The group to move before, or nothing for the end.
     * @returns {void} Nothing.
     */
    const placeGroup = (beforeSpecies) =>
    {
        if (placingGroup == null)
            return;
        setPlacing(null);
        moveGroup(placingGroup.setId, placingGroup.species, beforeSpecies);
    };

    /**
     * Applies a finished peer reorder or transfer using the event's source.
     *
     * @param {object} event The dnd-kit event.
     * @returns {void} Nothing.
     */
    const endDrag = (event) =>
    {
        const source = event.operation.source?.data;
        const target = event.operation.target?.data;
        const allowed = source != null && target != null && !event.canceled && canDrop(target, source);
        setDragging(null);
        if (!allowed)
            return;
        if (source.setId === target.setId)
            moveEntry(source.id, target.id);
        else
        {
            onTransfer(source.id, target.setId, target.id ?? null);
            setAnnouncement(`Moved ${getSpeciesName(source.species)} spread to ${getSetHeading(target.setId).title}.`);
        }
    };

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

    /**
     * Toggles a species' filtered-out peers and keeps its matching spread in view.
     * @param {object} group The displayed species group.
     * @returns {void} Nothing.
     */
    const toggleGroup = (group) =>
    {
        const key = JSON.stringify([group.setId, group.species]);
        const keys = new Set(expandedKeys);
        if (keys.has(key))
            keys.delete(key);
        else
            keys.add(key);
        setExpansion({ resetKey, keys });
        setAnchor({ resetKey, id: group.ids.find((id) => matchingIds.has(id)) });
    };

    /**
     * Opens the page picker at the current page.
     */
    const openJump = () =>
    {
        setJumpValue(String(pageIndex + FIRST_PAGE));
        setJumpOpen(true);
    };

    /**
     * Selects the current page after the dialog focuses its input.
     * @param {React.FocusEvent<HTMLInputElement>} event The input focus.
     * @returns {void} Nothing.
     */
    const selectJumpValue = (event) =>
    {
        event.target.select();
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

    /**
     * Renders one row: each species in it is a segment spanning its cards, headed by the group's controls in its
     * first row. While a group is being placed, a Move Here place sits before each group it can move in front of.
     *
     * @param {object} row The row.
     * @returns {JSX.Element} The row.
     */
    const renderRow = (row) =>
    {
        const setGroups = groups.filter((group) => group.setId === row.setId);
        const placingHere = placingGroup?.setId === row.setId;
        const source = placingHere ? setGroups.findIndex((group) => group.species === placingGroup.species) : -1;

        /**
         * Excludes places that leave the moving group in its current position.
         * @param {number} gap The place before a group.
         * @returns {boolean} Whether the place is available.
         */
        const canPlace = (gap) => placingHere && gap !== source && gap !== source + 1;
        const set = sets.get(row.setId) ?? (activeSet?.id === row.setId ? activeSet : null);
        const insertDisabled = set?.canInsert === false;
        const insertReason = set?.insertBlockedReason ?? INSERT_BLOCKED_REASON;
        const sectionEnd = row.ids.at(-1) === setGroups.at(-1).ids.at(-1);
        const addCard = onAdd != null && placingGroup == null && sectionEnd;
        const addInRow = addCard && row.ids.length < capacity;

        // Rows of a species spanning several rows keep one width so its cards line up
        const columns = capacity >= MIN_WIDENED_CAPACITY && !addInRow && row.ids.length === capacity - 1 && blockSizes.get(row.block) === 1 ? capacity - 1 : capacity;
        const headed = row.species.some((species) => row.ids.includes(setGroups.find((group) => group.species === species).ids[0]));

        const shared = row.species.length > 1;
        const previousRow = page[page.indexOf(row) - 1];
        const firstGroup = setGroups.find((group) => group.species === row.species[0]);
        const previousProvidesGap = previousRow?.setId === row.setId && previousRow.species.at(-1) !== row.species[0];
        const beforeGap = !shared && row.ids.includes(firstGroup.ids[0]) && !previousProvidesGap
            && canPlace(setGroups.indexOf(firstGroup)) ? firstGroup : null;

        // A completed row owns its trailing place, even when the next group is on another page
        const nextGap = setGroups.findIndex((group) => group.species === row.species.at(-1)) + 1;
        const lastGroup = setGroups[nextGap - 1];
        const completesGroup = row.ids.at(-1) === lastGroup.ids.at(-1);
        const nextGroup = completesGroup && nextGap < setGroups.length && canPlace(nextGap) ? setGroups[nextGap] : null;
        const endGap = row.ids.at(-1) === setGroups.at(-1).ids.at(-1) && canPlace(setGroups.length);
        const trailingGap = nextGroup != null
            ? { key: "gap-next", label: `Move Here, before ${getSpeciesName(nextGroup.species)}`, species: nextGroup.species }
            : endGap ? { key: "gap-end", label: "Move Here, at the end", species: null } : null;

        // Move Here places stand in narrow columns of their own, between the groups of a row
        const template = [];
        const cells = [];
        for (const species of row.species)
        {
            const position = setGroups.findIndex((group) => group.species === species);
            const group = setGroups[position];
            if (shared && row.ids.includes(group.ids[0]) && canPlace(position) && (species !== row.species[0] || !previousProvidesGap))
            {
                template.push("max-content");
                cells.push({ gap: { key: `gap-${species}`, label: `Move Here, before ${getSpeciesName(species)}`, species } });
            }
            const ids = row.ids.filter((id) => group.ids.includes(id));
            template.push(...ids.map(() => "minmax(0, 1fr)"));
            cells.push({ group, ids });
        }
        if (shared && trailingGap != null)
        {
            template.push("max-content");
            cells.push({ gap: trailingGap });
        }
        template.push(...Array(Math.max(0, columns - row.ids.length)).fill("minmax(0, 1fr)"));
        const placingRow = cells.some((cell) => cell.gap != null);
        let column = 1;

        return (
            <React.Fragment key={row.ids[0]}>
                {beforeGap != null &&
                    <GroupGap label={`Move Here, before ${getSpeciesName(beforeGap.species)}`} onPlace={() => placeGroup(beforeGap.species)} />}
                <div className={`spread-row${headed ? " with-headers" : ""}`}
                     style={{ gridTemplateColumns: placingRow ? template.join(" ") : `repeat(${columns}, minmax(0, 1fr))` }}>
                    {cells.map((cell) =>
                    {
                        const start = column;
                        if (cell.gap != null)
                        {
                            column += 1;
                            return (
                                <div key={cell.gap.key} className="group-gap-cell" style={{ gridColumn: `${start} / span 1` }}>
                                    <GroupGap vertical label={cell.gap.label} onPlace={() => placeGroup(cell.gap.species)} />
                                </div>
                            );
                        }

                        const { group, ids } = cell;
                        const { species } = group;
                        column += ids.length;
                        const moving = placingHere && placingGroup.species === species;
                        const first = ids[0] === group.ids[0];
                        const groupMoved = movedGroups.get(row.setId)?.has(species) && onRevertGroup != null;
                        const groupKey = JSON.stringify([row.setId, species]);
                        const expanded = expandedKeys.has(groupKey);
                        const hasMore = availableGroups.get(groupKey)?.ids.some((id) => !matchingIds.has(id));
                        return (
                            <div key={species} className={`species-segment${first ? " has-header" : ""}${moving ? " is-moving" : ""}`}
                                 style={{ gridColumn: `${start} / span ${ids.length}` }}>
                                {first &&
                                    <GroupHeader name={getSpeciesName(species)} reason={reorderReasons.get(row.setId)} placing={moving}
                                                 onMove={() => setPlacing(moving ? null : { setId: row.setId, species, resetKey })}
                                                 expanded={expanded} onToggle={hasMore || expanded ? () => toggleGroup(group) : null}
                                                 onRevert={groupMoved ? () => onRevertGroup(row.setId, species) : null} />}
                                {ids.map((id) =>
                                    <MovableSpread key={id} item={items.get(id)} name={getSpeciesName(species)}
                                                   revealed={!matchingIds.has(id)}
                                                   dragReason={allEntries.get(id)?.editable ? "" : UNEDITABLE_REASON}
                                                   moveReason={allEntries.get(id)?.editable ? getMoveReason(items.get(id)) : UNEDITABLE_REASON}
                                                   leftId={group.ids[group.ids.indexOf(id) - 1] ?? null}
                                                   rightId={group.ids[group.ids.indexOf(id) + 1] ?? null} onMove={moveEntry}
                                                   dropAllowed={canDrop(items.get(id))} renderCard={renderCard}
                                                   onRevert={movedSpreadIds.has(id) && onRevertSpread != null ? () => onRevertSpread(id) : null} />)}
                            </div>
                        );
                    })}
                    {addInRow && <AddSpreadCard disabled={insertDisabled} reason={insertReason} onAdd={() => onAdd(row.setId)} />}
                </div>
                {!shared && trailingGap != null && <GroupGap label={trailingGap.label} onPlace={() => placeGroup(trailingGap.species)} />}
                {addCard && !addInRow &&
                    <div className="spread-row" style={{ gridTemplateColumns: `repeat(${capacity}, minmax(0, 1fr))` }}>
                        <AddSpreadCard disabled={insertDisabled} reason={insertReason} onAdd={() => onAdd(row.setId)} />
                    </div>}
            </React.Fragment>
        );
    };

    /**
     * Remembers which spread is being dragged so valid drop targets can be lit up.
     *
     * @param {object} event The dnd-kit event.
     */
    const startDrag = (event) =>
    {
        const data = event.operation.source?.data;
        setDragging(data?.kind === DRAG_SPREAD ? data : null);
    };

    return (
        <DragDropProvider onDragStart={startDrag} onDragEnd={endDrag}>
        <div className="spread-grid" ref={containerRef}>
            <span className="visually-hidden" aria-live="polite">{announcement}</span>
            <Stack direction="row" className="spread-grid-bar">
                <Typography variant="body2" role="status">
                    {displayedSpreads.length === 0 ? "No spreads" : `Showing ${firstShown + 1}-${firstShown + shownCount} of ${displayedSpreads.length} spreads`}
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
            {placingGroup != null &&
                <Alert severity="info" className="placing-alert" action={<Button color="inherit" size="small" onClick={() => setPlacing(null)}>Cancel</Button>}>
                    Choose Move Here where the {getSpeciesName(placingGroup.species)} group should go. You can change pages first.
                </Alert>}
            {getSections(page).map((section, index) =>
            {
                const heading = getSetHeading(section.setId);
                return (
                    <section key={section.setId} className="spread-section" aria-label={`${heading.title} spreads`}>
                        <SetHeading setId={section.setId} dropAllowed={canDrop({ setId: section.setId })}>
                            <Typography component="h2" variant="subtitle1" className="spread-section-title">
                                {heading.title}{index === 0 && section.setId === continuedSet ? " (continued)" : ""}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">{heading.file}</Typography>
                            {hasOrderChange(sets.get(section.setId) ?? (activeSet?.id === section.setId ? activeSet : null), orders[section.setId], allEntries)
                                && <Button size="small" onClick={() => onRevertOrder(section.setId)}>Revert Order</Button>}
                        </SetHeading>
                        {section.rows.map(renderRow)}
                    </section>
                );
            })}
            {pages.length > 1 && <Stack direction="row" className="spread-grid-bar spread-grid-bottom">{pagination}</Stack>}
            <Dialog open={jumpOpen} onClose={() => setJumpOpen(false)} aria-labelledby="jump-page-title" fullWidth maxWidth="xs">
                <form onSubmit={submitJump} noValidate>
                    <DialogTitle id="jump-page-title">Jump to Page ({pages.length} Pages)</DialogTitle>
                    <DialogContent>
                        <TextField autoFocus fullWidth type="number" value={jumpValue}
                                   onFocus={selectJumpValue} onChange={changeJumpValue} error={jumpValue !== "" && !PAGE_NUMBER_PATTERN.test(jumpValue)}
                                   slotProps={{ htmlInput: { "aria-label": "Page", min: FIRST_PAGE, max: pages.length, step: 1 } }} />
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setJumpOpen(false)}>Cancel</Button>
                        <Button type="submit" color="focus" disabled={!PAGE_NUMBER_PATTERN.test(jumpValue)}>Go</Button>
                    </DialogActions>
                </form>
            </Dialog>
            <Dialog open={pendingGroup != null} onClose={() => setPendingGroup(null)} aria-labelledby="group-order-title">
                <DialogTitle id="group-order-title">Move Species Group?</DialogTitle>
                <DialogContent>
                    <Typography>
                        Spreads of different species are interleaved in this set's source. Moving {pendingGroup && getSpeciesName(pendingGroup.species)} will
                        put each species' spreads next to each other.
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setPendingGroup(null)}>Cancel</Button>
                    <Button onClick={() =>
                    {
                        onOrder(pendingGroup.setId, pendingGroup.order, pendingGroup.moved[0], [`${GROUP_MOVE_PREFIX}${pendingGroup.species}`]);
                        setAnnouncement(`Moved ${getSpeciesName(pendingGroup.species)} group.`);
                        setPendingGroup(null);
                    }}>Move Group</Button>
                </DialogActions>
            </Dialog>
        </div>
        <DragOverlay>
            {dragging != null && <div className="spread-drag-overlay">{getSpeciesName(dragging.species)} spread</div>}
        </DragOverlay>
        </DragDropProvider>
    );
};

export default SpreadGrid;
