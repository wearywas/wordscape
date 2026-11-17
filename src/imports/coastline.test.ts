import { describe, expect, it } from 'vitest';
import { coastalWaterPolygons } from './coastline';
const area = (p: [number, number][]) =>
  Math.abs(
    p.reduce((s, a, i) => {
      const b = p[(i + 1) % p.length];
      return s + a[0] * b[1] - b[0] * a[1];
    }, 0),
  ) / 2;

describe('bounded coastline water derivation', () => {
  it('keeps water on the right of a directed coastline and closes only at the selection edge', () => {
    const result = coastalWaterPolygons(
      [
        [
          [40, -10],
          [40, 110],
        ],
      ],
      100,
      100,
    );
    expect(result.warnings).toEqual([]);
    expect(result.polygons).toHaveLength(1);
    expect(area(result.polygons[0])).toBeCloseTo(6000);
    expect(result.polygons[0].every(([x]) => x >= 40)).toBe(true);
  });
  it('joins mapped fragments without filling a concave land peninsula', () => {
    const result = coastalWaterPolygons(
      [
        [
          [0, 60],
          [30, 60],
          [30, 80],
        ],
        [
          [30, 80],
          [70, 80],
          [70, 60],
          [100, 60],
        ],
      ],
      100,
      100,
    );
    expect(result.warnings).toEqual([]);
    expect(result.polygons).toHaveLength(1);
    // Eastward coastline has water south of it, including the rectangular bay.
    expect(area(result.polygons[0])).toBeCloseTo(6800);
  });
  it('omits incomplete, contradictory and hole-bearing coastlines rather than flooding land', () => {
    for (const paths of [
      [
        [
          [40, 20],
          [40, 110],
        ],
      ],
      [
        [
          [40, -10],
          [40, 50],
        ],
        [
          [40, 110],
          [40, 50],
        ],
      ],
      [
        [
          [20, 20],
          [80, 20],
          [80, 80],
          [20, 80],
          [20, 20],
        ],
      ],
      [
        [
          [0, 0],
          [100, 100],
        ],
        [
          [0, 100],
          [100, 0],
        ],
      ],
    ] as [number, number][][][]) {
      const result = coastalWaterPolygons(paths, 100, 100);
      expect(result.polygons).toEqual([]);
      expect(result.warnings).toHaveLength(1);
    }
  });
});
