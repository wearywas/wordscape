import { describe, expect, it } from 'vitest';
import { normalizeWheelDelta, zoomMapAtPoint } from './mapZoom';

describe('cursor-centered map zoom', () => {
  it('preserves the anchor offset in screen units for a panned map', () => {
    const before = { zoom: 1.3, center: [240, 80] as [number, number] };
    const anchor: [number, number] = [101, 175];
    const after = zoomMapAtPoint(before.zoom, before.center, anchor, -120);
    for (let i = 0; i < 2; i++)
      expect((anchor[i] - after.center[i]) * after.zoom).toBeCloseTo(
        (anchor[i] - before.center[i]) * before.zoom,
        10,
      );
  });
  it('normalizes pixel, line, and page wheel events', () => {
    expect(normalizeWheelDelta(2, 0, 500)).toBe(2);
    expect(normalizeWheelDelta(2, 1, 500)).toBe(32);
    expect(normalizeWheelDelta(2, 2, 500)).toBe(1000);
  });
  it('respects both limits without drifting at a limit', () => {
    expect(zoomMapAtPoint(7.9, [50, 50], [10, 10], -500).zoom).toBe(8);
    expect(zoomMapAtPoint(0.6, [50, 50], [10, 10], 500)).toEqual({ zoom: 0.6, center: [50, 50] });
  });
});
