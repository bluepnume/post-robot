import { ZalgoPromise } from 'zalgo-promise';

import { awaitWindowHello, setup } from '../src';

// The test page is served on `localhost`; the same server answers at the
// IPv6 loopback literal, which the browser treats as a second origin.
export const otherOrigin = location.hostname === 'localhost'
    ? `http://[::1]:${ location.port }`
    : `http://localhost:${ location.port }`;

export const childPage = `${ location.origin }/test/pages/child.html`;

export const foreignChildPage = `${ otherOrigin }/test/pages/child.html`;

const created : Array<HTMLIFrameElement> = [];
const opened : Array<Window> = [];

export type CreateIframeOptions = {
    readonly src ?: string,
    readonly name ?: string,
};

export const createIframe = ({ src = childPage, name } : CreateIframeOptions = {}) : Window => {
    const frame = document.createElement('iframe');

    frame.name = name ?? `frame_${ crypto.randomUUID() }`;
    frame.src = src;
    document.body.append(frame);
    created.push(frame);

    if (!frame.contentWindow) {
        throw new Error('Frame has no window');
    }

    return frame.contentWindow;
};

type CreatePopupOptions = { readonly src ?: string };

export const createPopup = ({ src = foreignChildPage } : CreatePopupOptions = {}) : Window => {
    const popup = window.open(src, `popup_${ crypto.randomUUID() }`, 'width=400,height=400');

    if (!popup) {
        throw new Error('Popup was blocked');
    }

    opened.push(popup);
    window.focus();

    return popup;
};

export type Windows = {
    readonly childWindow : Window,
    readonly childFrame : Window,
    readonly otherChildFrame : Window,
};

let windows : Windows | undefined;

export const getWindows = () : Windows => {
    if (!windows) {
        throw new Error('Not all windows available');
    }

    return windows;
};

// One popup (cross-origin) and two iframes (same-origin) for the suite.
export const setupWindows = () : void => {
    beforeAll(async () => {
        setup();

        const childWindow = createPopup();
        const childFrame = createIframe();
        const otherChildFrame = createIframe();

        await ZalgoPromise.all([
            awaitWindowHello(childWindow, 20_000, 'popup'),
            awaitWindowHello(childFrame, 20_000, 'frame'),
            awaitWindowHello(otherChildFrame, 20_000, 'other frame')
        ]).toPromise();

        windows = { childWindow, childFrame, otherChildFrame };
    });

    afterAll(() => {
        for (const frame of created.splice(0)) {
            frame.remove();
        }

        for (const popup of opened.splice(0)) {
            popup.close();
        }

        windows = undefined;
    });
};

// Keeps a thrown-in-handler error from failing the page, the way the old
// suite did; vitest reports uncaught errors otherwise.
export const expectError = async (promise : PromiseLike<unknown>) : Promise<unknown> => {
    try {
        await promise;
    } catch (err) {
        return err;
    }

    throw new Error('Expected a rejection');
};
