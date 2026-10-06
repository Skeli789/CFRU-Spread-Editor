/**
 * Whole-spread three-way comparisons, isolated from the API event loop.
 */
const { parentPort, workerData } = require("worker_threads");
const crypto = require("crypto");
const { diffIndices } = require("node-diff3");
const { StatusCode } = require("status-code-enum");
const { ApiError } = require("../middleware/errors");
const { parseSpreadFile, SPREAD_FIELDS } = require("./spread-parser");
const { PROGRESS_LABELS } = require("./progress");

const MAX_MERGE_UNITS = 20000;
const PARSING_PROGRESS_LIMIT = 60;
const MATCHING_PROGRESS_LIMIT = 95;
const PROGRESS_ENTRY_INTERVAL = 128;
const INVALID_ARCHIVE = "ARCHIVE_INVALID";
const SOURCE_CHANGES_LABEL = "Source Changes";
const LITTLE_CUP_SET = "gLittleCupSpreads";
const COMPLETE_PERCENTAGE = 100;


/**
 * Tokenizes parsed spread initializers and source gaps while avoiding repeated gap matches.
 * @param {Uint8Array} bytes Source bytes.
 * @param {Map<string, object>} macros Destination configuration macros.
 * @param {string} file The owned header name.
 * @param {object} [currentSpreads] The effective editor spreads that supply current entry IDs.
 * @returns {object} Source units, lookup tokens, and formatting.
 */
function sourceUnits(bytes, macros, file, currentSpreads)
{
    // Require lossless UTF-8 and normalize line endings
    const buffer = Buffer.from(bytes);
    const original = buffer.toString("utf8");
    if (!Buffer.from(original, "utf8").equals(buffer))
        throw new ApiError(StatusCode.ClientErrorUnprocessableEntity, INVALID_ARCHIVE, "Smart import requires lossless UTF-8 spread files.");
    const text = original.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n");
    // Parse the header and require a reliable result
    const parsed = parseSpreadFile(text, macros);
    if (!parsed.editable || parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error"))
        throw new ApiError(StatusCode.ClientErrorUnprocessableEntity, INVALID_ARCHIVE, "A spread file cannot be parsed reliably for smart import.");
    const entries = parsed.sets.flatMap((set) => set.entries.map((entry) => ({ ...entry, set })))
        .sort((first, second) => first.start - second.start);
    // Split the source into spread units and the gaps between them
    const units = [];
    const occurrences = new Map();
    let offset = 0;
    for (const entry of entries)
    {
        if (entry.start > offset)
            units.push({ text: text.slice(offset, entry.start), label: null });
        const label = `${entry.fields.species} / ${entry.set.name}`;
        const occurrence = occurrences.get(label) ?? 0;
        occurrences.set(label, occurrence + 1);
        const currentSet = currentSpreads?.sets.find((set) => set.file === file && set.name === entry.set.name);
        const position = entry.set.entries.findIndex((candidate) => candidate.start === entry.start);
        const version = { fields: entry.fields, line: entry.line, diagnostics: entry.diagnostics, placeholder: entry.placeholder,
            entryId: currentSet?.entryIds[position],
            set: currentSet ?? { name: entry.set.name, file, littleCup: entry.set.name === LITTLE_CUP_SET } };
        units.push({ text: text.slice(entry.start, entry.end), label, identity: `${label}:${occurrence}`, version });
        offset = entry.end;
    }
    if (offset < text.length)
        units.push({ text: text.slice(offset), label: null });
    if (units.length > MAX_MERGE_UNITS)
        throw new ApiError(StatusCode.ClientErrorUnprocessableEntity, "MERGE_LIMIT", "This file contains too many source blocks for smart import.");

    // Build diff tokens for each unit
    // Neighbor identities keep repeated commas and whitespace from dominating diff matching.
    const tokens = units.map((unit, index) => unit.label ? JSON.stringify(["spread", unit.version.set.name, unit.text])
        : JSON.stringify(["source", units[index - 1]?.identity ?? "start", units[index + 1]?.identity ?? "end", unit.text]));
    return { text, units, tokens, bom: original.startsWith("\uFEFF"), lineEnding: original.includes("\r\n") ? "\r\n" : "\n" };
}

/**
 * Returns changed source ranges without combining distinct spread decisions.
 * @param {object} original The exported source.
 * @param {object} changed The incoming source.
 * @returns {Array<object>} Indexed changed ranges.
 */
function changedRanges(original, changed)
{
    return diffIndices(original.tokens, changed.tokens);
}

/**
 * Detects reorder or duplicated-identity ambiguity before guessing spread correspondence.
 * @param {object} original The exported source.
 * @param {object} local The current source.
 * @param {object} remote The incoming source.
 * @returns {string|null} A structural review label, if needed.
 */
function structuralConflict(original, local, remote)
{
    // Count identical spreads in the exported source
    const counts = new Map();
    for (const unit of original.units.filter((unit) => unit.label))
    {
        const key = JSON.stringify([unit.label, unit.text]);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    // Find spreads each side removed or added, flagging moves in the incoming side
    const touched = [];
    for (const source of [local, remote])
    {
        const removed = new Set();
        const added = new Set();
        const labels = new Set();
        for (const range of changedRanges(original, source))
        {
            for (const unit of original.units.slice(range.buffer1[0], range.buffer1[0] + range.buffer1[1]))
            {
                if (!unit.label)
                    continue;
                removed.add(unit.text);
                labels.add(JSON.stringify([unit.label, unit.text]));
            }
            for (const unit of source.units.slice(range.buffer2[0], range.buffer2[0] + range.buffer2[1]))
            {
                if (unit.label)
                    added.add(unit.text);
            }
        }
        if (source === remote && [...removed].some((text) => added.has(text)))
            return local.text === original.text ? "Spread Order Changes" : "Spread Order And Concurrent Edits";
        touched.push(labels);
    }
    // Flag duplicates that both sides changed
    if ([...counts].some(([key, count]) => count > 1 && touched.every((labels) => labels.has(key))))
        return "Ambiguous Duplicate Spreads";
    return null;
}

/**
 * Computes one header's complete-spread comparisons and source replacement pieces.
 * @param {object} data The header bytes and macros.
 * @param {Function} [onProgress] Reports completed parsing and comparison stages.
 * @returns {object} Parsed comparisons, conflicts, and replacement pieces.
 */
function buildFilePreview({ file, baselineBytes, localBytes, incomingBytes, macros, currentSpreads }, onProgress)
{
    // Parse the baseline, current and incoming sources
    const parsingBytes = baselineBytes.length + localBytes.length + incomingBytes.length;
    const original = sourceUnits(baselineBytes, macros, file);
    onProgress?.({ percentage: Math.floor(PARSING_PROGRESS_LIMIT * baselineBytes.length / parsingBytes), label: PROGRESS_LABELS.currentSpreads });
    const local = sourceUnits(localBytes, macros, file, currentSpreads);
    onProgress?.({ percentage: Math.floor(PARSING_PROGRESS_LIMIT * (baselineBytes.length + localBytes.length) / parsingBytes), label: PROGRESS_LABELS.incomingSpreads });
    const remote = sourceUnits(incomingBytes, macros, file);
    onProgress?.({ percentage: PARSING_PROGRESS_LIMIT, label: PROGRESS_LABELS.compareSpreads });
    const changes = [];
    const conflicts = [];

    /**
     * Creates a display row containing parsed card versions, retaining source for application.
     * @param {Array<object>} before The exported units.
     * @param {Array<object>} current The current units.
     * @param {Array<object>} after The incoming units.
     * @returns {object} A review row.
     */
    function row(before, current, after)
    {
        const versions = [before, current, after].map((units) => units.filter((unit) => unit.version).map((unit) => unit.version));
        return { file, setName: versions.flat().find((version) => version.set)?.set.name ?? SOURCE_CHANGES_LABEL,
            label: [...new Set([...before, ...after].map((unit) => unit.label).filter(Boolean))].join(", ") || SOURCE_CHANGES_LABEL,
            original: before.map((unit) => unit.text).join(""), current: current.map((unit) => unit.text).join(""), incoming: after.map((unit) => unit.text).join(""),
            spreads: { original: versions[0], current: versions[1], incoming: versions[2] } };
    }

    /**
     * Adds an explicit whole-spread or structural conflict without merging its fields.
     * @param {Array<object>} before The exported units.
     * @param {Array<object>} current The current units.
     * @param {Array<object>} after The incoming units.
     * @param {boolean} [conflict=false] Whether the row is a conflict.
     * @param {string|null} [afterEntryId=null] The entry an addition follows.
     * @returns {void} Nothing.
     */
    function addDecision(before, current, after, conflict = false, afterEntryId = null)
    {
        const rows = conflict ? conflicts : changes;
        const comparison = { ...row(before, current, after), id: `${file}:${conflict ? "conflict" : "change"}:${rows.length}` };
        const currentVersion = current[0]?.version;
        const incomingVersion = after[0]?.version;
        const set = currentSpreads?.sets.find((set) => set.file === file && set.name === (incomingVersion ?? before[0]?.version)?.set.name);
        comparison.operations = incomingVersion
            ? currentVersion ? [{ type: "update", entryId: currentVersion.entryId,
                fields: Object.fromEntries(SPREAD_FIELDS.map((field) => field.name)
                    .filter((field) => JSON.stringify(currentVersion.fields[field]) !== JSON.stringify(incomingVersion.fields[field]))
                    .map((field) => [field, incomingVersion.fields[field]])) }]
                : [{ type: "add", tempId: `new-${crypto.randomUUID()}`, setId: set?.id, afterEntryId, fields: incomingVersion.fields }]
            : currentVersion ? [{ type: "delete", entryId: currentVersion.entryId }] : [];
        rows.push(comparison);
    }

    // Exit early when the incoming file adds nothing
    if (remote.text === original.text || remote.text === local.text)
        return { changes: [], conflicts: [], filePlan: null };

    // Report reorders and ambiguous duplicates as one structural conflict
    const structural = structuralConflict(original, local, remote);
    if (structural)
    {
        conflicts.push({ ...row(original.units, local.units, remote.units), id: `${file}:conflict:0`, label: structural,
            structural: true, incomingSource: remote.text });
    }
    else
    {
        const matchingUnits = [...original.units, ...remote.units].filter((unit) => unit.version).length;
        let completedUnits = 0;

        /** Reports actual matched spreads without flooding the parent worker channel. */
        function reportMatchedUnit()
        {
            completedUnits++;
            if (completedUnits % PROGRESS_ENTRY_INTERVAL === 0 || completedUnits === matchingUnits)
                onProgress?.({ percentage: Math.floor(PARSING_PROGRESS_LIMIT
                    + (MATCHING_PROGRESS_LIMIT - PARSING_PROGRESS_LIMIT) * completedUnits / matchingUnits), label: PROGRESS_LABELS.compareSpreads });
        }

        // Match spreads set by set across the three versions
        const setNames = new Set([...original.units, ...remote.units].filter((unit) => unit.version).map((unit) => unit.version.set.name));
        for (const setName of setNames)
        {
            const before = original.units.filter((unit) => unit.version?.set.name === setName);
            const current = local.units.filter((unit) => unit.version?.set.name === setName);
            const after = remote.units.filter((unit) => unit.version?.set.name === setName);
            const currentMatches = matchEntries(before.map((unit) => unit.version), current.map((unit) => unit.version));
            const incomingMatches = matchEntries(before.map((unit) => unit.version), after.map((unit) => unit.version));
            const currentByOriginal = new Map([...currentMatches].map(([target, source]) => [source, current[target]]));
            const incomingByOriginal = new Map([...incomingMatches].map(([target, source]) => [source, after[target]]));
            const equal = (first, second) => JSON.stringify(first?.version.fields) === JSON.stringify(second?.version.fields);
            // Compare each exported spread with its current and incoming counterparts
            for (const [index, unit] of before.entries())
            {
                reportMatchedUnit();
                const currentUnit = currentByOriginal.get(index);
                const incomingUnit = incomingByOriginal.get(index);
                if (equal(unit, incomingUnit) || equal(currentUnit, incomingUnit))
                    continue;
                addDecision([unit], currentUnit ? [currentUnit] : [], incomingUnit ? [incomingUnit] : [], !equal(unit, currentUnit));
            }
            // Add incoming spreads after their anchor unless already added locally
            const localAdditions = current.filter((_, index) => !currentMatches.has(index));
            let anchor = null;
            for (const [index, unit] of after.entries())
            {
                reportMatchedUnit();
                const originalIndex = incomingMatches.get(index);
                if (originalIndex != null)
                {
                    anchor = currentByOriginal.get(originalIndex)?.version.entryId ?? anchor;
                    continue;
                }
                const alreadyPresent = localAdditions.findIndex((candidate) => equal(candidate, unit));
                if (alreadyPresent >= 0)
                {
                    anchor = localAdditions[alreadyPresent].version.entryId ?? anchor;
                    localAdditions.splice(alreadyPresent, 1);
                    continue;
                }
                addDecision([], [], [unit], false, anchor);
            }
        }
    }
    // Group additions sharing an anchor so they keep their incoming order
    const additionGroups = new Map();
    for (const comparison of changes)
    {
        const operation = comparison.operations?.find((operation) => operation.type === "add");
        if (!operation)
            continue;
        const key = JSON.stringify([operation.setId, operation.afterEntryId]);
        const group = additionGroups.get(key) ?? [];
        group.push(operation.tempId);
        additionGroups.set(key, group);
        comparison.additionOrder = group;
    }
    onProgress?.({ percentage: COMPLETE_PERCENTAGE, label: PROGRESS_LABELS.prepareComparisons });
    return { changes, conflicts, filePlan: changes.length || conflicts.length
        ? { file, bom: local.bom, lineEnding: local.lineEnding } : null };
}
module.exports.buildFilePreview = buildFilePreview;

/**
 * Matches unchanged anchors and uniquely identifiable replacements in a spread sequence.
 * @param {Array<object>} before Entries with normalized fields.
 * @param {Array<object>} after The changed entries.
 * @returns {Map<number, number>} Changed positions mapped to original positions.
 */
function matchEntries(before, after)
{
    // Anchor on unchanged spreads and pair equal-sized changed ranges by position
    const mapping = new Map();
    let oldOffset = 0;
    let newOffset = 0;
    const beforeKeys = before.map((entry) => JSON.stringify(entry.fields));
    const afterKeys = after.map((entry) => JSON.stringify(entry.fields));
    for (const range of diffIndices(beforeKeys, afterKeys))
    {
        while (oldOffset < range.buffer1[0])
            mapping.set(newOffset++, oldOffset++);
        const used = new Set();
        for (let index = 0; index < range.buffer2[1]; index++)
        {
            const target = range.buffer2[0] + index;
            const candidates = Array.from({ length: range.buffer1[1] }, (_, position) => range.buffer1[0] + position)
                .filter((position) => !used.has(position) && before[position].fields.species === after[target].fields.species);
            const position = range.buffer1[1] === range.buffer2[1] ? range.buffer1[0] + index : candidates.length === 1 ? candidates[0] : null;
            if (position != null)
            {
                mapping.set(target, position);
                used.add(position);
            }
        }
        oldOffset = range.buffer1[0] + range.buffer1[1];
        newOffset = range.buffer2[0] + range.buffer2[1];
    }
    while (newOffset < after.length)
        mapping.set(newOffset++, oldOffset++);
    // Pair leftovers with one exact-field match
    const retained = new Set(mapping.values());
    const unretainedByFields = new Map();
    for (const [position, key] of beforeKeys.entries())
    {
        if (!retained.has(position))
            unretainedByFields.set(key, [...(unretainedByFields.get(key) ?? []), position]);
    }
    for (const [index, key] of afterKeys.entries())
    {
        const matches = unretainedByFields.get(key);
        if (mapping.has(index) || matches?.length !== 1)
            continue;
        mapping.set(index, matches[0]);
        retained.add(matches[0]);
        matches.length = 0;
    }
    // Pair leftovers that are the only unmatched spread of their species on both sides
    const unretainedBySpecies = new Map();
    for (const [position, entry] of before.entries())
    {
        if (!retained.has(position))
            unretainedBySpecies.set(entry.fields.species, [...(unretainedBySpecies.get(entry.fields.species) ?? []), position]);
    }
    const unmappedCounts = new Map();
    for (const [index, entry] of after.entries())
    {
        if (!mapping.has(index))
            unmappedCounts.set(entry.fields.species, (unmappedCounts.get(entry.fields.species) ?? 0) + 1);
    }
    for (const [index, entry] of after.entries())
    {
        const candidates = unretainedBySpecies.get(entry.fields.species);
        if (mapping.has(index) || candidates?.length !== 1 || unmappedCounts.get(entry.fields.species) !== 1)
            continue;
        mapping.set(index, candidates[0]);
        retained.add(candidates[0]);
        candidates.length = 0;
        unmappedCounts.set(entry.fields.species, 0);
    }
    return mapping;
}
module.exports.matchEntries = matchEntries;

// Worker entry: compute the preview and post progress, result or error to the parent
if (parentPort && workerData)
{
    try
    {
        parentPort.postMessage({ result: buildFilePreview(workerData, (progress) => parentPort.postMessage({ progress })) });
    }
    catch (error)
    {
        parentPort.postMessage({ error: { status: error.status ?? StatusCode.ServerErrorInternal,
            code: error.code ?? "MERGE_PREVIEW_FAILED", message: error.message } });
    }
    parentPort.close();
}
