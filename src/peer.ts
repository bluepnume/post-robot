import type { DomainMatcher } from 'cross-domain-utils';
import type { Outcome, Sandestin } from 'sandestin';

import { matchDomain } from 'cross-domain-utils';
import { dateType, regExpType, sandestin } from 'sandestin';

import { MESSAGE_NAME, WILDCARD } from './constants';

import type { Cancelable, Transport } from './types';

import { functionType } from './function-type';
import { globalStore, windowStore } from './global';
import { assertExists, noop } from './helpers';
import { promiseType } from './promise-type';
import { getWindowCustomType, ProxyWindow } from './proxy-window';

// What every encode and decode is tagged with: the window on the other end
// and the domain it was addressed at (outbound) or seen from (inbound). It
// is also the `this` of every function the other side calls, so it keeps
// the `source` / `origin` names handlers have always read. sandestin carries
// it with every function and promise, so a call for one can be checked
// against where it was handed out.
export type PeerContext = {
    readonly source : Window | ProxyWindow,
    readonly origin : DomainMatcher,
};

// One sandestin instance per window we talk to. It holds the functions and
// promises we have handed that window, and the refs we hold from it.
type Peer = {
    readonly win : Window | ProxyWindow,
    readonly serdes : Sandestin<PeerContext>,
};

const proxyPeers = new WeakMap<ProxyWindow, Peer>();

// A ZalgoPromise as a native one, which is what sandestin's hooks return.
const native = <T>(promise : PromiseLike<T>) : Promise<T> => new Promise((resolve, reject) => {
    promise.then(resolve, reject);
});

// Every encode and decode in post-robot carries a context, so every handle
// and ref has one.
const domainOf = (context : PeerContext | undefined) : DomainMatcher => assertExists(context, 'peer context').origin;

const createPeer = (win : Window | ProxyWindow, { send } : Pick<Transport, 'send'>) : Peer => {
    const serdes = sandestin<PeerContext>({
        includeStacks: true,
        // Dates and RegExps (domain matchers in props) cross; nothing else
        // beyond JSON, functions, promises and windows does, which keeps the
        // bundle to what post-robot uses.
        types:         [ getWindowCustomType({ send }), functionType, promiseType, dateType, regExpType ],

        authorizeInboundRequest: ({ context, handleContext }) => {
            if (handleContext && !matchDomain(handleContext.origin, context.origin)) {
                return false;
            }

            const actual = ProxyWindow.unwrap(win);

            return ProxyWindow.isProxyWindow(actual)
                ? native(actual.matchWindow(context.source as Window, { send }))
                : actual === context.source;
        },

        invokeRemoteFunction: ({ handle, args, reply, context }) : Promise<Outcome | void> => {
            const domain = domainOf(context);

            return reply
                ? native(
                    send(win, MESSAGE_NAME.METHOD, { handle, args }, { domain }).then(({ data }) => data as Outcome)
                )
                : native(send(win, MESSAGE_NAME.METHOD, { handle, args }, { domain, fireAndForget: true }).then(noop));
        },

        releaseRemoteHandle: ({ handle, context }) => {
            send(win, MESSAGE_NAME.RELEASE, { handle }, { domain: domainOf(context), fireAndForget: true }).catch(noop);
        },

        watchRemotePromise: ({ handle, context }) => native(
            send(win, MESSAGE_NAME.WATCH, { handle }, { domain: domainOf(context) }).then(({ data }) => data as Outcome)
        )
    });

    return { win, serdes };
};

export const getPeer = (winOrProxyWin : Window | ProxyWindow, { send } : Pick<Transport, 'send'>) : Peer => {
    const peers = windowStore<Array<Peer>>('sandestinPeers');
    const win = ProxyWindow.unwrap(winOrProxyWin);

    if (ProxyWindow.isProxyWindow(win)) {
        const existing = proxyPeers.get(win);

        if (existing) {
            return existing;
        }

        const peer = createPeer(win, { send });

        proxyPeers.set(win, peer);

        // Once the real window is known, calls coming back from it must find
        // this peer as well as any the window already has.
        win.awaitWindow().then(actualWin => {
            const list = peers.getOrSet(actualWin, () => []);

            if (!list.includes(peer)) {
                list.push(peer);
            }
        });

        return peer;
    }

    const list = peers.getOrSet(win, () => []);
    const [ existing ] = list;

    if (existing) {
        return existing;
    }

    const peer = createPeer(win, { send });

    list.push(peer);

    return peer;
};

type GetPeerForHandleOptions = {
    readonly source : Window,
    readonly handle : string,
    readonly send : Transport['send'],
};

// The peer for a window that holds the handle a request names: usually the
// window's own, but a function handed to a proxy before its window was known
// lives in the proxy's peer.
const getPeerForHandle = ({ source, handle, send } : GetPeerForHandleOptions) : Peer => {
    const first = getPeer(source, { send });

    const peers = windowStore<Array<Peer>>('sandestinPeers').get(source) ?? [];

    return peers.find(peer => peer.serdes.hasHandle({ handle })) ?? first;
};

type HandleRequest = {
    readonly handle : string,
    readonly args ?: unknown,
};

// The three inbound requests the other side can make about what we handed
// it: call a function, drop a handle, or ask for a promise's outcome.
export const listenForPeerRequests = ({ on, send } : Transport) : Cancelable =>
    globalStore<Cancelable>('builtinListeners').getOrSet('sandestin', () => {
        const method = on(MESSAGE_NAME.METHOD, { domain: WILDCARD }, ({ source, origin, data }) => {
            const { handle, args } = data as HandleRequest;

            return getPeerForHandle({ source, handle, send }).serdes.invokeLocalFunction({
                handle,
                args,
                context: { source, origin }
            });
        });

        const release = on(MESSAGE_NAME.RELEASE, { domain: WILDCARD }, ({ source, origin, data }) => {
            const { handle } = data as HandleRequest;

            return getPeerForHandle({ source, handle, send }).serdes.releaseLocalHandle({
                handle,
                context: { source, origin }
            }).catch(noop);
        });

        const watch = on(MESSAGE_NAME.WATCH, { domain: WILDCARD }, ({ source, origin, data }) => {
            const { handle } = data as HandleRequest;

            return getPeerForHandle({ source, handle, send }).serdes.watchLocalPromise({
                handle,
                context: { source, origin }
            });
        });

        return {
            cancel: () => {
                method.cancel();
                release.cancel();
                watch.cancel();
            }
        };
    });
