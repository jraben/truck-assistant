import { describe, expect, it } from 'vitest';
import { clearOrder, loadOrder, mergeOrder, moveItem, RAIL_ORDER_KEY, saveOrder } from '../src/lib/railOrder.ts';

const mem = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

describe('rail order: storage', () => {
  it('saves and loads the order', () => {
    const s = mem();
    expect(loadOrder(s)).toBeNull();
    saveOrder(s, ['home', 'drive', '@settings']);
    expect(s.m.get(RAIL_ORDER_KEY)).toBe('["home","drive","@settings"]');
    expect(loadOrder(s)).toEqual(['home', 'drive', '@settings']);
    clearOrder(s);
    expect(loadOrder(s)).toBeNull();
  });
  it('shrugs off junk and broken storage', () => {
    const s = mem();
    s.m.set(RAIL_ORDER_KEY, '{not json');
    expect(loadOrder(s)).toBeNull();
    s.m.set(RAIL_ORDER_KEY, '{"a":1}');
    expect(loadOrder(s)).toBeNull();
    s.m.set(RAIL_ORDER_KEY, '["drive", 3, null, "home"]');
    expect(loadOrder(s)).toEqual(['drive', 'home']);
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
    expect(loadOrder(broken)).toBeNull();
    expect(() => saveOrder(broken, ['drive'])).not.toThrow();
    expect(() => clearOrder(broken)).not.toThrow();
    expect(loadOrder(null)).toBeNull();
  });
});

describe('rail order: merge', () => {
  const avail = ['drive', 'carplay', 'media', 'home', '@settings'];
  it('no saved order: the default', () => {
    expect(mergeOrder(null, avail)).toEqual(avail);
    expect(mergeOrder([], avail)).toEqual(avail);
  });
  it('keeps the saved order', () => {
    expect(mergeOrder(['home', 'drive', '@settings', 'media', 'carplay'], avail)).toEqual(['home', 'drive', '@settings', 'media', 'carplay']);
  });
  it('appends screens added since, in default order', () => {
    expect(mergeOrder(['home', 'drive'], avail)).toEqual(['home', 'drive', 'carplay', 'media', '@settings']);
  });
  it('drops screens that are gone', () => {
    expect(mergeOrder(['home', 'trips', 'drive', '@sim'], ['drive', 'home'])).toEqual(['home', 'drive']);
  });
  it('drops duplicates', () => {
    expect(mergeOrder(['home', 'home', 'drive'], ['drive', 'home'])).toEqual(['home', 'drive']);
  });
  it('both at once', () => {
    expect(mergeOrder(['cams', 'home', 'old', 'drive'], ['drive', 'home', 'cams', 'wopr'])).toEqual(['cams', 'home', 'drive', 'wopr']);
  });
});

describe('rail order: move', () => {
  const o = ['a', 'b', 'c', 'd'];
  it('moves down and up', () => {
    expect(moveItem(o, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(o, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
  });
  it('leaves the original alone and ignores bad indexes', () => {
    expect(moveItem(o, 1, 1)).toEqual(o);
    expect(moveItem(o, -1, 2)).toEqual(o);
    expect(moveItem(o, 1, 9)).toEqual(o);
    expect(o).toEqual(['a', 'b', 'c', 'd']);
  });
});
