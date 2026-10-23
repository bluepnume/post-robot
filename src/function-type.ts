import type { CustomType, Ref } from 'sandestin';

import { getDomain } from 'cross-domain-utils';
import { isRef } from 'sandestin';
import { ZalgoPromise } from 'zalgo-promise';

import { SERIALIZATION_TYPE } from './constants';

import type { PeerContext } from './peer';
import type { CrossDomainFunctionType } from './types';

import { assertExists, noop } from './helpers';

type AnyArgs = ReadonlyArray<unknown>;

type AnyFunction = (...args : AnyArgs) => unknown;

// A remote function, dressed the way post-robot has always handed them out:
// a function returning a ZalgoPromise, with `fireAndForget` beside it.
const wrapRemoteFunction = (ref : Ref, { source, origin } : PeerContext) : CrossDomainFunctionType => {
    const wrapper = (...args : AnyArgs) : ZalgoPromise => ZalgoPromise.resolve(ref.invoke({ args }));

    Object.defineProperty(wrapper, 'name', { value: ref.name });

    return Object.assign(wrapper, {
        fireAndForget: (...args : AnyArgs) : ZalgoPromise<void> =>
            ZalgoPromise.resolve(ref.invoke({ args, reply: false })).then(noop),

        __name__:   ref.name,
        __origin__: origin,
        __source__: source,
        __ref__:    ref,
        origin
    });
};

// One of our own functions, handed to another window and handed back: call
// it here, directly. The call is local, so `this` names this window, as it
// did in post-robot 11; the wrapper still records where it came back from.
const wrapLocalFunction = (fn : AnyFunction, { source, origin } : PeerContext) : CrossDomainFunctionType => {
    const call = (args : AnyArgs) : ZalgoPromise =>
        ZalgoPromise.try(() => fn.apply({ source: window, origin: getDomain() }, [ ...args ]));

    const wrapper = (...args : AnyArgs) : ZalgoPromise => call(args);

    Object.defineProperty(wrapper, 'name', { value: fn.name });

    return Object.assign(wrapper, {
        fireAndForget: (...args : AnyArgs) : ZalgoPromise<void> => {
            call(args).catch(noop);

            return ZalgoPromise.resolve();
        },

        __name__:   fn.name,
        __origin__: origin,
        __source__: source,
        origin
    });
};

type Wrapped = AnyFunction & { readonly __ref__ ?: Ref };

// The function goes across as a sandestin handle, bound to the context of
// the message that carried it. A wrapper around a remote function is
// unwrapped first, so sandestin sees where it came from: sent back to its
// owner it becomes the original again, sent on to a third window it is
// relayed.
export const functionType : CustomType<AnyFunction, AnyFunction, PeerContext> = {
    name:   SERIALIZATION_TYPE.CROSS_DOMAIN_FUNCTION,
    test:   value => typeof value === 'function',
    encode: ({ value }) => (value as Wrapped).__ref__ ?? value,

    // Every decode in post-robot carries a context.
    decode: ({ value, context }) => {
        const peerContext = assertExists(context, 'window context');

        return isRef(value)
            ? wrapRemoteFunction(value, peerContext)
            : wrapLocalFunction(value, peerContext);
    }
};
