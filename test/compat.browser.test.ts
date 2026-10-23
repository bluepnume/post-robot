import type { CrossDomainFunctionType } from '../src';

import { awaitWindowHello, GLOBAL_KEY, on, send, setup } from '../src';

import { createIframe } from './common';

// Cross-version check: the previously published version of this major,
// installed under the `post-robot-previous` alias, must still talk to this
// code in both directions. The alias resolves to the newest 12.x at install
// time, so this tracks every release without edits.
const PREVIOUS_BUNDLE = '/node_modules/post-robot-previous/dist/post-robot.min.js';
const PREVIOUS_PAGE = `${ location.origin }/test/pages/previous.html`;

describe('compatibility with the previous published version', () => {
    it('exchanges requests, functions and the global key with the previous release', async ({ skip }) => {
        const bundle = await fetch(PREVIOUS_BUNDLE, { method: 'HEAD' });

        if (!bundle.ok) {
            skip();
        }

        setup();

        const previous = createIframe({ src: PREVIOUS_PAGE });

        await awaitWindowHello(previous, 20_000, 'previous release');

        // New -> old.
        const echoed = await send(previous, `echo`, { from: `current`, when: new Date(0) }) as { data : { from : string, when : Date } };

        expect(echoed.data.from).toBe('current');
        expect(echoed.data.when.getTime()).toBe(0);

        // Old -> new.
        let heard : unknown;

        const listener = on('fromPrevious', ({ data }) => {
            heard = data;

            return { ack: true };
        });

        const relayed = await send(previous, `sendMessageToParent`, { messageName: `fromPrevious`, data: { hi: `from previous` } });

        listener.cancel();
        expect(heard).toEqual({ hi: 'from previous' });
        expect(relayed.data).toEqual({ ack: true });

        // A function of ours, called from the old side, and one of theirs
        // coming back through echo as a callable ref.
        let calledWith : unknown;

        const { data: result } = await send(previous, 'callFunction', {
            fn: (value : number) => {
                calledWith = value;

                return value + 1;
            },

            args: [ 41 ]
        });

        expect(calledWith).toBe(41);
        expect(result).toBe(42);

        const { data: back } = await send(previous, `echo`, { fn: () => `home again` }) as { data : { fn : CrossDomainFunctionType } };

        expect(await back.fn()).toBe('home again');

        // Same major, same global key, so both copies share one channel.
        const { data: version } = await send(previous, 'whichVersion') as { data : { global : ReadonlyArray<string> } };

        expect(version.global).toEqual([ GLOBAL_KEY ]);
    });
});
