import { getDomain, isWindowClosed, matchDomain, stringifyDomainPattern } from 'cross-domain-utils';
import { ZalgoPromise } from 'zalgo-promise';

import { MESSAGE_ACK, MESSAGE_TYPE } from './constants';

import type { AckMessage, RequestMessage, ResponseMessage } from './messages';
import type { Transport } from './types';

import { noop, stringifyError, uniqueID } from './helpers';
import {
    deleteResponseListener, getRequestListener, getResponseListener, isResponseListenerErrored
} from './listeners';
import { sendMessage } from './send';

type HandleOptions<MessageShape> = {
    readonly source : Window,
    readonly origin : string,
    readonly message : MessageShape,
    readonly transport : Transport,
};

// A request arrived: acknowledge it, run the handler, send its result or
// error back. Both replies are skipped for fire-and-forget requests.
export const handleRequest = (
    { source, origin, message, transport } : HandleOptions<RequestMessage>
) : ZalgoPromise<void> => {
    const listener = getRequestListener({ name: message.name, win: source, domain: origin });

    const reply = (response : AckMessage | ResponseMessage, what : string) : ZalgoPromise<void> =>
        ZalgoPromise.flush().then(() => {
            if (message.fireAndForget || isWindowClosed(source)) {
                return undefined;
            }

            return sendMessage({ win: source, domain: origin, message: response, transport }).catch((err : unknown) => {
                const detail = stringifyError(err);

                throw new Error(`Send ${ what } message failed for ${ message.name } in ${ getDomain() }\n\n${ detail }`);
            });
        });

    const ack = reply({
        id:     uniqueID(),
        origin: getDomain(),
        type:   MESSAGE_TYPE.ACK,
        hash:   message.hash,
        name:   message.name
    }, 'ack');

    const response = ZalgoPromise.try(() => {
        if (!listener) {
            throw new Error(`No handler found for post message: ${ message.name } from ${ origin } in ${ location.href }`);
        }

        return listener.handler({ source, origin, data: message.data });
    }).then(
        data => reply({
            id:     uniqueID(),
            origin: getDomain(),
            type:   MESSAGE_TYPE.RESPONSE,
            hash:   message.hash,
            name:   message.name,
            ack:    MESSAGE_ACK.SUCCESS,
            data
        }, 'response'),
        (error : unknown) => reply({
            id:     uniqueID(),
            origin: getDomain(),
            type:   MESSAGE_TYPE.RESPONSE,
            hash:   message.hash,
            name:   message.name,
            ack:    MESSAGE_ACK.ERROR,
            error
        }, 'response')
    );

    return ZalgoPromise.all([ ack, response ]).then(noop).catch((err : unknown) => {
        if (listener) {
            listener.handleError(err);

            return;
        }

        throw err;
    });
};

export const handleAck = ({ source, origin, message } : HandleOptions<AckMessage>) : void => {
    if (isResponseListenerErrored(message.hash)) {
        return;
    }

    const listener = getResponseListener(message.hash);

    if (!listener) {
        throw new Error(
            `No handler found for post message ack for message: ${ message.name } from ${ origin } in ${ location.href }`
        );
    }

    if (!matchDomain(listener.domain, origin)) {
        listener.promise.reject(new Error(`Ack origin ${ origin } does not match domain ${ stringifyDomainPattern(listener.domain) }`));
    } else if (source !== listener.win) {
        listener.promise.reject(new Error('Ack source does not match registered window'));
    }

    listener.ack = true;
};

export const handleResponse = ({ source, origin, message } : HandleOptions<ResponseMessage>) : void => {
    if (isResponseListenerErrored(message.hash)) {
        return;
    }

    const listener = getResponseListener(message.hash);

    if (!listener) {
        throw new Error(
            `No handler found for post message response for message: ${ message.name } from ${ origin } in ${ location.href }`
        );
    }

    if (!matchDomain(listener.domain, origin)) {
        throw new Error(`Response origin ${ origin } does not match domain ${ stringifyDomainPattern(listener.domain) }`);
    }

    if (source !== listener.win) {
        throw new Error('Response source does not match registered window');
    }

    deleteResponseListener(message.hash);

    if (message.ack === MESSAGE_ACK.ERROR) {
        listener.promise.reject(message.error);
    } else {
        listener.promise.resolve({ source, origin, data: message.data });
    }
};
