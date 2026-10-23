import { WINDOW_TYPE } from 'cross-domain-utils';
import { ZalgoPromise } from 'zalgo-promise';

import type { CrossDomainFunctionType, ProxyWindow } from '../src';

import { awaitWindowHello, createProxyWindow, send, serializeMessage } from '../src';

import { childPage, createIframe, createPopup, expectError, getWindows, setupWindows } from './common';

const noop = () : void => undefined;

setupWindows();

type Fn = CrossDomainFunctionType;

type Data<T> = { readonly data : T };

describe('functions', () => {
    it('passes a function across windows and calls it later', async () => {
        const { childFrame } = getWindows();
        let actualArgument : unknown;

        const myfunction = (val : unknown) : string => {
            actualArgument = val;

            return 'hello world';
        };

        await send(childFrame, 'setupListener', { messageName: 'fn1', data: { myfunction } });

        const { data } = await send(childFrame, 'fn1') as Data<{ myfunction : Fn }>;
        const result = await data.myfunction(567);

        expect(actualArgument).toBe(567);
        expect(result).toBe('hello world');
    });

    it('captures a thrown error with its code and stack', async () => {
        const { childFrame } = getWindows();
        let expectedStack : string | undefined;

        const myfunction = () : never => {
            const err = Object.assign(new Error('something went wrong'), { code: 'ERROR_567' });

            expectedStack = err.stack;
            throw err;
        };

        await send(childFrame, 'setupListener', { messageName: 'fn2', data: { myfunction } });

        const { data } = await send(childFrame, 'fn2') as Data<{ myfunction : Fn }>;
        const err = await expectError(data.myfunction()) as Error & { code : string };

        expect(err).toBeInstanceOf(Error);
        expect(err.message).toBe('something went wrong');
        expect(err.code).toBe('ERROR_567');
        expect(err.stack).toContain(expectedStack);
    });

    it('calls a function instantly when it comes back to its origin window', async () => {
        const { childFrame } = getWindows();
        let actualArgument : unknown;

        const myfunction = (val : unknown) : string => {
            actualArgument = val;

            return 'hello world';
        };

        await send(childFrame, 'setupListener', { messageName: 'fn3', data: { myfunction } });

        const { data } = await send(childFrame, 'fn3') as Data<{ myfunction : Fn }>;
        const promise = data.myfunction(567);

        expect(actualArgument).toBe(567);
        expect(await promise).toBe('hello world');
    });

    it('calls a function with the calling window and its origin as this', async () => {
        const { childFrame } = getWindows();

        type Caller = { source : Window, origin : string };

        const myfunction = function (this : Caller) : { sourceIsChild : boolean, origin : string } {
            return { sourceIsChild: this.source === childFrame, origin: this.origin };
        };

        const { data } = await send(childFrame, `callFunction`, { fn: myfunction, args: [] }) as Data<{ sourceIsChild : boolean, origin : string }>;

        expect(data.sourceIsChild).toBe(true);
        expect(data.origin).toBe(location.origin);
    });

    it('calls with fireAndForget without waiting for the result', async () => {
        const { childFrame } = getWindows();
        let called = false;

        const myfunction = () : ZalgoPromise<never> => {
            called = true;

            return new ZalgoPromise<never>();
        };

        await send(childFrame, 'callFunction', { fn: myfunction, args: [], fireAndForget: true });
        expect(called).toBe(true);
    });

    it('passes a function that returns a function, and calls the result', async () => {
        const { childFrame } = getWindows();
        const inner = (val : number) : number => val + 1;
        const outer = () : typeof inner => inner;
        const { data } = await send(childFrame, 'callFunction', { fn: outer, args: [] }) as Data<Fn>;

        expect(typeof data).toBe('function');
        expect(await data(1)).toBe(2);
    });

    it('relays a function from one child to another through the parent', async () => {
        const { childFrame, otherChildFrame } = getWindows();
        const { data: provided } = await send(childFrame, 'provideFunction') as Data<{ myfunction : Fn }>;
        const { data } = await send(otherChildFrame, 'callFunction', { fn: provided.myfunction, args: [ 21 ] });

        expect(data).toBe(42);
    });
});

describe('lifetime', () => {
    it('a released function is gone on the owner side', async () => {
        const { childFrame } = getWindows();
        const fn = () : string => 'alive';
        const { data } = await send(childFrame, 'releaseAndCall', { fn });

        expect(data).toMatch(/released/u);
    });

    it('a function returned home keeps fireAndForget', async () => {
        const { childFrame } = getWindows();
        let called = false;

        const fn = () : void => {
            called = true;
        };

        await send(childFrame, 'setupListener', { messageName: 'home1', data: { fn } });

        const { data } = await send(childFrame, 'home1') as Data<{ fn : Fn }>;

        await data.fn.fireAndForget();
        expect(called).toBe(true);
        expect(data.fn.__name__).toBe('fn');
    });

    it('routes a call for a function serialized for a proxy window once the window is known', async () => {
        const { childFrame } = getWindows();
        const proxy = createProxyWindow();
        const fn = (value : number) : number => value * 2;
        const text = serializeMessage(proxy, '*', { fn });

        // Serializing for the same proxy again reuses its peer.
        serializeMessage(proxy, '*', { again: fn });
        proxy.setWindow(childFrame, { send });

        const { data } = await send(childFrame, 'decodeAndCall', { text });

        expect(data).toBe(42);
    });
});

describe('origin binding', () => {
    it('refuses a call for a function from an origin it was not handed to', async () => {
        const { childFrame } = getWindows();
        const proxy = createProxyWindow();
        const fn = (value : number) : number => value * 2;

        // Addressed to some other origin; the call comes from this one.
        const text = serializeMessage(proxy, 'https://somewhere.example', { fn });

        proxy.setWindow(childFrame, { send });

        const err = await expectError(send(childFrame, 'decodeAndCall', { text }));

        expect((err as Error).message).toMatch(/Not authorized/u);
    });
});

describe('data', () => {
    it('passes dates, undefined, nested arrays and objects', async () => {
        const { childFrame } = getWindows();
        const when = new Date('2026-01-02T03:04:05.000Z');

        await send(childFrame, 'setupListener', {
            messageName: 'data1',
            data:        { when, gap: undefined, list: [ 1, `two`, null, { three: 3 } ], nested: { deep: { deeper: true } } }
        });

        const { data } = await send(childFrame, `data1`) as Data<{ when : Date, gap : undefined, list : unknown, nested : unknown }>;

        expect(data.when).toBeInstanceOf(Date);
        expect(data.when.getTime()).toBe(when.getTime());
        expect(data).toHaveProperty('gap');
        expect(data.gap).toBeUndefined();
        expect(data.list).toEqual([ 1, 'two', null, { three: 3 } ]);
        expect(data.nested).toEqual({ deep: { deeper: true } });
    });
});

describe('promises', () => {
    it.each([ 'native', 'zalgo' ])('passes a %s promise across and resolves it later', async kind => {
        const { childFrame } = getWindows();
        let resolver : ((value : number) => void) | undefined;

        const promise = kind === 'native'
            ? new Promise<number>(resolve => {
                resolver = resolve;
            })
            : new ZalgoPromise<number>(resolve => {
                resolver = resolve;
            });

        await send(childFrame, 'setupListener', { messageName: `promise_${ kind }`, data: { promise } });

        const { data } = await send(childFrame, `promise_${ kind }`) as Data<{ promise : PromiseLike<number> }>;
        const pending = data.promise;

        resolver?.(123);
        expect(await pending).toBe(123);
    });

    it.each([ 'native', 'zalgo' ])('passes a %s promise across and rejects it later', async kind => {
        const { childFrame } = getWindows();
        let rejector : ((err : Error) => void) | undefined;

        const promise = kind === 'native'
            ? new Promise<never>((_resolve, reject) => {
                rejector = reject;
            })
            : new ZalgoPromise<never>((_resolve, reject) => {
                rejector = reject;
            });

        if (promise instanceof ZalgoPromise) {
            promise.lazy();
        } else {
            promise.catch(noop);
        }

        await send(childFrame, 'setupListener', { messageName: `reject_${ kind }`, data: { promise } });

        const { data } = await send(childFrame, `reject_${ kind }`) as Data<{ promise : PromiseLike<never> }>;
        const pending = data.promise;
        const error = Object.assign(new Error('Oh no!'), { code: 'ABC123' });

        rejector?.(error);

        const err = await expectError(pending) as Error & { code : string };

        expect(err).toBeInstanceOf(Error);
        expect(err.message).toBe('Oh no!');
        expect(err.code).toBe('ABC123');
        expect(err.stack).toContain(error.stack);
    });
});

describe('windows', () => {
    const passWindow = async (mywindow : Window, name : string) : Promise<ProxyWindow> => {
        const { childFrame } = getWindows();

        await send(childFrame, 'setupListener', { messageName: name, data: { mywindow } });

        const { data } = await send(childFrame, name) as Data<{ mywindow : ProxyWindow }>;

        return data.mywindow;
    };

    it('passes an iframe across and focuses, closes and reads it', async () => {
        const proxy = await passWindow(createIframe({ src: 'about:blank' }), 'win1');

        await proxy.focus();
        expect(await proxy.getType()).toBe(WINDOW_TYPE.IFRAME);
        expect(await proxy.isClosed()).toBe(false);
        await proxy.close();
        expect(await proxy.isClosed()).toBe(true);
    });

    it('passes an iframe across and changes its location, then talks to it', async () => {
        const mywindow = createIframe({ src: 'about:blank' });
        const proxy = await passWindow(mywindow, 'win2');

        await proxy.setLocation('/test/pages/child.html');
        await awaitWindowHello(mywindow);
        await send(mywindow, 'setupListener', { messageName: 'hello', data: { hello: 'world' } });

        const { data } = await send(mywindow, 'hello');

        expect(data).toEqual({ hello: 'world' });
        expect(typeof await proxy.getInstanceID()).toBe('string');
    });

    it('rejects a relative or non-http location', async () => {
        const proxy = await passWindow(createIframe({ src: 'about:blank' }), 'win3');

        await expectError(proxy.setLocation('ftp://nope'));
    });

    it('passes a popup across and focuses, relocates and closes it', async () => {
        const mywindow = createPopup({ src: 'about:blank' });
        const proxy = await passWindow(mywindow, 'win4');

        await proxy.focus();
        expect(await proxy.getType()).toBe(WINDOW_TYPE.POPUP);
        await proxy.setLocation(childPage);
        await awaitWindowHello(mywindow);
        expect(typeof await proxy.getInstanceID()).toBe('string');
        await proxy.close();
        expect(mywindow.closed).toBe(true);
    });

    it('keeps the window type after the window closes, and fails for one closed first', async () => {
        const popup = createPopup({ src: 'about:blank' });
        const proxy = await passWindow(popup, 'win5');

        popup.close();
        expect(await proxy.getType()).toBe(WINDOW_TYPE.POPUP);

        const frame = createIframe({ src: 'about:blank' });
        const frameProxy = await passWindow(frame, 'win6');

        frame.frameElement?.remove();
        expect(await frameProxy.getType()).toBe(WINDOW_TYPE.IFRAME);

        const closed = createPopup({ src: 'about:blank' });

        closed.close();

        await new Promise(resolve => {
            setTimeout(resolve, 50);
        });

        const closedProxy = await passWindow(closed, 'win7');

        await expectError(closedProxy.getType());
    });

    it('a cross-origin window has no readable name and cannot be renamed or posted to', async () => {
        const popup = createPopup();

        // Serialized only once it has left about:blank for the other origin.
        await awaitWindowHello(popup, 20_000, 'popup');

        const proxy = await passWindow(popup, 'win9');

        expect(await proxy.getName()).toBeUndefined();
        await expectError(proxy.setName('nope'));
        await expectError(proxy.setLocation(childPage, { method: 'post' }));
        await proxy.setLocation(childPage);
    });

    it('a closed window has no name', async () => {
        const popup = createPopup({ src: 'about:blank' });
        const proxy = await passWindow(popup, 'win10');

        popup.close();

        await new Promise(resolve => {
            setTimeout(resolve, 50);
        });

        expect(await proxy.getName()).toBeUndefined();
    });

    it('posts a form into a named same-origin window', async () => {
        const mywindow = createIframe({ src: 'about:blank', name: 'posttarget' });
        const proxy = await passWindow(mywindow, 'win11');
        const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => undefined);

        try {
            await proxy.setLocation('/test/pages/child.html', { method: 'post', body: { a: '1' } });
            expect(submit).toHaveBeenCalledOnce();
        } finally {
            submit.mockRestore();
        }
    });

    it('matches a window it only knew by description, by instance id', async () => {
        const { childFrame } = getWindows();
        const { data } = await send(childFrame, 'provideWindow') as Data<{ win : ProxyWindow }>;
        const proxy = data.win;

        expect(proxy.getWindow()).toBeUndefined();
        expect(await proxy.matchWindow(childFrame, { send })).toBe(true);
        expect(proxy.getWindow()).toBe(childFrame);
        expect(await proxy.matchWindow(childFrame, { send })).toBe(true);
        expect(await proxy.matchWindow(window, { send })).toBe(false);
    });

    it('sets and reads a same-origin window name', async () => {
        const mywindow = createIframe({ src: 'about:blank' });
        const proxy = await passWindow(mywindow, 'win8');

        await proxy.setName('renamed');
        expect(await proxy.getName()).toBe('renamed');
        expect(mywindow.name).toBe('renamed');
    });
});
