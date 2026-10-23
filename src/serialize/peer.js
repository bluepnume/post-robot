/* @flow */

import { sandestin } from "sandestin";
import {
  matchDomain,
  type CrossDomainWindowType,
} from "@krakenjs/cross-domain-utils/src";
import { noop } from "@krakenjs/belter/src";

import { MESSAGE_NAME, WILDCARD } from "../conf";
import { windowStore, globalStore } from "../global";
import type { OnType, SendType, CancelableType } from "../types";

import { ProxyWindow, getWindowType } from "./window";
import { getFunctionType, getFunctionDomain } from "./function";
import { getPromiseType, getPromiseDomain } from "./promise";

// One sandestin instance per window we talk to. It holds the functions and
// promises we have handed that window, and the refs we hold from it.
export type Peer = {|
  win: CrossDomainWindowType | ProxyWindow,
  // The origin the window was last heard from, else the domain we last
  // addressed it at. Functions handed over are bound to it, and calls back
  // to the window go there.
  origin: ?string,
  domain: ?string,
  getDomain: () => string,
  // eslint-disable-next-line flowtype/no-weak-types
  serdes: any,
|};

const proxyPeers: WeakMap<ProxyWindow, Peer> = new WeakMap();

/* eslint-disable promise/no-native, no-restricted-globals, compat/compat */

function createPeer(
  win: CrossDomainWindowType | ProxyWindow,
  { send }: {| send: SendType |}
): Peer {
  const peer: Peer = {
    win,
    origin: null,
    domain: null,
    getDomain: () => peer.origin || peer.domain || WILDCARD,
    serdes: null,
  };

  const domain = peer.getDomain;

  const serdes = sandestin({
    includeStacks: true,
    types: [
      getWindowType({ send }),
      getFunctionType(peer),
      getPromiseType(peer),
    ],

    authorizeInboundRequest: ({ context, target }) => {
      const expectedDomain =
        typeof target === "function"
          ? getFunctionDomain(target)
          : getPromiseDomain(target);

      if (expectedDomain && !matchDomain(expectedDomain, context.origin)) {
        return false;
      }

      const actual = ProxyWindow.unwrap(peer.win);

      if (ProxyWindow.isProxyWindow(actual)) {
        // $FlowFixMe
        return actual.matchWindow(context.source, { send });
      }

      return actual === context.source;
    },

    invokeRemoteFunction: ({ handle, args }) =>
      new Promise((resolve, reject) => {
        send(win, MESSAGE_NAME.METHOD, { handle, args }, { domain: domain() })
          .then(({ data }) => resolve(data))
          .catch(reject);
      }),

    releaseRemoteHandle: ({ handle }) => {
      send(
        win,
        MESSAGE_NAME.RELEASE,
        { handle },
        { domain: domain(), fireAndForget: true }
      ).catch(noop);
    },

    watchRemotePromise: ({ handle, listener }) => {
      send(win, MESSAGE_NAME.WATCH, { handle }, { domain: domain() }).then(
        ({ data }) => listener(data),
        (err) =>
          listener({ ok: false, error: peer.serdes.encode({ value: err }) })
      );
    },
  });

  peer.serdes = serdes;
  return peer;
}

export function getPeer(
  winOrProxyWin: CrossDomainWindowType | ProxyWindow,
  { send }: {| send: SendType |}
): Peer {
  const peers = windowStore("sandestinPeers");
  const win = ProxyWindow.unwrap(winOrProxyWin);

  if (ProxyWindow.isProxyWindow(win)) {
    // $FlowFixMe
    const proxyWin: ProxyWindow = win;
    const existing = proxyPeers.get(proxyWin);

    if (existing) {
      return existing;
    }

    const peer = createPeer(proxyWin, { send });
    proxyPeers.set(proxyWin, peer);

    // Once the real window is known, calls coming back from it must find
    // this peer, unless the window already has one of its own.
    proxyWin.awaitWindow().then((actualWin) => {
      if (!peers.has(actualWin)) {
        peers.set(actualWin, peer);
      }
    });

    return peer;
  }

  // $FlowFixMe
  const actualWin: CrossDomainWindowType = win;
  return peers.getOrSet(actualWin, () => createPeer(actualWin, { send }));
}

// The three inbound requests the other side can make about what we handed
// it: call a function, drop a handle, or ask for a promise's outcome. Each
// is answered by the peer for the window that sent it.
export function listenForPeerRequests({
  on,
  send,
}: {|
  on: OnType,
  send: SendType,
|}): CancelableType {
  return globalStore("builtinListeners").getOrSet("sandestin", () => {
    const peerFor = (source) => getPeer(source, { send });

    const method = on(
      MESSAGE_NAME.METHOD,
      { domain: WILDCARD },
      ({ source, origin, data }) =>
        peerFor(source).serdes.invokeLocalFunction({
          handle: data.handle,
          args: data.args,
          context: { source, origin },
        })
    );

    const release = on(
      MESSAGE_NAME.RELEASE,
      { domain: WILDCARD },
      ({ source, origin, data }) =>
        peerFor(source)
          .serdes.releaseLocalHandle({
            handle: data.handle,
            context: { source, origin },
          })
          .catch(noop)
    );

    const watch = on(
      MESSAGE_NAME.WATCH,
      { domain: WILDCARD },
      ({ source, origin, data }) =>
        new Promise((resolve) => {
          const { serdes } = peerFor(source);

          serdes
            .watchLocalPromise({
              handle: data.handle,
              listener: resolve,
              context: { source, origin },
            })
            .catch((err) =>
              resolve({ ok: false, error: serdes.encode({ value: err }) })
            );
        })
    );

    return {
      cancel: () => {
        method.cancel();
        release.cancel();
        watch.cancel();
      },
    };
  });
}

/* eslint-enable promise/no-native, no-restricted-globals, compat/compat */
