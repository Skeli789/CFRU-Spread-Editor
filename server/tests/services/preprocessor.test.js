/**
 * Test file for the C preprocessor evaluator.
 * Tests conditional branches, macro expressions, comments, masking and undecidable conditions.
 */

const { expect } = require("chai");

const { STATE_ACTIVE, STATE_INACTIVE, STATE_UNKNOWN, evaluateCondition, evaluatePreprocessor, findRange } = require("../../services/preprocessor");


/**
 * Returns the lines of masked text that still have content.
 *
 * @param {string} text The source.
 * @param {Map<string, object>} [macros] Initial macros.
 * @returns {Array<string>} The visible lines.
 */
function visibleLines(text, macros)
{
    return evaluatePreprocessor(text, macros).maskedText.split("\n").map((line) => line.trim()).filter(Boolean);
}

/**
 * Returns macros read from #define lines.
 *
 * @param {string} text The definitions.
 * @returns {Map<string, object>} The macros.
 */
function defineMacros(text)
{
    return evaluatePreprocessor(text).macros;
}

describe("Preprocessor", () =>
{
    it("should keep the #ifdef branch of a defined macro and mask the #else branch", () =>
    {
        const source = "#ifdef UNBOUND\nint a;\n#else\nint b;\n#endif\nint c;\n";
        expect(visibleLines(source, defineMacros("#define UNBOUND"))).to.deep.equal(["int a;", "int c;"]);
        expect(visibleLines(source)).to.deep.equal(["int b;", "int c;"]);
    });

    it("should keep positions and line endings when masking", () =>
    {
        const source = "#ifndef X\r\nint a; // é\r\n#endif\r\n";
        const { maskedText } = evaluatePreprocessor(source, defineMacros("#define X"));
        expect(maskedText.length).to.equal(source.length);
        expect(maskedText.match(/\r\n/g)).to.have.length(3);
        expect(maskedText.trim()).to.equal("");
    });

    it("should evaluate #if and #elif expressions with macros", () =>
    {
        const macros = defineMacros("#define LEVEL 2\n#define FLAG\n#define NESTED (LEVEL * 3)");
        expect(evaluateCondition("LEVEL >= 2 && defined(FLAG)", macros)).to.equal(true);
        expect(evaluateCondition("defined MISSING || NESTED == 6", macros)).to.equal(true);
        expect(evaluateCondition("!(LEVEL << 1 == 4) ? 1 : 0", macros)).to.equal(false);
        expect(evaluateCondition("0x10 - 010 == 8", macros)).to.equal(true);

        const source = "#if LEVEL == 1\none\n#elif LEVEL == 2\ntwo\n#else\nthree\n#endif\n";
        expect(visibleLines(source, macros)).to.deep.equal(["two"]);
    });

    it("should apply #define and #undef only in compiled text", () =>
    {
        const source = "#ifdef NEVER\n#define A\n#endif\n#define B\n#undef B\n#ifdef A\na\n#endif\n#ifdef B\nb\n#endif\nend\n";
        const result = evaluatePreprocessor(source);
        expect(result.macros.has("A")).to.equal(false);
        expect(result.macros.has("B")).to.equal(false);
        expect(visibleLines(source)).to.deep.equal(["end"]);
    });

    it("should ignore directives inside block comments", () =>
    {
        const source = "/*\n#ifdef UNBOUND\n*/\nint a;\n";
        const result = evaluatePreprocessor(source);
        expect(result.directives).to.have.length(0);
        expect(result.unresolved).to.equal(false);
    });

    it("should keep nested groups inside an inactive branch inactive", () =>
    {
        const source = "#ifdef NEVER\n#if SOMETHING_UNKNOWN\na\n#else\nb\n#endif\n#endif\nc\n";
        const result = evaluatePreprocessor(source);
        expect(visibleLines(source)).to.deep.equal(["c"]);
        expect(result.unresolved).to.equal(false);
    });

    it("should report and mask a condition that uses an unknown macro", () =>
    {
        const source = "#if SOMETHING_UNKNOWN > 1\na\n#else\nb\n#endif\nc\n";
        const result = evaluatePreprocessor(source);
        expect(result.unresolved).to.equal(true);
        expect(result.diagnostics[0].code).to.equal("PREPROCESSOR_UNKNOWN_MACRO");
        expect(visibleLines(source)).to.deep.equal(["c"]);
        expect(findRange(result.ranges, source.indexOf("b")).state).to.equal(STATE_UNKNOWN);
    });

    it("should report unsupported expressions and unbalanced directives", () =>
    {
        expect(evaluatePreprocessor("#if 'a'\n#endif\n").diagnostics[0].code).to.equal("PREPROCESSOR_UNSUPPORTED");
        expect(evaluatePreprocessor("#endif\n").diagnostics[0].code).to.equal("PREPROCESSOR_UNBALANCED");
        expect(evaluatePreprocessor("#ifdef A\n").diagnostics[0].code).to.equal("PREPROCESSOR_UNBALANCED");
        expect(evaluatePreprocessor("#if 1 / 0\n#endif\n").unresolved).to.equal(true);
    });

    it("should record the branch of each range", () =>
    {
        const source = "#ifdef UNBOUND\na\n#else\nb\n#endif\n";
        const result = evaluatePreprocessor(source, defineMacros("#define UNBOUND"));
        const active = findRange(result.ranges, source.indexOf("a"));
        const inactive = findRange(result.ranges, source.indexOf("b"));
        expect(active).to.include({ state: STATE_ACTIVE });
        expect(active.branch).to.deep.equal(["#ifdef UNBOUND"]);
        expect(inactive).to.include({ state: STATE_INACTIVE });
        expect(inactive.branch).to.deep.equal(["#else (#ifdef UNBOUND)"]);
    });
});
