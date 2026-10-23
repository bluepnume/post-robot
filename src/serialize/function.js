/* @flow */

import { ZalgoPromise } from "@krakenjs/zalgo-promise/src";
import { noop } from "@krakenjs/belter/src";
import { isRef } from "sandestin";

import { SERIALIZATION_TYPE } from "../conf";
import type { CrossDomainFunctionType } from "../types";

import type { PeerContext } from "./peer";

// eslint-disable-next-line flowtype/no-weak-types
type Ref = any;

function wrapRemoteFunction<A: $ReadOnlyArray<mixed>, R>(
  ref: Ref,
  { source, origin }: PeerContext
): CrossDomainFunctionType<A, R> {
  const name: string = ref.name;

  function crossDomainFunctionWrapper(...args: A): ZalgoPromise<R> {
    return ZalgoPromise.resolve(ref.invoke({ args }));
  }

  crossDomainFunctionWrapper.fireAndForget = (...args: A): ZalgoPromise<void> =>
    ZalgoPromise.resolve(ref.invoke({ args, reply: false }));

  crossDomainFunctionWrapper.__name__ = name;
  crossDomainFunctionWrapper.__origin__ = origin;
  crossDomainFunctionWrapper.__source__ = source;
  crossDomainFunctionWrapper.__ref__ = ref;
  crossDomainFunctionWrapper.origin = origin;

  // Keep the original's name so that sending the wrapper onward keeps it too.
  Object.defineProperty(crossDomainFunctionWrapper, "name", { value: name });

  return crossDomainFunctionWrapper;
}

// One of our own functions, handed to another window and handed back: call
// it here, the way the other side would have.
function wrapLocalFunction<A: $ReadOnlyArray<mixed>, R>(
  fn: Function,
  { source, origin }: PeerContext
): CrossDomainFunctionType<A, R> {
  const call = (args: $ReadOnlyArray<mixed>): ZalgoPromise<R> =>
    ZalgoPromise.try(() => (fn.apply({ source, origin }, args): R));

  function localFunctionWrapper(...args: A): ZalgoPromise<R> {
    return call(args);
  }

  localFunctionWrapper.fireAndForget = (...args: A): ZalgoPromise<void> => {
    call(args).catch(noop);
    return ZalgoPromise.resolve();
  };

  localFunctionWrapper.__name__ = fn.name;
  localFunctionWrapper.__origin__ = origin;
  localFunctionWrapper.__source__ = source;
  localFunctionWrapper.origin = origin;

  Object.defineProperty(localFunctionWrapper, "name", { value: fn.name });

  return localFunctionWrapper;
}

// The function itself goes across as a sandestin handle, bound to the
// context of the message that carried it. A wrapper around a remote function
// is unwrapped first, so sandestin can see where it came from: sent back to
// its owner it becomes the original again, sent on to a third window it is
// relayed.
export const functionType = {
  name: SERIALIZATION_TYPE.CROSS_DOMAIN_FUNCTION,

  test: (value: mixed): boolean => typeof value === "function",

  // $FlowFixMe
  encode: ({ value }: {| value: Function |}): Function =>
    value.__ref__ || value,

  decode: ({
    value,
    context,
  }: {|
    value: Ref,
    context: PeerContext,
  |}): CrossDomainFunctionType<*, *> => {
    return isRef(value)
      ? wrapRemoteFunction(value, context)
      : wrapLocalFunction(value, context);
  },
};
