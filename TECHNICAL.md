# CFRU Spread Editor: Technical Reference

For the simple setup and usage guide, see [README.md](README.md). This document covers manual setup, development, repository requirements, data handling, and recovery.

## Manual installation and startup

Install [Git](https://git-scm.com/downloads), a current [Node.js](https://nodejs.org/en/download) release compatible with Vite 8, and [Yarn Classic](https://classic.yarnpkg.com/lang/en/docs/install/).

From the editor root, run `yarn install`; from the server directory, run `yarn install`; return to the root and run `yarn build`. Rebuild after application updates.

Alternatively, run [build.bat](build.bat) on Windows or [build.sh](build.sh) with Bash on macOS/Linux **from the editor root**. These scripts install Yarn globally via npm if absent, install both dependency sets, and build the frontend. Installing Yarn yourself avoids that global-install step.

Keep two terminals running:

| Terminal | Working directory | Command |
| --- | --- | --- |
| Client preview | Editor root | `yarn serve` |
| Local API | Server directory | `yarn start` |

Open http://localhost:3000. The client uses port 3000 with strict port selection; the API defaults to port 3001 and binds to `127.0.0.1`. Stop both terminal processes to stop the app.

### Launcher limitations

[start.bat](start.bat) and [start.sh](start.sh) launch these services in separate terminal windows.

- **Windows:** the current batch launcher waits on an obsolete `/api/data` readiness URL, so its automatic browser opening may never finish even when both services are ready. Open http://localhost:3000 manually or use the two-terminal steps above.
- **macOS/Linux:** the Bash launcher requires a supported desktop terminal emulator and checks ports, not API health. Its macOS Terminal and xterm branches embed an unquoted working-directory path in `cd`, so paths containing spaces fail. Use a folder path without spaces or the two-terminal steps above.

## Develop locally

Use `yarn start` at the editor root instead of `yarn serve`, while keeping server `yarn start` in the second terminal. Both Vite development and preview proxy `/api` to `http://127.0.0.1:3001`; no environment file is required for the default setup. Restart the API after server-code changes.

Optional `VITE_DEV_SERVER` changes the browser's API base URL and is read by Vite at startup/build time. Server `PORT` changes the API port; the Vite proxy remains fixed at 3001 unless configured separately. Server `CLIENT_ORIGINS` is a comma-separated origin allowlist, defaulting to `http://localhost:3000` and `http://127.0.0.1:3000`. The server loads its own dotenv configuration before reading these settings. Keep this application local, not exposed as a public or LAN service.

## Repository file requirements

The editor reads three local repository checkouts:

- [Complete Fire Red Upgrade](https://github.com/Skeli789/Complete-Fire-Red-Upgrade): compiled configuration, spread source, trainer tables, moves, and item kinds.
- [Dynamic Pokemon Expansion](https://github.com/Skeli789/Dynamic-Pokemon-Expansion): learnsets, evolution/battle-form tables, compatibility data, and local sprites.
- [Unbound Cloud](https://github.com/Skeli789/Unbound-Cloud): available games, names, base stats, items, balls, and artwork references.

The checkouts need not be siblings. Select their root folders in Connect Repositories on first launch, then Choose Game. Browse uses a native Windows folder picker; on other platforms type absolute local paths. Network/device paths are rejected. Paths and the selected game are remembered in browser localStorage and revalidated on launch. Use the game/configuration that matches your CFRU build and review Load Warnings for mismatched or missing data.

The following paths are relative to each repository root. Preserve this directory structure. Required files and directories must be readable; optional inputs provide additional catalog details or artwork when present. DPE and Unbound Cloud are read-only references.

### Complete Fire Red Upgrade

Required to connect, load spreads, and read move details:

```text
src/config.h
include/new/frontier.h
src/Tables/battle_frontier_trainers.c
src/Tables/battle_moves.c
```

At least one of these spread headers is required; any one is sufficient. Missing headers are skipped, while present headers must be readable regular files:

```text
src/Tables/battle_tower_spreads.h
src/Tables/frontier_special_trainer_spreads.h
src/Tables/frontier_multi_spreads.h
src/Tables/raid_partners.h
src/Tables/raid_rush_spreads.h
```

Optional for item kinds and item-type filtering:

```text
src/Tables/item_tables.c
```

Only present spread headers are save targets and need write access to save changes. Missing headers are not created by saves and are omitted from ZIP exports. Adding or removing a header after loading triggers a save conflict and requires reloading. Raid Rush's Easy, Medium, Hard, and Impossible sets load when `UNBOUND` is defined, and empty sets support adding their first spread.

### Dynamic Pokemon Expansion

Required to connect and load learnsets and battle forms:

```text
src/Learnsets.c
src/Egg_Moves.c
src/Evolution Table.c
src/TM_Tutor_Tables.c
src/tm_compatibility/
src/tutor_compatibility/
```

Both compatibility directories must exist. The editor reads all `.txt` files directly inside them for TM and tutor compatibility.

Optional configuration and local sprite inputs:

```text
src/defines.h
src/Front_Pic_Table.c
src/Palette_Table.c
src/Shiny_Palette_Table.c
graphics/frontspr/
graphics/backspr/
```

Keep the PNG files directly inside both graphics directories for local sprites and palettes. Without the configuration, active DPE settings may be unknown; without usable sprite tables and images, artwork falls back to other sources.

### Unbound Cloud

Required to connect:

```text
src/PokemonUtil.jsx
src/Util.jsx
src/data/SpeciesNames.json
```

Each selectable game also requires the four JSON files imported for its `baseStats`, `moves`, `items`, and `ballTypes` entries in `GAME_IDS_TO_DATA` in PokemonUtil.jsx. Their exact paths come from those imports and must resolve inside `src/data/`. Keep these files for every game you want available; at least one game must have all four.

Optional shared catalog data:

```text
src/data/SpeciesNamesAlts.json
src/data/SpeciesToDexNum.json
src/data/DexNum.json
src/data/MoveNames.json
src/data/MoveData.json
src/data/AbilityNames.json
src/data/ItemNames.json
src/data/NatureNames.json
src/data/TypeNames.json
src/data/BallTypeNames.json
src/data/UnboundShinies.json
```

Optional local artwork, using PNG files directly inside these directories:

```text
public/images/
public/images/items/
public/images/gen_9/
public/images/gen_9/shiny/
public/images/unbound_shinies/
```

## Game data and limitations

- The selected Cloud game defines available species/moves/items/balls and supplies most names and species data. Games are discovered from Cloud's declared mappings with required JSON files, not a hard-coded menu.
- Active CFRU configuration branches determine parsed source and compiled move details. CFRU type/split/PP take precedence over conflicting Cloud values; missing details stay unknown with warnings. DPE supplies learnsets, inherited moves, battle forms, and preferred local sprites. Missing/incomplete learnsets mean unknown legality, not proven illegality.
- Artwork falls back through available Cloud, PokeAPI, and PokeSprite sources. PokeAPI lookup failures do not block editing, but some remote images may be unavailable offline. Parsed data and lookup lists are cached outside the repositories.
- Type symbols and full type banners are downloaded when a game catalog loads and stored under `<data root>/cache/type-images/`, separately by format and type name. Successful downloads use workspace-scoped local image URLs and remain available offline after API restarts, even without a PokeAPI index. Failed downloads keep the existing remote URL fallback and do not block editing; an online catalog load is needed to populate missing images. The image route serves only cached PNGs and never fetches a user-supplied URL.
- Choose Species excludes recognized battle-only forms. Showdown imports convert them to base forms where mapped, supplying known Mega items or Gigantamax flags. Existing source is not globally rewritten by that filter.

### Showdown exchange

Use Add Spread → Import Showdown Text to paste one or more exported sets into an eligible destination. Invalid sets are skipped independently; short warnings report automatic choices or omitted fields. Unknown moves are dropped, unavailable abilities fall back to a base ability, and conflicting typed Hidden Power IVs are automatically optimized. Known unlearnable moves remain with a warning. Import is limited to 512 sets and 1,048,576 characters, with at most four moves per set. Packed teams, JSON, and text-file upload are not supported.

Spread Actions offers single-spread Export to Showdown and Overwrite From Showdown. Overwrite requires one set, preserves ownership and battle flags, preserves the ball when omitted, and resets doubles team type to Any. Import/overwrite remain unsaved until Save Changes.

Bulk Export includes every current filter result across pages, using current editor values and preview levels. Click the text or Copy to copy it, or Download a plain-text file. Unknown moves are omitted with warnings, zeroed placeholders are skipped with one summary, and other unrepresentable spreads are skipped with reasons. Export can include known illegal moves or out-of-range integer stats; it is not legality validation.

Showdown text does not preserve CFRU file/set/trainer ownership, battle flags, Modify Moves Doubles, doubles team type, source comments, random-ball semantics, or identical-name ability-slot identity. Imported level, nickname, happiness, Dynamax Level, and Tera Type are not saved; gender is silently ignored. Custom game names may not be understood by a standard Showdown simulator. Use source backups, not exported team text, for lossless recovery.

### Smogon sets

Add Spread → Choose Species offers Smogon after choosing a destination set and species. The dialog supports multi-select across tabs and Add N Spreads through the normal import path, closing both dialogs and revealing the first addition. Every addition defaults to Singles & Doubles (Modify), regardless of its originating tab. Spread Actions → Overwrite From Smogon uses single-select and the Showdown overwrite rules, preserving ball, ownership, and battle flags; matching sets are disabled.

- [server/endpoints/smogon.js](server/endpoints/smogon.js) exposes session-protected `POST /api/smogon/sets` with `{ species: string[] }`: 1 to 16 names, at most 64 characters each. One request loads all formats so first open caches everything for offline use.
- The endpoint accepts an optional `?progressId=<UUID>` using the existing progress store. `getSets(names, { progress } = {})` reports discovery at 0 and advances by completed-format count after resource loading and set parsing, including unavailable formats. Running progress reaches at most 99; the endpoint marks success at 100 or records failure. Cache freshness, offline fallback, sequential format loading, and download deduplication are unchanged.
- The provider exposes `loadSmogonSets(names, onProgress?) -> Promise<object>` on the editor and `cardActions`. The optional callback receives `{ percentage, label }` immediately at 0, then real polled progress and a final 100 on success (or the retained percentage with `Operation Failed` on failure). It uses a separate `smogonProgress` key through the existing `trackedPost` helper without resetting catalog/workspace state. Poll failures do not fail the main request; completion, failure, superseding loads, and provider unmount clear timers and abort polls. Superseded/unmounted requests reject with `OPERATION_CANCELLED` and suppress late progress callbacks; dialogs must also ignore results after closing or changing species.
- [server/services/smogon.js](server/services/smogon.js) uses server dependencies `@pkmn/smogon`, `@pkmn/dex`, and `@pkmn/data`. Smogon minimal mode downloads per-format files from data.pkmn.cc; formats are discovered from `sets/index.json`. Only `sets/*.json` and `analyses/*.json` URLs on that host are allowed. Analysis HTML is converted to plain text before returning descriptions.
- Files live under `<data root>/cache/smogon`, using the data-root rules below (`SPREAD_EDITOR_DATA_DIR`, otherwise `%LOCALAPPDATA%/CFRU Spread Editor` on Windows or `~/.cfru-spread-editor`). Freshness is 7 days. Download failure uses a saved copy with a stale note; without one, the API returns 503, `Smogon sets need an internet connection the first time.`
- Pure [shared/smogon.mjs](shared/smogon.mjs) exports `SMOGON_TABS`, `SMOGON_CATEGORIES`, `MAX_SMOGON_VARIANTS` (24), `getSmogonSpeciesNames`, `convertStatPoints`, and `expandSmogonSet`. Item × nature × EV-spread alternatives become separate titled variants; moves, ability, and IVs use the first option. Champions Stat Points convert as `SP*8-4`, capped at 252 per stat, then trimmed to 510 total using exported `getEvAutoFix` from [shared/spread-model.mjs](shared/spread-model.mjs). Level and Tera type are ignored.
- [src/components/SmogonDialog.jsx](src/components/SmogonDialog.jsx) uses `loadSmogonSets` from the editor state and `cardActions`, resolves variants through `resolveImportedSet` with automatic Hidden Power IV optimization, and omits errored sets with a summary. Warnings and plain-text descriptions use icon tooltips; previews are read-only SpreadCards grouped by format.

Tabs are Champions, SV (gen9), SwSh (gen8), SM (gen7), and XY (gen6); tabs without sets are disabled.
Only indexed formats in the server's ordered tier table are included:

- Singles: National Dex, National Dex Ubers, National Dex UU, National Dex RU, AG, Ubers, OU,
  Battle Stadium Singles, Battle Spot Singles, Ubers UU, UUBL, UU, RUBL, RU, NUBL, NU, PUBL,
  PU, ZUBL, ZU, NFE, and LC, in that order.
- Doubles: National Dex Doubles, Doubles Ubers, Doubles OU, Battle Stadium Doubles,
  Battle Spot Doubles, VGC of any year (newest first), Doubles UU, Doubles NU, and Doubles LC.
- Unlisted formats such as Monotype, 1v1, Hackmons, CAP, other metagames, BDSP, and Let's Go are excluded.

Species lookups combine the species and its Mega/Gigantamax/battle-only forms, excluding regional/cosmetic forms.
Mega-keyed sets resolve to the base species and use the Mega's item when none is supplied.
Within a format, same-name sets with identical movesets are skipped. Distinct sets from later form queries
keep a form suffix, such as `Drought Offense (Mega X)`; a remaining name collision is skipped.
The base query comes first and keeps the plain set name.

The dialog credits `Sets from Smogon University`. Smogon set and analysis text is copyrighted by Smogon and its contributors. Upstream requests send format file names, not repository data or spread edits. Restart the API on port 3001 after installing the server changes.

## Portable repository archives

The game menu's **Download Required Files** exports `spread-editor-reqs.zip` through authenticated `POST /api/workspaces/:id/archive`. It includes exact source bytes from the reader-derived [source inventory](server/services/source-inventory.js): required files, present optional tables/shared JSON, all declared game data imports, compatibility text, and local Cloud/DPE images. It does not include whole repositories, remote artwork, parse caches, backups, journals, or unsaved browser drafts. The download uses the existing Save/Discard/Cancel guard.

**Upload ZIP** on Connect Repositories sends raw `application/zip` to authenticated `POST /api/workspaces/import`. A version-1 manifest identifies the format and optional selected game; source roots are `cfru/`, `dpe/`, and `cloud/`, without original absolute paths. Imports validate ZIP metadata, checksums, source allowlists, repository requirements, available-game/shared JSON, and spread parsing before returning a normal workspace. Optional-source warnings still allow loading.

Each successful upload persists under `<data root>/imports/<UUID>/`. Saved settings remember those cached roots for subsequent launches and server restarts. Saves affect only the cached CFRU copy; download another ZIP to transfer saved changes. Failed uploads remove their fresh extraction directory and retain earlier imports. Successful imports are not automatically pruned.

ZIP limits are 128 MiB compressed, 32 MiB per file, 512 MiB expanded, and 16,384 entries. The exact import POST accepts binary data only after Host, Origin, and session checks; other routes retain their JSON guards. Unsafe/nonportable paths, case or file/directory collisions, duplicates, symlinks, nonregular entries, encryption, unsupported compression/ZIP64, and invalid payloads are rejected by the [archive service](server/services/archives.js).

## Saves, backups, and security

Save Changes submits updates, deletions, additions, and reorders together. The API validates permissions/fields, checks the loaded revision and input hashes (including configuration/trainer inputs), and reparses proposed source before replacing files. Targeted edits preserve unrelated source bytes, comments, line endings, and inactive branches. Only these five CFRU-relative headers from the [repository allowlist](server/services/repositories.js) are save targets:

- `src/Tables/battle_tower_spreads.h`
- `src/Tables/frontier_special_trainer_spreads.h`
- `src/Tables/frontier_multi_spreads.h`
- `src/Tables/raid_partners.h`
- `src/Tables/raid_rush_spreads.h`

DPE and Cloud are read-only reference repositories.

External changes produce `SAVE_CONFLICT` rather than silently overwriting them; unsaved browser work remains after save failures. Review the outside changes and reload/reconcile before saving again. Unsupported initializers, unsafe encodings, fixed-size arrays, and trainer-size links can restrict editing, insertion, or reordering.

The persistent data root is selected in this order:

1. `SPREAD_EDITOR_DATA_DIR`, when set. Choose a directory outside all reference checkouts.
2. `%LOCALAPPDATA%/CFRU Spread Editor`, when `LOCALAPPDATA` is available.
3. `~/.cfru-spread-editor` otherwise.

Each changing save keeps original bytes under `<data root>/backups/<backupId>/`, alongside a manifest named manifest.json. Backup source filenames replace `/` with `__`. Progress records live under `<data root>/journal/`; parsed caches use `<data root>/cache/`. Temporary staged/restore files sit beside the CFRU source for replacement. Failed saves attempt rollback, and workspace loads recover interrupted journals. Recovery restores only files still matching that save's written hash, never unrelated external edits; incomplete recovery retains artifacts and reports Load Warnings. Preserve backups/journals until recovery is resolved.

The API accepts local Host names and allowed browser Origins, requires a process-lifetime session token for filesystem API routes, and limits JSON object bodies to 4 MB. Image routes are token-free but workspace-scoped and restricted to allowlisted owned files. Paths are canonicalized and containment is checked on reads/writes. Browser storage is convenience, not authorization. Do not disable these protections or expose the API remotely.

## Tests

Use Yarn from the indicated working directory:

| Scope | Directory | Command |
| --- | --- | --- |
| Showdown adapter | Editor root | `yarn test src/tests/Showdown.test.jsx --run` |
| Showdown dialogs | Editor root | `yarn test src/tests/ShowdownDialogs.test.jsx --run` |
| Official Showdown syntax compatibility | Server | `yarn test tests/services/showdown.test.js` |
| Smogon shared rules | Editor root | `yarn test src/tests/Smogon.test.jsx --run` |
| Smogon dialog | Editor root | `yarn test src/tests/SmogonDialog.test.jsx --run` |
| Smogon service/cache | Server | `yarn test tests/services/smogon.test.js` |
| Smogon endpoint | Server | `yarn test tests/endpoints/smogon.test.js` |
| Smogon request progress and editor state | Editor root | `yarn test src/tests/SpreadEditor.test.jsx --run` |
| All frontend tests | Editor root | `yarn test-all` |
| All backend tests | Server | `yarn test-all` |
| Production build | Editor root | `yarn build` |

Frontend tests use Vitest/Testing Library; backend tests use Mocha/Chai/Supertest. New server filesystem tests must use temporary repository fixtures and a temporary `SPREAD_EDITOR_DATA_DIR`, never live checkouts. See the [testing skill](.github/skills/testing/SKILL.md) and [Showdown exchange skill](.github/skills/showdown-exchange/SKILL.md) for focused coverage and caveats.
Smogon tests use [server/tests/helpers/smogon-fixtures.js](server/tests/helpers/smogon-fixtures.js) and mocked/injected fetches; they must never contact the network.
