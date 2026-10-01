---
name: showdown-exchange
description: "Use when changing Showdown import, Import Showdown Text, Export to Showdown, Overwrite From Showdown, pasted team text, Showdown warnings, battle-only form resolution, Hidden Power import, clipboard copying, text downloads, or showdown.mjs."
---

# Showdown Exchange

Showdown exchange is a browser-side adapter for the selected game catalog, not a source-file format or a battle legality validator. Import and overwrite create unsaved editor changes; only Save Changes writes CFRU source.

## Files

- [showdown.mjs](../../../shared/showdown.mjs): pure `@pkmn/sets` adapter, `parseShowdownText`, `resolveImportedSet`, `exportSpread`, `exportSpreads`, `applyOverwrite`, limits, placeholder marker, and metadata losses.
- [catalog.mjs](../../../shared/catalog.mjs): `getOutOfBattleForm`, `isBattleOnlySpecies`, and `getMoveLegality` resolve battle forms and selected-game move availability.
- [pokemon-mechanics.mjs](../../../shared/pokemon-mechanics.mjs): ability slots, stat names, Hidden Power types and IV optimization.
- [spread-model.mjs](../../../shared/spread-model.mjs): `createNewSpreadFields`, field validation, omitted source defaults, and Any doubles team type handling.
- [SpreadDialogs.jsx](../../../src/components/SpreadDialogs.jsx): `AddSpreadDialog`, `resolveShowdownText`, `getImportWarnings`, `ExportSpreadsDialog`, `resolveOverwrite`, and `OverwriteSpreadDialog` own pasted-text previews, automatic choices, copy, and download.
- [SpreadEditorPage.jsx](../../../src/SpreadEditorPage.jsx): bulk export scope, per-set preview levels, destination defaults, imported additions, and reveal behavior.
- [SpreadCard.jsx](../../../src/components/SpreadCard.jsx): Spread Actions exposes single-spread export and editable-spread overwrite; applies overwritten fields through card actions.
- [SpreadEditorState.jsx](../../../src/SpreadEditorState.jsx): `addSpreads`, drafts, insertion order, unsaved cache, validation, and save operations.
- [SpreadFilters.jsx](../../../src/components/SpreadFilters.jsx): bulk Export control. [SpreadEditorPage.css](../../../src/styles/SpreadEditorPage.css): dialog sizing, import problem bullets/headings, and export text styling.
- [Showdown.test.jsx](../../../src/tests/Showdown.test.jsx), [ShowdownDialogs.test.jsx](../../../src/tests/ShowdownDialogs.test.jsx), [AddReorder.test.jsx](../../../src/tests/AddReorder.test.jsx), and [showdown.test.js](../../../server/tests/services/showdown.test.js): adapter, UI, insertion, and official simulator syntax compatibility.

## Data flow

1. Add Spread's Import Showdown Text tab accepts pasted text and a destination with `canInsert`. Deferred text goes through `parseShowdownText`, then each parsed set through `resolveImportedSet` with `hiddenPower: "optimizeIvs"`.
2. The adapter normalizes names against the selected catalog, builds spread defaults, resolves forms/abilities/moves/stats, and returns errors, warnings, ambiguities, and unsupported metadata. The UI lists only sets with problems, not a roster of every successful set.
3. Import passes all error-free fields to `addSpreads` in pasted order. Errors skip only their affected sets; warnings do not block import. Additions become unsaved entries immediately, rather than entering the Choose Species pending-edit flow. The page closes Add Spread, reveals the first imported entry, and reports the count.
4. Bulk Export collects all current filter results across pages in editor order, with current drafts/new entries and each set's `getSpreadLevel`. It does not add a separate pending-deletion exclusion. Per-card export uses that card's current fields and level. Each entry is exported independently; nonempty texts are joined with blank lines.
5. Overwrite parses exactly one set, resolves it with current fields and automatic Hidden Power optimization, then calls `applyOverwrite`. Applying updates the draft, closes the overwrite dialog, and leaves Save Changes pending. No exchange-specific API endpoint is involved.

## Behavior and user decisions

### Import and resolution

- Input is exported Showdown text, not packed teams or JSON. A leading BOM and CRLF/CR are normalized. Blank lines, `---`, and `=== [format] team name ===` headers split sets; team names/formats are parsed but do not assign CFRU ownership or battle flags. There is no text-file upload control. Download is export-only.
- Limits are `MAX_SHOWDOWN_LENGTH` (1,048,576 JavaScript characters), `MAX_SHOWDOWN_SETS` (512), and four moves per set. Duplicate recognized headers/stat entries, malformed numbers, IVs over 31, EVs over 252 per stat, or EV total over 510 produce errors. Unknown lines produce warnings. The problem list displays at most 200 affected sets, without limiting how many valid sets are imported within the parser cap.
- Names ignore case, accents, and punctuation and match constant suffixes or catalog names. Species also match `showdownName`; exact alternate-name matches win before preferring out-of-battle candidates. Remaining species ambiguity uses the first candidate and reports `Choose species`; the current UI does not offer a species-resolution picker.
- Battle-only matches convert to a base species using `getOutOfBattleForm`. DPE-derived held items are supplied when the text omits an item, and Gigantamax conversion sets its flag. An explicit disagreeing item is retained with `Mega form and item disagree`; the UI does not ask for a corrective choice. Move-triggered Mega mappings do not inject their triggering move. Suffix/fixed-list mappings cannot invent an unknown held item.
- Defaults come from `createNewSpreadFields`: no item, random ball, Hardy nature, 31 IVs, zero EVs, first available ability (regular slots before hidden), both singles/doubles with Modify Moves Doubles, and Any doubles team type as omitted zero. Missing explicit stat values use these defaults. Unknown species, item, nature, or ball causes errors; an unavailable ability instead warns and uses the default.
- Identical-name ability slots resolve silently to the first match, retaining a matching existing slot on overwrite. A Mega-only ability uses a valid base slot without an ability warning, preserving an available existing slot when applicable.
- A move absent from the selected game is omitted with a short warning such as `Ice Spinner not in this game (left out)`. A set with no remaining game moves is rejected. Known but unlearnable moves remain, with `not learnable`; unknown legality is not treated as illegal.
- Typed Hidden Power without explicit IVs optimizes IVs for that type. Both dialogs also optimize conflicting explicit IVs automatically; direct adapter callers can request `keepIvs` or receive ambiguity metadata. Conflicting Hidden Power declarations can still yield a warning, not a UI choice dialog.
- Warnings are terse, without trailing periods. Import groups each affected species with separate warning/error bullets, labels invalid sets `(Skipped)`, and uses Import Problems if any set has errors, otherwise Import Warnings. Unsupported Level, Happiness, Dynamax Level, Tera Type, and Nickname are reported as not saved; gender is silently ignored. Happiness with Return/Frustration has one specialized warning. The adapter supports `expectedLevel`, but current dialogs do not pass it.

### Export

- Uses catalog `showdownName` (or species name), effective base ability, held item, nature, IVs/EVs, named moves, shiny/Gigantamax flags, explicit ball, and preview level. Level 100 can be omitted by the serializer. Random ball is omitted, not converted into a specific ball. Hidden Power includes its IV-derived type and an explicit six-stat IV line so reimport preserves parity and values.
- Unknown named moves are left out with warnings while the spread still exports, even if none remain. Known illegal moves, out-of-range integer IVs/EVs, and incomplete active spreads with no moves are exportable; export does not run import/save legality validation.
- Truly zeroed source placeholders are skipped via `SHOWDOWN_PLACEHOLDER_ERROR`, with one aggregate placeholder alert. Unknown species or missing nature/ability/item/ball names, noninteger stats, or a noninteger level skip that spread with reasons. Do not confuse missing moves with an unrepresentable species or malformed stat value.
- Export text is read-only. Clicking it or Copy copies all text and reports success/failure; clipboard denial leaves manual selection available. Download produces a plain-text file named spreads.txt. Empty output disables Copy and Download. Close is at the left of the actions row.
- Team text cannot preserve file/set/trainer ownership, singles/doubles flags, Modify Moves Doubles, doubles team type, source comments, random-ball semantics, or identical-name ability-slot identity. It is not a lossless CFRU backup or proof of simulator legality for custom game data.

### Overwrite

- Requires exactly one set and shows the current spread's export as an input placeholder, with a generic fallback if it cannot export. It shows errors/warnings, not a rendered field-difference list or interactive ambiguity controls. The adapter still computes differences to detect a no-op; Overwrite is disabled when unchanged, with a tooltip explaining the match.
- Replaces species, nature, IVs, EVs, ability, item, moves, shiny, and Gigantamax. Ball changes only when explicitly provided; omission preserves the existing ball. File/set/trainer ownership, singles/doubles flags, and Modify Moves Doubles remain unchanged. Doubles team type resets to Any through `setTeamType`, preserving the saved omitted-zero representation when appropriate.
- No Cancel, overwrite, import, copy, or download action writes source directly. Save uses the normal revision/conflict/backup path, and reverting uses normal editor state rules.

## Invariants and pitfalls

- Keep the shared adapter free of browser and Node APIs. Clipboard, Blob/download, toasts, and dialogs belong in the frontend; use `@pkmn/sets` rather than inventing a separate Showdown grammar.
- Catalog availability is per game; never resolve against another game's names or silently invent constants. Use shared battle-form and ability helpers rather than a second form mapping.
- Do not document obsolete interactive ambiguity controls, file input, a difference table, or whole-spread rejection for unknown moves. Distinguish adapter capabilities from what the current dialogs actually pass and render.
- Import/save validation is stricter than export representability. Preserve partial success and the distinction between placeholder skips, unrepresentable entries, and trimmed moves.
- Keep exchange changes as drafts/additions until Save Changes. Preserve source ownership on overwrite, and delegate insertion/reordering/cache/save invariants to the corresponding skills.

## Tests and commands

- From the workspace root: `yarn test src/tests/Showdown.test.jsx --run` covers syntax/limits, defaults, names/forms, abilities, stat mapping, Hidden Power, export representability/placeholders, and overwrite preservation. Its existing text-fixture test reads [Raid Rush.txt](../../../Raid%20Rush.txt); keep that fixture available when running the suite.
- From the workspace root: `yarn test src/tests/ShowdownDialogs.test.jsx --run` covers copy, filter export, per-card actions, terse problem bullets, unsupported fields, skipped/trimmed exports, overwrite no-op/multiple-set behavior, and Add defaults.
- From the workspace root: `yarn test src/tests/AddReorder.test.jsx --run` covers importing multiple sets, skipped invalid sets, base-form conversion, insertion order, draft/save operations, and related Add behavior. [SpreadEditor.test.jsx](../../../src/tests/SpreadEditor.test.jsx) covers draft persistence and save failures: `yarn test src/tests/SpreadEditor.test.jsx --run`.
- From the server directory: `yarn test tests/services/showdown.test.js` compares standard import/export syntax with `pokemon-showdown` and checks compact resolution warnings. This is parser compatibility coverage, not simulator legality validation for every catalog.
- In PowerShell, prepend `$env:DEBUG_PRINT_LIMIT=0;` to frontend commands for quieter failures. Use isolated temporary repositories and `SPREAD_EDITOR_DATA_DIR` for any new server filesystem tests; never write sibling checkouts.
- Documentation-only updates need link/frontmatter/source-fact checks. Runtime changes need the narrowest affected suites; finish larger changes with root `yarn test-all`, server `yarn test-all`, and root `yarn build`.

## Change checklist

1. Trace parsing, catalog resolution, automatic choices, issue formatting, and draft application together. Verify import and overwrite behavior separately from direct adapter options.
2. Cover partial import success, all-unknown moves, catalog name ambiguity, battle forms, unavailable/duplicate abilities, stat defaults/ranges, Hidden Power, and unsupported metadata when affected.
3. Verify all-page filter scope/order/current values, preview levels, placeholder aggregation, skipped versus trimmed entries, empty output, clipboard denial, download, and overwrite ownership/ball/Any/no-op rules.
4. Run focused Yarn commands and update this skill plus user-facing documentation for changed behavior. Read the adding/reordering and editor-state skills for insertion/draft changes, and spread-saving for source changes. If server code changes, remind the user to restart the API on port 3001.