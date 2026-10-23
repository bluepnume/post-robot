// The other side of every test: a window that answers the requests the
// suite sends it. Loaded by test/pages/child.html in an iframe or a popup.
import type { Ref } from 'sandestin';

import { release } from 'sandestin';

import { deserializeMessage, on, send } from '../src';

on('sendMessageToParent', ({ data }) => {
    const { messageName, data: payload, domain } = data as {
        messageName : string,
        data ?: unknown,
        domain ?: RegExp,
    };

    const target = (window.opener as Window | null) ?? window.parent;

    return send(target, messageName, payload, { domain }).then(event => event.data);
});

// This window itself, as the other side would describe it.
on('provideWindow', () => ({ win: window }));

on('setupListener', ({ data }) => {
    const { messageName, data: payload, handler } = data as {
        messageName : string,
        data ?: unknown,
        handler ?: () => unknown,
    };

    on(messageName, { once: true }, () => handler?.() ?? payload);
});

on('provideFunction', () => ({
    myfunction: (value : number) => value * 2
}));

on('callFunction', ({ data }) => {
    const { fn, args, fireAndForget } = data as {
        fn : ((...args : ReadonlyArray<unknown>) => unknown) & {
            fireAndForget : (...args : ReadonlyArray<unknown>) => unknown,
        },
        args : ReadonlyArray<unknown>,
        fireAndForget ?: boolean,
    };

    return fireAndForget
        ? fn.fireAndForget(...args)
        : fn(...args);
});

// A function serialized for a proxy window, carried here as text (the way
// zoid passes props in a url) and called from this window.
on('decodeAndCall', ({ source, origin, data }) => {
    const { text } = data as { text : string };
    const { fn } = deserializeMessage<{ fn : (value : number) => Promise<number> }>(source, origin, text);

    return fn(21);
});

// Let go of a function the other side handed us, then try it again.
on('releaseAndCall', ({ data }) => {
    const { fn } = data as { fn : ((...args : ReadonlyArray<unknown>) => PromiseLike<unknown>) & { __ref__ : Ref } };

    release({ ref: fn.__ref__ });

    return fn().then(() => 'still callable', (err : unknown) => (err as Error).message);
});

on('echo', ({ data }) => data);

on('whoAmI', () => ({ href: location.href }));

on('throwError', () => {
    throw new Error('child says no');
});

// Keep a function the other side handed us where a same-origin window can
// read it directly, as zoid's getSiblings does with another frame's xprops.
on('storeFunction', ({ data }) => {
    (window as Window & { storedFunction ?: unknown }).storedFunction = (data as { fn : unknown }).fn;
});
