import { GLOBAL_KEY } from './constants';

import { getOrSet } from './helpers';

// All of post-robot's state hangs off one window property keyed by major
// version, so two copies of the same major on a page share one listener,
// one set of handlers and one hello table, while different majors ignore
// each other entirely.
type Global = Record<string, unknown> & {
    initialized ?: boolean,
};

export const getGlobal = (win : Window = window) : Global => {
    const holder = win as unknown as Record<string, Global | undefined>;

    holder[GLOBAL_KEY] ??= {};

    return holder[GLOBAL_KEY];
};

export const deleteGlobal = () : void => {
    delete (window as unknown as Record<string, unknown>)[GLOBAL_KEY];
};

type GlobalStore<Value> = {
    readonly get : (key : string) => Value | undefined,
    readonly set : (key : string, value : Value) => Value,
    readonly has : (key : string) => boolean,
    readonly del : (key : string) => void,
    readonly getOrSet : (key : string, create : () => Value) => Value,
    readonly reset : () => void,
    readonly keys : () => ReadonlyArray<string>,
};

// A named map on the global, created on first use.
export const globalStore = <Value>(name = 'store') : GlobalStore<Value> => {
    const global = getGlobal();

    global[name] ??= new Map<string, Value>();

    const store = global[name] as Map<string, Value>;

    return {
        get: key => store.get(key),

        set: (key, value) => {
            store.set(key, value);

            return value;
        },

        has: key => store.has(key),

        del: key => {
            store.delete(key);
        },

        getOrSet: (key, create) => getOrSet({ map: store, key, create }),
        reset:    () => store.clear(),
        keys:     () => [ ...store.keys() ]
    };
};

// Stands in for "any window" in listener registration.
export class WildCard {}

export const getWildcard = () : WildCard => {
    const global = getGlobal();

    global.WINDOW_WILDCARD ??= new WildCard();

    return global.WINDOW_WILDCARD as WildCard;
};

export type WindowKey = Window | WildCard;

type WindowStore<Value> = {
    readonly get : (win : WindowKey) => Value | undefined,
    readonly set : (win : WindowKey, value : Value) => Value,
    readonly has : (win : WindowKey) => boolean,
    readonly del : (win : WindowKey) => void,
    readonly getOrSet : (win : WindowKey, create : () => Value) => Value,
};

// A named per-window map on the global. A window from any origin is a valid
// WeakMap key, so nothing is held once the window is gone.
export const windowStore = <Value>(name = 'store') : WindowStore<Value> => {
    const stores = globalStore<WeakMap<WindowKey, Value>>('windowStore');
    const map = stores.getOrSet(name, () => new WeakMap<WindowKey, Value>());

    return {
        get: win => map.get(win),

        set: (win, value) => {
            map.set(win, value);

            return value;
        },

        has: win => map.has(win),

        del: win => {
            map.delete(win);
        },

        getOrSet: (win, create) => getOrSet({ map, key: win, create })
    };
};
