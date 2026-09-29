/**
 * This file defines the SpreadCard component.
 * It shows one spread like the mockup: the sprite on the left with the item and ability under it, the name, types
 * and stats beside it, and the nature, ball, moves and battle settings below. Fields can be changed while editing.
 */

import React, { memo, useMemo, useState } from "react";
import
{
    Alert, Autocomplete, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormControlLabel, IconButton, InputLabel, MenuItem, Paper, Select, Stack,
    Switch, TextField, Tooltip, Typography,
} from "@mui/material";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import LockIcon from "@mui/icons-material/Lock";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";

import { LEGALITY, getMoveLegality } from "../../shared/catalog.mjs";
import
{
    LITTLE_CUP_LEVEL, calculateSpreadStats, getAbilityLabel, getAbilityOptions, getEffectiveAbility, getMegaAbility, getMegaSpecies,
    getNatureEffect, getSpreadLevel,
} from "../../shared/pokemon-mechanics.mjs";
import
{
    ANY_TEAM_TYPE, BATTLE_TYPES, MAX_MOVES, changeBattleType, getBattleType, getFieldSymbol, getTeamType, getTeamTypeLabel, setFieldSymbol,
    setMove, setTeamType,
} from "../../shared/spread-model.mjs";
import { GameImage, OverflowText, STAT_SHORT_LABELS, TypeIcon, filterBySearch, getEntry, getLabel } from "../subcomponents/CatalogDisplay";
import ItemPicker, { ITEM_NONE, NO_ITEM_LABEL } from "../subcomponents/ItemPicker";
import MoveEditor, { getMoveOption } from "../subcomponents/MovePicker";
import SpreadStats from "../subcomponents/SpreadStats";

const SPRITE_SIZE = 112;
const ICON_SIZE = 24;
const BALL_RANDOM = "BALL_TYPE_RANDOM";
const RANDOM_BALL_LABEL = "Random Ball";
const UNKNOWN_LABEL = "?";
const MEGA_ABILITY_LABEL = "[M]";
const OPEN_KEYS = ["Enter", " "];

const BATTLE_TYPE_LABELS =
{
    [BATTLE_TYPES.BOTH]: "Singles & Doubles",
    [BATTLE_TYPES.SINGLES]: "Singles Only",
    [BATTLE_TYPES.DOUBLES]: "Doubles Only",
    [BATTLE_TYPES.NEITHER]: "Neither Singles nor Doubles",
};
const BATTLE_TYPE_COLORS =
{
    [BATTLE_TYPES.BOTH]: "success",
    [BATTLE_TYPES.SINGLES]: "info",
    [BATTLE_TYPES.DOUBLES]: "secondary",
    [BATTLE_TYPES.NEITHER]: "error",
};
const SELECTABLE_BATTLE_TYPES = [BATTLE_TYPES.BOTH, BATTLE_TYPES.SINGLES, BATTLE_TYPES.DOUBLES];
const MODIFY_MOVES_LABEL = "Modify Doubles";
const KEEP_MOVES_LABEL = "Keep Doubles";

const LOCKED_REASON = "This spread's source cannot be changed safely.";
const TEAM_TYPE_WARNING = "This spread needs a doubles team type but is not Doubles Only. Set it to Any to clear it.";
const GIGANTAMAX_WARNING = "This species cannot Gigantamax.";
const DUPLICATE_MOVE = "Duplicate move";
const PLACEHOLDER_REASON = "This entry is a placeholder with no active battle spread and cannot be edited.";

const natureOptionCache = new WeakMap();
const ballOptionCache = new WeakMap();


/**
 * Returns a nature's name with the stats it changes, such as Modest (+SpA, -Atk).
 *
 * @param {object} catalog The game catalog.
 * @param {*} nature The NATURE_* constant.
 * @returns {string} The label.
 */
function getNatureLabel(catalog, nature)
{
    const effect = getNatureEffect(nature);
    const name = getLabel(catalog.natures, nature);
    return effect?.increased != null ? `${name} (+${STAT_SHORT_LABELS[effect.increased]}, -${STAT_SHORT_LABELS[effect.decreased]})` : name;
}

/**
 * Returns the game's natures as options.
 *
 * @param {object} catalog The game catalog.
 * @returns {Array<{value: string, name: string}>} The options.
 */
function getNatureOptions(catalog)
{
    if (!natureOptionCache.has(catalog))
        natureOptionCache.set(catalog, Object.keys(catalog.natures).map((value) => ({ value, name: getNatureLabel(catalog, value) })));

    return natureOptionCache.get(catalog);
}

/**
 * Returns the game's balls as options.
 *
 * @param {object} catalog The game catalog.
 * @returns {Array<{value: string, name: string, icon: string|null}>} The options.
 */
function getBallOptions(catalog)
{
    if (!ballOptionCache.has(catalog))
    {
        ballOptionCache.set(catalog, Object.entries(catalog.balls).map(([value, entry]) =>
            ({ value, name: value === BALL_RANDOM ? RANDOM_BALL_LABEL : entry.name, icon: entry.icon })));
    }

    return ballOptionCache.get(catalog);
}

/**
 * Returns rank numbers as a short range, such as 1-3.
 *
 * @param {Array<number>} ranks The ranks.
 * @returns {string} The range.
 */
function formatRanks(ranks)
{
    const consecutive = ranks.every((rank, index) => index === 0 || rank === ranks[index - 1] + 1);
    return consecutive && ranks.length > 1 ? `${ranks[0]}-${ranks.at(-1)}` : ranks.join(", ");
}

/**
 * Returns the trainers using a set, one label per trainer.
 *
 * @param {object} set The spread set.
 * @returns {Array<string>} The labels.
 */
function getTrainerLabels(set)
{
    const labels = set.usages.map((usage) => (usage.ranks?.length > 0 ? `${usage.trainerName} (Rank ${formatRanks(usage.ranks)})` : usage.trainerName));
    return [...new Set(labels)];
}

/**
 * Returns a species' distinct types.
 *
 * @param {object|null} speciesInfo The catalog species.
 * @returns {Array<string>} The TYPE_* constants.
 */
function getTypes(speciesInfo)
{
    return [...new Set((speciesInfo?.types ?? []).filter((type) => type != null))];
}

/**
 * A compact labelled select.
 *
 * @component
 * @param {Object} props - The component props
 * @param {string} props.id - A unique ID for the label.
 * @param {string} props.label - The label.
 * @param {*} props.value - The selected value.
 * @param {Function} props.onChange - Called with the new value.
 * @param {React.ReactNode} props.children - The menu items.
 * @returns {JSX.Element} The select.
 */
const CompactSelect = ({ id, label, value, onChange, children }) =>
{
    return (
        <FormControl size="small" fullWidth>
            <InputLabel id={id}>{label}</InputLabel>
            <Select labelId={id} label={label} value={value} onChange={(event) => onChange(event.target.value)}>
                {children}
            </Select>
        </FormControl>
    );
};

/**
 * A compact searchable field that always has a value.
 *
 * @component
 * @param {Object} props - The component props
 * @param {string} props.label - The label.
 * @param {*} props.value - The selected value.
 * @param {Array<{value: *, name: string, icon?: string|null}>} props.options - The choices.
 * @param {Function} props.onChange - Called with the new value.
 * @returns {JSX.Element} The autocomplete.
 */
const FieldAutocomplete = ({ label, value, options, onChange }) =>
{
    // A value the game does not name stays listed so it can be seen and kept
    const selected = options.find((option) => option.value === value);
    const choices = selected != null ? options : [{ value, name: String(value), icon: null }, ...options];
    const showIcons = options.some((option) => option.icon !== undefined);

    return (
        <Autocomplete
            size="small"
            options={choices}
            value={selected ?? choices[0]}
            disableClearable
            autoHighlight
            onChange={(event, option) => onChange(option.value)}
            filterOptions={(list, state) => filterBySearch(list, state.inputValue, (option) => option.name)}
            getOptionLabel={(option) => option.name}
            isOptionEqualToValue={(option, choice) => option.value === choice.value}
            getOptionKey={(option) => String(option.value)}
            slotProps={{ popper: { className: "wide-popper", placement: "bottom-start" } }}
            renderOption={(props, option) =>
            {
                const { key, ...optionProps } = props;
                return (
                    <li key={key} {...optionProps} className={`${optionProps.className} option-with-icon`}>
                        {showIcons && <GameImage src={option.icon ?? null} alt="" decorative width={ICON_SIZE} height={ICON_SIZE} />}
                        {option.name}
                    </li>
                );
            }}
            renderInput={(params) => <TextField {...params} label={label} slotProps={{ ...params.slotProps, input: { ...params.slotProps.input,
                startAdornment: showIcons && selected?.icon != null ? <GameImage src={selected.icon} alt="" decorative width={ICON_SIZE} height={ICON_SIZE} /> : null } }} />}
        />
    );
};

/**
 * Represents the SpreadCard component.
 *
 * @component
 * @param {Object} props - The component props
 * @param {object} props.entry - The saved spread entry.
 * @param {object} props.fields - The spread's current values.
 * @param {object} props.set - The spread's set.
 * @param {object} props.catalog - The game catalog.
 * @param {Array<{name: string, value: number|null}>} props.teamTypes - The doubles team types.
 * @param {{level: number}} props.preview - The preview level.
 * @param {boolean} props.editing - Whether the fields can be changed.
 * @param {boolean} props.changed - Whether the spread has unsaved changes.
 * @param {Array<{message: string}>} props.problems - Problems that stop the spread from being saved.
 * @param {object} props.actions - The editor actions updateSpread, setEditing and revertSpread.
 * @returns {JSX.Element} The card.
 */
const SpreadCard = ({ entry, fields, set, catalog, teamTypes, preview, editing, changed, deleted = false, problems, actions }) =>
{
    const { id } = entry;
    const [showMega, setShowMega] = useState(true);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const speciesInfo = getEntry(catalog.species, fields.species);
    const name = speciesInfo?.name ?? String(fields.species);
    const level = getSpreadLevel(set, preview.level);
    const stats = useMemo(() => calculateSpreadStats(catalog, fields, { level, mega: showMega }), [catalog, fields, level, showMega]);
    const megaSpecies = getMegaSpecies(catalog, fields);
    const megaInfo = getEntry(catalog.species, megaSpecies);
    const shownInfo = getEntry(catalog.species, stats.species);
    const types = getTypes(speciesInfo);
    const megaTypes = getTypes(megaInfo);
    const typesChange = megaInfo != null && megaTypes.join() !== types.join();
    const sprite = (megaInfo ?? speciesInfo)?.sprite;
    const sprites = fields.shiny ? [sprite?.shiny, sprite?.fallback?.shiny, sprite?.normal, sprite?.fallback?.normal] : [sprite?.normal, sprite?.fallback?.normal];
    const battleType = getBattleType(fields);
    const teamType = getTeamType(fields, teamTypes);
    const teamTypeNeedsClearing = battleType !== BATTLE_TYPES.DOUBLES && teamType !== ANY_TEAM_TYPE;
    const showTeamType = teamTypes.length > 0 && (battleType === BATTLE_TYPES.DOUBLES || teamTypeNeedsClearing);
    const teamTypeLabel = teamType != null ? getTeamTypeLabel(teamType) : String(fields.specificTeamType);
    const item = getFieldSymbol(fields, "item");
    const ball = getFieldSymbol(fields, "ball");
    const nature = getFieldSymbol(fields, "nature");
    const itemInfo = getEntry(catalog.items, item);
    const itemLabel = item === ITEM_NONE ? NO_ITEM_LABEL : getLabel(catalog.items, item);
    const ballInfo = getEntry(catalog.balls, ball);
    const ability = getEffectiveAbility(speciesInfo, fields.ability);
    const megaAbility = getMegaAbility(catalog, fields);
    const canGigantamax = speciesInfo?.gigantamax != null;
    const trainers = getTrainerLabels(set);
    const inputId = `spread-${id}`;
    const warnings = entry.diagnostics;

    /**
     * Changes the spread's values.
     *
     * @param {Function} change Called with the current values, the saved values and the remembered Modify Moves
     *        Doubles value; returns the new values.
     */
    const update = (change) => actions.updateSpread(id, change);
    const canOpen = !editing && !deleted && entry.editable;

    /**
     * Starts editing when the card is clicked outside its buttons and inputs.
     *
     * @param {React.MouseEvent} event The click.
     */
    const handleClick = (event) =>
    {
        if (canOpen && event.target.closest("button, a, input, [role='button']") == null)
            actions.setEditing(id, true);
    };

    /**
     * Starts editing when Enter or Space is pressed on the focused card.
     *
     * @param {React.KeyboardEvent} event The key press.
     */
    const handleKeyDown = (event) =>
    {
        if (canOpen && event.target === event.currentTarget && OPEN_KEYS.includes(event.key))
        {
            event.preventDefault();
            actions.setEditing(id, true);
        }
    };

    const abilityLabel = (slot, abilityName) => `${getAbilityLabel(slot)} ${getLabel(catalog.abilities, abilityName ?? UNKNOWN_LABEL)}`.trim();
    const megaAbilityName = megaAbility == null ? null : getLabel(catalog.abilities, megaAbility.ability ?? UNKNOWN_LABEL);
    const abilityOptions = getAbilityOptions(speciesInfo).map((option) => ({ value: option.slot,
        name: `${abilityLabel(option.slot, option.ability)}${megaAbilityName != null && option.ability !== megaAbility.ability ? ` → ${MEGA_ABILITY_LABEL} ${megaAbilityName}` : ""}` }));
    const megaToggle = megaAbility != null &&
        <FormControlLabel label="Mega Stats" labelPlacement="start" control={<Switch size="small" checked={showMega} onChange={(event) => setShowMega(event.target.checked)} />} />;
    const trainerChips = trainers.map((trainer) => <Chip key={trainer} size="small" variant="outlined" label={trainer} />);
    const battleChips =
        <div className="battle-chips">
            {entry.placeholder && <Tooltip title={PLACEHOLDER_REASON}><Chip size="small" label="Placeholder" color="warning" /></Tooltip>}
            {trainerChips}
            <Chip size="small" color={BATTLE_TYPE_COLORS[battleType]} label={BATTLE_TYPE_LABELS[battleType]} />
            {battleType === BATTLE_TYPES.BOTH &&
                <Chip size="small" color={fields.modifyMovesDoubles ? "warning" : "default"} label={fields.modifyMovesDoubles ? MODIFY_MOVES_LABEL : KEEP_MOVES_LABEL} />}
            {showTeamType && teamType !== ANY_TEAM_TYPE && <Chip size="small" color="primary" label={`Doubles Team: ${teamTypeLabel}`} />}
            {set.littleCup && <Chip size="small" color="info" label={`Lv. ${LITTLE_CUP_LEVEL}`} />}
        </div>;

    return (
        <Paper component="article" variant="outlined" className={`spread-card${editing && !deleted ? " spread-card-editing" : ""}${changed ? " spread-card-changed" : ""}${deleted ? " spread-card-deleted" : ""}${entry.editable ? "" : " spread-card-locked"}`}
               aria-label={`${name} spread`} onClick={handleClick} onKeyDown={handleKeyDown} tabIndex={canOpen ? 0 : undefined}>
            {deleted && <div className="spread-deleted-overlay"><Button variant="contained" onClick={() => actions.restoreSpread(id)}>Restore</Button></div>}
            <div className="spread-card-content" inert={deleted}>
            <div className="spread-card-side">
                <GameImage src={sprites} alt={megaInfo?.name ?? name} width={SPRITE_SIZE} height={SPRITE_SIZE} className="spread-sprite" />
                {editing
                    ? <>
                        <FieldAutocomplete label="Ball" value={ball} options={getBallOptions(catalog)}
                                           onChange={(value) => update((current, saved) => setFieldSymbol(current, "ball", value, saved))} />
                        <div className="spread-side-checks">
                            <FormControlLabel control={<Checkbox size="small" checked={fields.shiny === true} onChange={(event) => update((current) => ({ ...current, shiny: event.target.checked }))} />}
                                              label="Shiny" slotProps={{ typography: { variant: "body2" } }} />
                            {(canGigantamax || fields.gigantamax) &&
                                <FormControlLabel control={<Checkbox size="small" checked={fields.gigantamax === true} onChange={(event) => update((current) => ({ ...current, gigantamax: event.target.checked }))} />}
                                                  label="Gigantamax" slotProps={{ typography: { variant: "body2" } }} />}
                        </div>
                    </>
                    : <>
                        {ball != null && ball !== BALL_RANDOM &&
                            <span className="option-with-icon spread-side-value side-ball">
                                <GameImage src={ballInfo?.icon ?? null} alt="" decorative width={ICON_SIZE} height={ICON_SIZE} />
                                <OverflowText className="side-value-text" text={getLabel(catalog.balls, ball)} />
                            </span>}
                        <span className="option-with-icon spread-side-value side-item">
                            {item !== ITEM_NONE ? <GameImage src={itemInfo?.icon ?? null} alt="" decorative width={ICON_SIZE} height={ICON_SIZE} /> : <span className="ability-slot" />}
                            <OverflowText className="side-value-text" text={itemLabel} />
                        </span>
                        <span className="option-with-icon spread-side-value side-ability">
                            <span className="ability-slot">{getAbilityLabel(fields.ability)}</span>
                            <OverflowText className="side-value-text" text={getLabel(catalog.abilities, ability ?? UNKNOWN_LABEL)} />
                        </span>
                        {megaAbilityName != null &&
                            <strong className="option-with-icon spread-side-value side-mega-ability">
                                <span className="ability-slot">{MEGA_ABILITY_LABEL}</span>
                                <OverflowText className="side-value-text" text={megaAbilityName} />
                            </strong>}
                        <span className="option-with-icon spread-side-value side-nature">
                            <span className="ability-slot" />
                            <OverflowText className="side-value-text" text={getLabel(catalog.natures, nature)} />
                        </span>
                    </>}
            </div>

            <div className="spread-card-header">
                <Stack direction="row" spacing={0.5} className="spread-card-title">
                    {!editing && fields.shiny && <Tooltip title="Shiny"><span role="img" aria-label="Shiny"><AutoAwesomeIcon fontSize="small" className="shiny-icon" /></span></Tooltip>}
                    {!editing && fields.gigantamax &&
                        <Tooltip title="Gigantamax">
                            <span className="option-with-icon"><GameImage src={catalog.assets?.gigantamax ?? null} alt="Gigantamax" width={ICON_SIZE} height={ICON_SIZE} /></span>
                        </Tooltip>}
                    <Tooltip title={`${set.file}, line ${entry.line}`}>
                        <Typography component="h3" variant="subtitle1" className="spread-name" aria-label={name}>{name}</Typography>
                    </Tooltip>
                    {types.map((type) => <TypeIcon key={type} catalog={catalog} type={type} full={editing && !typesChange} />)}
                    {typesChange &&
                        <>
                            <Tooltip title="Mega Evolves To"><span role="img" aria-label="Mega Evolves To" className="type-symbol"><ArrowForwardIcon fontSize="small" /></span></Tooltip>
                            {megaTypes.map((type) => <TypeIcon key={type} catalog={catalog} type={type} full={editing} />)}
                        </>}
                    <span className="spread-card-actions">
                        {warnings.length > 0 &&
                            <Tooltip title={warnings.map((diagnostic) => diagnostic.message).join(" ")}>
                                <span role="img" aria-label="Source warnings" className="type-symbol"><WarningAmberIcon color="warning" fontSize="small" /></span>
                            </Tooltip>}
                        {!entry.editable
                            ? <Tooltip title={entry.placeholder ? PLACEHOLDER_REASON : LOCKED_REASON}>
                                <span role="img" aria-label={entry.placeholder ? "Placeholder" : LOCKED_REASON}><LockIcon fontSize="small" color="disabled" /></span>
                            </Tooltip>
                            : null}
                        {changed && <Button size="small" variant="outlined" color="warning" onClick={() => actions.revertSpread(id)} aria-label={`Revert ${name}`}>Revert</Button>}
                        {editing && entry.editable && <Tooltip title={`Delete ${name}`}>
                            <IconButton size="small" color="error" aria-label={`Delete ${name}`} onClick={() => setConfirmDelete(true)}><DeleteOutlineIcon fontSize="small" /></IconButton>
                        </Tooltip>}
                    </span>
                </Stack>
                <div className="spread-card-subtitle">
                    {!editing && battleChips}
                    {editing &&
                        <>
                            <div className="spread-badges">
                                {entry.placeholder && <Tooltip title={PLACEHOLDER_REASON}><Chip size="small" label="Placeholder" color="warning" /></Tooltip>}
                                {trainerChips}
                            </div>
                            {megaToggle}
                        </>}
                </div>
            </div>

            <div className="spread-card-stats">
                <SpreadStats
                    fields={fields}
                    preview={stats}
                    baseStats={shownInfo?.baseStats ?? null}
                    littleCup={set.littleCup ? { species: stats.species, baseStats: shownInfo?.baseStats ?? null, level } : null}
                    editing={editing}
                    onChange={update}
                    name={name}
                    catalog={catalog}
                />
            </div>

            {(editing || (fields.gigantamax && !canGigantamax)) &&
                <div className="spread-card-details">
                    {editing && <div className="spread-details-edit">
                        <div className="spread-nature-field">
                            <FieldAutocomplete label="Nature" value={nature} options={getNatureOptions(catalog)}
                                               onChange={(value) => update((current, saved) => setFieldSymbol(current, "nature", value, saved))} />
                        </div>
                        <ItemPicker catalog={catalog} value={item} speciesName={name} onChange={(value) => update((current, saved) => setFieldSymbol(current, "item", value, saved))} />
                        <FieldAutocomplete label="Ability" value={fields.ability} options={abilityOptions} onChange={(value) => update((current) => ({ ...current, ability: value }))} />
                    </div>}
                    {fields.gigantamax && !canGigantamax && <Typography variant="caption" color="warning.main">{GIGANTAMAX_WARNING}</Typography>}
                </div>}

            <div className="spread-card-moves">
                {editing
                    ? <MoveEditor catalog={catalog} fields={fields} onChange={(slot, move, type) => update((current) => setMove(current, slot, move, type))} />
                    : Array.from({ length: MAX_MOVES }, (_, slot) =>
                    {
                        const option = getMoveOption(catalog, fields, fields.moves[slot]);
                        const duplicate = fields.moves[slot] != null && fields.moves[slot] !== 0 && fields.moves[slot] !== "MOVE_NONE" && fields.moves.indexOf(fields.moves[slot]) < slot;
                        const status = duplicate ? LEGALITY.ILLEGAL : getMoveLegality(catalog, fields.species, fields.moves[slot]).status;
                        const problem = duplicate ? DUPLICATE_MOVE : status === LEGALITY.ILLEGAL ? `${name} cannot learn this move.` : null;
                        const slotContent =
                            <span className={`move-slot move-status-${status}`}>
                                {option != null && <TypeIcon catalog={catalog} type={option.type} />}
                                <span>{option?.name ?? "-"}</span>
                            </span>;
                        return problem != null ? <Tooltip key={slot} title={problem}>{slotContent}</Tooltip> : <React.Fragment key={slot}>{slotContent}</React.Fragment>;
                    })}
            </div>

            {(editing || teamTypeNeedsClearing || problems.length > 0) &&
                <div className="spread-card-battle">
                    {editing && <div className="battle-controls">
                        <CompactSelect id={`${inputId}-battle`} label="Battle Type" value={battleType}
                                       onChange={(type) => update((current, saved, memory) => changeBattleType(current, type,
                                       {
                                           saved,
                                           teamTypes,
                                           bothModifyMovesDoubles: memory ?? (getBattleType(saved) === BATTLE_TYPES.BOTH ? saved.modifyMovesDoubles : true),
                                       }))}>
                            {battleType === BATTLE_TYPES.NEITHER && <MenuItem value={BATTLE_TYPES.NEITHER} disabled>{BATTLE_TYPE_LABELS[BATTLE_TYPES.NEITHER]}</MenuItem>}
                            {SELECTABLE_BATTLE_TYPES.map((type) => <MenuItem key={type} value={type}>{BATTLE_TYPE_LABELS[type]}</MenuItem>)}
                        </CompactSelect>
                        {battleType === BATTLE_TYPES.BOTH &&
                            <FormControlLabel className="modify-moves"
                                              control={<Checkbox size="small" checked={fields.modifyMovesDoubles === true}
                                                                 onChange={(event) => update((current) => ({ ...current, modifyMovesDoubles: event.target.checked }))} />}
                                              label="Modify Moves Doubles" />}
                        {showTeamType &&
                            <CompactSelect id={`${inputId}-team`} label="Doubles Team Type" value={teamType ?? ""}
                                           onChange={(value) => update((current, saved) => setTeamType(current, value, teamTypes, saved))}>
                                {teamType == null && <MenuItem value="">{String(fields.specificTeamType)}</MenuItem>}
                                {teamTypes.map((option) => <MenuItem key={option.name} value={option.name}>{getTeamTypeLabel(option.name)}</MenuItem>)}
                            </CompactSelect>}
                    </div>}
                    {teamTypeNeedsClearing && teamTypes.length > 0 && <Alert severity="warning" className="card-alert">{TEAM_TYPE_WARNING}</Alert>}
                    {problems.length > 0 &&
                        <Alert severity="error" className="card-alert">
                            {problems.map((problem, index) => <div key={index}>{problem.message}</div>)}
                        </Alert>}
                </div>}
            </div>
            {confirmDelete && <Dialog open onClose={() => setConfirmDelete(false)} aria-labelledby={`${inputId}-delete-title`}>
                <DialogTitle id={`${inputId}-delete-title`}>Delete {name}?</DialogTitle>
                <DialogContent>This spread will be removed from its file when you save your changes.</DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
                    <Button color="error" onClick={() => { actions.deleteSpread(id); setConfirmDelete(false); }}>Delete</Button>
                </DialogActions>
            </Dialog>}
        </Paper>
    );
};

export default memo(SpreadCard);
