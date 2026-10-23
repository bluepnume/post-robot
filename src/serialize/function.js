/* @flow */

import {
  type CrossDomainWindowType,
  type DomainMatcher,
} from "@krakenjs/cross-domain-utils/src";
import { ZalgoPromise } from "@krakenjs/zalgo-promise/src";
import { noop, arrayFrom } from "@krakenjs/belter/src";
import { isRef } from "sandestin";

import { SERIALIZATION_TYPE } from "../conf";
import type { CrossDomainFunctionType } from "../types";

import type { ProxyWindow } from "./window";
import type { Peer } from "./peer";

// The domain each function was handed out to, checked when a call for it
// comes back in.
const functionDomains: WeakMap<Function, DomainMatcher> = new WeakMap();

export function getFunctionDomain(fn: Function): ?DomainMatcher {
  return functionDomains.get(fn);
}

function stringifyArguments(args: $ReadOnlyArray<mixed> = []): string {
  return arrayFrom(args)
    .map((arg) => {
      if (typeof arg === "string") {
        return `'${arg}'`;
      }
      if (arg === undefined) {
        return "undefined";
      }
      if (arg === null) {
        return "null";
      }
      if (typeof arg === "boolean") {
        return arg.toString();
      }
      if (Array.isArray(arg)) {
        return "[ ... ]";
      }
      if (typeof arg === "object") {
        return "{ ... }";
      }
      if (typeof arg === "function") {
        return "() => { ... }";
      }
      return `<${typeof arg}>`;
    })
    .join(", ");
}

// An error that crossed back from the other side carries its original stack
// as `remoteStack`; surface it the way post-robot always has.
export function annotateRemoteError(
  err: mixed,
  name: string,
  args: $ReadOnlyArray<mixed>
) {
  if (
    err &&
    typeof err === "object" &&
    typeof err.remoteStack === "string" &&
    typeof err.stack === "string"
  ) {
    const remoteStack: string = err.remoteStack;
    const localStack: string = err.stack;
    const call = `${name}(${stringifyArguments(args)})`;

    // $FlowFixMe
    err.stack = `Remote call to ${call} failed\n\n${remoteStack}\n\n${localStack}`;
  }
}

// eslint-disable-next-line flowtype/no-weak-types
type Ref = any;

function wrapRemoteFunction<A: $ReadOnlyArray<mixed>, R>(
  ref: Ref,
  {
    source,
    origin,
  }: {| source: CrossDomainWindowType | ProxyWindow, origin: string |}
): CrossDomainFunctionType<A, R> {
  const name: string = ref.name;

  const invoke = (args: $ReadOnlyArray<mixed>): ZalgoPromise<R> =>
    ZalgoPromise.resolve(ref.invoke({ args }));

  function crossDomainFunctionWrapper(...args: A): ZalgoPromise<R> {
    return invoke(args).catch((err) => {
      annotateRemoteError(err, name, args);
      throw err;
    });
  }

  crossDomainFunctionWrapper.fireAndForget = (
    ...args: A
  ): ZalgoPromise<void> => {
    invoke(args).catch(noop);
    return ZalgoPromise.resolve();
  };

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
  {
    source,
    origin,
  }: {| source: CrossDomainWindowType | ProxyWindow, origin: string |}
): CrossDomainFunctionType<A, R> {
  const call = (args: $ReadOnlyArray<mixed>): ZalgoPromise<R> =>
    ZalgoPromise.try(() => (fn.apply({ source, origin }, args): R));

  function localFunctionWrapper(...args: A): ZalgoPromise<R> {
    return call(args);
  }

  localFunctionWrapper.fireAndForget = (...args: A) => {
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

// Each peer gets its own copy, bound to the window it talks to; that is how
// a function encoded for a result or an argument, where no message is being
// serialized, still knows which window it is for.
export function getFunctionType(peer: Peer): {|
  name: string,
  test: (mixed) => boolean,
  encode: ({| value: Function |}) => Function,
  decode: ({| value: Ref |}) => CrossDomainFunctionType<*, *>,
|} {
  return {
    name: SERIALIZATION_TYPE.CROSS_DOMAIN_FUNCTION,

    test: (value) => typeof value === "function",

    // The function itself goes across as a sandestin handle; all this adds
    // is the record of which domain it was given to. A wrapper around a
    // remote function is unwrapped first, so sandestin can see where it came
    // from: sent back to its owner it becomes the original again, sent on
    // to a third window it is relayed.
    encode: ({ value }) => {
      functionDomains.set(value, peer.getDomain());
      // $FlowFixMe
      return value.__ref__ || value;
    },

    decode: ({ value }) => {
      const source = peer.win;
      const origin = peer.getDomain();

      return isRef(value)
        ? wrapRemoteFunction(value, { source, origin })
        : wrapLocalFunction(value, { source, origin });
    },
  };
}
