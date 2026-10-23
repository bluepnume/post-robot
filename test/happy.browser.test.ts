import { on, send } from '../src';

import { expectError, getWindows, setupWindows } from './common';

setupWindows();

describe('happy cases', () => {
    it('sets up a server and listens for a request', async () => {
        const { childFrame } = getWindows();
        let received = false;

        const listener = on('foobu', () => {
            received = true;
        });

        await send(childFrame, 'sendMessageToParent', { messageName: 'foobu' });
        listener.cancel();
        expect(received).toBe(true);
    });

    it('listens for multiple requests', async () => {
        const { childFrame } = getWindows();
        let count = 0;

        const listener = on('multilistener', () => {
            count += 1;
        });

        await send(childFrame, 'sendMessageToParent', { messageName: 'multilistener' });
        await send(childFrame, 'sendMessageToParent', { messageName: 'multilistener' });
        listener.cancel();
        expect(count).toBe(2);
    });

    it('messages a child and gets a response', async () => {
        const { childFrame } = getWindows();

        await send(childFrame, 'setupListener', { messageName: 'foo', data: { foo: 'bar' } });

        const { data } = await send(childFrame, 'foo');

        expect(data).toEqual({ foo: 'bar' });
    });

    it('listens for a request from a specific domain', async () => {
        const { childFrame } = getWindows();
        let received = false;

        const listener = on('foobuzz', { domain: location.origin }, () => {
            received = true;
        });

        await send(childFrame, 'sendMessageToParent', { messageName: 'foobuzz' });
        listener.cancel();
        expect(received).toBe(true);
    });

    it('messages a child with a specific domain and gets a response', async () => {
        const { childFrame } = getWindows();

        await send(childFrame, 'setupListener', { messageName: 'domainfoo', data: { foo: 'bar' } });

        const { data } = await send(childFrame, 'domainfoo', {}, { domain: location.origin });

        expect(data).toEqual({ foo: 'bar' });
    });

    it('listens for a request from multiple domains, by list and by regex', async () => {
        const { childFrame } = getWindows();
        let received = 0;

        const byList = on('multidomain', { domain: [ 'https://nowhere.example', location.origin ] }, () => {
            received += 1;
        });

        await send(childFrame, 'sendMessageToParent', { messageName: 'multidomain' });
        byList.cancel();

        const byRegex = on('regexdomain', { domain: /^http:\/\/(localhost|127\.0\.0\.1)/u }, () => {
            received += 1;
        });

        await send(childFrame, 'sendMessageToParent', { messageName: 'regexdomain' });
        byRegex.cancel();
        expect(received).toBe(2);
    });

    it('messages a child with multiple domains and gets a response', async () => {
        const { childFrame } = getWindows();

        await send(childFrame, 'setupListener', { messageName: 'listfoo', data: { foo: 'bar' } });

        const { data } = await send(childFrame, `listfoo`, {}, { domain: [ `https://nowhere.example`, location.origin ] });

        expect(data).toEqual({ foo: 'bar' });
    });

    it('a child can send to its parent with a pattern domain, learning the origin by hello', async () => {
        const { childFrame } = getWindows();
        let received = false;

        const listener = on('patterned', () => {
            received = true;
        });

        await send(childFrame, 'sendMessageToParent', { messageName: 'patterned', domain: /^http:\/\//u });
        listener.cancel();
        expect(received).toBe(true);
    });

    it('resolves with the responding window and its origin', async () => {
        const { childFrame, childWindow } = getWindows();
        const fromFrame = await send(childFrame, 'echo', { x: 1 });
        const fromPopup = await send(childWindow, 'echo', { x: 2 });

        expect(fromFrame.source).toBe(childFrame);
        expect(fromFrame.origin).toBe(location.origin);
        expect(fromFrame.data).toEqual({ x: 1 });
        expect(fromPopup.source).toBe(childWindow);
        expect(fromPopup.origin).not.toBe(location.origin);
        expect(fromPopup.data).toEqual({ x: 2 });
    });

    it('rejects with the handler error from the other side', async () => {
        const { childFrame } = getWindows();
        const err = await expectError(send(childFrame, 'throwError'));

        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toBe('child says no');
    });

    it('fire and forget resolves once the message is posted', async () => {
        const { childFrame } = getWindows();
        const result = await send(childFrame, 'echo', { x: 1 }, { fireAndForget: true });

        expect(result.data).toBeUndefined();
    });
});
