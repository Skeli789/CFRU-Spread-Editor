---
name: adding-reordering
description: "Use when changing Add Spread, pending new spreads, species insertion, SpreadGrid drag and drop, peer left/right moves, Move Here species-group placement, Revert Order, cross-set transfers, new IDs, insertion anchors, or add/reorder save operations."
---

# Adding and Reordering

Additions, peer/group reorders, and cross-set transfers are implemented draft operations. They change CFRU source only after Save Changes.

## Files

- [src/components/SpreadDialogs.jsx](../../../src/components/SpreadDialogs.jsx): Add Spread species/import tabs, set picker, pending edit/discard, and edit focus.
- [src/components/SpreadGrid.jsx](../../../src/components/SpreadGrid.jsx): add tiles, drag/drop targets, peer arrows, group placement/confirmation, and order reverts.
- [src/SpreadEditorPage.jsx](../../../src/SpreadEditorPage.jsx): pending fields, defaults, add/import callbacks, reveal requests, and edit set transfers.
- [src/SpreadEditorState.jsx](../../../src/SpreadEditorState.jsx): new entries/IDs, complete orders, movement metadata, transfer permissions, cache, and payloads.
- [shared/spread-layout.mjs](../../../shared/spread-layout.mjs): insertion, peer/group moves, drop rules, moved detection, and independent restores.
- [shared/spread-model.mjs](../../../shared/spread-model.mjs): new defaults, move compaction, validation; [shared/showdown.mjs](../../../shared/showdown.mjs): import resolution.
- [src/subcomponents/MovePicker.jsx](../../../src/subcomponents/MovePicker.jsx): name-sorted prefill options; [src/components/SpreadCard.jsx](../../../src/components/SpreadCard.jsx): new marker and delete/edit actions.
- [src/styles/SpreadEditorPage.css](../../../src/styles/SpreadEditorPage.css): handles, subgrid headings, Move Here gaps, drag highlighting, and add tiles.
- [server/services/spread-store.js](../../../server/services/spread-store.js) and [server/services/spread-writer.js](../../../server/services/spread-writer.js): authoritative insert/reorder permissions and source operation contract.

## Data flow

1. Toolbar Add Spread defaults to the filtered set; a section-ending add tile chooses that section's set. A single species filter supplies the initial species choice.
2. Choose Species opens a page-local pending editor with shared defaults and the first name-sorted picker option when available. That option can have unknown legality: complete learnsets include conditional unknown moves, and incomplete learnsets offer all game options. Its Add validates/compacts, then `addSpreads` creates provider entries/drafts/orders. Import adds all successfully resolved sets directly.
3. The grid proposes complete source permutations through pure layout helpers; `orderSet` validates the set's permission and exact ID coverage. `orderMoves` tracks peer IDs and `group:` markers.
4. Transfers use provider permission checks and deleted-original/new-destination bookkeeping. Results hide transferred originals while source order arrays retain them.
5. Revision-bound localStorage restores new/order state. Save builds add anchors and only necessary reorder operations; returned `createdIds` remap temporary IDs. See [editor-state](../editor-state/SKILL.md) and [spread-saving](../spread-saving/SKILL.md).

## Behavior and user decisions

### Adding

- Sets are grouped by readable file name, with disabled destinations showing insertion reasons. If the preferred set is blocked, start with no selected set rather than silently choosing a different one.
- Species options are name-sorted catalog forms excluding battle-only forms; selection reveals sprite/types/base stats/abilities. Add requires an insertable set and known species. Enter selects the highlighted species, and another Enter after the list closes opens its editor.
- Pending fields are not provider changes or cached drafts. The pending editor starts at selected Move 1, can change destination, and requires a valid move before Add. Cancel/Escape/backdrop asks Keep Editing or Discard. Add compacts moves and reveals the new entry if it matches current filters.
- Import Showdown Text resolves deferred text, reports warnings/errors, skips bad sets, and permits valid sets to import together despite other errors. It bypasses the pending single-species editor; detailed exchange rules belong to the exchange feature.
- New entries get unused `new-*` IDs, `isNew`, full-field drafts, and positions after their species' last source peer or at the set end. The visible Add Spread at the End tile does not force raw end insertion ahead of species insertion rules.
- Ordinary new cards show a green NEW symbol, not a chip, and no Revert. Delete removes the addition without a server delete operation. Revert Order preserves additions in default species positions.

### Peer and group movement

- Peer arrows move one position earlier/later within the same stored species and set. Handle dragging can target same-species peers or another set's cards/headings, not a different species in the same set.
- Peer movement requires editable source, `canReorder`, and all that species' nonhidden entries in results. Whole-group movement requires `canReorder` and all nonhidden entries of that set. Checks work per set even with multiple sets visible.
- Drag handles remain enabled for editable entries when in-set reorder is blocked or filters hide peers, because cross-set transfer can still be allowed. Destination collision targets reject self/incompatible peers. Final drop validates event source data, not possibly stale React highlight state; canceled drops do nothing.
- Peer moves permute only that species' existing source slots, leaving other species slots untouched. Visual grouping by species is not itself a reorder.
- Whole groups use Move/Cancel then Move Here gaps, not group dragging or up/down arrows. Placement persists across pages. Filters/reset key or completeness permissions can hide active placement without clearing `placing`; it may resume when validity returns. Add tiles hide while placement is active.
- Gaps exclude the current/adjacent no-op position. Shared rows use narrow vertical gap columns; single-species rows use horizontal gaps. A completed group's trailing gap works even before a group on the next page.
- A non-no-op group move asks Move Species Group? when any species is interleaved anywhere in the set's current order, before coalescing all species' source entries into contiguous groups. Cancel leaves the order untouched. Movement applies directly when no species is interleaved.
- Movement metadata favors intentionally moved saved entries for changed highlighting/dirty counts. Group and peer reverts are independent: group Revert keeps its internal peer order; peer Revert keeps the group's location. Set Revert Order restores saved order plus default additions without clearing field drafts.
- Saved-entry edit Revert also resets that entry's peer order, not whole-group order. No-op orders/movement markers stop offering Revert Order; insertion bookkeeping alone is not a reorder change.

### Cross-set transfers and saving

- Spread Set in the edit dialog performs a transfer, not a filter change. Dragging onto another set's card transfers before that card only if destination can reorder; heading drop/default transfer uses normal species insertion.
- A transfer needs an editable source and insertable destination, except returning to its original saved set needs no insertion permission. Moving a saved entry cannot empty its source after accounting for deletions/additions. Already-new transfers bypass that saved-source check.
- Saved transfer marks its original deleted and creates a temporary destination entry carrying current fields and `movedFrom`. Repeated transfers retain original identity. Returning to the saved set restores its original ID at its existing source-order position, ignores `beforeId`, and keeps current changed fields.
- Reverting the transferred destination restores the original saved entry, not its pretransfer field draft. Deleting the destination leaves the original deleted. Transfers do not show NEW; dirty count excludes their originals from deletions, but a reordered original can still contribute through `movedIds`.
- Orders cover saved IDs, including deleted/transferred originals, plus new IDs exactly once. Add payloads use the nearest preceding surviving saved ID, or null, as `afterEntryId`; do not anchor on new/deleted IDs.
- Browser saves currently emit update/delete/add/reorder operations. Add-only default placement needs no redundant reorder. Reorder lists may contain deleted saved IDs and same-save temporary IDs; server source/preprocessor permissions remain authoritative.

## Invariants and pitfalls

- Keep pending fields, provider additions, original transfer IDs, and created server IDs distinct. Never mutate draft/order objects in place; save reconciliation uses reference identity.
- Do not trim deleted IDs out of complete permutations or mistake visual coalescing for source modification. Do not promise a group move leaves all unrelated source slots unchanged; only peer moves do.
- Drag/transfer permission is distinct from reorder permission. Filter completeness concerns all matching results across pages, not just mounted cards, and excludes intentionally hidden transferred originals.
- Returning to the original set and Revert are different operations: the former preserves current fields; the latter restores saved fields. Ordinary delete of the last saved spread is not preblocked by this transfer check; server save rejects an empty resulting set.
- Reveal requests cannot override filters. Additions/transfers may be hidden when their destination/species does not match current filters.

## Tests and commands

- From root, [src/tests/AddReorder.test.jsx](../../../src/tests/AddReorder.test.jsx): pending add/discard/Enter, import, permissions, peer/group reverts, transfer, cache, payload/ID mapping. `yarn test src/tests/AddReorder.test.jsx --run`
- From root, [src/tests/SpreadLayout.test.jsx](../../../src/tests/SpreadLayout.test.jsx): insertion, slot-preserving moves, coalescing, independent restores, and drop validation. `yarn test src/tests/SpreadLayout.test.jsx --run`
- From root, [src/tests/SpreadGridPagination.test.jsx](../../../src/tests/SpreadGridPagination.test.jsx): drop events/collision targets, dynamic completeness, section add tiles, row widths. `yarn test src/tests/SpreadGridPagination.test.jsx --run`
- From server, [server/tests/services/spread-writer.test.js](../../../server/tests/services/spread-writer.test.js): add/reorder source preservation and real operation contract. `yarn test tests/services/spread-writer.test.js` Use disposable fixture repositories/data, never sibling checkouts.

## Change checklist

1. Trace dialog defaults/pending state, provider indexes/drafts/orders, moved metadata, cache, payload anchors, and ID remapping.
2. Cover blocked insertion/reorder, locked sources, hidden peers versus hidden other species, multiple sets/pages, and no-op movement.
3. Test peer slot preservation, explicit group coalescing confirmation, independent reverts, transfer/return/revert/delete, and source emptiness.
4. Verify default additions avoid redundant reorder and full arrays keep deleted/new IDs; run focused suites and update this skill. Restart port 3001 only after server runtime changes.