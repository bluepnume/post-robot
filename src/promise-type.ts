import type { CustomType } from 'sandestin';

import { ZalgoPromise } from 'zalgo-promise';

import { SERIALIZATION_TYPE } from './constants';

// sandestin carries any thenable as a promise; this only makes sure what
// arrives is a ZalgoPromise, as post-robot has always handed out.
export const promiseType : CustomType<PromiseLike<unknown>, PromiseLike<unknown>> = {
    name:   SERIALIZATION_TYPE.CROSS_DOMAIN_ZALGO_PROMISE,
    test:   value => value instanceof ZalgoPromise || value instanceof Promise,
    encode: ({ value }) => value,

    decode: ({ value }) => new ZalgoPromise((resolve, reject) => {
        value.then(resolve, reject);
    })
};
