/**
 * Pokemon mechanics shared by the editor page and the local server.
 * This module must stay free of browser and Node APIs.
 */

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
