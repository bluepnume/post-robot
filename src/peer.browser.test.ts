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

describe('peer lookup', () => {
    it('finds the handle in a proxy peer whose window was only set in another window', async () => {
        const [ method ] = captureListeners();

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
});
