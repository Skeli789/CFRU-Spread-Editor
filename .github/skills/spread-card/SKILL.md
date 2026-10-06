---
name: spread-card
description: "Use when changing SpreadCard, EditSpreadDialog, spread card headers, trainer or Little Cup level chips, battle badges, stat table presentation, Mega Stats, edit focus progression, deleted or locked cards, sprite columns, or responsive card CSS."
---

# Spread Card

The grid keeps cards in view mode; one modal card edits current provider fields. Pending additions use the same card with page-local fields.

## Files

- [src/components/SpreadCard.jsx](../../../src/components/SpreadCard.jsx): presentation, field controls, chips, warnings, action menu, and Showdown dialogs.
- [src/components/SpreadDialogs.jsx](../../../src/components/SpreadDialogs.jsx): edit modal, field advancement, set picker, pending discard, and exchange dialogs.
- [src/subcomponents/SpreadStats.jsx](../../../src/subcomponents/SpreadStats.jsx): stat table, numeric input, repeat steppers, and resets.
- [src/subcomponents/CatalogDisplay.jsx](../../../src/subcomponents/CatalogDisplay.jsx), [src/subcomponents/MovePicker.jsx](../../../src/subcomponents/MovePicker.jsx), and [src/subcomponents/ItemPicker.jsx](../../../src/subcomponents/ItemPicker.jsx): image/text/type display and reused chooser fields.
- [src/SpreadEditorPage.jsx](../../../src/SpreadEditorPage.jsx) and [src/SpreadEditorState.jsx](../../../src/SpreadEditorState.jsx): modal lifecycle, pending fields, drafts, delete/restore, and validation problems.
- [shared/spread-model.mjs](../../../shared/spread-model.mjs), [shared/pokemon-mechanics.mjs](../../../shared/pokemon-mechanics.mjs), and [shared/catalog.mjs](../../../shared/catalog.mjs): source-preserving setters, stats/level/Mega mechanics, and legality.
- [src/styles/SpreadEditorPage.css](../../../src/styles/SpreadEditorPage.css): card grids, chip rows, edit container query, stats, and disabled/deleted styling.

## Data flow

1. The page passes entry metadata, `drafts[id] ?? entry.fields`, set/catalog/team types, preview, problems, and provider actions. Grid cards always receive `editing={false}`.
2. `SpreadCard` derives effective level, stats, sprite fallbacks, types, abilities, battle/team labels, and deduplicated trainer usage labels. Mega Stats and Level 5 are local UI state, initially true. The stat preview level is separate from the effective level used for Showdown exchange.
3. Controls call `updateSpread(id, callback)` with current/saved fields and Both-mode memory. The modal clones its card with `onFieldCommit` to advance committed inline choices.
4. Done/backdrop/Escape closes ordinary editing without reverting drafts and compacts moves in already-existing drafts. If every move is empty, it fills Move 1 using Add Spread's first name-sorted picker option, including saved-empty entries without prior edits; no available option leaves moves empty. Deleted/locked/placeholder entries are excluded. Pending-add close still asks for discard; its Add commits compacted fields only after validation.

## Behavior and user decisions

- Editable nondeleted view cards open by clicking outside buttons/links/inputs or by Enter/Space on the focused article. Locked, placeholder, editing, and deleted cards do not get interactive card hover/focus behavior.
- View side order is sprite, nonrandom ball, item, source ability, optional bold `[M]` ability, then nature. Random Ball is omitted. Truncated side values receive MUI tooltips only when overflow is measured.
- View title includes Shiny/Gigantamax symbols, species, type icons, optional Mega type arrow/icons, diagnostics, lock, and a green NEW symbol for ordinary unsaved additions. Transfers do not show NEW. The species tooltip identifies file and source line.
- View subtitle groups outlined trainer/rank chips before battle chips. Both is one green `Singles & Doubles (Modify)` or `(Exact)` chip with theme-readable suffix colors. Non-Any doubles team requirements and the existing `set.littleCup` Lv. 5 badge remain visible.
- `showBattleType` defaults to true independently of `readOnly`. Setting it false hides only the battle-type chip for Smogon addition and overwrite previews, leaving Little Cup, team, and placeholder chips unchanged.
- `getSpreadHighlights` gives changed values (including individual move slots and EV/IV cells) a blue background on saved changed view cards; new entries and editing cards get none. Read-only review cards take explicit `highlightedFields` relative to Original.
- The edit-header `spread-edit-tools` row directly below the title contains optional `trainer-chips` at left and the suggestion split button at right. Its main button shows nature and nonzero EV distribution on one row, for example Timid: 4 HP / 252 SpA / 252 Spe; an MUI tooltip names the role. Its explicit accessible label preserves the visible text instead of the tooltip's role. The dropdown arrow is always enabled, including when the main button shows disabled No Suggested Spread. It opens a focused, searchable, auto-highlighted Preset Spread autocomplete with all text selected for immediate replacement. Every named preset and Automatic Suggestion is always selectable, independent of current moves. The autocomplete uses `disablePortal` within an overflow-visible popover and `transitionDuration={0}` to prevent the list overlapping its input while the popover scales. The list has a 40vh/280px height limit. Selecting a preset by mouse or Enter immediately applies its EVs, IVs and nature, then closes the chooser; the main button can reapply it. Automatic Suggestion also immediately applies the inferred spread if available. Searching and Escape/outside cancellation change nothing. Selection is local to the edit card, and recomputes with current fields/level. The row wraps and long single-line labels scroll horizontally. The suggestion applies draft EVs, IVs and nature using battle-effective Mega/level data, not local preview switches; see [pokemon-mechanics](../pokemon-mechanics/SKILL.md). Little Cup edit cards show an enabled-by-default `Lv. 5` switch in the stats Total-row footer, alongside Mega Stats when available. The existing view-mode Little Cup badge stays unchanged.
- Edit Ball/Shiny/Gigantamax belong with the sprite appearance controls; Nature is below the top sprite/stats area, moves follow, then Item/Ability, then battle controls. Gigantamax appears when supported or already set; unsupported existing values show a warning.
- View stats show Stat/Base/EV/IV and totals, not Final. Edit stats add Final, stepper inputs, EV budget left/over, heading resets, and Mega Stats in the Total-row footer. Nature changes color/arrows; missing stats show `?`.
- Numeric focus/click selects the input. IVs step by one; EVs use shared normal/Little Cup stepping and total limits. Holding a stepper starts repeat after 150ms at 20ms intervals with acceleration; release/leave/cancel/limit/unmount stops it.
- Typed EVs retain nonnegative integers beyond 252 and beyond the 510 total without a three-digit input restriction; they do not bypass save validation. Noninteger, negative, or above-252 EVs are invalid, as are all positive allocations when the total exceeds 510. Invalid editing inputs have `aria-invalid` and a theme-error red fill/text; default view EV cells use theme-error red text. Zero allocations remain unmarked for over-total errors. These styles live in `SpreadStats` rather than CSS. The editing footer changes from remaining `Left` to excess `Over` above 510; arrow/button stepping retains legal caps.
- Tab moves down HP through Speed EVs, then down HP through Speed IVs. Shift+Tab reverses that order; boundary fields leave the table normally. Stepper buttons have `tabIndex={-1}`; arrow keys retain keyboard stepping, and heading resets stay keyboard accessible. Inputs carry `data-stat-kind` for table-scoped navigation, so separate cards cannot steal focus.
- Reset EVs sets all to zero. Reset IVs uses shared move-aware rules, preserving unused attacking/slow-Speed zeros and Hidden Power, rather than blindly setting all six to 31. No-op resets are disabled.
- Effective Little Cup level for view cards and Showdown exchange remains 5. Turning off Level 5 in editing uses the page's current 50/100 preview level and normal EV stepping; turning it back on restores level 5 stats and Little Cup EV stepping. Both footer toggles change only local stat previews, not saved fields. Mega-capable sprite/type/ability presentation is derived separately, not all switched off by Mega Stats.
- Battle Type cannot newly select Neither. Modify Moves Doubles appears only for Both; with a nonempty team enum, team controls appear for Doubles Only or an existing non-Any requirement needing cleanup. The outside-Doubles warning also requires that enum. Keep raw unknown values visible and preserve omitted source values through shared setters.
- Four view move slots show type/name or `-`; later duplicates are marked illegal with a tooltip. Illegal/undefined/unknown statuses retain distinct styling. Inline move clear buttons are absent; typing empty clears through the move field's existing behavior.
- Each edit move slot has a right-side drag handle. Reordering inserts the dragged move at the target slot and shifts intervening slots, updating the draft's move array once without changing IVs or advancing focus; see [move-picker](../move-picker/SKILL.md).
- Edit Spread Actions offers Export to Showdown, editable Overwrite From Showdown, and Delete. Delete has no extra confirmation. Saved deletions leave dimmed inert content with Restore; deleting an ordinary new entry removes it.
- Ordinary edit has blue Done and optional title-adjacent Revert. Revert clears saved field/deletion/peer-order changes, not whole-group movement. Transfer Revert restores the original entry. Spread Set changes perform real cross-set transfers; see [adding-reordering](../adding-reordering/SKILL.md).
- Inline commitment advances Ball, Nature, Moves 1-4, Item, Ability, Battle Type, optional Doubles Team Type, then Spread Set. It skips absent fields and does not apply to nested chooser dialogs. Pending additions focus/select Move 1; unconsumed Enter can submit Add, but ordinary Done is not an Enter form submission.

## Invariants and pitfalls

- Verified edit modal maximum width is 700px outside full-screen mode; the theme's below-sm breakpoint makes it full-screen. This is separate from the card's named inline-size container query.
- Wide edit grid uses a 200px sprite column, 16px gap, 112px sprite, and stats on the right. At container width at most 595px, it uses an 80px sprite beside header/appearance and full-width centered stats below.
- Narrow appearance is a wrapping row: Ball grows from 140px with maximum 220px, while Shiny/Gigantamax stay together in a nonwrapping checks group that can move to the next line as a unit. The title wraps. Do not describe it as an unconditional vertical stack.
- View grid uses a 124px side column. The separate 480px viewport rule stacks view stats and makes moves/held/battle fields single-column. Preserve the higher-specificity named container layout for edit cards.
- Do not confuse warnings with save blockers or preview with source fields. Use MUI Tooltip, `slotProps`, blue focus styling, and accessible article/control names; never native `title`.
- CSS-source assertions are needed for layout constants in jsdom; read source from project root and normalize whitespace/CRLF, not stubbed CSS imports. See [testing](../testing/SKILL.md).

## Tests and commands

Run from workspace root:

- [src/tests/SpreadCard.test.jsx](../../../src/tests/SpreadCard.test.jsx): card structure, chips, controls, actions, reset/repeat behavior, focus, CSS thresholds, stateful illegal EV entry/blur, red view/editor feedback, and EV Left/Over totals. `yarn test src/tests/SpreadCard.test.jsx --run`
- [src/tests/SpreadEditor.test.jsx](../../../src/tests/SpreadEditor.test.jsx): dialog lifecycle, drafts, validation, deletion/restore, and compaction. `yarn test src/tests/SpreadEditor.test.jsx --run`
- [src/tests/AddReorder.test.jsx](../../../src/tests/AddReorder.test.jsx): pending-add focus/discard, Done/Revert, and set transfers. `yarn test src/tests/AddReorder.test.jsx --run`
- [src/tests/SpreadMechanics.test.jsx](../../../src/tests/SpreadMechanics.test.jsx): shared level/stat/reset and battle/team rules. `yarn test src/tests/SpreadMechanics.test.jsx --run`

## Change checklist

1. Check saved/new/transferred/locked/placeholder/deleted cards in view and edit modes, including keyboard opening and inert deletion.
2. Cover the edit Level 5 footer switch with/without trainers, default and page-level stats, page/set changes, EV stepping, Mega coexistence, and absence in ordinary sets; keep view badges unchanged.
3. Preserve field order, inline progression, chooser isolation, Done versus Revert, pending Add/discard, and source-preserving setters.
4. Check 700px modal, 200px side column, 595px container boundary, narrow Ball/checks, 480px viewport rules, and light/dark chip contrast; run focused tests and update this skill.
