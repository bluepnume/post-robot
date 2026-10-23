import { windowStore } from './global';

// A window is "known" once a message from it has been received, which is
// when post-robot can expect it to acknowledge promptly.
export const markWindowKnown = (win : Window) : void => {
    windowStore<boolean>('knownWindows').set(win, true);
};

export const isWindowKnown = (win : Window) : boolean => windowStore<boolean>('knownWindows').get(win) ?? false;
