import { GLOBAL_KEY, MESSAGE_TYPE } from './constants';

import { on, send, setup } from './api';

// Messages posted to this window, crafted to reach the receiver's edges.
const post = (data : unknown) : void => window.postMessage(data, '*');

const settle = () : Promise<void> => new Promise(resolve => {
    setTimeout(resolve, 100);
});

// Errors the receiver rethrows off the stack would fail the run; collect them.
const swallowing = async (run : () => Promise<void>) : Promise<ReadonlyArray<string>> => {
    const seen : Array<string> = [];

    const onError = (event : ErrorEvent) : void => {
        seen.push(event.message);
        event.preventDefault();
    };

    window.addEventListener('error', onError);

    try {
        await run();
    } finally {
        window.removeEventListener('error', onError);
    }

    return seen;
};

describe('receiving', () => {
    beforeAll(() => {
        setup();
    });

    it('ignores data that is not a string, not JSON, not an object, or not under our key', async () => {
        post({ an: 'object' });
        post('not json');
        post(JSON.stringify('a string'));
        post(JSON.stringify({ __post_robot_11__: [] }));
        post(JSON.stringify({ [ GLOBAL_KEY ]: 'not a list' }));
        await settle();

        const { data } = await send(window, 'self-check', {}, { fireAndForget: true });

        expect(data).toBeUndefined();
    });

    it('drops a message it has already seen', async () => {
        let count = 0;

        const listener = on('dup', () => {
            count += 1;
        });

        const message = {
            id:            'same-id',
            origin:        location.origin,
            type:          MESSAGE_TYPE.REQUEST,
            name:          'dup',
            hash:          'dup_hash',
            data:          null,
            fireAndForget: true
        };

        post(JSON.stringify({ [ GLOBAL_KEY ]: [ message ] }));
        post(JSON.stringify({ [ GLOBAL_KEY ]: [ message ] }));
        await settle();
        listener.cancel();
        expect(count).toBe(1);
    });

    it('rethrows a handler failure off the stack rather than dropping the batch', async () => {
        const errors = await swallowing(async () => {
            post(JSON.stringify({
                [ GLOBAL_KEY ]: [
                    { id: crypto.randomUUID(), origin: location.origin, type: MESSAGE_TYPE.ACK, name: `x`, hash: `unknown` }
                ]
            }));

            await settle();
        });

        expect(errors.join('\n')).toMatch(/No handler found for post message ack/u);
    });

    it('treats a sender that reports a file origin as file://', async () => {
        const errors = await swallowing(async () => {
            post(JSON.stringify({
                [ GLOBAL_KEY ]: [
                    { id: crypto.randomUUID(), origin: `file://`, type: MESSAGE_TYPE.ACK, name: `x`, hash: `unknown-file` }
                ]
            }));

            await settle();
        });

        expect(errors.join('\n')).toMatch(/from file:\/\//u);
    });

    it('hears a sandboxed frame as an opaque origin and answers it with a wildcard', async () => {
        const frame = document.createElement('iframe');

        frame.sandbox.add('allow-scripts');

        frame.srcdoc = `<script>
            parent.postMessage(JSON.stringify({ ${ JSON.stringify(GLOBAL_KEY) }: [ {
                id: 'from-sandbox', origin: 'file://', type: ${ JSON.stringify(MESSAGE_TYPE.REQUEST) },
                name: 'sandboxed', hash: 'sandbox_hash', data: { hello: 'opaque' }
            } ] }), '*');
        </script>`;

        let heard : unknown;

        const listener = on('sandboxed', ({ origin, data }) => {
            heard = { origin, data };
        });

        document.body.append(frame);

        try {
            await settle();
        } finally {
            frame.remove();
            listener.cancel();
        }

        expect(heard).toEqual({ origin: 'file://', data: { hello: 'opaque' } });
    });
});
