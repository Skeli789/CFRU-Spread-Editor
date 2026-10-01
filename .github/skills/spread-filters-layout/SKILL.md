---
name: spread-filters-layout
description: "Use when changing SpreadFilters, SpreadGrid, spread filters, readable set or file names, trainer filters, species groups, row capacity, pagination, Jump to Page, preview level, or matching-result bulk action scope."
---

# Spread Filters and Layout

Filtering chooses matching entries; layout groups them without changing their source order. Reordering is a separate editor action.

## Files

- [src/components/SpreadFilters.jsx](../../../src/components/SpreadFilters.jsx): toolbar, option lists, dependent choices, file/set labels.
- [src/components/SpreadGrid.jsx](../../../src/components/SpreadGrid.jsx): width measurement, grouped rows, pages, sections, and movement/add controls.
- [src/SpreadEditorPage.jsx](../../../src/SpreadEditorPage.jsx): local filters/page size, result memo, headings, reveal anchors, and bulk action scope.
- [src/SpreadEditorState.jsx](../../../src/SpreadEditorState.jsx): current drafts, preview, orders, moved IDs, and transferred originals.
- [shared/spread-layout.mjs](../../../shared/spread-layout.mjs): pure filter predicates, names, grouping, rows, pages, and order helpers.
- [shared/spread-model.mjs](../../../shared/spread-model.mjs), [shared/pokemon-mechanics.mjs](../../../shared/pokemon-mechanics.mjs), and [shared/catalog.mjs](../../../shared/catalog.mjs): battle/team symbols, effective ability/level, Mega mappings, and legality.
- [src/styles/SpreadEditorPage.css](../../../src/styles/SpreadEditorPage.css): sticky toolbar, grid/subgrid, section headings, gaps, and responsive cards.

## Data flow

1. The page starts with `getDefaultFilters(snapshot)` and page size 12. The toolbar builds choices from saved snapshot entries and catalog labels, not provider additions/drafts.
2. `createFilterContext` indexes sets and trainer links. The result memo reads current draft values through a ref, excludes transferred originals, filters saved plus new entries, and sorts by snapshot set order then draft/source order.
3. `groupSpreads` groups by set and stored species in first-appearance order. `buildRows` packs groups into blocks; `paginateRows` keeps each block intact.
4. The grid measures its own width with `ResizeObserver`, renders only the anchored page, and delegates order/transfer/add actions to the page/provider.
5. Export and Auto-Fix consume all matching results across pages, using current fields. Auto-Fix excludes placeholders and reports locked entries separately.

## Behavior and user decisions

- The first set is initially selected and counts as one active filter. Clear Filters uses unrestricted `DEFAULT_FILTERS`, showing all sets, not the first-set startup selection. A legacy pure-test title says otherwise; the actual toolbar/page and integration tests are authoritative.
- Filters combine with AND. Multiple species are alternatives; selected moves must all be present. Ability means the effective source ability slot, not Mega ability. Item resolves omitted zero as No Item.
- Shiny, Gigantamax, Mega Stone, and Z-Crystal use All/Yes/No. Mega Stone requires a species-compatible mapping; Z-Crystal uses CFRU item kind. Illegal Moves matches illegal or undefined moves, not unknown legality or duplicates alone.
- Battle Type displays Singles & Doubles, Singles Only, and Doubles Only. Doubles Team Type appears only with enum data; its clearable autocomplete omits Any so an empty selection is the sole catch-all.
- File restricts trainer/set options. Changing to an incompatible file clears the trainer and replaces an incompatible nonempty set with the first fitting set. Choosing a trainer clears the set, showing all that trainer's linked sets.
- Trainer choices are grouped by kind and include ranks. Selected text includes bracketed kind/rank detail; unique option rows show just the name, while duplicate names include detail. Searchable filters use `autoHighlight`.
- File labels remove folders/extensions and title-case separator-delimited words. Set labels remove the leading scope letter and Tower, split words/numbers, format rank suffixes, and omit a selected trainer's repeated name. Little Cup names append `(Lv. 5)`.
- Preview offers levels 50/100. Little Cup's effective level stays 5; preview does not change source fields.
- Capacity uses a 340px minimum card width and 8px gap, with fallback 3 before measurement. Small species share rows only within a set; larger species fill their own rows without redistributing cards to balance the tail.
- Per Page offers 12/24/48. A species/block never splits across pages; an oversized species gets a page exceeding the selected limit. Counts exclude Add Spread tiles.
- A standalone row one card short of full widens when capacity is at least 3, unless it contains an add tile or belongs to a multirow block. Lone cards do not stretch across the whole grid.
- Pages retain the last navigation/reveal anchor across width/page-size changes: navigation stores the chosen page's first spread ID, while reveal stores the requested entry ID. Filter `resetKey` changes default to page one, but a retained reveal request can override that reset when its entry is visible. Explicit navigation scrolls the grid into view.
- Pagination appears above/below multiple pages. Ellipses open Jump to Page with selected current-page input; only digits submit, values clamp to 1..page count. Continued set sections are labelled `(continued)`.
- Each visible set's final matching group gets an Add Spread tile on its ending page, using spare row space or a new row. It is hidden while placing a group and disabled with the insertion reason when needed. Empty results offer Clear Filters; toolbar Add Spread remains available.

## Invariants and pitfalls

- Display grouping does not coalesce interleaved source entries. Only an explicit confirmed whole-group move can do that.
- Results deliberately do not depend directly on `drafts`: ordinary field edits do not make a card vanish mid-edit. Other memo dependencies can recompute results with the latest drafts; do not promise a permanently frozen result list.
- Unsaved filtering uses drafts or moved IDs, not the deleted Set directly. Ordinary deleted cards remain visible with Restore; transferred originals are hidden and excluded from completeness checks.
- Movement permission is per set, not dependent on a single selected set. Whole groups require all nonhidden set entries in results; peers require all same-species entries. See [adding-reordering](../adding-reordering/SKILL.md).
- Keep shared layout rules browser/Node-free. CSS grid/subgrid and container queries need source/layout checks; jsdom does not prove rendered geometry.

## Tests and commands

Run from workspace root; all commands exit rather than watch:

- [src/tests/SpreadFilters.test.jsx](../../../src/tests/SpreadFilters.test.jsx): options, icons, trainer selection, catch-all, and Enter. `yarn test src/tests/SpreadFilters.test.jsx --run`
- [src/tests/SpreadLayout.test.jsx](../../../src/tests/SpreadLayout.test.jsx): predicates, labels, grouping, rows, pages, and pure ordering. `yarn test src/tests/SpreadLayout.test.jsx --run`
- [src/tests/SpreadGridPagination.test.jsx](../../../src/tests/SpreadGridPagination.test.jsx): measured widths, page jump, add tiles, drop/completeness refresh. `yarn test src/tests/SpreadGridPagination.test.jsx --run`
- [src/tests/AddReorder.test.jsx](../../../src/tests/AddReorder.test.jsx): clearing filters, multi-set controls, placement across pages. `yarn test src/tests/AddReorder.test.jsx --run`
- [src/tests/SpreadEditor.test.jsx](../../../src/tests/SpreadEditor.test.jsx): matching-result bulk repairs. `yarn test src/tests/SpreadEditor.test.jsx --run`

## Change checklist

1. Trace saved option lists, current-field predicates, result memo dependencies, source sorting, groups, blocks, and page anchors.
2. Check startup versus clear, dependent file/trainer/set choices, omitted values, duplicate trainer names, alternate forms, and unknown legality.
3. Test multiple sets, interleaved/oversized species, resize/page-size changes, hidden transferred IDs, empty results, and section-ending add tiles.
4. Keep Export/Auto-Fix scoped across matching pages; run focused suites and update this skill with verified behavior.