/* @flow */

import { type DomainMatcher } from "@krakenjs/cross-domain-utils/src";
import { ZalgoPromise } from "@krakenjs/zalgo-promise/src";

import { SERIALIZATION_TYPE } from "../conf";

import { annotateRemoteError } from "./function";
import type { Peer } from "./peer";

// The domain each promise was handed out to, checked when the other side
// asks to watch it.
const promiseDomains: WeakMap<Object, DomainMatcher> = new WeakMap();

export function getPromiseDomain(promise: Object): ?DomainMatcher {
  return promiseDomains.get(promise);
}

/* eslint-disable promise/no-native, no-restricted-globals, compat/compat */

export function getPromiseType(peer: Peer): {|
  name: string,
  test: (mixed) => boolean,
  encode: ({| value: Object |}) => Promise<mixed>,
  decode: ({| value: Promise<mixed> |}) => ZalgoPromise<mixed>,
|} {
  return {
    name: SERIALIZATION_TYPE.CROSS_DOMAIN_ZALGO_PROMISE,

    test: (value) => value instanceof ZalgoPromise || value instanceof Promise,

    // sandestin carries native promises; a ZalgoPromise is adopted into one.
    encode: ({ value }) => {
      const promise =
        value instanceof ZalgoPromise
          ? new Promise((resolve, reject) => value.then(resolve, reject))
          : value;

      promiseDomains.set(promise, peer.getDomain());
      return promise;
    },

    decode: ({ value }) => {
      return new ZalgoPromise((resolve, reject) => {
        value.then(resolve, (err) => {
          annotateRemoteError(err, "then", []);
          reject(err);
        });
      });
    },
  };
}

/* eslint-enable promise/no-native, no-restricted-globals, compat/compat */
