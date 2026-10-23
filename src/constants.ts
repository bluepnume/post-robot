export const MESSAGE_TYPE = {
    REQUEST:  'postrobot_message_request',
    RESPONSE: 'postrobot_message_response',
    ACK:      'postrobot_message_ack'
} as const;

export const MESSAGE_ACK = {
    SUCCESS: 'success',
    ERROR:   'error'
} as const;

export type MessageAck = typeof MESSAGE_ACK[keyof typeof MESSAGE_ACK];

// Names post-robot uses for its own requests.
export const MESSAGE_NAME = {
    METHOD:  'postrobot_method',
    HELLO:   'postrobot_hello',
    RELEASE: 'postrobot_release',
    WATCH:   'postrobot_watch'
} as const;

export const WILDCARD = '*';

export const SERIALIZATION_TYPE = {
    CROSS_DOMAIN_ZALGO_PROMISE: 'cross_domain_zalgo_promise',
    CROSS_DOMAIN_FUNCTION:      'cross_domain_function',
    CROSS_DOMAIN_WINDOW:        'cross_domain_window'
} as const;

export const METHOD = {
    GET:  'get',
    POST: 'post'
} as const;

// Two copies of post-robot on one page share a channel when their major
// versions match, and ignore each other otherwise. Checked against
// package.json by a test.
export const MAJOR_VERSION = 12;

export const GLOBAL_KEY = `__post_robot_${ MAJOR_VERSION }__`;
