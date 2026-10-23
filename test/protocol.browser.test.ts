import { cleanUpWindow, destroy, GLOBAL_KEY, MAJOR_VERSION, markWindowKnown, send, setup } from '../src';

import { childPage, createIframe, expectError, getWindows, setupWindows } from './common';

setupWindows();

describe('the global key', () => {
    it('is keyed by the major version in package.json', async () => {
        const pkg = await fetch('/package.json').then(response => response.json() as Promise<{ version : string }>);

        expect(Number(pkg.version.split('.')[0])).toBe(MAJOR_VERSION);
        expect(GLOBAL_KEY).toBe(`__post_robot_${ MAJOR_VERSION }__`);
    });

    it('is where the state lives, and ignores envelopes under another key', async () => {
        const { childFrame } = getWindows();

        expect(typeof (window as unknown as Record<string, unknown>)[GLOBAL_KEY]).toBe('object');

        // A message from another major: parsed as JSON, not as ours, dropped.
        window.postMessage(JSON.stringify({ __post_robot_11__: [ { id: `x`, type: `postrobot_message_request` } ] }), `*`);
        window.postMessage('not json at all', '*');
        window.postMessage({ an: 'object' }, '*');

        const { data } = await send(childFrame, 'echo', { still: 'working' });

        expect(data).toEqual({ still: 'working' });
    });

    it('two copies of the same major on one page share one channel', async () => {
        // The child page runs its own module instance of post-robot; a frame
        // loaded twice under the same origin proves two copies agree on the key.
        const other = createIframe({ src: childPage });
        const { data } = await send(other, 'whoAmI', {}, { timeout: 5000 }) as { data : { href : string } };

        expect(data.href).toBe(childPage);
    });
});

describe('lifecycle', () => {
    it('setup is idempotent and markWindowKnown shortens nothing visible but is accepted', () => {
        const { childFrame } = getWindows();

        setup();
        setup();
        markWindowKnown(childFrame);
        expect((window as unknown as Record<string, { initialized ?: boolean }>)[GLOBAL_KEY]?.initialized).toBe(true);
    });

    it('cleanUpWindow fails requests still waiting on a window', async () => {
        const { childFrame } = getWindows();

        await send(childFrame, 'setupListener', {
            messageName: 'hang',

            handler: () => new Promise(() => {
                // never settles
            })
        });

        const pending = send(childFrame, 'hang');

        await new Promise(resolve => {
            setTimeout(resolve, 50);
        });

        cleanUpWindow(childFrame);

        const err = await expectError(pending);

        expect((err as Error).message).toMatch(/cleaned up before response/u);
    });

    it('cleanUpWindow is a no-op for a window with nothing pending', () => {
        cleanUpWindow(createIframe({ src: 'about:blank' }));
    });

    it('cleanUpWindow says closed for a window that is', async () => {
        const frame = createIframe({ src: childPage });

        await send(frame, 'setupListener', {
            messageName: 'hang2',

            handler: () => new Promise(() => {
                // never settles
            })
        });

        const pending = send(frame, 'hang2');

        await new Promise(resolve => {
            setTimeout(resolve, 50);
        });

        frame.frameElement?.remove();
        cleanUpWindow(frame);

        const err = await expectError(pending);

        expect((err as Error).message).toMatch(/closed before response/u);
    });

    it('destroy drops the state; setup starts over, and a new window is reachable again', async () => {
        destroy();
        expect((window as unknown as Record<string, unknown>)[GLOBAL_KEY]).toBeUndefined();

        // The first send runs setup again. The hello table went with the
        // state, so a window that said hello before is not known any more;
        // a new one introduces itself as usual.
        const fresh = createIframe({ src: childPage });
        const { data } = await send(fresh, 'echo', { back: true });

        expect(data).toEqual({ back: true });
    });
});
