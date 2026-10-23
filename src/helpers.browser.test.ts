import { assertExists, getOrSet, safeInterval, stringifyError, uniqueID } from './helpers';

describe('helpers', () => {
    it('stringifies errors with their stack and other values plainly', () => {
        const err = new Error('boom');

        expect(stringifyError(err)).toBe(err.stack);

        const bare = new Error('no stack');

        bare.stack = undefined;
        expect(stringifyError(bare)).toBe('Error: no stack');
        expect(stringifyError('text')).toBe('text');
        expect(stringifyError(42)).toBe('42');
    });

    it('assertExists returns the value or throws', () => {
        expect(assertExists(0, 'zero')).toBe(0);
        expect(() => assertExists(undefined, 'thing')).toThrow('Expected thing to exist');
        expect(() => assertExists(null, 'thing')).toThrow('Expected thing to exist');
    });

    it('makes unique ids', () => {
        expect(uniqueID()).not.toBe(uniqueID());
    });

    it('getOrSet creates once', () => {
        const map = new Map<string, number>();
        let created = 0;

        const create = () : number => {
            created += 1;

            return created;
        };

        expect(getOrSet({ map, key: 'a', create })).toBe(1);
        expect(getOrSet({ map, key: 'a', create })).toBe(1);
        expect(getOrSet({ map, key: 'b', create })).toBe(2);
    });

    it('safeInterval ticks until cancelled', async () => {
        let ticks = 0;

        const interval = safeInterval(() => {
            ticks += 1;
        }, 10);

        await new Promise(resolve => {
            setTimeout(resolve, 55);
        });

        interval.cancel();

        const seen = ticks;

        await new Promise(resolve => {
            setTimeout(resolve, 30);
        });

        expect(seen).toBeGreaterThanOrEqual(3);
        expect(ticks).toBe(seen);
    });
});
