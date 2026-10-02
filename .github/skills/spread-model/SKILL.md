---
name: spread-model
description: "Use when changing spread fields, spread-model.mjs, Battle Type, Modify Moves Doubles, Doubles Team Type, omitted source values, changed fields, validation, createNewSpreadFields, compactMoves, or categorized spread auto-fix."
---

# Spread Model

The pure shared model translates source values into editable choices, computes field differences, and plans repairs. Keep source representation, UI choices, and server validation distinct.

## Files

- [shared/spread-model.mjs](../../../shared/spread-model.mjs): battle/team types, omitted symbols, validation, setters, move compaction, new defaults, differences, and categorized auto-fix.
- [shared/pokemon-mechanics.mjs](../../../shared/pokemon-mechanics.mjs): stat keys, limits, ability slots, Hidden Power, and IV planning.
- [shared/catalog.mjs](../../../shared/catalog.mjs): `getMoveLegality` and legality statuses used by repair and save checks.
- [server/services/spread-parser.js](../../../server/services/spread-parser.js): `SPREAD_FIELDS`, omitted values, explicit/raw/unknown fields, comments, spans, and entry editability.
- [server/services/data-parser.js](../../../server/services/data-parser.js): `parseTeamTypes` reads the active CFRU doubles team enum.
- [server/services/spread-writer.js](../../../server/services/spread-writer.js): `mergeSpreadFields` and `createSpreadFields` normalize and validate submitted source values.
- [server/services/spread-store.js](../../../server/services/spread-store.js): snapshot permissions/team types and operation-specific team validation.
- [src/SpreadEditorState.jsx](../../../src/SpreadEditorState.jsx): `findSaveProblems`, saved-value comparisons, Both-mode memory, and draft application.
- [src/components/SpreadCard.jsx](../../../src/components/SpreadCard.jsx): battle/team controls and warnings; [src/SpreadEditorPage.jsx](../../../src/SpreadEditorPage.jsx) prepares new spreads and auto-fix previews.

## Data flow

1. The parser reads active designated initializers into complete `fields`, supplying C zero values for omitted fields. It preserves explicit fields, unknown expressions, source spans, and recognized ability/Hidden Power comments separately.
2. The store exposes entries and sets with stable IDs, permissions, and compiled `teamTypes: [{ name, value }]`. The browser displays `drafts[id] ?? entry.fields`, not regenerated source.
3. Controls call shared setters with current and saved fields. The reducer remembers Both's modify flag, removes unchanged saved-entry drafts, and retains new-entry drafts.
4. `getChangedFields` produces update payloads; `findSaveProblems` adds browser checks. The server validates operation fields and merged numeric values before generating minimal source patches.
5. Auto-Fix plans return partial changes for preview; Apply merges only the selected plan into drafts. Repairs do not write source until Save Changes.

## Behavior and user decisions

- Known fields are species, nature, six IVs, six EVs, ability, item, four moves, ball, shiny, `forSingles`, `forDoubles`, `modifyMovesDoubles`, gigantamax, and `specificTeamType`. Stat keys are `hp`, `atk`, `def`, `spAtk`, `spDef`, `spd`; `spd` is Speed. Ability is a numeric source slot: hidden 0, first 1, second 2.
- Parser omissions become `false` for booleans, four numeric zeros for moves, and numeric zero otherwise. `getFieldSymbol` displays zero nature/item/ball as Hardy/No Item/Random. The random-ball interpretation is a user decision. `setFieldSymbol` restores the saved raw value when choosing its displayed symbol again, so omitted zero does not become a needless explicit constant.
- `BATTLE_TYPES` is Both, Singles Only, Doubles Only, and Neither. Neither is displayed for existing source but cannot be selected. Singles forces `(forSingles, forDoubles, modifyMovesDoubles) = (true, false, true)`; Doubles forces `(false, true, false)`; Both sets both availability flags and restores the remembered modify choice. The checkbox is shown only for Both; the card falls back to saved Both's choice or true when no memory exists.
- `changeBattleType` resets the team requirement to `DOUBLES_ANY_TEAM` when leaving Doubles Only and team data is available. It does not reset without team data. Team controls and the warning for an existing non-Any requirement outside Doubles Only require a nonempty team enum; the UI does not silently rewrite the requirement on load.
- `getTeamType` resolves numeric values using the snapshot enum and passes symbolic values through. Unmatched numbers return null and stay visible as raw values. `setTeamType` restores the original numeric or symbolic representation when choosing the saved type. Labels derive from `DOUBLES_*_TEAM`, not a hardcoded list of teams.
- `validateSpreadFields` checks integer IVs 0..31, integer EVs 0..252, total EVs at most 510, and a moves array of at most four slots. It does not check battle flags, ability slots, team enum membership, species, duplicates, or learnability. Existing bad source stays visible; validation blocks changed/added drafts, not loading untouched entries.
- `setIv`/`setEv` ignore non-integers. IV entry clamps to 0..31; EV entry clamps negatives to zero but retains integers above 252 or the remaining 510 budget for editing feedback. Arrow/button EV stepping still respects the legal per-stat and total caps through `stepEv`. Validation continues to reject illegal EV drafts at save time. Legal EVs need not be multiples of four. `setMove` updates one slot and, for typed Hidden Power, optimizes all six IVs. `compactMoves` shifts nonempty moves ahead of null, zero, and `MOVE_NONE` blanks without otherwise changing order or normalizing blank representations; closing editing compacts only already-existing drafts, and adding compacts the pending spread.
- New fields use Hardy, 31 IVs, zero EVs, the first available ability in first/second/hidden order (fallback 1), No Item, Random ball, four blank moves, Both with modification true, false shiny/gigantamax, and numeric-zero team type. The page seeds the first name-sorted picker option when available, which can have unknown legality: complete learnsets include conditional unknown moves, and incomplete learnsets offer all game options. Adding requires at least one move; the shared defaults alone are intentionally incomplete.
- `findSaveProblems` excludes deleted drafts at its callers, checks IVs, EVs, total EVs, and moves-array shape through `validateSpreadFields`, requires a non-`MOVE_NONE` string move for new entries, and rejects changed move slots only when the selected catalog reports `UNDEFINED`. An unlearnable but defined move is not a save blocker. The server independently checks known field names, constant syntax/prefix/length, booleans, ability 0..2, and all merged IV/EV values. It pads moves to four and normalizes null/`MOVE_NONE` to zero. New source requires a species other than `SPECIES_NONE` and a move; changed team types and all additions require a compiled enum name or numeric zero.
- Differences compare scalar values strictly and arrays element-by-element, including length. They are representation-sensitive: zero and a constant naming zero differ unless a setter restores the saved value.
- All auto-fix caps integer IVs over 31, caps integer EVs over 252, reduces excess EVs from the smallest positive investment first (stat-order tie break, maxed investments last), removes illegal/undefined/repeated moves, compacts slots, then computes IV use from surviving moves. Known legal non-multiple-of-four EVs are preserved. This is not a universal repair of negative or non-integer values.
- `categoryFields` holds independent Moves, IVs, and EVs changes. IVs-only uses current moves after IV capping, including moves All would remove; Moves-only leaves IVs/EVs alone. All/IVs report unknown attacking-stat skips. Hidden Power parity and unknown-stat caution belong to mechanics. The planner skips placeholders entirely; the page separately excludes locked entries from changes and lists them in the preview across all matching pages.

## Invariants and pitfalls

- Keep shared modules free of browser and Node APIs. Do not put source spans or UI state into editable `fields`.
- `modifyMovesDoubles` is a runtime flag, not a second saved move list. Preview level, Little Cup, and Mega stats are not additional source fields.
- Numeric validity and source rewrite safety are different: unsupported initializers can be locked even if their displayed values look valid. Unknown fields alone are preserved, not automatically locked.
- Do not infer full validation from `validateSpreadFields`, or enforce learnability merely because Auto-Fix can remove an illegal move. Keep warnings separate from blockers.
- Preserve omitted values and original comments through the parser/writer boundary. Do not normalize every loaded spread or hardcode enum values.

## Tests and commands

- [src/tests/SpreadMechanics.test.jsx](../../../src/tests/SpreadMechanics.test.jsx): battle/team transitions, omitted symbols, differences, defaults, value limits, and mechanics. Run from root: `yarn test src/tests/SpreadMechanics.test.jsx --run`.
- [src/tests/SpreadLayout.test.jsx](../../../src/tests/SpreadLayout.test.jsx): combined/category repairs, move/IV context, EV priorities, and placeholders. Run: `yarn test src/tests/SpreadLayout.test.jsx --run`.
- [src/tests/SpreadCard.test.jsx](../../../src/tests/SpreadCard.test.jsx) and [src/tests/SpreadEditor.test.jsx](../../../src/tests/SpreadEditor.test.jsx): controls, warnings, compaction, save blockers, and preview/application. Run the affected file with `yarn test <root-relative path> --run`; optionally set `$env:DEBUG_PRINT_LIMIT=0` first.
- [server/tests/services/spread-parser.test.js](../../../server/tests/services/spread-parser.test.js) and [server/tests/services/spread-writer.test.js](../../../server/tests/services/spread-writer.test.js): source defaults, preservation, enum checks, and server rejection. From server: `yarn test tests/services/spread-writer.test.js` (or the parser path). Use temporary fixture repositories and isolated data directories.

## Change checklist

1. Identify the parser representation, shared rule, reducer memory, UI control, and server validation boundaries touched by the change.
2. Check omitted zero round trips, all battle transitions, Both memory, missing/unknown team data, strict array differences, and unchanged invalid source.
3. For auto-fix, test All versus independent categories, current versus surviving moves, Hidden Power, unknown details, EV priorities, placeholders, and locked entries.
4. Add observable behavior tests, run the narrowest relevant suites, and update this skill. After server code changes, remind the user to restart the API on port 3001.
