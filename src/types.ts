import type { DomainMatcher } from 'cross-domain-utils';
import type { ZalgoPromise } from 'zalgo-promise';

import type { ProxyWindow } from './proxy-window';

export type Cancelable = {
    readonly cancel : () => void,
};

export type MessageEvent = {
    readonly source : Window,
    readonly origin : string,
    readonly data : unknown,
};

// A handler for `on`: gets the sending window, its origin and the decoded
// data; whatever it returns (or resolves) is the response.
export type Handler = (event : MessageEvent) => unknown;

export type ErrorHandler = (err : unknown) => void;

export type ServerOptions = {
    readonly handler ?: Handler,
    readonly errorHandler ?: ErrorHandler,
    // Only accept this request from this window, or any of these.
    readonly window ?: Window | ProxyWindow | ReadonlyArray<Window | ProxyWindow>,
    readonly name ?: string,
    // Only accept it from an origin matching this.
    readonly domain ?: DomainMatcher,
    readonly once ?: boolean,
    readonly errorOnClose ?: boolean,
};

export type OnType = (name : string, options : ServerOptions | Handler, handler ?: Handler) => Cancelable;

export type RequestOptions = {
    // The origin the target window must be at, or match.
    readonly domain ?: DomainMatcher,
    // Send without waiting for an acknowledgement or a response.
    readonly fireAndForget ?: boolean,
    // Milliseconds to wait for the response; -1 waits forever.
    readonly timeout ?: number,
};

export type ResponseMessageEvent = {
    readonly source : Window,
    readonly origin : string,
    readonly data : unknown,
};

/* eslint-disable @typescript-eslint/max-params -- `send(win, name, data, options)` is the API every caller is written against */
export type SendType = (
    win : Window | ProxyWindow,
    name : string,
    data ?: unknown,
    options ?: RequestOptions
) => ZalgoPromise<ResponseMessageEvent>;
/* eslint-enable @typescript-eslint/max-params */

// A function received from another window: calling it runs the original
// there and resolves with its result.
export type CrossDomainFunctionType<Args extends ReadonlyArray<unknown> = ReadonlyArray<unknown>, Result = unknown> = {
    (...args : Args) : ZalgoPromise<Result>,
    readonly fireAndForget : (...args : Args) => ZalgoPromise<void>,
    readonly __name__ : string,
    readonly __origin__ : DomainMatcher,
    readonly __source__ : Window | ProxyWindow,
    readonly origin : DomainMatcher,
};

export type Transport = {
    readonly on : OnType,
    readonly send : SendType,
};
