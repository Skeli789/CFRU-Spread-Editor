/**
 * Test file for source-parser.js
 * Tests static reading of Unbound Cloud's game configuration.
 */

const { expect } = require("chai");

const { parseCloudGameConfig } = require("../../services/source-parser");


describe("Cloud game configuration parser", () =>
{
    it("should read game names and resolve their imported data files", () =>
    {
        const source =
`import A from "./data/a/BaseStats.json";
import { helper } from "./Util";
// Comments and JSX elsewhere are ignored
export const GAME_DISPLAY_NAMES =
{
    // The official data
    "a": "Game A",
    b: "",
};
const GAME_IDS_TO_DATA =
{
    "a": { "baseStats": A },
};
export const View = () => <div>{helper()}</div>;
`;

        const { games, diagnostics } = parseCloudGameConfig(source);
        expect(games).to.deep.equal(
        [
            { id: "a", name: "Game A", dataImports: { baseStats: "./data/a/BaseStats.json" } },
            { id: "b", name: "", dataImports: null },
        ]);
        expect(diagnostics).to.deep.equal([]);
    });

    it("should report unsupported expressions without evaluating them", () =>
    {
        const source =
`import A from "./data/a.json";
const EXTRA = { "x": "X" };
export const GAME_DISPLAY_NAMES =
{
    ...EXTRA,
    [computeKey()]: "Computed",
    "a": "Game " + "A",
    "b": "Game B",
};
const GAME_IDS_TO_DATA =
{
    "b": { "baseStats": NotImported, "moves": require("./data/b.json") },
    "c": makeData(),
};
`;

        const { games, diagnostics } = parseCloudGameConfig(source);
        expect(games).to.deep.equal([{ id: "b", name: "Game B", dataImports: {} }]);
        expect(diagnostics.map((diagnostic) => diagnostic.code)).to.have.members(
        [
            "UNSUPPORTED_EXPRESSION", // GAME_IDS_TO_DATA.c
            "UNRESOLVED_REFERENCE", // b.baseStats
            "UNRESOLVED_REFERENCE", // b.moves
            "UNSUPPORTED_EXPRESSION", // spread
            "UNSUPPORTED_EXPRESSION", // computed key
            "UNSUPPORTED_EXPRESSION", // concatenated name
        ]);
    });

    it("should report missing and duplicated declarations", () =>
    {
        const missing = parseCloudGameConfig("export const GAME_DISPLAY_NAMES = {};");
        expect(missing.games).to.deep.equal([]);
        expect(missing.diagnostics[0].code).to.equal("DECLARATION_NOT_FOUND");

        const duplicated = parseCloudGameConfig(
            "const GAME_IDS_TO_DATA = {};\nexport const GAME_DISPLAY_NAMES = {};\nexport const GAME_DISPLAY_NAMES = {};");
        expect(duplicated.diagnostics[0].code).to.equal("DECLARATION_AMBIGUOUS");
    });

    it("should ignore declarations that are not at the top level", () =>
    {
        const source = "function f() { const GAME_DISPLAY_NAMES = { \"a\": \"A\" }; }\nconst GAME_IDS_TO_DATA = {};";
        expect(parseCloudGameConfig(source).diagnostics[0].code).to.equal("DECLARATION_NOT_FOUND");
    });

    it("should read Cloud's species icon names, keeping only plain strings", () =>
    {
        const source =
`const SPECIES_FORMS_ICON_NAMES =
{
    "SPECIES_PYROAR_FEMALE": "female/pyroar",
    "SPECIES_LYCANROC_N": "lycanroc-midnight",
    "SPECIES_COMPUTED": "x" + "y",
};
export const GAME_DISPLAY_NAMES = {};
const GAME_IDS_TO_DATA = {};
`;

        const { speciesIconNames, diagnostics } = parseCloudGameConfig(source);
        expect(speciesIconNames).to.deep.equal({ SPECIES_PYROAR_FEMALE: "female/pyroar", SPECIES_LYCANROC_N: "lycanroc-midnight" });
        expect(diagnostics).to.deep.equal([]);
        expect(parseCloudGameConfig("export const GAME_DISPLAY_NAMES = {};\nconst GAME_IDS_TO_DATA = {};").speciesIconNames).to.deep.equal({});
    });
});
