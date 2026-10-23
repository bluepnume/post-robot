import { getAncestor } from 'cross-domain-utils';
import { ZalgoPromise } from 'zalgo-promise';

import { MESSAGE_NAME, WILDCARD } from './constants';

import type { Cancelable, Transport } from './types';

import { globalStore, windowStore } from './global';
import { noop, uniqueID } from './helpers';

type Hello = {
    readonly domain : string,
};

// Every window running post-robot has one id for its lifetime, which is how
// a ProxyWindow later recognises the window it stands for.
const getInstanceID = () : string => globalStore<string>('instance').getOrSet('instanceID', uniqueID);

const getHelloPromise = (win : Window) : ZalgoPromise<Hello> =>
    windowStore<ZalgoPromise<Hello>>('helloPromises').getOrSet(win, () => new ZalgoPromise<Hello>());

type ResolveHelloPromiseOptions = {
    readonly win : Window,
    readonly domain : string,
};

const resolveHelloPromise = ({ win, domain } : ResolveHelloPromiseOptions) : void => {
    const promises = windowStore<ZalgoPromise<Hello>>('helloPromises');

    promises.get(win)?.resolve({ domain });
    promises.set(win, ZalgoPromise.resolve({ domain }));
};

const listenForHello = ({ on } : Pick<Transport, 'on'>) : Cancelable =>
    on(MESSAGE_NAME.HELLO, { domain: WILDCARD }, ({ source, origin }) => {
        resolveHelloPromise({ win: source, domain: origin });

        return { instanceID: getInstanceID() };
    });

type SaidHello = {
    readonly win : Window,
    readonly domain : string,
    readonly instanceID : string,
};

export const sayHello = (win : Window, { send } : Pick<Transport, 'send'>) : ZalgoPromise<SaidHello> =>
    send(win, MESSAGE_NAME.HELLO, { instanceID: getInstanceID() }, { domain: WILDCARD, timeout: -1 })
        .then(({ origin, data }) => {
            resolveHelloPromise({ win, domain: origin });

            return { win, domain: origin, instanceID: (data as { instanceID : string }).instanceID };
        });

export const getWindowInstanceID = (win : Window, { send } : Pick<Transport, 'send'>) : ZalgoPromise<string> =>
    windowStore<ZalgoPromise<string>>('windowInstanceIDPromises').getOrSet(win, () =>
        sayHello(win, { send }).then(({ instanceID }) => instanceID));

// Listen for hellos, and say hello to whoever opened or framed this window.
export const initHello = ({ on, send } : Transport) : Cancelable =>
    globalStore<Cancelable>('builtinListeners').getOrSet('helloListener', () => {
        const listener = listenForHello({ on });
        const parent = getAncestor();

        if (parent) {
            sayHello(parent, { send }).catch(noop);
        }

        return listener;
    });

// Resolves once the window has said hello, with its origin; rejects after
// `timeout` milliseconds (-1 waits forever).
export const awaitWindowHello = (win : Window, timeout = 5000, name = 'Window') : ZalgoPromise<Hello> => {
    const promise = getHelloPromise(win);

    return timeout === -1
        ? promise
        : promise.timeout(timeout, new Error(`${ name } did not load after ${ timeout }ms`));
};
