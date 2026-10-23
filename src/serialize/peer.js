/* @flow */

import { sandestin } from "sandestin";
import type { ZalgoPromise } from "@krakenjs/zalgo-promise/src";
import {
  matchDomain,
  type CrossDomainWindowType,
  type DomainMatcher,
} from "@krakenjs/cross-domain-utils/src";
import { noop } from "@krakenjs/belter/src";

import { MESSAGE_NAME, WILDCARD } from "../conf";
import { windowStore, globalStore } from "../global";
import type { OnType, SendType, CancelableType } from "../types";

import { ProxyWindow, getWindowType } from "./window";
import { functionType } from "./function";
import { promiseType } from "./promise";

// What every encode and decode is tagged with: the window on the other end
// and the domain it was addressed at (outbound) or seen from (inbound). It is
// also the `this` of every function the other side calls, so it keeps the
// `source` / `origin` names post-robot handlers have always read. sandestin
// carries it with every function and promise, so a call for one can be
// checked against where it was handed out.
export type PeerContext = {|
  source: CrossDomainWindowType | ProxyWindow,
  origin: DomainMatcher,
|};

// One sandestin instance per window we talk to. It holds the functions and
// promises we have handed that window, and the refs we hold from it.
export type Peer = {|
  win: CrossDomainWindowType | ProxyWindow,
  // eslint-disable-next-line flowtype/no-weak-types
  serdes: any,
|};

const proxyPeers: WeakMap<ProxyWindow, Peer> = new WeakMap();

/* eslint-disable promise/no-native, no-restricted-globals, compat/compat */

// A ZalgoPromise as a native one, which is what sandestin's hooks return.
function native<T>(promise: ZalgoPromise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    promise.then(resolve, reject);
  });
}

function createPeer(
  win: CrossDomainWindowType | ProxyWindow,
  { send }: {| send: SendType |}
): Peer {
  const domainOf = (context: ?PeerContext): DomainMatcher => {
    return context ? context.origin : WILDCARD;
  };

  const serdes = sandestin({
    includeStacks: true,
    types: [getWindowType({ send }), functionType, promiseType],

    authorizeInboundRequest: ({ context, handleContext }) => {
      if (handleContext && !matchDomain(handleContext.origin, context.origin)) {
        return false;
      }

      const actual = ProxyWindow.unwrap(win);

      if (ProxyWindow.isProxyWindow(actual)) {
        // $FlowFixMe
        return actual.matchWindow(context.source, { send });
      }

      return actual === context.source;
    },

    invokeRemoteFunction: ({ handle, args, reply, context }) => {
      const domain = domainOf(context);

      if (!reply) {
        return native(
          send(
            win,
            MESSAGE_NAME.METHOD,
            { handle, args },
            { domain, fireAndForget: true }
          )
        );
      }

      return native(
        send(win, MESSAGE_NAME.METHOD, { handle, args }, { domain }).then(
          ({ data }) => data
        )
      );
    },

    releaseRemoteHandle: ({ handle, context }) => {
      send(
        win,
        MESSAGE_NAME.RELEASE,
        { handle },
        { domain: domainOf(context), fireAndForget: true }
      ).catch(noop);
    },

    watchRemotePromise: ({ handle, context }) =>
      native(
        send(
          win,
          MESSAGE_NAME.WATCH,
          { handle },
          { domain: domainOf(context) }
        ).then(({ data }) => data)
      ),
  });

  return { win, serdes };
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
    // this peer as well as any the window already has.
    proxyWin.awaitWindow().then((actualWin) => {
      const list = peers.getOrSet(actualWin, () => []);
      if (list.indexOf(peer) === -1) {
        list.push(peer);
      }
    });

    return peer;
  }

  // $FlowFixMe
  const actualWin: CrossDomainWindowType = win;
  const list = peers.getOrSet(actualWin, () => []);

  if (!list.length) {
    list.push(createPeer(actualWin, { send }));
  }

  return list[0];
}

// The peer for a window that holds the handle a request names: usually the
// window's own, but a function handed to a proxy before its window was known
// lives in the proxy's peer.
function getPeerForHandle(
  source: CrossDomainWindowType,
  handle: string,
  { send }: {| send: SendType |}
): Peer {
  const first = getPeer(source, { send });

  for (const peer of windowStore("sandestinPeers").get(source, [])) {
    if (peer.serdes.hasHandle({ handle })) {
      return peer;
    }
  }

  return first;
}

// The three inbound requests the other side can make about what we handed
// it: call a function, drop a handle, or ask for a promise's outcome.
export function listenForPeerRequests({
  on,
  send,
}: {|
  on: OnType,
  send: SendType,
|}): CancelableType {
  return globalStore("builtinListeners").getOrSet("sandestin", () => {
    const method = on(
      MESSAGE_NAME.METHOD,
      { domain: WILDCARD },
      ({ source, origin, data }) =>
        getPeerForHandle(source, data.handle, {
          send,
        }).serdes.invokeLocalFunction({
          handle: data.handle,
          args: data.args,
          context: { source, origin },
        })
    );

    const release = on(
      MESSAGE_NAME.RELEASE,
      { domain: WILDCARD },
      ({ source, origin, data }) =>
        getPeerForHandle(source, data.handle, { send })
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
        getPeerForHandle(source, data.handle, {
          send,
        }).serdes.watchLocalPromise({
          handle: data.handle,
          context: { source, origin },
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
