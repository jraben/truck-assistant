import { describe, expect, it } from 'vitest';
import { guessCameras, guessGarage, lovelaceEntities, serviceFor, tileFor, validPanel } from '../src/ha/panel.ts';

describe('Home screen (HA panel)', () => {
  it('finds the garage door, opener light and obstruction sensor', () => {
    const g = guessGarage([
      { entity_id: 'light.garage_lights', state: 'off', attributes: {} },
      { entity_id: 'light.garage_opener_light', state: 'off', attributes: {} },
      { entity_id: 'binary_sensor.garage_door_obstruction', state: 'off', attributes: { device_class: 'problem' } },
      { entity_id: 'cover.garage_door', state: 'closed', attributes: { device_class: 'garage' } },
    ]);
    expect(g).toEqual({ cover: 'cover.garage_door', light: 'light.garage_opener_light', obstruction: 'binary_sensor.garage_door_obstruction' });
  });
  it('maps tile actions to HA services, and refuses the rest', () => {
    expect(serviceFor('cover.garage_door', 'open')).toEqual({ domain: 'cover', service: 'open_cover' });
    expect(serviceFor('light.garage_lights', 'toggle')).toEqual({ domain: 'light', service: 'toggle' });
    expect(serviceFor('scene.movie', 'run')).toEqual({ domain: 'scene', service: 'turn_on' });
    expect(serviceFor('sensor.temp', 'toggle')).toBeNull();
    expect(serviceFor('cover.garage_door', 'unlock')).toBeNull();
  });
  it('pulls every entity out of a Lovelace dashboard', () => {
    const cfg = { views: [{ cards: [
      { type: 'tile', entity: 'cover.garage_door' },
      { type: 'entities', entities: ['light.garage_lights', { entity: 'switch.garage_lights' }] },
      { type: 'vertical-stack', cards: [{ type: 'button', entity: 'light.garage_opener_light' }, { type: 'tile', entity: 'cover.garage_door' }] },
      { type: 'markdown', content: 'not.an_entity here' },
    ] }] };
    expect(lovelaceEntities(cfg)).toEqual(['cover.garage_door', 'light.garage_lights', 'switch.garage_lights', 'light.garage_opener_light']);
  });
  it('validates the saved panel', () => {
    const c = validPanel({ garage: { cover: 'cover.garage_door', nearM: 400 }, pages: [{ title: 'Garage', entities: ['light.garage_lights', 'light.garage_lights'] }] });
    expect(c.garage.cover).toBe('cover.garage_door');
    expect(c.garage.nearM).toBe(400);
    expect(c.pages[0].entities).toEqual(['light.garage_lights']);
    expect(() => validPanel({ garage: { cover: 'light.x' } })).toThrow(/cover/);
    expect(() => validPanel({ pages: [{ title: 'x', entities: ['rm -rf'] }] })).toThrow(/entity id/);
  });
  it('turns a state into a tile with a percent brightness', () => {
    expect(tileFor({ entity_id: 'light.garage_lights', state: 'on', attributes: { friendly_name: 'Garage Lights', brightness: 128 } })).toMatchObject({ name: 'Garage Lights', domain: 'light', brightness: 50, actions: ['toggle', 'on', 'off'] });
  });
});

describe('house cameras on the Home screen', () => {
  const st = (id: string, name: string) => ({ entity_id: id, state: 'idle', attributes: { friendly_name: name } });
  it('guesses lawn, garage and doorbell, in that order, and nothing else', () => {
    expect(guessCameras([st('camera.backyard', 'Backyard'), st('camera.ring_front', 'Front Door'), st('camera.g3_flex', 'Garage'), st('camera.yard', 'Front Lawn'), st('light.garage', 'Garage light')]))
      .toEqual(['camera.yard', 'camera.g3_flex', 'camera.ring_front']);
    expect(guessCameras([st('camera.backyard', 'Backyard')])).toEqual([]);
  });
  it('keeps only cameras, six at most, and marks the list as picked', () => {
    const c = validPanel({ cameras: ['camera.a', 'camera.a', 'camera.b'] });
    expect(c.cameras).toEqual(['camera.a', 'camera.b']);
    expect(c.camerasPicked).toBe(true);
    expect(() => validPanel({ cameras: ['light.porch'] })).toThrow();
    expect(validPanel({}).cameras).toEqual([]);
    expect(validPanel({}).camerasPicked).toBeUndefined();
  });
});
