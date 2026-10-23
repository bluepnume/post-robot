import { getDomain, isAncestor, isWindowClosed, matchDomain, stringifyDomainPattern } from 'cross-domain-utils';
import { ZalgoPromise } from 'zalgo-promise';

import { ACK_TIMEOUT, ACK_TIMEOUT_KNOWN, CHILD_WINDOW_TIMEOUT, RES_TIMEOUT, RESPONSE_CYCLE_TIME } from './config';
import { MESSAGE_TYPE, WILDCARD } from './constants';

/* eslint-disable @typescript-eslint/max-params -- `send(win, name, data, options)` and `on(name, options, handler)` are the API every caller is written against */
import type { ResponseListener } from './listeners';
import type {
    Cancelable, Handler, MessageEvent, OnType, RequestOptions,
    ResponseMessageEvent, SendType, ServerOptions, Transport
} from './types';

import { deleteGlobal, getGlobal, globalStore, windowStore } from './global';
import { awaitWindowHello, initHello, sayHello } from './hello';
import { noop, safeInterval, stringifyError, uniqueID } from './helpers';
import { isWindowKnown } from './known-windows';
import {
    addRequestListener, addResponseListener, cancelResponseListeners, deleteResponseListener,
    markResponseListenerErrored
} from './listeners';
import { ProxyWindow } from './proxy-window';
import { listenForMessages, stopListenForMessages } from './receive';
import { sendMessage } from './send';

export type OnceResult = ZalgoPromise<MessageEvent> & Cancelable;

type Once = (name : string, options ?: ServerOptions | Handler, handler ?: Handler) => OnceResult;

// `on`, `send` and `setup` refer to each other: setup wires the message
// listener and the hello handshake with `on` and `send`, and both of those
// run setup on first use so that importing this module has no side effects.
// They are built on one object and exported from it at the bottom.
type Api = {
    readonly setup : () => void,
    readonly destroy : () => void,
    readonly on : OnType,
    readonly once : Once,
    readonly send : SendType,
};

const validateOptions = (name : string, win : Window, domain : RequestOptions['domain']) : void => {
    if (!name) {
        throw new Error('Expected name');
    }

    if (domain !== undefined && typeof domain !== 'string' && !Array.isArray(domain) && !(domain instanceof RegExp)) {
        throw new TypeError(
            `Can not send ${ name }. Expected domain ${ JSON.stringify(domain) } to be a string, array, or regex`
        );
    }

    if (isWindowClosed(win)) {
        throw new Error(`Can not send ${ name }. Target window is closed`);
    }
};

type NormalizeDomainOptions = {
    readonly win : Window,
    readonly targetDomain : NonNullable<RequestOptions['domain']>,
    readonly actualDomain ?: string,
    readonly send : SendType,
};

// The one origin to post to: the string given, or the origin the window
// said hello from, checked against the matcher.
const normalizeDomain = ({ win, targetDomain, actualDomain, send } : NormalizeDomainOptions) : ZalgoPromise<string> =>
    ZalgoPromise.try(() => {
        if (typeof targetDomain === 'string') {
            return targetDomain;
        }

        const known = actualDomain ?? sayHello(win, { send }).then(({ domain }) => domain);

        return ZalgoPromise.resolve(known).then(origin => {
            if (!matchDomain(targetDomain, origin)) {
                throw new Error(`Domain ${ stringifyDomainPattern(targetDomain) } does not match ${ origin }`);
            }

            return origin;
        });
    });

type WaitForResponseOptions = {
    readonly name : string,
    readonly win : Window,
    readonly domain : string,
    readonly hash : string,
    readonly timeout : number,
};

// The promise a request resolves with, policed on a short cycle: no ack in
// time means nobody is listening, no response in time means it failed, and
// a closed window ends it at once.
const waitForResponse = (
    { name, win, domain, hash, timeout } : WaitForResponseOptions
) : ZalgoPromise<ResponseMessageEvent> => {
    const promise = new ZalgoPromise<ResponseMessageEvent>();
    const listener : ResponseListener = { name, win, domain, promise };

    addResponseListener(hash, listener);

    const requestPromises = windowStore<Array<ZalgoPromise>>('requestPromises').getOrSet(win, () => []);

    requestPromises.push(promise);

    promise.catch(() => {
        markResponseListenerErrored(hash);
        deleteResponseListener(hash);
    });

    const totalAckTimeout = isWindowKnown(win)
        ? ACK_TIMEOUT_KNOWN
        : ACK_TIMEOUT;

    let ackTimeout = totalAckTimeout;
    let resTimeout = timeout;

    const interval = safeInterval(() => {
        if (isWindowClosed(win)) {
            promise.reject(new Error(`Window closed for ${ name } before ${
                listener.ack
                    ? 'response'
                    : 'ack'
                }`));

            return;
        }

        if (listener.cancelled) {
            promise.reject(new Error(`Response listener was cancelled for ${ name }`));

            return;
        }

        ackTimeout = Math.max(ackTimeout - RESPONSE_CYCLE_TIME, 0);

        if (resTimeout !== -1) {
            resTimeout = Math.max(resTimeout - RESPONSE_CYCLE_TIME, 0);
        }

        if (ackTimeout === 0 && !listener.ack) {
            promise.reject(new Error(`No ack for postMessage ${ name } in ${ getDomain() } in ${ totalAckTimeout }ms`));
        } else if (resTimeout === 0) {
            promise.reject(new Error(`No response for postMessage ${ name } in ${ getDomain() } in ${ timeout }ms`));
        }
    }, RESPONSE_CYCLE_TIME);

    promise.finally(() => {
        interval.cancel();
        requestPromises.splice(requestPromises.indexOf(promise), 1);
    }).catch(noop);

    return promise;
};

const api : Api = {
    // Start listening for messages and say hello to the opener or parent.
    // Idempotent, and run by `on` and `send` anyway; call it directly in a
    // window that only needs to be reachable, so its hello goes out.
    setup: () => {
        const global = getGlobal();

        if (global.initialized) {
            return;
        }

        global.initialized = true;

        const transport : Transport = { on: api.on, send: api.send };

        listenForMessages(transport);
        initHello(transport);
    },

    destroy: () => {
        cancelResponseListeners();
        stopListenForMessages();

        const builtin = globalStore<Cancelable>('builtinListeners');

        for (const key of builtin.keys()) {
            builtin.get(key)?.cancel();
        }

        deleteGlobal();
    },

    on: (name, options, handler) => {
        api.setup();

        if (!name) {
            throw new Error('Expected name');
        }

        const serverOptions : ServerOptions = typeof options === 'function'
            ? { handler: options }
            : options;

        const successHandler = handler ?? serverOptions.handler;

        if (!successHandler) {
            throw new Error('Expected handler');
        }

        const errorHandler = serverOptions.errorHandler ?? ((err : unknown) => {
            throw err;
        });

        return addRequestListener({
            name,
            win:      serverOptions.window,
            domain:   serverOptions.domain ?? WILDCARD,
            listener: { handler: successHandler, handleError: errorHandler }
        });
    },

    // Listen for one request, resolve with it, and stop listening.
    once: (name, options, handler) => {
        const serverOptions : ServerOptions = typeof options === 'function'
            ? { handler: options }
            : (options ?? {});

        const theHandler = handler ?? serverOptions.handler;
        const promise = new ZalgoPromise<MessageEvent>();

        const listener = api.on(name, {
            ...serverOptions,

            errorHandler: err => {
                listener.cancel();
                promise.reject(err);
            }
        }, event => {
            listener.cancel();
            promise.resolve(event);

            return theHandler?.(event);
        });

        return Object.assign(promise, { cancel: listener.cancel });
    },

    send: (winOrProxyWin, name, data, options = {}) => {
        api.setup();

        const domainMatcher = options.domain ?? WILDCARD;
        const responseTimeout = options.timeout ?? RES_TIMEOUT;
        const childTimeout = options.timeout ?? CHILD_WINDOW_TIMEOUT;
        const fireAndForget = options.fireAndForget ?? false;
        const transport : Transport = { on: api.on, send: api.send };

        return ProxyWindow.toProxyWindow(winOrProxyWin, transport).awaitWindow().then(win => ZalgoPromise.try(() => {
            validateOptions(name, win, options.domain);

            return isAncestor(window, win)
                ? awaitWindowHello(win, childTimeout)
                : undefined;
        }).then(hello => normalizeDomain({
            win,
            targetDomain: domainMatcher,
            actualDomain: hello?.domain,
            send:         api.send
        })).then(domain => {
            const hash = `${ name }_${ uniqueID() }`;

            const response = fireAndForget
                ? undefined
                : waitForResponse({ name, win, domain, hash, timeout: responseTimeout });

            return sendMessage({
                win,
                domain,
                transport,

                message: {
                    id:     uniqueID(),
                    origin: getDomain(),
                    type:   MESSAGE_TYPE.REQUEST,
                    hash,
                    name,
                    data,
                    fireAndForget
                }
            }).then(
                () => response ?? { source: win, origin: domain, data: undefined },
                (err : unknown) => {
                    throw new Error(`Send request message failed for ${ name } in ${ getDomain() }\n\n${ stringifyError(err) }`);
                }
            );
        }));
    }
};

export const { setup, destroy, on, once, send } = api;
/* eslint-enable @typescript-eslint/max-params */
