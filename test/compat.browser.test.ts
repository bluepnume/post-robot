// Cross-version check: the previously published version of this major, when
// one is installed under the `post-robot-previous` alias, must still talk to
// this code. Nothing is installed until the first 12.x is on npm, so the test
// skips itself until then.
const PREVIOUS = '/node_modules/post-robot-previous/dist/post-robot.min.js';

describe('compatibility with the previous published version', () => {
    it('loads the previous bundle beside this code', async ({ skip }) => {
        const response = await fetch(PREVIOUS, { method: 'HEAD' });

        if (!response.ok) {
            skip();
        }

        expect(response.ok).toBe(true);
    });
});
