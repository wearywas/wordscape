import { migrateWorld, parseWorld, serializeWorld } from './document';
import type { WorldDocument } from './types';
import baselineV1 from '../data/washingtonSquare.v0.1.json';
import baselineV2 from '../data/washingtonSquare.v0.2.json';
import baselineV3 from '../data/washingtonSquare.v0.3.json';
import baselineV4 from '../data/washingtonSquare.v0.4.json';

/** Upgrade the pristine bundled specimen; never replace a user's edited or imported world. */
export function restoreSavedWorld(saved: string | null, latest: WorldDocument): WorldDocument {
  if (!saved) return migrateWorld(latest);
  const parsed = migrateWorld(parseWorld(saved));
  const serialized = serializeWorld(parsed, false);
  return [baselineV1, baselineV2, baselineV3, baselineV4].some(
    (baseline) => serialized === serializeWorld(migrateWorld(baseline as WorldDocument), false),
  )
    ? migrateWorld(latest)
    : parsed;
}
