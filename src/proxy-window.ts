import type { WindowType } from 'cross-domain-utils';
import type { CustomType } from 'sandestin';

import {
    assertSameDomain, closeWindow, getFrameForWindow, getWindowType, isSameDomain,
    isWindow, isWindowClosed, submitForm, WINDOW_TYPE
} from 'cross-domain-utils';
import { ZalgoPromise } from 'zalgo-promise';

import { METHOD, SERIALIZATION_TYPE } from './constants';

import type { Transport } from './types';

import { globalStore, windowStore } from './global';
import { getWindowInstanceID } from './hello';
import { uniqueID } from './helpers';

type SetLocationOptions = {
    readonly method ?: typeof METHOD[keyof typeof METHOD],
    readonly body ?: Readonly<Record<string, string | boolean>>,
};

// What a window becomes on the wire: an id, and functions that act on the
// real window where it lives. Each crosses as a sandestin ref.
type SerializedWindow = {
    readonly id : string,
    readonly getType : () => ZalgoPromise<WindowType | undefined>,
    readonly close : () => ZalgoPromise<void>,
    readonly focus : () => ZalgoPromise<void>,
    readonly isClosed : () => ZalgoPromise<boolean>,
    readonly setLocation : (url : string, options ?: SetLocationOptions) => ZalgoPromise<void>,
    readonly getName : () => ZalgoPromise<string | undefined>,
    readonly setName : (name : string) => ZalgoPromise<void>,
    readonly getInstanceID : () => ZalgoPromise<string>,
};

type GetSerializedWindowOptions = {
    readonly winPromise : ZalgoPromise<Window>,
    readonly send : Transport['send'],
    readonly id ?: string,
};

const getSerializedWindow = ({ winPromise, send, id = uniqueID() } : GetSerializedWindowOptions) : SerializedWindow => {
    let windowNamePromise = winPromise.then(win => (isSameDomain(win)
        ? assertSameDomain(win).name
        : undefined));

    // Read now, so the type survives the window closing later.
    const windowTypePromise = winPromise.then(win => {
        if (isWindowClosed(win)) {
            throw new Error('Window is closed, can not determine type');
        }

        return getWindowType(win);
    });

    windowNamePromise.lazy();
    windowTypePromise.lazy();

    const getName = () : ZalgoPromise<string | undefined> => winPromise.then(win => {
        if (isWindowClosed(win)) {
            return undefined;
        }

        return isSameDomain(win)
            ? assertSameDomain(win).name
            : windowNamePromise;
    });

    let instanceIDPromise : ZalgoPromise<string> | undefined;

    const setLocation = (href : string, { method = METHOD.GET, body } : SetLocationOptions = {}) : ZalgoPromise<void> =>
        winPromise.then(win => {
            const origin = `${ location.protocol }//${ location.host }`;

            const url = href.startsWith('/')
                ? `${ origin }${ href }`
                : href;

            if (!(/^https?:\/\//u).test(url)) {
                throw new Error(`Expected url to be http or https url, or absolute path, got ${ JSON.stringify(href) }`);
            }

            if (method === METHOD.POST) {
                return getName().then(name => {
                    if (!name) {
                        throw new Error('Can not post to window without target name');
                    }

                    submitForm({ url, target: name, method, body });
                });
            }

            if (isSameDomain(win)) {
                win.location.replace(url);
            } else {
                win.location = url;
            }

            return undefined;
        });

    return {
        id,
        getType:  () => windowTypePromise,
        close:    () => winPromise.then(closeWindow),
        getName,
        focus:    () => winPromise.then(win => win.focus()),
        isClosed: () => winPromise.then(isWindowClosed),
        setLocation,

        getInstanceID: () => {
            instanceIDPromise ??= winPromise.then(win => getWindowInstanceID(win, { send }));

            return instanceIDPromise;
        },

        setName: name => winPromise.then(win => {
            if (!isSameDomain(win)) {
                throw new Error(`Can not set name for cross-domain window: ${ name }`);
            }

            assertSameDomain(win).name = name;
            getFrameForWindow(win)?.setAttribute('name', name);
            windowNamePromise = ZalgoPromise.resolve(name);
        })
    };
};

type ProxyWindowOptions = {
    readonly send : Transport['send'],
    readonly win ?: Window,
    readonly serializedWindow ?: SerializedWindow,
};

// A window, or a stand-in for one that is not here (yet): the one post-robot
// hands across when a window is serialized. Calls go to the real window
// where it lives, until it turns out to be reachable from here.
export class ProxyWindow {
    readonly isProxyWindow = true as const;

    private serializedWindow : SerializedWindow;

    private actualWindow : Window | undefined;

    private readonly actualWindowPromise = new ZalgoPromise<Window>();

    constructor({ send, win, serializedWindow } : ProxyWindowOptions) {
        this.serializedWindow = serializedWindow ?? getSerializedWindow({ winPromise: this.actualWindowPromise, send });
        globalStore<ProxyWindow>('idToProxyWindow').set(this.getID(), this);

        if (win) {
            this.setWindow(win, { send });
        }
    }

    getID() : string {
        return this.serializedWindow.id;
    }

    getType() : ZalgoPromise<WindowType | undefined> {
        return this.serializedWindow.getType();
    }

    isPopup() : ZalgoPromise<boolean> {
        return this.getType().then(type => type === WINDOW_TYPE.POPUP);
    }

    setLocation(href : string, options ?: SetLocationOptions) : ZalgoPromise<this> {
        return this.serializedWindow.setLocation(href, options).then(() => this);
    }

    getName() : ZalgoPromise<string | undefined> {
        return this.serializedWindow.getName();
    }

    setName(name : string) : ZalgoPromise<this> {
        return this.serializedWindow.setName(name).then(() => this);
    }

    close() : ZalgoPromise<this> {
        return this.serializedWindow.close().then(() => this);
    }

    // A named popup that this side cannot reach can still be brought to the
    // front: opening a window by its name focuses the existing one.
    focus() : ZalgoPromise<this> {
        const details = ZalgoPromise.hash({ isPopup: this.isPopup(), name: this.getName() });

        const reopen = details.then(({ isPopup, name }) => {
            if (isPopup && name && !this.getWindow()) {
                window.open('', name);
            }
        });

        return ZalgoPromise.all([ reopen, this.serializedWindow.focus() ]).then(() => this);
    }

    isClosed() : ZalgoPromise<boolean> {
        return this.serializedWindow.isClosed();
    }

    getWindow() : Window | undefined {
        return this.actualWindow;
    }

    setWindow(win : Window, { send } : Pick<Transport, 'send'>) : void {
        this.actualWindow = win;
        this.actualWindowPromise.resolve(win);
        this.serializedWindow = getSerializedWindow({ winPromise: this.actualWindowPromise, send, id: this.getID() });
        windowStore<ProxyWindow>('winToProxyWindow').set(win, this);
    }

    awaitWindow() : ZalgoPromise<Window> {
        return this.actualWindowPromise;
    }

    // Is this the window the proxy stands for? Known windows compare by
    // identity; unknown ones by the instance id they answer hello with.
    matchWindow(win : Window, { send } : Pick<Transport, 'send'>) : ZalgoPromise<boolean> {
        return ZalgoPromise.try(() => {
            if (this.actualWindow) {
                return win === this.actualWindow;
            }

            return ZalgoPromise.hash({
                proxyInstanceID:       this.getInstanceID(),
                knownWindowInstanceID: getWindowInstanceID(win, { send })
            }).then(({ proxyInstanceID, knownWindowInstanceID }) => {
                const match = proxyInstanceID === knownWindowInstanceID;

                if (match) {
                    this.setWindow(win, { send });
                }

                return match;
            });
        });
    }

    unwrap() : Window | ProxyWindow {
        return this.actualWindow ?? this;
    }

    getInstanceID() : ZalgoPromise<string> {
        return this.serializedWindow.getInstanceID();
    }

    serialize() : SerializedWindow {
        return this.serializedWindow;
    }

    static unwrap(win : Window | ProxyWindow) : Window | ProxyWindow {
        return ProxyWindow.isProxyWindow(win)
            ? win.unwrap()
            : win;
    }

    static serialize(win : Window | ProxyWindow, { send } : Pick<Transport, 'send'>) : SerializedWindow {
        return ProxyWindow.toProxyWindow(win, { send }).serialize();
    }

    static deserialize(serializedWindow : SerializedWindow, { send } : Pick<Transport, 'send'>) : ProxyWindow {
        return globalStore<ProxyWindow>(`idToProxyWindow`).get(serializedWindow.id) ?? new ProxyWindow({ serializedWindow, send });
    }

    static isProxyWindow(value : unknown) : value is ProxyWindow {
        return typeof value === `object` && value !== null && !isWindow(value) && (value as { isProxyWindow ?: unknown }).isProxyWindow === true;
    }

    static toProxyWindow(win : Window | ProxyWindow, { send } : Pick<Transport, 'send'>) : ProxyWindow {
        return ProxyWindow.isProxyWindow(win)
            ? win
            : windowStore<ProxyWindow>(`winToProxyWindow`).get(win) ?? new ProxyWindow({ win, send });
    }
}

// Windows cross by reference: the other side gets the serialized form,
// whose functions act on the window here, and rebuilds a ProxyWindow.

type WindowCustomType = CustomType<Window | ProxyWindow, SerializedWindow>;

export const getWindowCustomType = ({ send } : Pick<Transport, 'send'>) : WindowCustomType => ({
    name:   SERIALIZATION_TYPE.CROSS_DOMAIN_WINDOW,
    test:   value => isWindow(value) || ProxyWindow.isProxyWindow(value),
    encode: ({ value }) => ProxyWindow.serialize(value, { send }),
    decode: ({ value }) => ProxyWindow.deserialize(value, { send })
});
