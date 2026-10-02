/**
 * This file defines the SpreadFilters component.
 * It is the sticky toolbar above the spreads: preview level, bulk actions and filters.
 */

import React, { useMemo, useState } from "react";
import
{
    Autocomplete, Badge, Button, Collapse, FormControl, FormControlLabel, InputLabel, MenuItem, Select, Stack, Switch, TextField,
    ToggleButton, ToggleButtonGroup, Box,
} from "@mui/material";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import FilterListIcon from "@mui/icons-material/FilterList";
import AddIcon from "@mui/icons-material/Add";
import IosShareIcon from "@mui/icons-material/IosShare";

import { PREVIEW_LEVELS } from "../../shared/pokemon-mechanics.mjs";
import { DEFAULT_FILTERS, FLAG_FILTER, countActiveFilters, getSetLabel, getSpreadAbility } from "../../shared/spread-layout.mjs";
import { BATTLE_TYPES, getFieldSymbol, getTeamTypeLabel } from "../../shared/spread-model.mjs";
import { GameImage, TypeIcon, getLabel, getSpeciesFormName } from "../subcomponents/CatalogDisplay";

const ALL_LABEL = "All";
const PATH_SEPARATOR = "/";
const LITTLE_CUP_SUFFIX = " (Lv. 5)";
const FILE_EXTENSION = /\.[^.]+$/;
const FILE_WORD_SEPARATOR = /[_-]+/g;
const OPTION_ICON_SIZE = 24;
const TEAM_TYPE_ANY = "DOUBLES_ANY_TEAM";

const TRAINER_KIND_LABELS = { specialTrainer: "Special Trainer", multiPartner: "Multi Partner", raidPartner: "Raid Partner" };
const BATTLE_TYPE_FILTERS =
[
    { value: BATTLE_TYPES.BOTH, label: "Singles & Doubles" },
    { value: BATTLE_TYPES.SINGLES, label: "Singles Only" },
    { value: BATTLE_TYPES.DOUBLES, label: "Doubles Only" },
];
const FLAG_FILTERS =
[
    { key: "shiny", label: "Shiny" },
    { key: "megaStone", label: "Mega Stone" },
    { key: "zCrystal", label: "Z-Crystal" },
    { key: "gigantamax", label: "Gigantamax" },
];


/**
 * Returns a file's name without its folders.
 *
 * @param {string} file The repository-relative path.
 * @returns {string} The file name.
 */
function getFileName(file)
{
    return file.split(PATH_SEPARATOR).at(-1);
}

/**
 * Returns a readable title for a spread source file.
 *
 * @param {string} file The repository-relative file path.
 * @returns {string} The readable title.
 */
export function getFileLabel(file)
{
    return getFileName(file).replace(FILE_EXTENSION, "").replace(FILE_WORD_SEPARATOR, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * Returns the ranks a trainer's sets are used for, such as Ranks 1-6, or an empty string.
 *
 * @param {object} trainer The trainer.
 * @returns {string} The rank description.
 */
function getRankLabel(trainer)
{
    const ranks = [...new Set(trainer.links.flatMap((link) => link.ranks ?? []))].sort((a, b) => a - b);
    if (ranks.length === 0)
        return "";

    const consecutive = ranks.every((rank, index) => index === 0 || rank === ranks[index - 1] + 1);
    return `, Ranks ${consecutive && ranks.length > 1 ? `${ranks[0]}-${ranks.at(-1)}` : ranks.join(", ")}`;
}

/**
 * Returns a set's readable name for the set filter and section headings, such as Special Spread Skeli.
 *
 * @param {object} set The spread set.
 * @param {string} [trainerName] The chosen trainer's name, which is then left out.
 * @returns {string} The name.
 */
export function getSetDisplayName(set, trainerName)
{
    return `${getSetLabel(set.name, trainerName)}${set.littleCup ? LITTLE_CUP_SUFFIX : ""}`;
}

/**
 * Returns the sets the set filter offers: those in the chosen file and used by the chosen trainer.
 *
 * @param {object} options The filter options.
 * @param {object} filters The filters.
 * @returns {Array<object>} The set options.
 */
function getFittingSets(options, filters)
{
    const trainer = options.trainers.find((option) => option.value === filters.trainerId) ?? null;
    return options.sets.filter((set) => (!filters.file || set.file === filters.file) && (trainer == null || trainer.setIds.has(set.value)));
}

/**
 * Builds the choices each filter offers from the loaded spreads.
 *
 * @param {object} spreads The spreads snapshot.
 * @param {object} catalog The game catalog.
 * @returns {object} The options for each filter.
 */
function buildOptions(spreads, catalog)
{
    const species = new Set();
    const moves = new Set();
    const abilities = new Set();
    const items = new Set();
    for (const { fields } of spreads.entries)
    {
        species.add(fields.species);
        fields.moves.filter((move) => typeof move === "string").forEach((move) => moves.add(move));
        items.add(getFieldSymbol(fields, "item"));
        const ability = getSpreadAbility(catalog, fields);
        if (ability != null)
            abilities.add(ability);
    }

    const byName = (section) => (values) => [...values].map((value) => ({ value, name: getLabel(section, value) })).sort((a, b) => a.name.localeCompare(b.name));
    const setsById = new Map(spreads.sets.map((set) => [set.id, set]));
    return {
        species: [...species].map((value) => ({ value, name: getSpeciesFormName(catalog, value) })).sort((a, b) => a.name.localeCompare(b.name))
            .map((option) => ({ ...option, icon: [catalog.species[option.value]?.icon, catalog.species[option.value]?.sprite?.normal,
            catalog.species[option.value]?.sprite?.fallback?.normal] })),
        moves: byName(catalog.moves)(moves).map((option) => ({ ...option, type: catalog.moves[option.value]?.type ?? null })),
        abilities: byName(catalog.abilities)(abilities),
        items: byName(catalog.items)(items).map((option) => ({ ...option, icon: catalog.items[option.value]?.icon ?? null })),
        files: spreads.files.map((file) => file.path),
        sets: spreads.sets.map((set) => ({ value: set.id, set, file: set.file })),
        trainers: spreads.trainers.map((trainer) =>
        ({
            value: trainer.id,
            name: `${trainer.name} (${TRAINER_KIND_LABELS[trainer.kind] ?? trainer.kind}${getRankLabel(trainer)})`,
            trainerName: trainer.name,
            detail: `${TRAINER_KIND_LABELS[trainer.kind] ?? trainer.kind}${getRankLabel(trainer)}`,
            group: TRAINER_KIND_LABELS[trainer.kind] ?? trainer.kind,
            files: new Set(trainer.links.map((link) => setsById.get(link.setId)?.file).filter((file) => file != null)),
            setIds: new Set(trainer.links.map((link) => link.setId)),
        })).sort((a, b) => a.group.localeCompare(b.group)),
    };
}

/**
 * A compact single-choice filter.
 *
 * @component
 * @param {Object} props - The component props
 * @param {string} props.id - A unique ID for the label.
 * @param {string} props.label - The label.
 * @param {string} props.value - The selected value, empty for no filter.
 * @param {Array<{value: string, label: string}>} props.options - The choices.
 * @param {Function} props.onChange - Called with the new value.
 * @returns {JSX.Element} The select.
 */
const FilterSelect = ({ id, label, value, options, onChange }) =>
{
    return (
        <FormControl size="small" className="filter-control">
            <InputLabel id={id}>{label}</InputLabel>
            <Select labelId={id} label={label} value={value} onChange={(event) => onChange(event.target.value)}>
                <MenuItem value="">{ALL_LABEL}</MenuItem>
                {options.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
            </Select>
        </FormControl>
    );
};

/**
 * A searchable filter choosing one or several values.
 *
 * @component
 * @param {Object} props - The component props
 * @param {string} props.label - The label.
 * @param {string|Array<string>} props.value - The selected value or values.
 * @param {Array<{value: string, name: string, group?: string}>} props.options - The choices.
 * @param {Function} props.onChange - Called with the new value or values.
 * @param {boolean} [props.multiple] - Whether several values can be chosen.
 * @param {Function} [props.renderOptionContent] - Renders an option row.
 * @returns {JSX.Element} The autocomplete.
 */
const FilterAutocomplete = ({ label, value, options, onChange, multiple = false, renderOptionContent }) =>
{
    const byValue = useMemo(() => new Map(options.map((option) => [option.value, option])), [options]);
    const selected = multiple ? value.map((item) => byValue.get(item) ?? { value: item, name: item }) : byValue.get(value) ?? null;

    return (
        <Autocomplete
            size="small"
            className="filter-control filter-control-wide"
            autoHighlight
            multiple={multiple}
            limitTags={2}
            options={options}
            value={selected}
            groupBy={options.some((option) => option.group != null) ? (option) => option.group : undefined}
            onChange={(event, choice) => onChange(multiple ? choice.map((option) => option.value) : choice?.value ?? "")}
            getOptionLabel={(option) => option.name}
            isOptionEqualToValue={(option, choice) => option.value === choice.value}
            getOptionKey={(option) => option.value}
            renderOption={renderOptionContent == null ? undefined : (props, option) =>
                <li {...props} key={option.value}><Box className="filter-option">{renderOptionContent(option)}<span>{option.optionName ?? option.name}</span></Box></li>}
            renderInput={(params) => <TextField {...params} label={label} />}
        />
    );
};

/**
 * Represents the SpreadFilters component.
 *
 * @component
 * @param {Object} props - The component props
 * @param {object} props.spreads - The spreads snapshot.
 * @param {object} props.catalog - The game catalog.
 * @param {object} props.filters - The filters, shaped like DEFAULT_FILTERS.
 * @param {Function} props.onFiltersChange - Called with the new filters.
 * @param {number} props.resultCount - How many spreads match.
 * @param {{level: number}} props.preview - The preview settings.
 * @param {Function} props.onPreviewChange - Called with changed preview settings.
 * @param {Function} props.onAutoFix - Opens the auto-fix preview.
 * @param {Function} props.onAddSpread - Opens the add dialog.
 * @param {Function} props.onExport - Opens the Showdown export of every matching spread.
 * @returns {JSX.Element} The toolbar.
 */
const SpreadFilters = ({ spreads, catalog, filters, onFiltersChange, resultCount, preview, onPreviewChange, onAutoFix, onAddSpread, onExport }) =>
{
    const [expanded, setExpanded] = useState(false);
    const options = useMemo(() => buildOptions(spreads, catalog), [spreads, catalog]);
    // The starting set counts as a filter, so clearing shows every set
    const activeCount = countActiveFilters(filters);
    const trainer = options.trainers.find((option) => option.value === filters.trainerId) ?? null;

    // Sets and trainers only offer choices that fit the file and trainer already chosen
    const setOptions = getFittingSets(options, filters).map((option) => ({ ...option, name: getSetDisplayName(option.set, trainer?.trainerName), group: getFileLabel(option.file) }));
    const trainerOptions = options.trainers.filter((option) => !filters.file || option.files.has(filters.file));
    const trainerCounts = new Map();
    trainerOptions.forEach((option) => trainerCounts.set(option.trainerName, (trainerCounts.get(option.trainerName) ?? 0) + 1));
    const labelledTrainers = trainerOptions.map((option) => ({ ...option, name: `${option.trainerName} [${option.detail}]`,
        optionName: trainerCounts.get(option.trainerName) > 1 ? `${option.trainerName} [${option.detail}]` : option.trainerName }));

    /**
     * Changes some filters. Choices that no longer fit are cleared, except a set, which becomes the first that fits.
     *
     * @param {object} changes The changed filters.
     */
    const change = (changes) =>
    {
        const next = { ...filters, ...changes };
        const nextTrainer = options.trainers.find((option) => option.value === next.trainerId);
        if (next.trainerId && next.file && !nextTrainer?.files.has(next.file))
            next.trainerId = "";

        const fitting = getFittingSets(options, next);
        if (next.setId && !fitting.some((set) => set.value === next.setId))
            next.setId = fitting[0]?.value ?? "";

        onFiltersChange(next);
    };

    return (
        <div className="spread-toolbar">
            <Stack direction="row" className="toolbar-row">
                <Badge badgeContent={activeCount} color="primary">
                    <Button size="small" startIcon={<FilterListIcon />} onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-controls="spread-filters">
                        {expanded ? "Hide Filters" : "More Filters"}
                    </Button>
                </Badge>
                <Button size="small" onClick={() => onFiltersChange(DEFAULT_FILTERS)} disabled={activeCount === 0}>Clear Filters</Button>
                <span className="toolbar-actions-spacer" />
                <ToggleButtonGroup size="small" exclusive value={preview.level} aria-label="Preview level"
                                   onChange={(event, level) => level != null && onPreviewChange({ level })}>
                    {PREVIEW_LEVELS.map((level) => <ToggleButton key={level} value={level}>Lv. {level}</ToggleButton>)}
                </ToggleButtonGroup>
                <Button variant="outlined" size="small" startIcon={<AddIcon />} onClick={onAddSpread}>Add Spread</Button>
                <Button variant="outlined" size="small" startIcon={<IosShareIcon />} onClick={onExport} disabled={resultCount === 0}>Export</Button>
                <Button variant="outlined" size="small" startIcon={<AutoFixHighIcon />} onClick={onAutoFix} disabled={resultCount === 0}>
                    Auto-Fix
                </Button>
            </Stack>
            <Collapse in={expanded} id="spread-filters">
                <Stack direction="row" className="toolbar-row toolbar-fields">
                    <FilterAutocomplete label="Species" multiple value={filters.species} options={options.species} onChange={(species) => change({ species })}
                                        renderOptionContent={(option) => <GameImage src={option.icon} alt="" decorative width={OPTION_ICON_SIZE} height={OPTION_ICON_SIZE} />} />
                    <FilterAutocomplete label="Ability" value={filters.ability} options={options.abilities} onChange={(ability) => change({ ability })} />
                    <FilterAutocomplete label="Item" value={filters.item} options={options.items} onChange={(item) => change({ item })}
                                        renderOptionContent={(option) => <GameImage src={option.icon} alt="" decorative width={OPTION_ICON_SIZE} height={OPTION_ICON_SIZE} />} />
                    <FilterAutocomplete label="Moves" multiple value={filters.moves} options={options.moves} onChange={(moves) => change({ moves })}
                                        renderOptionContent={(option) => <TypeIcon catalog={catalog} type={option.type} decorative />} />
                </Stack>
                <Stack direction="row" className="toolbar-row toolbar-row-spaced toolbar-fields">
                    {FLAG_FILTERS.map(({ key, label }) => (
                        <FilterSelect key={key} id={`filter-${key}`} label={label} value={filters[key]} onChange={(value) => change({ [key]: value })}
                                      options={[{ value: FLAG_FILTER.YES, label: "Yes" }, { value: FLAG_FILTER.NO, label: "No" }]} />
                    ))}
                    <FilterSelect id="filter-battle-type" label="Battle Type" value={filters.battleType} options={BATTLE_TYPE_FILTERS}
                                  onChange={(battleType) => change({ battleType })} />
                    {spreads.teamTypes.length > 0 &&
                        <FilterAutocomplete label="Doubles Team Type" value={filters.teamType} onChange={(teamType) => change({ teamType })}
                                      options={spreads.teamTypes.filter((teamType) => teamType.name !== TEAM_TYPE_ANY)
                                          .map((teamType) => ({ value: teamType.name, name: getTeamTypeLabel(teamType.name) }))} />}
                </Stack>
                <Stack direction="row" className="toolbar-row toolbar-row-spaced toolbar-fields">
                    <FilterSelect id="filter-file" label="File" value={filters.file} onChange={(file) => change({ file })}
                                  options={options.files.map((file) => ({ value: file, label: getFileLabel(file) }))} />
                    <FilterAutocomplete label="Spread Set" value={filters.setId} options={setOptions} onChange={(setId) => change({ setId })} />
                    <FilterAutocomplete label="Trainer" value={filters.trainerId} options={labelledTrainers} onChange={(trainerId) => change({ trainerId, setId: "" })}
                                        renderOptionContent={() => null} />
                    <FormControlLabel sx={{ pl: 1 }} control={<Switch size="small" checked={filters.unsaved} onChange={(event) => change({ unsaved: event.target.checked })} />}
                                      label="Unsaved Changes" />
                    <FormControlLabel control={<Switch size="small" checked={filters.illegalMoves} onChange={(event) => change({ illegalMoves: event.target.checked })} />}
                                      label="Illegal Moves" />
                    <FormControlLabel control={<Switch size="small" checked={filters.incompleteEvs} onChange={(event) => change({ incompleteEvs: event.target.checked })} />}
                                      label="Incomplete EVs" />
                </Stack>
            </Collapse>
        </div>
    );
};

export default SpreadFilters;
