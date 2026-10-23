import { deserializeMessage, serializeMessage } from './setup';

// This file runs in a page of its own, so these are the first post-robot
// calls on it.
describe('serializing before anything else', () => {
    it('serializes and decodes as the very first call on a page, cycles included', () => {
        // Not `self`: an object whose `self` is itself passes for a window.
        const obj : Record<string, unknown> = { name: 'loop' };

        obj.loop = obj;

        const frame = document.createElement('iframe');

        document.body.appendChild(frame);

        const win = frame.contentWindow;

        if (!win) {
            throw new Error('Expected a frame window');
        }

        const text = serializeMessage(win, '*', { props: { objectProp: obj } });
        type Decoded = { props : { objectProp : Record<string, unknown> } };

        const out = deserializeMessage<Decoded>(win, location.origin, text);

        expect(out.props.objectProp.name).toBe('loop');
        expect(out.props.objectProp.loop).toBe(out.props.objectProp);

        frame.remove();
    });
});
