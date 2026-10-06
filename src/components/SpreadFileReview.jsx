import React, { useState } from "react";
import { Alert, Box, Button, MenuItem, Pagination, Paper, Stack, TextField, Typography } from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import SpreadCard, { getSpreadHighlights } from "./SpreadCard";
import { useSpreadEditor } from "../SpreadEditorState";
import { getSetLabel } from "../../shared/spread-layout.mjs";

const PAGE_SIZES = [6, 12, 24];
const MIN_CARD_WIDTH = 340;
const CARD_GAP = 8;
const EMPTY_ARRAY = [];
const PREVIEW_ACTIONS = {};
const VERSION_ORIGINAL = "original";
const VERSION_CURRENT = "current";
const VERSION_INCOMING = "incoming";
const COLUMNS = [VERSION_ORIGINAL, VERSION_CURRENT, VERSION_INCOMING];
const VERSION_LABELS = { [VERSION_ORIGINAL]: "Original", [VERSION_CURRENT]: "Current", [VERSION_INCOMING]: "Incoming" };
const CHOICE_LABELS = { [VERSION_CURRENT]: "Keep Current", [VERSION_INCOMING]: "Keep Incoming" };
const SOURCE_CHANGES_LABEL = "Source Changes";
const STRUCTURAL_WARNING = "This structural conflict applies to the whole file.";
const MIN_PLACEHOLDER_HEIGHT = 160;
const PAGE_SIZE_WIDTH = 180;
const COLUMN_HEADING_WEIGHT = 700;
const SOURCE_FONT_SIZE = "0.75rem";


/**
 * Expands structural comparisons into bounded individual card rows.
 * @param {Array<object>} comparisons Whole-spread or structural comparisons.
 * @returns {Array<object>} Card-sized comparison rows.
 */
function comparisonRows(comparisons)
{
    return comparisons.flatMap((comparison, comparisonIndex) =>
    {
        const spreads = comparison.spreads ?? { original: [], current: [], incoming: [] };
        const count = Math.max(1, spreads.original.length, spreads.current.length, spreads.incoming.length);
        return Array.from({ length: count }, (_, index) =>
        {
            const versions = { original: spreads.original[index], current: spreads.current[index], incoming: spreads.incoming[index] };
            return { ...comparison, versions, structural: comparison.structural || count > 1,
                setName: (versions.original ?? versions.incoming ?? versions.current)?.set.name ?? comparison.setName ?? SOURCE_CHANGES_LABEL,
                key: `${comparison.id ?? comparisonIndex}:${index}` };
        });
    });
}

/**
 * Displays paginated original/current/incoming conflict triples.
 * @param {object} props The review properties.
 * @param {object} props.preview The parsed server preview.
 * @param {Function} props.onChoose Selects a complete current or incoming spread.
 * @param {boolean} props.busy Whether import is running.
 * @returns {JSX.Element} The grouped comparison grid.
 */
export default function SpreadFileReview({ preview, onChoose, busy })
{
    const { state } = useSpreadEditor();
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
    // Order rows by file, then by set position, with unknown sets last
    const rows = comparisonRows(preview.conflicts);
    const files = state.workspace.spreads.files.map((file) => file.path);
    const sets = state.workspace.spreads.sets;
    rows.sort((first, second) =>
    {
        const fileOrder = files.indexOf(first.file) - files.indexOf(second.file);
        if (fileOrder)
            return fileOrder;
        const firstSet = sets.findIndex((set) => set.file === first.file && set.name === first.setName);
        const secondSet = sets.findIndex((set) => set.file === second.file && set.name === second.setName);
        return (firstSet < 0 ? Number.MAX_SAFE_INTEGER : firstSet) - (secondSet < 0 ? Number.MAX_SAFE_INTEGER : secondSet);
    });
    // Slice the visible page, clamping when conflicts shrink the page count
    const pages = Math.max(1, Math.ceil(rows.length / pageSize));
    const currentPage = Math.min(page, pages);
    const visible = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
    return <Stack spacing={2}>
        <Typography variant="body2" role="status">{preview.conflicts.length} {preview.conflicts.length === 1 ? "conflict" : "conflicts"}.</Typography>
        {rows.length === 0 && <Alert severity="info">No conflicts.</Alert>}
        {rows.length > 0 && <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap", alignItems: "center", gap: 1 }}>
            <Pagination count={pages} page={currentPage} onChange={(_, value) => setPage(value)} aria-label="Spread Comparison Pagination" />
            <TextField select size="small" label="Comparisons Per Page" value={pageSize} sx={{ minWidth: PAGE_SIZE_WIDTH }}
                onChange={(event) =>
                {
                    setPageSize(Number(event.target.value));
                    setPage(1);
                }}>
                {PAGE_SIZES.map((size) => <MenuItem key={size} value={size}>{size}</MenuItem>)}
            </TextField>
        </Stack>}
        {visible.map((row, rowIndex) =>
        {
            const previous = visible[rowIndex - 1];
            const heading = !previous || previous.file !== row.file || previous.setName !== row.setName;
            return <Stack key={row.key} spacing={1.5}>
                {heading && <Box className="spread-section-heading">
                    <Typography component="h3" variant="subtitle1" className="spread-section-title">{getSetLabel(row.setName)}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>{row.file}</Typography>
                </Box>}
                {row.structural && <Alert severity="warning">{STRUCTURAL_WARNING}</Alert>}
                <Box sx={{ overflowX: "auto", pb: 0.5 }}>
                    <Box className="spread-import-comparison-row" data-columns={COLUMNS.length}
                        sx={{ display: "grid", gridTemplateColumns: `repeat(${COLUMNS.length}, minmax(0, 1fr))`,
                            minWidth: COLUMNS.length * MIN_CARD_WIDTH + (COLUMNS.length - 1) * CARD_GAP, gap: 1 }}>
                        {COLUMNS.map((column) =>
                        {
                            const version = row.versions[column];
                            const set = version ? sets.find((candidate) => candidate.file === row.file && candidate.name === version.set.name) ?? version.set : null;
                            return <Stack key={column} spacing={1} sx={{ minWidth: 0 }}>
                                <Typography component="h4" variant="h6" sx={{ fontWeight: COLUMN_HEADING_WEIGHT,
                                    borderBottom: 2, borderColor: "divider", pb: 0.5 }}>{VERSION_LABELS[column]}</Typography>
                                {version ? <SpreadCard readOnly entry={{ id: `${row.key}:${column}`, fields: version.fields, editable: true,
                                        diagnostics: version.diagnostics ?? EMPTY_ARRAY, placeholder: version.placeholder, line: version.line ?? 0 }}
                                    fields={version.fields} set={set} catalog={state.catalog} preview={state.preview}
                                    teamTypes={state.workspace.spreads.teamTypes ?? EMPTY_ARRAY} editing={false} changed={false}
                                    highlightedFields={column === VERSION_ORIGINAL ? null : getSpreadHighlights(version.fields, row.versions.original?.fields)}
                                    problems={EMPTY_ARRAY} actions={PREVIEW_ACTIONS} />
                                    : <Paper variant="outlined" sx={{ p: 2, minHeight: MIN_PLACEHOLDER_HEIGHT }}>
                                        {!row.versions.original && !row.versions.current && !row.versions.incoming && row[column]
                                            ? <Box component="pre" sx={{ m: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: SOURCE_FONT_SIZE }}>{row[column]}</Box>
                                            : <Typography variant="body2">{column === VERSION_INCOMING ? "Removed" : "Not Present"}</Typography>}
                                    </Paper>}
                                {column !== VERSION_ORIGINAL && <Button color="focus" variant="outlined" startIcon={<CheckIcon />}
                                    disabled={busy} onClick={() => onChoose(row.id, column)}>
                                    {CHOICE_LABELS[column]}
                                </Button>}
                            </Stack>;
                        })}
                    </Box>
                </Box>
            </Stack>;
        })}
        {pages > 1 && <Pagination count={pages} page={currentPage} onChange={(_, value) => setPage(value)} aria-label="Spread Comparison Pagination Bottom" />}
    </Stack>;
}
