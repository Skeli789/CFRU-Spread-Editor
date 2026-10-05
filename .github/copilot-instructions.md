# Project Guidelines

## Scope and Dependencies

- Use Yarn for dependency management and scripts.
- Keep changes focused on the requested behavior. Do not refactor unrelated code.
- Reuse existing components and utilities before adding new abstractions.
- Use Material UI v9+ APIs. Do not introduce deprecated Material UI props.

## Verification

- Add or update tests for every new feature or component, including its expected user-visible behavior.
- Front-end tests live in `src/tests/` and use Vitest.
  - Run one test file: `yarn test <filename>`
  - Run all front-end tests: `yarn test-all`
- Back-end tests live in `server/tests/` and use Mocha, Chai, and Supertest.
  - Run one test file: `cd server && yarn test <filename>`
  - Run all back-end tests: `cd server && yarn test-all`
- Run the narrowest relevant test command after a change. Report any unrelated failures without changing unrelated code.
  - Front-end runs are quieter with `$env:DEBUG_PRINT_LIMIT=0; yarn test <filename> --run`.
  - Finish larger changes with `yarn test-all`, `cd server && yarn test-all` and `yarn build`.
- Server tests must set `SPREAD_EDITOR_DATA_DIR` and use temporary copies of fixture repositories. Never write to the real CFRU, DPE or Unbound Cloud checkouts in tests.
- After changing server code, remind the user to restart their running API server (port 3001). The Vite dev server runs on port 3000.

## Project Overview

This is a local editor for CFRU battle facility spreads (regular, special trainer, multi partner and raid partner spreads).

- `src/`: React 19 and Material UI v9 front end built with Vite. `SpreadEditorPage.jsx` is the page, `SpreadEditorState.jsx` owns the state and server requests.
- `server/`: Express 5 API that reads the CFRU, DPE and Unbound Cloud checkouts and writes only CFRU spread files.
- `shared/*.mjs`: pure rules used by both the browser and the server. They must stay free of browser and Node APIs.
- Sibling checkouts used as reference data: `../Complete-Fire-Red-Upgrade`, `../Dynamic-Pokemon-Expansion` and `../Unbound-Home`. Never modify them.

## Feature Skills

Load the matching skill in `.github/skills/` before changing a feature. Each one lists the files, data flow, user decisions and tests for its area.

| Skill | Area |
|-------|------|
| [repository-setup](skills/repository-setup/SKILL.md) | First launch, folder picker, saved settings, sessions and local-only security |
| [source-parsing](skills/source-parsing/SKILL.md) | Preprocessor, spread and trainer table parsing, parse cache |
| [spread-saving](skills/spread-saving/SKILL.md) | Save operations, minimal source patches, backups, journal and conflicts |
| [game-catalog](skills/game-catalog/SKILL.md) | Unbound Cloud game data, CFRU move data, learnsets, legality, sprites and images |
| [pokemon-mechanics](skills/pokemon-mechanics/SKILL.md) | Stats, EVs and IVs, natures, abilities, Mega Evolution, Hidden Power, IV auto-fix |
| [spread-model](skills/spread-model/SKILL.md) | Spread fields, battle types, doubles team types, validation and changed fields |
| [editor-state](skills/editor-state/SKILL.md) | Reducer, drafts, unsaved-change cache, saving and navigation guards |
| [spread-filters-layout](skills/spread-filters-layout/SKILL.md) | Filters, set names, species groups, rows and pagination |
| [spread-card](skills/spread-card/SKILL.md) | Spread cards, the edit dialog, stat table and card layout |
| [move-picker](skills/move-picker/SKILL.md) | Move fields and the Choose Moves dialog |
| [item-picker](skills/item-picker/SKILL.md) | Item field and the Choose Item dialog |
| [adding-reordering](skills/adding-reordering/SKILL.md) | Adding spreads and reordering spreads and species groups |
| [showdown-exchange](skills/showdown-exchange/SKILL.md) | Showdown import, export and overwrite; Smogon sets, dialog and cache |
| [testing](skills/testing/SKILL.md) | Test layout, fixtures and helpers for both test suites |

Update the matching skill when a change alters the behavior or files it describes.

## Server Style

- `server.js` only wires up and starts the server. Put middleware in `server/middleware/` and routes in `server/endpoints/`.
- Write routers in the plain format: `const router = express.Router(); ... module.exports = router;`. Do not add router or app factory functions.
- Use `StatusCode` from `status-code-enum` for HTTP statuses. Never define local `HTTP_*` constants.
- Add short section comments inside longer functions to mark each step.

## UI Conventions

- Use MUI `Tooltip` for every tooltip. Never use native `title` attributes, and avoid `describeChild`, which adds one.
- Autocompletes highlight the first match (`autoHighlight`) so Enter picks it right away.
- Focused fields keep the blue focus color from the theme, not the red primary color.
- Type symbols show only the icon with a tooltip, as Unbound Cloud does, unless a view needs the full type banner.
- Only interactive elements get a pointer cursor or hover highlight. Locked, placeholder and deleted cards do not.
- Use Title Case for button labels and dialog titles, such as "Save Changes" and "Revert All".
- In chooser dialogs such as Choose Moves and Choose Item, the Close button sits at the left end of the actions row.
- Use `slotProps` for inner element props, never the deprecated `InputProps`, `inputProps` or `componentsProps`.

## Working Practices

- Never edit files by running PowerShell commands. `Set-Content` and `Out-File` add a byte order mark or change the encoding.
- Keep comments short. Only write a comment when it states something the code cannot show, and keep it to one line.

## JavaScript and JSX Style

- Use four spaces for indentation and leave blank lines empty.
- Put opening curly braces on their own line. Omit braces for single-statement `if` and `else` bodies.
- Do not use em dashes in prose, comments, or UI copy.
- Define named constants near the top of the file for repeated values and non-obvious strings. Avoid magic strings and numbers.
- Add JSDoc to components, functions, methods, and effects. Document parameters with `@param` and return values with `@returns` when applicable.
- For CommonJS modules, export each public value next to its implementation rather than gathering exports at the end of the file.

## Code Examples

```javascript
/**
 * Example function demonstrating code style.
 */
function example()
{
    const data =
    {
        key: "value",
    };

    if (condition)
        doSomething();
    else
    {
        doMultiple();
        thingsHere();
    }
}
```

```javascript
const STATUS_READY = "ready";

/**
 * Returns whether a status is ready for processing.
 *
 * @param {string} status The status to evaluate.
 * @returns {boolean} Whether the status is ready.
 */
function isReady(status)
{
    return status === STATUS_READY;
}
module.exports.isReady = isReady;
```
