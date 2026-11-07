import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadCache, mergeOrder, moveItem, pickOrder, RAIL_ORDER_KEY, saveCache } from '../src/lib/railOrder.ts';
import { RAIL_EXTRA_IDS } from '../../brain/src/rail.ts';
import { DEFAULT_LAYOUT } from '../../brain/src/layout.ts';
import { withMediaView } from '../src/media/trackb.tsx';
import { withHomeView } from '../src/home/Home.tsx';
import { withParkedView } from '../src/parked/Parked.tsx';

const mem = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

describe('rail order: first-paint cache', () => {
  it('saves and loads the last driver’s order', () => {
    const s = mem();
    expect(loadCache(s)).toBeNull();
    saveCache(s, { driver: 'jeff', order: ['home', 'drive', '@settings'] });
    expect(JSON.parse(s.m.get(RAIL_ORDER_KEY)!)).toEqual({ driver: 'jeff', order: ['home', 'drive', '@settings'] });
    expect(loadCache(s)).toEqual({ driver: 'jeff', order: ['home', 'drive', '@settings'] });
    saveCache(s, { driver: 'sam', order: null });
    expect(loadCache(s)).toEqual({ driver: 'sam', order: null });
  });
  it('shrugs off junk and broken storage', () => {
    const s = mem();
    for (const junk of ['{not json', '["drive"]', '{"order":["drive"]}', 'null']) { s.m.set(RAIL_ORDER_KEY, junk); expect(loadCache(s)).toBeNull(); }
    s.m.set(RAIL_ORDER_KEY, '{"driver":"jeff","order":["drive", 3, null, "home"]}');
    expect(loadCache(s)).toEqual({ driver: 'jeff', order: ['drive', 'home'] });
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
    expect(loadCache(broken)).toBeNull();
    expect(() => saveCache(broken, { driver: 'jeff', order: ['drive'] })).not.toThrow();
    expect(loadCache(null)).toBeNull();
  });
});

describe('rail order: which one shows', () => {
  const cache = { driver: 'jeff', order: ['home', 'drive'] };
  it('before settings arrive: the cached copy', () => {
    expect(pickOrder({ driver: null, driverOrder: null, draft: null, cache })).toEqual(['home', 'drive']);
    expect(pickOrder({ driver: null, driverOrder: null, draft: null, cache: null })).toBeNull();
  });
  it('then the active driver’s own order, never the cache', () => {
    expect(pickOrder({ driver: 'jeff', driverOrder: ['cams'], draft: null, cache })).toEqual(['cams']);
    expect(pickOrder({ driver: 'sam', driverOrder: null, draft: null, cache })).toBeNull();
  });
  it('an unsaved edit shows for its own driver only', () => {
    const draft = { driver: 'jeff', order: ['@settings', 'drive'] };
    expect(pickOrder({ driver: 'jeff', driverOrder: ['cams'], draft, cache })).toEqual(['@settings', 'drive']);
    expect(pickOrder({ driver: 'sam', driverOrder: ['trips'], draft, cache })).toEqual(['trips']);
    expect(pickOrder({ driver: 'jeff', driverOrder: ['cams'], draft: { driver: 'jeff', order: null }, cache })).toBeNull();
  });
});

describe('rail order: the brain knows every rail id', () => {
  it('views the UI adds and the tools are in RAIL_EXTRA_IDS', () => {
    const known = new Set<string>([...DEFAULT_LAYOUT.views.map((v) => v.id), ...RAIL_EXTRA_IDS]);
    const ids = withParkedView(withHomeView(withMediaView(DEFAULT_LAYOUT))).views.map((v) => v.id);
    for (const id of ids) expect(known.has(id), id).toBe(true);
    const app = readFileSync(new URL('../src/components/App.tsx', import.meta.url), 'utf8');
    const tools = [...app.matchAll(/id: '(@[a-z-]+)'/g)].map((m) => m[1]);
    expect(tools.length).toBeGreaterThanOrEqual(6);
    for (const id of tools) expect(known.has(id), id).toBe(true);
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
