---
name: showdown-exchange
description: "Use when changing Showdown import, Import Showdown Text, Export to Showdown, Overwrite From Showdown, Smogon sets, Overwrite From Smogon, the Smogon dialog, smogon.mjs, the Smogon cache, pasted team text, Showdown warnings, battle-only form resolution, Hidden Power import, clipboard copying, text downloads, or showdown.mjs."
---

# Showdown Exchange

Showdown text exchange is a browser-side adapter for the selected game catalog, not a source-file format or a battle legality validator. Smogon sets are downloaded and cached by the local API, then resolved through the same adapter. Import and overwrite create unsaved editor changes; only Save Changes writes CFRU source.

## Files

- [showdown.mjs](../../../shared/showdown.mjs): pure `@pkmn/sets` adapter, `parseShowdownText`, `resolveImportedSet`, `exportSpread`, `exportSpreads`, `applyOverwrite`, limits, placeholder marker, and metadata losses.
- [smogon.mjs](../../../shared/smogon.mjs): pure `SMOGON_TABS`, `SMOGON_CATEGORIES`, `MAX_SMOGON_VARIANTS` (24), `getSmogonSpeciesNames`, `convertStatPoints`, and `expandSmogonSet`.
- [smogon.js](../../../server/services/smogon.js): caching fetch, format discovery from `sets/index.json`, `getSets`, and plain-text analysis descriptions using `@pkmn/smogon`, `@pkmn/dex`, and `@pkmn/data`.
- [smogon.js](../../../server/endpoints/smogon.js): session-protected `POST /api/smogon/sets` accepts `{ species: string[] }`, with 1 to 16 names of at most 64 characters.
- [SmogonDialog.jsx](../../../src/components/SmogonDialog.jsx): format sections, read-only previews, multi-select additions, and single-select overwrite.
- [catalog.mjs](../../../shared/catalog.mjs): `getOutOfBattleForm`, `isBattleOnlySpecies`, and `getMoveLegality` resolve battle forms and selected-game move availability.
- [pokemon-mechanics.mjs](../../../shared/pokemon-mechanics.mjs): ability slots, stat names, Hidden Power types and IV optimization.
- [spread-model.mjs](../../../shared/spread-model.mjs): `createNewSpreadFields`, exported `getEvAutoFix`, field validation, omitted source defaults, and Any doubles team type handling.
- [SpreadDialogs.jsx](../../../src/components/SpreadDialogs.jsx): `AddSpreadDialog`, `resolveShowdownText`, `getImportWarnings`, `ExportSpreadsDialog`, `resolveOverwrite`, and `OverwriteSpreadDialog` own pasted-text previews, automatic choices, copy, and download.
- [SpreadEditorPage.jsx](../../../src/SpreadEditorPage.jsx): bulk export scope, per-set preview levels, destination defaults, imported additions, and reveal behavior.
- [SpreadCard.jsx](../../../src/components/SpreadCard.jsx): Spread Actions exposes single-spread export and editable-spread overwrite; applies overwritten fields through card actions; `readOnly` supports Smogon previews.
- [SpreadEditorState.jsx](../../../src/SpreadEditorState.jsx): `loadSmogonSets` on the editor and `cardActions`, `addSpreads`, drafts, insertion order, unsaved cache, validation, and save operations.
- [SpreadFilters.jsx](../../../src/components/SpreadFilters.jsx): bulk Export control. [SpreadEditorPage.css](../../../src/styles/SpreadEditorPage.css): dialog sizing, import problem bullets/headings, and export text styling.
- [Showdown.test.jsx](../../../src/tests/Showdown.test.jsx), [ShowdownDialogs.test.jsx](../../../src/tests/ShowdownDialogs.test.jsx), [AddReorder.test.jsx](../../../src/tests/AddReorder.test.jsx), and [showdown.test.js](../../../server/tests/services/showdown.test.js): adapter, UI, insertion, and official simulator syntax compatibility.
- [Smogon.test.jsx](../../../src/tests/Smogon.test.jsx) and [SmogonDialog.test.jsx](../../../src/tests/SmogonDialog.test.jsx): shared expansion/resolution and dialog behavior. [smogon.test.js](../../../server/tests/services/smogon.test.js), [smogon.test.js](../../../server/tests/endpoints/smogon.test.js), and [smogon-fixtures.js](../../../server/tests/helpers/smogon-fixtures.js): offline service/cache fixtures and API coverage.

## Data flow

1. Add Spread's Import Showdown Text tab accepts pasted text and a destination with `canInsert`. Deferred text goes through `parseShowdownText`, then each parsed set through `resolveImportedSet` with `hiddenPower: "optimizeIvs"`.
2. The adapter normalizes names against the selected catalog, builds spread defaults, resolves forms/abilities/moves/stats, and returns errors, warnings, ambiguities, and unsupported metadata. The UI lists only sets with problems, not a roster of every successful set.
3. Import passes all error-free fields to `addSpreads` in pasted order. Errors skip only their affected sets; warnings do not block import. Additions become unsaved entries immediately, rather than entering the Choose Species pending-edit flow. The page closes Add Spread, reveals the first imported entry, and reports the count.
4. Bulk Export collects all current filter results across pages in editor order, with current drafts/new entries and each set's `getSpreadLevel`. It does not add a separate pending-deletion exclusion. Per-card export uses that card's current fields and level. Each entry is exported independently; nonempty texts are joined with blank lines.
5. Showdown overwrite parses exactly one set, resolves it with current fields and automatic Hidden Power optimization, then calls `applyOverwrite`. Applying updates the draft, closes the overwrite dialog, and leaves Save Changes pending. Showdown text exchange needs no exchange-specific API endpoint.
6. Smogon loads combined species/form names through `loadSmogonSets` and `POST /api/smogon/sets`. The server discovers and loads all formats in one request using `@pkmn/smogon` minimal mode (per-format files), caches sets/analyses, and converts description HTML to plain text. The dialog expands variants and calls `resolveImportedSet` with automatic Hidden Power IV optimization, then delegates additions or overwrite to the normal import/draft paths.

## Behavior and user decisions

### Import and resolution

- Input is exported Showdown text, not packed teams or JSON. A leading BOM and CRLF/CR are normalized. Blank lines, `---`, and `=== [format] team name ===` headers split sets; team names/formats are parsed but do not assign CFRU ownership or battle flags. There is no text-file upload control. Download is export-only.
- Limits are `MAX_SHOWDOWN_LENGTH` (1,048,576 JavaScript characters), `MAX_SHOWDOWN_SETS` (512), and four moves per set. Duplicate recognized headers/stat entries, malformed numbers, IVs over 31, EVs over 252 per stat, or EV total over 510 produce errors. Unknown lines produce warnings. The problem list displays at most 200 affected sets, without limiting how many valid sets are imported within the parser cap.
- Names ignore case, accents, and punctuation and match constant suffixes or catalog names. Species also match `showdownName`; exact alternate-name matches win before preferring out-of-battle candidates. Remaining species ambiguity uses the first candidate and reports `Choose species`; the current UI does not offer a species-resolution picker.
- Battle-only matches convert to a base species using `getOutOfBattleForm`. DPE-derived held items are supplied when the text omits an item, and Gigantamax conversion sets its flag. An explicit disagreeing item is retained with `Mega form and item disagree`; the UI does not ask for a corrective choice. Move-triggered Mega mappings do not inject their triggering move. Suffix/fixed-list mappings cannot invent an unknown held item.
- Defaults come from `createNewSpreadFields`: no item, random ball, Hardy nature, 31 IVs, zero EVs, first available ability (regular slots before hidden), both singles/doubles with Modify Moves Doubles, and Any doubles team type as omitted zero. Missing explicit stat values use these defaults. Unknown species, item, nature, or ball causes errors; an unavailable ability instead warns and uses the default.
- Identical-name ability slots resolve silently to the first match, retaining a matching existing slot on overwrite. A Mega-only ability uses a valid base slot without an ability warning, preserving an available existing slot when applicable. Base-species inputs also accept abilities from any Mega enabled by the resolved item or retained moves.
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

### Smogon Sets

- Add Spread's Choose Species tab places Smogon left of Add, enabled once a destination set and species are chosen. Clicking a preview toggles its highlighted border and round green check at the top-left. Selection persists across tabs; Add N Spreads closes both dialogs, reveals the first addition, and toasts the count. Every addition uses `createNewSpreadFields` defaults: Singles & Doubles (Modify), regardless of its originating tab.
- Editable cards offer Overwrite From Smogon in Spread Actions. Single-select applies a clicked set like Overwrite From Showdown and closes, preserving ball, singles/doubles flags, and ownership. Only Smogon overwrite runs `getIvAutoFix` after overwrite preservation and the team-type reset, using the final moves and snapshot team enum: unused attacking IVs and slow Speed become 0/1, used attacking IVs become 31/30, unknown attacking use stays unchanged, and Hidden Power keeps its type. Previews, applied fields and no-op detection share these optimized final fields; optimization-only changes remain selectable. Matching sets are disabled with `This set matches the spread already.` Multi-add and Showdown paste do not gain this auto-fix.
- `loadSmogonSets(names, onProgress)` reports `{ percentage, label }` to the dialog's existing OperationProgress component. Pending requests start at `{ percentage: 0, label: "Loading Smogon Sets..." }`; only real callbacks advance progress. Retry/species changes reset it, success/error clears it, and the effect's active guard ignores callbacks and results after cleanup or completion.
- Both generation and category tabs share local theme-aware contrast: enabled text uses `text.primary` with weight 500 and full opacity, selected tabs use `focus.main` with weight 600, and disabled tabs use `text.disabled` with weight 400 and opacity 0.45. Disabled opacity cannot apply to enabled selected tabs; empty tabs remain noninteractive.
- Tabs are Champions, SV (gen9), SwSh (gen8), SM (gen7), and XY (gen6); empty tabs are disabled.
	Include only indexed tiers in the server's ordered table; exclude unlisted metagames, BDSP, and Let's Go.
	Singles order: National Dex, National Dex Ubers, National Dex UU, National Dex RU, AG, Ubers, OU,
	Battle Stadium Singles, Battle Spot Singles, Ubers UU, UUBL, UU, RUBL, RU, NUBL, NU, PUBL,
	PU, ZUBL, ZU, NFE, LC. Doubles order: National Dex Doubles, Doubles Ubers, Doubles OU,
	Battle Stadium Doubles, Battle Spot Doubles, VGC (newest year first), Doubles UU, Doubles NU, Doubles LC.
- Combine the species with its Mega, Gigantamax, and battle-only forms, not regional or cosmetic forms.
	Mega-keyed sets resolve to the base species and supply the Mega's item when no item is specified.
	Skip same-name sets with identical movesets within a format; distinct later form sets get a suffix such as
	`(Mega X)` or `(Mega)`. Skip remaining name collisions. Query the base first to keep its plain set name.
- Expand item × nature × EV-spread combinations into at most 24 cards per set. Moves, ability, and IVs use the first option; titles name differing choices with suffixes such as `(Modest, Spread 2)`. Ignore Tera types and level. Champions Stat Points become EVs as `SP*8-4`, capped at 252 per stat, then trimmed to 510 total with `getEvAutoFix`.
- Omit sets with resolution errors and summarize them in a focusable, shrink-wrapped inline-flex span aligned to the start. Its MUI tooltip is anchored `top-start` directly to the text and retains each set's errors; the summary is not an action button. Warnings appear in a warning icon tooltip.
- Read-only SpreadCards form a grid with one section per format, without card hover highlights. Both addition and overwrite previews pass `showBattleType={false}` to omit only the battle-type chip; Little Cup, team, and placeholder chips retain their normal behavior. Selectable choices use a pointer cursor throughout their content; disabled choices use the default cursor except for their interactive explanation button. Titles sit above cards. Caption: `Sets from Smogon University`. Smogon set and analysis text is copyrighted by Smogon and its contributors.
- When a description exists, the help button is named `About <set title>` and its tooltip only says `View Explanation`. Click, Enter, or Space opens a nested `<set title> Explanation` dialog without selecting or overwriting the underlying card, including matching disabled choices. Descriptions render as justified plain text with preserved newlines and word wrapping in scrollable dialog content. Close is left-aligned; Close, Escape, and backdrop dismissal affect only the explanation and preserve the Smogon dialog and selection.
- Cache files under `<data root>/cache/smogon`; the root defaults to `%LOCALAPPDATA%/CFRU Spread Editor` on Windows or `~/.cfru-spread-editor`, overridable by `SPREAD_EDITOR_DATA_DIR`. Files are fresh for 7 days. First open caches all formats for offline use; download failure uses a saved copy with a stale note. Without a saved copy, return 503 with `Smogon sets need an internet connection the first time.`

## Invariants and pitfalls

- Keep the shared adapter free of browser and Node APIs. Clipboard, Blob/download, toasts, and dialogs belong in the frontend; use `@pkmn/sets` rather than inventing a separate Showdown grammar.
- Catalog availability is per game; never resolve against another game's names or silently invent constants. Use shared battle-form and ability helpers rather than a second form mapping.
- Do not document obsolete interactive ambiguity controls, file input, a difference table, or whole-spread rejection for unknown moves. Distinguish adapter capabilities from what the current dialogs actually pass and render.
- Import/save validation is stricter than export representability. Preserve partial success and the distinction between placeholder skips, unrepresentable entries, and trimmed moves.
- Keep exchange changes as drafts/additions until Save Changes. Preserve source ownership on overwrite, and delegate insertion/reordering/cache/save invariants to the corresponding skills.
- Smogon descriptions must be plain text only; convert HTML on the server, never render upstream HTML in the dialog. Allow only data.pkmn.cc `sets/*.json` and `analyses/*.json` URLs, including `sets/index.json` for discovery.
- Keep `shared/smogon.mjs` free of browser and Node APIs. Network and disk cache access belong on the server; Smogon tests use fixtures and mocked/injected fetches and must never hit the network.

## Tests and commands

- From the workspace root: `yarn test src/tests/Showdown.test.jsx --run` covers syntax/limits, defaults, names/forms, abilities, stat mapping, Hidden Power, export representability/placeholders, and overwrite preservation. Its text-fixture test reads the tracked [sample-showdown-spreads.txt](../../../src/tests/data/sample-showdown-spreads.txt).
- From the workspace root: `yarn test src/tests/ShowdownDialogs.test.jsx --run` covers copy, filter export, per-card actions, terse problem bullets, unsupported fields, skipped/trimmed exports, overwrite no-op/multiple-set behavior, and Add defaults.
- From the workspace root: `yarn test src/tests/AddReorder.test.jsx --run` covers importing multiple sets, skipped invalid sets, base-form conversion, insertion order, draft/save operations, and related Add behavior. [SpreadEditor.test.jsx](../../../src/tests/SpreadEditor.test.jsx) covers draft persistence and save failures: `yarn test src/tests/SpreadEditor.test.jsx --run`.
- From the server directory: `yarn test tests/services/showdown.test.js` compares standard import/export syntax with `pokemon-showdown` and checks compact resolution warnings. This is parser compatibility coverage, not simulator legality validation for every catalog.
- From the workspace root: `yarn test src/tests/Smogon.test.jsx --run` covers forms, variant expansion/cap, Stat Points conversion, and catalog resolution; `yarn test src/tests/SmogonDialog.test.jsx --run` covers tabs/contrast, genuine progress callbacks and lifecycle resets, nested explanation interaction/dismissal, compact skipped-tooltip hover/focus, selection, warnings, addition, and overwrite. CSS source checks normalize whitespace; the tooltip focus test models `:focus-visible` on its span because jsdom does not reliably implement MUI's native focus-visible check.
- From the server directory: `yarn test tests/services/smogon.test.js` covers discovery, URL restrictions, plain-text descriptions, freshness, and offline fallback; `yarn test tests/endpoints/smogon.test.js` covers session protection, species limits, and unavailable downloads. Use [smogon-fixtures.js](../../../server/tests/helpers/smogon-fixtures.js), temporary data folders, and no live downloads.
- In PowerShell, prepend `$env:DEBUG_PRINT_LIMIT=0;` to frontend commands for quieter failures. Use isolated temporary repositories and `SPREAD_EDITOR_DATA_DIR` for any new server filesystem tests; never write sibling checkouts.
- Documentation-only updates need link/frontmatter/source-fact checks. Runtime changes need the narrowest affected suites; finish larger changes with root `yarn test-all`, server `yarn test-all`, and root `yarn build`.

## Change checklist

1. Trace parsing, catalog resolution, automatic choices, issue formatting, and draft application together. Verify import and overwrite behavior separately from direct adapter options.
2. Cover partial import success, all-unknown moves, catalog name ambiguity, battle forms, unavailable/duplicate abilities, stat defaults/ranges, Hidden Power, and unsupported metadata when affected.
3. Verify all-page filter scope/order/current values, preview levels, placeholder aggregation, skipped versus trimmed entries, empty output, clipboard denial, download, and overwrite ownership/ball/Any/no-op rules.
4. Run focused Yarn commands and update this skill plus user-facing documentation for changed behavior. Read the adding/reordering and editor-state skills for insertion/draft changes, and spread-saving for source changes. If server code changes, remind the user to restart the API on port 3001.
5. For Smogon changes, verify format discovery/categories, combined forms, slash-option limits, Stat Points trimming, partial resolution, selection across tabs, and overwrite preservation/no-op behavior.
6. Check plain-text descriptions, the URL whitelist, 7-day freshness, stale fallback/first-use 503, and network-free tests. Keep attribution, privacy disclosures, and cache documentation current.
