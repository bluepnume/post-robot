import type { ZalgoPromise } from 'zalgo-promise';

import { isWindowClosed } from 'cross-domain-utils';

import { windowStore } from './global';
import { noop } from './helpers';

// Fail every request still waiting on a window that is going away.
export const cleanUpWindow = (win : Window) : void => {
    for (const promise of windowStore<Array<ZalgoPromise>>('requestPromises').get(win) ?? []) {
        promise.reject(new Error(`Window ${
            isWindowClosed(win)
                ? 'closed'
                : 'cleaned up'
            } before response`)).catch(noop);
    }
};
