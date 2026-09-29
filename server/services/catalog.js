/**
 * Game catalog loading. The selected Unbound Cloud game supplies species, stats, abilities, names and
 * which species, moves, items and balls exist; CFRU's gBattleMoves supplies move details; DPE supplies
 * learnsets and battle forms. Where Cloud and the local repositories disagree, the local data is used
 * and the difference is reported.
 */

const { StatusCode } = require("status-code-enum");

const { LEARNSET_COMPLETE } = require("../../shared/catalog.mjs");
const { ApiError } = require("../middleware/errors");
const { getBallIcon, getGigantamaxIcon, getItemIcon, getSpeciesIcon, getSpeciesSprites, getTypeIcon, getTypeSymbol, readCloudImages } = require("./assets");
const { parseBattleMoves, parseItemTypes } = require("./data-parser");
const { buildBattleForms, buildLearnsets, loadDpeData } = require("./learnsets");
const { createParseCache, getParserVersion, hash, hashMacros } = require("./parse-cache");
const { createPokeApiIndex } = require("./pokeapi");
const { evaluatePreprocessor } = require("./preprocessor");
const { CFRU_CONFIG_FILE, REPOSITORY_CFRU, REPOSITORY_CLOUD, getRootKey, readOwnedFile } = require("./repositories");
const { getDpeSpriteUrls, loadSpriteTables } = require("./sprites");

const CFRU_MOVES_FILE = "src/Tables/battle_moves.c";
const CFRU_ITEM_TABLES_FILE = "src/Tables/item_tables.c";
const CACHE_BATTLE_MOVES = "battle-moves";
const CACHE_ITEM_TYPES = "item-types";
const REPOSITORY_FILE_UNAVAILABLE = "REPOSITORY_FILE_UNAVAILABLE";

// Cloud data shared by every game; each is optional, since the editor can fall back to constant names
const CLOUD_SHARED_FILES =
{
    speciesNames: "src/data/SpeciesNames.json",
    showdownNames: "src/data/SpeciesNamesAlts.json",
    speciesDex: "src/data/SpeciesToDexNum.json",
    dexNumbers: "src/data/DexNum.json",
    moveNames: "src/data/MoveNames.json",
    moveData: "src/data/MoveData.json",
    abilityNames: "src/data/AbilityNames.json",
    itemNames: "src/data/ItemNames.json",
    natureNames: "src/data/NatureNames.json",
    typeNames: "src/data/TypeNames.json",
    ballNames: "src/data/BallTypeNames.json",
    unboundShinies: "src/data/UnboundShinies.json",
};

const BASE_STATS_KEY = "baseStats";
const MOVES_KEY = "moves";
const ITEMS_KEY = "items";
const BALL_TYPES_KEY = "ballTypes";

// Cloud's base stat keys by the stat names spreads use, where spd is Speed
const STAT_KEYS = { hp: "baseHP", atk: "baseAttack", def: "baseDefense", spAtk: "baseSpAttack", spDef: "baseSpDefense", spd: "baseSpeed" };
const TYPE_KEYS = ["type1", "type2"];

// Indexed by FRONTIER_ABILITY_HIDDEN, FRONTIER_ABILITY_1 and FRONTIER_ABILITY_2
const ABILITY_KEYS = ["hiddenAbility", "ability1", "ability2"];
const MAX_BASE_STAT = 255;

const SPECIES_NONE = "SPECIES_NONE";
const MOVE_NONE = "MOVE_NONE";
const ABILITY_NONE = "ABILITY_NONE";
const BALL_TYPE_RANDOM = "BALL_TYPE_RANDOM";
const BALL_TYPE_RANDOM_NAME = "Random";
const SYMBOL_PREFIXES = { species: "SPECIES_", moves: "MOVE_", items: "ITEM_", balls: "BALL_TYPE_", natures: "NATURE_" };
const COMPARED_MOVE_FIELDS = ["type", "split", "pp"];

// Unbound's own shiny colors apply only to Unbound games, as in Cloud's GetIconSpeciesLinkBySpecies
const UNBOUND_GAME_PATTERN = /^unbound(?:_|$)/;
const SPRITE_SOURCE_DPE = "dpe";

const UNRESOLVED_LABELS = { species: "species", moves: "moves", items: "items", balls: "balls", natures: "natures" };
const EXAMPLE_COUNT = 5;

const SEVERITY_WARNING = "warning";


/**
 * Parses a Cloud data file and checks that it is a JSON object.
 *
 * @param {string} contents The file contents.
 * @param {string} relativePath The file path, for errors.
 * @returns {object} The parsed data.
 */
function parseDataObject(contents, relativePath)
{
    // Cloud's JSON files may start with a byte order mark
    let data;
    try
    {
        data = JSON.parse(contents.replace(/^\uFEFF/, ""));
    }
    catch
    {
        throw new ApiError(StatusCode.ClientErrorUnprocessableEntity, "CATALOG_INVALID", `${relativePath} is not valid JSON.`, { file: relativePath });
    }

    // Every game data file is keyed by constant name
    if (data === null || typeof data !== "object" || Array.isArray(data))
        throw new ApiError(StatusCode.ClientErrorUnprocessableEntity, "CATALOG_INVALID", `${relativePath} does not contain the expected data.`, { file: relativePath });

    return data;
}

/**
 * Returns one of the workspace's games.
 *
 * @param {object} workspace The workspace.
 * @param {*} gameId The requested game ID.
 * @returns {object} The game.
 */
function getGame(workspace, gameId)
{
    // Only games found when the workspace loaded can be opened
    const game = typeof gameId === "string" ? workspace.games.get(gameId) : undefined;
    if (game == null)
        throw new ApiError(StatusCode.ClientErrorNotFound, "GAME_NOT_FOUND", "This game is not available in the loaded Unbound Cloud repository.");

    return game;
}

/**
 * Reads one of a game's data files.
 *
 * @param {object} workspace The workspace.
 * @param {*} gameId The game ID.
 * @param {string} key The data key, such as baseStats.
 * @returns {Promise<object>} The parsed data.
 */
async function readGameData(workspace, gameId, key)
{
    const relativePath = getGame(workspace, gameId).dataFiles[key];
    return parseDataObject(await readOwnedFile(workspace, REPOSITORY_CLOUD, relativePath), relativePath);
}
module.exports.readGameData = readGameData;

/**
 * Reads the Cloud data every game shares, reporting files that are missing.
 *
 * @param {object} workspace The workspace.
 * @param {Array<object>} diagnostics Diagnostics to append to.
 * @returns {Promise<Object<string, object>>} Each file's data, empty when missing.
 */
async function readSharedData(workspace, diagnostics)
{
    const shared = {};

    for (const [key, relativePath] of Object.entries(CLOUD_SHARED_FILES))
    {
        try
        {
            shared[key] = parseDataObject(await readOwnedFile(workspace, REPOSITORY_CLOUD, relativePath), relativePath);
        }
        catch (error)
        {
            if (error.code !== REPOSITORY_FILE_UNAVAILABLE)
                throw error;

            shared[key] = {};
            diagnostics.push({ severity: SEVERITY_WARNING, code: "CATALOG_FILE_MISSING", message: `${relativePath} could not be read, so constant names are shown instead.`, repository: REPOSITORY_CLOUD, file: relativePath });
        }
    }

    return shared;
}

/**
 * Turns a constant into a readable name, such as MOVE_THUNDERPUNCH into Thunderpunch.
 *
 * @param {string} symbol The constant.
 * @param {string} prefix The constant's prefix.
 * @returns {string} The name.
 */
function toDisplayName(symbol, prefix)
{
    const name = symbol.startsWith(prefix) ? symbol.slice(prefix.length) : symbol;
    return name.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * Returns the constants a game data file lists as available.
 *
 * @param {object} data The data file.
 * @returns {Array<string>} The constants.
 */
function getAvailable(data)
{
    return Object.keys(data).filter((key) => data[key] !== false);
}

/**
 * Returns a short list of examples for a diagnostic.
 *
 * @param {Iterable<string>} values The values.
 * @returns {string} The first few, comma separated.
 */
function formatExamples(values)
{
    return [...values].slice(0, EXAMPLE_COUNT).join(", ");
}

/**
 * Returns a species' sprites: DPE's own when it draws the species, otherwise PokeAPI's or Cloud's.
 *
 * @param {string} symbol The SPECIES_* constant.
 * @param {object} spriteInfo What is known about the species, for getSpeciesSprites.
 * @param {object} context Sprite lookups: the workspace, DPE's sprite files, the PokeAPI index and Cloud images.
 * @returns {object} The sprites, with the others as a fallback when DPE's are used.
 */
function getSprites(symbol, spriteInfo, { workspace, dpeSprites, index, images })
{
    const other = getSpeciesSprites(symbol, spriteInfo, { index, images });
    const dpe = getDpeSpriteUrls(workspace, dpeSprites, symbol);
    if (dpe == null)
        return other;

    return { normal: dpe.normal, shiny: dpe.shiny ?? other.shiny, fallback: { normal: other.normal, shiny: other.shiny }, source: SPRITE_SOURCE_DPE, exact: true };
}

/**
 * Builds the game's species with their stats, types, abilities, names and sprites.
 *
 * @param {object} baseStats The game's BaseStats.json.
 * @param {object} shared The shared Cloud data.
 * @param {object} context Sprite lookups: the workspace, DPE's sprite files, the PokeAPI index, Cloud images, Cloud
 *        icon names and whether the game uses Unbound's shiny colors.
 * @param {Array<object>} diagnostics Diagnostics to append to.
 * @returns {Object<string, object>} Species by constant.
 */
function buildSpecies(baseStats, shared, { iconNames, unboundGame, ...spriteContext }, diagnostics)
{
    const species = {};
    const incomplete = [];

    for (const symbol of getAvailable(baseStats).filter((key) => key !== SPECIES_NONE))
    {
        // Values that are missing or malformed stay unknown rather than becoming zero
        const entry = baseStats[symbol] !== null && typeof baseStats[symbol] === "object" ? baseStats[symbol] : {};
        const stats = Object.fromEntries(Object.entries(STAT_KEYS).map(([stat, key]) =>
            [stat, Number.isInteger(entry[key]) && entry[key] >= 0 && entry[key] <= MAX_BASE_STAT ? entry[key] : null]));
        const types = TYPE_KEYS.map((key) => (typeof entry[key] === "string" ? entry[key] : null));
        const abilities = ABILITY_KEYS.map((key) => (typeof entry[key] === "string" && entry[key] !== ABILITY_NONE ? entry[key] : null));
        if (Object.values(stats).includes(null) || types.includes(null) || ABILITY_KEYS.some((key) => typeof entry[key] !== "string"))
            incomplete.push(symbol);

        const dex = typeof shared.speciesDex[symbol] === "string" ? shared.speciesDex[symbol] : null;
        const dexNumber = dex != null && Number.isInteger(Number(shared.dexNumbers[dex])) ? Number(shared.dexNumbers[dex]) : null;
        const name = typeof shared.speciesNames[symbol] === "string" ? shared.speciesNames[symbol] : toDisplayName(symbol, SYMBOL_PREFIXES.species);
        const spriteInfo = { dex, dexNumber, iconName: iconNames[symbol], customShiny: unboundGame && shared.unboundShinies[symbol] === true };

        species[symbol] =
        {
            name,
            showdownName: typeof shared.showdownNames[symbol] === "string" ? shared.showdownNames[symbol] : name,
            dex,
            dexNumber,
            baseStats: stats,
            types,
            abilities,
            icon: getSpeciesIcon(symbol, iconNames[symbol]),
            sprite: getSprites(symbol, spriteInfo, spriteContext),
            megas: [],
            gigantamax: null,
        };
    }

    if (incomplete.length > 0)
        diagnostics.push({ severity: SEVERITY_WARNING, code: "CATALOG_SPECIES_INCOMPLETE", message: `${incomplete.length} species are missing base stats, types or abilities, which are shown as unknown. For example: ${formatExamples(incomplete)}.`, repository: REPOSITORY_CLOUD, details: incomplete });

    return species;
}

/**
 * Builds the game's moves, taking details from CFRU and only names and availability from Cloud.
 *
 * @param {object} gameMoves The game's Moves.json.
 * @param {Object<string, object>|null} localMoves CFRU's parsed gBattleMoves.
 * @param {object} shared The shared Cloud data.
 * @param {Array<object>} diagnostics Diagnostics to append to.
 * @returns {Object<string, object>} Moves by constant.
 */
function buildMoves(gameMoves, localMoves, shared, diagnostics)
{
    const moves = {};
    const missing = [];
    const differences = [];

    // MOVE_NONE is the empty move slot, not a move
    for (const symbol of getAvailable(gameMoves).filter((key) => key !== MOVE_NONE))
    {
        const local = localMoves?.[symbol] ?? null;
        const cloud = shared.moveData[symbol] ?? null;
        if (local == null)
            missing.push(symbol);
        else if (cloud != null)
        {
            for (const field of COMPARED_MOVE_FIELDS)
            {
                if (cloud[field] != null && local[field] != null && cloud[field] !== local[field])
                    differences.push(`${symbol} (${field} ${local[field]} in CFRU, ${cloud[field]} in Cloud)`);
            }
        }

        // Without CFRU's entry only Cloud's type, category and PP are known
        moves[symbol] =
        {
            name: typeof shared.moveNames[symbol] === "string" ? shared.moveNames[symbol] : toDisplayName(symbol, SYMBOL_PREFIXES.moves),
            type: local?.type ?? cloud?.type ?? null,
            split: local?.split ?? cloud?.split ?? null,
            pp: local?.pp ?? cloud?.pp ?? null,
            power: local?.power ?? null,
            zMovePower: local?.zMovePower ?? null,
            maxMovePower: local?.maxMovePower ?? null,
            accuracy: local?.accuracy ?? null,
            priority: local?.priority ?? null,
            target: local?.target ?? null,
            effect: local?.effect ?? null,
            secondaryEffectChance: local?.secondaryEffectChance ?? null,
            flags: local?.flags ?? null,
            local: local != null,
        };
    }

    if (missing.length > 0)
        diagnostics.push({ severity: SEVERITY_WARNING, code: "MOVE_DETAILS_MISSING", message: `${missing.length} moves in this game are not in CFRU's ${CFRU_MOVES_FILE}, so their power and accuracy are unknown. For example: ${formatExamples(missing)}.`, repository: REPOSITORY_CFRU, file: CFRU_MOVES_FILE, details: missing });
    if (differences.length > 0)
        diagnostics.push({ severity: SEVERITY_WARNING, code: "MOVE_DATA_MISMATCH", message: `${differences.length} move values differ between CFRU and Unbound Cloud; CFRU's values are used. For example: ${formatExamples(differences)}.`, repository: REPOSITORY_CFRU, file: CFRU_MOVES_FILE, details: differences });

    return moves;
}

/**
 * Counts the spread values that name constants the game does not have.
 *
 * @param {object|undefined} spreadState The workspace's spread state.
 * @param {object} catalog The catalog being built.
 * @returns {Object<string, Object<string, number>>} For each kind of constant, how many spreads use each unknown one.
 */
function findUnresolvedSymbols(spreadState, catalog)
{
    const unresolved = Object.fromEntries(Object.keys(UNRESOLVED_LABELS).map((kind) => [kind, {}]));
    const check = (kind, value) =>
    {
        // Numbers are raw values such as an omitted field's 0, not constant names
        if (typeof value === "string" && !Object.hasOwn(catalog[kind], value))
            unresolved[kind][value] = (unresolved[kind][value] ?? 0) + 1;
    };

    for (const { model } of spreadState?.entries.values() ?? [])
    {
        const { fields } = model;
        check("species", fields.species);
        check("items", fields.item);
        check("balls", fields.ball);
        check("natures", fields.nature);
        new Set(fields.moves).forEach((move) => check("moves", move));
    }

    return unresolved;
}

/**
 * Creates a catalog loader.
 *
 * @param {object} [options] Loader options.
 * @param {object} [options.cache] The parse cache.
 * @param {object} [options.pokeApi] The PokeAPI index loader.
 * @returns {{loadGameCatalog: Function}} The loader.
 */
function createCatalogService({ cache = createParseCache(), pokeApi = createPokeApiIndex() } = {})
{
    /**
     * Loads CFRU's move details, reusing the cached parse while the file and configuration are unchanged.
     *
     * @param {object} workspace The workspace.
     * @returns {Promise<{moves: Object<string, object>|null, macros: Map<string, object>, diagnostics: Array<object>}>}
     *          The move details, the configuration macros and diagnostics.
     */
    async function loadBattleMoves(workspace)
    {
        const [configText, movesText] = await Promise.all([CFRU_CONFIG_FILE, CFRU_MOVES_FILE].map((file) => readOwnedFile(workspace, REPOSITORY_CFRU, file)));
        const { macros } = evaluatePreprocessor(configText);
        const slot = `${getRootKey(workspace, REPOSITORY_CFRU)}\n${CFRU_MOVES_FILE}`;
        const inputs = [getParserVersion(), hash(movesText), hashMacros(macros)];
        const parsed = await cache.getOrCreate(CACHE_BATTLE_MOVES, slot, inputs, () => parseBattleMoves(movesText, macros));

        return { moves: parsed.moves, macros, diagnostics: parsed.diagnostics.map((diagnostic) => ({ ...diagnostic, repository: REPOSITORY_CFRU, file: CFRU_MOVES_FILE })) };
    }

    /**
     * Loads CFRU's item kinds, which are optional because only filters use them.
     *
     * @param {object} workspace The workspace.
     * @param {Map<string, object>} macros The configuration macros.
     * @returns {Promise<{itemTypes: Object<string, string>|null, diagnostics: Array<object>}>} Each item's
     *          ITEM_TYPE_* constant, or null when it cannot be read, and diagnostics.
     */
    async function loadItemTypes(workspace, macros)
    {
        const withFile = (diagnostics) => diagnostics.map((diagnostic) => ({ ...diagnostic, repository: REPOSITORY_CFRU, file: CFRU_ITEM_TABLES_FILE }));
        let text;
        try
        {
            text = await readOwnedFile(workspace, REPOSITORY_CFRU, CFRU_ITEM_TABLES_FILE);
        }
        catch (error)
        {
            if (error.code !== REPOSITORY_FILE_UNAVAILABLE)
                throw error;

            return { itemTypes: null, diagnostics: withFile([{ severity: SEVERITY_WARNING, code: "ITEM_TYPES_UNAVAILABLE", message: `${CFRU_ITEM_TABLES_FILE} could not be read, so Z-Crystals cannot be filtered.` }]) };
        }

        const slot = `${getRootKey(workspace, REPOSITORY_CFRU)}\n${CFRU_ITEM_TABLES_FILE}`;
        const parsed = await cache.getOrCreate(CACHE_ITEM_TYPES, slot, [getParserVersion(), hash(text), hashMacros(macros)], () => parseItemTypes(text, macros));
        return { itemTypes: parsed.itemTypes, diagnostics: withFile(parsed.diagnostics) };
    }

    /**
     * Loads the catalog for one of the workspace's games.
     *
     * @param {object} workspace The workspace.
     * @param {*} gameId The requested game ID.
     * @returns {Promise<object>} The catalog.
     */
    async function loadGameCatalog(workspace, gameId)
    {
        const game = getGame(workspace, gameId);

        // The game's own data files must all be valid
        const data = {};
        const entryCounts = {};
        for (const key of Object.keys(game.dataFiles))
        {
            data[key] = await readGameData(workspace, game.id, key);
            entryCounts[key] = Object.keys(data[key]).length;
        }

        const diagnostics = [];
        const shared = await readSharedData(workspace, diagnostics);
        const [battleMoves, dpe, index, images, dpeSprites] = await Promise.all(
            [loadBattleMoves(workspace), loadDpeData(workspace, cache), pokeApi.getIndex(), readCloudImages(workspace), loadSpriteTables(workspace, cache)]);
        const itemTypes = await loadItemTypes(workspace, battleMoves.macros);
        diagnostics.push(...battleMoves.diagnostics, ...itemTypes.diagnostics, ...dpe.diagnostics, ...dpeSprites.diagnostics);
        if (index == null)
            diagnostics.push({ severity: SEVERITY_WARNING, code: "SPRITES_OFFLINE", message: "PokeAPI could not be reached, so some forms may show their base form's sprite." });

        // Species and moves, then everything else a spread can name
        const spriteContext = { workspace, dpeSprites: dpeSprites.sprites, index, images, iconNames: workspace.speciesIconNames ?? {}, unboundGame: UNBOUND_GAME_PATTERN.test(game.id) };
        const species = buildSpecies(data[BASE_STATS_KEY], shared, spriteContext, diagnostics);
        const moves = buildMoves(data[MOVES_KEY], battleMoves.moves, shared, diagnostics);
        const items = Object.fromEntries(getAvailable(data[ITEMS_KEY]).map((item) =>
        {
            const itemName = shared.itemNames[item];
            return [item,
            {
                name: typeof itemName?.name === "string" ? itemName.name : toDisplayName(item, SYMBOL_PREFIXES.items),
                icon: getItemIcon(item, itemName, images),
                itemType: itemTypes.itemTypes?.[item] ?? null,
            }];
        }));
        const balls = Object.fromEntries(getAvailable(data[BALL_TYPES_KEY]).map((ball) =>
        {
            const name = typeof shared.ballNames[ball] === "string" ? shared.ballNames[ball] : toDisplayName(ball, SYMBOL_PREFIXES.balls);
            return [ball, { name, icon: getBallIcon(name) }];
        }));

        // CFRU picks a random ball for this value, so it has no icon of its own
        balls[BALL_TYPE_RANDOM] = { name: BALL_TYPE_RANDOM_NAME, icon: null };
        const types = Object.fromEntries(Object.entries(shared.typeNames).map(([type, name]) => [type, { name, icon: getTypeIcon(name, index), symbol: getTypeSymbol(name) }]));

        // Learnsets and battle forms come from DPE, applied to this game's species
        const speciesInfo = Object.fromEntries(Object.entries(species).map(([symbol, { types: speciesTypes, dex }]) => [symbol, { types: speciesTypes, dex }]));
        const learnsets = buildLearnsets({ dpe, species: speciesInfo, moveNames: shared.moveNames, gameMoves: Object.keys(moves), cfruMacros: battleMoves.macros });
        const battleForms = buildBattleForms(dpe.evolutions, new Set(Object.keys(species)));
        for (const [symbol, forms] of Object.entries(battleForms.forms))
            Object.assign(species[symbol], forms);
        diagnostics.push(...learnsets.diagnostics, ...battleForms.diagnostics);
        entryCounts.learnsets = Object.values(learnsets.learnsets).filter((learnset) => learnset.status === LEARNSET_COMPLETE).length;

        const catalog =
        {
            gameId: game.id,
            name: game.name,
            entryCounts,
            species,
            learnsets: learnsets.learnsets,
            moves,
            items,
            balls,
            abilities: shared.abilityNames,
            natures: shared.natureNames,
            types,
            assets: { gigantamax: getGigantamaxIcon(images) },
        };

        // Spreads naming constants this game does not have are reported, never matched to something similar
        catalog.unresolved = findUnresolvedSymbols(workspace.spreads, catalog);
        for (const [kind, counts] of Object.entries(catalog.unresolved))
        {
            const symbols = Object.keys(counts);
            const spreadCount = Object.values(counts).reduce((sum, count) => sum + count, 0);
            if (symbols.length > 0)
                diagnostics.push({ severity: SEVERITY_WARNING, code: "UNRESOLVED_SYMBOL", message: `${spreadCount} spreads use ${symbols.length} ${UNRESOLVED_LABELS[kind]} that ${game.name} does not have: ${formatExamples(symbols)}.`, details: symbols.map((symbol) => `${symbol} (${counts[symbol]} spreads)`) });
        }

        catalog.diagnostics = diagnostics;
        return catalog;
    }

    return { loadGameCatalog };
}
module.exports.createCatalogService = createCatalogService;

const defaultService = createCatalogService();

/**
 * Loads the catalog for one of the workspace's games with the default loader.
 *
 * @param {object} workspace The workspace.
 * @param {*} gameId The requested game ID.
 * @returns {Promise<object>} The catalog.
 */
function loadGameCatalog(workspace, gameId)
{
    return defaultService.loadGameCatalog(workspace, gameId);
}
module.exports.loadGameCatalog = loadGameCatalog;
