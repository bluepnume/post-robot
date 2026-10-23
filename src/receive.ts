import { isWindowClosed, PROTOCOL } from 'cross-domain-utils';

import { GLOBAL_KEY, MESSAGE_TYPE } from './constants';

import type { Message } from './messages';
import type { Cancelable, Transport } from './types';

import { globalStore } from './global';
import { handleAck, handleRequest, handleResponse } from './handlers';
import { addEventListener } from './helpers';
import { markWindowKnown } from './known-windows';
import { deserializeMessage } from './serialize';

type DeserializeMessagesOptions = {
    readonly data : unknown,
    readonly source : Window,
    readonly origin : string,
    readonly transport : Transport,
};

// The messages in a postMessage payload, or nothing if it is not ours: not
// a string, not our envelope, or from another major version.
const deserializeMessages = (
    { data, source, origin, transport } : DeserializeMessagesOptions
) : ReadonlyArray<Message> | undefined => {
    if (typeof data !== 'string') {
        return undefined;
    }

    let parsed : unknown;

    try {
        parsed = deserializeMessage({ source, origin, text: data, transport });
    } catch {
        return undefined;
    }

    if (typeof parsed !== 'object' || parsed === null) {
        return undefined;
    }

    const messages = (parsed as Record<string, unknown>)[GLOBAL_KEY];

    return Array.isArray(messages)
        ? messages as ReadonlyArray<Message>
        : undefined;
};

// Surface an error without stopping the rest of the batch.
const rethrowLater = (err : unknown) : void => {
    setTimeout(() => {
        throw err;
    }, 0);
};

type ReceiveMessageOptions = {
    readonly source : Window,
    readonly origin : string,
    readonly data : unknown,
    readonly transport : Transport,
};

const receiveMessage = ({ source, origin, data, transport } : ReceiveMessageOptions) : void => {
    const received = globalStore<boolean>('receivedMessages');
    const messages = deserializeMessages({ data, source, origin, transport });

    if (!messages) {
        return;
    }

    markWindowKnown(source);

    for (const message of messages) {
        if (received.has(message.id)) {
            continue;
        }

        received.set(message.id, true);

        if (isWindowClosed(source) && !('fireAndForget' in message && message.fireAndForget)) {
            continue;
        }

        // A file: page reports its origin as "null"; keep the sender's own word.
        const messageOrigin = message.origin.startsWith(PROTOCOL.FILE)
            ? `${ PROTOCOL.FILE }//`
            : origin;

        try {
            if (message.type === MESSAGE_TYPE.REQUEST) {
                handleRequest({ source, origin: messageOrigin, message, transport }).catch(rethrowLater);
            } else if (message.type === MESSAGE_TYPE.RESPONSE) {
                handleResponse({ source, origin: messageOrigin, message, transport });
            } else {
                handleAck({ source, origin: messageOrigin, message, transport });
            }
        } catch (err) {
            rethrowLater(err);
        }
    }
};

const messageListener = (event : Event, transport : Transport) : void => {
    const { source, origin } = event as globalThis.MessageEvent;
    const data : unknown = (event as globalThis.MessageEvent).data;

    if (!source) {
        return;
    }

    receiveMessage({
        source: source as Window,
        origin: origin === 'null'
            ? `${ PROTOCOL.FILE }//`
            : origin,
        data,
        transport
    });
};

export const listenForMessages = (transport : Transport) : Cancelable =>
    globalStore<Cancelable>().getOrSet('postMessageListener', () =>
        addEventListener(window, 'message', event => messageListener(event, transport)));

export const stopListenForMessages = () : void => {
    globalStore<Cancelable>().get('postMessageListener')?.cancel();
};
