/**
 * This file defines the spread editor's shared state.
 * It owns repository setup, workspace and game loading, saved settings, unsaved spread changes and requests to
 * the local server.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import axios from "axios";
import { StatusCode } from "status-code-enum";

import { LEGALITY, getMoveLegality } from "../shared/catalog.mjs";
import { DEFAULT_PREVIEW_LEVEL } from "../shared/pokemon-mechanics.mjs";
import
{
    GROUP_MOVE_PREFIX, getMovedIds, getMovedSpreadIds, getSavedOrder, hasOrderChange, insertSpread, restoreGroupPosition,
    restoreSpreadInGroup,
} from "../shared/spread-layout.mjs";
import { BATTLE_TYPES, compactMoves, getBattleType, getChangedFields, isSpreadChanged, setMove, validateSpreadFields } from "../shared/spread-model.mjs";
import { config } from "./components/ServerConfig";
import { getLearnableMoveOptions } from "./subcomponents/MovePicker";

export const SETTINGS_STORAGE_KEY = "cfruSpreadEditor.settings";
export const SETTINGS_VERSION = 1;
export const DRAFTS_STORAGE_KEY = "cfruSpreadEditor.unsavedChanges";
export const DRAFTS_VERSION = 1;
export const REPOSITORY_KINDS = ["cfru", "dpe", "cloud"];
export const REPOSITORY_LABELS =
{
    cfru: "Complete Fire Red Upgrade",
    dpe: "Dynamic Pokemon Expansion",
    cloud: "Unbound Cloud",
};

export const EDITOR_PHASE = Object.freeze(
{
    STARTING: "starting",
    SETUP: "setup",
    LOADING: "loading",
    SELECT_GAME: "selectGame",
    LOADING_CATALOG: "loadingCatalog",
    READY: "ready",
});

const API_BASE = `${config.devServer}/api`;
const SESSION_HEADER = "X-Session-Token";
const MAX_REQUEST_ATTEMPTS = 2;
const ARCHIVE_FILENAME = "spread-editor-reqs.zip";
const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
const ARCHIVE_CONTENT_TYPE = "application/zip";
const PROGRESS_POLL_INTERVAL = 250;
const UPLOAD_PROGRESS_LIMIT = 20;
const PENDING_PROGRESS_LIMIT = 99;
const PICKER_SELECTED = "selected";
const ERROR_WORKSPACE_NOT_FOUND = "WORKSPACE_NOT_FOUND";
const ERROR_VALIDATION_FAILED = "REPOSITORY_VALIDATION_FAILED";
const ERROR_SERVER_UNREACHABLE = "SERVER_UNREACHABLE";
const ERROR_SERVER_RESPONSE = "SERVER_ERROR";
const ERROR_OPERATION_CANCELLED = "OPERATION_CANCELLED";
const EMPTY_PATHS = Object.freeze({ cfru: "", dpe: "", cloud: "" });
const MISSING_GAME_NOTICE = "The previously selected game is no longer available in Unbound Cloud. Choose a game to continue.";
const RESTART_CHANGED_MESSAGE = "The editor server restarted and the spread files changed since they were loaded, so these changes cannot be saved. Load the repositories again.";
const OPERATION_UPDATE = "update";
const OPERATION_DELETE = "delete";
const OPERATION_ADD = "add";
const OPERATION_REORDER = "reorder";
const MOVES_FIELD = "moves";
const EMPTY_MOVE = 0;
const MOVE_NONE = "MOVE_NONE";
const EMPTY_INDEX = Object.freeze({ entries: new Map(), sets: new Map() });

const ACTION =
{
    SHOW_SETUP: "showSetup",
    SET_PATH: "setPath",
    PICK_START: "pickStart",
    PICK_END: "pickEnd",
    LOAD_START: "loadStart",
    LOAD_SUCCESS: "loadSuccess",
    LOAD_FAILURE: "loadFailure",
    CATALOG_START: "catalogStart",
    CATALOG_SUCCESS: "catalogSuccess",
    CATALOG_FAILURE: "catalogFailure",
    CHANGE_REPOSITORIES: "changeRepositories",
    CHANGE_GAME: "changeGame",
    CANCEL_CHANGE: "cancelChange",
    STORAGE_UNAVAILABLE: "storageUnavailable",
    UPDATE_SPREAD: "updateSpread",
    ADD_SPREAD: "addSpread",
    TRANSFER_SPREAD: "transferSpread",
    ORDER_SET: "orderSet",
    REVERT_ORDER: "revertOrder",
    REVERT_GROUP: "revertGroup",
    REVERT_SPREAD_ORDER: "revertSpreadOrder",
    APPLY_CHANGES: "applyChanges",
    REVERT_SPREAD: "revertSpread",
    DELETE_SPREAD: "deleteSpread",
    RESTORE_SPREAD: "restoreSpread",
    DISCARD_CHANGES: "discardChanges",
    SET_EDITING: "setEditing",
    SET_PREVIEW: "setPreview",
    SAVE_START: "saveStart",
    SAVE_SUCCESS: "saveSuccess",
    SAVE_FAILURE: "saveFailure",
    CLEAR_SAVE_ERROR: "clearSaveError",
    REPLACE_WORKSPACE: "replaceWorkspace",
    ARCHIVE_START: "archiveStart",
    ARCHIVE_END: "archiveEnd",
    PROGRESS: "progress",
};

const EMPTY_DRAFTS =
{
    drafts: {},
    newEntries: {},
    orders: {},
    orderMoves: {},
    deleted: new Set(),
    modifyMemory: {},
    editing: new Set(),
    saving: false,
    saveError: null,
};

const INITIAL_STATE =
{
    phase: EDITOR_PHASE.STARTING,
    paths: EMPTY_PATHS,
    fieldErrors: {},
    error: null,
    notice: null,
    pickingKind: null,
    workspace: null,
    gameId: "",
    catalog: null,
    storageUnavailable: false,
    downloading: false,
    archiveError: null,
    setupProgress: null,
    archiveProgress: null,
    spreadIndex: EMPTY_INDEX,
    preview: { level: DEFAULT_PREVIEW_LEVEL },
    ...EMPTY_DRAFTS,
};

const SpreadEditorContext = createContext(null);


/**
 * Reads the saved repository paths and game, ignoring missing, malformed, outdated or blocked storage.
 *
 * @returns {{paths: Object<string, string>, gameId: string}} The saved settings.
 */
export function readStoredSettings()
{
    const settings = { paths: { ...EMPTY_PATHS }, gameId: "" };

    try
    {
        // Settings from another version are discarded rather than migrated
        const saved = JSON.parse(window.localStorage.getItem(SETTINGS_STORAGE_KEY));
        if (saved?.version !== SETTINGS_VERSION)
            return settings;

        // Keep only correctly typed values
        for (const kind of REPOSITORY_KINDS)
        {
            if (typeof saved.paths?.[kind] === "string")
                settings.paths[kind] = saved.paths[kind];
        }

        if (typeof saved.gameId === "string")
            settings.gameId = saved.gameId;
    }
    catch
    {
        // Unreadable settings are treated as a first launch
    }

    return settings;
}

/**
 * Saves the repository paths and game.
 *
 * @param {Object<string, string>} paths The repository paths.
 * @param {string} gameId The selected game.
 * @returns {boolean} Whether the settings were saved.
 */
export function writeStoredSettings(paths, gameId)
{
    try
    {
        window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ version: SETTINGS_VERSION, paths, gameId }));
        return true;
    }
    catch
    {
        return false;
    }
}

/**
 * Converts a failed request into a plain error object.
 *
 * @param {Error} error The axios error.
 * @returns {{status?: number, code: string, message: string, details?: object}} The error.
 */
function toApiError(error)
{
    // The server explained the problem
    const body = error.response?.data?.error;
    if (body?.code)
        return { status: error.response.status, code: body.code, message: body.message, details: body.details };

    // Something else answered, such as a proxy error page
    if (error.response)
        return { status: error.response.status, code: ERROR_SERVER_RESPONSE, message: "The editor server returned an unexpected response." };

    // Nothing answered at all
    return {
        code: ERROR_SERVER_UNREACHABLE,
        message: "Could not reach the local editor server. Start it by running \"yarn start\" in the server folder, then try again.",
    };
}

/**
 * Reads the unsaved changes kept from an earlier visit, ignoring missing, malformed or outdated storage.
 *
 * @returns {object|null} The stored changes.
 */
export function readStoredDrafts()
{
    try
    {
        const saved = JSON.parse(window.localStorage.getItem(DRAFTS_STORAGE_KEY));
        return saved?.version === DRAFTS_VERSION ? saved : null;
    }
    catch
    {
        return null;
    }
}

/**
 * Keeps the unsaved changes in storage, with the saved values they were made against, or clears them when there are none.
 *
 * @param {object} state The editor state.
 */
function writeStoredDrafts(state)
{
    try
    {
        const ids = new Set([...Object.keys(state.drafts), ...state.deleted, ...Object.values(state.orders).flatMap((order) => order)]);
        if (ids.size === 0)
        {
            window.localStorage.removeItem(DRAFTS_STORAGE_KEY);
            return;
        }

        const saved = Object.fromEntries([...ids].filter((id) => !state.newEntries[id]).map((id) =>
        {
            const entry = state.spreadIndex.entries.get(id);
            return [id, { setId: entry?.setId, fields: entry?.fields }];
        }));
        window.localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(
        {
            version: DRAFTS_VERSION,
            revision: state.workspace.spreads.revision,
            drafts: state.drafts,
            newEntries: state.newEntries,
            orders: state.orders,
            orderMoves: state.orderMoves,
            deleted: [...state.deleted],
            modifyMemory: state.modifyMemory,
            saved,
        }));
    }
    catch
    {
        // Blocked or full storage only loses the crash backup
    }
}

/**
 * Returns the stored unsaved changes that still apply: the spread files must be unchanged, and each spread must
 * still have the values the change was made against.
 *
 * @param {object} state The editor state with the loaded workspace.
 * @param {object|null} stored The stored changes.
 * @returns {object} The drafts, deleted spreads and remembered values to use, or nothing.
 */
function restoreDrafts(state, stored)
{
    if (stored == null || stored.revision !== state.workspace?.spreads.revision || Object.keys(state.drafts).length > 0 || state.deleted.size > 0)
        return {};

    const matches = (id) =>
    {
        const entry = state.spreadIndex.entries.get(id);
        const saved = stored.saved?.[id];
        return entry?.editable === true && saved?.setId === entry.setId && JSON.stringify(saved.fields) === JSON.stringify(entry.fields);
    };

    const deleted = new Set((Array.isArray(stored.deleted) ? stored.deleted : []).filter(matches));

    // A spread moved to another set needs its original to still be deleted
    const newEntries = Object.fromEntries(Object.entries(stored.newEntries ?? {}).filter(([id, entry]) =>
        /^new-[A-Za-z0-9_-]{1,59}$/.test(id) && entry?.id === id && state.spreadIndex.sets.get(entry.setId)?.canInsert
        && state.catalog?.species?.[entry.fields?.species] && Array.isArray(stored.drafts?.[id]?.moves)
        && (entry.movedFrom == null || deleted.has(entry.movedFrom))));
    const spreadIndex = { ...state.spreadIndex, entries: new Map([...state.spreadIndex.entries, ...Object.entries(newEntries)]) };
    const drafts = {};
    for (const [id, fields] of Object.entries(stored.drafts ?? {}))
    {
        if ((matches(id) || newEntries[id]) && Array.isArray(fields?.moves))
            putDraft({ ...state, newEntries }, drafts, id, fields);
    }

    const modifyMemory = Object.fromEntries(Object.entries(stored.modifyMemory ?? {}).filter(([id]) => matches(id)));
    const orders = Object.fromEntries(Object.entries(stored.orders ?? {}).filter(([setId, order]) =>
    {
        const set = state.spreadIndex.sets.get(setId);
        const expected = [...(set?.entryIds ?? []), ...Object.keys(newEntries).filter((id) => newEntries[id].setId === setId)];
        if (set == null || !Array.isArray(order) || order.length !== expected.length || new Set(order).size !== expected.length
            || !order.every((id) => expected.includes(id)) || !set.entryIds.every((id) => matches(id)))
            return false;

        // Sets that cannot be reordered only keep the positions of their new spreads
        return set.canReorder || order.filter((id) => !newEntries[id]).every((id, index) => set.entryIds[index] === id);
    }));
    const orderMoves = Object.fromEntries(Object.entries(stored.orderMoves ?? {}).filter(([setId, moves]) => orders[setId] && Array.isArray(moves))
        .map(([setId, moves]) => [setId, moves.filter((id) => typeof id === "string" && (id.startsWith(GROUP_MOVE_PREFIX) || orders[setId].includes(id)))]));

    // New spreads whose order was not kept go back to their default place
    for (const [id, entry] of Object.entries(newEntries))
    {
        if (!orders[entry.setId]?.includes(id))
            orders[entry.setId] = insertSpread(orders[entry.setId] ?? state.spreadIndex.sets.get(entry.setId).entryIds, spreadIndex.entries, id);
    }
    for (const setId of Object.keys(orders))
        dropUnchangedOrder(spreadIndex, orders, orderMoves, setId);
    return { drafts, deleted, modifyMemory, newEntries, orders, orderMoves, spreadIndex };
}

/**
 * Returns whether every repository path has been entered.
 *
 * @param {Object<string, string>} paths The repository paths.
 * @returns {boolean} Whether all paths are present.
 */
export function hasAllPaths(paths)
{
    return REPOSITORY_KINDS.every((kind) => paths[kind]?.trim());
}

/**
 * Indexes a spreads snapshot by entry and set ID.
 *
 * @param {object|undefined} spreads The spreads snapshot.
 * @returns {{entries: Map<string, object>, sets: Map<string, object>}} The lookups.
 */
function indexSpreads(spreads)
{
    if (spreads == null)
        return EMPTY_INDEX;

    return {
        entries: new Map(spreads.entries.map((entry) => [entry.id, entry])),
        sets: new Map(spreads.sets.map((set) => [set.id, set])),
    };
}

/**
 * Returns state for a new workspace, dropping changes made to the previous one.
 *
 * @param {object} state The current state.
 * @param {object} workspace The workspace snapshot.
 * @returns {object} The workspace part of the state.
 */
function withWorkspace(state, workspace)
{
    if (workspace === state.workspace)
        return { workspace };

    return { workspace, spreadIndex: indexSpreads(workspace?.spreads), ...EMPTY_DRAFTS, editing: new Set() };
}

/**
 * Stores a spread's new values, dropping the draft when they match the saved values again.
 *
 * @param {object} state The current state.
 * @param {Object<string, object>} drafts The drafts to update in place.
 * @param {string} id The spread ID.
 * @param {object} fields The new values.
 */
function putDraft(state, drafts, id, fields)
{
    const entry = state.newEntries[id] ?? state.spreadIndex.entries.get(id);
    if (entry == null || !entry.editable)
        return;

    if (state.newEntries[id] != null)
    {
        drafts[id] = fields;
        return;
    }

    if (isSpreadChanged(fields, entry.fields))
        drafts[id] = fields;
    else
        delete drafts[id];
}

/**
 * Returns the drafts left after a save: changes made while it was in progress stay unsaved.
 *
 * @param {Object<string, object>} drafts The current drafts.
 * @param {Object<string, object>} submitted The drafts that were saved.
 * @param {Map<string, object>} entries The saved spreads by ID.
 * @returns {Object<string, object>} The remaining drafts.
 */
function getDraftsAfterSave(drafts, submitted, entries)
{
    return Object.fromEntries(Object.entries(drafts).filter(([id, fields]) =>
        fields !== submitted[id] && entries.has(id) && isSpreadChanged(fields, entries.get(id).fields)));
}

/**
 * Finds the problems that stop unsaved changes from being saved.
 *
 * @param {Object<string, object>} drafts The changed spreads.
 * @param {Map<string, object>} entries The saved spreads by ID.
 * @param {object|null} catalog The game catalog.
 * @returns {Array<{id: string, field: string, message: string}>} The problems.
 */
export function findSaveProblems(drafts, entries, catalog)
{
    const problems = [];
    for (const [id, fields] of Object.entries(drafts))
    {
        const saved = entries.get(id)?.fields ?? {};
        problems.push(...validateSpreadFields(fields).map((problem) => ({ id, ...problem })));
        if (entries.get(id)?.isNew && !fields.moves.some((move) => typeof move === "string" && move !== "MOVE_NONE"))
            problems.push({ id, field: MOVES_FIELD, message: "A new spread needs at least one move." });

        // A changed move must exist in the game, or the source would not compile
        fields.moves.forEach((move, slot) =>
        {
            if (catalog != null && move !== saved.moves?.[slot] && getMoveLegality(catalog, fields.species, move).status === LEGALITY.UNDEFINED)
                problems.push({ id, field: MOVES_FIELD, message: `${move} is not a move in ${catalog.name}.` });
        });
    }

    return problems;
}

/**
 * Drops a set's order once it matches the saved spreads exactly, and its moves once it matches the default order.
 * Orders that only place new spreads stay, since saving needs them to anchor the additions.
 *
 * @param {object} spreadIndex The spread index, including the new spreads.
 * @param {Object<string, Array<string>>} orders The set orders, changed in place.
 * @param {Object<string, Array<string>>} orderMoves The moved spreads by set, changed in place.
 * @param {string} setId The set ID.
 * @returns {void} Nothing.
 */
function dropUnchangedOrder(spreadIndex, orders, orderMoves, setId)
{
    const set = spreadIndex.sets.get(setId);
    const order = orders[setId];
    if (order.length === set.entryIds.length && order.every((id, index) => set.entryIds[index] === id))
        delete orders[setId];
    if (orders[setId] == null || !hasOrderChange(set, order, spreadIndex.entries))
        delete orderMoves[setId];
}

/**
 * Returns the orders after a set's order changes, dropping it once the set is back in its saved order.
 *
 * @param {object} state The current state, with the spread index the order belongs to.
 * @param {string} setId The set ID.
 * @param {Array<string>} order The set's new order.
 * @param {Array<string>} moves The spreads the user moved in this set.
 * @returns {{orders: object, orderMoves: object}} The new orders and moved spreads.
 */
function withOrder(state, setId, order, moves)
{
    const orders = { ...state.orders, [setId]: order };
    const orderMoves = { ...state.orderMoves, [setId]: moves };
    dropUnchangedOrder(state.spreadIndex, orders, orderMoves, setId);
    return { orders, orderMoves };
}

/**
 * Returns the saved spreads moved to another set, which stay deleted in their own set until saved.
 *
 * @param {Object<string, object>} newEntries The new spreads.
 * @returns {Set<string>} The original spread IDs.
 */
export function findTransferredIds(newEntries)
{
    return new Set(Object.values(newEntries).map((entry) => entry.movedFrom).filter((id) => id != null));
}

/**
 * Returns why a spread cannot be moved to another set, or nothing when it can.
 *
 * @param {object} state The editor state.
 * @param {string} id The spread.
 * @param {string} setId The destination set.
 * @returns {string} The reason.
 */
export function getTransferProblem(state, id, setId)
{
    const entry = state.newEntries[id] ?? state.spreadIndex.entries.get(id);
    const target = state.spreadIndex.sets.get(setId);
    if (entry == null || target == null || entry.setId === setId)
        return "The spread is already in this set.";
    if (!entry.editable)
        return "This spread's source cannot be changed safely.";

    // Coming back to the set it was saved in needs no new spread
    const original = state.spreadIndex.entries.get(entry.movedFrom);
    if (original?.setId === setId)
        return "";
    if (!target.canInsert)
        return target.insertBlockedReason ?? "Spreads cannot be added to this set.";
    if (entry.isNew)
        return "";

    // Frontier pools pick from their spreads at random, so a set can never be emptied
    const source = state.spreadIndex.sets.get(entry.setId);
    const remaining = source.entryIds.filter((entryId) => entryId !== id && !state.deleted.has(entryId)).length
        + Object.values(state.newEntries).filter((newEntry) => newEntry.setId === source.id).length;
    return remaining === 0 ? `${source.name} must keep at least one spread.` : "";
}

/**
 * Returns the saved spreads the user moved, across every reordered set.
 *
 * @param {object} state The editor state.
 * @returns {Set<string>} The moved spread IDs.
 */
function findMovedIds(state)
{
    return new Set(Object.entries(state.orders).flatMap(([setId, order]) =>
    {
        const moves = state.orderMoves[setId] ?? [];
        const groups = new Set(moves.filter((move) => move.startsWith(GROUP_MOVE_PREFIX)).map((move) => move.slice(GROUP_MOVE_PREFIX.length)));
        const preferred = new Set([...moves, ...order.filter((id) => groups.has(state.spreadIndex.entries.get(id)?.fields.species))]);
        return [...getMovedIds(state.spreadIndex.sets.get(setId).entryIds, order, preferred)];
    }));
}

/**
 * Returns what the user moved in one set: whole species groups, and spreads within their own species.
 *
 * @param {object} state The editor state.
 * @param {string} setId The set.
 * @param {Array<string>} [order] The order to check, the set's draft order by default.
 * @param {Array<string>} [moves] The spreads the user moved, the set's by default.
 * @returns {{groups: Set<string>, spreads: Set<string>, getSpecies: Function}} The moved species and spreads, and how
 *          a spread's species is read.
 */
function findSetMoves(state, setId, order = state.orders[setId], moves = state.orderMoves[setId] ?? [])
{
    const saved = state.spreadIndex.sets.get(setId).entryIds;
    const getSpecies = (id) => state.spreadIndex.entries.get(id)?.fields.species;
    if (order == null)
        return { groups: new Set(), spreads: new Set(), getSpecies };

    // A group the user moved counts until putting it back would change nothing
    const groups = new Set(moves.filter((move) => move.startsWith(GROUP_MOVE_PREFIX)).map((move) => move.slice(GROUP_MOVE_PREFIX.length))
        .filter((species) => restoreGroupPosition(saved, order, order.filter((id) => getSpecies(id) === species)).some((id, index) => id !== order[index])));
    return { groups, spreads: getMovedSpreadIds(saved, order, getSpecies, new Set(moves)), getSpecies };
}

/**
 * Returns the moved species groups by set, and the spreads moved within their species, across every reordered set.
 *
 * @param {object} state The editor state.
 * @returns {{groups: Map<string, Set<string>>, spreads: Set<string>}} The moves.
 */
function findOrderMoves(state)
{
    const groups = new Map();
    const spreads = new Set();
    for (const setId of Object.keys(state.orders))
    {
        const moves = findSetMoves(state, setId);
        groups.set(setId, moves.groups);
        moves.spreads.forEach((id) => spreads.add(id));
    }

    return { groups, spreads };
}

/**
 * Returns the order the server gives a set when it only adds new spreads after their anchors.
 *
 * @param {object} set The set.
 * @param {Array<{tempId: string, afterEntryId: string|null}>} additions The set's new spreads, in request order.
 * @param {Set<string>} deleted The deleted spreads.
 * @returns {Array<string>} The resulting order.
 */
function getDefaultOrder(set, additions, deleted)
{
    const order = [...set.entryIds];
    const anchors = new Map();
    const lastEntry = set.entryIds.findLast((id) => !deleted.has(id)) ?? null;
    for (const { tempId, afterEntryId } of additions)
    {
        const anchor = afterEntryId ?? lastEntry;
        let index = anchor == null ? order.length : order.indexOf(anchor) + 1;
        while (index < order.length && anchors.get(order[index]) === anchor)
            index++;
        order.splice(index, 0, tempId);
        anchors.set(tempId, anchor);
    }

    return order;
}

/**
 * Returns whether two spreads snapshots hold the same spreads under the same IDs.
 *
 * @param {object} a The first snapshot.
 * @param {object} b The second snapshot.
 * @returns {boolean} Whether they match.
 */
function isSameSpreads(a, b)
{
    return a?.revision === b?.revision && a.sets.length === b.sets.length
        && a.sets.every((set, index) => set.id === b.sets[index].id && set.entryIds.join() === b.sets[index].entryIds.join());
}

/**
 * Updates editor state.
 *
 * @param {object} state The current state.
 * @param {object} action The action.
 * @returns {object} The new state.
 */
function reducer(state, action)
{
    switch (action.type)
    {
        case ACTION.SHOW_SETUP:
            return { ...state, phase: EDITOR_PHASE.SETUP, paths: action.paths, gameId: action.gameId };
        case ACTION.SET_PATH:
            return { ...state, paths: { ...state.paths, [action.kind]: action.value }, fieldErrors: { ...state.fieldErrors, [action.kind]: undefined } };
        case ACTION.PICK_START:
            return { ...state, pickingKind: action.kind, error: null };
        case ACTION.PICK_END:
            if (action.path == null)
                return { ...state, pickingKind: null, error: action.error ?? null };
            return {
                ...state,
                pickingKind: null,
                paths: { ...state.paths, [action.kind]: action.path },
                fieldErrors: { ...state.fieldErrors, [action.kind]: undefined },
            };
        case ACTION.LOAD_START:
            return { ...state, phase: EDITOR_PHASE.LOADING, paths: action.paths, gameId: action.gameId, fieldErrors: {}, error: null, notice: null };
        case ACTION.LOAD_SUCCESS:
            return {
                ...state,
                ...withWorkspace({ ...state, workspace: null }, action.workspace),
                paths: action.paths ?? state.paths,
                phase: EDITOR_PHASE.SELECT_GAME,
                setupProgress: { ...state.setupProgress, percentage: 100 },
                gameId: action.gameId,
                catalog: null,
                notice: action.notice ?? null,
            };
        case ACTION.LOAD_FAILURE:
            if (action.resetWorkspace)
                return { ...state, ...withWorkspace(state, null), phase: EDITOR_PHASE.SETUP, catalog: null, fieldErrors: action.error.details?.fields ?? {}, error: action.error };
            return {
                ...state,
                phase: EDITOR_PHASE.SETUP,
                fieldErrors: action.error.details?.fields ?? {},
                error: action.error,
            };
        case ACTION.CATALOG_START:
            return { ...state, phase: EDITOR_PHASE.LOADING_CATALOG, error: null };
        case ACTION.CATALOG_SUCCESS:
        {
            const next =
            {
                ...state,
                ...withWorkspace(state, action.workspace),
                phase: EDITOR_PHASE.READY,
                gameId: action.catalog.gameId,
                catalog: action.catalog,
                notice: null,
            };
            return { ...next, ...restoreDrafts(next, action.stored) };
        }
        case ACTION.CATALOG_FAILURE:
            return { ...state, phase: EDITOR_PHASE.SELECT_GAME, error: action.error };
        case ACTION.CHANGE_REPOSITORIES:
            return { ...state, phase: EDITOR_PHASE.SETUP, error: null, notice: null };
        case ACTION.CHANGE_GAME:
            return { ...state, phase: EDITOR_PHASE.SELECT_GAME, error: null, notice: null };
        case ACTION.CANCEL_CHANGE:
            if (state.catalog == null)
                return state;
            return {
                ...state,
                phase: EDITOR_PHASE.READY,
                paths: action.paths,
                fieldErrors: {},
                error: null,
            };
        case ACTION.STORAGE_UNAVAILABLE:
            return { ...state, storageUnavailable: true };
        case ACTION.ARCHIVE_START:
            return { ...state, downloading: true, archiveError: null };
        case ACTION.ARCHIVE_END:
            return { ...state, downloading: false, archiveError: action.error ?? null,
                archiveProgress: action.error ? state.archiveProgress : { ...state.archiveProgress, percentage: 100 } };
        case ACTION.PROGRESS:
            return { ...state, [action.key]: action.progress };
        case ACTION.ADD_SPREAD:
        {
            const set = state.spreadIndex.sets.get(action.setId);
            const spreads = action.spreads.filter(({ fields }) => state.catalog?.species?.[fields.species]);
            if (!set?.canInsert || spreads.length === 0)
                return state;

            // Each new spread goes after the last spread of its species, or at the end of the set
            const spreadIndex = { ...state.spreadIndex, entries: new Map(state.spreadIndex.entries) };
            const newEntries = { ...state.newEntries };
            const drafts = { ...state.drafts };
            let order = state.orders[set.id] ?? set.entryIds;
            for (const { id, fields } of spreads)
            {
                const entry = { id, setId: set.id, fields, line: set.line, editable: true, isNew: true, diagnostics: [] };
                spreadIndex.entries.set(id, entry);
                newEntries[id] = entry;
                drafts[id] = fields;
                order = insertSpread(order, spreadIndex.entries, id);
            }

            return { ...state, spreadIndex, newEntries, drafts, orders: { ...state.orders, [set.id]: order },
                editing: action.edit && spreads.length === 1 ? new Set([spreads[0].id]) : state.editing };
        }
        case ACTION.TRANSFER_SPREAD:
        {
            if (getTransferProblem(state, action.id, action.setId))
                return state;

            const entry = state.newEntries[action.id] ?? state.spreadIndex.entries.get(action.id);
            const fields = state.drafts[action.id] ?? entry.fields;
            const spreadIndex = { ...state.spreadIndex, entries: new Map(state.spreadIndex.entries) };
            const newEntries = { ...state.newEntries };
            const drafts = { ...state.drafts };
            const deleted = new Set(state.deleted);
            let next = state;

            // Leave the old set: a new spread is removed from its order, a saved one is deleted there
            if (entry.isNew)
            {
                delete newEntries[action.id];
                delete drafts[action.id];
                spreadIndex.entries.delete(action.id);
                next = { ...next, ...withOrder({ ...next, spreadIndex }, entry.setId, (next.orders[entry.setId] ?? []).filter((id) => id !== action.id),
                    (next.orderMoves[entry.setId] ?? []).filter((id) => id !== action.id)) };
            }
            else
            {
                delete drafts[action.id];
                deleted.add(action.id);
            }

            // Returning to the saved set restores the original spread, keeping any changed values
            const originalId = entry.movedFrom ?? (entry.isNew ? null : action.id);
            const original = state.spreadIndex.entries.get(originalId);
            if (original?.setId === action.setId)
            {
                deleted.delete(originalId);
                putDraft({ ...state, newEntries }, drafts, originalId, fields);
                return { ...next, spreadIndex, newEntries, drafts, deleted, editing: state.editing.has(action.id) ? new Set([originalId]) : state.editing };
            }

            // Join the new set before a chosen spread, or after the last spread of its species
            const moved = { id: action.newId, setId: action.setId, fields, line: spreadIndex.sets.get(action.setId).line, editable: true,
                isNew: true, movedFrom: originalId, diagnostics: [] };
            spreadIndex.entries.set(action.newId, moved);
            newEntries[action.newId] = moved;
            drafts[action.newId] = fields;
            const current = next.orders[action.setId] ?? spreadIndex.sets.get(action.setId).entryIds;
            let order = insertSpread(current, spreadIndex.entries, action.newId);
            if (action.beforeId != null && current.includes(action.beforeId) && spreadIndex.sets.get(action.setId).canReorder)
            {
                order = [...current];
                order.splice(order.indexOf(action.beforeId), 0, action.newId);
            }

            return { ...next, spreadIndex, newEntries, drafts, deleted, orders: { ...next.orders, [action.setId]: order },
                editing: state.editing.has(action.id) ? new Set([action.newId]) : state.editing };
        }
        case ACTION.ORDER_SET:
        {
            const set = state.spreadIndex.sets.get(action.setId);
            const ids = [...(set?.entryIds ?? []), ...Object.keys(state.newEntries).filter((id) => state.newEntries[id].setId === action.setId)];
            if (!set?.canReorder || action.order.length !== ids.length || new Set(action.order).size !== ids.length
                || !action.order.every((id) => ids.includes(id)))
                return state;

            const moves = [...new Set([...(state.orderMoves[action.setId] ?? []), ...action.moved])];
            return { ...state, ...withOrder(state, action.setId, action.order, moves) };
        }
        case ACTION.REVERT_ORDER:
        {
            const set = state.spreadIndex.sets.get(action.setId);
            if (set == null)
                return state;
            return { ...state, ...withOrder(state, action.setId, getSavedOrder(set, state.spreadIndex.entries), []) };
        }
        case ACTION.REVERT_GROUP:
        {
            const set = state.spreadIndex.sets.get(action.setId);
            const current = state.orders[action.setId];
            if (set == null || current == null)
                return state;

            // Moves within the group stay, so only the group's place is undone
            const { getSpecies } = findSetMoves(state, action.setId);
            const order = restoreGroupPosition(set.entryIds, current, current.filter((id) => getSpecies(id) === action.species));
            const moves = (state.orderMoves[action.setId] ?? []).filter((move) => move !== `${GROUP_MOVE_PREFIX}${action.species}`);
            return { ...state, ...withOrder(state, action.setId, order, moves) };
        }
        case ACTION.REVERT_SPREAD_ORDER:
        {
            const setId = state.spreadIndex.entries.get(action.id)?.setId;
            const current = state.orders[setId];
            if (current == null)
                return state;

            const { getSpecies } = findSetMoves(state, setId);
            const ids = current.filter((id) => getSpecies(id) === getSpecies(action.id));
            const order = restoreSpreadInGroup(state.spreadIndex.sets.get(setId).entryIds, current, ids, action.id);
            const moves = (state.orderMoves[setId] ?? []).filter((id) => id !== action.id);
            return { ...state, ...withOrder(state, setId, order, moves) };
        }
        case ACTION.UPDATE_SPREAD:
        {
            const entry = state.newEntries[action.id] ?? state.spreadIndex.entries.get(action.id);
            if (entry == null || !entry.editable)
                return state;

            // Leaving Both remembers its Modify Moves Doubles value for coming back
            const current = state.drafts[action.id] ?? entry.fields;
            const next = action.update(current, entry.fields, state.modifyMemory[action.id]);
            const modifyMemory = { ...state.modifyMemory };
            if (getBattleType(current) === BATTLE_TYPES.BOTH && getBattleType(next) !== BATTLE_TYPES.BOTH)
                modifyMemory[action.id] = current.modifyMovesDoubles;

            const drafts = { ...state.drafts };
            putDraft(state, drafts, action.id, next);
            return { ...state, drafts, modifyMemory };
        }
        case ACTION.APPLY_CHANGES:
        {
            const drafts = { ...state.drafts };
            for (const { id, fields } of action.changes)
            {
                const current = drafts[id] ?? state.spreadIndex.entries.get(id)?.fields;
                if (current != null)
                    putDraft(state, drafts, id, { ...current, ...fields });
            }

            return { ...state, drafts };
        }
        case ACTION.REVERT_SPREAD:
        {
            if (state.newEntries[action.id])
            {
                const newEntries = { ...state.newEntries };
                const { setId, movedFrom } = newEntries[action.id];
                delete newEntries[action.id];

                // Reverting a spread moved from another set puts it back there, while deleting it deletes the original
                const deleted = new Set(state.deleted);
                if (movedFrom != null && !action.keepOriginalDeleted)
                    deleted.delete(movedFrom);
                const drafts = { ...state.drafts };
                delete drafts[action.id];
                const spreadIndex = { ...state.spreadIndex, entries: new Map(state.spreadIndex.entries) };
                spreadIndex.entries.delete(action.id);
                const order = (state.orders[setId] ?? []).filter((id) => id !== action.id);
                const moves = (state.orderMoves[setId] ?? []).filter((id) => id !== action.id);
                return { ...state, newEntries, spreadIndex, drafts, deleted, ...withOrder({ ...state, spreadIndex }, setId, order, moves), editing: new Set() };
            }
            const { [action.id]: removed, ...drafts } = state.drafts;
            const { [action.id]: forgotten, ...modifyMemory } = state.modifyMemory;
            const deleted = new Set(state.deleted);
            deleted.delete(action.id);

            // A spread moved within its species goes back to its saved place there, leaving group moves alone
            const setId = state.spreadIndex.entries.get(action.id)?.setId;
            const reverted = { ...state, drafts, modifyMemory, deleted };
            if (state.orders[setId] == null || !findSetMoves(state, setId).spreads.has(action.id))
                return reverted;

            return reducer(reverted, { type: ACTION.REVERT_SPREAD_ORDER, id: action.id });
        }
        case ACTION.DELETE_SPREAD:
        {
            if (state.newEntries[action.id])
                return reducer(state, { type: ACTION.REVERT_SPREAD, id: action.id, keepOriginalDeleted: true });
            if (!state.spreadIndex.entries.get(action.id)?.editable)
                return state;
            const deleted = new Set(state.deleted);
            deleted.add(action.id);
            return { ...state, deleted, editing: new Set() };
        }
        case ACTION.RESTORE_SPREAD:
        {
            const deleted = new Set(state.deleted);
            deleted.delete(action.id);
            return { ...state, deleted };
        }
        case ACTION.DISCARD_CHANGES:
            return { ...state, drafts: {}, newEntries: {}, orders: {}, orderMoves: {}, spreadIndex: indexSpreads(state.workspace.spreads),
                deleted: new Set(), modifyMemory: {}, editing: new Set(), saveError: null };
        case ACTION.SET_EDITING:
        {
            if (action.editing && state.spreadIndex.entries.get(action.id)?.editable)
                return { ...state, editing: new Set([action.id]) };

            // Closing keeps existing moves, or seeds the same first option as Add Spread
            const drafts = { ...state.drafts };
            for (const id of state.editing)
            {
                const entry = state.spreadIndex.entries.get(id);
                if (!entry?.editable || entry.placeholder || state.deleted.has(id))
                    continue;

                const fields = drafts[id] ?? entry.fields;
                let next = drafts[id] != null ? compactMoves(fields) : fields;
                if (state.catalog != null && next.moves.every((move) => move == null || move === EMPTY_MOVE || move === MOVE_NONE))
                {
                    const [firstMove] = getLearnableMoveOptions(state.catalog, next.species).options;
                    if (firstMove != null)
                        next = setMove(next, 0, firstMove.move, firstMove.hiddenPowerType);
                }

                if (drafts[id] != null || next !== fields)
                    putDraft(state, drafts, id, next);
            }
            return { ...state, drafts, editing: new Set() };
        }
        case ACTION.SET_PREVIEW:
            return { ...state, preview: { ...state.preview, ...action.preview } };
        case ACTION.SAVE_START:
            return { ...state, saving: true, saveError: null };
        case ACTION.SAVE_SUCCESS:
        {
            const workspace = { ...state.workspace, spreads: action.spreads };
            const spreadIndex = indexSpreads(action.spreads);
            const pending = Object.fromEntries(Object.entries(state.drafts).map(([id, fields]) => [action.createdIds?.[id] ?? id, fields]));
            const submitted = Object.fromEntries(Object.entries(action.submitted).map(([id, fields]) => [action.createdIds?.[id] ?? id, fields]));
            const newEntries = Object.fromEntries(Object.entries(state.newEntries).filter(([id]) => !action.submitted[id]));
            for (const [id, entry] of Object.entries(newEntries))
                spreadIndex.entries.set(id, entry);
            const orders = {};
            const orderMoves = {};
            for (const [setId, order] of Object.entries(state.orders))
            {
                if (order !== action.submittedOrders[setId])
                {
                    orders[setId] = order.map((id) => action.createdIds?.[id] ?? id);
                    orderMoves[setId] = (state.orderMoves[setId] ?? []).map((id) => action.createdIds?.[id] ?? id);
                }
            }
            for (const setId of Object.keys(orders))
                dropUnchangedOrder(spreadIndex, orders, orderMoves, setId);
            return { ...state, workspace, spreadIndex, newEntries, orders, orderMoves, drafts: getDraftsAfterSave(pending, submitted, spreadIndex.entries),
                deleted: new Set([...state.deleted].filter((id) => !action.submittedDeleted.has(id))), editing: new Set(), saving: false };
        }
        case ACTION.SAVE_FAILURE:
            return { ...state, saving: false, saveError: action.error };
        case ACTION.CLEAR_SAVE_ERROR:
            return { ...state, saveError: null };
        case ACTION.REPLACE_WORKSPACE:
            return { ...state, workspace: action.workspace };
        default:
            return state;
    }
}

/**
 * Provides spread editor state to the app.
 *
 * @component
 * @param {Object} props - The component props
 * @param {React.ReactNode} props.children - The wrapped content.
 * @returns {JSX.Element} The provider.
 */
export const SpreadEditorProvider = ({ children }) =>
{
    const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
    const tokenRef = useRef(null);
    const tokenPromiseRef = useRef(null);
    const progressRef = useRef(new Map());
    const newEntryCounter = useRef(0);
    const loadedPathsRef = useRef(null);
    const archiveBusyRef = useRef(false);
    const stateRef = useRef(state);
    stateRef.current = state;

    /**
     * Sends a request to the local server, starting a new session if the server has restarted.
     *
     * @param {string} route The API route.
     * @param {object} body The request body.
     * @param {object} [options] Additional Axios request options.
     * @returns {Promise<object>} The response body.
     */
    const post = useCallback(async (route, body, options = {}) =>
    {
        for (let attempt = 1; ; ++attempt)
        {
            let requestToken;
            try
            {
                // Get a token the first time, or again after the server restarts
                if (tokenRef.current == null)
                {
                    if (tokenPromiseRef.current == null)
                        tokenPromiseRef.current = axios.post(`${API_BASE}/session`).then((response) =>
                        {
                            tokenRef.current = response.data.token;
                            return response.data.token;
                        }).finally(() => { tokenPromiseRef.current = null; });
                    await tokenPromiseRef.current;
                }

                if (options.signal?.aborted)
                    throw new Error("Request cancelled.");
                requestToken = tokenRef.current;

                return (await axios.post(`${API_BASE}${route}`, body,
                    { ...options, headers: { ...options.headers, [SESSION_HEADER]: requestToken } })).data;
            }
            catch (error)
            {
                // A rejected token means the server restarted, so retry once with a new one
                let responseData = error.response?.data;
                if (responseData instanceof Blob)
                {
                    try
                    {
                        const text = await new Promise((resolve, reject) =>
                        {
                            const reader = new FileReader();
                            reader.onload = () => resolve(reader.result);
                            reader.onerror = () => reject(reader.error);
                            reader.readAsText(responseData);
                        });
                        responseData = JSON.parse(text);
                    }
                    catch
                    {
                        responseData = null;
                    }
                }
                const apiError = toApiError(error.response ? { response: { ...error.response, data: responseData } } : error);
                if (apiError.status !== StatusCode.ClientErrorUnauthorized || attempt >= MAX_REQUEST_ATTEMPTS)
                    throw apiError;

                if (tokenRef.current === requestToken)
                    tokenRef.current = null;
            }
        }
    }, []);

    /**
     * Tracks completed server steps and upload bytes without estimating elapsed-time progress.
     *
     * @param {string} route The main API route.
     * @param {object|File} body The unchanged request body.
     * @param {string} key The progress state field.
     * @param {string} label The initial operation label.
     * @param {object} [options] Additional Axios options.
     * @returns {Promise<object>} The main response, independent of polling failures.
     */
    const trackedPost = useCallback(async (route, body, key, label, options = {}) =>
    {
        progressRef.current.get(key)?.stop();
        const bytes = new Uint8Array(16);
        let progressId;
        if (globalThis.crypto.randomUUID)
            progressId = globalThis.crypto.randomUUID();
        else
        {
            globalThis.crypto.getRandomValues(bytes);
            bytes[6] = (bytes[6] & 15) | 64;
            bytes[8] = (bytes[8] & 63) | 128;
            const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
            progressId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
        }
        let pending = true;
        let timeout;
        let controller;
        let percentage = 0;
        let serverStage = false;
        const operation =
        {
            stop: () =>
            {
                pending = false;
                clearTimeout(timeout);
                controller?.abort();
            },
        };
        progressRef.current.set(key, operation);

        /** Updates only the active operation and never moves its percentage backwards. */
        const update = (value, nextLabel) =>
        {
            if (!pending || progressRef.current.get(key) !== operation || !Number.isFinite(value))
                return;
            const next = Math.max(percentage, Math.min(PENDING_PROGRESS_LIMIT, Math.max(0, Math.floor(value))));
            if (value < percentage)
                return;
            percentage = next;
            dispatch({ type: ACTION.PROGRESS, key, progress: { percentage, label: nextLabel || label } });
        };
        update(0, label);

        /** Polls sequentially; an absent or unavailable record never fails the main request. */
        const poll = async () =>
        {
            if (!pending)
                return;
            controller = new AbortController();
            try
            {
                const progress = await post(`/progress/${progressId}`, {}, { signal: controller.signal });
                if (pending && progress.percentage >= UPLOAD_PROGRESS_LIMIT)
                    serverStage = true;
                update(progress.percentage, progress.label);
            }
            catch
            {
                // Progress is optional, including before the server creates its record.
            }
            if (pending)
                timeout = setTimeout(poll, PROGRESS_POLL_INTERVAL);
        };

        try
        {
            const request = post(route, body,
            {
                ...options,
                params: { ...options.params, progressId },
                ...(route === "/workspaces/import" ? { onUploadProgress: (event) =>
                {
                    const total = event.total || body.size;
                    if (total > 0 && !serverStage)
                        update(Math.min(UPLOAD_PROGRESS_LIMIT, event.loaded / total * UPLOAD_PROGRESS_LIMIT), "Uploading ZIP...");
                } } : {}),
            });
            timeout = setTimeout(poll, PROGRESS_POLL_INTERVAL);
            const result = await request;
            if (!pending)
                throw { code: ERROR_OPERATION_CANCELLED };
            return result;
        }
        catch (error)
        {
            if (!pending)
                throw { code: ERROR_OPERATION_CANCELLED };
            throw error;
        }
        finally
        {
            operation.stop();
            if (progressRef.current.get(key) === operation)
                progressRef.current.delete(key);
        }
    }, [post]);

    /** Stops timers, in-flight polls and late upload callbacks when the provider unmounts. */
    useEffect(() => () =>
    {
        for (const operation of progressRef.current.values())
            operation.stop();
        progressRef.current.clear();
    }, []);

    /**
     * Saves settings, remembering when the browser blocks storage.
     *
     * @param {Object<string, string>} paths The repository paths.
     * @param {string} gameId The selected game.
     */
    const saveSettings = useCallback((paths, gameId) =>
    {
        if (!writeStoredSettings(paths, gameId))
            dispatch({ type: ACTION.STORAGE_UNAVAILABLE });
    }, []);

    /**
     * Loads a game's catalog, reloading the workspace once if the server has forgotten it.
     *
     * @param {object} workspace The workspace snapshot.
     * @param {string} gameId The game to load.
     */
    const selectGame = useCallback(async (workspace, gameId) =>
    {
        dispatch({ type: ACTION.CATALOG_START });

        try
        {
            // Load the catalog, reloading the workspace once if the server restarted and forgot it
            let activeWorkspace = workspace;
            let catalog;
            try
            {
                catalog = await post(`/workspaces/${activeWorkspace.workspaceId}/catalog`, { gameId });
            }
            catch (error)
            {
                if (error.code !== ERROR_WORKSPACE_NOT_FOUND)
                    throw error;

                activeWorkspace = await post("/workspaces/load", { paths: loadedPathsRef.current });
                catalog = await post(`/workspaces/${activeWorkspace.workspaceId}/catalog`, { gameId });
            }

            // Remember the game for the next launch
            saveSettings(loadedPathsRef.current, catalog.gameId);
            dispatch({ type: ACTION.CATALOG_SUCCESS, workspace: activeWorkspace, catalog, stored: readStoredDrafts() });
        }
        catch (error)
        {
            // Repositories that became invalid send the user back to setup
            if (error.code === ERROR_VALIDATION_FAILED)
                dispatch({ type: ACTION.LOAD_FAILURE, error, resetWorkspace: true });
            else
                dispatch({ type: ACTION.CATALOG_FAILURE, error });
        }
    }, [post, saveSettings]);

    /**
     * Validates the repositories, then opens the saved game or asks for one.
     *
     * @param {Object<string, string>} paths The repository paths.
     * @param {string} savedGameId The game to reopen, if still available.
     */
    const loadRepositories = useCallback(async (paths, savedGameId) =>
    {
        // Validate the repositories on the server
        const trimmedPaths = Object.fromEntries(REPOSITORY_KINDS.map((kind) => [kind, paths[kind].trim()]));
        dispatch({ type: ACTION.LOAD_START, paths: trimmedPaths, gameId: savedGameId });

        let workspace;
        try
        {
            workspace = await trackedPost("/workspaces/load", { paths: trimmedPaths }, "setupProgress", "Checking repositories...");
        }
        catch (error)
        {
            if (error.code === ERROR_OPERATION_CANCELLED)
                return;
            dispatch({ type: ACTION.LOAD_FAILURE, error });
            return;
        }

        // Save the working paths, dropping the saved game if Cloud no longer has it
        loadedPathsRef.current = trimmedPaths;
        const gameAvailable = workspace.games.some((game) => game.id === savedGameId);
        const gameId = gameAvailable ? savedGameId : "";
        saveSettings(trimmedPaths, gameId);
        dispatch({ type: ACTION.LOAD_SUCCESS, workspace, gameId, notice: savedGameId && !gameAvailable ? MISSING_GAME_NOTICE : null });

        // Reopen the saved game, otherwise the game dialog stays open for a choice
        if (gameAvailable)
            await selectGame(workspace, savedGameId);
    }, [trackedPost, saveSettings, selectGame]);

    /**
     * Imports a ZIP into server-owned cached repositories without needing local checkout paths.
     *
     * @param {File} file The uploaded archive.
     * @returns {Promise<void>} Resolves after setup or catalog loading finishes.
     */
    const importArchive = useCallback(async (file) =>
    {
        const current = stateRef.current;
        if (current.phase !== EDITOR_PHASE.SETUP || current.pickingKind != null || current.saving || archiveBusyRef.current)
            return;

        if (!file || !/\.zip$/i.test(file.name) || file.size === 0 || file.size > MAX_ARCHIVE_BYTES)
        {
            dispatch({ type: ACTION.LOAD_FAILURE, error: { code: "ARCHIVE_INVALID", message: "Choose a non-empty ZIP file no larger than 128 MiB." } });
            return;
        }

        dispatch({ type: ACTION.LOAD_START, paths: current.paths, gameId: current.gameId });
        let workspace;
        try
        {
            workspace = await trackedPost("/workspaces/import", file, "setupProgress", "Uploading ZIP...",
                { headers: { "Content-Type": ARCHIVE_CONTENT_TYPE } });
            if (typeof workspace?.workspaceId !== "string" || !Array.isArray(workspace.games)
                || !REPOSITORY_KINDS.every((kind) => typeof workspace.repositories?.[kind]?.path === "string" && workspace.repositories[kind].path.trim()))
                throw { code: ERROR_SERVER_RESPONSE, message: "The editor server returned an unexpected import response." };
        }
        catch (error)
        {
            if (error.code === ERROR_OPERATION_CANCELLED)
                return;
            dispatch({ type: ACTION.LOAD_FAILURE, error });
            return;
        }

        const paths = Object.fromEntries(REPOSITORY_KINDS.map((kind) => [kind, workspace.repositories[kind].path]));
        const manifestGame = typeof workspace.gameId === "string" ? workspace.gameId : "";
        const gameId = workspace.games.some((game) => game.id === manifestGame) ? manifestGame : "";
        loadedPathsRef.current = paths;
        saveSettings(paths, gameId);
        dispatch({ type: ACTION.LOAD_SUCCESS, workspace, paths, gameId, notice: manifestGame && !gameId ? MISSING_GAME_NOTICE : null });
        if (gameId)
            await selectGame(workspace, gameId);
    }, [trackedPost, saveSettings, selectGame]);

    /**
     * Downloads the saved source files, recovering a workspace lost after a server restart.
     *
     * @returns {Promise<void>} Resolves after download or visible error feedback.
     */
    const downloadArchive = useCallback(async () =>
    {
        const current = stateRef.current;
        if (current.phase !== EDITOR_PHASE.READY || current.saving || archiveBusyRef.current)
            return;

        archiveBusyRef.current = true;
        dispatch({ type: ACTION.ARCHIVE_START });
        let url;
        let anchor;
        try
        {
            let workspace = current.workspace;
            let blob;
            try
            {
                blob = await trackedPost(`/workspaces/${workspace.workspaceId}/archive`, { gameId: current.gameId }, "archiveProgress", "Preparing download...", { responseType: "blob" });
            }
            catch (error)
            {
                if (error.code !== ERROR_WORKSPACE_NOT_FOUND)
                    throw error;
                workspace = await trackedPost("/workspaces/load", { paths: loadedPathsRef.current }, "archiveProgress", "Checking repositories...");
                dispatch({ type: ACTION.REPLACE_WORKSPACE, workspace: { ...workspace, spreads: current.workspace.spreads } });
                blob = await trackedPost(`/workspaces/${workspace.workspaceId}/archive`, { gameId: current.gameId }, "archiveProgress", "Preparing download...", { responseType: "blob" });
            }
            url = URL.createObjectURL(blob);
            anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = ARCHIVE_FILENAME;
            document.body.appendChild(anchor);
            anchor.click();
            dispatch({ type: ACTION.ARCHIVE_END });
        }
        catch (error)
        {
            if (error.code === ERROR_OPERATION_CANCELLED)
                return;
            dispatch({ type: ACTION.ARCHIVE_END, error: { message: error.message ?? "Could not download the saved source files. Try again." } });
        }
        finally
        {
            anchor?.remove();
            if (url != null)
                URL.revokeObjectURL(url);
            archiveBusyRef.current = false;
        }
    }, [trackedPost]);

    /**
     * Opens the native folder dialog for a repository.
     *
     * @param {string} kind The repository kind.
     * @param {string} startPath The currently entered path.
     */
    const browse = useCallback(async (kind, startPath) =>
    {
        dispatch({ type: ACTION.PICK_START, kind });

        try
        {
            const result = await post("/repositories/pick", { repository: kind, startPath: startPath.trim() || undefined });
            dispatch({ type: ACTION.PICK_END, kind, path: result.status === PICKER_SELECTED ? result.path : null });
        }
        catch (error)
        {
            dispatch({ type: ACTION.PICK_END, kind, error });
        }
    }, [post]);

    /**
     * Restores saved settings when the editor first opens.
     */
    useEffect(() =>
    {
        // Returning users go straight to loading; everyone else starts at setup
        const settings = readStoredSettings();
        if (hasAllPaths(settings.paths))
            loadRepositories(settings.paths, settings.gameId);
        else
            dispatch({ type: ACTION.SHOW_SETUP, paths: settings.paths, gameId: settings.gameId });
    }, [loadRepositories]);

    /**
     * Keeps unsaved changes in storage so they survive a crash or reload, clearing them once saved or discarded.
     */
    useEffect(() =>
    {
        if (state.phase === EDITOR_PHASE.READY && state.workspace != null)
            writeStoredDrafts(stateRef.current);
    }, [state.phase, state.workspace, state.spreadIndex, state.drafts, state.deleted, state.modifyMemory, state.orders, state.orderMoves]);

    /**
     * Saves every unsaved change. After a server restart the workspace is loaded again, and the save is only
     * retried when the spread files are unchanged, so every spread keeps its ID.
     *
     * @returns {Promise<boolean>} Whether the changes were saved.
     */
    const saveChanges = useCallback(async () =>
    {
        const { drafts, deleted, spreadIndex, catalog, gameId, saving, newEntries, orders } = stateRef.current;
        let { workspace } = stateRef.current;
        if (saving || archiveBusyRef.current || findSaveProblems(Object.fromEntries(Object.entries(drafts).filter(([id]) => !deleted.has(id))), spreadIndex.entries, catalog).length > 0)
            return false;

        const additions = Object.entries(newEntries).map(([tempId, entry]) =>
        {
            const order = orders[entry.setId];
            const preceding = order.slice(0, order.indexOf(tempId)).filter((id) => !newEntries[id] && !deleted.has(id));
            return { type: OPERATION_ADD, tempId, setId: entry.setId, afterEntryId: preceding.at(-1) ?? null, fields: drafts[tempId] };
        });

        // Orders list deleted spreads too, and are only sent when adding after anchors would not give them
        const reorders = Object.entries(orders).filter(([setId, order]) =>
            getDefaultOrder(spreadIndex.sets.get(setId), additions.filter((addition) => addition.setId === setId), deleted).join() !== order.join())
            .map(([setId, order]) => ({ type: OPERATION_REORDER, setId, order }));
        const operations = [...Object.entries(drafts).filter(([id]) => !deleted.has(id) && !newEntries[id]).map(([entryId, fields]) =>
            ({ type: OPERATION_UPDATE, entryId, fields: getChangedFields(fields, spreadIndex.entries.get(entryId).fields) })),
            ...[...deleted].map((entryId) => ({ type: OPERATION_DELETE, entryId })), ...additions, ...reorders];
        const request = () => post(`/workspaces/${workspace.workspaceId}/save`, { revision: workspace.spreads.revision, gameId, operations });
        dispatch({ type: ACTION.SAVE_START });

        try
        {
            let result;
            try
            {
                result = await request();
            }
            catch (error)
            {
                if (error.code !== ERROR_WORKSPACE_NOT_FOUND)
                    throw error;

                const reloaded = await post("/workspaces/load", { paths: loadedPathsRef.current });
                if (!isSameSpreads(reloaded.spreads, workspace.spreads))
                    throw { code: error.code, message: RESTART_CHANGED_MESSAGE };

                workspace = { ...reloaded, spreads: workspace.spreads };
                dispatch({ type: ACTION.REPLACE_WORKSPACE, workspace });
                result = await request();
            }

            dispatch({ type: ACTION.SAVE_SUCCESS, spreads: result.spreads, createdIds: result.createdIds, submitted: drafts,
                submittedOrders: orders, submittedDeleted: deleted });
            return true;
        }
        catch (error)
        {
            dispatch({ type: ACTION.SAVE_FAILURE, error });
            return false;
        }
    }, [post]);

    const saveProblems = useMemo(() => findSaveProblems(Object.fromEntries(Object.entries(state.drafts).filter(([id]) => !state.deleted.has(id))),
        state.spreadIndex.entries, state.catalog), [state.drafts, state.deleted, state.spreadIndex, state.catalog]);

    const actions = useMemo(() =>
    ({
        addSpreads: (setId, fieldsList, { edit = false } = {}) =>
        {
            const spreads = fieldsList.map((fields) =>
            {
                do
                    newEntryCounter.current++;
                while (stateRef.current.spreadIndex.entries.has(`new-${newEntryCounter.current}`));
                return { id: `new-${newEntryCounter.current}`, fields };
            });
            dispatch({ type: ACTION.ADD_SPREAD, setId, spreads, edit });
            return spreads.map((spread) => spread.id);
        },
        transferSpread: (id, setId, beforeId = null) =>
        {
            do
                newEntryCounter.current++;
            while (stateRef.current.spreadIndex.entries.has(`new-${newEntryCounter.current}`));
            dispatch({ type: ACTION.TRANSFER_SPREAD, id, setId, beforeId, newId: `new-${newEntryCounter.current}` });
        },
        orderSet: (setId, order, moved = []) => dispatch({ type: ACTION.ORDER_SET, setId, order, moved }),
        revertOrder: (setId) => dispatch({ type: ACTION.REVERT_ORDER, setId }),
        revertGroup: (setId, species) => dispatch({ type: ACTION.REVERT_GROUP, setId, species }),
        revertSpreadOrder: (id) => dispatch({ type: ACTION.REVERT_SPREAD_ORDER, id }),
        updateSpread: (id, update) => dispatch({ type: ACTION.UPDATE_SPREAD, id, update }),
        applyChanges: (changes) => dispatch({ type: ACTION.APPLY_CHANGES, changes }),
        revertSpread: (id) => dispatch({ type: ACTION.REVERT_SPREAD, id }),
        deleteSpread: (id) => dispatch({ type: ACTION.DELETE_SPREAD, id }),
        restoreSpread: (id) => dispatch({ type: ACTION.RESTORE_SPREAD, id }),
        discardChanges: () => dispatch({ type: ACTION.DISCARD_CHANGES }),
        setEditing: (id, editing) => dispatch({ type: ACTION.SET_EDITING, id, editing }),
        setPreview: (preview) => dispatch({ type: ACTION.SET_PREVIEW, preview }),
        clearSaveError: () => dispatch({ type: ACTION.CLEAR_SAVE_ERROR }),
    }), []);

    const movedIds = useMemo(() => findMovedIds({ orders: state.orders, orderMoves: state.orderMoves, spreadIndex: state.spreadIndex }),
        [state.orders, state.orderMoves, state.spreadIndex]);
    const orderMoves = useMemo(() => findOrderMoves({ orders: state.orders, orderMoves: state.orderMoves, spreadIndex: state.spreadIndex }),
        [state.orders, state.orderMoves, state.spreadIndex]);
    const transferredIds = useMemo(() => findTransferredIds(state.newEntries), [state.newEntries]);

    const value = useMemo(() =>
    ({
        state,
        ...actions,
        cardActions: actions,
        movedIds,
        movedGroups: orderMoves.groups,
        movedSpreadIds: orderMoves.spreads,
        transferredIds,
        getTransferProblem: (id, setId) => getTransferProblem(state, id, setId),
        dirtyCount: new Set([...Object.keys(state.drafts), ...[...state.deleted].filter((id) => !transferredIds.has(id)), ...movedIds]).size,
        saveProblems,
        saveChanges,
        setPath: (kind, pathValue) => dispatch({ type: ACTION.SET_PATH, kind, value: pathValue }),
        browse,
        importArchive,
        downloadArchive,
        loadRepositories: () => loadRepositories(state.paths, state.gameId),
        selectGame: (gameId) => selectGame(state.workspace, gameId),
        changeRepositories: () => dispatch({ type: ACTION.CHANGE_REPOSITORIES }),
        changeGame: () => dispatch({ type: ACTION.CHANGE_GAME }),
        cancelChange: () => dispatch({ type: ACTION.CANCEL_CHANGE, paths: loadedPathsRef.current ?? state.paths }),
    }), [state, actions, movedIds, orderMoves, transferredIds, saveProblems, saveChanges, browse, importArchive, downloadArchive, loadRepositories, selectGame]);

    return (
        <SpreadEditorContext.Provider value={value}>
            {children}
        </SpreadEditorContext.Provider>
    );
};

/**
 * Returns the spread editor state and actions.
 *
 * @returns {object} The editor context.
 */
export function useSpreadEditor()
{
    return useContext(SpreadEditorContext);
}
