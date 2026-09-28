/**
 * Static source parsing for the attached repositories.
 * Repository code is parsed into syntax trees and read as literal data; it is never evaluated.
 */

const { parse, Lang } = require("@ast-grep/napi");

const GAME_DISPLAY_NAMES_SYMBOL = "GAME_DISPLAY_NAMES";
const GAME_IDS_TO_DATA_SYMBOL = "GAME_IDS_TO_DATA";
const SPECIES_ICON_NAMES_SYMBOL = "SPECIES_FORMS_ICON_NAMES";

const KIND_PROGRAM = "program";
const KIND_EXPORT = "export_statement";
const KIND_LEXICAL_DECLARATION = "lexical_declaration";
const KIND_VARIABLE_DECLARATOR = "variable_declarator";
const KIND_IMPORT = "import_statement";
const KIND_IMPORT_CLAUSE = "import_clause";
const KIND_IDENTIFIER = "identifier";
const KIND_PROPERTY_IDENTIFIER = "property_identifier";
const KIND_OBJECT = "object";
const KIND_PAIR = "pair";
const KIND_STRING = "string";
const KIND_STRING_FRAGMENT = "string_fragment";
const KIND_COMMENT = "comment";
const OBJECT_PUNCTUATION = new Set(["{", "}", ","]);

const SEVERITY_ERROR = "error";
const SEVERITY_WARNING = "warning";


/**
 * Returns the literal value of a string node without escape sequences.
 *
 * @param {object} node The syntax node.
 * @returns {string|null} The string value, or null if the node is not a plain string literal.
 */
function getPlainStringValue(node)
{
    if (node == null || node.kind() !== KIND_STRING)
        return null;

    let value = "";
    for (const child of node.children())
    {
        if (child.kind() === KIND_STRING_FRAGMENT)
            value += child.text();
        else if (child.kind() !== "\"" && child.kind() !== "'")
            return null; // Escape sequences are not needed by the supported files
    }

    return value;
}

/**
 * Returns the key of an object pair when it is a plain string or identifier.
 *
 * @param {object} pairNode The pair syntax node.
 * @returns {string|null} The key, or null if it is computed or unsupported.
 */
function getPairKey(pairNode)
{
    const keyNode = pairNode.field("key");
    if (keyNode == null)
        return null;

    if (keyNode.kind() === KIND_PROPERTY_IDENTIFIER)
        return keyNode.text();

    return getPlainStringValue(keyNode);
}

/**
 * Returns the one-based line number of a syntax node.
 *
 * @param {object} node The syntax node.
 * @returns {number} The line number.
 */
function getLineNumber(node)
{
    return node.range().start.line + 1;
}

/**
 * Reads the pairs of an object literal, reporting any member that is not a plain key/value pair.
 *
 * @param {object} objectNode The object syntax node.
 * @param {string} symbol The declaration being read, for diagnostics.
 * @param {Array<object>} diagnostics Diagnostics to append to.
 * @returns {Array<{key: string, valueNode: object}>} The readable pairs in source order.
 */
function readObjectPairs(objectNode, symbol, diagnostics)
{
    const pairs = [];

    for (const child of objectNode.children())
    {
        // Braces, commas and comments carry no data
        const kind = child.kind();
        if (OBJECT_PUNCTUATION.has(kind) || kind === KIND_COMMENT)
            continue;

        // Spreads, computed keys and methods cannot be read without running code
        const key = kind === KIND_PAIR ? getPairKey(child) : null;
        if (key == null)
        {
            diagnostics.push(
            {
                severity: SEVERITY_WARNING,
                code: "UNSUPPORTED_EXPRESSION",
                message: `Skipped an unsupported entry in ${symbol} on line ${getLineNumber(child)}.`,
            });
            continue;
        }

        pairs.push({ key, valueNode: child.field("value") });
    }

    return pairs;
}

/**
 * Finds a top-level const declaration by name, whether or not it is exported.
 *
 * @param {object} root The program syntax node.
 * @param {string} symbol The declared name.
 * @returns {Array<object>} Matching declarator nodes.
 */
function findTopLevelDeclarators(root, symbol)
{
    return root.findAll({ rule: { kind: KIND_VARIABLE_DECLARATOR } }).filter((declarator) =>
    {
        // Match the name
        const nameNode = declarator.field("name");
        if (nameNode == null || nameNode.text() !== symbol)
            return false;

        // Match a const/let declaration, optionally exported, directly in the file body
        const declaration = declarator.parent();
        if (declaration == null || declaration.kind() !== KIND_LEXICAL_DECLARATION)
            return false;

        let container = declaration.parent();
        if (container != null && container.kind() === KIND_EXPORT)
            container = container.parent();

        return container != null && container.kind() === KIND_PROGRAM;
    });
}

/**
 * Returns the object literal assigned to a unique top-level declaration.
 *
 * @param {object} root The program syntax node.
 * @param {string} symbol The declared name.
 * @param {Array<object>} diagnostics Diagnostics to append to.
 * @returns {object|null} The object node, or null if it is missing or not a literal object.
 */
function findObjectDeclaration(root, symbol, diagnostics)
{
    // The declaration must exist exactly once
    const declarators = findTopLevelDeclarators(root, symbol);
    if (declarators.length !== 1)
    {
        diagnostics.push(
        {
            severity: SEVERITY_ERROR,
            code: declarators.length === 0 ? "DECLARATION_NOT_FOUND" : "DECLARATION_AMBIGUOUS",
            message: declarators.length === 0
                ? `Could not find ${symbol}.`
                : `Found more than one top-level ${symbol}.`,
        });
        return null;
    }

    // Its value must be written out as an object literal
    const valueNode = declarators[0].field("value");
    if (valueNode == null || valueNode.kind() !== KIND_OBJECT)
    {
        diagnostics.push(
        {
            severity: SEVERITY_ERROR,
            code: "UNSUPPORTED_EXPRESSION",
            message: `${symbol} is not a literal object.`,
        });
        return null;
    }

    return valueNode;
}

/**
 * Maps default import names to their module specifiers.
 *
 * @param {object} root The program syntax node.
 * @returns {Map<string, string>} Imported identifier to module specifier.
 */
function readDefaultImports(root)
{
    const imports = new Map();

    for (const statement of root.children().filter((child) => child.kind() === KIND_IMPORT))
    {
        const source = getPlainStringValue(statement.field("source"));
        const clause = statement.children().find((child) => child.kind() === KIND_IMPORT_CLAUSE);
        const identifier = clause?.children().find((child) => child.kind() === KIND_IDENTIFIER);

        // Only default imports can name a JSON data file
        if (source != null && identifier != null)
            imports.set(identifier.text(), source);
    }

    return imports;
}

/**
 * Reads an optional top-level object whose values are all plain strings.
 *
 * @param {object} root The program syntax node.
 * @param {string} symbol The declared name.
 * @param {Array<object>} diagnostics Diagnostics to append to.
 * @returns {Object<string, string>} The readable entries, or none when the object is missing.
 */
function readStringObject(root, symbol, diagnostics)
{
    // Aliases are optional; without them names are derived from the constants
    if (findTopLevelDeclarators(root, symbol).length === 0)
        return {};

    const objectNode = findObjectDeclaration(root, symbol, diagnostics);
    const values = {};
    for (const { key, valueNode } of objectNode != null ? readObjectPairs(objectNode, symbol, diagnostics) : [])
    {
        const value = getPlainStringValue(valueNode);
        if (value != null)
            values[key] = value;
    }

    return values;
}

/**
 * Reads the game list and per-game JSON imports from Unbound Cloud's PokemonUtil.jsx.
 *
 * @param {string} sourceText The file contents.
 * @returns {{games: Array<{id: string, name: string, dataImports: Object<string, string>|null}>,
 *            speciesIconNames: Object<string, string>, diagnostics: Array<object>}}
 *          Games in declaration order with their module specifiers, Cloud's icon names for species forms and diagnostics.
 */
function parseCloudGameConfig(sourceText)
{
    // Parse the file and collect its default imports, such as CFRUBaseStats -> ./data/cfru/BaseStats.json
    const diagnostics = [];
    const root = parse(Lang.JavaScript, sourceText).root();
    const imports = readDefaultImports(root);
    const games = [];
    const speciesIconNames = readStringObject(root, SPECIES_ICON_NAMES_SYMBOL, diagnostics);

    // Find the two objects that describe the games
    const namesNode = findObjectDeclaration(root, GAME_DISPLAY_NAMES_SYMBOL, diagnostics);
    const dataNode = findObjectDeclaration(root, GAME_IDS_TO_DATA_SYMBOL, diagnostics);
    if (namesNode == null || dataNode == null)
        return { games, speciesIconNames, diagnostics };

    // Map each game in GAME_IDS_TO_DATA to the files its data comes from
    const dataByGame = new Map();
    for (const { key: gameId, valueNode } of readObjectPairs(dataNode, GAME_IDS_TO_DATA_SYMBOL, diagnostics))
    {
        // Each game's entry must itself be an object literal
        if (valueNode == null || valueNode.kind() !== KIND_OBJECT)
        {
            diagnostics.push(
            {
                severity: SEVERITY_WARNING,
                code: "UNSUPPORTED_EXPRESSION",
                message: `${GAME_IDS_TO_DATA_SYMBOL}.${gameId} is not a literal object.`,
            });
            continue;
        }

        // Each data value must name an imported file
        const dataImports = {};
        for (const { key: dataName, valueNode: referenceNode } of readObjectPairs(valueNode, `${GAME_IDS_TO_DATA_SYMBOL}.${gameId}`, diagnostics))
        {
            const specifier = referenceNode?.kind() === KIND_IDENTIFIER ? imports.get(referenceNode.text()) : undefined;
            if (specifier === undefined)
            {
                diagnostics.push(
                {
                    severity: SEVERITY_WARNING,
                    code: "UNRESOLVED_REFERENCE",
                    message: `${GAME_IDS_TO_DATA_SYMBOL}.${gameId}.${dataName} does not refer to an imported file.`,
                });
                continue;
            }

            dataImports[dataName] = specifier;
        }

        dataByGame.set(gameId, dataImports);
    }

    // List the games in GAME_DISPLAY_NAMES order, attaching their data files where they exist
    for (const { key: gameId, valueNode } of readObjectPairs(namesNode, GAME_DISPLAY_NAMES_SYMBOL, diagnostics))
    {
        const name = getPlainStringValue(valueNode);
        if (name == null)
        {
            diagnostics.push(
            {
                severity: SEVERITY_WARNING,
                code: "UNSUPPORTED_EXPRESSION",
                message: `${GAME_DISPLAY_NAMES_SYMBOL}.${gameId} is not a plain string.`,
            });
            continue;
        }

        games.push({ id: gameId, name, dataImports: dataByGame.get(gameId) ?? null });
    }

    return { games, speciesIconNames, diagnostics };
}
module.exports.parseCloudGameConfig = parseCloudGameConfig;
