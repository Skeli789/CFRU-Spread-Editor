/**
 * Catalog, spreads snapshot and mocked server shared by the editor's frontend tests.
 * They follow the shapes the local server returns.
 */

import axios from "axios";

export const PATHS = { cfru: "C:\\Code\\CFRU", dpe: "C:\\Code\\DPE", cloud: "C:\\Code\\Cloud" };
export const GAMES = [{ id: "cfru", name: "Official Games" }, { id: "unbound", name: "Unbound" }];
export const CATALOG_ROUTE = "/workspaces/:id/catalog";
export const SAVE_ROUTE = "/workspaces/:id/save";
export const ARCHIVE_ROUTE = "/workspaces/:id/archive";

const BATTLE_TOWER_FILE = "src/Tables/battle_tower_spreads.h";
const SPECIAL_FILE = "src/Tables/frontier_special_trainer_spreads.h";
export const FRONTIER_SET = `${BATTLE_TOWER_FILE}#gFrontierSpreads`;
export const LITTLE_CUP_SET = `${BATTLE_TOWER_FILE}#gLittleCupSpreads`;
export const PALMER_SET = `${SPECIAL_FILE}#gSpecialTowerSpread_Palmer1`;
export const PALMER_TRAINER = "src/Tables/battle_frontier_trainers.c#gFrontierBrains[0]";

const LEARN_LEVEL = ["level"];


/**
 * Returns a catalog species.
 *
 * @param {string} name The name.
 * @param {Array<number>} stats HP, Attack, Defense, Sp. Atk, Sp. Def and Speed.
 * @param {Array<string>} types The types.
 * @param {Array<string|null>} abilities The hidden, first and second abilities.
 * @param {object} [extra] Mega Evolutions and Gigantamax.
 * @returns {object} The species.
 */
function species(name, stats, types, abilities, extra = {})
{
    const [hp, atk, def, spAtk, spDef, spd] = stats;
    return {
        name,
        showdownName: name,
        dex: null,
        dexNumber: null,
        baseStats: { hp, atk, def, spAtk, spDef, spd },
        types,
        abilities,
        sprite: { normal: null, shiny: null, fallback: null, source: "pokeapi", exact: true },
        megas: [],
        gigantamax: null,
        ...extra,
    };
}

/**
 * Returns a catalog move, with made-up Z-Move and Max Move powers derived from its power.
 *
 * @param {string} name The name.
 * @param {string} type The type.
 * @param {string} split The category.
 * @param {number} power The power.
 * @param {number} accuracy The accuracy.
 * @param {number} pp The PP.
 * @param {string} [effect] The effect.
 * @param {string} [target] The target.
 * @returns {object} The move.
 */
function move(name, type, split, power, accuracy, pp, effect = "EFFECT_HIT", target = "MOVE_TARGET_SELECTED")
{
    return {
        name, type, split, pp, power, zMovePower: power * 2, maxMovePower: power + 40, accuracy, priority: 0, target, effect, secondaryEffectChance: 0,
        flags: [], local: true,
    };
}

/**
 * Returns a complete learnset.
 *
 * @param {Array<string>} moves The learnable moves.
 * @returns {object} The learnset.
 */
function learnset(moves)
{
    return { status: "complete", moves: Object.fromEntries(moves.map((name) => [name, LEARN_LEVEL])), unknown: {} };
}

/**
 * Returns a game catalog.
 *
 * @param {string} gameId The game ID.
 * @param {Array<object>} [diagnostics] The catalog diagnostics.
 * @returns {object} The catalog.
 */
export function createCatalog(gameId = "unbound", diagnostics = [])
{
    return {
        gameId,
        name: GAMES.find((game) => game.id === gameId).name,
        entryCounts: { baseStats: 7, moves: 15, items: 8, ballTypes: 3, learnsets: 3 },
        species:
        {
            SPECIES_CHARIZARD: species("Charizard", [78, 84, 78, 109, 85, 100], ["TYPE_FIRE", "TYPE_FLYING"], ["ABILITY_SOLARPOWER", "ABILITY_BLAZE", null],
            {
                megas:
                [
                    { species: "SPECIES_CHARIZARD_MEGA_X", item: "ITEM_CHARIZARDITE_X", variant: "MEGA_VARIANT_STANDARD", available: true },
                    { species: "SPECIES_CHARIZARD_MEGA_Y", item: "ITEM_CHARIZARDITE_Y", variant: "MEGA_VARIANT_STANDARD", available: true },
                ],
                gigantamax: { species: "SPECIES_CHARIZARD_GIGA", available: true },
            }),
            SPECIES_CHARIZARD_MEGA_X: species("Mega Charizard X", [78, 130, 111, 130, 85, 100], ["TYPE_FIRE", "TYPE_DRAGON"], [null, "ABILITY_TOUGHCLAWS", null]),
            SPECIES_CHARIZARD_MEGA_Y: species("Mega Charizard Y", [78, 104, 78, 159, 115, 100], ["TYPE_FIRE", "TYPE_FLYING"], [null, "ABILITY_DROUGHT", null]),
            SPECIES_VENUSAUR: species("Venusaur", [80, 82, 83, 100, 100, 80], ["TYPE_GRASS", "TYPE_POISON"], ["ABILITY_CHLOROPHYLL", "ABILITY_OVERGROW", null],
                { megas: [{ species: "SPECIES_VENUSAUR_MEGA", item: "ITEM_VENUSAURITE", variant: "MEGA_VARIANT_STANDARD", available: true }] }),
            SPECIES_VENUSAUR_MEGA: species("Mega Venusaur", [80, 100, 123, 122, 120, 80], ["TYPE_GRASS", "TYPE_POISON"], [null, "ABILITY_THICKFAT", null]),
            SPECIES_PICHU: species("Pichu", [20, 40, 15, 35, 35, 60], ["TYPE_ELECTRIC", "TYPE_ELECTRIC"], ["ABILITY_LIGHTNINGROD", "ABILITY_STATIC", null]),
            SPECIES_GARCHOMP: species("Garchomp", [108, 130, 95, 80, 85, 102], ["TYPE_DRAGON", "TYPE_GROUND"], ["ABILITY_ROUGHSKIN", "ABILITY_SANDVEIL", null]),
        },
        learnsets:
        {
            SPECIES_CHARIZARD: learnset(["MOVE_FLAMETHROWER", "MOVE_AIRSLASH", "MOVE_SCORCHINGSANDS", "MOVE_PROTECT", "MOVE_HIDDENPOWER", "MOVE_DRAGONCLAW", "MOVE_EARTHQUAKE"]),
            SPECIES_VENUSAUR: learnset(["MOVE_GIGADRAIN", "MOVE_SLUDGEBOMB", "MOVE_LEECHSEED", "MOVE_SYNTHESIS", "MOVE_PROTECT", "MOVE_HIDDENPOWER"]),
            SPECIES_PICHU: learnset(["MOVE_THUNDERBOLT", "MOVE_FAKEOUT", "MOVE_PROTECT", "MOVE_HIDDENPOWER"]),
        },
        moves:
        {
            MOVE_FLAMETHROWER: move("Flamethrower", "TYPE_FIRE", "SPLIT_SPECIAL", 90, 100, 15),
            MOVE_AIRSLASH: move("Air Slash", "TYPE_FLYING", "SPLIT_SPECIAL", 75, 95, 15),
            MOVE_SCORCHINGSANDS: move("Scorching Sands", "TYPE_GROUND", "SPLIT_SPECIAL", 70, 100, 10),
            MOVE_PROTECT: move("Protect", "TYPE_NORMAL", "SPLIT_STATUS", 0, 0, 10, "EFFECT_PROTECT", "MOVE_TARGET_USER"),
            MOVE_HIDDENPOWER: move("Hidden Power", "TYPE_NORMAL", "SPLIT_SPECIAL", 60, 100, 15),
            MOVE_DRAGONCLAW: move("Dragon Claw", "TYPE_DRAGON", "SPLIT_PHYSICAL", 80, 100, 15),
            MOVE_EARTHQUAKE: move("Earthquake", "TYPE_GROUND", "SPLIT_PHYSICAL", 100, 100, 10, "EFFECT_HIT", "MOVE_TARGET_FOES_AND_ALLY"),
            MOVE_GIGADRAIN: move("Giga Drain", "TYPE_GRASS", "SPLIT_SPECIAL", 75, 100, 10),
            MOVE_SLUDGEBOMB: move("Sludge Bomb", "TYPE_POISON", "SPLIT_SPECIAL", 90, 100, 10),
            MOVE_LEECHSEED: move("Leech Seed", "TYPE_GRASS", "SPLIT_STATUS", 0, 90, 10),
            MOVE_SYNTHESIS: move("Synthesis", "TYPE_GRASS", "SPLIT_STATUS", 0, 0, 5),
            MOVE_THUNDERBOLT: move("Thunderbolt", "TYPE_ELECTRIC", "SPLIT_SPECIAL", 90, 100, 15),
            MOVE_FAKEOUT: move("Fake Out", "TYPE_NORMAL", "SPLIT_PHYSICAL", 40, 100, 10),
            MOVE_FLY: move("Fly", "TYPE_FLYING", "SPLIT_PHYSICAL", 90, 95, 15),
            MOVE_GYROBALL: move("Gyro Ball", "TYPE_STEEL", "SPLIT_PHYSICAL", 1, 100, 5),
        },
        items:
        {
            ITEM_NONE: { name: "None", icon: null, itemType: null },
            ITEM_LEFTOVERS: { name: "Leftovers", icon: null, itemType: "ITEM_TYPE_HELD_ITEM" },
            ITEM_HEAVYDUTYBOOTS: { name: "Heavy-Duty Boots", icon: null, itemType: "ITEM_TYPE_HELD_ITEM" },
            ITEM_CHARIZARDITE_X: { name: "Charizardite X", icon: null, itemType: "ITEM_TYPE_MEGA_STONE" },
            ITEM_CHARIZARDITE_Y: { name: "Charizardite Y", icon: null, itemType: "ITEM_TYPE_MEGA_STONE" },
            ITEM_VENUSAURITE: { name: "Venusaurite", icon: null, itemType: "ITEM_TYPE_MEGA_STONE" },
            ITEM_FIRIUM_Z: { name: "Firium Z", icon: null, itemType: "ITEM_TYPE_Z_CRYSTAL" },
            ITEM_LIFEORB: { name: "Life Orb", icon: null, itemType: "ITEM_TYPE_HELD_ITEM" },
        },
        balls:
        {
            BALL_TYPE_MASTER_BALL: { name: "Master Ball", icon: null },
            BALL_TYPE_POKE_BALL: { name: "Poke Ball", icon: null },
            BALL_TYPE_RANDOM: { name: "Random", icon: null },
        },
        abilities:
        {
            ABILITY_NONE: "None", ABILITY_SOLARPOWER: "Solar Power", ABILITY_BLAZE: "Blaze", ABILITY_TOUGHCLAWS: "Tough Claws", ABILITY_DROUGHT: "Drought",
            ABILITY_CHLOROPHYLL: "Chlorophyll", ABILITY_OVERGROW: "Overgrow", ABILITY_THICKFAT: "Thick Fat", ABILITY_LIGHTNINGROD: "Lightning Rod",
            ABILITY_STATIC: "Static", ABILITY_ROUGHSKIN: "Rough Skin", ABILITY_SANDVEIL: "Sand Veil",
        },
        natures: { NATURE_HARDY: "Hardy", NATURE_ADAMANT: "Adamant", NATURE_BOLD: "Bold", NATURE_TIMID: "Timid", NATURE_MODEST: "Modest" },
        types: Object.fromEntries(["NORMAL", "FIRE", "FLYING", "GROUND", "DRAGON", "GRASS", "POISON", "ELECTRIC", "STEEL", "ICE", "FIGHTING", "PSYCHIC"]
            .map((type) => [`TYPE_${type}`, { name: type.charAt(0) + type.slice(1).toLowerCase(), icon: null, symbol: null }])),
        assets: { gigantamax: null },
        unresolved: {},
        diagnostics,
    };
}

/**
 * Returns spread values, starting from a Charizard with no EVs.
 *
 * @param {object} [overrides] Values to change.
 * @returns {object} The values.
 */
export function createFields(overrides = {})
{
    return {
        species: "SPECIES_CHARIZARD",
        nature: "NATURE_MODEST",
        hpIv: 31, atkIv: 31, defIv: 31, spAtkIv: 31, spDefIv: 31, spdIv: 31,
        hpEv: 0, atkEv: 0, defEv: 0, spAtkEv: 0, spDefEv: 0, spdEv: 0,
        ability: 1,
        item: "ITEM_HEAVYDUTYBOOTS",
        moves: ["MOVE_FLAMETHROWER", "MOVE_AIRSLASH", "MOVE_SCORCHINGSANDS", "MOVE_PROTECT"],
        ball: "BALL_TYPE_RANDOM",
        shiny: false,
        forSingles: true,
        forDoubles: true,
        modifyMovesDoubles: true,
        gigantamax: false,
        specificTeamType: 0,
        ...overrides,
    };
}

/**
 * Returns a spread entry.
 *
 * @param {string} id The ID.
 * @param {string} setId The set.
 * @param {number} line The source line.
 * @param {object} fields The values.
 * @param {object} [extra] Other entry properties.
 * @returns {object} The entry.
 */
function entry(id, setId, line, fields, extra = {})
{
    return {
        id, setId, line, segment: 0, fields, explicitFields: Object.keys(fields), rawFields: {}, unknownFields: [], abilityComment: null,
        hiddenPowerComments: [null, null, null, null], editable: true, diagnostics: [], ...extra,
    };
}

/**
 * Returns a spread set.
 *
 * @param {string} id The ID.
 * @param {string} file The file.
 * @param {string} category The source family.
 * @param {Array<string>} entryIds The entries.
 * @param {object} [extra] Other set properties.
 * @returns {object} The set.
 */
function set(id, file, category, entryIds, extra = {})
{
    return {
        id, name: id.split("#")[1], file, category, line: 1, isStatic: false, branch: [], littleCup: false, usages: [], entryIds, placeholderCount: 0,
        canEdit: true, canReorder: true, canInsert: true, insertBlockedReason: null, diagnostics: [], ...extra,
    };
}

/**
 * Returns a spreads snapshot covering battle tower, Little Cup and special trainer spreads.
 *
 * @param {string} [revision] The revision.
 * @returns {object} The spreads.
 */
export function createSpreads(revision = "revision-1")
{
    const entries =
    [
        entry("e0", FRONTIER_SET, 10, createFields({ hpEv: 4, spAtkEv: 252, spdEv: 252 })),
        entry("e1", FRONTIER_SET, 30, createFields(
        {
            species: "SPECIES_VENUSAUR", nature: "NATURE_BOLD", ability: 0, item: "ITEM_VENUSAURITE", moves: ["MOVE_GIGADRAIN", "MOVE_SLUDGEBOMB", "MOVE_LEECHSEED", "MOVE_SYNTHESIS"],
            forSingles: false, forDoubles: true, modifyMovesDoubles: false, specificTeamType: 1,
        })),
        entry("e2", FRONTIER_SET, 50, createFields(
        {
            nature: "NATURE_ADAMANT", item: "ITEM_CHARIZARDITE_X", moves: ["MOVE_DRAGONCLAW", "MOVE_FLY", "MOVE_EARTHQUAKE", 0], forSingles: false, forDoubles: true,
            modifyMovesDoubles: false, shiny: true,
        })),
        entry("e3", LITTLE_CUP_SET, 70, createFields(
        {
            species: "SPECIES_PICHU", nature: "NATURE_TIMID", item: "ITEM_LIFEORB", moves: ["MOVE_THUNDERBOLT", "MOVE_FAKEOUT", "MOVE_PROTECT", 0],
            forSingles: true, forDoubles: false, modifyMovesDoubles: true,
        })),
        entry("e4", PALMER_SET, 12, createFields(
        {
            species: "SPECIES_GARCHOMP", nature: "NATURE_ADAMANT", ability: 1, item: "ITEM_FIRIUM_Z", moves: ["MOVE_EARTHQUAKE", "MOVE_DRAGONCLAW", "MOVE_PROTECT", "MOVE_FLAMETHROWER"],
            gigantamax: true,
        })),
        entry("e5", PALMER_SET, 32, createFields({ item: "ITEM_CHARIZARDITE_Y", ball: "BALL_TYPE_POKE_BALL" }), { editable: false }),
    ];

    return {
        revision,
        configuration: { file: "src/config.h", defines: ["UNBOUND"] },
        files: [BATTLE_TOWER_FILE, SPECIAL_FILE].map((path) => ({ path, editable: true, bom: false, lineEnding: "CRLF" })),
        sets:
        [
            set(FRONTIER_SET, BATTLE_TOWER_FILE, "battleTower", ["e0", "e1", "e2"]),
            set(LITTLE_CUP_SET, BATTLE_TOWER_FILE, "battleTower", ["e3"], { littleCup: true }),
            set(PALMER_SET, SPECIAL_FILE, "specialTrainer", ["e4", "e5"],
            {
                usages: [{ trainerId: PALMER_TRAINER, trainerName: "Palmer", table: "gFrontierBrains", kind: "specialTrainer", role: "regular", ranks: null, sizeExpression: "NELEMS(gSpecialTowerSpread_Palmer1)" }],
            }),
        ],
        entries,
        trainers: [{ id: PALMER_TRAINER, file: "src/Tables/battle_frontier_trainers.c", table: "gFrontierBrains", kind: "specialTrainer", name: "Palmer", line: 5, links: [{ role: "regular", setId: PALMER_SET, ranks: null }] }],
        teamTypes: [{ name: "DOUBLES_ANY_TEAM", value: 0 }, { name: "DOUBLES_SUN_TEAM", value: 1 }, { name: "DOUBLES_TRICK_ROOM_TEAM", value: 7 }],
    };
}

/**
 * Returns a workspace snapshot like the server's.
 *
 * @param {string} [workspaceId] The workspace ID.
 * @param {object} [spreads] The spreads snapshot.
 * @returns {object} The workspace.
 */
export function createWorkspace(workspaceId = "workspace-1", spreads = createSpreads())
{
    return {
        workspaceId,
        repositories: Object.fromEntries(Object.entries(PATHS).map(([kind, path]) => [kind, { path, label: `${kind} label` }])),
        games: GAMES,
        diagnostics: [],
        spreads,
    };
}

/**
 * Creates an axios-style error response.
 *
 * @param {number} status The HTTP status.
 * @param {string} code The error code.
 * @param {string} message The error message.
 * @param {object} [details] The error details.
 * @returns {object} The error.
 */
export function apiError(status, code, message, details)
{
    return { response: { status, data: { error: { code, message, details } } } };
}

/**
 * Routes mocked axios requests to handlers, recording each call. axios must be mocked by the test file.
 *
 * @param {Object<string, Function>} [overrides] Handlers replacing the defaults.
 * @returns {Array<{route: string, body: object, token: string, options: object}>} The recorded calls.
 */
export function mockServer(overrides = {})
{
    const calls = [];
    const handlers =
    {
        "/session": () => ({ token: "token-1" }),
        "/workspaces/load": () => createWorkspace(),
        [CATALOG_ROUTE]: (body) => createCatalog(body.gameId),
        [SAVE_ROUTE]: () => ({ spreads: createSpreads("revision-2"), createdIds: {}, files: [], backupId: "backup-1" }),
        [ARCHIVE_ROUTE]: () => new Blob(["ZIP"], { type: "application/zip" }),
        "/progress/:id": () => ({ percentage: 0, label: "Checking repositories...", status: "running" }),
        "/repositories/pick": () => ({ status: "cancelled" }),
        ...overrides,
    };

    axios.post.mockImplementation(async (url, body, options) =>
    {
        const route = url.replace(/^.*\/api/, "");
        const handlerRoute = route.replace(/^\/workspaces\/[^/]+\/(catalog|save|archive)$/, "/workspaces/:id/$1")
            .replace(/^\/progress\/[^/]+$/, "/progress/:id");
        const token = options?.headers?.["X-Session-Token"];
        calls.push({ route, body, token, options, params: options?.params });
        return { data: await handlers[handlerRoute](body, token, options) };
    });

    return calls;
}
