import type { Handler, OnType, Transport } from './types';

import { send } from './api';
import { getWindowInstanceID } from './hello';
import { getPeer, listenForPeerRequests } from './peer';
import { ProxyWindow } from './proxy-window';

type Captured = { readonly name : string, readonly handler : Handler };

// The three request listeners, captured instead of registered.
const captureListeners = () : ReadonlyArray<Captured> => {
    const captured : Array<Captured> = [];

    const on : OnType = (name, options, handler) => {
        const actual = handler ?? (typeof options === 'function'
            ? options
            : options.handler);

        if (actual) {
            captured.push({ name, handler: actual });
        }

        return { cancel: () => undefined };
    };

    const transport : Transport = { on, send };

    listenForPeerRequests(transport);

    return captured;
};

// Registered once per page, so every test shares the one capture.
const [ method, release ] = captureListeners();

describe('peer lookup', () => {
    it('finds the handle in a proxy peer whose window was only set in another window', async () => {
        if (!method) {
            throw new Error('Expected the method listener');
        }

        // A proxy whose real window (this one) is known elsewhere: it can only
        // tell who it is by instance id, which it fetches from that window.
        const serializedWindow = {
            id:            'proxy-resolved-elsewhere',
            getInstanceID: () => getWindowInstanceID(window, { send })
        } as unknown as ConstructorParameters<typeof ProxyWindow>[0]['serializedWindow'];

        const proxy = new ProxyWindow({ send, serializedWindow });
        const peer = getPeer(proxy, { send });

        const wire = peer.serdes.encode({
            value:   (value : number) => value * 2,
            context: { source: proxy, origin: location.origin }
        });

        const [ , handle ] = (/"handle":"([^"]+)"/u).exec(JSON.stringify(wire)) ?? [];

        // The call arrives from the real window, which this side has not yet
        // tied to the proxy.
        const outcome = await method.handler({
            source: window,
            origin: location.origin,
            data:   { handle, args: [ 21 ] }
        }) as { readonly ok : boolean, readonly value ?: unknown };

        expect(outcome).toEqual({ ok: true, value: 42 });
        expect(proxy.getWindow()).toBe(window);
    });

    type ListenersAndHandle = {
        readonly call : () => Promise<unknown>,
        readonly releaseSends : (count ?: number) => unknown,
    };

    // One function sent to this window twice, as two messages would.
    const sendTwice = () : ListenersAndHandle => {
        if (!method || !release) {
            throw new Error('Expected the method and release listeners');
        }

        const peer = getPeer(window, { send });
        const fn = (value : number) : number => value * 2;
        const context = { source: window, origin: location.origin };

        peer.serdes.encode({ value: fn, context });

        const wire = peer.serdes.encode({ value: fn, context });
        const [ , handle = '' ] = (/"handle":"([^"]+)"/u).exec(JSON.stringify(wire)) ?? [];

        return {
            call: () => Promise.resolve(method.handler({
                source: window,
                origin: location.origin,
                data:   { handle, args: [ 21 ] }
            })),

            releaseSends: count => release.handler({
                source: window,
                origin: location.origin,
                data:   { handle, count }
            })
        };
    };

    it('keeps a function sent twice until the other side lets go of both sends', async () => {
        const { call, releaseSends } = sendTwice();

        await releaseSends(1);
        expect(await call()).toEqual({ ok: true, value: 42 });

        await releaseSends(1);
        expect(await call()).toMatchObject({ ok: false });
    });

    it('releases outright when an older peer sends no count', async () => {
        const { call, releaseSends } = sendTwice();

        await releaseSends();
        expect(await call()).toMatchObject({ ok: false });
    });
});
