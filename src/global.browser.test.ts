import { getWildcard, globalStore, WildCard, windowStore } from './global';

describe('stores', () => {
    it('globalStore keeps named values and can be reset', () => {
        const store = globalStore<number>(`test_${ crypto.randomUUID() }`);

        expect(store.get('a')).toBeUndefined();
        expect(store.set('a', 1)).toBe(1);
        expect(store.has('a')).toBe(true);
        expect(store.getOrSet('a', () => 2)).toBe(1);
        expect(store.getOrSet('b', () => 2)).toBe(2);
        expect(store.keys()).toEqual([ 'a', 'b' ]);
        store.del('a');
        expect(store.keys()).toEqual([ 'b' ]);
        store.reset();
        expect(store.keys()).toEqual([]);
    });

    it('windowStore keeps values per window, and the wildcard is one object', () => {
        const store = windowStore<string>(`test_${ crypto.randomUUID() }`);

        expect(store.get(window)).toBeUndefined();
        store.set(window, 'me');
        expect(store.has(window)).toBe(true);
        expect(store.getOrSet(window, () => 'other')).toBe('me');
        store.del(window);
        expect(store.has(window)).toBe(false);
        expect(getWildcard()).toBe(getWildcard());
        expect(getWildcard()).toBeInstanceOf(WildCard);
    });
});
