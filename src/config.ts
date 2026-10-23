// Milliseconds.

// How long `send` waits for a child window to say hello before giving up.
export const CHILD_WINDOW_TIMEOUT = 5000;

// How long to wait for the receiving side to acknowledge a request: short for
// a window never heard from (it may not be running post-robot at all),
// longer for one that is.
export const ACK_TIMEOUT = 2000;

export const ACK_TIMEOUT_KNOWN = 10_000;

// How long to wait for the response itself; -1 waits forever.
export const RES_TIMEOUT = -1;

export const RESPONSE_CYCLE_TIME = 500;
