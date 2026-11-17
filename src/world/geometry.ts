import type { WorldObject } from './types';

/** Returns fresh points in the document's east/north metre plane. */
export function getFootprint(object: WorldObject): [number, number][] {
  let local = object.footprint;
  if (!local) {
    local =
      object.kind === 'tree'
        ? Array.from({ length: 16 }, (_, index): [number, number] => [
            (Math.cos((index * Math.PI) / 8) * object.width) / 2,
            (Math.sin((index * Math.PI) / 8) * object.depth) / 2,
          ])
        : [
            [-object.width / 2, -object.depth / 2],
            [object.width / 2, -object.depth / 2],
            [object.width / 2, object.depth / 2],
            [-object.width / 2, object.depth / 2],
          ];
  }
  const angle = (object.rotation * Math.PI) / 180;
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  return local.map(([x, y]) => [object.x + x * cos - y * sin, object.y + x * sin + y * cos]);
}
