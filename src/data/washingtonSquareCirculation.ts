import mappedRoutes from '../../public/reference/washington-square-osm-circulation.json';
import { convertOsmToWorld, type OverpassResponse } from '../imports/osm';
import type { WorldDocument, WorldObject } from '../world/types';

// Thirteen actual OSM footways, checked against the north-up NOAA image.
// All coordinates share the specimen's existing 360 m frame. No entrances inferred.
const imported = convertOsmToWorld(mappedRoutes as OverpassResponse, {
  name: 'Washington Square mapped circulation',
  bounds: {
    west: -122.41224641494269,
    south: 37.799183014789826,
    east: -122.4081535850573,
    north: 37.80241694981248,
  },
  frame: {
    origin: { latitude: 37.799183014789826, longitude: -122.41224641494269 },
    width: 360,
    depth: 360,
    mercatorScale: 0.7901464545017922,
  },
  accessed: '2026-11-15',
  sourceUrl:
    'https://api.openstreetmap.org/api/0.6/map?bbox=-122.41224641494269,37.799183014789826,-122.4081535850573,37.80241694981248',
}).world;

export const washingtonSquareCirculationSource = {
  ...imported.sources[0],
  title: 'OpenStreetMap · Washington Square footways',
  notes:
    imported.sources[0].notes +
    ' Thirteen mapped park footways were visually aligned with the NOAA 2022 photograph. No entrance-tagged nodes were present. Footway widths and surface thickness are scene estimates.',
};

export const washingtonSquareCirculation: WorldObject[] = imported.objects.map((object, index) => ({
  ...object,
  label: `Park path ${index + 1}`,
  parentId: 'park-walk',
  grounding: 'terrain',
  elevation: 0.16,
  height: 0.06,
  layer: 2,
  description:
    'Mapped OSM footway centerline, visually checked against the 2022 NOAA image. Shared OSM node IDs preserve mapped connectivity. Corridor width is estimated; this is not an accessibility or current-condition assessment.',
  facts: [
    // The surveyed baseline has its own explicit terrain-relative surface stack.
    ...object.facts!.filter(
      (fact) => !['placement.surfaceOffset', 'placement.surfaceThickness'].includes(fact.key),
    ),
    {
      key: 'placement.surfaceOffset',
      value: 0.16,
      unit: 'm',
      evidence: 'authored',
      note: 'Rendering separation above the earlier promenade and lawn layers; not a surveyed vertical offset.',
    },
  ],
}));

const atNode = new Map<number, string[]>();
for (const object of washingtonSquareCirculation)
  for (const key of ['osm.fromNode', 'osm.toNode']) {
    const id = object.facts?.find((fact) => fact.key === key)?.value;
    if (typeof id === 'number') {
      const ids = atNode.get(id) ?? [];
      ids.push(object.id);
      atNode.set(id, ids);
    }
  }
const connected = new Set<string>();
export const washingtonSquareCirculationRelations: WorldDocument['relations'] = [];
for (const [node, ids] of atNode)
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const pair = [ids[i], ids[j]].sort(),
        key = pair.join('|');
      if (connected.has(key) || pair[0] === pair[1]) continue;
      connected.add(key);
      washingtonSquareCirculationRelations.push({
        from: pair[0],
        to: pair[1],
        type: 'connects',
        note: `Shared mapped OpenStreetMap node ${node}. Connectivity is recorded, not a guarantee of access or passability.`,
      });
    }
