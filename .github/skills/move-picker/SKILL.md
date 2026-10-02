---
name: move-picker
description: "Use when changing MovePicker, MoveEditor, MoveChooserDialog, Choose Moves, move slot search, move legality, Other Powers, move filters, or move table keyboard navigation."
---

# Move Picker

## Overview

`MoveEditor` edits four move slots in the spread edit dialog. Each inline `MovePicker` offers learnable moves; the Choose Moves dialog edits all four slots against one searchable, sortable list of game moves. Changes flow through `onChange(slot, move, hiddenPowerType)` to `SpreadCard`, which calls `setMove` on the draft.

## Files

- [MovePicker.jsx](../../../src/subcomponents/MovePicker.jsx): Default export `MoveEditor`; named exports `MoveChooserDialog`, `getMoveOptions`, `getLearnableMoveOptions`, `getMoveOption`, `getChooserRows`, `formatPower`, `formatBoostedPower`, and `formatAccuracy`. Owns inline fields, dialog, filters, sorting, keyboard handling, and `MoveRow`.
- [CatalogDisplay.jsx](../../../src/subcomponents/CatalogDisplay.jsx): `filterBySearch` and `getSearchRank` put prefix matches before contains matches; `useIncrementalList` pages lists; `scrollToEntry` centers an entry inside its scroll container; `AdvancedPaper` adds the Advanced popup button; `TypeIcon` and `SplitIcon` show symbols, banners, and category icons.
- [SpreadCard.jsx](../../../src/components/SpreadCard.jsx): Renders `MoveEditor` while editing and passes changes through `setMove`; uses `getMoveOption` and `getMoveLegality` for the nonediting display.
- [SpreadEditorPage.css](../../../src/styles/SpreadEditorPage.css): Move legality colors, slot grid, chooser dimensions and scrolling, picker footer, and save-area visibility.
- [catalog.mjs](../../../shared/catalog.mjs): `getMoveLegality`, `LEGALITY`, `LEARNSET_COMPLETE`, `getPowerKind`, and `alwaysHits` define legality and move stat display rules.
- [MovePicker.test.jsx](../../../src/tests/MovePicker.test.jsx): Move helpers, inline picker, and Choose Moves interactions.

## Behavior and user decisions

### Inline move fields

- The four labeled `Move 1` through `Move 4` fields use MUI `Autocomplete` with `autoHighlight`: typing ranks names starting with the query before names merely containing it, and Enter selects the highlighted match. Known, complete learnsets limit suggestions to moves in `learnset.moves` or `learnset.unknown`; without a complete learnset, all game moves are offered.
- `MoveEditor` forwards optional `onFieldCommit(event, label)` callbacks only for inline option selections. `EditSpreadDialog` advances to the next move, or from Move 4 to Item, using dialog-local `data-advance-field` targets. It consumes the commit event so Enter does not also submit a new spread. Typing, blur, clearing, cancellation, and Choose Moves selections do not trigger this callback.
- The current move stays in the options even if the species cannot learn it. `getMoveLegality` treats absent or incomplete learnsets as unknown, not illegal; a move absent from a complete learnset is illegal. Illegal current moves and illegal options get red styling. Unknown move constants remain visible as their raw names and have undefined styling.
- The selected move's type symbol precedes the input text. The Advanced icon is an end adornment with a `Choose Moves` tooltip. The autocomplete popup also has an Advanced button in its paper footer. Either route opens the dialog on that slot and closes the popup.
- Inline autocomplete has `disableClearable`: it has no clear button. Emptying the text and committing with blur or Enter clears that slot with `onChange(slot, null, null)`.
- A later slot repeating an earlier nonempty move is marked illegal and wrapped in an MUI `Tooltip` labeled `Duplicate move`. Duplicate detection compares stored move constants, not display names.

### Choose Moves dialog

- Title is `Choose Moves for X`, where `X` is the catalog species name. Four `Move 1` through `Move 4` text fields are both the editable slots and the search fields; there is no separate Search field. The active field has a focus-colored outline and `aria-current`. Typing in it filters the table; clearing the filter with Clear Filters restores its stored move text.
- The list combines learnable moves first and other game moves second. A `Moves X can't learn` divider precedes the second group; illegality styling uses `getMoveLegality`, so unknown legality is not colored illegal. If the learnset is unavailable, an info alert says every move is listed as learnable. `MOVE_STRUGGLE` is never offered. Hidden Power expands to one named option per type, and the current Hidden Power option follows the spread's IV-derived type.
- Within each learnability group, prefix search matches precede contains matches; the chosen column then sorts each rank. Column headings sort ascending first and reverse on another click; unknown sort values come last in either direction, with name as a tie breaker. Name, Type, Category, Power, optional Z-Power and Max Power, Accuracy, PP, and Target are the table columns. Type uses full type banners, while slot adornments and filter choices use type symbols. Category uses `SplitIcon`.
- Type, Category, and Target are separate filters; Type and Category show icons both in options and for the selected value. Target is wider than Type and Category (`215`, `170`, and `185` pixels respectively), allowing labels such as `Both Foes`. The Other Powers checkbox exposes both Z-Power and Max Power. Filtering Category to Status hides all three power columns and disables Other Powers; the checkbox's value is not cleared by that filter. Clear Filters clears slot search text, Type, Category, Target, and Other Powers, but leaves the current sort in place.
- Status moves display `-` in power cells even if boosted power data is present. Variable base power reads `Varies`, unknown power `?`, and zero or missing boosted power reads `-` or `?` respectively. Always-hit moves show `-` for accuracy; ordinary accuracy includes `%`. Target constants become readable labels, with `MOVE_TARGET_BOTH` displayed as `Both Foes`.
- Moves chosen in any slot have a violet background and inset bar; the active slot's move is also MUI-selected. Clicking a row or its name chooses it for the active slot. The list reports its result count, starts with up to 100 rows, and supports Load More or loading near the bottom of the table. Close sits at the left of the actions row. While this chooser is open, `body:has(.chooser-dialog) .save-area` hides the floating Save Changes area.
- Move-name buttons use both left text alignment and start flex justification, so wrapped two-word names stay left-aligned on narrow screens.

## Keyboard and focus

- Opening the chooser focuses its initial slot and selects its text. Without typed search text, the highlighted table row starts at the active slot's current move, if present, so ArrowDown or ArrowUp continues from it. With an empty slot or a typed query, highlight starts at the first result.
- ArrowUp, ArrowDown, Home, and End move the row highlight and reveal more rows if needed. Enter chooses the highlighted row. On an untouched populated slot, Enter keeps its existing move without calling `onChange`, then advances; on an empty slot, Enter picks the highlighted result. Clearing a slot with its X button clears the stored value, scrolls the table to the top, and refocuses that slot; Enter can then pick the highlighted result.
- Choosing advances to the next slot and selects that field's text for replacement; the fourth slot remains active after a choice. Advancing to an empty slot scrolls the table to the top. Switching slots resets typed search and scrolls toward a populated slot's move. Changing search or filters resets table scroll to the top.
- The chooser disables MUI's automatic focus restoration and explicitly refocuses the original inline slot after its closing transition. The popup's Advanced button prevents input focus loss on mouse down.

## Performance notes

- Move options are cached by catalog object in a `WeakMap`; learnable options, rows, filters, and visible columns use `useMemo`. `MoveRow` is memoized and receives a stable `onChoose` callback via a ref so moving the keyboard highlight does not rerender every row.
- The violet chosen and focus outline `sx` styles live on the table, not on each row. `useIncrementalList` starts at 100 and adds 100 at a time; `showAtLeast` reveals the highlighted or opening move even beyond the initial page. Only the table container scrolls.

## Invariants and pitfalls

- Dialogs and autocomplete popups render through MUI portals outside the app root. Do not rely on root-scoped CSS variables for their colors; use the MUI theme, as the table highlight and focus outline do. Keep the `.chooser-dialog` class for the CSS that sizes the dialog and hides `.save-area`.
- The inline picker is intentionally learnable-only except for its current value; the chooser intentionally lists unlearnable moves too. Do not equate unknown learnsets with illegal moves or remove the current value when it is illegal.
- `onChange` carries a Hidden Power type separately; the parent `setMove` updates the spread. Keep option keys distinct for Hidden Power variants. `getMoveOption` derives the displayed variant from IVs.
- `scrollToEntry` depends on browser layout measurements. jsdom has no real layout, so tests assert scroll resets, rendered rows, highlight, and focus instead of pixel-perfect centering.
- Use MUI `Tooltip`, not native `title`; preserve `slotProps`, `autoHighlight`, the no-clear inline behavior, and the chooser's separate X buttons.

## Tests

- [MovePicker.test.jsx](../../../src/tests/MovePicker.test.jsx) covers move options and legality display, Hidden Power variants, search order, exclusion of Struggle, stat formatting, symbols and banners, slot editing and clearing, filters, sorting, Other Powers, status columns, selected highlights, keyboard navigation and Enter, pagination, and focus restoration. It also exercises the shared `ItemPicker` on a small fixture.
- [SpreadCard.test.jsx](../../../src/tests/SpreadCard.test.jsx) covers inline Enter and click advancement across the four moves and through Item, Ability, Battle Type, optional Doubles Team Type, and Spread Set, including suppression of edit-dialog submission on committing Enter.
- Run from the repository root: `$env:DEBUG_PRINT_LIMIT=0; yarn test src/tests/MovePicker.test.jsx --run`.

## Change checklist

- Check both the inline learnable list and the dialog's combined list, including illegal current values and unknown learnsets.
- Check each slot's search, clear, Enter, arrows, advancement, and focus return, including empty and Hidden Power slots.
- Check filters, sort, status power columns, result count, paging, and selected styling in light and dark themes.
- Update [MovePicker.test.jsx](../../../src/tests/MovePicker.test.jsx) for changed user-visible behavior; run its narrow test command.
- Update this skill when behavior, file ownership, or tests change.