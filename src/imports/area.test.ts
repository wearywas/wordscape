import { describe, expect, it } from 'vitest';
import { boundsAround, parseMapLocation } from './area';
import { geographicFrame } from './osm';

describe('map area selection', () => {
  it('creates metric squares at different latitudes, including the largest allowed size', () => {
    for (const latitude of [-60, 0, 37.8, 70]) {
      const frame = geographicFrame(boundsAround(latitude, 10, 1000));
      expect(frame.width).toBeCloseTo(1000, 2);
      expect(frame.depth).toBeCloseTo(1000, 2);
    }
  });
  it('accepts explicit coordinate pairs and full Google/OSM URLs', () => {
    for (const text of [
      '51.5, -0.12',
      'https://www.google.com/maps/@51.5,-0.12,16z',
      'https://www.openstreetmap.org/#map=17/51.5/-0.12',
    ])
      expect(parseMapLocation(text)).toEqual({ latitude: 51.5, longitude: -0.12 });
  });
  it('rejects ambiguous place searches, polar areas, wrapped bounds and oversize requests', () => {
    for (const text of ['Paris', 'https://maps.app.goo.gl/test', '90,0'])
      expect(() => parseMapLocation(text)).toThrow();
    expect(() => boundsAround(0, 180, 360)).toThrow();
    expect(() => boundsAround(0, 0, 1001)).toThrow();
  });
});
