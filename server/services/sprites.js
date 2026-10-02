/**
 * Species sprites drawn from DPE's own graphics. DPE's front sprites are 16 color indexed PNGs, and its shiny
 * colors are the palette of the matching shiny back sprite, so a shiny sprite is the front sprite with the
 * shiny palette put in. Palette index 0 is the background, which the game never draws, so it is made transparent.
 */

const zlib = require("zlib");
const { StatusCode } = require("status-code-enum");

const { ApiError } = require("../middleware/errors");
const { parseSpriteTable } = require("./data-parser");
const { createParseCache, getParserVersion, hash } = require("./parse-cache");
const { evaluatePreprocessor } = require("./preprocessor");
const { REPOSITORY_DPE, getRootKey, listOwnedFiles, readOwnedBuffer, readOwnedFile } = require("./repositories");

const DPE_CONFIG_FILE = "src/defines.h";
const SPRITE_TABLES =
{
    tiles: { file: "src/Front_Pic_Table.c", array: "gMonFrontPicTable", suffix: "Tiles" },
    palette: { file: "src/Palette_Table.c", array: "gMonPaletteTable", suffix: "Pal" },
    shinyPalette: { file: "src/Shiny_Palette_Table.c", array: "gMonShinyPaletteTable", suffix: "Pal" },
};
const GRAPHICS_FOLDERS = ["graphics/frontspr", "graphics/backspr", "graphics/frontspr/palette_only", "graphics/backspr/palette_only"];
const IMAGE_EXTENSION = ".png";
const CACHE_SPRITE_TABLES = "dpe-sprites";
const REPOSITORY_FILE_UNAVAILABLE = "REPOSITORY_FILE_UNAVAILABLE";
const SEVERITY_WARNING = "warning";
module.exports.SPRITE_TABLES = SPRITE_TABLES;
module.exports.GRAPHICS_FOLDERS = GRAPHICS_FOLDERS;

const SPRITE_ROUTE = "/api/images/";
const SPRITE_FOLDER = "sprites";
const VARIANT_NORMAL = "normal";
const VARIANT_SHINY = "shiny";
const SPECIES_FILE_PATTERN = /^(SPECIES_[A-Z0-9_]+)\.png$/;

// Every species has a normal and a shiny sprite, so this holds all of them for a full DPE
const MAX_CACHED_SPRITES = 4096;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHUNK_HEADER_BYTES = 8;
const CHUNK_CRC_BYTES = 4;
const CHUNK_IHDR = "IHDR";
const CHUNK_PLTE = "PLTE";
const CHUNK_TRNS = "tRNS";
const CHUNK_IDAT = "IDAT";
const CHUNK_IEND = "IEND";
const IHDR_COLOR_TYPE_OFFSET = 9;
const COLOR_TYPE_INDEXED = 3;
const TRANSPARENT_BACKGROUND = Buffer.from([0]);

const loadedTables = new WeakMap();


/**
 * Returns the chunks of a PNG.
 *
 * @param {Buffer} buffer The PNG file.
 * @returns {Array<{type: string, data: Buffer}>} The chunks in order.
 */
function readChunks(buffer)
{
    if (buffer.length < PNG_SIGNATURE.length || !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE))
        throw new Error("Not a PNG file.");

    const chunks = [];
    let offset = PNG_SIGNATURE.length;
    while (offset + CHUNK_HEADER_BYTES <= buffer.length)
    {
        const length = buffer.readUInt32BE(offset);
        const end = offset + CHUNK_HEADER_BYTES + length + CHUNK_CRC_BYTES;
        if (end > buffer.length)
            throw new Error("The PNG file is cut short.");

        chunks.push({ type: buffer.toString("latin1", offset + 4, offset + CHUNK_HEADER_BYTES), data: buffer.subarray(offset + CHUNK_HEADER_BYTES, end - CHUNK_CRC_BYTES) });
        offset = end;
    }

    return chunks;
}

/**
 * Encodes one PNG chunk.
 *
 * @param {string} type The chunk type.
 * @param {Buffer} data The chunk data.
 * @returns {Buffer} The chunk with its length and checksum.
 */
function writeChunk(type, data)
{
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const length = Buffer.alloc(4);
    const crc = Buffer.alloc(CHUNK_CRC_BYTES);
    length.writeUInt32BE(data.length);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
}

/**
 * Draws an indexed sprite with another sprite's palette, making the background color transparent.
 *
 * @param {Buffer} tilesPng The indexed sprite.
 * @param {Buffer} palettePng An indexed image whose palette is used.
 * @returns {Buffer} The combined PNG.
 */
function combineSpritePalette(tilesPng, palettePng)
{
    const chunks = readChunks(tilesPng);
    const header = chunks.find((chunk) => chunk.type === CHUNK_IHDR);
    const palette = readChunks(palettePng).find((chunk) => chunk.type === CHUNK_PLTE);
    if (header == null || header.data[IHDR_COLOR_TYPE_OFFSET] !== COLOR_TYPE_INDEXED || palette == null)
        throw new Error("The sprite is not an indexed PNG.");

    // Only the chunks needed to draw the image are kept, so none can end up in the wrong place
    const image = chunks.filter((chunk) => chunk.type === CHUNK_IDAT);
    return Buffer.concat(
    [
        PNG_SIGNATURE,
        writeChunk(CHUNK_IHDR, header.data),
        writeChunk(CHUNK_PLTE, palette.data),
        writeChunk(CHUNK_TRNS, TRANSPARENT_BACKGROUND),
        ...image.map((chunk) => writeChunk(CHUNK_IDAT, chunk.data)),
        writeChunk(CHUNK_IEND, Buffer.alloc(0)),
    ]);
}
module.exports.combineSpritePalette = combineSpritePalette;

/**
 * Matches each species to its sprite and palette files. The result can be cached.
 *
 * @param {{configText: string, tables: Object<string, string|null>, graphics: Array<string>}} sources DPE's
 *        configuration, the graphics tables' text and the paths of its sprite images.
 * @returns {{sprites: Object<string, object>|null, diagnostics: Array<object>}} Each species' tiles, palette and
 *          shiny palette paths, or null when the tables cannot be read, and diagnostics.
 */
function parseSpriteSources({ configText, tables, graphics })
{
    const { macros } = evaluatePreprocessor(configText);
    const diagnostics = [];
    const imagesByName = new Map(graphics.map((relativePath) => [relativePath.split("/").at(-1).slice(0, -IMAGE_EXTENSION.length), relativePath]));

    // Each table names a graphic such as gFrontSprite006CharizardTiles, drawn in gFrontSprite006Charizard.png
    const files = {};
    for (const [key, { file, array, suffix }] of Object.entries(SPRITE_TABLES))
    {
        if (tables[key] == null)
            return { sprites: null, diagnostics };

        const parsed = parseSpriteTable(tables[key], macros, array);
        diagnostics.push(...parsed.diagnostics.map((diagnostic) => ({ ...diagnostic, repository: REPOSITORY_DPE, file })));
        if (parsed.symbols == null)
            return { sprites: null, diagnostics };

        files[key] = Object.fromEntries(Object.entries(parsed.symbols).map(([species, symbol]) =>
            [species, imagesByName.get(symbol.endsWith(suffix) ? symbol.slice(0, -suffix.length) : symbol) ?? null]));
    }

    const sprites = {};
    for (const [species, tiles] of Object.entries(files.tiles))
    {
        const palette = files.palette[species] ?? null;
        if (tiles != null && palette != null)
            sprites[species] = { tiles, palette, shinyPalette: files.shinyPalette[species] ?? null };
    }

    return { sprites, diagnostics };
}
module.exports.parseSpriteSources = parseSpriteSources;

/**
 * Reads the DPE files that say which images draw each species.
 *
 * @param {object} workspace The workspace.
 * @returns {Promise<object>} The sources for parseSpriteSources.
 */
async function readSpriteSources(workspace)
{
    const readOptional = async (file) =>
    {
        try
        {
            return await readOwnedFile(workspace, REPOSITORY_DPE, file);
        }
        catch (error)
        {
            if (error.code !== REPOSITORY_FILE_UNAVAILABLE)
                throw error;
            return null;
        }
    };

    const [configText, ...texts] = await Promise.all([DPE_CONFIG_FILE, ...Object.values(SPRITE_TABLES).map((table) => table.file)].map(readOptional));
    const listings = await Promise.all(GRAPHICS_FOLDERS.map((folder) => listOwnedFiles(workspace, REPOSITORY_DPE, folder)));
    const graphics = listings.flatMap((names, index) => names.filter((name) => name.toLowerCase().endsWith(IMAGE_EXTENSION)).map((name) => `${GRAPHICS_FOLDERS[index]}/${name}`));
    return { configText: configText ?? "", tables: Object.fromEntries(Object.keys(SPRITE_TABLES).map((key, index) => [key, texts[index]])), graphics };
}

/**
 * Loads which DPE images draw each species, reusing the cached result while DPE is unchanged.
 *
 * @param {object} workspace The workspace.
 * @param {object} [cache] The parse cache.
 * @returns {Promise<{sprites: Object<string, object>|null, diagnostics: Array<object>}>} The sprite files by species
 *          and diagnostics.
 */
async function loadSpriteTables(workspace, cache = createParseCache())
{
    const sources = await readSpriteSources(workspace);
    const sourceHash = hash(JSON.stringify(sources));
    const parsed = await cache.getOrCreate(CACHE_SPRITE_TABLES, getRootKey(workspace, REPOSITORY_DPE), [getParserVersion(), sourceHash],
        () => parseSpriteSources(sources));

    const diagnostics = [...parsed.diagnostics];
    if (parsed.sprites == null)
        diagnostics.push({ severity: SEVERITY_WARNING, code: "DPE_SPRITES_UNAVAILABLE", message: "DPE's sprite tables could not be read, so sprites come from elsewhere.", repository: REPOSITORY_DPE });

    // Sprites drawn from older tables are dropped, since their files may have changed
    const previous = loadedTables.get(workspace);
    if (previous?.sourceHash !== sourceHash)
        loadedTables.set(workspace, { sourceHash, sprites: parsed.sprites, images: new Map() });
    return { sprites: parsed.sprites, diagnostics };
}
module.exports.loadSpriteTables = loadSpriteTables;

/**
 * Returns the URLs of a species' DPE sprites.
 *
 * @param {object} workspace The workspace.
 * @param {Object<string, object>|null} sprites The sprite files by species.
 * @param {string} species The SPECIES_* constant.
 * @returns {{normal: string, shiny: string|null}|null} The URLs, or null when DPE has no sprite for the species.
 */
function getDpeSpriteUrls(workspace, sprites, species)
{
    const files = sprites?.[species];
    if (files == null)
        return null;

    const url = (variant) => `${SPRITE_ROUTE}${workspace.id}/${SPRITE_FOLDER}/${variant}/${species}${IMAGE_EXTENSION}`;
    return { normal: url(VARIANT_NORMAL), shiny: files.shinyPalette != null ? url(VARIANT_SHINY) : null };
}
module.exports.getDpeSpriteUrls = getDpeSpriteUrls;

/**
 * Draws a species' sprite for the sprite route.
 *
 * @param {object} workspace The workspace.
 * @param {*} variant normal or shiny.
 * @param {*} file The file name, such as SPECIES_CHARIZARD.png.
 * @returns {Promise<Buffer>} The PNG.
 */
async function renderSprite(workspace, variant, file)
{
    const species = typeof file === "string" ? SPECIES_FILE_PATTERN.exec(file)?.[1] : null;
    if (!loadedTables.has(workspace))
        await loadSpriteTables(workspace);

    const tables = loadedTables.get(workspace);
    const files = species != null && tables.sprites != null && Object.hasOwn(tables.sprites, species) ? tables.sprites[species] : null;
    const palette = variant === VARIANT_SHINY ? files?.shinyPalette : variant === VARIANT_NORMAL ? files?.palette : null;
    if (palette == null)
        throw new ApiError(StatusCode.ClientErrorNotFound, "IMAGE_NOT_FOUND", "This image does not exist.");

    const key = `${variant}:${species}`;
    if (tables.images.has(key))
        return tables.images.get(key);

    let image;
    try
    {
        const [tilesPng, palettePng] = await Promise.all([files.tiles, palette].map((relativePath) => readOwnedBuffer(workspace, REPOSITORY_DPE, relativePath)));
        image = combineSpritePalette(tilesPng, palettePng);
    }
    catch (error)
    {
        if (error instanceof ApiError && error.status === StatusCode.ClientErrorForbidden)
            throw error;
        throw new ApiError(StatusCode.ClientErrorNotFound, "IMAGE_NOT_FOUND", "This image does not exist.");
    }

    if (tables.images.size >= MAX_CACHED_SPRITES)
        tables.images.clear();
    tables.images.set(key, image);
    return image;
}
module.exports.renderSprite = renderSprite;
