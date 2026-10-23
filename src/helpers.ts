// The handful of utilities post-robot needs, kept local.

type Cancelable = {
    readonly cancel : () => void,
};

export const noop = () : void => undefined;

// A value the types allow to be missing but the protocol guarantees.
export const assertExists = <T>(value : T | undefined | null, what : string) : T => {
    if (value === undefined || value === null) {
        throw new Error(`Expected ${ what } to exist`);
    }

    return value;
};

export const uniqueID = () : string => crypto.randomUUID();

export const stringifyError = (err : unknown) : string => {
    return err instanceof Error
        ? err.stack ?? `${ err.name }: ${ err.message }`
        : String(err);
};

type MapLike<Key, Value> = {
    readonly get : (key : Key) => Value | undefined,
    readonly set : (key : Key, value : Value) => unknown,
};

type GetOrSetOptions<Key, Value> = {
    readonly map : MapLike<Key, Value>,
    readonly key : Key,
    readonly create : () => Value,
};

export const getOrSet = <Key, Value>({ map, key, create } : GetOrSetOptions<Key, Value>) : Value => {
    const existing = map.get(key);

    if (existing !== undefined) {
        return existing;
    }

    const value = create();

    map.set(key, value);

    return value;
};

// A repeating timer whose callback never overlaps itself.
export const safeInterval = (callback : () => void, time : number) : Cancelable => {
    let timer : ReturnType<typeof setTimeout> | undefined;

    const tick = () : void => {
        callback();
        timer = setTimeout(tick, time);
    };

    timer = setTimeout(tick, time);

    return {
        cancel: () => clearTimeout(timer)
    };
};

export const addEventListener = (
    target : EventTarget,
    event : string,
    handler : (event : Event) => void
) : Cancelable => {
    target.addEventListener(event, handler);

    return {
        cancel: () => target.removeEventListener(event, handler)
    };
};
