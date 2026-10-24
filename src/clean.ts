import type { ZalgoPromise } from 'zalgo-promise';

import { isWindowClosed } from 'cross-domain-utils';

import { windowStore } from './global';
import { noop } from './helpers';

// Fail every request still waiting on a window that is going away. Each
// rejection takes its promise out of the list, so walk a copy.
export const cleanUpWindow = (win : Window) : void => {
    const pending = [ ...windowStore<Array<ZalgoPromise>>('requestPromises').get(win) ?? [] ];

    for (const promise of pending) {
        promise.reject(new Error(`Window ${
            isWindowClosed(win)
                ? 'closed'
                : 'cleaned up'
            } before response`)).catch(noop);
    }
};
