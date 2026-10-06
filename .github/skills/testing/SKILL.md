---
name: testing
description: "Use when adding or running CFRU Spread Editor tests, choosing Vitest or Mocha suites, mocking Axios, using EditorFixtures, isolating SPREAD_EDITOR_DATA_DIR, creating temporary repository fixtures, or verifying UI, parser, save, security, cache, and recovery changes."
---

# Testing

Use Yarn and the narrowest relevant suite. Test user-visible behavior and real source/save boundaries without touching the sibling CFRU, DPE, or Unbound Cloud checkouts.

## Files

- [package.json](../../../package.json): Vite/Vitest scripts and frontend dependencies; [vite.config.js](../../../vite.config.js): jsdom, globals, setup, and timeout.
- [src/tests/SetupTests.js](../../../src/tests/SetupTests.js): jest-dom matchers, Testing Library timeout, and no-op `ResizeObserver`.
- [src/tests/EditorFixtures.js](../../../src/tests/EditorFixtures.js): catalog/field/spread/workspace builders, Axios-shaped errors, and `mockServer` route handlers/call capture.
- [server/package.json](../../../server/package.json): Mocha scripts and Chai/Supertest dependencies.
- [server/tests/helpers/fixture-repositories.js](../../../server/tests/helpers/fixture-repositories.js): disposable synthetic repository trees and cleanup.
- [server/tests/helpers/spread-fixtures.js](../../../server/tests/helpers/spread-fixtures.js): spread/config/trainer source variants; [server/tests/helpers/catalog-fixtures.js](../../../server/tests/helpers/catalog-fixtures.js): catalog, learnsets, indexed PNGs, and fake PokeAPI responses.
- [server/tests/helpers/smogon-fixtures.js](../../../server/tests/helpers/smogon-fixtures.js): Smogon set/analysis fixtures for network-free service and endpoint tests.
- [server/tests/endpoints/workspaces.test.js](../../../server/tests/endpoints/workspaces.test.js): fresh app/session setup, API/security integration, and fixture-local data environment.
- [server/tests/services/spread-writer.test.js](../../../server/tests/services/spread-writer.test.js): injected store/data directories and real byte-preservation/save/recovery tests.
- [server/tests/services/parse-cache.test.js](../../../server/tests/services/parse-cache.test.js): isolated cache directories; [server/server.js](../../../server/server.js): exported Express app without listening on import.

## Data flow

1. Frontend integration suites build synthetic server-shaped snapshots, mock Axios before executing `mockServer` and rendering the provider/App, and interact through Testing Library. `mockServer` normalizes workspace catalog/save routes, applies overrides, and records route/body/token calls; it is not a real HTTP/security test.
2. Pure shared rules are tested directly alongside component suites. jsdom presents DOM semantics, not reliable real layout/CSS; layout tests supply measurements explicitly.
3. Backend helpers create synthetic repositories under an OS temporary folder. Parsing/writing services consume those paths; endpoint tests import a fresh Express app and use Supertest with a local origin/session token.
4. Tests assert rendered outcomes, request operations, normalized snapshots, or exact source bytes and failure artifacts. Hooks restore environment/mocks and remove disposable data after use.

## Tests and commands

| Purpose | Working directory | Command |
| --- | --- | --- |
| One frontend file, exit after run | Workspace root | `yarn test src/tests/SpreadEditor.test.jsx --run` |
| Frontend name selection | Workspace root | `yarn test src/tests/SpreadEditor.test.jsx --run -t "test name"` |
| All frontend tests | Workspace root | `yarn test-all` |
| One backend file | Server | `yarn test tests/services/spread-writer.test.js` |
| Backend name selection | Server | `yarn test tests/services/spread-writer.test.js --grep "test name"` |
| All backend tests | Server | `yarn test-all` |
| Production build | Workspace root | `yarn build` |

- Frontend `test` is `vitest`; without `--run` it can watch interactively. `test-all` is `vitest src/tests/*.test.jsx --run`, so nested tests or other extensions are not automatically covered by that explicit pattern.
- Server CI installs both root and server dependencies: imports from `shared/` resolve packages through root `node_modules`, not `server/node_modules`.
- Server `test` is `mocha`; `test-all` is `mocha tests/**/*.test.js`. Pass the full server-relative path, not just a nested file's basename. Use `test`, not `test-all`, for focused file selection.
- In PowerShell, `$env:DEBUG_PRINT_LIMIT=0; yarn test src/tests/SpreadEditor.test.jsx --run` reduces verbose DOM diagnostics. Use semicolons or `Push-Location`/`Pop-Location`, not shell `&&` in PowerShell 5.1. Frontend commands belong at root because some source assertions use root-relative reads.
- Larger runtime changes finish with both complete suites and the build. Report unrelated failures without unrelated fixes. Documentation-only changes need link/frontmatter/fact verification, not a claim that runtime tests were run.
- Spread-file exchange tests live in `server/tests/endpoints/archives.test.js`, `src/tests/RepositorySetup.test.jsx`, and `src/tests/SpreadCard.test.jsx`. The key invariant is that no CFRU bytes, backups, or journals change before Save Changes. The setup suite spies on Axios before resetting it so its request mocks stay usable with the current toolchain.

## Behavior and user decisions

### Frontend fixtures and cleanup

- Vitest uses globals, jsdom, a 30-second test timeout, and shared setup. Testing Library async queries have a 5-second timeout. Global `ResizeObserver` has no-op methods; it does not measure anything.
- Editor integration suites use hoisted `vi.mock("axios", ...)`, reset `axios.post`, and clear localStorage in `beforeEach`. Axios must be mocked before `mockServer` executes, not textually before the fixture import; Vitest hoists `vi.mock`. The standalone App suite does not mock Axios. Clone/build fresh mutable fixtures instead of leaking state across tests.
- Prefer awaited `userEvent`, accessible role/name queries, scoped `within(dialog)`, and `findBy`/`waitFor` for async changes. Dialogs use portals; querying only the render container can miss them.
- Testing Library normally cleans the DOM automatically; reload tests also use explicit `cleanup()` between renders while preserving cache data. Shared setup does not globally reset mocks/storage/spies/stubbed globals. Use `vi.restoreAllMocks` and `vi.unstubAllGlobals` where applicable; DOM cleanup, mock resets, and storage clearing are separate responsibilities.
- Assert observable controls, warning text, drafts, and payloads rather than unstable generated MUI class names. Simulate scroll geometry with explicit properties. CSS source checks currently use `readFileSync` from root; raw CSS imports can be stubbed and `import.meta.url` may be HTTP. Normalize whitespace/newlines in source assertions.

### Backend isolation and security

- Project policy requires new server tests to set `SPREAD_EDITOR_DATA_DIR` to temporary storage and use disposable fixture repositories. The existing helper constructs synthetic CFRU/DPE/Cloud trees, not copies of live checkouts; its paths intentionally contain spaces. `fixture.cleanup()` removes the entire temporary base recursively.
- Endpoint `beforeEach` creates a fixture, sets its temporary editor-data environment path, reloads server modules through `startServer`, and obtains a fresh token. `afterEach` restores `childProcess.execFile` and deletes the fixture; suite `after` restores the original environment variable. Be explicit about lifecycle when adding tests.
- Existing service tests also isolate without changing that environment: spread-writer injects `dataDirectory` into `createSpreadStore`; parse-cache and PokeAPI tests inject temporary `directory` paths. These are established facts, not evidence that every suite already sets the environment. Retain explicit injections and set environment isolation for new default-service tests.
- Set isolation before constructing default services/importing a fresh app. There is no global backend hook enforcing it, and endpoint prewarming currently imports the app before its per-test environment assignment. Do not copy that ordering as a universal safe setup.
- Supertest uses exported `app`; no live server or port is needed. Acquire a token with `POST /api/session` and `Origin: http://localhost:3000`; protected JSON requests set `X-Session-Token` and send an object. Test rejection separately for untrusted origin/host, tokens, malformed/non-JSON/non-object/oversized bodies, and unknown routes. Image routes are mounted before token middleware.
- Native folder-picker endpoint tests are Windows-gated and fake the child process; service tests inject platform/process behavior. Do not open a real native picker. Catalog endpoint tests replace/restore `globalThis.fetch`; catalog/PokeAPI service tests inject `fetchResource` to avoid real network dependence.
- `CLIENT_ORIGINS` is read at module load after dotenv loading; an external configuration can change assumptions about the fixed test origin. Restore changed environment and global/process functions, and keep caches/backups/journals under disposable data roots.

## Test selection

| Area | Existing focused tests |
| --- | --- |
| App/theme and setup | [src/tests/App.test.jsx](../../../src/tests/App.test.jsx), [src/tests/RepositorySetup.test.jsx](../../../src/tests/RepositorySetup.test.jsx) |
| Drafts/cache/save/guards and bulk repair | [src/tests/SpreadEditor.test.jsx](../../../src/tests/SpreadEditor.test.jsx) |
| Add/reorder/transfer and pagination | [src/tests/AddReorder.test.jsx](../../../src/tests/AddReorder.test.jsx), [src/tests/SpreadGridPagination.test.jsx](../../../src/tests/SpreadGridPagination.test.jsx) |
| Cards and stat presentation | [src/tests/SpreadCard.test.jsx](../../../src/tests/SpreadCard.test.jsx) |
| Model/mechanics/layout and filters | [src/tests/SpreadMechanics.test.jsx](../../../src/tests/SpreadMechanics.test.jsx), [src/tests/SpreadLayout.test.jsx](../../../src/tests/SpreadLayout.test.jsx), [src/tests/SpreadFilters.test.jsx](../../../src/tests/SpreadFilters.test.jsx) |
| Choosers | [src/tests/MovePicker.test.jsx](../../../src/tests/MovePicker.test.jsx), [src/tests/ItemPicker.test.jsx](../../../src/tests/ItemPicker.test.jsx) |
| Showdown parsing/dialogs/compatibility | [src/tests/Showdown.test.jsx](../../../src/tests/Showdown.test.jsx), [src/tests/ShowdownDialogs.test.jsx](../../../src/tests/ShowdownDialogs.test.jsx), [server/tests/services/showdown.test.js](../../../server/tests/services/showdown.test.js) |
| API/security/load/catalog/images/save | [server/tests/endpoints/workspaces.test.js](../../../server/tests/endpoints/workspaces.test.js) |
| ZIP export/import/security/cached saves | [server/tests/endpoints/archives.test.js](../../../server/tests/endpoints/archives.test.js), [src/tests/RepositorySetup.test.jsx](../../../src/tests/RepositorySetup.test.jsx) |
| Real operation progress/polling/tooltips | [server/tests/services/progress.test.js](../../../server/tests/services/progress.test.js), [server/tests/endpoints/progress.test.js](../../../server/tests/endpoints/progress.test.js), [src/tests/RepositorySetup.test.jsx](../../../src/tests/RepositorySetup.test.jsx) |
| Repository paths/picker and game data | [server/tests/services/repositories.test.js](../../../server/tests/services/repositories.test.js), [server/tests/services/catalog.test.js](../../../server/tests/services/catalog.test.js) |
| Preprocessor/source/spreads | [server/tests/services/preprocessor.test.js](../../../server/tests/services/preprocessor.test.js), [server/tests/services/source-parser.test.js](../../../server/tests/services/source-parser.test.js), [server/tests/services/spread-parser.test.js](../../../server/tests/services/spread-parser.test.js) |
| Cache/save/conflicts/recovery | [server/tests/services/parse-cache.test.js](../../../server/tests/services/parse-cache.test.js), [server/tests/services/spread-writer.test.js](../../../server/tests/services/spread-writer.test.js) |

## Invariants and pitfalls

- Never write tests against real sibling repository paths or default persistent app data. Source edits belong only to temporary fixture trees, with cleanup even on failure.
- Frontend mock success does not verify server permissions, source patching, session security, or rollback. Pair UI tests with backend tests when a request contract changes.
- For parser/save changes, cover BOM, LF/CRLF, Unicode/comments, inactive branches, unknown fields, locked initializers, stable IDs, conflicts, rollback, and recovery as relevant. Assert unchanged bytes as well as parsed values.
- A build is not a test run, and jsdom is not visual browser verification. Distinguish skipped platform tests and pre-existing failures from passing coverage.

## Change checklist

1. Select the narrowest existing suite and reuse its builders; add tests for every new feature/component and its observable behavior.
2. Verify mock/global/storage cleanup for frontend tests, and temporary repositories/data/environment/process/network isolation for backend tests.
3. Run the focused command from the correct directory; use both full suites plus build for larger runtime changes.
4. Report commands/results, skipped or unrelated failures, and update this skill when conventions change. After server code changes, remind the user to restart the API on port 3001; Vite uses port 3000.
