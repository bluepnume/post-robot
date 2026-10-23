import { destroy, on, send } from '../src';

import { childPage, createIframe, expectError, getWindows, setupWindows } from './common';

setupWindows();

describe('error cases', () => {
    it('errors when messaging with an unknown name', async () => {
        const { childFrame } = getWindows();
        const err = await expectError(send(childFrame, 'doesntexist'));

        expect((err as Error).message).toMatch(/No handler found/u);
    });

    it('fails to receive when the expected domain does not match', async () => {
        const { childFrame } = getWindows();

        const listener = on('foobuzzzzz', { domain: 'http://www.zombo.com' }, () => {
            throw new Error('should not be called');
        });

        await expectError(send(childFrame, 'sendMessageToParent', { messageName: 'foobuzzzzz' }));
        listener.cancel();
    });

    it('fails to send when the target domain does not match', async () => {
        const { childFrame } = getWindows();

        await send(childFrame, 'setupListener', { messageName: 'foo2', data: { foo: 'bar' } });

        const err = await expectError(send(childFrame, 'foo2', {}, { domain: [ 'http://www.zombo.com' ] }));

        expect((err as Error).message).toMatch(/does not match/u);
    });

    it('rejects a bad domain option and a closed window', async () => {
        const { childFrame } = getWindows();

        await expectError(send(childFrame, 'echo', {}, { domain: 42 as unknown as string }));

        const frame = document.createElement('iframe');

        document.body.append(frame);

        const gone = frame.contentWindow;

        if (!gone) {
            throw new Error('Frame has no window');
        }

        frame.remove();

        const err = await expectError(send(gone, 'echo'));

        expect((err as Error).message).toMatch(/closed/u);
    });

    it('rejects an empty name', async () => {
        const { childFrame } = getWindows();

        await expect(send(childFrame, '').toPromise()).rejects.toThrow('Expected name');
    });

    it('gives up on a window that acknowledges nothing', async () => {
        // The window around this test page runs no post-robot, and it is not
        // this window's child, so nothing is waited for before sending.
        const err = await expectError(send(window.parent, 'anyone-there'));

        expect((err as Error).message).toMatch(/No ack for postMessage anyone-there/u);
    });

    it('fails a request when the window closes before responding', async () => {
        const frame = createIframe({ src: childPage });

        await send(frame, 'setupListener', {
            messageName: 'hangforever',

            handler: () => new Promise(() => {
                // never settles
            })
        });

        const pending = send(frame, 'hangforever');

        await new Promise(resolve => {
            setTimeout(resolve, 100);
        });

        frame.frameElement?.remove();

        const err = await expectError(pending);

        expect((err as Error).message).toMatch(/Window closed for hangforever before response/u);
    });

    it('fails pending requests when destroyed', async () => {
        const frame = createIframe({ src: childPage });

        await send(frame, 'setupListener', {
            messageName: 'hangagain',

            handler: () => new Promise(() => {
                // never settles
            })
        });

        const pending = send(frame, 'hangagain');

        await new Promise(resolve => {
            setTimeout(resolve, 100);
        });

        destroy();

        const err = await expectError(pending);

        expect((err as Error).message).toMatch(/cancelled/u);
    });

    it('gives up on a window that never says hello', async () => {
        const silent = createIframe({ src: 'about:blank' });
        const err = await expectError(send(silent, 'echo', {}, { timeout: 500 }));

        expect((err as Error).message).toMatch(/did not load/u);
    });
});
