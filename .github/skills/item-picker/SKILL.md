---
name: item-picker
description: "Use when changing ItemPicker, Choose Item, Item Type, No Item, item search, item groups, sticky headers, or item chooser keyboard navigation."
---

# Item Picker

## Overview

`ItemPicker` edits a spread's held item through an inline autocomplete or the Choose Item dialog. `SpreadCard` passes its species display name into the dialog title and applies item changes to the draft with `setFieldSymbol`.

## Files

- [ItemPicker.jsx](../../../src/subcomponents/ItemPicker.jsx): Default export `ItemPicker`; named exports `ITEM_NONE`, `NO_ITEM_LABEL`, `getItemTypeLabel`, `getItemOptions`, `getChooserItems`, and `getItemListStyles`. Owns `ItemChooserContent`, memoized `ItemRow`, item grouping, search, focus, and scroll handling.
- [CatalogDisplay.jsx](../../../src/subcomponents/CatalogDisplay.jsx): `filterBySearch` ranks names starting with a search before names containing it; `useIncrementalList` pages long lists; `scrollToEntry` centers a list item; `AdvancedPaper` adds the popup's Advanced button; `GameImage` displays fixed-size icons with fallbacks.
- [SpreadCard.jsx](../../../src/components/SpreadCard.jsx): Renders the picker in edit mode and updates the item field through `setFieldSymbol`.
- [SpreadEditorPage.css](../../../src/styles/SpreadEditorPage.css): Picker footer and wide popup, chooser layout, scrollable item list, sticky heading line height, and the save-area hiding rule.
- [ItemPicker.test.jsx](../../../src/tests/ItemPicker.test.jsx): Item groups, header styles, inline selection, dialog scrolling, focus, and keyboard behavior.
- [MovePicker.test.jsx](../../../src/tests/MovePicker.test.jsx): Also tests shared item-list ordering and choosing an item in the dialog.

## Behavior and user decisions

### Inline item field

- The `Item` MUI autocomplete uses `autoHighlight`, so Enter chooses the first filtered match. `filterBySearch` ranks prefix matches before contains matches, preserving the underlying name order within each rank. It has no clear button (`disableClearable`); `No Item` is a regular selectable option instead.
- Inline option selections call the optional `onFieldCommit(event, "Item")` callback. `EditSpreadDialog` uses it to advance to Ability; typing, blur, cancellation, and chooser selections do not call it, preserving the chooser's focus return.
- The selected item's 24-pixel `GameImage` icon is a start adornment in an inline-flex span without extra margin; the Advanced icon is an end adornment with a `Choose Item` tooltip. The popup also offers an Advanced paper button. Either opens the dialog in place of the popup. The popup uses `wide-popper` and bottom-start placement.
- `getItemOptions` caches options per catalog object, names `ITEM_NONE` as `No Item`, puts it first, and sorts other options by name. A value not found in the catalog stays visible as its raw value with no icon.

### Choose Item dialog

- Title is `Choose Item for X` when `speciesName` is passed, or `Choose Item` otherwise. Choosing a row updates the held item and closes the dialog. Close is at the left end of the actions row. The list reports the number of filtered items.
- `No Item` appears before every group when there is no Item Type filter and its name matches the search. The fixed group order is Held Item, Gem, Berries, Incense, Plate, Drive, Memory, Mega Stone, Primal Orb, Z-Crystal, Other. Only groups with matching items get headers or filter choices. Unrecognized or absent `itemType` values fall into Other.
- King's Rock, Metal Coat, Razor Claw, and Razor Fang go in Held Item even when cataloged as evolution items. Any item constant ending in `_BERRY` goes in Berries even without a berry `itemType`. Catalog berry type constants also map to Berries. Otherwise the supported `ITEM_TYPE_*` constants map to their respective groups.
- Search and Item Type sit in a full-width wrapping `.chooser-filters` row; Search grows from a 200-pixel basis and Item Type uses up to 220 pixels. The type filter restricts items to that group; `getChooserItems` ranks prefix matches before contains matches within each group, while preserving the fixed group order. Changing search or type returns the list to the top after its initial scroll to the selected item.
- The item list uses `disablePadding`. Group headers are sticky at the top of the list with an opaque `background.paper` from the theme and a higher z-index so rows do not show through. The icon and name appear on each row. The selected row uses MUI selection styling.
- `.item-list-viewport` has a zero flex basis and clips overflow to constrain the list to the remaining dialog height. `getItemListStyles` explicitly sets vertical auto overflow, hides horizontal overflow, and reserves a stable scrollbar gutter. The list inherits the global themed scrollbar, owns scroll events, and remains the only scrolling element.
- A `Scroll to top` icon button appears after the list has scrolled and disappears at the top. Long lists initially show up to 100 items; scrolling near the end adds 100 at a time. The fallback Load More appears only after a scroll reaches the bottom, as the last element inside the scrolling list, while more items remain. Clicking it loads 100 and hides it again; returning to the top or changing filters hides it. While this chooser is open, `body:has(.chooser-dialog) .save-area` hides the floating Save Changes area.

## Keyboard and focus

- Opening the dialog auto-focuses Search and scrolls to the selected item, revealing enough pages for it first. Before typing or navigation, the keyboard highlight starts on the chosen item if it is in the current results; otherwise it starts at the first result. A nonempty search starts at the first result.
- From Search, ArrowUp, ArrowDown, Home, and End move the highlight within the filtered results and reveal more rows as needed. Enter chooses the highlighted item and closes the dialog. An empty result list ignores these selection keys. The highlight is kept visible inside the scrolling list.
- Choosing an Item Type refocuses Search so subsequent arrow keys navigate items. After the chooser closes, focus returns to the inline Item input when the closing transition exits. The popup Advanced button prevents input focus loss on mouse down.

## Performance notes

- `getItemOptions` uses a catalog-keyed `WeakMap`. The chooser memoizes filtered items and available groups. `ItemRow` uses `memo` and a stable `onSelect` callback through a ref so keyboard-highlight changes do not rerender all rows.
- Row highlight styles are set once on the `List` through `sx`. `useIncrementalList` loads 100 items per page and `showAtLeast` can reveal a selected or keyboard-highlighted item beyond the first page. The item list, not the whole dialog, scrolls.

## Invariants and pitfalls

- MUI dialogs and autocomplete popups render in portals outside the app root. Use theme palette values rather than root-scoped CSS variables in portal content, especially for opaque sticky headers and focus outlines. Preserve `.chooser-dialog` for its layout and the Save Changes visibility rule.
- `No Item` is not a group header and is excluded when filtering to a specific type. Keep `ITEM_NONE` first independently of alphabetical sorting and keep the four held-item exceptions ahead of the berry suffix and catalog type mapping.
- `scrollToEntry` reads browser layout. jsdom does not supply real layout, so tests verify list presence, scroll-to-top changes, sticky-header styles, highlight, and focus rather than pixel-perfect centering.
- Preserve `disablePadding`, MUI `Tooltip` instead of native `title`, `slotProps`, `autoHighlight`, and the no-clear inline selection behavior.

## Tests

- [ItemPicker.test.jsx](../../../src/tests/ItemPicker.test.jsx) covers fixed groups, held-item exceptions and berry suffix, opaque sticky headers in light and dark themes, No Item and inline Enter selection, the icon and Advanced affordance, scroll-to-top and search reset, chosen-item keyboard highlight, Enter selection, and refocusing after Item Type selection.
- It also covers bottom-only fallback visibility, its placement inside the list, and automatic and manual paging. [SpreadCard.test.jsx](../../../src/tests/SpreadCard.test.jsx) covers inline Item-to-Ability focus advancement inside the edit dialog.
- Scroll container coverage checks the list and viewport classes and the style helper's overflow and gutter values without relying on jsdom layout or computed CSS.
- [MovePicker.test.jsx](../../../src/tests/MovePicker.test.jsx) also checks No Item and sectioned results, type filtering, selection, and chooser closure.
- Run from the repository root: `$env:DEBUG_PRINT_LIMIT=0; yarn test src/tests/ItemPicker.test.jsx --run`.

## Change checklist

- Check inline icon, no-clear behavior, auto-highlight, unknown values, and both Advanced entry points.
- Check No Item, fixed group order, four held-item exceptions, berry suffix, unknown types, and search ranking within groups.
- Check sticky header opacity, list scroll reset, Scroll to top, paging, keyboard highlight, Enter, and focus return.
- Update [ItemPicker.test.jsx](../../../src/tests/ItemPicker.test.jsx) and, when shared behavior changes, [MovePicker.test.jsx](../../../src/tests/MovePicker.test.jsx); run the relevant narrow tests.
- Update this skill when behavior, file ownership, or tests change.