/* @flow */

import {
  type CrossDomainWindowType,
  type DomainMatcher,
} from "@krakenjs/cross-domain-utils/src";

import type { OnType, SendType } from "../types";

import { getPeer, listenForPeerRequests } from "./peer";
import type { ProxyWindow } from "./window";

export function serializeMessage<T: mixed>(
  destination: CrossDomainWindowType | ProxyWindow,
  domain: DomainMatcher,
  obj: T,
  { on, send }: {| on: OnType, send: SendType |}
): string {
  listenForPeerRequests({ on, send });

  const peer = getPeer(destination, { send });

  if (typeof domain === "string") {
    peer.domain = domain;
  }

  return peer.serdes.encodeJSON({ value: obj });
}

export function deserializeMessage<T: mixed>(
  source: CrossDomainWindowType | ProxyWindow,
  origin: string,
  message: string,
  { on, send }: {| on: OnType, send: SendType |}
): T {
  listenForPeerRequests({ on, send });

  const peer = getPeer(source, { send });
  peer.origin = origin;

  return peer.serdes.decodeJSON({ text: message });
}
