/**
 * Independent, Showdown-inspired role suggestions, not matchup or metagame optimization.
 * Weather abilities assume their weather is available; no speed benchmarks or HP rounding are imposed.
 */
import
{
    DEFAULT_PREVIEW_LEVEL, EV_FIELDS, EV_STEP, IV_FIELDS, MAX_EV, MAX_EV_TOTAL, MAX_IV,
    MOVE_HIDDEN_POWER, STAT_USE, STATS, calculateStat, getEffectiveAbility, getMegaSpecies,
    getMoveStatUse, getNatureEffect, getResetIvs, isSlowSpeedSpread,
} from "./pokemon-mechanics.mjs";

const EV_BUDGET = Math.floor(MAX_EV_TOTAL / EV_STEP) * EV_STEP;
const FAST_SPEED = 80;
const MIN_FRAGILE_SPEED = 70;
const FRAGILE_BULK = 70;
const LOW_LEVEL_THRESHOLD = 20;
const MAX_LEVEL = 100;
const SETUP_WEIGHT = 2;
const SPECIES_SHEDINJA = "SPECIES_SHEDINJA";
const MOVE_TRICK_ROOM = "MOVE_TRICKROOM";
const IV_CONTEXT_MOVES = { atk: "MOVE_SUGGESTION_PHYSICAL", spAtk: "MOVE_SUGGESTION_SPECIAL" };
const SPLITS = new Set(["SPLIT_PHYSICAL", "SPLIT_SPECIAL", "SPLIT_STATUS"]);
const SLOW_MOVES = new Set(["MOVE_GYROBALL", MOVE_TRICK_ROOM]);
const PHYSICAL_SETUP = new Set(["MOVE_SWORDSDANCE", "MOVE_DRAGONDANCE", "MOVE_BULKUP", "MOVE_COIL", "MOVE_BELLYDRUM", "MOVE_HONECLAWS"]);
const SPECIAL_SETUP = new Set(["MOVE_NASTYPLOT", "MOVE_CALMMIND", "MOVE_QUIVERDANCE", "MOVE_TAILGLOW", "MOVE_GEOMANCY"]);
const SPEED_SETUP = new Set(["MOVE_AGILITY", "MOVE_ROCKPOLISH", "MOVE_AUTOTOMIZE", "MOVE_DRAGONDANCE", "MOVE_QUIVERDANCE", "MOVE_SHELLSMASH", "MOVE_GEOMANCY", "MOVE_SHIFTGEAR"]);
const SPEED_ABILITIES = new Set(["ABILITY_SPEEDBOOST", "ABILITY_SWIFTSWIM", "ABILITY_CHLOROPHYLL", "ABILITY_SANDRUSH", "ABILITY_SLUSHRUSH", "ABILITY_UNBURDEN", "ABILITY_SURGESURFER"]);
const RECOVERY = new Set(["MOVE_RECOVER", "MOVE_ROOST", "MOVE_SOFTBOILED", "MOVE_SLACKOFF", "MOVE_MILKDRINK", "MOVE_SYNTHESIS", "MOVE_MOONLIGHT", "MOVE_MORNINGSUN", "MOVE_REST", "MOVE_WISH", "MOVE_STRENGTHSAP", "MOVE_SHOREUP"]);
const STALL = new Set(["MOVE_TOXIC", "MOVE_WILLOWISP", "MOVE_LEECHSEED", "MOVE_PROTECT", "MOVE_SUBSTITUTE"]);
const CHOICE_ITEMS = new Set(["ITEM_CHOICEBAND", "ITEM_CHOICESPECS", "ITEM_CHOICESCARF"]);
const NATURES =
[
    "NATURE_HARDY", "NATURE_LONELY", "NATURE_BRAVE", "NATURE_ADAMANT", "NATURE_NAUGHTY",
    "NATURE_BOLD", "NATURE_DOCILE", "NATURE_RELAXED", "NATURE_IMPISH", "NATURE_LAX",
    "NATURE_TIMID", "NATURE_HASTY", "NATURE_SERIOUS", "NATURE_JOLLY", "NATURE_NAIVE",
    "NATURE_MODEST", "NATURE_MILD", "NATURE_QUIET", "NATURE_BASHFUL", "NATURE_RASH",
    "NATURE_CALM", "NATURE_GENTLE", "NATURE_SASSY", "NATURE_CAREFUL", "NATURE_QUIRKY",
];

/** Searchable role presets with explicit attacking and Speed priorities. */
export const SPREAD_PRESETS =
[
    { name: "Fast Physical Attacker", primary: "atk", secondary: "spd", raised: "spd" },
    { name: "Fast Special Attacker", primary: "spAtk", secondary: "spd", raised: "spd" },
    { name: "Bulky Physical Attacker", primary: "atk", secondary: "hp", raised: "atk" },
    { name: "Bulky Special Attacker", primary: "spAtk", secondary: "hp", raised: "spAtk" },
    { name: "Slow Physical Attacker", primary: "atk", secondary: "hp", raised: "atk", slow: true },
    { name: "Slow Special Attacker", primary: "spAtk", secondary: "hp", raised: "spAtk", slow: true },
    { name: "Physically Defensive", primary: "def", secondary: "hp", raised: "def" },
    { name: "Specially Defensive", primary: "spDef", secondary: "hp", raised: "spDef" },
    { name: "Fast Bulky Support", primary: "hp", secondary: "spd", raised: "spd" },
];


/**
 * Chooses investment priorities from meaningful attacks, setup and defensive support.
 * @param {object} baseStats The effective species' base stats.
 * @param {object} fields The original spread.
 * @param {Array<object>} moves Known moves with their stat use.
 * @param {string|null} ability The effective ability, including Mega ability.
 * @param {Array<{name: string, value: number|null}>} teamTypes The snapshot's resolved team enum.
 * @returns {object} The role, priorities and used attacking stats.
 */
function chooseRole(baseStats, fields, moves, ability, teamTypes)
{
    const has = (set) => moves.some(({ move }) => set.has(move));
    const counts = Object.fromEntries(["atk", "spAtk"].map((stat) =>
        [stat, moves.filter(({ use }) => use[stat] === STAT_USE.USED).length]));
    const used = Object.keys(counts).filter((stat) => counts[stat] > 0);
    const physicalScore = (counts.atk + (has(PHYSICAL_SETUP) ? SETUP_WEIGHT : 0)) * baseStats.atk;
    const specialScore = (counts.spAtk + (has(SPECIAL_SETUP) ? SETUP_WEIGHT : 0)) * baseStats.spAtk;
    let attack = physicalScore > specialScore ? "atk" : "spAtk";
    if (fields.item === "ITEM_CHOICEBAND" && counts.atk > 0)
        attack = "atk";
    else if (fields.item === "ITEM_CHOICESPECS" && counts.spAtk > 0)
        attack = "spAtk";
    if (!used.includes(attack))
        attack = used[0] ?? null;

    const slow = isSlowSpeedSpread(fields, teamTypes);
    const boosted = has(SPEED_SETUP) || SPEED_ABILITIES.has(ability) || fields.item === "ITEM_CHOICESCARF";
    const fast = !slow && (baseStats.spd >= FAST_SPEED
        || (baseStats.spd >= MIN_FRAGILE_SPEED && Math.min(baseStats.hp, baseStats.def, baseStats.spDef) < FRAGILE_BULK) || boosted);
    const statusCount = moves.filter(({ details }) => details.split === "SPLIT_STATUS").length;
    const stallCount = moves.filter(({ move }) => STALL.has(move)).length;
    const bodyPress = moves.some(({ move }) => move === "MOVE_BODYPRESS");
    const defensive = attack == null || bodyPress || (!CHOICE_ITEMS.has(fields.item)
        && ((has(RECOVERY) && statusCount >= SETUP_WEIGHT) || stallCount >= SETUP_WEIGHT));
    if (defensive)
    {
        let defense = baseStats.def >= baseStats.spDef ? "def" : "spDef";
        if (moves.some(({ move }) => move === "MOVE_WILLOWISP" || move === "MOVE_BULKUP" || move === "MOVE_COIL"))
            defense = "spDef";
        if (bodyPress || moves.some(({ move }) => move === "MOVE_CALMMIND" || move === "MOVE_QUIVERDANCE"))
            defense = "def";
        return { role: defense === "def" ? "Physically Defensive" : "Specially Defensive", primary: defense, secondary: "hp", raised: defense, used, slow };
    }

    const style = used.length > 1 ? "Mixed" : attack === "atk" ? "Physical" : "Special";
    return {
        role: `${slow ? "Slow" : fast ? "Fast" : "Bulky"} ${style} Attacker`,
        primary: attack,
        secondary: fast ? "spd" : "hp",
        raised: fast && !boosted ? "spd" : attack,
        used,
        slow,
    };
}

/**
 * Finds a catalog nature without penalizing a used attack or contradicting slow Speed.
 * @param {object} catalog The game catalog.
 * @param {object} fields The current spread.
 * @param {object} plan The role's priorities.
 * @param {object} baseStats The effective base stats.
 * @param {Array<{name: string, value: number|null}>} teamTypes The snapshot's resolved team enum.
 * @returns {string|null} A known nature, or null when no safe choice exists.
 */
function chooseNature(catalog, fields, plan, baseStats, teamTypes)
{
    const slowCondition = isSlowSpeedSpread(fields, teamTypes);
    const slowNature = plan.slow || slowCondition;
    const raised = slowNature && plan.raised === "spd" ? (plan.primary === "hp" ? "def" : plan.primary) : plan.raised;
    const lowered = slowNature ? "spd" : !plan.used.includes("atk") ? "atk"
        : !plan.used.includes("spAtk") ? "spAtk" : baseStats.def <= baseStats.spDef ? "def" : "spDef";
    const suitable = (nature) =>
    {
        const effect = getNatureEffect(nature);
        return Object.hasOwn(catalog.natures ?? {}, nature) && effect != null
            && !plan.used.includes(effect.decreased)
            && ((slowNature && effect.decreased === "spd")
                || (effect.decreased !== plan.primary && effect.decreased !== plan.secondary))
            && (!slowNature || (plan.explicit && !slowCondition) || effect.decreased === "spd");
    };
    let available = NATURES.filter(suitable);
    if (plan.explicit && slowNature && available.some((nature) => getNatureEffect(nature).decreased === "spd"))
        available = available.filter((nature) => getNatureEffect(nature).decreased === "spd");
    const exact = available.find((nature) =>
    {
        const effect = getNatureEffect(nature);
        return effect.increased === raised && effect.decreased === lowered;
    });
    return exact ?? (available.includes(fields.nature) ? fields.nature : null)
        ?? available.find((nature) => getNatureEffect(nature).increased === raised)
        ?? available[0] ?? null;
}

/**
 * Builds an IV-only move context honoring explicit priorities without editing actual moves.
 * @param {object} catalog The game catalog.
 * @param {object} fields The original spread.
 * @param {Array<object>} moves Known moves with their stat use.
 * @param {object} plan The explicit role's priorities.
 * @param {Array<{name: string, value: number|null}>} teamTypes The snapshot's resolved team enum.
 * @returns {object} All six reset IV fields.
 */
function getPresetResetIvs(catalog, fields, moves, plan, teamTypes)
{
    const context = moves.filter(({ move }) => plan.slow || !SLOW_MOVES.has(move));
    const contextMoves = context.map(({ move }) => move);
    const details = { ...catalog.moves };
    for (const stat of plan.used)
    {
        if (context.some(({ use }) => use[stat] === STAT_USE.USED))
            continue;
        const move = IV_CONTEXT_MOVES[stat];
        details[move] = { split: stat === "atk" ? "SPLIT_PHYSICAL" : "SPLIT_SPECIAL", power: 1, effect: "EFFECT_HIT" };
        contextMoves.push(move);
    }
    if (fields.moves.includes(MOVE_HIDDEN_POWER) && !contextMoves.includes(MOVE_HIDDEN_POWER))
        contextMoves.push(MOVE_HIDDEN_POWER);
    if (plan.slow && !contextMoves.includes(MOVE_TRICK_ROOM))
    {
        details[MOVE_TRICK_ROOM] = { split: "SPLIT_STATUS", power: 0 };
        contextMoves.push(MOVE_TRICK_ROOM);
    }
    return getResetIvs({ ...catalog, moves: details },
    {
        ...fields, moves: contextMoves, specificTeamType: plan.slow ? fields.specificTeamType : null,
    }, teamTypes);
}

/**
 * Allocates two main investments, trims plateaus and buys only affordable final-stat gains.
 * @param {string} species The effective species.
 * @param {object} baseStats Its base stats.
 * @param {object} values The suggested IVs and nature.
 * @param {object} plan The role's priorities.
 * @param {number} level The battle level.
 * @returns {object} All six EV fields.
 */
function allocateEvs(species, baseStats, values, plan, level)
{
    const shedinja = species === SPECIES_SHEDINJA;
    const eligible = STATS.filter((stat) => (!shedinja || !["hp", "def", "spDef"].includes(stat))
        && (!["atk", "spAtk"].includes(stat) || plan.used.includes(stat)) && (stat !== "spd" || !plan.slow));
    const weakerDefense = baseStats.def <= baseStats.spDef ? "def" : "spDef";
    const secondary = level < LOW_LEVEL_THRESHOLD && plan.secondary === "hp" ? weakerDefense : plan.secondary;
    const fallback = level < LOW_LEVEL_THRESHOLD ? [weakerDefense, "def", "spDef", "spd", "hp"] : ["hp", weakerDefense, "def", "spDef", "spd"];
    const priorities = [...new Set([plan.primary, secondary, ...fallback, ...plan.used])].filter((stat) => eligible.includes(stat));
    const evs = Object.fromEntries(STATS.map((stat) => [EV_FIELDS[stat], 0]));
    const statAt = (stat, ev) => calculateStat(
    {
        stat, baseStat: baseStats[stat], iv: values[IV_FIELDS[stat]], ev, level, nature: values.nature, species,
    });

    // Keep the maxed stat value with the fewest EVs, including nature rounding.
    for (const stat of priorities.slice(0, SETUP_WEIGHT))
    {
        let ev = MAX_EV;
        while (ev >= EV_STEP && statAt(stat, ev - EV_STEP) === statAt(stat, MAX_EV))
            ev -= EV_STEP;
        evs[EV_FIELDS[stat]] = ev;
    }

    let remaining = EV_BUDGET - Object.values(evs).reduce((sum, ev) => sum + ev, 0);
    for (const stat of priorities)
    {
        const key = EV_FIELDS[stat];
        let current = evs[key];
        for (let next = current + EV_STEP; next <= MAX_EV && next - current <= remaining; next += EV_STEP)
        {
            if (statAt(stat, next) <= statAt(stat, current))
                continue;
            remaining -= next - current;
            current = next;
            evs[key] = current;
        }
    }
    return evs;
}

/**
 * Suggests a role and only EV, IV and nature edits, or follows explicit preset priorities.
 * Automatic suggestions require known move use; all suggestions require effective base stats.
 * Mega selection is battle-based and independent of the UI's stat-preview switch.
 * @param {object} catalog The local game catalog.
 * @param {object} fields The current spread, never mutated.
 * @param {object} [options] Battle-level and preset options.
 * @param {number} [options.level] The level used for measurable EV gains.
 * @param {string|null} [options.preset=null] A preset name, or null for automatic role selection.
 * @param {Array<{name: string, value: number|null}>} [options.teamTypes=[]] The snapshot's resolved team enum.
 * @returns {{role: string, fields: object}|null} The suggestion, or null for unsafe inputs.
 */
export function getSuggestedSpread(catalog, fields, { level = DEFAULT_PREVIEW_LEVEL, preset = null, teamTypes = [] } = {})
{
    if (!catalog?.species || !catalog?.moves || !fields || !Array.isArray(fields.moves)
        || fields.moves.length > 4 || !Number.isInteger(level) || level < 1 || level > MAX_LEVEL
        || !Object.hasOwn(catalog.species, fields.species) || !catalog.species[fields.species])
        return null;

    const selected = preset === null ? null : SPREAD_PRESETS.find(({ name }) => name === preset);
    if (preset !== null && !selected)
        return null;

    const original = catalog.species[fields.species];
    const species = (Array.isArray(original.megas) ? getMegaSpecies(catalog, fields) : null) ?? fields.species;
    const info = catalog.species[species];
    const baseStats = info?.baseStats;
    if (!STATS.every((stat) => Number.isFinite(baseStats?.[stat]) && baseStats[stat] > 0))
        return null;

    const moves = [];
    for (const move of fields.moves)
    {
        if (move === 0 || move === "MOVE_NONE")
            continue;
        const details = typeof move === "string" && Object.hasOwn(catalog.moves, move) ? catalog.moves[move] : null;
        const use = getMoveStatUse(move, details);
        if (!details || !SPLITS.has(details.split) || Object.values(use).includes(STAT_USE.UNKNOWN)
            || (Object.values(use).includes(STAT_USE.USED) && (!Number.isFinite(details.power) || details.power <= 0)))
        {
            if (preset === null)
                return null;
            continue;
        }
        moves.push({ move, details, use });
    }
    if ((preset === null && moves.length === 0) || (fields.moves.includes(MOVE_HIDDEN_POWER)
        && !Object.values(IV_FIELDS).every((key) => Number.isInteger(fields[key]) && fields[key] >= 0 && fields[key] <= MAX_IV)))
        return null;

    let plan = chooseRole(baseStats, fields, moves, getEffectiveAbility(info, fields.ability), teamTypes);
    if (selected)
    {
        const used = [...new Set([...plan.used, ...(["atk", "spAtk"].includes(selected.primary) ? [selected.primary] : [])])];
        plan = { ...plan, ...selected, role: selected.name, used, slow: selected.slow === true, explicit: true };
    }
    const nature = chooseNature(catalog, fields, plan, baseStats, teamTypes);
    if (nature == null)
        return null;

    const values = { ...(selected ? getPresetResetIvs(catalog, fields, moves, plan, teamTypes) : getResetIvs(catalog, fields, teamTypes)), nature };
    return { role: plan.role, fields: { ...allocateEvs(species, baseStats, values, plan, level), ...values } };
}
