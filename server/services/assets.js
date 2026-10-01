/**
 * Image URLs for species, types, items and balls. PokeAPI sprites are used where PokeAPI has the form,
 * and Unbound Cloud's own image rules where it does not. Cloud's images are served by this server from the
 * local Cloud repository, and only images that exist there are linked.
 */

const { StatusCode } = require("status-code-enum");

const { ApiError } = require("../middleware/errors");
const { REPOSITORY_CLOUD, listOwnedFiles, resolveOwnedFile } = require("./repositories");

const POKEAPI_SPRITES = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/";
const POKEAPI_POKEMON_SPRITES = `${POKEAPI_SPRITES}pokemon/`;
const POKEAPI_TYPE_SPRITES = `${POKEAPI_SPRITES}types/generation-viii/sword-shield/`;
const POKESPRITE = "https://raw.githubusercontent.com/msikma/pokesprite/master/";
const POKESPRITE_POKEMON = `${POKESPRITE}pokemon-gen8/`;
const POKESPRITE_REGULAR = "regular/";
const POKESPRITE_ITEMS = `${POKESPRITE}items/`;
const POKESPRITE_BALLS = `${POKESPRITE}items/ball/`;
const POKESPRITE_TYPES = `${POKESPRITE}misc/types/gen8/`;
const CLOUD_IMAGE_ROUTE = "/api/images/";
const IMAGE_EXTENSION = ".png";
const IMAGE_NAME_PATTERN = /^[A-Za-z0-9_-]+\.png$/;
const SHINY_FOLDER = "shiny/";
const FEMALE_FOLDER = "female/";
const SHINY_SUFFIX = "_SHINY";

// Cloud's public image folders, by the key used in image URLs
const CLOUD_IMAGE_FOLDERS =
{
    root: "public/images",
    items: "public/images/items",
    gen9: "public/images/gen_9",
    gen9Shiny: "public/images/gen_9/shiny",
    unboundShinies: "public/images/unbound_shinies",
};
module.exports.CLOUD_IMAGE_FOLDERS = CLOUD_IMAGE_FOLDERS;
const GIGANTAMAX_IMAGE = "gigantamax";

const SPECIES_PREFIX = "SPECIES_";
const DEX_PREFIX = "NATIONAL_DEX_";
const ITEM_NONE = "ITEM_NONE";
const FEMALE_ICON_PREFIX = "female/";

// Cloud's icon rule for regional forms, plus the names PokeAPI and PokeSprite use for Gigantamax and Paldean forms
const FORM_SUFFIXES =
[
    { suffix: "_A", name: "_ALOLA" },
    { suffix: "_G", name: "_GALAR", except: ["SPECIES_UNOWN_G"] },
    { suffix: "_H", name: "_HISUI", except: ["SPECIES_UNOWN_H"] },
    { suffix: "_P", name: "_PALDEA", except: ["SPECIES_UNOWN_P"] },
    { suffix: "_GIGA", name: "_GMAX" },
];

// Forms PokeAPI names differently from both Cloud's icons and the constants
const POKEAPI_NAMES =
{
    SPECIES_TAUROS_P: "tauros-paldea-combat-breed",
    SPECIES_TAUROS_BLAZE_P: "tauros-paldea-blaze-breed",
    SPECIES_TAUROS_AQUA_P: "tauros-paldea-aqua-breed",
    SPECIES_DARMANITAN_G: "darmanitan-galar-standard",
    SPECIES_DARMANITANZEN: "darmanitan-zen",
    SPECIES_DARMANITAN_G_ZEN: "darmanitan-galar-zen",
    SPECIES_MEOWSTIC_FEMALE: "meowstic-female",
    SPECIES_INDEEDEE_FEMALE: "indeedee-female",
    SPECIES_URSHIFU_RAPID: "urshifu-rapid-strike",
    SPECIES_URSHIFU_RAPID_GIGA: "urshifu-rapid-strike-gmax",
    SPECIES_URSHIFU_SINGLE_GIGA: "urshifu-single-strike-gmax",
    SPECIES_TOXTRICITY_GIGA: "toxtricity-amped-gmax",
    SPECIES_TOXTRICITY_LOW_KEY_GIGA: "toxtricity-low-key-gmax",
};

const SPRITE_POKEAPI = "pokeapi";
const SPRITE_CLOUD = "cloud";
const SPRITE_POKESPRITE = "pokesprite";


/**
 * Lists the images in the local Cloud repository. A folder that cannot be listed only means its images are not linked.
 *
 * @param {object} workspace The workspace.
 * @returns {Promise<object>} File names in each image folder, and the URL the workspace's images are served from.
 */
async function readCloudImages(workspace)
{
    const folders = Object.entries(CLOUD_IMAGE_FOLDERS);
    const names = await Promise.all(folders.map(([, folder]) => listOwnedFiles(workspace, REPOSITORY_CLOUD, folder).catch(() => [])));
    return { baseUrl: `${CLOUD_IMAGE_ROUTE}${workspace.id}/`, ...Object.fromEntries(folders.map(([key], index) => [key, new Set(names[index])])) };
}
module.exports.readCloudImages = readCloudImages;

/**
 * Resolves a Cloud image this server may serve: a PNG directly inside one of Cloud's public image folders.
 *
 * @param {object} workspace The workspace.
 * @param {*} folder The image folder key.
 * @param {*} file The file name.
 * @returns {Promise<string>} The canonical path.
 */
async function resolveCloudImage(workspace, folder, file)
{
    if (!Object.hasOwn(CLOUD_IMAGE_FOLDERS, folder) || typeof file !== "string" || !IMAGE_NAME_PATTERN.test(file))
        throw new ApiError(StatusCode.ClientErrorNotFound, "IMAGE_NOT_FOUND", "This image does not exist.");

    try
    {
        return await resolveOwnedFile(workspace, REPOSITORY_CLOUD, `${CLOUD_IMAGE_FOLDERS[folder]}/${file}`);
    }
    catch (error)
    {
        // Links that leave the repository are still reported as forbidden
        if (error.status === StatusCode.ClientErrorForbidden)
            throw error;

        throw new ApiError(StatusCode.ClientErrorNotFound, "IMAGE_NOT_FOUND", "This image does not exist.");
    }
}
module.exports.resolveCloudImage = resolveCloudImage;

/**
 * Returns the URL of a Cloud image if the local Cloud repository has it.
 *
 * @param {object} images The local images and the URL they are served from.
 * @param {string} folder The image folder key.
 * @param {string} name The file name without extension.
 * @returns {string|null} The URL.
 */
function getCloudImage(images, folder, name)
{
    const file = name + IMAGE_EXTENSION;
    return images[folder].has(file) ? `${images.baseUrl}${folder}/${encodeURIComponent(file)}` : null;
}

/**
 * Turns a constant into an icon name, such as SPECIES_RAICHU_A into raichu-alola.
 *
 * @param {string} species The SPECIES_* constant.
 * @returns {string} The name.
 */
function toIconName(species)
{
    let name = species.slice(SPECIES_PREFIX.length);
    const form = FORM_SUFFIXES.find(({ suffix, except = [] }) => name.endsWith(suffix) && !except.includes(species));
    if (form != null)
        name = name.slice(0, -form.suffix.length) + form.name;

    return name.toLowerCase().replace(/_/g, "-");
}

/**
 * Returns the compact species icon URL using Cloud's form naming when available.
 *
 * @param {string} species The species constant.
 * @param {string|undefined} iconName Cloud's form-specific icon name.
 * @returns {string} The icon URL.
 */
function getSpeciesIcon(species, iconName)
{
    const path = (iconName ?? toIconName(species)).split("/").map(encodeURIComponent).join("/");
    return `${POKESPRITE_POKEMON}${POKESPRITE_REGULAR}${path}${IMAGE_EXTENSION}`;
}
module.exports.getSpeciesIcon = getSpeciesIcon;

/**
 * Returns the PokeAPI names a species might have, most specific first.
 *
 * @param {string} species The SPECIES_* constant.
 * @param {string|undefined} iconName Cloud's icon name for the species, if it has one.
 * @returns {{names: Array<string>, female: boolean}} The candidate names and whether the female sprite is wanted.
 */
function getPokeApiNames(species, iconName)
{
    const names = [];
    if (Object.hasOwn(POKEAPI_NAMES, species))
        names.push(POKEAPI_NAMES[species]);

    // Cloud's icon names match PokeAPI's for most forms, with female differences in their own folder
    const female = iconName?.startsWith(FEMALE_ICON_PREFIX) ?? false;
    if (iconName != null)
        names.push(female ? iconName.slice(FEMALE_ICON_PREFIX.length) : iconName);

    names.push(toIconName(species));
    return { names, female };
}

/**
 * Returns a species' PokeAPI sprite ID.
 *
 * @param {string} species The SPECIES_* constant.
 * @param {object} info What is known about the species.
 * @param {string|null} info.dex The NATIONAL_DEX_* constant.
 * @param {number|null} info.dexNumber The national Pokedex number.
 * @param {string|undefined} info.iconName Cloud's icon name.
 * @param {object|null} index The PokeAPI index.
 * @returns {{id: number, female: boolean, exact: boolean}|null} The ID, whether the female sprite is wanted and
 *          whether it shows exactly this form rather than only its Pokedex number.
 */
function findPokeApiSprite(species, { dex, dexNumber, iconName }, index)
{
    const { names, female } = getPokeApiNames(species, iconName);
    const id = names.map((name) => index?.pokemon[name]).find((value) => value != null);
    if (id != null)
        return { id, female, exact: true };

    // PokeAPI's default forms have the Pokedex number as their ID, even when their names have a suffix
    if (dexNumber == null || dexNumber <= 0)
        return null;

    const baseName = dex?.startsWith(DEX_PREFIX) ? dex.slice(DEX_PREFIX.length).toLowerCase().replace(/_/g, "-") : null;
    return { id: dexNumber, female, exact: names.includes(baseName) };
}

/**
 * Returns a PokeAPI sprite URL.
 *
 * @param {{id: number, female: boolean}} sprite The sprite.
 * @param {boolean} shiny Whether the shiny sprite is wanted.
 * @returns {string} The URL.
 */
function getPokeApiSpriteUrl({ id, female }, shiny)
{
    return `${POKEAPI_POKEMON_SPRITES}${shiny ? SHINY_FOLDER : ""}${female ? FEMALE_FOLDER : ""}${id}${IMAGE_EXTENSION}`;
}

/**
 * Returns the normal and shiny sprites of a species.
 *
 * @param {string} species The SPECIES_* constant.
 * @param {object} info What is known about the species.
 * @param {string|null} info.dex The NATIONAL_DEX_* constant.
 * @param {number|null} info.dexNumber The national Pokedex number.
 * @param {string|undefined} info.iconName Cloud's icon name.
 * @param {boolean} info.customShiny Whether the game has its own shiny colors for the species.
 * @param {object} context Shared lookups.
 * @param {object|null} context.index The PokeAPI index.
 * @param {object} context.images Cloud's local images, from readCloudImages.
 * @returns {{normal: string|null, shiny: string|null, fallback: {normal: string, shiny: string}|null, source: string|null, exact: boolean}}
 *          The URLs, sprites to show if those fail to load, where the sprites come from and whether they show exactly this form.
 */
function getSpeciesSprites(species, info, { index, images })
{
    const pokeApi = findPokeApiSprite(species, info, index);
    const customShiny = info.customShiny ? getCloudImage(images, "unboundShinies", species) : null;
    const sprites = (normal, shiny, source, exact = true, fallback = null) => ({ normal, shiny: customShiny ?? shiny, fallback, source, exact });

    // Custom forms Cloud draws itself, such as Surfing Pikachu, then PokeAPI's sprite of the exact form
    const custom = getCloudImage(images, "root", species);
    if (custom != null)
        return sprites(custom, getCloudImage(images, "root", species + SHINY_SUFFIX), SPRITE_CLOUD);
    if (pokeApi?.exact)
        return sprites(getPokeApiSpriteUrl(pokeApi, false), getPokeApiSpriteUrl(pokeApi, true), SPRITE_POKEAPI);

    const generation9 = getCloudImage(images, "gen9", species);
    if (generation9 != null)
        return sprites(generation9, getCloudImage(images, "gen9Shiny", species), SPRITE_CLOUD);

    // Other forms use Cloud's PokeSprite icon, falling back to the base form if PokeSprite lacks it too
    const iconName = info.iconName ?? toIconName(species);
    const fallback = pokeApi != null ? { normal: getPokeApiSpriteUrl(pokeApi, false), shiny: getPokeApiSpriteUrl(pokeApi, true) } : null;
    const iconPath = iconName.split("/").map(encodeURIComponent).join("/") + IMAGE_EXTENSION;
    if (info.dexNumber != null && info.dexNumber > 0)
        return sprites(`${POKESPRITE_POKEMON}${POKESPRITE_REGULAR}${iconPath}`, `${POKESPRITE_POKEMON}${SHINY_FOLDER}${iconPath}`, SPRITE_POKESPRITE, true, fallback);

    return sprites(null, null, null, false);
}
module.exports.getSpeciesSprites = getSpeciesSprites;

/**
 * Returns a type's icon: PokeAPI's when the index knows the type, otherwise Cloud's.
 *
 * @param {string} typeName The type's display name, such as Fire.
 * @param {object|null} index The PokeAPI index.
 * @returns {string} The URL.
 */
function getTypeIcon(typeName, index)
{
    const name = typeName.toLowerCase();
    const id = index?.types[name];
    return id != null ? `${POKEAPI_TYPE_SPRITES}${id}${IMAGE_EXTENSION}` : `${POKESPRITE_TYPES}${encodeURIComponent(name)}${IMAGE_EXTENSION}`;
}
module.exports.getTypeIcon = getTypeIcon;

/**
 * Returns a type's round symbol without its name, as Cloud's GetTypeIconUrl shows beside moves.
 *
 * @param {string} typeName The type's display name, such as Fire.
 * @returns {string} The URL.
 */
function getTypeSymbol(typeName)
{
    return `${POKESPRITE_TYPES}${encodeURIComponent(typeName.toLowerCase())}${IMAGE_EXTENSION}`;
}
module.exports.getTypeSymbol = getTypeSymbol;

/**
 * Returns an item's icon following Cloud's GetItemIconLink: its PokeSprite link, or Cloud's own image.
 *
 * @param {string} item The ITEM_* constant.
 * @param {{link?: string}|undefined} itemName Cloud's ItemNames entry.
 * @param {object} images Cloud's local images, from readCloudImages.
 * @returns {string|null} The URL, or null when there is none.
 */
function getItemIcon(item, itemName, images)
{
    if (item === ITEM_NONE)
        return null;
    if (typeof itemName?.link === "string")
        return `${POKESPRITE_ITEMS}${itemName.link.split("/").map(encodeURIComponent).join("/")}${IMAGE_EXTENSION}`;

    return getCloudImage(images, "items", item);
}
module.exports.getItemIcon = getItemIcon;

/**
 * Returns a ball's icon following Cloud's GetBallIconUrl.
 *
 * @param {string|undefined} ballName The ball's display name, such as Poké Ball.
 * @returns {string|null} The URL, or null for an unnamed ball.
 */
function getBallIcon(ballName)
{
    if (ballName == null)
        return null;

    const base = ballName.replace(/ Ball$/, "").toLowerCase().replace(/é/g, "e");
    return `${POKESPRITE_BALLS}${encodeURIComponent(base)}${IMAGE_EXTENSION}`;
}
module.exports.getBallIcon = getBallIcon;

/**
 * Returns Cloud's Gigantamax icon.
 *
 * @param {object} images Cloud's local images, from readCloudImages.
 * @returns {string|null} The URL.
 */
function getGigantamaxIcon(images)
{
    return getCloudImage(images, "root", GIGANTAMAX_IMAGE);
}
module.exports.getGigantamaxIcon = getGigantamaxIcon;
