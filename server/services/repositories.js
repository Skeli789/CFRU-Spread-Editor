/**
 * Local repository access: native folder picking, repository validation, workspace sessions and
 * server-owned file allowlists. Every repository read goes through this module.
 */

const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { StatusCode } = require("status-code-enum");

const { ApiError } = require("../middleware/errors");
const { parseCloudGameConfig } = require("./source-parser");

const REPOSITORY_CFRU = "cfru";
const REPOSITORY_DPE = "dpe";
const REPOSITORY_CLOUD = "cloud";
module.exports.REPOSITORY_CLOUD = REPOSITORY_CLOUD;
const REPOSITORY_KINDS = [REPOSITORY_CFRU, REPOSITORY_DPE, REPOSITORY_CLOUD];

const REPOSITORY_LABELS =
{
    [REPOSITORY_CFRU]: "Complete Fire Red Upgrade",
    [REPOSITORY_DPE]: "Dynamic Pokemon Expansion",
    [REPOSITORY_CLOUD]: "Unbound Cloud",
};

const ENTRY_FILE = "file";
const ENTRY_DIRECTORY = "directory";

const CFRU_SPREAD_FILES =
[
    "src/Tables/battle_tower_spreads.h",
    "src/Tables/frontier_special_trainer_spreads.h",
    "src/Tables/frontier_multi_spreads.h",
    "src/Tables/raid_partners.h",
];

const CLOUD_GAME_CONFIG_FILE = "src/PokemonUtil.jsx";
const CLOUD_DATA_DIRECTORY = "src/data/";
const CLOUD_DATA_EXTENSION = ".json";
const REQUIRED_GAME_DATA_KEYS = ["baseStats", "moves", "items", "ballTypes"];
const OFFICIAL_GAME_ID = "cfru";

const REPOSITORY_SENTINELS =
{
    [REPOSITORY_CFRU]:
    [
        { path: "src/config.h", type: ENTRY_FILE },
        { path: "include/new/frontier.h", type: ENTRY_FILE },
        { path: "src/Tables/battle_frontier_trainers.c", type: ENTRY_FILE },
        { path: "src/Tables/battle_moves.c", type: ENTRY_FILE },
        ...CFRU_SPREAD_FILES.map((file) => ({ path: file, type: ENTRY_FILE })),
    ],
    [REPOSITORY_DPE]:
    [
        { path: "src/Learnsets.c", type: ENTRY_FILE },
        { path: "src/Egg_Moves.c", type: ENTRY_FILE },
        { path: "src/Evolution Table.c", type: ENTRY_FILE },
        { path: "src/TM_Tutor_Tables.c", type: ENTRY_FILE },
        { path: "src/tm_compatibility", type: ENTRY_DIRECTORY },
        { path: "src/tutor_compatibility", type: ENTRY_DIRECTORY },
    ],
    [REPOSITORY_CLOUD]:
    [
        { path: CLOUD_GAME_CONFIG_FILE, type: ENTRY_FILE },
        { path: "src/Util.jsx", type: ENTRY_FILE },
        { path: "src/data/SpeciesNames.json", type: ENTRY_FILE },
    ],
};

const MAX_PATH_LENGTH = 4096;
const MAX_OWNED_FILE_BYTES = 32 * 1024 * 1024;
const MAX_WORKSPACES = 8;
const PICKER_TIMEOUT_MS = 5 * 60 * 1000;
const PICKER_MAX_OUTPUT_BYTES = 64 * 1024;
const PICKER_STATUS_SELECTED = "selected";
const PICKER_STATUS_CANCELLED = "cancelled";
const PICKER_EXECUTABLE = "powershell.exe";
const PICKER_TITLE_ENV = "CFRU_EDITOR_PICKER_TITLE";
const PICKER_START_ENV = "CFRU_EDITOR_PICKER_START";
const WINDOWS_PLATFORM = "win32";
const ABORT_ERROR_NAME = "AbortError";

// The Explorer "Select Folder" dialog browsers use; Windows PowerShell's FolderBrowserDialog is the old tree view
const PICKER_DIALOG_SOURCE =
`using System;
using System.Runtime.InteropServices;

public static class ExplorerFolderPicker
{
    [ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
    private class FileOpenDialog { }

    [ComImport, Guid("D57C7288-D4AD-4768-BE02-9D969532D960"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileOpenDialog
    {
        [PreserveSig] int Show(IntPtr owner);
        void SetFileTypes(uint count, IntPtr filters);
        void SetFileTypeIndex(uint index);
        void GetFileTypeIndex(out uint index);
        void Advise(IntPtr events, out uint cookie);
        void Unadvise(uint cookie);
        void SetOptions(uint options);
        void GetOptions(out uint options);
        void SetDefaultFolder(IShellItem folder);
        void SetFolder(IShellItem folder);
        void GetFolder(out IShellItem folder);
        void GetCurrentSelection(out IShellItem item);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string name);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        void GetResult(out IShellItem item);
    }

    [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem
    {
        void BindToHandler(IntPtr context, ref Guid handler, ref Guid interfaceId, out IntPtr result);
        void GetParent(out IShellItem parent);
        void GetDisplayName(uint form, out IntPtr name);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    private static extern void SHCreateItemFromParsingName(string path, IntPtr context, ref Guid interfaceId, out IShellItem item);

    private const uint FOS_NOCHANGEDIR = 0x8;
    private const uint FOS_PICKFOLDERS = 0x20;
    private const uint FOS_FORCEFILESYSTEM = 0x40;
    private const uint FOS_PATHMUSTEXIST = 0x800;
    private const uint SIGDN_FILESYSPATH = 0x80058000;
    private const int ERROR_CANCELLED = unchecked((int)0x800704C7);

    public static string Pick(IntPtr owner, string title, string startPath)
    {
        IFileOpenDialog dialog = (IFileOpenDialog)new FileOpenDialog();
        try
        {
            uint options;
            dialog.GetOptions(out options);
            dialog.SetOptions(options | FOS_NOCHANGEDIR | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST);
            dialog.SetTitle(title);

            if (!String.IsNullOrEmpty(startPath))
            {
                Guid shellItemId = typeof(IShellItem).GUID;
                IShellItem folder;
                SHCreateItemFromParsingName(startPath, IntPtr.Zero, ref shellItemId, out folder);
                dialog.SetFolder(folder);
            }

            int result = dialog.Show(owner);
            if (result == ERROR_CANCELLED)
                return null;
            Marshal.ThrowExceptionForHR(result);

            IShellItem selection;
            dialog.GetResult(out selection);
            IntPtr name;
            selection.GetDisplayName(SIGDN_FILESYSPATH, out name);
            try
            {
                return Marshal.PtrToStringUni(name);
            }
            finally
            {
                Marshal.FreeCoTaskMem(name);
            }
        }
        finally
        {
            Marshal.ReleaseComObject(dialog);
        }
    }
}`;

// Paths and titles reach PowerShell only through environment variables, never through the script text.
const PICKER_SCRIPT =
`$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
${PICKER_DIALOG_SOURCE}
'@
$area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.FormBorderStyle = 'None'
$owner.Opacity = 0
$owner.StartPosition = 'Manual'
$owner.Size = New-Object System.Drawing.Size 1, 1
$owner.Location = New-Object System.Drawing.Point ($area.Left + $area.Width / 2), ($area.Top + $area.Height / 2)
$owner.Show()
$owner.Activate()
$start = $env:${PICKER_START_ENV}
if (-not ($start -and (Test-Path -LiteralPath $start -PathType Container))) { $start = '' }
$selected = [ExplorerFolderPicker]::Pick($owner.Handle, $env:${PICKER_TITLE_ENV}, $start)
$owner.Dispose()
if ($selected) { @{ status = '${PICKER_STATUS_SELECTED}'; path = $selected } | ConvertTo-Json -Compress }
else { @{ status = '${PICKER_STATUS_CANCELLED}' } | ConvertTo-Json -Compress }`;

const PICKER_ARGUMENTS = ["-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand", Buffer.from(PICKER_SCRIPT, "utf16le").toString("base64")];

const SEVERITY_WARNING = "warning";

const PERMISSION_ERROR_CODES = new Set(["EACCES", "EPERM"]);
const MISSING_ERROR_CODES = new Set(["ENOENT", "ENOTDIR"]);

// Workspaces live only as long as this server process
const workspaces = new Map();


/**
 * Returns whether a candidate path is the root itself or inside it.
 *
 * @param {string} root The canonical root.
 * @param {string} candidate The canonical candidate.
 * @returns {boolean} Whether the candidate is contained by the root.
 */
function isInsideRoot(root, candidate)
{
    const relative = path.relative(root, candidate);
    return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/**
 * Resolves a repository-relative path to its canonical location, rejecting links that escape the repository.
 *
 * @param {string} root The canonical repository root.
 * @param {string} relativePath A forward-slash path relative to the root.
 * @returns {Promise<string>} The canonical absolute path.
 */
async function resolveInsideRoot(root, relativePath)
{
    // Reject paths that leave the root before touching the filesystem
    const lexicalPath = path.resolve(root, ...relativePath.split("/"));
    if (!isInsideRoot(root, lexicalPath))
        throw new ApiError(StatusCode.ClientErrorForbidden, "PATH_OUTSIDE_REPOSITORY", `${relativePath} is outside the repository.`);

    // Then reject symlinks and junctions that lead outside it
    const canonicalPath = await fs.promises.realpath(lexicalPath);
    if (!isInsideRoot(root, canonicalPath))
        throw new ApiError(StatusCode.ClientErrorForbidden, "PATH_OUTSIDE_REPOSITORY", `${relativePath} links outside the repository.`);

    return canonicalPath;
}

/**
 * Converts a filesystem error for a repository entry into a validation problem.
 *
 * @param {Error} error The filesystem error.
 * @param {string} relativePath The entry that failed.
 * @returns {{code: string, path: string}} The problem.
 */
function describeEntryError(error, relativePath)
{
    if (error instanceof ApiError)
        return { code: error.code, path: relativePath };

    if (PERMISSION_ERROR_CODES.has(error.code))
        return { code: "PERMISSION_DENIED", path: relativePath };

    return { code: "MISSING", path: relativePath };
}

/**
 * Checks one sentinel entry of a repository.
 *
 * @param {string} root The canonical repository root.
 * @param {{path: string, type: string}} sentinel The expected entry.
 * @returns {Promise<{code: string, path: string}|null>} A problem, or null when the entry is valid.
 */
async function checkSentinel(root, sentinel)
{
    try
    {
        const entryPath = await resolveInsideRoot(root, sentinel.path);
        const stats = await fs.promises.stat(entryPath);
        const correctType = sentinel.type === ENTRY_DIRECTORY ? stats.isDirectory() : stats.isFile();
        if (!correctType)
            return { code: "WRONG_TYPE", path: sentinel.path };

        await fs.promises.access(entryPath, fs.constants.R_OK);
        return null;
    }
    catch (error)
    {
        return describeEntryError(error, sentinel.path);
    }
}

/**
 * Returns the other repository kind a folder appears to be, to help when paths were swapped.
 *
 * @param {string} root The canonical folder.
 * @param {string} expectedKind The kind the user entered it as.
 * @returns {Promise<string|null>} The detected kind, or null.
 */
async function detectRepositoryKind(root, expectedKind)
{
    for (const kind of REPOSITORY_KINDS.filter((other) => other !== expectedKind))
    {
        const problems = await Promise.all(REPOSITORY_SENTINELS[kind].map((sentinel) => checkSentinel(root, sentinel)));
        if (problems.every((problem) => problem == null))
            return kind;
    }

    return null;
}

/**
 * Validates and canonicalizes a user-supplied repository path.
 *
 * @param {string} kind The repository kind.
 * @param {*} rawPath The submitted path.
 * @returns {Promise<{path: string}|{error: {code: string, message: string, missing?: Array<object>}}>}
 *          The canonical path, or a field error.
 */
async function validateRepositoryPath(kind, rawPath)
{
    const label = REPOSITORY_LABELS[kind];
    const fieldError = (code, message, extra = {}) => ({ error: { code, message, ...extra } });

    // Check the submitted text before using it as a path
    if (typeof rawPath !== "string" || rawPath.trim() === "")
        return fieldError("PATH_REQUIRED", `Enter the ${label} folder.`);

    const inputPath = rawPath.trim();
    if (inputPath.length > MAX_PATH_LENGTH || inputPath.includes("\0"))
        return fieldError("PATH_INVALID", "This path is not valid.");

    if (!path.isAbsolute(inputPath))
        return fieldError("PATH_NOT_ABSOLUTE", "Enter a full folder path, such as C:\\Code\\Repository.");

    // Network and device paths could make the server contact remote hosts.
    if (/^[\\/]{2}/.test(inputPath))
        return fieldError("PATH_UNSUPPORTED", "Network and device paths are not supported. Use a local folder.");

    // Resolve the folder itself, following any links the user chose deliberately
    let root;
    try
    {
        root = await fs.promises.realpath(inputPath);
        const stats = await fs.promises.stat(root);
        if (!stats.isDirectory())
            return fieldError("PATH_NOT_DIRECTORY", "This path is a file, not a folder.");
    }
    catch (error)
    {
        if (PERMISSION_ERROR_CODES.has(error.code))
            return fieldError("PERMISSION_DENIED", "The editor does not have permission to open this folder.");
        if (MISSING_ERROR_CODES.has(error.code))
            return fieldError("REPOSITORY_NOT_FOUND", "This folder does not exist. It may have been moved or deleted.");

        throw error;
    }

    // Confirm the folder contains the files that identify this repository
    const problems = (await Promise.all(REPOSITORY_SENTINELS[kind].map((sentinel) => checkSentinel(root, sentinel))))
        .filter((problem) => problem != null);
    if (problems.length > 0)
    {
        // Point out swapped folders, which are the most common mistake
        const detectedKind = await detectRepositoryKind(root, kind);
        const hint = detectedKind != null ? ` This folder looks like the ${REPOSITORY_LABELS[detectedKind]} repository.` : "";
        const denied = problems.some((problem) => problem.code === "PERMISSION_DENIED");
        const code = denied ? "PERMISSION_DENIED" : "REPOSITORY_INVALID_STRUCTURE";
        const summary = denied
            ? "The editor cannot read some required files in this folder."
            : `This folder is not a ${label} repository. Missing or invalid: ${problems.map((problem) => problem.path).join(", ")}.`;

        return fieldError(code, summary + hint, { missing: problems });
    }

    return { path: root };
}

/**
 * Returns the display name for a game, prettifying its ID when no name is declared.
 *
 * @param {{id: string, name: string}} game The parsed game.
 * @returns {string} The display name.
 */
function getGameDisplayName(game)
{
    return game.name || game.id.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * Sorts games the way Unbound Cloud's dropdown does: official games first, then alphabetically.
 *
 * @param {{id: string, name: string}} a The first game.
 * @param {{id: string, name: string}} b The second game.
 * @returns {number} The sort order.
 */
function compareGames(a, b)
{
    if (a.id === OFFICIAL_GAME_ID)
        return -1;
    if (b.id === OFFICIAL_GAME_ID)
        return 1;

    return a.name.localeCompare(b.name);
}

/**
 * Converts a module specifier from PokemonUtil.jsx into an allowed Cloud data file path.
 *
 * @param {string} specifier The import specifier.
 * @returns {string|null} The repository-relative path, or null if it is not an allowed data file.
 */
function resolveCloudDataSpecifier(specifier)
{
    const configDirectory = path.posix.dirname(CLOUD_GAME_CONFIG_FILE);
    const relativePath = path.posix.normalize(path.posix.join(configDirectory, specifier));
    if (!relativePath.startsWith(CLOUD_DATA_DIRECTORY) || !relativePath.endsWith(CLOUD_DATA_EXTENSION))
        return null;

    return relativePath;
}

/**
 * Reads the games Unbound Cloud declares and keeps those whose required data files exist.
 *
 * @param {string} cloudRoot The canonical Cloud repository root.
 * @returns {Promise<{games: Array<object>, diagnostics: Array<object>}>} Available games and diagnostics.
 */
async function readCloudGames(cloudRoot)
{
    // Read the declared games from PokemonUtil.jsx without running it
    const configPath = await resolveInsideRoot(cloudRoot, CLOUD_GAME_CONFIG_FILE);
    const parsed = parseCloudGameConfig(await fs.promises.readFile(configPath, "utf8"));
    const diagnostics = parsed.diagnostics.map((diagnostic) => ({ ...diagnostic, repository: REPOSITORY_CLOUD, file: CLOUD_GAME_CONFIG_FILE }));
    const games = [];

    // Keep only games whose required data files can be loaded
    for (const game of parsed.games)
    {
        const name = getGameDisplayName(game);
        const unavailable = (reason) => diagnostics.push(
        {
            severity: SEVERITY_WARNING,
            code: "GAME_UNAVAILABLE",
            message: `${name} is not available: ${reason}`,
            repository: REPOSITORY_CLOUD,
        });

        // A display name alone is not enough to load a game
        if (game.dataImports == null)
        {
            unavailable("it has no data files listed.");
            continue;
        }

        // Each required file must be an allowed data path that exists
        const dataFiles = {};
        const problems = [];
        for (const key of REQUIRED_GAME_DATA_KEYS)
        {
            const relativePath = game.dataImports[key] != null ? resolveCloudDataSpecifier(game.dataImports[key]) : null;
            if (relativePath == null)
            {
                problems.push(`${key} is not listed as a data file.`);
                continue;
            }

            try
            {
                const filePath = await resolveInsideRoot(cloudRoot, relativePath);
                if (!(await fs.promises.stat(filePath)).isFile())
                    throw new Error("Not a file");
                dataFiles[key] = relativePath;
            }
            catch
            {
                problems.push(`${relativePath} could not be found.`);
            }
        }

        if (problems.length > 0)
        {
            unavailable(problems.join(" "));
            continue;
        }

        games.push({ id: game.id, name, dataFiles });
    }

    // Match the order of Unbound Cloud's own game menu
    games.sort(compareGames);
    return { games, diagnostics };
}

/**
 * Reports spread files the editor will not be able to save, without writing to them.
 *
 * @param {string} cfruRoot The canonical CFRU repository root.
 * @returns {Promise<Array<object>>} Warning diagnostics.
 */
async function checkSpreadFileAccess(cfruRoot)
{
    const diagnostics = [];

    for (const relativePath of CFRU_SPREAD_FILES)
    {
        try
        {
            await fs.promises.access(await resolveInsideRoot(cfruRoot, relativePath), fs.constants.W_OK);
        }
        catch
        {
            diagnostics.push(
            {
                severity: SEVERITY_WARNING,
                code: "FILE_READ_ONLY",
                message: `${relativePath} is read-only. Changes to its spreads cannot be saved.`,
                repository: REPOSITORY_CFRU,
                file: relativePath,
            });
        }
    }

    return diagnostics;
}

/**
 * Returns a comparable form of a canonical path.
 *
 * @param {string} canonicalPath The canonical path.
 * @returns {string} The comparison key.
 */
function getPathKey(canonicalPath)
{
    return process.platform === WINDOWS_PLATFORM ? canonicalPath.toLowerCase() : canonicalPath;
}

/**
 * Creates a Windows folder picker that runs one fixed PowerShell dialog script at a time.
 *
 * @param {object} [options] Picker options.
 * @param {string} [options.platform] The host platform.
 * @param {Function} [options.runProcess] An execFile-compatible function.
 * @param {number} [options.timeoutMs] How long to wait for the user.
 * @returns {Function} An async function taking {kind, startPath, signal} and returning {status, path?}.
 */
function createFolderPicker({ platform = process.platform, runProcess = (...args) => childProcess.execFile(...args), timeoutMs = PICKER_TIMEOUT_MS } = {})
{
    let busy = false;

    return async function pickFolder({ kind, startPath, signal })
    {
        // Folder dialogs are Windows-only and limited to one at a time
        if (platform !== WINDOWS_PLATFORM)
            throw new ApiError(StatusCode.ServerErrorNotImplemented, "PICKER_UNSUPPORTED", "Folder browsing is only available on Windows. Type the folder path instead.");

        if (busy)
            throw new ApiError(StatusCode.ClientErrorConflict, "PICKER_BUSY", "A folder dialog is already open. Finish or cancel it first.");

        // Pass the start folder only when it is a plain local path
        const validStart = typeof startPath === "string" && startPath.length <= MAX_PATH_LENGTH
            && path.isAbsolute(startPath) && !/^[\\/]{2}/.test(startPath) && !startPath.includes("\0");
        const env =
        {
            ...process.env,
            [PICKER_TITLE_ENV]: `Select the ${REPOSITORY_LABELS[kind]} repository folder`,
            [PICKER_START_ENV]: validStart ? startPath : "",
        };

        busy = true;
        try
        {
            // Run the dialog and wait for the user
            const stdout = await new Promise((resolve, reject) =>
            {
                runProcess(PICKER_EXECUTABLE, PICKER_ARGUMENTS,
                    { env, signal, timeout: timeoutMs, windowsHide: true, maxBuffer: PICKER_MAX_OUTPUT_BYTES, encoding: "utf8" },
                    (error, output) => (error ? reject(error) : resolve(output)));
            });

            // The script prints one JSON result as its last line
            const lastLine = stdout.replace(/^\uFEFF/, "").trim().split(/\r?\n/).pop();
            const result = JSON.parse(lastLine);
            if (result.status === PICKER_STATUS_SELECTED && typeof result.path === "string" && result.path !== "")
                return { status: PICKER_STATUS_SELECTED, path: result.path };

            return { status: PICKER_STATUS_CANCELLED };
        }
        catch (error)
        {
            // Nobody is waiting for the result of a dialog closed by its page
            if (error.name === ABORT_ERROR_NAME)
                return { status: PICKER_STATUS_CANCELLED };

            // Translate process failures into advice to type the path instead
            if (error.killed)
                throw new ApiError(StatusCode.ServerErrorGatewayTimeout, "PICKER_TIMEOUT", "The folder dialog was closed because it was open too long.");
            if (PERMISSION_ERROR_CODES.has(error.code))
                throw new ApiError(StatusCode.ClientErrorForbidden, "PICKER_PERMISSION_DENIED", "Windows blocked the folder dialog. Type the folder path instead.");
            if (error.code === "ENOENT")
                throw new ApiError(StatusCode.ServerErrorInternal, "PICKER_UNAVAILABLE", "PowerShell could not be found, so the folder dialog cannot open. Type the folder path instead.");

            throw new ApiError(StatusCode.ServerErrorInternal, "PICKER_FAILED", "The folder dialog could not be opened. Type the folder path instead.");
        }
        finally
        {
            busy = false;
        }
    };
}
module.exports.createFolderPicker = createFolderPicker;

const pickFolder = createFolderPicker();

/**
 * Opens the native folder dialog for a repository.
 *
 * @param {*} kind The repository kind.
 * @param {*} [startPath] The folder to start in.
 * @param {AbortSignal} [signal] Closes the dialog when aborted.
 * @returns {Promise<{status: string, path?: string}>} The selection.
 */
async function pickRepository(kind, startPath, signal)
{
    if (!REPOSITORY_KINDS.includes(kind))
        throw new ApiError(StatusCode.ClientErrorBadRequest, "INVALID_REPOSITORY", "Unknown repository type.");

    return pickFolder({ kind, startPath, signal });
}
module.exports.pickRepository = pickRepository;

/**
 * Validates the three repositories and starts a workspace session.
 *
 * @param {Object<string, *>} paths Submitted paths by repository kind.
 * @returns {Promise<object>} The workspace snapshot.
 */
async function loadWorkspace(paths)
{
    // Validate all three folders together so every problem is reported at once
    const results = await Promise.all(REPOSITORY_KINDS.map((kind) => validateRepositoryPath(kind, paths?.[kind])));
    const fieldErrors = {};
    const roots = {};
    REPOSITORY_KINDS.forEach((kind, index) =>
    {
        if (results[index].error)
            fieldErrors[kind] = results[index].error;
        else
            roots[kind] = results[index].path;
    });

    // The same folder cannot be used for two repositories
    const seen = new Map();
    for (const kind of Object.keys(roots))
    {
        const key = getPathKey(roots[kind]);
        if (seen.has(key))
            fieldErrors[kind] = { code: "PATH_DUPLICATE", message: `This is the same folder as the ${REPOSITORY_LABELS[seen.get(key)]} repository.` };
        else
            seen.set(key, kind);
    }

    if (Object.keys(fieldErrors).length > 0)
        throw new ApiError(StatusCode.ClientErrorUnprocessableEntity, "REPOSITORY_VALIDATION_FAILED", "Some repository folders need to be corrected.", { fields: fieldErrors });

    // Gather the games and any warnings about the repositories
    const { games, diagnostics: gameDiagnostics } = await readCloudGames(roots[REPOSITORY_CLOUD]);
    const diagnostics = [...gameDiagnostics, ...(await checkSpreadFileAccess(roots[REPOSITORY_CFRU]))];
    if (games.length === 0)
        throw new ApiError(StatusCode.ClientErrorUnprocessableEntity, "NO_GAMES_AVAILABLE", "Unbound Cloud does not list any games with complete data.", { diagnostics });

    // Start the session, forgetting the oldest ones so memory stays bounded
    const workspace =
    {
        id: crypto.randomUUID(),
        roots,
        games: new Map(games.map((game) => [game.id, game])),
    };

    workspaces.set(workspace.id, workspace);
    while (workspaces.size > MAX_WORKSPACES)
        workspaces.delete(workspaces.keys().next().value);

    // Game data file paths stay on the server
    return {
        workspaceId: workspace.id,
        repositories: Object.fromEntries(REPOSITORY_KINDS.map((kind) => [kind, { path: roots[kind], label: REPOSITORY_LABELS[kind] }])),
        games: games.map(({ id, name }) => ({ id, name })),
        diagnostics,
    };
}
module.exports.loadWorkspace = loadWorkspace;

/**
 * Returns a workspace session.
 *
 * @param {string} workspaceId The workspace ID.
 * @returns {object} The workspace.
 */
function getWorkspace(workspaceId)
{
    const workspace = workspaces.get(workspaceId);
    if (workspace == null)
        throw new ApiError(StatusCode.ClientErrorNotFound, "WORKSPACE_NOT_FOUND", "The repositories need to be loaded again.");

    return workspace;
}
module.exports.getWorkspace = getWorkspace;

/**
 * Reads a file the workspace owns, rechecking that it is still inside its repository.
 *
 * @param {object} workspace The workspace.
 * @param {string} kind The repository kind.
 * @param {string} relativePath The repository-relative path, which must come from server-owned data.
 * @returns {Promise<string>} The UTF-8 contents.
 */
async function readOwnedFile(workspace, kind, relativePath)
{
    try
    {
        // The file may have been moved or replaced with a link since the workspace loaded
        const filePath = await resolveInsideRoot(workspace.roots[kind], relativePath);
        const stats = await fs.promises.stat(filePath);
        if (!stats.isFile() || stats.size > MAX_OWNED_FILE_BYTES)
            throw new ApiError(StatusCode.ClientErrorUnprocessableEntity, "FILE_UNSUPPORTED", `${relativePath} is not a supported file.`);

        return await fs.promises.readFile(filePath, "utf8");
    }
    catch (error)
    {
        if (error instanceof ApiError)
            throw error;

        throw new ApiError(StatusCode.ClientErrorConflict, "REPOSITORY_FILE_UNAVAILABLE",
            `${relativePath} in the ${REPOSITORY_LABELS[kind]} repository can no longer be read. Load the repositories again.`,
            { repository: kind, file: relativePath });
    }
}
module.exports.readOwnedFile = readOwnedFile;
