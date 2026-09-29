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
import { BATTLE_TYPES, getBattleType, getChangedFields, isSpreadChanged, validateSpreadFields } from "../shared/spread-model.mjs";
import { config } from "./components/ServerConfig";

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
const PICKER_SELECTED = "selected";
const ERROR_WORKSPACE_NOT_FOUND = "WORKSPACE_NOT_FOUND";
const ERROR_VALIDATION_FAILED = "REPOSITORY_VALIDATION_FAILED";
const ERROR_SERVER_UNREACHABLE = "SERVER_UNREACHABLE";
const ERROR_SERVER_RESPONSE = "SERVER_ERROR";
const EMPTY_PATHS = Object.freeze({ cfru: "", dpe: "", cloud: "" });
const MISSING_GAME_NOTICE = "The previously selected game is no longer available in Unbound Cloud. Choose a game to continue.";
const RESTART_CHANGED_MESSAGE = "The editor server restarted and the spread files changed since they were loaded, so these changes cannot be saved. Load the repositories again.";
const OPERATION_UPDATE = "update";
const OPERATION_DELETE = "delete";
const MOVES_FIELD = "moves";
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
};

const EMPTY_DRAFTS =
{
    drafts: {},
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
        const ids = new Set([...Object.keys(state.drafts), ...state.deleted]);
        if (ids.size === 0)
        {
            window.localStorage.removeItem(DRAFTS_STORAGE_KEY);
            return;
        }

        const saved = Object.fromEntries([...ids].map((id) =>
        {
            const entry = state.spreadIndex.entries.get(id);
            return [id, { setId: entry?.setId, fields: entry?.fields }];
        }));
        window.localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(
        {
            version: DRAFTS_VERSION,
            revision: state.workspace.spreads.revision,
            drafts: state.drafts,
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

    const drafts = {};
    for (const [id, fields] of Object.entries(stored.drafts ?? {}))
    {
        if (matches(id) && Array.isArray(fields?.moves))
            putDraft(state, drafts, id, fields);
    }

    const deleted = new Set((Array.isArray(stored.deleted) ? stored.deleted : []).filter(matches));
    const modifyMemory = Object.fromEntries(Object.entries(stored.modifyMemory ?? {}).filter(([id]) => matches(id)));
    return { drafts, deleted, modifyMemory };
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
    const entry = state.spreadIndex.entries.get(id);
    if (entry == null || !entry.editable)
        return;

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
                phase: EDITOR_PHASE.SELECT_GAME,
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
        case ACTION.UPDATE_SPREAD:
        {
            const entry = state.spreadIndex.entries.get(action.id);
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
            const { [action.id]: removed, ...drafts } = state.drafts;
            const { [action.id]: forgotten, ...modifyMemory } = state.modifyMemory;
            const deleted = new Set(state.deleted);
            deleted.delete(action.id);
            return { ...state, drafts, modifyMemory, deleted };
        }
        case ACTION.DELETE_SPREAD:
        {
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
            return { ...state, drafts: {}, deleted: new Set(), modifyMemory: {}, saveError: null };
        case ACTION.SET_EDITING:
        {
            if (action.editing && state.spreadIndex.entries.get(action.id)?.editable)
                return { ...state, editing: new Set([action.id]) };
            return { ...state, editing: new Set() };
        }
        case ACTION.SET_PREVIEW:
            return { ...state, preview: { ...state.preview, ...action.preview } };
        case ACTION.SAVE_START:
            return { ...state, saving: true, saveError: null };
        case ACTION.SAVE_SUCCESS:
        {
            const workspace = { ...state.workspace, spreads: action.spreads };
            const spreadIndex = indexSpreads(action.spreads);
            return { ...state, workspace, spreadIndex, drafts: getDraftsAfterSave(state.drafts, action.submitted, spreadIndex.entries),
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
    const loadedPathsRef = useRef(null);
    const stateRef = useRef(state);
    stateRef.current = state;

    /**
     * Sends a JSON request to the local server, starting a new session if the server has restarted.
     *
     * @param {string} route The API route.
     * @param {object} body The request body.
     * @returns {Promise<object>} The response body.
     */
    const post = useCallback(async (route, body) =>
    {
        for (let attempt = 1; ; ++attempt)
        {
            try
            {
                // Get a token the first time, or again after the server restarts
                if (tokenRef.current == null)
                    tokenRef.current = (await axios.post(`${API_BASE}/session`)).data.token;

                return (await axios.post(`${API_BASE}${route}`, body, { headers: { [SESSION_HEADER]: tokenRef.current } })).data;
            }
            catch (error)
            {
                // A rejected token means the server restarted, so retry once with a new one
                const apiError = toApiError(error);
                if (apiError.status !== StatusCode.ClientErrorUnauthorized || attempt >= MAX_REQUEST_ATTEMPTS)
                    throw apiError;

                tokenRef.current = null;
            }
        }
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
            workspace = await post("/workspaces/load", { paths: trimmedPaths });
        }
        catch (error)
        {
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
    }, [post, saveSettings, selectGame]);

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
    }, [state.phase, state.workspace, state.spreadIndex, state.drafts, state.deleted, state.modifyMemory]);

    /**
     * Saves every unsaved change. After a server restart the workspace is loaded again, and the save is only
     * retried when the spread files are unchanged, so every spread keeps its ID.
     *
     * @returns {Promise<boolean>} Whether the changes were saved.
     */
    const saveChanges = useCallback(async () =>
    {
        const { drafts, deleted, spreadIndex, catalog, gameId, saving } = stateRef.current;
        let { workspace } = stateRef.current;
        if (saving || findSaveProblems(Object.fromEntries(Object.entries(drafts).filter(([id]) => !deleted.has(id))), spreadIndex.entries, catalog).length > 0)
            return false;

        const operations = [...Object.entries(drafts).filter(([id]) => !deleted.has(id)).map(([entryId, fields]) =>
            ({ type: OPERATION_UPDATE, entryId, fields: getChangedFields(fields, spreadIndex.entries.get(entryId).fields) })),
            ...[...deleted].map((entryId) => ({ type: OPERATION_DELETE, entryId }))];
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

            dispatch({ type: ACTION.SAVE_SUCCESS, spreads: result.spreads, submitted: drafts, submittedDeleted: deleted });
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

    const value = useMemo(() =>
    ({
        state,
        ...actions,
        cardActions: actions,
        dirtyCount: new Set([...Object.keys(state.drafts), ...state.deleted]).size,
        saveProblems,
        saveChanges,
        setPath: (kind, pathValue) => dispatch({ type: ACTION.SET_PATH, kind, value: pathValue }),
        browse,
        loadRepositories: () => loadRepositories(state.paths, state.gameId),
        selectGame: (gameId) => selectGame(state.workspace, gameId),
        changeRepositories: () => dispatch({ type: ACTION.CHANGE_REPOSITORIES }),
        changeGame: () => dispatch({ type: ACTION.CHANGE_GAME }),
        cancelChange: () => dispatch({ type: ACTION.CANCEL_CHANGE, paths: loadedPathsRef.current ?? state.paths }),
    }), [state, actions, saveProblems, saveChanges, browse, loadRepositories, selectGame]);

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
