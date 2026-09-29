/**
 * Pokemon mechanics shared by the editor page and the local server: final stats, EV stepping,
 * abilities, Hidden Power and which attacking IVs a spread needs.
 * This module must stay free of browser and Node APIs.
 */

import { getMegaEvolutions } from "./catalog.mjs";

// Stat keys match the catalog's base stats, where spd is Speed
export const STATS = ["hp", "atk", "def", "spAtk", "spDef", "spd"];
export const IV_FIELDS = { hp: "hpIv", atk: "atkIv", def: "defIv", spAtk: "spAtkIv", spDef: "spDefIv", spd: "spdIv" };
export const EV_FIELDS = { hp: "hpEv", atk: "atkEv", def: "defEv", spAtk: "spAtkEv", spDef: "spDefEv", spd: "spdEv" };
const STAT_HP = "hp";
const STAT_ATK = "atk";
const STAT_SP_ATK = "spAtk";

export const MAX_IV = 31;
export const MAX_EV = 252;
export const MAX_EV_TOTAL = 510;
export const EV_STEP = 4;

export const LITTLE_CUP_LEVEL = 5;
export const PREVIEW_LEVELS = [50, 100];
export const DEFAULT_PREVIEW_LEVEL = 50;

const SPECIES_SHEDINJA = "SPECIES_SHEDINJA";
const SHEDINJA_HP = 1;
const HP_LEVEL_BONUS = 10;
const STAT_BONUS = 5;
const PERCENT = 100;
const NATURE_BOOST_PERCENT = 110;
const NATURE_DROP_PERCENT = 90;

// CFRU's nature order: each nature raises NATURE_STATS[index / 5] and lowers NATURE_STATS[index % 5]
const NATURES =
[
    "NATURE_HARDY", "NATURE_LONELY", "NATURE_BRAVE", "NATURE_ADAMANT", "NATURE_NAUGHTY",
    "NATURE_BOLD", "NATURE_DOCILE", "NATURE_RELAXED", "NATURE_IMPISH", "NATURE_LAX",
    "NATURE_TIMID", "NATURE_HASTY", "NATURE_SERIOUS", "NATURE_JOLLY", "NATURE_NAIVE",
    "NATURE_MODEST", "NATURE_MILD", "NATURE_QUIET", "NATURE_BASHFUL", "NATURE_RASH",
    "NATURE_CALM", "NATURE_GENTLE", "NATURE_SASSY", "NATURE_CAREFUL", "NATURE_QUIRKY",
];
const NATURE_STATS = ["atk", "def", "spd", "spAtk", "spDef"];

// Indexed by FRONTIER_ABILITY_HIDDEN, FRONTIER_ABILITY_1 and FRONTIER_ABILITY_2
export const ABILITY_SLOTS = { HIDDEN: 0, FIRST: 1, SECOND: 2 };
const ABILITY_SLOT_ORDER = [ABILITY_SLOTS.FIRST, ABILITY_SLOTS.SECOND, ABILITY_SLOTS.HIDDEN];
const ABILITY_SLOT_LABELS = { [ABILITY_SLOTS.HIDDEN]: "[H]", [ABILITY_SLOTS.FIRST]: "[1]", [ABILITY_SLOTS.SECOND]: "[2]" };

export const MOVE_HIDDEN_POWER = "MOVE_HIDDENPOWER";
// Moves that work better the slower the user is
const SLOW_SPEED_MOVES = new Set(["MOVE_GYROBALL", "MOVE_TRICKROOM"]);
const MOVE_NONE = "MOVE_NONE";

// Hidden Power types in the order the IV formula selects them, which is not CFRU's type order
export const HIDDEN_POWER_TYPES =
[
    "TYPE_FIGHTING", "TYPE_FLYING", "TYPE_POISON", "TYPE_GROUND",
    "TYPE_ROCK", "TYPE_BUG", "TYPE_GHOST", "TYPE_STEEL",
    "TYPE_FIRE", "TYPE_WATER", "TYPE_GRASS", "TYPE_ELECTRIC",
    "TYPE_PSYCHIC", "TYPE_ICE", "TYPE_DRAGON", "TYPE_DARK",
];

// Each IV's parity bit, in the order the formula weighs them
const HIDDEN_POWER_IV_ORDER = ["hpIv", "atkIv", "defIv", "spdIv", "spAtkIv", "spDefIv"];
const HIDDEN_POWER_MAX_SUM = 63;
const HIDDEN_POWER_TYPE_STEPS = 15;
const HIDDEN_POWER_MASKS = 1 << HIDDEN_POWER_IV_ORDER.length;

// IVs of 0 or 1 are kept low on purpose, such as a minimized Attack
const LOW_IV_MAX = 1;
const SPEED_IV = "spdIv";

// Showdown's standard Hidden Power IVs, as the IVs it makes even; ties between equally good IVs follow these
const SHOWDOWN_HIDDEN_POWER_EVEN_IVS =
{
    TYPE_FIGHTING: ["defIv", "spAtkIv", "spDefIv", "spdIv"],
    TYPE_FLYING: ["hpIv", "atkIv", "defIv", "spAtkIv", "spDefIv"],
    TYPE_POISON: ["defIv", "spAtkIv", "spDefIv"],
    TYPE_GROUND: ["spAtkIv", "spDefIv"],
    TYPE_ROCK: ["defIv", "spDefIv", "spdIv"],
    TYPE_BUG: ["atkIv", "defIv", "spDefIv"],
    TYPE_GHOST: ["defIv", "spDefIv"],
    TYPE_STEEL: ["spDefIv"],
    TYPE_FIRE: ["atkIv", "spAtkIv", "spdIv"],
    TYPE_WATER: ["atkIv", "defIv", "spAtkIv"],
    TYPE_GRASS: ["atkIv", "spAtkIv"],
    TYPE_ELECTRIC: ["spAtkIv"],
    TYPE_PSYCHIC: ["atkIv", "spdIv"],
    TYPE_ICE: ["atkIv", "defIv"],
    TYPE_DRAGON: ["atkIv"],
    TYPE_DARK: [],
};

// Breaks any remaining ties by lowering the least useful stats first
const HIDDEN_POWER_SACRIFICE_WEIGHTS = { atkIv: 1, spAtkIv: 2, defIv: 4, spDefIv: 8, hpIv: 16, spdIv: 32 };

export const STAT_USE =
{
    USED: "used",
    UNUSED: "unused",
    UNKNOWN: "unknown",
};

const SPLIT_PHYSICAL = "SPLIT_PHYSICAL";
const SPLIT_SPECIAL = "SPLIT_SPECIAL";
const SPLIT_STATUS = "SPLIT_STATUS";
const POWER_NONE = 0;
const POWER_VARIABLE = 1;

// Moves whose damage ignores the user's attacking stats
const FIXED_DAMAGE_EFFECTS = new Set(
[
    "EFFECT_BIDE", "EFFECT_0HKO", "EFFECT_SUPER_FANG", "EFFECT_DRAGON_RAGE", "EFFECT_LEVEL_DAMAGE",
    "EFFECT_PSYWAVE", "EFFECT_COUNTER", "EFFECT_MIRROR_COAT", "EFFECT_SONICBOOM", "EFFECT_ENDEAVOR",
    // Final Gambit shares Memento's effect
    "EFFECT_MEMENTO",
]);

// Foul Play uses the target's Attack and Body Press uses the user's Defense
const OTHER_STAT_MOVES = new Set(["MOVE_FOULPLAY", "MOVE_BODYPRESS"]);

// CFRU picks these moves' category from the user's higher attacking stat
const SPLIT_CHANGING_MOVES = new Set(["MOVE_PHOTONGEYSER", "MOVE_LIGHT_THAT_BURNS_THE_SKY", "MOVE_SHELLSIDEARM"]);

const AUTO_FIX_STATS = [STAT_ATK, STAT_SP_ATK];


/**
 * Returns the stats a nature raises and lowers.
 *
 * @param {string} nature The NATURE_* constant.
 * @returns {{increased: string|null, decreased: string|null}|null} The changed stats, both null for a neutral
 *          nature, or null for an unknown nature.
 */
export function getNatureEffect(nature)
{
    const index = NATURES.indexOf(nature);
    if (index < 0)
        return null;

    const increased = NATURE_STATS[Math.floor(index / NATURE_STATS.length)];
    const decreased = NATURE_STATS[index % NATURE_STATS.length];
    return increased === decreased ? { increased: null, decreased: null } : { increased, decreased };
}

/**
 * Calculates one final stat the way CFRU's CalculateMonStatsNew does.
 *
 * @param {object} input The stat's inputs.
 * @param {string} input.stat The stat key.
 * @param {number|null} input.baseStat The species' base stat, or null when unknown.
 * @param {number} input.iv The IV.
 * @param {number} input.ev The EV.
 * @param {number} input.level The level.
 * @param {string} input.nature The NATURE_* constant.
 * @param {string} input.species The SPECIES_* constant.
 * @returns {number|null} The stat, or null when the base stat is unknown.
 */
export function calculateStat({ stat, baseStat, iv, ev, level, nature, species })
{
    if (stat === STAT_HP && species === SPECIES_SHEDINJA)
        return SHEDINJA_HP;
    if (baseStat == null)
        return null;

    const base = Math.floor((2 * baseStat + iv + Math.floor(ev / EV_STEP)) * level / PERCENT);
    if (stat === STAT_HP)
        return base + level + HP_LEVEL_BONUS;

    const value = base + STAT_BONUS;
    const effect = getNatureEffect(nature);
    if (effect?.increased === stat)
        return Math.floor(value * NATURE_BOOST_PERCENT / PERCENT);
    if (effect?.decreased === stat)
        return Math.floor(value * NATURE_DROP_PERCENT / PERCENT);

    return value;
}

/**
 * Calculates all of a spread's final stats.
 *
 * @param {string} species The SPECIES_* constant whose base stats are used.
 * @param {Object<string, number|null>|null} baseStats The species' base stats.
 * @param {object} fields The spread's values.
 * @param {number} level The level.
 * @returns {Object<string, number|null>} Each stat, null when its base stat is unknown.
 */
export function calculateStats(species, baseStats, fields, level)
{
    return Object.fromEntries(STATS.map((stat) => [stat, calculateStat(
    {
        stat,
        baseStat: baseStats?.[stat] ?? null,
        iv: fields[IV_FIELDS[stat]],
        ev: fields[EV_FIELDS[stat]],
        level,
        nature: fields.nature,
        species,
    })]));
}

/**
 * Returns the Mega Evolution a spread would use in battle, if the game has it.
 *
 * @param {object} catalog The game catalog.
 * @param {object} fields The spread's values.
 * @returns {string|null} The Mega species constant.
 */
export function getMegaSpecies(catalog, fields)
{
    const mega = getMegaEvolutions(catalog, fields.species, fields.item, fields.moves)
        .find((match) => match.available !== false && Object.hasOwn(catalog.species, match.species));
    return mega?.species ?? null;
}

/**
 * Calculates the stats shown for a spread, using its Mega Evolution's base stats when previewing it.
 * The stored species never changes.
 *
 * @param {object} catalog The game catalog.
 * @param {object} fields The spread's values.
 * @param {object} options The preview.
 * @param {number} options.level The level.
 * @param {boolean} [options.mega] Whether to preview the Mega Evolution.
 * @returns {{species: string, mega: boolean, stats: Object<string, number|null>}} The species used and its stats.
 */
export function calculateSpreadStats(catalog, fields, { level, mega = true })
{
    const megaSpecies = mega ? getMegaSpecies(catalog, fields) : null;
    const species = megaSpecies ?? fields.species;
    const baseStats = Object.hasOwn(catalog.species, species) ? catalog.species[species].baseStats : null;
    return { species, mega: megaSpecies != null, stats: calculateStats(species, baseStats, fields, level) };
}

/**
 * Returns the level a spread's stats are shown at. Little Cup spreads are always level 5.
 *
 * @param {{littleCup: boolean}|null} set The spread's set.
 * @param {number} previewLevel The level chosen for every other spread.
 * @returns {number} The level.
 */
export function getSpreadLevel(set, previewLevel)
{
    return set?.littleCup ? LITTLE_CUP_LEVEL : previewLevel;
}

/**
 * Returns the sum of a spread's EVs.
 *
 * @param {object} fields The spread's values.
 * @returns {number} The total.
 */
export function getEvTotal(fields)
{
    return STATS.reduce((total, stat) => total + fields[EV_FIELDS[stat]], 0);
}

/**
 * Returns the most EVs one stat can have without the total going over 510.
 *
 * @param {object} fields The spread's values.
 * @param {string} stat The stat key.
 * @returns {number} The limit.
 */
export function getMaxEv(fields, stat)
{
    const others = getEvTotal(fields) - fields[EV_FIELDS[stat]];
    return Math.max(0, Math.min(MAX_EV, MAX_EV_TOTAL - others));
}

/**
 * Returns the EV an arrow press moves a stat to. Normally this is the next multiple of 4. For Little Cup
 * spreads it is the fewest EVs that change the final stat, preferring a 1 point change.
 *
 * @param {object} fields The spread's values.
 * @param {string} stat The stat key.
 * @param {number} direction 1 for up, -1 for down.
 * @param {object} [littleCup] Set for Little Cup spreads.
 * @param {string} littleCup.species The SPECIES_* constant whose base stats are used.
 * @param {Object<string, number|null>|null} littleCup.baseStats The species' base stats.
 * @param {number} [littleCup.level] The level.
 * @returns {number|null} The new EV, or null when the arrow can do nothing.
 */
export function stepEv(fields, stat, direction, littleCup = null)
{
    const current = fields[EV_FIELDS[stat]];
    const max = getMaxEv(fields, stat);
    const baseStat = littleCup?.baseStats?.[stat] ?? null;

    // Without a known base stat the final stat cannot guide the step
    if (littleCup == null || (baseStat == null && !(stat === STAT_HP && littleCup.species === SPECIES_SHEDINJA)))
    {
        if (direction > 0)
        {
            const next = (Math.floor(current / EV_STEP) + 1) * EV_STEP;
            return next <= max ? next : null;
        }

        return current > 0 ? Math.min((Math.ceil(current / EV_STEP) - 1) * EV_STEP, max) : null;
    }

    const statAt = (ev) => calculateStat(
    {
        stat,
        baseStat,
        iv: fields[IV_FIELDS[stat]],
        ev,
        level: littleCup.level ?? LITTLE_CUP_LEVEL,
        nature: fields.nature,
        species: littleCup.species,
    });
    const currentStat = statAt(current);

    // Stats only change at multiples of 4, so the first one that raises the stat gives the smallest increase
    if (direction > 0)
    {
        for (let ev = (Math.floor(current / EV_STEP) + 1) * EV_STEP; ev <= max; ev += EV_STEP)
        {
            if (statAt(ev) > currentStat)
                return ev;
        }

        return null;
    }

    if (current <= 0)
        return null;

    let lower = (Math.ceil(current / EV_STEP) - 1) * EV_STEP;
    while (lower > 0 && statAt(lower) >= currentStat)
        lower -= EV_STEP;

    // At the lowest possible stat the leftover EVs are cleared
    const lowerStat = statAt(lower);
    if (lowerStat >= currentStat)
        return 0;

    while (lower > 0 && statAt(lower - EV_STEP) === lowerStat)
        lower -= EV_STEP;

    return lower;
}

/**
 * Returns the label shown after an ability, such as [1] or [H].
 *
 * @param {number} slot The FRONTIER_ABILITY_* value.
 * @returns {string} The label.
 */
export function getAbilityLabel(slot)
{
    return ABILITY_SLOT_LABELS[slot] ?? "";
}

/**
 * Returns the abilities a species can have, one option per slot even when two slots name the same ability.
 *
 * @param {{abilities: Array<string|null>}|null} speciesInfo The catalog species.
 * @returns {Array<{slot: number, ability: string, label: string}>} The options, in [1], [2], [H] order.
 */
export function getAbilityOptions(speciesInfo)
{
    return ABILITY_SLOT_ORDER
        .filter((slot) => speciesInfo?.abilities?.[slot] != null)
        .map((slot) => ({ slot, ability: speciesInfo.abilities[slot], label: getAbilityLabel(slot) }));
}

/**
 * Returns the ability a slot gives in battle. Like CFRU, an empty slot falls back to the first ability.
 *
 * @param {{abilities: Array<string|null>}|null} speciesInfo The catalog species.
 * @param {number} slot The FRONTIER_ABILITY_* value.
 * @returns {string|null} The ABILITY_* constant, or null when unknown.
 */
export function getEffectiveAbility(speciesInfo, slot)
{
    return speciesInfo?.abilities?.[slot] ?? speciesInfo?.abilities?.[ABILITY_SLOTS.FIRST] ?? null;
}

/**
 * Returns the ability a spread would have after Mega Evolving, for previewing next to its ability.
 *
 * @param {object} catalog The game catalog.
 * @param {object} fields The spread's values.
 * @returns {{species: string, ability: string|null}|null} The Mega species and its ability, or null when the
 *          spread does not Mega Evolve.
 */
export function getMegaAbility(catalog, fields)
{
    const species = getMegaSpecies(catalog, fields);
    return species == null ? null : { species, ability: getEffectiveAbility(catalog.species[species], fields.ability) };
}

/**
 * Returns the Hidden Power type produced by a spread's IVs.
 *
 * @param {{hpIv: number, atkIv: number, defIv: number, spdIv: number, spAtkIv: number, spDefIv: number}} ivs
 *        The IVs, where spdIv is Speed.
 * @returns {string} The TYPE_* constant.
 */
export function getHiddenPowerType(ivs)
{
    const sum = HIDDEN_POWER_IV_ORDER.reduce((total, key, bit) => total + ((ivs[key] & 1) << bit), 0);
    return HIDDEN_POWER_TYPES[Math.floor(sum * HIDDEN_POWER_TYPE_STEPS / HIDDEN_POWER_MAX_SUM)];
}

/**
 * Returns the IV closest to the current one with the wanted parity. Low IVs stay low and others stay high.
 *
 * @param {number} iv The current IV.
 * @param {number} parity 0 for even, 1 for odd.
 * @returns {number} The IV.
 */
function getIvWithParity(iv, parity)
{
    if ((iv & 1) === parity)
        return iv;
    if (iv <= LOW_IV_MAX)
        return parity;

    return iv < MAX_IV ? iv + 1 : iv - 1;
}

/**
 * Returns IVs that give a Hidden Power type while changing the spread as little as possible. Speed keeps its
 * value whenever the type allows it, IVs of 0 or 1 stay low, and other IVs lose as few points as possible.
 * Equally good choices follow Showdown's standard Hidden Power IVs.
 *
 * @param {object} ivs The current IVs, such as a spread's fields.
 * @param {string} type The wanted TYPE_* constant.
 * @returns {Object<string, number>|null} All six IVs, or null when Hidden Power cannot have the type.
 */
export function optimizeHiddenPowerIvs(ivs, type)
{
    if (!HIDDEN_POWER_TYPES.includes(type))
        return null;

    const showdownEven = SHOWDOWN_HIDDEN_POWER_EVEN_IVS[type];
    let best = null;
    for (let mask = 0; mask < HIDDEN_POWER_MASKS; ++mask)
    {
        const candidate = {};
        let speedLoss = 0;
        let loss = 0;
        let changes = 0;
        let showdownDifferences = 0;
        let sacrifice = 0;
        HIDDEN_POWER_IV_ORDER.forEach((key, bit) =>
        {
            const current = ivs[key];
            const parity = (mask >> bit) & 1;
            const value = getIvWithParity(current, parity);
            const lost = current <= LOW_IV_MAX ? value - current : current - value;
            candidate[key] = value;
            if (value !== current)
                ++changes;
            if ((parity === 0) !== showdownEven.includes(key))
                ++showdownDifferences;
            if (lost > 0)
            {
                loss += lost;
                sacrifice += HIDDEN_POWER_SACRIFICE_WEIGHTS[key];
                if (key === SPEED_IV)
                    speedLoss = lost;
            }
        });

        if (getHiddenPowerType(candidate) !== type)
            continue;

        // Compared in order, so an earlier cost always outweighs every later one
        const cost = [speedLoss, loss, changes, showdownDifferences, sacrifice];
        const difference = best == null ? -1 : cost.map((value, index) => value - best.cost[index]).find((value) => value !== 0) ?? 0;
        if (difference < 0)
            best = { ivs: candidate, cost };
    }

    return best.ivs;
}

/**
 * Returns which of the user's attacking stats a move's damage depends on.
 *
 * @param {string|number} move The MOVE_* constant, or 0 for an empty slot.
 * @param {object|null} details The move's catalog details.
 * @returns {{atk: string, spAtk: string}} A STAT_USE value for Attack and Special Attack.
 */
export function getMoveStatUse(move, details)
{
    const result = (atk, spAtk) => ({ [STAT_ATK]: atk, [STAT_SP_ATK]: spAtk });
    if (move === 0 || move === MOVE_NONE)
        return result(STAT_USE.UNUSED, STAT_USE.UNUSED);
    if (details == null || details.split == null)
        return result(STAT_USE.UNKNOWN, STAT_USE.UNKNOWN);
    if (details.split === SPLIT_STATUS || OTHER_STAT_MOVES.has(move))
        return result(STAT_USE.UNUSED, STAT_USE.UNUSED);
    if (SPLIT_CHANGING_MOVES.has(move))
        return result(STAT_USE.USED, STAT_USE.USED);

    // Moves with calculated power could still deal fixed damage unless their effect says otherwise
    let use = STAT_USE.USED;
    if (FIXED_DAMAGE_EFFECTS.has(details.effect))
        use = STAT_USE.UNUSED;
    else if (details.power == null || details.power === POWER_NONE || (details.power === POWER_VARIABLE && details.effect == null))
        use = STAT_USE.UNKNOWN;

    if (details.split === SPLIT_PHYSICAL)
        return result(use, STAT_USE.UNUSED);
    if (details.split === SPLIT_SPECIAL)
        return result(STAT_USE.UNUSED, use);

    return result(STAT_USE.UNKNOWN, STAT_USE.UNKNOWN);
}

/**
 * Returns which of the user's attacking stats a spread's moves depend on.
 *
 * @param {object} catalog The game catalog.
 * @param {Array<string|number>} moves The spread's moves.
 * @returns {{atk: string, spAtk: string}} A STAT_USE value for Attack and Special Attack.
 */
export function getSpreadStatUse(catalog, moves)
{
    const uses = moves.map((move) => getMoveStatUse(move, typeof move === "string" && Object.hasOwn(catalog.moves, move) ? catalog.moves[move] : null));
    return Object.fromEntries(AUTO_FIX_STATS.map((stat) =>
    {
        if (uses.some((use) => use[stat] === STAT_USE.USED))
            return [stat, STAT_USE.USED];
        if (uses.some((use) => use[stat] === STAT_USE.UNKNOWN))
            return [stat, STAT_USE.UNKNOWN];

        return [stat, STAT_USE.UNUSED];
    }));
}

/**
 * Works out the auto-fix for one spread: an attacking IV no move needs becomes 0, or 1 when Hidden Power
 * needs it odd, and Speed does the same when Gyro Ball or Trick Room wants the user slow. An attacking IV a move
 * needs becomes 31, or 30 when Hidden Power needs it even. The IVs are chosen together so Hidden Power keeps its
 * type, and no other IV changes.
 *
 * @param {object} catalog The game catalog.
 * @param {object} fields The spread's values.
 * @returns {{changes: Object<string, number>, uses: {atk: string, spAtk: string}, unknown: Array<string>,
 *          hiddenPowerIvs: Array<string>}} The changed IV fields, how each stat is used, the stats left alone
 *          because a move's details are unknown, and the IV fields kept off their best value for Hidden Power.
 */
export function getIvAutoFix(catalog, fields)
{
    const uses = getSpreadStatUse(catalog, fields.moves);
    const lowered = AUTO_FIX_STATS.filter((stat) => uses[stat] === STAT_USE.UNUSED).map((stat) => IV_FIELDS[stat]);
    if (fields.moves.some((move) => SLOW_SPEED_MOVES.has(move)))
        lowered.push(IV_FIELDS.spd);
    const raised = AUTO_FIX_STATS.filter((stat) => uses[stat] === STAT_USE.USED).map((stat) => IV_FIELDS[stat]).filter((key) => fields[key] < MAX_IV);
    const targets = [...lowered, ...raised];
    const getLoss = (ivs, key) => (lowered.includes(key) ? ivs[key] : MAX_IV - ivs[key]);
    const hiddenPowerType = fields.moves.includes(MOVE_HIDDEN_POWER) ? getHiddenPowerType(fields) : null;

    // Keeping each IV's parity always keeps the type, so a choice always exists
    let best = null;
    for (let mask = 0; mask < 1 << targets.length; ++mask)
    {
        const ivs = { ...fields };
        targets.forEach((key, bit) => (ivs[key] = lowered.includes(key) ? (mask >> bit) & 1 : MAX_IV - ((mask >> bit) & 1)));
        if (hiddenPowerType != null && getHiddenPowerType(ivs) !== hiddenPowerType)
            continue;

        const total = targets.reduce((sum, key) => sum + getLoss(ivs, key), 0);
        const bestTotal = best == null ? Infinity : targets.reduce((sum, key) => sum + getLoss(best, key), 0);
        if (total < bestTotal || (total === bestTotal && lowered.includes(IV_FIELDS.atk) && ivs.atkIv < best.atkIv))
            best = ivs;
    }

    const changes = Object.fromEntries(targets.filter((key) => best[key] !== fields[key]).map((key) => [key, best[key]]));
    return {
        changes,
        uses,
        unknown: AUTO_FIX_STATS.filter((stat) => uses[stat] === STAT_USE.UNKNOWN),
        hiddenPowerIvs: Object.keys(changes).filter((key) => getLoss(best, key) > 0),
    };
}

/**
 * Returns a spread's IVs reset to 31, except attacking IVs no move needs and Speed for Gyro Ball or Trick Room,
 * which become 0 as the auto-fix would. A Hidden Power keeps its type, using the IVs closest to 31 that give it.
 *
 * @param {object} catalog The game catalog.
 * @param {object} fields The spread's values.
 * @returns {Object<string, number>} All six IV fields.
 */
export function getResetIvs(catalog, fields)
{
    let ivs = Object.fromEntries(Object.values(IV_FIELDS).map((key) => [key, MAX_IV]));
    if (fields.moves.includes(MOVE_HIDDEN_POWER))
        ivs = optimizeHiddenPowerIvs(ivs, getHiddenPowerType(fields)) ?? ivs;

    return { ...ivs, ...getIvAutoFix(catalog, { ...fields, ...ivs }).changes };
}

/**
 * Works out the auto-fix for many spreads, such as every filtered spread, so it can be previewed first.
 *
 * @param {object} catalog The game catalog.
 * @param {Array<{id: string, fields: object}>} spreads The spreads.
 * @returns {{changes: Array<{id: string, fields: Object<string, number>, hiddenPowerIvs: Array<string>}>,
 *          skipped: Array<{id: string, stats: Array<string>}>}} The spreads that change, and the spreads with
 *          stats left alone because a move's details are unknown.
 */
export function planIvAutoFix(catalog, spreads)
{
    const changes = [];
    const skipped = [];
    for (const { id, fields } of spreads)
    {
        const fix = getIvAutoFix(catalog, fields);
        if (Object.keys(fix.changes).length > 0)
            changes.push({ id, fields: fix.changes, hiddenPowerIvs: fix.hiddenPowerIvs });
        if (fix.unknown.length > 0)
            skipped.push({ id, stats: fix.unknown });
    }

    return { changes, skipped };
}
