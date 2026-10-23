import { on, once, send } from '../src';

import { expectError, getWindows, setupWindows } from './common';

setupWindows();

describe('options cases', () => {
    it('listens for a message only once', async () => {
        const { childFrame } = getWindows();
        let count = 0;

        once('foobuz', () => {
            count += 1;
        });

        await send(childFrame, 'sendMessageToParent', { messageName: 'foobuz' });
        await expectError(send(childFrame, 'sendMessageToParent', { messageName: 'foobuz' }));
        expect(count).toBe(1);
    });

    it('once resolves with the event and can be cancelled', async () => {
        const { childFrame } = getWindows();
        const waiting = once('onceevent');

        await send(childFrame, 'sendMessageToParent', { messageName: 'onceevent', data: { hi: true } });

        const event = await waiting;

        expect(event.data).toEqual({ hi: true });
        expect(event.source).toBe(childFrame);

        const cancelled = once('nevercomes');

        cancelled.cancel();
        await expectError(send(childFrame, 'sendMessageToParent', { messageName: 'nevercomes' }));
    });

    it('re-registers the same once handler after the first is called', async () => {
        const { childFrame } = getWindows();
        let count = 0;

        once('foobuzz2', ({ data }) => {
            count += (data as { add : number }).add;
        });

        await send(childFrame, 'sendMessageToParent', { messageName: 'foobuzz2', data: { add: 2 } });

        once('foobuzz2', ({ data }) => {
            count += (data as { add : number }).add;
        });

        await send(childFrame, 'sendMessageToParent', { messageName: 'foobuzz2', data: { add: 3 } });
        expect(count).toBe(5);
    });

    it('allows the same listener name for different windows, and refuses a duplicate', () => {
        const { childFrame, otherChildFrame } = getWindows();
        const first = on('onceonlywindow', { window: childFrame }, () => undefined);
        const second = on('onceonlywindow', { window: otherChildFrame }, () => undefined);

        expect(() => on('onceonlywindow', { window: childFrame }, () => undefined)).toThrow('already exists');
        first.cancel();
        second.cancel();

        const any = on('onceonlyany', () => undefined);

        expect(() => on('onceonlyany', () => undefined)).toThrow('already exists');
        any.cancel();
        expect(() => on('', () => undefined)).toThrow('Expected name');
        expect(() => on('nohandler', {})).toThrow('Expected handler');
    });

    it('registers a listener for a specific window, or a list of them', async () => {
        const { childFrame, otherChildFrame } = getWindows();
        let count = 0;

        const listener = on('specificchildlistener', { window: otherChildFrame }, () => {
            count += 1;
        });

        await send(otherChildFrame, 'sendMessageToParent', { messageName: 'specificchildlistener' });
        await expectError(send(childFrame, 'sendMessageToParent', { messageName: 'specificchildlistener' }));
        expect(count).toBe(1);
        listener.cancel();

        const both = on('bothframes', { window: [ childFrame, otherChildFrame ] }, () => {
            count += 1;
        });

        await send(childFrame, 'sendMessageToParent', { messageName: 'bothframes' });
        await send(otherChildFrame, 'sendMessageToParent', { messageName: 'bothframes' });
        expect(count).toBe(3);
        both.cancel();
    });

    it('cancelling a pattern listener twice is harmless', () => {
        const listener = on('patterncancel', { domain: /anything/u }, () => undefined);

        listener.cancel();
        listener.cancel();
    });

    it('a handler error goes to the error handler', async () => {
        const { childFrame } = getWindows();
        const seen : Array<unknown> = [];

        const listener = on('erroring', {
            handler: () => {
                throw new Error('handler failed');
            },

            errorHandler: err => seen.push(err)
        });

        await expectError(send(childFrame, 'sendMessageToParent', { messageName: 'erroring' }));
        listener.cancel();
        expect(seen).toEqual([]);
    });

    it('times out waiting for a response', async () => {
        const { childFrame } = getWindows();

        await send(childFrame, 'setupListener', {
            messageName: 'slow',

            handler: () => new Promise(() => {
                // never settles
            })
        });

        const err = await expectError(send(childFrame, 'slow', {}, { timeout: 700 }));

        expect((err as Error).message).toMatch(/No response for postMessage slow/u);
    });
});
