/**
 * This file defines small pieces shared by the spread editor's components: catalog names, stat labels, search
 * ordering, lists that load more as they scroll and images that keep their size while loading and show a
 * placeholder when they cannot load.
 */

import React, { useRef, useState } from "react";
import { Box, Button, Paper, Tooltip } from "@mui/material";
import TuneIcon from "@mui/icons-material/Tune";

import { resolveServerUrl } from "../components/ServerConfig";

export const STAT_LABELS = { hp: "HP", atk: "Attack", def: "Defense", spAtk: "Sp. Atk", spDef: "Sp. Def", spd: "Speed" };
export const STAT_SHORT_LABELS = { hp: "HP", atk: "Atk", def: "Def", spAtk: "SpA", spDef: "SpD", spd: "Spe" };

const TYPE_SYMBOL_SIZE = 16;
const TYPE_BANNER_WIDTH = 64;
const TYPE_BANNER_HEIGHT = 24;
const SPLIT_ICON_SIZE = 24;
const SPLIT_ICON_BASE = "https://play.pokemonshowdown.com/sprites/categories/";
const SPLIT_NAMES = { SPLIT_PHYSICAL: "Physical", SPLIT_SPECIAL: "Special", SPLIT_STATUS: "Status" };

// Long lists show this many entries at first and this many more each time
export const LIST_PAGE_SIZE = 100;

// How close to the bottom, in pixels, scrolling loads more
const LOAD_MORE_DISTANCE = 48;


/**
 * Returns how well a name matches a search: 0 when it starts with the search, 1 when it only contains it.
 *
 * @param {string} name The name.
 * @param {string} search The search text.
 * @returns {number|null} The rank, or null when the name does not match.
 */
export function getSearchRank(name, search)
{
    const query = search.trim().toLowerCase();
    const lower = name.toLowerCase();
    if (lower.startsWith(query))
        return 0;

    return lower.includes(query) ? 1 : null;
}

/**
 * Returns the options whose names contain a search, those starting with it first, each part keeping its order.
 *
 * @param {Array<object>} options The options.
 * @param {string} search The search text.
 * @param {function(object): string} getName Returns an option's name.
 * @returns {Array<object>} The matching options.
 */
export function filterBySearch(options, search, getName)
{
    if (search.trim() === "")
        return options;

    const ranked = [[], []];
    for (const option of options)
        ranked[getSearchRank(getName(option), search)]?.push(option);

    return ranked.flat();
}

/**
 * An autocomplete's popup with a button for its advanced chooser.
 *
 * @component
 * @param {Object} props - The component props
 * @param {React.ReactNode} props.children - The list.
 * @param {Function} props.onAdvanced - Opens the advanced chooser.
 * @returns {JSX.Element} The popup.
 */
export const AdvancedPaper = ({ children, onAdvanced, ...props }) =>
{
    return (
        <Paper {...props}>
            {children}
            <Box className="picker-footer">
                {/* Keeping focus in the input stops the popup from closing before the click */}
                <Button size="small" startIcon={<TuneIcon />} onMouseDown={(event) => event.preventDefault()} onClick={onAdvanced}>
                    Advanced
                </Button>
            </Box>
        </Paper>
    );
};

/**
 * Shows a long list a part at a time, loading more when asked or when scrolled near the bottom.
 *
 * @param {number} total How many entries the list has.
 * @param {string} resetKey Changes whenever the list changes, going back to the first part.
 * @returns {{count: number, loadMore: Function, showAtLeast: Function, onScroll: Function}} How many entries to
 *          show, and functions to show more, show enough for an entry, and handle scrolling.
 */
export function useIncrementalList(total, resetKey)
{
    const [shown, setShown] = useState({ resetKey, count: LIST_PAGE_SIZE });
    const requested = shown.resetKey === resetKey ? shown.count : LIST_PAGE_SIZE;
    const count = Math.min(total, requested);

    const loadMore = () => setShown({ resetKey, count: requested + LIST_PAGE_SIZE });
    const showAtLeast = (index) =>
    {
        if (index >= requested)
            setShown({ resetKey, count: Math.ceil((index + 1) / LIST_PAGE_SIZE) * LIST_PAGE_SIZE });
    };
    const onScroll = (event) =>
    {
        const element = event.currentTarget;
        if (count < total && element.scrollTop + element.clientHeight >= element.scrollHeight - LOAD_MORE_DISTANCE)
            loadMore();
    };

    return { count, loadMore, showAtLeast, onScroll };
}

/**
 * Scrolls a list so an entry is in its middle, without scrolling anything around the list.
 *
 * @param {HTMLElement|null} container The scrolling list.
 * @param {HTMLElement|null} entry The entry.
 */
export function scrollToEntry(container, entry)
{
    if (container == null || entry == null)
        return;

    const offset = entry.getBoundingClientRect().top - container.getBoundingClientRect().top;
    container.scrollTop += offset - (container.clientHeight - entry.offsetHeight) / 2;
}


/**
 * Returns the display name of a catalog constant, or the constant itself when the game does not name it.
 *
 * @param {Object<string, string|{name: string}>|null} names The catalog section, such as catalog.items.
 * @param {*} symbol The constant.
 * @returns {string} The name.
 */
export function getLabel(names, symbol)
{
    const value = typeof symbol === "string" && names != null && Object.hasOwn(names, symbol) ? names[symbol] : null;
    if (typeof value === "string")
        return value;

    return value?.name ?? String(symbol);
}

/**
 * Returns a species' name with its form, such as Lilligant Hisui, using Cloud's alternate name when the plain name
 * is shared by several forms.
 *
 * @param {object} catalog The game catalog.
 * @param {string} symbol The SPECIES_* constant.
 * @returns {string} The name.
 */
export function getSpeciesFormName(catalog, symbol)
{
    const name = getLabel(catalog.species, symbol);
    const altName = getEntry(catalog.species, symbol)?.showdownName;
    if (typeof altName !== "string" || !altName.startsWith(`${name}-`))
        return name;

    return `${name} ${altName.slice(name.length + 1).replaceAll("-", " ")}`;
}

/**
 * Returns the catalog entry for a constant.
 *
 * @param {Object<string, object>} section The catalog section.
 * @param {*} symbol The constant.
 * @returns {object|null} The entry.
 */
export function getEntry(section, symbol)
{
    return typeof symbol === "string" && section != null && Object.hasOwn(section, symbol) ? section[symbol] : null;
}

/**
 * An image with a fixed size that tries each source in turn and then shows an empty placeholder.
 *
 * @component
 * @param {Object} props - The component props
 * @param {string|Array<string|null>|null} props.src - The image URL, or URLs to try in order.
 * @param {string} props.alt - The description.
 * @param {number} props.width - The width in pixels.
 * @param {number} props.height - The height in pixels.
 * @param {string} [props.className] - Extra classes.
 * @param {boolean} [props.showAltText] - Whether to show the description when no source loads.
 * @param {boolean} [props.decorative] - Whether nearby text already says what the image shows.
 * @returns {JSX.Element} The image.
 */
export const GameImage = ({ src, alt, width, height, className = "", showAltText = false, decorative = false }) =>
{
    const sources = (Array.isArray(src) ? src : [src]).filter((url) => typeof url === "string").map(resolveServerUrl);
    const key = sources.join("\n");
    const [failed, setFailed] = useState({ key, count: 0 });
    const failedCount = failed.key === key ? failed.count : 0;
    const url = sources[failedCount];
    const accessibility = decorative ? { "aria-hidden": true } : { role: "img", "aria-label": alt };

    if (url == null)
    {
        return (
            <span className={`game-image game-image-missing ${className}`} style={{ width, height }} {...accessibility}>
                {showAltText ? alt : null}
            </span>
        );
    }

    return (
        <img className={`game-image ${className}`} src={url} alt={decorative ? "" : alt} width={width} height={height} loading="lazy" draggable={false}
             onError={() => setFailed({ key, count: failedCount + 1 })} />
    );
};

/**
 * Shows a type's symbol or full banner with its name in a tooltip.
 *
 * @component
 * @param {Object} props - The component props
 * @param {object} props.catalog - The game catalog.
 * @param {string|null} props.type - The TYPE_* constant.
 * @param {boolean} [props.decorative] - Whether nearby text already names the type.
 * @param {boolean} [props.full] - Whether to show the type banner instead of the symbol.
 * @returns {JSX.Element|null} The icon.
 */
export const TypeIcon = ({ catalog, type, decorative = false, full = false }) =>
{
    if (type == null)
        return null;

    const entry = getEntry(catalog.types, type);
    const name = entry?.name ?? String(type);
    return (
        <Tooltip title={name}>
            <span className="type-symbol" {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": name })}>
                <GameImage src={full ? entry?.icon ?? null : entry?.symbol ?? null} alt={name}
                           width={full ? TYPE_BANNER_WIDTH : TYPE_SYMBOL_SIZE} height={full ? TYPE_BANNER_HEIGHT : TYPE_SYMBOL_SIZE} decorative />
            </span>
        </Tooltip>
    );
};

/**
 * Shows a move category's icon and name on hover.
 *
 * @component
 * @param {Object} props - The component props.
 * @param {string|null} props.split - The SPLIT_* constant.
 * @param {boolean} [props.decorative] - Whether nearby text already names the category.
 * @returns {JSX.Element|null} The icon.
 */
export const SplitIcon = ({ split, decorative = false }) =>
{
    const name = SPLIT_NAMES[split];
    if (name == null)
        return null;

    return (
        <Tooltip title={name}>
            <span className="type-symbol" {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": name })}>
                <GameImage src={`${SPLIT_ICON_BASE}${name}.png`} alt={name} width={SPLIT_ICON_SIZE} height={SPLIT_ICON_SIZE} decorative />
            </span>
        </Tooltip>
    );
};

/**
 * Text that ends in an ellipsis when it does not fit, showing its full text in a tooltip only then.
 *
 * @component
 * @param {Object} props - The component props.
 * @param {string} props.text - The text.
 * @param {string} [props.className] - The span's class.
 * @returns {JSX.Element} The text.
 */
export const OverflowText = ({ text, className }) =>
{
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    return (
        <Tooltip title={text} open={open} onClose={() => setOpen(false)}
                 onOpen={() => setOpen(ref.current != null && ref.current.scrollWidth > ref.current.clientWidth)}>
            <span ref={ref} className={className}>{text}</span>
        </Tooltip>
    );
};
