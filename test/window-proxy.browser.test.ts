import { WINDOW_TYPE } from 'cross-domain-utils';
import { ZalgoPromise } from 'zalgo-promise';

import type { ProxyWindow } from '../src';

import { createProxyWindow, deserializeMessage, on, send, serializeMessage, toProxyWindow } from '../src';

import { getWindows, setupWindows } from './common';

setupWindows();

type Data<T> = { readonly data : T };

describe('window proxy cases', () => {
    it('sends a window in a message and gets the real one back', async () => {
        const { childFrame, otherChildFrame } = getWindows();
        const received = new ZalgoPromise<ProxyWindow>();

        const listener = on('passProxyWindow', ({ data }) => {
            received.resolve((data as { otherFrame : ProxyWindow }).otherFrame);
        });

        await send(childFrame, `sendMessageToParent`, { messageName: `passProxyWindow`, data: { otherFrame: otherChildFrame } });
        listener.cancel();

        const proxy = await received;

        expect(proxy.getWindow()).toBe(otherChildFrame);
        expect(await proxy.isPopup()).toBe(false);
        expect(await proxy.getType()).toBe(WINDOW_TYPE.IFRAME);
    });

    it('sends to, and receives from, a proxy window', async () => {
        const { childFrame, otherChildFrame } = getWindows();
        const received = new ZalgoPromise<ProxyWindow>();

        const pass = on('passProxyWindow2', ({ data }) => {
            received.resolve((data as { otherFrame : ProxyWindow }).otherFrame);
        });

        await send(childFrame, `sendMessageToParent`, { messageName: `passProxyWindow2`, data: { otherFrame: otherChildFrame } });
        pass.cancel();

        const proxy = await received;
        let calls = 0;

        const call = on('callProxyWindow', { window: proxy }, () => {
            calls += 1;
        });

        await send(proxy, 'sendMessageToParent', { messageName: 'callProxyWindow' });
        call.cancel();
        expect(calls).toBe(1);
    });

    it('reopens a named popup on focus when the underlying window is not available', async () => {
        const popupName = `popup_${ crypto.randomUUID() }`;

        const serializedWindow = {
            id:            crypto.randomUUID(),
            getType:       () => ZalgoPromise.resolve(WINDOW_TYPE.POPUP),
            close:         () => ZalgoPromise.resolve(),
            focus:         () => ZalgoPromise.resolve(),
            isClosed:      () => ZalgoPromise.resolve(false),
            setLocation:   () => ZalgoPromise.resolve(),
            getName:       () => ZalgoPromise.resolve(popupName),
            setName:       () => ZalgoPromise.resolve(),
            getInstanceID: () => ZalgoPromise.resolve(crypto.randomUUID())
        };

        const { ProxyWindow } = await import('../src');
        const proxy = new ProxyWindow({ serializedWindow, send });
        const opened : Array<[ string, string ]> = [];

        const open = vi.spyOn(window, 'open').mockImplementation((url, name) => {
            opened.push([ String(url), String(name) ]);

            return null;
        });

        try {
            await proxy.focus();
        } finally {
            open.mockRestore();
        }

        expect(opened).toEqual([ [ '', popupName ] ]);
    });

    it('serializes a message for a window and decodes it on the other side', async () => {
        const { childFrame } = getWindows();
        const text = serializeMessage(childFrame, location.origin, { fn: () => 'from parent', when: new Date(0) });

        expect(typeof text).toBe('string');

        const { data } = await send(childFrame, 'echo', { text }) as Data<{ text : string }>;
        const decoded = deserializeMessage<{ fn : () => string, when : Date }>(childFrame, location.origin, data.text);

        expect(decoded.when.getTime()).toBe(0);
        expect(typeof decoded.fn).toBe('function');
    });

    it('creates and converts proxy windows', () => {
        const { childFrame } = getWindows();
        const proxy = toProxyWindow(childFrame);

        expect(proxy.getWindow()).toBe(childFrame);
        expect(toProxyWindow(proxy)).toBe(proxy);
        expect(toProxyWindow(childFrame)).toBe(proxy);

        const fresh = createProxyWindow();

        expect(fresh.getWindow()).toBeUndefined();
        expect(createProxyWindow(childFrame).getWindow()).toBe(childFrame);
    });
});
