import { describe, expect, it } from 'vitest';
import { foldTrafficIntoMap } from '../src/map/views.ts';

const v = (id: string, types: string[]) => ({ id, label: id, widgets: types.map((type) => ({ type, col: 1, row: 1, w: 12, h: 2 })) });
describe('Traffic folds into the Map screen', () => {
  it('drops the standard Traffic view from the rail', () => {
    const l = { views: [v('drive', ['drive']), v('map', ['map']), v('traffic', ['trafficAhead'])] };
    expect(foldTrafficIntoMap(l as never).views.map((x) => x.id)).toEqual(['drive', 'map']);
  });
  it('keeps a Traffic view someone changed, and leaves layouts without one alone', () => {
    const custom = { views: [v('map', ['map']), v('traffic', ['trafficAhead', 'speed'])] };
    expect(foldTrafficIntoMap(custom as never).views.map((x) => x.id)).toEqual(['map', 'traffic']);
    const none = { views: [v('drive', ['drive'])] };
    expect(foldTrafficIntoMap(none as never)).toBe(none);
  });
});
