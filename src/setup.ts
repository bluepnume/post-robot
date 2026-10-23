import type { DomainMatcher } from 'cross-domain-utils';

import { on, send, setup } from './api';
import { ProxyWindow } from './proxy-window';
import {
    deserializeMessage as internalDeserializeMessage, serializeMessage as internalSerializeMessage
} from './serialize';

export { ZalgoPromise } from 'zalgo-promise';

export { GLOBAL_KEY, MAJOR_VERSION, MESSAGE_NAME, WILDCARD } from './constants';

export { awaitWindowHello } from './hello';

export { markWindowKnown } from './known-windows';

export { ProxyWindow } from './proxy-window';

// Serialize a value for a window the way a message to it would be, so a
// layer above can carry it another way (in a url, say) and decode it there.
// Set up first: setup says hello, which serializes, and that must not run
// inside the first registration of the peer listeners.
export const serializeMessage = (
    destination : Window | ProxyWindow,
    domain : DomainMatcher,
    obj : unknown
) : string => {
    setup();

    return internalSerializeMessage({ destination, domain, value: obj, transport: { on, send } });
};

export const deserializeMessage = <T = unknown>(
    source : Window | ProxyWindow,
    origin : string,
    message : string
) : T => {
    setup();

    return internalDeserializeMessage<T>({ source, origin, text: message, transport: { on, send } });
};

export const createProxyWindow = (win ?: Window) : ProxyWindow => new ProxyWindow({ send, win });

export const toProxyWindow = (win : Window | ProxyWindow) : ProxyWindow => ProxyWindow.toProxyWindow(win, { send });
