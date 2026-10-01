/**
 * This file defines the SpreadStats component.
 * It shows a spread's base stats, EVs, IVs and final stats, with nature arrows and EV and IV inputs with
 * - and + buttons when editing.
 */

import React, { useEffect, useRef, useState } from "react";
import { IconButton, InputBase, Tooltip } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import AddIcon from "@mui/icons-material/Add";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import RemoveIcon from "@mui/icons-material/Remove";
import RestartAltIcon from "@mui/icons-material/RestartAlt";

import { EV_FIELDS, IV_FIELDS, MAX_EV, MAX_EV_TOTAL, MAX_IV, STATS, getEvTotal, getNatureEffect, getResetIvs, stepEv } from "../../shared/pokemon-mechanics.mjs";
import { getFieldSymbol, setEv, setIv } from "../../shared/spread-model.mjs";
import { STAT_LABELS } from "./CatalogDisplay";

const DIRECTION_UP = 1;
const DIRECTION_DOWN = -1;
const DIGITS_PATTERN = /^\d{0,3}$/;
const UNKNOWN_STAT = "?";
const KEY_ARROW_UP = "ArrowUp";
const KEY_ARROW_DOWN = "ArrowDown";
const KEY_TAB = "Tab";
const REPEAT_DELAY_MS = 150;
const REPEAT_INTERVAL_MS = 20;
// Each held tick takes one more step after this many ticks, up to the maximum
const REPEAT_ACCELERATE_TICKS = 1;
const REPEAT_MAX_STEPS = 8;
const VIEW_DIVIDER_OPACITY = 0.08;
const RAISED_LABEL = "Raised by nature";
const LOWERED_LABEL = "Lowered by nature";
const RESET_EVS_TIP = "Reset all EVs to 0";
const RESET_IVS_TIP = "Reset all IVs to 31, keeping unused attacking IVs at 0 and Speed at 0 for Gyro Ball or Trick Room";


/**
 * A compact whole-number input that keeps partial typing until it is a number. Focusing it selects its
 * contents, so typing replaces them.
 *
 * @component
 * @param {Object} props - The component props
 * @param {number} props.value - The value.
 * @param {string} props.label - The accessible name.
 * @param {number} props.max - The largest allowed value.
 * @param {Function} props.onCommit - Called with each entered whole number.
 * @param {Function} [props.onStep] - Called with 1 or -1 for the arrow keys, replacing the default step.
 * @param {boolean} [props.error] - Whether the value is invalid.
 * @param {string} props.kind - The EV or IV keyboard-navigation column.
 * @returns {JSX.Element} The input.
 */
const NumberInput = ({ value, label, max, onCommit, onStep, error = false, kind }) =>
{
    const [text, setText] = useState(String(value));

    /**
     * Shows outside changes, such as an arrow press or auto-fix.
     */
    useEffect(() =>
    {
        setText(String(value));
    }, [value]);

    /**
     * Steps the value with the arrow keys.
     *
     * @param {React.KeyboardEvent} event The key event.
     */
    const handleKeyDown = (event) =>
    {
        const direction = event.key === KEY_ARROW_UP ? DIRECTION_UP : event.key === KEY_ARROW_DOWN ? DIRECTION_DOWN : 0;
        if (direction === 0)
            return;

        event.preventDefault();
        if (onStep != null)
            onStep(direction);
        else
            onCommit(Math.min(Math.max((Number.isInteger(value) ? value : 0) + direction, 0), max));
    };

    return (
        <InputBase
            className={`stat-input${error ? " stat-input-error" : ""}`}
            value={text}
            onChange={(event) =>
            {
                if (!DIGITS_PATTERN.test(event.target.value))
                    return;
                setText(event.target.value);
                if (event.target.value !== "")
                    onCommit(Number(event.target.value));
            }}
            onBlur={() => setText(String(value))}
            onKeyDown={handleKeyDown}
            onFocus={(event) => event.target.select()}
            onClick={(event) => event.target.select()}
            slotProps={{ input: { "aria-label": label, inputMode: "numeric", "aria-invalid": error, "data-stat-kind": kind } }}
        />
    );
};

/**
 * An input between - and + buttons.
 *
 * @component
 * @param {Object} props - The component props
 * @param {string} props.label - What the buttons change, such as Attack EVs.
 * @param {boolean} props.canLower - Whether - is enabled.
 * @param {boolean} props.canRaise - Whether + is enabled.
 * @param {Function} props.onStep - Called with 1 or -1.
 * @param {React.ReactNode} props.children - The input.
 * @returns {JSX.Element} The input and buttons.
 */
const StepperInput = ({ label, canLower, canRaise, onStep, children }) =>
{
    const timer = useRef(null);
    const interval = useRef(null);
    const pointerStep = useRef(false);
    const heldDirection = useRef(null);

    /**
     * Stops a held button from changing the stat.
     *
     * @returns {void} Nothing.
     */
    const stop = () =>
    {
        clearTimeout(timer.current);
        clearInterval(interval.current);
        timer.current = null;
        interval.current = null;
        heldDirection.current = null;
    };

    /**
     * Starts repeating a held stat button.
     *
     * @param {number} direction The direction to repeat.
     * @returns {void} Nothing.
     */
    const start = (direction) =>
    {
        stop();
        pointerStep.current = true;
        heldDirection.current = direction;
        onStep(direction);
        timer.current = setTimeout(() =>
        {
            let ticks = 0;
            interval.current = setInterval(() =>
            {
                const steps = Math.min(REPEAT_MAX_STEPS, 1 + Math.floor(ticks / REPEAT_ACCELERATE_TICKS));
                ticks += 1;
                for (let count = 0; count < steps; count++)
                    onStep(direction);
            }, REPEAT_INTERVAL_MS);
        }, REPEAT_DELAY_MS);
    };

    /**
     * Clears held-button timers when the stepper unmounts.
     *
     * @returns {Function} The timer cleanup.
     */
    useEffect(() => stop, []);
    /**
     * Stops repeating when the held direction reaches its limit.
     *
     * @returns {void} Nothing.
     */
    useEffect(() =>
    {
        if ((heldDirection.current === DIRECTION_DOWN && !canLower) || (heldDirection.current === DIRECTION_UP && !canRaise))
            stop();
    }, [canLower, canRaise]);

    /**
     * Handles keyboard clicks without duplicating a pointer step.
     *
     * @param {number} direction The direction of a button activation.
     * @returns {void} Nothing.
     */
    const click = (direction) =>
    {
        if (pointerStep.current)
        {
            pointerStep.current = false;
            return;
        }
        onStep(direction);
    };

    return (
        <span className="stat-stepper">
            <IconButton size="small" color="error" tabIndex={-1} aria-label={`Lower ${label}`} disabled={!canLower} onClick={() => click(DIRECTION_DOWN)}
                        onPointerDown={() => start(DIRECTION_DOWN)} onPointerUp={stop}
                        onPointerLeave={() => { stop(); pointerStep.current = false; }} onPointerCancel={() => { stop(); pointerStep.current = false; }}>
                <RemoveIcon fontSize="inherit" />
            </IconButton>
            {children}
            <IconButton size="small" color="success" tabIndex={-1} aria-label={`Raise ${label}`} disabled={!canRaise} onClick={() => click(DIRECTION_UP)}
                        onPointerDown={() => start(DIRECTION_UP)} onPointerUp={stop}
                        onPointerLeave={() => { stop(); pointerStep.current = false; }} onPointerCancel={() => { stop(); pointerStep.current = false; }}>
                <AddIcon fontSize="inherit" />
            </IconButton>
        </span>
    );
};

/**
 * Represents the SpreadStats component.
 *
 * @component
 * @param {Object} props - The component props
 * @param {object} props.fields - The spread's values.
 * @param {{species: string, stats: Object<string, number|null>}} props.preview - The species and final stats shown.
 * @param {Object<string, number|null>|null} props.baseStats - The shown species' base stats.
 * @param {object|null} props.littleCup - The Little Cup EV step context, or null for other spreads.
 * @param {boolean} props.editing - Whether the inputs are shown.
 * @param {Function} props.onChange - Called with a function from the current values to the new values.
 * @param {string} props.name - The spread's name, for input labels.
 * @param {object} [props.catalog] - The game catalog, for working out which IVs a reset keeps at 0.
 * @param {React.ReactNode} [props.footer] - Controls shown at the right of the Total row.
 * @returns {JSX.Element} The stat table.
 */
const SpreadStats = ({ fields, preview, baseStats, littleCup, editing, onChange, name, catalog = null, footer = null }) =>
{
    const theme = useTheme();
    const nature = getNatureEffect(getFieldSymbol(fields, "nature"));
    const evTotal = getEvTotal(fields);
    const baseTotal = STATS.every((stat) => baseStats?.[stat] != null) ? STATS.reduce((sum, stat) => sum + baseStats[stat], 0) : null;
    const resetIvFields = editing && catalog != null ? getResetIvs(catalog, fields) : null;
    const ivsAreReset = resetIvFields == null || STATS.every((stat) => fields[IV_FIELDS[stat]] === resetIvFields[IV_FIELDS[stat]]);

    /**
     * Tabs down EVs, then down IVs; Shift+Tab follows the reverse order.
     *
     * @param {React.KeyboardEvent} event The table's key event.
     */
    const advanceStat = (event) =>
    {
        if (event.key !== KEY_TAB || event.ctrlKey || event.altKey || event.metaKey || !event.target.matches("input[data-stat-kind]"))
            return;
        const inputs = [...event.currentTarget.querySelectorAll("input[data-stat-kind='ev']"),
            ...event.currentTarget.querySelectorAll("input[data-stat-kind='iv']")];
        const index = inputs.indexOf(event.target);
        const next = inputs[index + (event.shiftKey ? DIRECTION_DOWN : DIRECTION_UP)];
        if (next == null)
            return;
        event.preventDefault();
        next.focus();
    };

    /**
     * Sets every EV to 0.
     */
    const resetEvs = () => onChange((current) => STATS.reduce((next, stat) => setEv(next, stat, 0), current));

    /**
     * Sets every IV to 31, keeping unneeded attacking IVs at 0 and any Hidden Power's type.
     */
    const resetIvs = () => onChange((current) =>
    {
        const ivs = getResetIvs(catalog, current);
        return STATS.reduce((next, stat) => setIv(next, stat, ivs[IV_FIELDS[stat]]), current);
    });

    /**
     * Moves one EV with a button or arrow key.
     *
     * @param {string} stat The stat key.
     * @param {number} direction 1 for up, -1 for down.
     */
    const step = (stat, direction) =>
    {
        onChange((current) =>
        {
            const ev = stepEv(current, stat, direction, littleCup);
            return ev == null ? current : setEv(current, stat, ev);
        });
    };

    /**
     * Moves one IV by 1.
     *
     * @param {string} stat The stat key.
     * @param {number} direction 1 for up, -1 for down.
     */
    const stepIv = (stat, direction) =>
    {
        onChange((current) =>
        {
            const iv = current[IV_FIELDS[stat]];
            return setIv(current, stat, (Number.isInteger(iv) ? iv : 0) + direction);
        });
    };

    return (
        <table className={`spread-stats${editing ? " spread-stats-editing" : " spread-stats-view"}`}
             onKeyDown={editing ? advanceStat : undefined}
               style={editing ? undefined : { "--stat-grid-divider": alpha(theme.palette.divider, VIEW_DIVIDER_OPACITY) }}>
            <thead>
                <tr>
                    <th scope="col">Stat</th>
                    <th scope="col">Base</th>
                    <th scope="col" className="stat-stepper-heading">
                        <span className="stat-heading">
                            EV
                            {editing &&
                                <Tooltip title={RESET_EVS_TIP}>
                                    <span className="stat-heading-reset">
                                        <IconButton size="small" aria-label="Reset EVs" disabled={evTotal === 0} onClick={resetEvs}><RestartAltIcon fontSize="inherit" /></IconButton>
                                    </span>
                                </Tooltip>}
                        </span>
                    </th>
                    <th scope="col" className="stat-stepper-heading">
                        <span className="stat-heading">
                            IV
                            {editing &&
                                <Tooltip title={RESET_IVS_TIP}>
                                    <span className="stat-heading-reset">
                                        <IconButton size="small" aria-label="Reset IVs" disabled={ivsAreReset} onClick={resetIvs}><RestartAltIcon fontSize="inherit" /></IconButton>
                                    </span>
                                </Tooltip>}
                        </span>
                    </th>
                    {editing && <th scope="col">Final</th>}
                </tr>
            </thead>
            <tbody>
                {STATS.map((stat) =>
                {
                    const label = STAT_LABELS[stat];
                    const ev = fields[EV_FIELDS[stat]];
                    const iv = fields[IV_FIELDS[stat]];
                    const natureClass = nature?.increased === stat ? " stat-label-raised" : nature?.decreased === stat ? " stat-label-lowered" : "";
                    return (
                        <tr key={stat}>
                            <th scope="row">
                                <span className={`stat-label${natureClass}`}>{label}</span>
                                {nature?.increased === stat &&
                                    <Tooltip title={RAISED_LABEL}><span role="img" aria-label={RAISED_LABEL} className="nature-up"><ArrowUpwardIcon fontSize="inherit" /></span></Tooltip>}
                                {nature?.decreased === stat &&
                                    <Tooltip title={LOWERED_LABEL}><span role="img" aria-label={LOWERED_LABEL} className="nature-down"><ArrowDownwardIcon fontSize="inherit" /></span></Tooltip>}
                            </th>
                            <td>{baseStats?.[stat] ?? UNKNOWN_STAT}</td>
                            <td>
                                {editing
                                    ? <StepperInput label={`${label} EVs`} onStep={(direction) => step(stat, direction)}
                                                    canLower={stepEv(fields, stat, DIRECTION_DOWN, littleCup) != null} canRaise={stepEv(fields, stat, DIRECTION_UP, littleCup) != null}>
                                        <NumberInput kind="ev" value={ev} label={`${name} ${label} EVs`} max={MAX_EV} error={!Number.isInteger(ev) || ev > MAX_EV}
                                                     onCommit={(value) => onChange((current) => setEv(current, stat, value))}
                                                     onStep={(direction) => step(stat, direction)} />
                                    </StepperInput>
                                    : ev}
                            </td>
                            <td>
                                {editing
                                    ? <StepperInput label={`${label} IV`} onStep={(direction) => stepIv(stat, direction)}
                                                    canLower={!Number.isInteger(iv) || iv > 0} canRaise={!Number.isInteger(iv) || iv < MAX_IV}>
                                        <NumberInput kind="iv" value={iv} label={`${name} ${label} IV`} max={MAX_IV} error={!Number.isInteger(iv) || iv > MAX_IV}
                                                     onCommit={(value) => onChange((current) => setIv(current, stat, value))} />
                                    </StepperInput>
                                    : iv}
                            </td>
                            {editing && <td className="stat-final">{preview.stats[stat] ?? UNKNOWN_STAT}</td>}
                        </tr>
                    );
                })}
            </tbody>
            <tfoot>
                <tr>
                    <th scope="row">Total</th>
                    <td>{baseTotal ?? UNKNOWN_STAT}</td>
                    <td className={`stat-ev-total${evTotal > MAX_EV_TOTAL ? " ev-total-error" : ""}`} aria-label={`EV total ${evTotal} of ${MAX_EV_TOTAL}`}>
                        {!editing ? evTotal : evTotal > MAX_EV_TOTAL ? `${evTotal - MAX_EV_TOTAL} Over` : `${MAX_EV_TOTAL - evTotal} Left`}
                    </td>
                    <td colSpan={editing ? 2 : 1} className="stat-footer">{footer}</td>
                </tr>
            </tfoot>
        </table>
    );
};

export default SpreadStats;
