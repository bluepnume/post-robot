// A frame that loaded and said hello before this page ever used post-robot:
// its one hello went to nobody. Sending to it must still work. This file
// touches post-robot only after the frame has loaded, so the test page has
// no listener when the frame's hello arrives.
import { send } from '../src';

const loadFrame = async (src : string) : Promise<Window> => {
    const frame = document.createElement('iframe');

    frame.src = src;
    document.body.append(frame);

    await new Promise(resolve => {
        frame.addEventListener('load', resolve, { once: true });
    });

    // Long enough for the frame's own hello to have come and gone.
    await new Promise(resolve => {
        setTimeout(resolve, 300);
    });

    if (!frame.contentWindow) {
        throw new Error('Frame has no window');
    }

    return frame.contentWindow;
};

describe('a frame whose hello was missed', () => {
    it('is asked for a hello, and answers requests', async () => {
        const otherOrigin = `http://[::1]:${ location.port }`;
        const win = await loadFrame(`${ otherOrigin }/test/pages/child.html`);

        const { data } = await send(win, 'echo', { hello: 'again' }, { timeout: 3000 }).toPromise();

        expect(data).toEqual({ hello: 'again' });
    });
});
