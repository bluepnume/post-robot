import type { MESSAGE_TYPE, MessageAck } from './constants';

export type RequestMessage = {
    readonly id : string,
    readonly origin : string,
    readonly type : typeof MESSAGE_TYPE.REQUEST,
    readonly name : string,
    readonly hash : string,
    readonly data : unknown,
    readonly fireAndForget ?: boolean,
};

export type AckMessage = {
    readonly id : string,
    readonly origin : string,
    readonly type : typeof MESSAGE_TYPE.ACK,
    readonly name : string,
    readonly hash : string,
};

export type ResponseMessage = {
    readonly id : string,
    readonly origin : string,
    readonly type : typeof MESSAGE_TYPE.RESPONSE,
    readonly ack : MessageAck,
    readonly name : string,
    readonly hash : string,
    readonly data ?: unknown,
    readonly error ?: unknown,
};

export type Message = RequestMessage | AckMessage | ResponseMessage;
