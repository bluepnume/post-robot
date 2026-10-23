import type { DomainMatcher } from 'cross-domain-utils';
import type { ZalgoPromise } from 'zalgo-promise';

import { matchDomain } from 'cross-domain-utils';

import { WILDCARD } from './constants';

import type { WindowKey } from './global';
import type { Cancelable, MessageEvent } from './types';

import { getWildcard, globalStore, windowStore } from './global';
import { assertExists, noop } from './helpers';
import { ProxyWindow } from './proxy-window';

type RequestListener = {
    readonly handler : (event : MessageEvent) => unknown,
    readonly handleError : (err : unknown) => void,
};

export type ResponseListener = {
    readonly name : string,
    readonly win : Window,
    readonly domain : DomainMatcher,
    readonly promise : ZalgoPromise,
    ack ?: boolean,
    cancelled ?: boolean,
};

type RegexListener = {
    readonly regex : RegExp,
    readonly listener : RequestListener,
};

// The listeners for one request name on one window: by exact origin, or by
// pattern, tried in registration order.
type NameListeners = {
    readonly exact : Map<string, RequestListener>,
    readonly patterns : Array<RegexListener>,
};

type Listeners = Map<string, NameListeners>;

export const addResponseListener = (hash : string, listener : ResponseListener) : void => {
    globalStore<ResponseListener>('responseListeners').set(hash, listener);
};

export const getResponseListener = (hash : string) : ResponseListener | undefined =>
    globalStore<ResponseListener>('responseListeners').get(hash);

export const deleteResponseListener = (hash : string) : void => {
    globalStore<ResponseListener>('responseListeners').del(hash);
};

export const cancelResponseListeners = () : void => {
    const listeners = globalStore<ResponseListener>('responseListeners');

    for (const hash of listeners.keys()) {
        const listener = assertExists(listeners.get(hash), 'response listener');

        listener.cancelled = true;
        listeners.del(hash);
    }
};

export const markResponseListenerErrored = (hash : string) : void => {
    globalStore<boolean>('erroredResponseListeners').set(hash, true);
};

export const isResponseListenerErrored = (hash : string) : boolean =>
    globalStore<boolean>('erroredResponseListeners').has(hash);

type GetRequestListenerOptions = {
    readonly name : string,
    readonly win ?: WindowKey,
    readonly domain ?: string,
};

// The listener for a request: one registered for this window first, then
// one for any window; within each, an exact origin, then a pattern that
// matches, then the wildcard.
export const getRequestListener = ({ name, win, domain } : GetRequestListenerOptions) : RequestListener | undefined => {
    const store = windowStore<Listeners>('requestListeners');

    const origin = domain === WILDCARD
        ? undefined
        : domain;

    for (const winQualifier of [ win, getWildcard() ]) {
        const listeners = winQualifier && store.get(winQualifier)?.get(name);

        if (!listeners) {
            continue;
        }

        if (origin) {
            const exact = listeners.exact.get(origin);

            if (exact) {
                return exact;
            }

            const matched = listeners.patterns.find(({ regex }) => matchDomain(regex, origin));

            if (matched) {
                return matched.listener;
            }
        }

        const wildcard = listeners.exact.get(WILDCARD);

        if (wildcard) {
            return wildcard;
        }
    }

    return undefined;
};

const describeWindow = (win : WindowKey) : string => (win === getWildcard()
    ? 'wildcard'
    : 'specified');

const cancelAll = (registered : ReadonlyArray<Cancelable>) : Cancelable => ({
    cancel: () => {
        for (const item of registered) {
            item.cancel();
        }
    }
});

type AddRequestListenerOptions = {
    readonly name : string,
    readonly win ?: Window | ProxyWindow | typeof WILDCARD | ReadonlyArray<Window | ProxyWindow>,
    readonly domain : DomainMatcher,
    readonly listener : RequestListener,
};

export const addRequestListener = (
    { name, win: winCandidate, domain, listener } : AddRequestListenerOptions
) : Cancelable => {
    if (ProxyWindow.isProxyWindow(winCandidate)) {
        // Register once the real window is known.
        const pending = winCandidate.awaitWindow().then(actualWin =>
            addRequestListener({ name, win: actualWin, domain, listener }));

        return {
            cancel: () => {
                pending.then(registered => registered.cancel(), noop);
            }
        };
    }

    if (Array.isArray(winCandidate)) {
        const windows = winCandidate as ReadonlyArray<Window | ProxyWindow>;

        return cancelAll(windows.map(item => addRequestListener({ name, win: item, domain, listener })));
    }

    if (Array.isArray(domain)) {
        const domains = domain as ReadonlyArray<string | RegExp>;

        return cancelAll(domains.map(item => addRequestListener({ name, win: winCandidate, domain: item, listener })));
    }

    const win : WindowKey = winCandidate === undefined || winCandidate === WILDCARD
        ? getWildcard()
        : winCandidate;

    const pattern = domain;

    if (typeof pattern === 'string' && getRequestListener({ name, win, domain: pattern })) {
        throw new Error(
            `Request listener already exists for ${ name } on domain ${ pattern } for ${ describeWindow(win) } window`
        );
    }

    const store = windowStore<Listeners>('requestListeners');
    const byName = store.getOrSet(win, () => new Map<string, NameListeners>());
    const listeners = byName.get(name) ?? { exact: new Map<string, RequestListener>(), patterns: [] };

    byName.set(name, listeners);

    const regexListener : RegexListener | undefined = pattern instanceof RegExp
        ? { regex: pattern, listener }
        : undefined;

    if (regexListener) {
        listeners.patterns.push(regexListener);
    } else {
        listeners.exact.set(String(pattern), listener);
    }

    return {
        cancel: () => {
            if (regexListener) {
                const index = listeners.patterns.indexOf(regexListener);

                if (index !== -1) {
                    listeners.patterns.splice(index, 1);
                }
            } else {
                listeners.exact.delete(String(pattern));
            }

            if (!listeners.exact.size && !listeners.patterns.length) {
                byName.delete(name);
            }

            if (!byName.size) {
                store.del(win);
            }
        }
    };
};
