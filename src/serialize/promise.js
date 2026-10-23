/* @flow */

import { ZalgoPromise } from "@krakenjs/zalgo-promise/src";

import { SERIALIZATION_TYPE } from "../conf";

/* eslint-disable promise/no-native, no-restricted-globals */

// sandestin carries any thenable as a promise; this only makes sure what
// arrives is a ZalgoPromise, as post-robot has always handed out.
export const promiseType = {
  name: SERIALIZATION_TYPE.CROSS_DOMAIN_ZALGO_PROMISE,

  test: (value: mixed): boolean =>
    value instanceof ZalgoPromise || value instanceof Promise,

  encode: ({ value }: {| value: Object |}): Object => value,

  decode: ({ value }: {| value: Promise<mixed> |}): ZalgoPromise<mixed> =>
    new ZalgoPromise((resolve, reject) => {
      value.then(resolve, reject);
    }),
};

/* eslint-enable promise/no-native, no-restricted-globals */
