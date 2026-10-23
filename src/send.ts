import { isWindowClosed, PROTOCOL } from 'cross-domain-utils';
import { ZalgoPromise } from 'zalgo-promise';

import { GLOBAL_KEY, WILDCARD } from './constants';

import type { Message } from './messages';
import type { Transport } from './types';

import { windowStore } from './global';
import { assertExists, noop } from './helpers';
import { serializeMessage } from './serialize';

type Buffered = {
    buffer ?: Array<Message>,
    flush ?: ZalgoPromise<void>,
};

type SendMessageOptions = {
    readonly win : Window,
    readonly domain : string,
    readonly message : Message,
    readonly transport : Transport,
};

// Posts a message to a window. Messages sent within one synchronous burst
// are batched into one postMessage, keyed by the global key so a receiver
// of a different major version ignores them.
export const sendMessage = ({ win, domain, message, transport } : SendMessageOptions) : ZalgoPromise<void> =>
    ZalgoPromise.try(() => {
        const buffered = windowStore<Buffered>('messageBuffer').getOrSet(win, () => ({}));

        buffered.buffer ??= [];
        buffered.buffer.push(message);

        buffered.flush ??= ZalgoPromise.flush().then(() => {
            if (isWindowClosed(win)) {
                throw new Error('Window is closed');
            }

            const packed = { [ GLOBAL_KEY ]: assertExists(buffered.buffer, 'message buffer') };

            delete buffered.buffer;

            const serialized = serializeMessage({ destination: win, domain, value: packed, transport });

            // A file: page has an opaque origin that no target can match.
            win.postMessage(serialized, domain.startsWith(PROTOCOL.FILE)
                ? WILDCARD
                : domain);
        });

        return buffered.flush.then(() => {
            delete buffered.flush;
        });
    }).then(noop);
