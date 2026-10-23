import { ZalgoPromise } from 'zalgo-promise';

import { MESSAGE_ACK, MESSAGE_TYPE } from './constants';

import type { AckMessage, ResponseMessage } from './messages';

import { on, send } from './api';
import { handleAck, handleResponse } from './handlers';
import { addResponseListener, markResponseListenerErrored } from './listeners';

const transport = { on, send };

const listen = (hash : string, domain = location.origin) : ZalgoPromise => {
    const promise = new ZalgoPromise<unknown>();

    addResponseListener(hash, { name: 'test', win: window, domain, promise });

    return promise;
};

const ackFor = (hash : string) : AckMessage =>
    ({ id: crypto.randomUUID(), origin: location.origin, type: MESSAGE_TYPE.ACK, hash, name: 'test' });

type ResponseForOptions = { readonly data ?: unknown, readonly error ?: unknown };

const responseFor = (hash : string, outcome : ResponseForOptions) : ResponseMessage => ({
    id:     crypto.randomUUID(),
    origin: location.origin,
    type:   MESSAGE_TYPE.RESPONSE,
    hash,
    name:   'test',
    ack:    outcome.error === undefined
        ? MESSAGE_ACK.SUCCESS
        : MESSAGE_ACK.ERROR,
    ...outcome
});

type Delivery<Message> = {
    readonly message : Message,
    readonly source ?: Window,
    readonly origin ?: string,
};

const ack = ({ message, source = window, origin = location.origin } : Delivery<AckMessage>) : void =>
    handleAck({ source, origin, message, transport });

const respond = ({ message, source = window, origin = location.origin } : Delivery<ResponseMessage>) : void =>
    handleResponse({ source, origin, message, transport });

// Another window to be the wrong source.
const withOtherWindow = async (run : (other : Window) => Promise<void> | void) : Promise<void> => {
    const frame = document.createElement('iframe');

    document.body.append(frame);

    const other = frame.contentWindow;

    if (!other) {
        throw new Error('Frame has no window');
    }

    try {
        await run(other);
    } finally {
        frame.remove();
    }
};

describe('handleAck', () => {
    it('marks the listener acknowledged', () => {
        const hash = crypto.randomUUID();
        const promise = listen(hash);

        ack({ message: ackFor(hash) });
        expect(promise.resolved || promise.rejected).toBe(false);
    });

    it('rejects the request when the ack comes from the wrong origin or window', async () => {
        const wrongOrigin = crypto.randomUUID();
        const fromElsewhere = listen(wrongOrigin);

        ack({ message: ackFor(wrongOrigin), origin: 'https://elsewhere.example' });
        await expect(fromElsewhere.toPromise()).rejects.toThrow('does not match domain');

        await withOtherWindow(async other => {
            const wrongWindow = crypto.randomUUID();
            const fromOther = listen(wrongWindow);

            ack({ message: ackFor(wrongWindow), source: other });
            await expect(fromOther.toPromise()).rejects.toThrow('source does not match');
        });
    });

    it('throws for an unknown hash, and ignores one already errored', () => {
        expect(() => ack({ message: ackFor('unknown') })).toThrow('No handler found');

        const errored = crypto.randomUUID();

        markResponseListenerErrored(errored);
        expect(() => ack({ message: ackFor(errored) })).not.toThrow();
    });
});

describe('handleResponse', () => {
    it('resolves the request with the data, source and origin', async () => {
        const hash = crypto.randomUUID();
        const promise = listen(hash);

        respond({ message: responseFor(hash, { data: { ok: true } }) });
        expect(await promise).toEqual({ source: window, origin: location.origin, data: { ok: true } });
    });

    it('rejects the request with the error', async () => {
        const hash = crypto.randomUUID();
        const promise = listen(hash);

        respond({ message: responseFor(hash, { error: new Error('nope') }) });
        await expect(promise.toPromise()).rejects.toThrow('nope');
    });

    it('throws for the wrong origin, the wrong window, or an unknown hash; ignores an errored one', async () => {
        const hash = crypto.randomUUID();

        listen(hash).lazy();
        expect(() => respond({ message: responseFor(hash, {}), origin: `https://elsewhere.example` })).toThrow(`does not match domain`);

        await withOtherWindow(other => {
            expect(() => respond({ message: responseFor(hash, {}), source: other })).toThrow('source does not match');
        });

        expect(() => respond({ message: responseFor('unknown', {}) })).toThrow('No handler found');

        const errored = crypto.randomUUID();

        markResponseListenerErrored(errored);
        expect(() => respond({ message: responseFor(errored, {}) })).not.toThrow();
    });
});
