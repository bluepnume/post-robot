
import { CONSTANTS } from '../../conf';
import { util, promise } from '../../lib';
import { emulateIERestrictions, getBridge, getBridgeFor } from '../../compat';

export let SEND_MESSAGE_STRATEGIES = {

    [ CONSTANTS.SEND_STRATEGIES.POST_MESSAGE ]: promise.method((win, message, domain) => {

        emulateIERestrictions(window, win);

        return win.postMessage(JSON.stringify(message, 0, 2), domain);
    }),

    [ CONSTANTS.SEND_STRATEGIES.POST_MESSAGE_GLOBAL_METHOD ]: promise.method((win, message, domain) => {

        if (domain !== '*') {

            let winDomain;

            try {
                winDomain = `${win.location.protocol}//${win.location.host}`;
            } catch (err) {
                // pass
            }

            if (!winDomain) {
                throw new Error(`Can post post through global method - domain set to ${domain}, but we can not verify the domain of the target window`);
            }

            if (winDomain !== domain) {
                throw new Error(`Can post post through global method - domain ${domain} does not match target window domain ${winDomain}`);
            }
        }

        if (!util.safeHasProp(win, CONSTANTS.WINDOW_PROPS.POSTROBOT)) {
            throw new Error('postRobot not found on window');
        }

        return win[CONSTANTS.WINDOW_PROPS.POSTROBOT].postMessage({
            origin: `${window.location.protocol}//${window.location.host}`,
            source: window,
            data: JSON.stringify(message)
        });
    }),

    [ CONSTANTS.SEND_STRATEGIES.POST_MESSAGE_UP_THROUGH_BRIDGE ]: promise.method((win, message, domain) => {

        let frame = getBridgeFor(win);

        if (!frame) {
            throw new Error('No bridge available in window');
        }

        if (!util.safeHasProp(frame, CONSTANTS.WINDOW_PROPS.POSTROBOT)) {
            throw new Error('postRobot not installed in bridge');
        }

        return frame[CONSTANTS.WINDOW_PROPS.POSTROBOT].postMessageParent(window, JSON.stringify(message, 0, 2), domain);
    }),

    [ CONSTANTS.SEND_STRATEGIES.POST_MESSAGE_DOWN_THROUGH_BRIDGE ]: promise.method((win, message, domain) => {

        let bridge = getBridge();

        if (!bridge) {
            throw new Error('Bridge not initialized');
        }

        if (win === bridge.contentWindow) {
            throw new Error('Message target is bridge');
        }

        if (!message.target) {

            if (win === window.opener) {
                message.target = 'parent.opener';
            } else {
                throw new Error('Can not post message down through bridge without target');
            }
        }

        return bridge.then(iframe => {
            iframe.contentWindow.postMessage(JSON.stringify(message, 0, 2), domain);
        });
    })
};