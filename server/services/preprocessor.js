/**
 * A small C preprocessor for deciding which parts of a source file the compiler would see.
 * It evaluates conditional directives and simple macros without running any code, and it keeps
 * every source position intact by masking inactive text with spaces instead of removing it.
 */

const SEVERITY_ERROR = "error";
const SEVERITY_WARNING = "warning";

const STATE_ACTIVE = "active";
const STATE_INACTIVE = "inactive";
const STATE_UNKNOWN = "unknown";
module.exports.STATE_ACTIVE = STATE_ACTIVE;
module.exports.STATE_INACTIVE = STATE_INACTIVE;
module.exports.STATE_UNKNOWN = STATE_UNKNOWN;

const CONDITIONAL_OPENERS = new Set(["if", "ifdef", "ifndef"]);
const IGNORED_DIRECTIVES = new Set(["include", "pragma", "line", "warning", ""]);
const MAX_MACRO_EXPANSION_DEPTH = 64;
const MASK_CHARACTER = " ";

// Binary operator precedence, highest binding last, as in C
const BINARY_PRECEDENCE =
{
    "||": 1, "&&": 2, "|": 3, "^": 4, "&": 5,
    "==": 6, "!=": 6, "<": 7, "<=": 7, ">": 7, ">=": 7,
    "<<": 8, ">>": 8, "+": 9, "-": 9, "*": 10, "/": 10, "%": 10,
};
const TERNARY_PRECEDENCE = 0;
const OPERATOR_PATTERN = /^(?:<<|>>|<=|>=|==|!=|&&|\|\||[()!~+\-*/%<>&^|?:])/;
const NUMBER_PATTERN = /^(0[xX][0-9a-fA-F]+|0[0-7]*|[1-9][0-9]*)[uUlL]*(?![\w.])/;
const IDENTIFIER_PATTERN = /^[A-Za-z_]\w*/;
const DIRECTIVE_PATTERN = /^\s*#\s*([A-Za-z_]*)\s*([\s\S]*)$/;
const DEFINE_PATTERN = /^([A-Za-z_]\w*)(\()?/;


/**
 * An error in a preprocessor expression the evaluator cannot decide.
 */
class PreprocessorError extends Error
{
    /**
     * @param {string} code The diagnostic code.
     * @param {string} message The description.
     */
    constructor(code, message)
    {
        super(message);
        this.code = code;
    }
}

/**
 * Splits text into physical lines with their offsets.
 *
 * @param {string} text The source text.
 * @returns {Array<{start: number, end: number, contentEnd: number}>} Line spans; end includes the line ending.
 */
function splitLines(text)
{
    const lines = [];
    let start = 0;

    while (start < text.length)
    {
        const newline = text.indexOf("\n", start);
        const end = newline === -1 ? text.length : newline + 1;
        let contentEnd = newline === -1 ? text.length : newline;
        if (contentEnd > start && text[contentEnd - 1] === "\r")
            contentEnd--;

        lines.push({ start, end, contentEnd });
        start = end;
    }

    return lines;
}

/**
 * Advances comment and literal tracking over ordinary source text.
 *
 * @param {string} text The line content.
 * @param {boolean} inBlockComment Whether the text starts inside a block comment.
 * @returns {boolean} Whether a block comment is still open at the end.
 */
function scanCommentState(text, inBlockComment)
{
    let index = 0;

    while (index < text.length)
    {
        // Look for the end of an open block comment
        if (inBlockComment)
        {
            const close = text.indexOf("*/", index);
            if (close === -1)
                return true;

            inBlockComment = false;
            index = close + 2;
            continue;
        }

        // Comments start outside literals only
        const character = text[index];
        if (character === "/" && text[index + 1] === "/")
            return false;
        if (character === "/" && text[index + 1] === "*")
        {
            inBlockComment = true;
            index += 2;
            continue;
        }

        // Skip string and character literals, which may contain comment markers
        if (character === "\"" || character === "'")
        {
            index++;
            while (index < text.length && text[index] !== character)
                index += text[index] === "\\" ? 2 : 1;
        }

        index++;
    }

    return inBlockComment;
}

/**
 * Removes comments from a directive's text.
 *
 * @param {string} text The directive text.
 * @returns {{text: string, opensBlockComment: boolean}} The text without comments and whether a block comment stays open.
 */
function stripDirectiveComments(text)
{
    let result = "";
    let index = 0;

    while (index < text.length)
    {
        if (text.startsWith("//", index))
            break;

        if (text.startsWith("/*", index))
        {
            const close = text.indexOf("*/", index + 2);
            if (close === -1)
                return { text: result, opensBlockComment: true };

            result += MASK_CHARACTER;
            index = close + 2;
            continue;
        }

        result += text[index];
        index++;
    }

    return { text: result, opensBlockComment: false };
}

/**
 * Splits a preprocessor expression into tokens.
 *
 * @param {string} expression The expression text.
 * @returns {Array<{type: string, value: string}>} The tokens.
 */
function tokenize(expression)
{
    const tokens = [];
    let rest = expression.trim();

    while (rest !== "")
    {
        // Each token is a number, a name or an operator
        let match = NUMBER_PATTERN.exec(rest);
        if (match != null)
            tokens.push({ type: "number", value: match[1] });
        else if ((match = IDENTIFIER_PATTERN.exec(rest)) != null)
            tokens.push({ type: "identifier", value: match[0] });
        else if ((match = OPERATOR_PATTERN.exec(rest)) != null)
            tokens.push({ type: "operator", value: match[0] });
        else
            throw new PreprocessorError("PREPROCESSOR_UNSUPPORTED", `Unsupported text "${rest.slice(0, 20)}" in a preprocessor condition.`);

        rest = rest.slice(match[0].length).trimStart();
    }

    return tokens;
}

/**
 * Replaces defined() tests and macro names with their values.
 *
 * @param {Array<object>} tokens The tokens.
 * @param {Map<string, object>} macros The defined macros.
 * @param {Set<string>} expanding Macros being expanded, to stop self-reference.
 * @returns {Array<object>} Tokens containing only numbers and operators.
 */
function expandTokens(tokens, macros, expanding = new Set())
{
    if (expanding.size > MAX_MACRO_EXPANSION_DEPTH)
        throw new PreprocessorError("PREPROCESSOR_UNSUPPORTED", "A macro expands too deeply to evaluate.");

    const result = [];

    for (let index = 0; index < tokens.length; index++)
    {
        const token = tokens[index];
        if (token.type !== "identifier")
        {
            result.push(token);
            continue;
        }

        // defined NAME and defined(NAME) test a macro without expanding it
        if (token.value === "defined")
        {
            const parenthesized = tokens[index + 1]?.value === "(";
            const nameToken = tokens[index + (parenthesized ? 2 : 1)];
            if (nameToken?.type !== "identifier" || (parenthesized && tokens[index + 3]?.value !== ")"))
                throw new PreprocessorError("PREPROCESSOR_UNSUPPORTED", "defined must be followed by a macro name.");

            result.push({ type: "number", value: macros.has(nameToken.value) ? "1" : "0" });
            index += parenthesized ? 3 : 1;
            continue;
        }

        // Object-like macros are replaced by their own tokens
        const macro = macros.get(token.value);
        if (macro == null)
            throw new PreprocessorError("PREPROCESSOR_UNKNOWN_MACRO", `${token.value} is not defined in the files the editor reads, so this condition cannot be decided.`);
        if (macro.functionLike || expanding.has(token.value))
            throw new PreprocessorError("PREPROCESSOR_UNSUPPORTED", `${token.value} cannot be evaluated in a preprocessor condition.`);

        const body = tokenize(macro.body);
        if (body.length === 0)
            throw new PreprocessorError("PREPROCESSOR_UNSUPPORTED", `${token.value} has no value to evaluate.`);

        result.push(...expandTokens(body, macros, new Set([...expanding, token.value])));
    }

    return result;
}

/**
 * Evaluates expanded preprocessor tokens with C integer semantics.
 *
 * @param {Array<object>} tokens Tokens containing only numbers and operators.
 * @returns {bigint} The value.
 */
function evaluateTokens(tokens)
{
    let position = 0;
    const peek = () => tokens[position];
    const expect = (value) =>
    {
        if (tokens[position]?.value !== value)
            throw new PreprocessorError("PREPROCESSOR_UNSUPPORTED", `Expected "${value}" in a preprocessor condition.`);
        position++;
    };

    /**
     * Reads a number, parenthesized expression or unary operation.
     *
     * @returns {bigint} The value.
     */
    function readPrimary()
    {
        const token = tokens[position++];
        if (token == null)
            throw new PreprocessorError("PREPROCESSOR_UNSUPPORTED", "A preprocessor condition ends unexpectedly.");

        if (token.type === "number")
            return BigInt(token.value.length > 1 && token.value.startsWith("0") && !/^0[xX]/.test(token.value) ? `0o${token.value.slice(1)}` : token.value);

        switch (token.value)
        {
            case "(":
            {
                const value = readExpression(TERNARY_PRECEDENCE);
                expect(")");
                return value;
            }
            case "!":
                return readPrimary() === 0n ? 1n : 0n;
            case "~":
                return ~readPrimary();
            case "-":
                return -readPrimary();
            case "+":
                return readPrimary();
            default:
                throw new PreprocessorError("PREPROCESSOR_UNSUPPORTED", `Unexpected "${token.value}" in a preprocessor condition.`);
        }
    }

    /**
     * Applies a binary operator.
     *
     * @param {string} operator The operator.
     * @param {bigint} left The left value.
     * @param {bigint} right The right value.
     * @returns {bigint} The result.
     */
    function applyBinary(operator, left, right)
    {
        if ((operator === "/" || operator === "%") && right === 0n)
            throw new PreprocessorError("PREPROCESSOR_UNSUPPORTED", "A preprocessor condition divides by zero.");

        switch (operator)
        {
            case "||": return left !== 0n || right !== 0n ? 1n : 0n;
            case "&&": return left !== 0n && right !== 0n ? 1n : 0n;
            case "|": return left | right;
            case "^": return left ^ right;
            case "&": return left & right;
            case "==": return left === right ? 1n : 0n;
            case "!=": return left !== right ? 1n : 0n;
            case "<": return left < right ? 1n : 0n;
            case "<=": return left <= right ? 1n : 0n;
            case ">": return left > right ? 1n : 0n;
            case ">=": return left >= right ? 1n : 0n;
            case "<<": return left << right;
            case ">>": return left >> right;
            case "+": return left + right;
            case "-": return left - right;
            case "*": return left * right;
            case "/": return left / right;
            default: return left % right;
        }
    }

    /**
     * Reads an expression whose operators bind at least as tightly as a precedence.
     *
     * @param {number} minimumPrecedence The lowest precedence to consume.
     * @returns {bigint} The value.
     */
    function readExpression(minimumPrecedence)
    {
        let left = readPrimary();

        for (;;)
        {
            const operator = peek()?.value;

            // The conditional operator binds loosest and groups to the right
            if (operator === "?" && minimumPrecedence <= TERNARY_PRECEDENCE)
            {
                position++;
                const whenTrue = readExpression(TERNARY_PRECEDENCE);
                expect(":");
                const whenFalse = readExpression(TERNARY_PRECEDENCE);
                left = left !== 0n ? whenTrue : whenFalse;
                continue;
            }

            const precedence = BINARY_PRECEDENCE[operator];
            if (precedence == null || precedence < minimumPrecedence || peek()?.type !== "operator")
                return left;

            position++;
            left = applyBinary(operator, left, readExpression(precedence + 1));
        }
    }

    const value = readExpression(TERNARY_PRECEDENCE);
    if (position !== tokens.length)
        throw new PreprocessorError("PREPROCESSOR_UNSUPPORTED", "A preprocessor condition has unexpected trailing text.");

    return value;
}

/**
 * Evaluates the condition of an #if or #elif directive.
 *
 * @param {string} expression The condition text.
 * @param {Map<string, object>} macros The defined macros.
 * @returns {boolean} Whether the condition holds.
 */
function evaluateCondition(expression, macros)
{
    const tokens = expandTokens(tokenize(expression), macros);
    if (tokens.length === 0)
        throw new PreprocessorError("PREPROCESSOR_UNSUPPORTED", "A preprocessor condition is empty.");

    return evaluateTokens(tokens) !== 0n;
}
module.exports.evaluateCondition = evaluateCondition;

/**
 * Reads the macro name from an #ifdef, #ifndef or #undef directive.
 *
 * @param {string} argument The directive argument.
 * @returns {string} The macro name.
 */
function readMacroName(argument)
{
    const match = /^([A-Za-z_]\w*)\s*$/.exec(argument.trim());
    if (match == null)
        throw new PreprocessorError("PREPROCESSOR_UNSUPPORTED", "Expected a single macro name.");

    return match[1];
}

/**
 * Returns the effective state of the innermost conditional group.
 *
 * @param {Array<object>} stack The conditional stack.
 * @returns {string} The state.
 */
function getCurrentState(stack)
{
    return stack.length === 0 ? STATE_ACTIVE : stack[stack.length - 1].state;
}

/**
 * Sets a conditional group's state from its branch condition.
 *
 * @param {object} group The conditional group.
 * @param {Function} holds Returns whether the branch condition holds; may throw a PreprocessorError.
 */
function chooseBranch(group, holds)
{
    try
    {
        group.taken = holds();
        group.state = group.taken ? STATE_ACTIVE : STATE_INACTIVE;
    }
    catch (error)
    {
        group.state = STATE_UNKNOWN;
        group.undecidable = true;
        throw error;
    }
}

/**
 * Evaluates a file's preprocessor directives.
 *
 * @param {string} text The source text.
 * @param {Map<string, object>} [initialMacros] Macros defined before the file, such as those from config.h.
 * @returns {{maskedText: string, macros: Map<string, object>, ranges: Array<object>, directives: Array<object>,
 *            unresolved: boolean, diagnostics: Array<object>}}
 *          Text with inactive parts and directives masked, the macros at the end of the file, the conditional
 *          state of each line range, every directive's span, whether any part could not be decided and diagnostics.
 */
function evaluatePreprocessor(text, initialMacros = new Map())
{
    const macros = new Map(initialMacros);
    const lines = splitLines(text);
    const diagnostics = [];
    const directives = [];
    const ranges = [];
    const masked = [];
    const stack = [];
    let inBlockComment = false;
    let unresolved = false;

    const report = (severity, code, message, line) =>
    {
        diagnostics.push({ severity, code, message, line });
        if (severity === SEVERITY_ERROR)
            unresolved = true;
    };

    // Adds a span in the current state, merging it with the previous span when nothing changed
    const addRange = (start, end) =>
    {
        const state = getCurrentState(stack);
        const branch = stack.map((group) => group.label);
        const previous = ranges[ranges.length - 1];
        if (previous != null && !previous.directive && previous.state === state && previous.branch.join("\n") === branch.join("\n"))
            previous.end = end;
        else
            ranges.push({ start, end, state, branch });
    };

    // Masks a span, keeping line endings so positions and line numbers stay the same
    const mask = (start, end) => masked.push({ start, end });

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++)
    {
        const line = lines[lineIndex];
        const content = text.slice(line.start, line.contentEnd);
        const directiveMatch = inBlockComment ? null : DIRECTIVE_PATTERN.exec(content);

        // Ordinary lines keep the current state and only update comment tracking
        if (directiveMatch == null)
        {
            addRange(line.start, line.end);
            if (getCurrentState(stack) !== STATE_ACTIVE)
                mask(line.start, line.end);
            inBlockComment = scanCommentState(content, inBlockComment);
            continue;
        }

        // Join continuation lines into one directive
        let lastIndex = lineIndex;
        let directiveText = content;
        while (directiveText.endsWith("\\") && lastIndex + 1 < lines.length)
        {
            lastIndex++;
            directiveText = directiveText.slice(0, -1) + " " + text.slice(lines[lastIndex].start, lines[lastIndex].contentEnd);
        }

        const start = line.start;
        const end = lines[lastIndex].end;
        const lineNumber = lineIndex + 1;
        const stripped = stripDirectiveComments(directiveText);
        const [, name, argument] = DIRECTIVE_PATTERN.exec(stripped.text);
        const stateBefore = getCurrentState(stack);
        inBlockComment = stripped.opensBlockComment;
        lineIndex = lastIndex;

        directives.push({ start, end, line: lineNumber, name, text: directiveText.trim() });
        mask(start, end);

        try
        {
            // Conditionals are tracked even inside inactive text so nesting stays balanced
            if (CONDITIONAL_OPENERS.has(name))
            {
                const opener = `#${name} ${argument.trim()}`;
                const group = { opener, label: opener, parentState: stateBefore, state: stateBefore, taken: false, undecidable: false, sawElse: false };
                stack.push(group);

                // Only a group inside compiled text chooses a branch
                if (stateBefore === STATE_ACTIVE)
                    chooseBranch(group, () => (name === "if" ? evaluateCondition(argument, macros)
                        : macros.has(readMacroName(argument)) === (name === "ifdef")));
            }
            else if (name === "elif" || name === "else")
            {
                const group = stack[stack.length - 1];
                if (group == null || group.sawElse)
                    throw new PreprocessorError("PREPROCESSOR_UNBALANCED", `#${name} has no matching #if.`);

                group.label = `#${name}${name === "elif" ? ` ${argument.trim()}` : ""} (${group.opener})`;
                group.sawElse = name === "else";

                // Once a branch was taken, or the group could not be decided, later branches cannot be compiled
                if (group.parentState !== STATE_ACTIVE)
                    group.state = group.parentState;
                else if (group.undecidable)
                    group.state = STATE_UNKNOWN;
                else if (group.taken)
                    group.state = STATE_INACTIVE;
                else
                    chooseBranch(group, () => name === "else" || evaluateCondition(argument, macros));
            }
            else if (name === "endif")
            {
                if (stack.length === 0)
                    throw new PreprocessorError("PREPROCESSOR_UNBALANCED", "#endif has no matching #if.");

                stack.pop();
            }
            else if (stateBefore === STATE_ACTIVE)
            {
                // Other directives only matter where the compiler would see them
                if (name === "define")
                {
                    const match = DEFINE_PATTERN.exec(argument.trim());
                    if (match == null)
                        throw new PreprocessorError("PREPROCESSOR_UNSUPPORTED", "#define must be followed by a macro name.");

                    const functionLike = match[2] != null;
                    const body = functionLike ? "" : argument.trim().slice(match[1].length).trim();
                    macros.set(match[1], { body, functionLike, line: lineNumber });
                }
                else if (name === "undef")
                    macros.delete(readMacroName(argument));
                else if (name === "error")
                    report(SEVERITY_WARNING, "PREPROCESSOR_ERROR_DIRECTIVE", `The file contains an active #error: ${argument.trim()}`, lineNumber);
                else if (!IGNORED_DIRECTIVES.has(name))
                    report(SEVERITY_WARNING, "PREPROCESSOR_UNKNOWN_DIRECTIVE", `#${name} is not a directive the editor recognizes.`, lineNumber);
            }
        }
        catch (error)
        {
            if (!(error instanceof PreprocessorError))
                throw error;

            report(SEVERITY_ERROR, error.code, `Line ${lineNumber}: ${error.message}`, lineNumber);
        }

        // The directive line belongs to the state that was current before it
        ranges.push({ start, end, state: stateBefore, branch: [], directive: true });
    }

    if (stack.length > 0)
        report(SEVERITY_ERROR, "PREPROCESSOR_UNBALANCED", `${stack.length} conditional block(s) are missing #endif.`, lines.length);

    // Build the masked text, keeping line endings in place
    let maskedText = "";
    let cursor = 0;
    for (const { start, end } of masked)
    {
        maskedText += text.slice(cursor, start) + text.slice(start, end).replace(/[^\r\n]/g, MASK_CHARACTER);
        cursor = end;
    }
    maskedText += text.slice(cursor);

    return { maskedText, macros, ranges, directives, unresolved, diagnostics };
}
module.exports.evaluatePreprocessor = evaluatePreprocessor;

/**
 * Returns the conditional range containing an offset.
 *
 * @param {Array<object>} ranges The ranges from evaluatePreprocessor.
 * @param {number} offset The text offset.
 * @returns {object|null} The range.
 */
function findRange(ranges, offset)
{
    let low = 0;
    let high = ranges.length - 1;

    while (low <= high)
    {
        const middle = (low + high) >> 1;
        if (offset < ranges[middle].start)
            high = middle - 1;
        else if (offset >= ranges[middle].end)
            low = middle + 1;
        else
            return ranges[middle];
    }

    return null;
}
module.exports.findRange = findRange;
