/**
 * This file defines the spread editor's shared state.
 * It owns repository setup, workspace and game loading, saved settings and requests to the local server.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import axios from "axios";
import { StatusCode } from "status-code-enum";

import { config } from "./components/ServerConfig";

export const SETTINGS_STORAGE_KEY = "cfruSpreadEditor.settings";
export const SETTINGS_VERSION = 1;
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
                phase: EDITOR_PHASE.SELECT_GAME,
                workspace: action.workspace,
                gameId: action.gameId,
                catalog: null,
                notice: action.notice ?? null,
            };
        case ACTION.LOAD_FAILURE:
            return {
                ...state,
                phase: EDITOR_PHASE.SETUP,
                workspace: action.resetWorkspace ? null : state.workspace,
                catalog: action.resetWorkspace ? null : state.catalog,
                fieldErrors: action.error.details?.fields ?? {},
                error: action.error,
            };
        case ACTION.CATALOG_START:
            return { ...state, phase: EDITOR_PHASE.LOADING_CATALOG, error: null };
        case ACTION.CATALOG_SUCCESS:
            return {
                ...state,
                phase: EDITOR_PHASE.READY,
                workspace: action.workspace,
                gameId: action.catalog.gameId,
                catalog: action.catalog,
                notice: null,
            };
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
            dispatch({ type: ACTION.CATALOG_SUCCESS, workspace: activeWorkspace, catalog });
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

    const value = useMemo(() =>
    ({
        state,
        setPath: (kind, pathValue) => dispatch({ type: ACTION.SET_PATH, kind, value: pathValue }),
        browse,
        loadRepositories: () => loadRepositories(state.paths, state.gameId),
        selectGame: (gameId) => selectGame(state.workspace, gameId),
        changeRepositories: () => dispatch({ type: ACTION.CHANGE_REPOSITORIES }),
        changeGame: () => dispatch({ type: ACTION.CHANGE_GAME }),
        cancelChange: () => dispatch({ type: ACTION.CANCEL_CHANGE, paths: loadedPathsRef.current ?? state.paths }),
    }), [state, browse, loadRepositories, selectGame]);

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
