---
name: editor-state
description: "Use when changing SpreadEditorState.jsx, the editor reducer, drafts, newEntries, orders, orderMoves, cross-set transfers, deletes/restores, dirty counts, unsaved-change localStorage cache, saveChanges, in-flight saves, or navigation guards."
---

# Editor State

The provider owns loaded snapshots and unsaved work. Dialogs and grid layout consume its actions; edits remain drafts until the revisioned API save succeeds.

## Files

- [src/SpreadEditorState.jsx](../../../src/SpreadEditorState.jsx): reducer, indexes, persistence, validation, requests, operations, ID remapping, and context actions.
- [shared/spread-layout.mjs](../../../shared/spread-layout.mjs): saved/default order, insertion, moved-ID detection, and group/peer restoration.
- [shared/spread-model.mjs](../../../shared/spread-model.mjs): strict field differences, compaction, battle modes, and numeric validation.
- [src/SpreadEditorPage.jsx](../../../src/SpreadEditorPage.jsx): local pending additions, filters, edit and repair dialogs, Save Changes and Revert All.
- [src/components/SpreadGrid.jsx](../../../src/components/SpreadGrid.jsx): order/transfer callbacks and hidden transferred originals.
- [src/components/SpreadCard.jsx](../../../src/components/SpreadCard.jsx) and [src/components/SpreadDialogs.jsx](../../../src/components/SpreadDialogs.jsx): editing/deletion controls and unsaved prompts.
- [src/App.jsx](../../../src/App.jsx): `NavigationGuard` for route changes and browser unload; [src/components/Header.jsx](../../../src/components/Header.jsx): guarded Change Game/Change Repositories.
- [src/components/RepositorySetup.jsx](../../../src/components/RepositorySetup.jsx): loading phases and canceling setup changes.
- [server/endpoints/workspaces.js](../../../server/endpoints/workspaces.js) and [server/services/spread-store.js](../../../server/services/spread-store.js): revisioned snapshot/save contract and `createdIds`.

## Data flow

1. Settings load paths/game, repositories load a workspace/spreads snapshot, and catalog success enters Ready. `indexSpreads` builds entry/set Maps. A different workspace clears unsaved state; the same workspace object retains it. Catalog success attempts cache restoration.
2. Components read current values from `drafts[id] ?? entry.fields`. `updateSpread` supplies current fields, saved fields, and modify memory to its callback; `applyChanges` merges partial changes. `putDraft` accepts only editable entries, drops saved-entry drafts equal to saved fields, and always retains new-entry drafts.
3. Add, transfer, order, delete, restore, and revert actions update separate structures. Derived moved IDs and transferred originals drive dirty counts, highlighting, visibility, and guard prompts.
4. A Ready-only effect persists revision-bound changes to localStorage. `saveChanges` captures drafts/deletions/orders, validates, builds update/delete/add/reorder operations, and posts the revision/game.
5. Success installs the returned snapshot, remaps temporary IDs, drops submitted work, and retains eligible later edits. Failure stores the error without discarding unsaved work.

## Behavior and user decisions

### Drafts, additions, order, and transfers

- State separates `drafts`, `newEntries`, `orders`, `orderMoves`, `deleted`, `modifyMemory`, and `editing`. Editing is a Set with at most one active entry. Closing editing keeps changes and compacts drafted moves; it is not cancellation. When every move is empty, `SET_EDITING` fills Move 1 using `getLearnableMoveOptions(catalog, species).options[0]` and `setMove`, matching Add Spread's name-sorted default and typed Hidden Power IV handling. This also creates a draft for an originally empty saved entry with no edits. No options or catalog leaves moves unchanged; existing partial moves are not replaced. Deleted, locked and placeholder entries are excluded, and delete/revert actions do not seed a move. Leaving Both remembers the prior Modify Moves Doubles choice; saved-entry Revert clears that memory.
- Choosing a species in Add Spread creates page-local `pending` fields, not a provider draft or cache entry. Add compacts moves and calls `addSpreads`; cancel/close asks to discard that pending spread. Bulk imports call `addSpreads` directly.
- Add requires `canInsert` and a catalog-known species, assigns unused `new-*` IDs, inserts into the entry Map/newEntries/drafts, and places each entry after its species' last peer or at the set end. It records an order even when no existing entry was moved, since additions need anchors.
- `orders[setId]` includes every saved ID, including deleted entries, plus new IDs exactly once. `orderSet` requires `canReorder` and a complete permutation. `orderMoves` records preferred moved IDs and `GROUP_MOVE_PREFIX` markers so highlighting distinguishes a whole species move from a peer move. A saved-exact order is dropped; new-only positioning remains, but no-op movement metadata is removed.
- `ORDER_SET` defaults omitted `moved` metadata to an empty list. Spread-file imports dispatch complete reorder operations without user-movement hints; these must stage additions and order safely instead of throwing. Existing movement metadata still participates in normal cleanup.
- Revert Order restores saved positions without removing new spreads. Revert Group restores only that group's place, preserving internal peer moves. Revert Spread Order restores only that peer within its species. Saved-entry Revert clears field/deletion/memory changes and its internal peer movement, leaving group movement alone.
- Cross-set transfer requires an editable source, another valid set, and destination `canInsert` except when returning to the original saved set. A saved source cannot be moved out if no surviving saved/new entry would remain. Moving an already-new entry does not apply that saved-source emptiness check.
- A saved transfer removes its source draft, marks the original deleted, and creates a destination new entry carrying current fields and `movedFrom`. Later transfers replace the temporary entry while retaining original identity. Returning to the saved set removes the temporary entry, restores the original ID at its existing source-order position, and preserves changed fields as its draft, ignoring `beforeId`. Other transfers use a destination `beforeId` only when that destination can reorder; otherwise normal species insertion applies.
- Transferred originals stay in source order data but are hidden in results. Reverting the destination removes it and restores the original saved entry, not its pre-transfer field draft. Deleting the destination instead keeps the original deleted. Ordinary new-entry deletion simply removes the addition and produces no server delete operation.
- Ordinary saved deletion keeps the card in place with Restore and retains any field draft; Restore undeletes without losing that draft. Deleted drafts are excluded from save validation and updates. The reducer does not preemptively block deleting the last saved spread; the server rejects an empty resulting set.
- Revert All clears drafts/new entries/orders/deletions/memory/editing/error and rebuilds indexes from the saved snapshot. Dirty count is a union of draft IDs, deleted originals excluding transfers, and moved saved IDs. A reordered transferred original can remain in `movedIds`, so transfer bookkeeping does not guarantee a single dirty ID.

### Cache and save semantics

- `trackedPost` adds a fresh operation UUID through Axios query params, updates `setupProgress` or `archiveProgress` from real byte/server progress, and polls sequentially without overlapping requests. Pending values cap at 99; successful load/download reducers set 100. Failed/missing polls do not fail the main request, and retry/unmount stops timers, aborts polls, and invalidates late callbacks. A shared token promise prevents main/poll session-renewal races.
- Archive import uses normal loading/catalog phases but commits returned cached repository paths only after upload succeeds. Download has separate `downloading`/`archiveError` state, Blob-aware session retries, and workspace restart recovery. Header download uses the unsaved guard and starts after its Save/Discard state commits. Download and save requests cannot run concurrently; ZIP export contains saved disk sources only.
- `getPendingOperations` is shared by Save Changes and import context. `downloadArchive(spreadsOnly, exportName)` sends the optional name and keeps it on workspace-recovery retry; `listSpreadExports()` and `importSpreadFiles(file, { baselineId })` handle token/workspace recovery and post pending operations to `/spread-files/current` before uploading with `currentId`. `clearArchiveFeedback` dispatches `ARCHIVE_RESET` to clear archive feedback. Import never replaces the saved snapshot.
- `SPREAD_IMPORT_SUCCESS` applies returned update/delete/add/reorder operations into normal drafts, new entries, deletions, and orders (new IDs use `new-*`), persisting through the unsaved cache. Synchronous `acceptSpreadComparison(comparisonOrArray, editorOperationKey)` stages one or an atomic batch of comparisons with no request, checking the expected pending-operation key; a failed batch changes nothing, and `additionOrder` preserves incoming order.
- Settings use `cfruSpreadEditor.settings`, version 1. Changes use `cfruSpreadEditor.unsavedChanges`, version 1. Draft storage includes revision, drafts, newEntries, orders, orderMoves, deleted IDs, modifyMemory, and saved `{ setId, fields }` for referenced non-new entries. It does not include catalog, editing state, pending additions, or preview level. Empty work removes the cache; blocked/full draft storage fails silently, while failed settings writes expose a warning.
- Restore requires the same revision and no current drafts/deletions. Each saved entry must still be editable with identical set ID and JSON-serialized fields. New entries require a valid `new-*` ID, insertable set, catalog-known species, and moves array; transferred additions additionally require a matching deleted original. Invalid pieces are filtered rather than trusted wholesale.
- Restored orders must exactly cover saved plus accepted new IDs, with all saved entries matching cached bases. Non-reorderable sets keep orders only when saved relative order is unchanged. Missing/invalid new positioning falls back to species insertion; no-op saved order is removed. A revision mismatch ignores the cached work without attempting migration. The cache is local recovery, not an external-change merge.
- Save rejects a concurrent save or draft validation problems. Existing updates contain only changed fields; deleted originals produce deletes; new entries produce full-field adds with a nearest preceding surviving saved anchor. Reorder is sent only when add-anchor default order would not produce the requested order. Complete reorder lists still name deleted saved IDs and same-save temporary IDs. All four operation types are currently generated by the browser.
- Requests carry `X-Session-Token`, acquired lazily. HTTP 401 clears the token and retries once. `WORKSPACE_NOT_FOUND` during save reloads repositories and retries only when revision, set IDs, and ordered entry IDs match; otherwise it reports restart plus changed files. Ordinary save conflicts keep drafts and do not overwrite outside edits.
- Success remaps temporary draft/order/movement IDs through `createdIds`, replaces the saved snapshot, and clears editing/saving. Drafts are retained only when their object differs from the submitted object and their fields still differ from the rebuilt indexed entry. Unsubmitted new entries remain indexed, but fields identical to their initial entry fields can lose their draft; a later add payload reads that draft without falling back to entry fields. Orders changed by reference during the request remain and are rechecked for no-ops. Submitted deletion IDs are removed from the current deleted Set. Failures leave the changes and expose `saveError`.
- Header game/repository changes and pathname navigation use Save/Discard/Cancel prompts when dirty. Save proceeds only on success; invalid drafts disable prompt saving. Discard clears changes first. Reload/close uses the native `beforeunload` warning. The route guard compares pathnames, not query/hash-only changes. Low-level phase-changing actions do not themselves implement these prompts.

## Invariants and pitfalls

- Do not mutate draft/order objects in place: in-flight save reconciliation depends on reference identity. Keep original IDs, temporary IDs, and `movedFrom` separate.
- Do not remove deleted IDs from full order arrays or emit updates for deleted entries. Addition anchors cannot be new or deleted saved entries.
- Source permissions and preprocessor segment checks remain authoritative on the server; browser permutations alone cannot prove a reorder is safe.
- Filters normally read saved/current values when their result memo recomputes, not on each field edit, so cards do not vanish mid-edit. Bulk repair/export scope is matching results across pages, not just visible cards.
- Save reconciliation is not a general concurrent merge: submitted deletions clear by ID, editing always closes, and reverting fields to the old saved value during a save can remove a draft before reconciliation. Do not promise every possible in-flight action is preserved; add explicit race tests when changing this logic.

## Tests and commands

- [src/tests/SpreadEditor.test.jsx](../../../src/tests/SpreadEditor.test.jsx): editing lifecycle, cached fields/deletes, failure/success, blockers, compaction, bulk repair, and navigation prompts. Run from root: `yarn test src/tests/SpreadEditor.test.jsx --run`.
- [src/tests/AddReorder.test.jsx](../../../src/tests/AddReorder.test.jsx): pending additions, temp-ID mapping, add-only/default order, moves/reverts, transfers, and cached new/order state. Run: `yarn test src/tests/AddReorder.test.jsx --run`.
- [src/tests/RepositorySetup.test.jsx](../../../src/tests/RepositorySetup.test.jsx), [src/tests/SpreadLayout.test.jsx](../../../src/tests/SpreadLayout.test.jsx), and [src/tests/SpreadGridPagination.test.jsx](../../../src/tests/SpreadGridPagination.test.jsx): phases/restarts/storage, pure movement rules, and pagination. Run the affected root-relative file with `--run`; `$env:DEBUG_PRINT_LIMIT=0` quiets React diagnostics.
- [src/tests/EditorFixtures.js](../../../src/tests/EditorFixtures.js): mocked Axios routes and snapshots. [server/tests/services/spread-writer.test.js](../../../server/tests/services/spread-writer.test.js) verifies the real operation contract in isolated fixtures; from server run `yarn test tests/services/spread-writer.test.js`.

## Change checklist

1. Trace the action through indexes, drafts, new entries, orders, deletion state, dirty count, cache, payload, and success reconciliation.
2. Check saved/new/locked entries, transfer and return, revert versus delete, empty-source protection, group versus peer movement, and no-op cleanup.
3. Test cache revision/value mismatch, blocked storage, add/order restoration, failures/restarts, created IDs, and edits during deferred saves where relevant.
4. Verify header, route, unload, and pending-add behavior without treating Done as revert. Run focused tests and update this skill; restart port 3001 after server code changes.
