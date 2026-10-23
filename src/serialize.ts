import type { DomainMatcher } from 'cross-domain-utils';

import type { ProxyWindow } from './proxy-window';
import type { Transport } from './types';

import { getPeer, listenForPeerRequests } from './peer';

type SerializeMessageOptions = {
    readonly destination : Window | ProxyWindow,
    readonly domain : DomainMatcher,
    readonly value : unknown,
    readonly transport : Transport,
};

export const serializeMessage = ({ destination, domain, value, transport } : SerializeMessageOptions) : string => {
    listenForPeerRequests(transport);

    return getPeer(destination, transport).serdes.encodeJSON({
        value,
        context: { source: destination, origin: domain }
    });
};

type DeserializeMessageOptions = {
    readonly source : Window | ProxyWindow,
    readonly origin : string,
    readonly text : string,
    readonly transport : Transport,
};

export const deserializeMessage = <T = unknown>(
    { source, origin, text, transport } : DeserializeMessageOptions
) : T => {
    listenForPeerRequests(transport);

    return getPeer(source, transport).serdes.decodeJSON({
        text,
        context: { source, origin }
    }) as T;
};
