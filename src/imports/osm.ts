import { validateWorld } from '../world/document';
import type { ObjectKind, WorldDocument, WorldFact, WorldObject } from '../world/types';
import { coastalWaterPolygons } from './coastline';

export interface GeographicBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}
export interface OsmCoordinate {
  lat: number;
  lon: number;
}
export interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  tags?: Record<string, string>;
  lat?: number;
  lon?: number;
  nodes?: number[];
  geometry?: (OsmCoordinate | null)[];
  members?: { type: string; ref: number; role: string; geometry?: (OsmCoordinate | null)[] }[];
  timestamp?: string;
  version?: number;
}
export interface OverpassResponse {
  elements: OsmElement[];
  generator?: string;
  remark?: string;
  osm3s?: { timestamp_osm_base?: string; copyright?: string };
}
export interface OsmImportOptions {
  bounds: GeographicBounds;
  name?: string;
  sourceUrl?: string;
  accessed?: string;
  frame?: {
    origin: { latitude: number; longitude: number };
    width: number;
    depth: number;
    mercatorScale: number;
  };
}
export interface OsmImportDiagnostics {
  warnings: string[];
  counts: {
    inputElements: number;
    importedObjects: number;
    buildings: number;
    roads: number;
    paths: number;
    entrances: number;
    trees: number;
    areas: number;
    estimatedHeights: number;
    clippedObjects: number;
  };
  omitted: { reason: string; count: number }[];
  timestamp: string | null;
}

/** Browser-side fallback for one bounded OSM map API response. Never resolves XML entities. */
export function parseOsmXml(text: string): OverpassResponse {
  if (text.length > 8 * 1024 * 1024)
    throw new Error('The OSM XML response exceeds the 8 MiB limit.');
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error('OSM XML containing document types or entities is not supported.');
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  if (xml.querySelector('parsererror') || xml.documentElement.tagName !== 'osm')
    throw new Error('The map service did not return valid OSM XML.');
  const elements: OsmElement[] = [];
  for (const entry of Array.from(xml.documentElement.children)) {
    if (!['node', 'way', 'relation'].includes(entry.tagName)) continue;
    const element: OsmElement = {
      type: entry.tagName as OsmElement['type'],
      id: Number(entry.getAttribute('id')),
    };
    const timestamp = entry.getAttribute('timestamp'),
      version = entry.getAttribute('version');
    if (timestamp) element.timestamp = timestamp;
    if (version) element.version = Number(version);
    element.tags = Object.fromEntries(
      Array.from(entry.children)
        .filter((child) => child.tagName === 'tag')
        .map((tag) => [tag.getAttribute('k') ?? '', tag.getAttribute('v') ?? '']),
    );
    if (element.type === 'node') {
      element.lat = entry.hasAttribute('lat') ? Number(entry.getAttribute('lat')) : NaN;
      element.lon = entry.hasAttribute('lon') ? Number(entry.getAttribute('lon')) : NaN;
    }
    if (element.type === 'way')
      element.nodes = Array.from(entry.children)
        .filter((child) => child.tagName === 'nd')
        .map((node) => Number(node.getAttribute('ref')));
    if (element.type === 'relation')
      element.members = Array.from(entry.children)
        .filter((child) => child.tagName === 'member')
        .map((member) => ({
          type: member.getAttribute('type') ?? '',
          ref: Number(member.getAttribute('ref')),
          role: member.getAttribute('role') ?? '',
        }));
    elements.push(element);
  }
  const nodes = new Map(
    elements.filter((e) => e.type === 'node').map((e) => [e.id, { lat: e.lat!, lon: e.lon! }]),
  );
  const ways = new Map(elements.filter((e) => e.type === 'way').map((e) => [e.id, e]));
  for (const way of ways.values()) way.geometry = way.nodes?.map((id) => nodes.get(id) ?? null);
  for (const element of elements)
    for (const member of element.members ?? [])
      if (member.type === 'way') member.geometry = ways.get(member.ref)?.geometry;
  return {
    elements,
    generator: xml.documentElement.getAttribute('generator') ?? 'OSM API XML',
    osm3s: {
      copyright: xml.documentElement.getAttribute('copyright') ?? 'OpenStreetMap contributors',
    },
  };
}
type Point = [number, number];
const R = 6378137,
  SOURCE = 'osm-extract',
  LIMIT = 1000;
const round = (n: number) => Math.round(n * 1000) / 1000;
const mercator = (lon: number, lat: number): Point => [
  (R * lon * Math.PI) / 180,
  R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)),
];

/** Finite, non-wrapping selection, at most one kilometre along either local axis. */
export function geographicFrame(bounds: GeographicBounds) {
  const { west, south, east, north } = bounds;
  if (
    ![west, south, east, north].every(Number.isFinite) ||
    west < -180 ||
    east > 180 ||
    west >= east ||
    south < -85 ||
    north > 85 ||
    south >= north
  )
    throw new Error(
      'Choose a finite bounding box between 85° south and north, without crossing the date line.',
    );
  const scale = Math.cos((((south + north) / 2) * Math.PI) / 180);
  const sw = mercator(west, south),
    ne = mercator(east, north);
  const width = (ne[0] - sw[0]) * scale,
    depth = (ne[1] - sw[1]) * scale;
  if (width > 1000.01 || depth > 1000.01)
    throw new Error('Select an area no larger than 1 km in either direction.');
  if (width < 5 || depth < 5) throw new Error('Select an area at least 5 m in either direction.');
  return {
    origin: { latitude: south, longitude: west },
    width: round(width),
    depth: round(depth),
    mercatorScale: scale,
  };
}

/** One explicit bounded request; the caller owns endpoint policy, caching and cancellation. */
export function buildOverpassQuery(bounds: GeographicBounds): string {
  geographicFrame(bounds);
  const box = [bounds.south, bounds.west, bounds.north, bounds.east].join(',');
  return `[out:json][timeout:25][maxsize:33554432];(nwr["building"](${box});way["building:part"](${box});way["highway"](${box});node["entrance"](${box});node["natural"="tree"](${box});nwr["leisure"~"^(park|garden|playground)$"](${box});way["landuse"="grass"](${box});nwr["natural"="water"](${box});way["natural"="coastline"](${box}););out body geom;`;
}

/** OSM lengths are metres unless units are specified. Unparseable/range strings remain unknown. */
export function parseOsmLength(input: string | undefined): number | undefined {
  if (!input) return undefined;
  const text = input.trim().toLowerCase();
  const feetInches = /^(\d+(?:\.\d+)?)\s*'\s*(\d+(?:\.\d+)?)?\s*"?$/.exec(text);
  const match = /^(\d+(?:\.\d+)?)\s*(m|metres?|meters?|ft|feet|'|cm)?$/.exec(text);
  const value = feetInches
    ? Number(feetInches[1]) * 0.3048 + Number(feetInches[2] ?? 0) * 0.0254
    : match
      ? Number(match[1]) *
        (['ft', 'feet', "'"].includes(match[2]) ? 0.3048 : match[2] === 'cm' ? 0.01 : 1)
      : NaN;
  return Number.isFinite(value) && value > 0 && value <= 10000 ? value : undefined;
}
const positive = (s: string | undefined) =>
  s && /^\d+(\.\d+)?$/.test(s) && Number(s) > 0 ? Number(s) : undefined;
const sourced = (
  key: string,
  value: WorldFact['value'],
  note?: string,
  unit?: string,
): WorldFact => ({
  key,
  value,
  evidence: 'sourced',
  sourceIds: [SOURCE],
  ...(note ? { note } : {}),
  ...(unit ? { unit } : {}),
});
const inferred = (
  key: string,
  value: WorldFact['value'],
  note: string,
  unit?: string,
): WorldFact => ({ key, value, evidence: 'inferred', note, ...(unit ? { unit } : {}) });
const unknown = (key: string, note: string): WorldFact => ({
  key,
  value: null,
  evidence: 'unknown',
  note,
});
const same = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.00001;

function cleanPolygon(input: Point[]): Point[] {
  const points = input.filter((point, index) => !index || !same(point, input[index - 1]));
  if (points.length > 1 && same(points[0], points.at(-1)!)) points.pop();
  return points;
}
function clipPolygon(input: Point[], width: number, depth: number): Point[] {
  let output = cleanPolygon(input);
  for (const [axis, limit, greater] of [
    [0, 0, true],
    [0, width, false],
    [1, 0, true],
    [1, depth, false],
  ] as const) {
    const source = output;
    output = [];
    for (let i = 0; i < source.length; i++) {
      const a = source[i],
        b = source[(i + 1) % source.length];
      const insideA = greater ? a[axis] >= limit : a[axis] <= limit,
        insideB = greater ? b[axis] >= limit : b[axis] <= limit;
      if (insideA) output.push(a);
      if (insideA !== insideB) {
        const t = (limit - a[axis]) / (b[axis] - a[axis]);
        output.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
  }
  return cleanPolygon(
    output.map(([x, y]) => [
      round(Math.max(0, Math.min(width, x))),
      round(Math.max(0, Math.min(depth, y))),
    ]),
  );
}
function contains(point: Point, polygon: Point[]): boolean {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    const cross = (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]);
    if (
      Math.abs(cross) < 1e-6 &&
      point[0] >= Math.min(a[0], b[0]) - 1e-6 &&
      point[0] <= Math.max(a[0], b[0]) + 1e-6 &&
      point[1] >= Math.min(a[1], b[1]) - 1e-6 &&
      point[1] <= Math.max(a[1], b[1]) + 1e-6
    )
      return true;
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      result = !result;
  }
  return result;
}

// Checking only the center can incorrectly attach a neighboring or spanning part.
// A concave outline additionally needs every interval along each part edge checked.
function containsPolygon(outer: Point[], inner: Point[]): boolean {
  if (!inner.every((point) => contains(point, outer))) return false;
  for (let i = 0; i < inner.length; i++) {
    const a = inner[i],
      b = inner[(i + 1) % inner.length];
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      cuts = [0, 1];
    for (let j = 0; j < outer.length; j++) {
      const c = outer[j],
        d = outer[(j + 1) % outer.length];
      const ex = d[0] - c[0],
        ey = d[1] - c[1],
        determinant = dx * ey - dy * ex;
      if (Math.abs(determinant) < 1e-9) continue;
      const cx = c[0] - a[0],
        cy = c[1] - a[1];
      const t = (cx * ey - cy * ex) / determinant;
      const u = (cx * dy - cy * dx) / determinant;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
    }
    cuts.sort((a, b) => a - b);
    for (let j = 0; j + 1 < cuts.length; j++) {
      const t = (cuts[j] + cuts[j + 1]) / 2;
      if (!contains([a[0] + dx * t, a[1] + dy * t], outer)) return false;
    }
  }
  return true;
}

function clipLine(a: Point, b: Point, width: number, depth: number) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  let from = 0,
    to = 1;
  for (const [p, q] of [
    [-dx, a[0]],
    [dx, width - a[0]],
    [-dy, a[1]],
    [dy, depth - a[1]],
  ]) {
    if (p === 0) {
      if (q < 0) return;
      continue;
    }
    const t = q / p;
    if (p < 0) from = Math.max(from, t);
    else to = Math.min(to, t);
    if (from > to) return;
  }
  return {
    a: [a[0] + dx * from, a[1] + dy * from] as Point,
    b: [a[0] + dx * to, a[1] + dy * to] as Point,
    fromCut: from > 1e-9,
    toCut: to < 1 - 1e-9,
  };
}

// Flat preview layers are visual assumptions, never mapped ground elevations.
function placeSurface(object: WorldObject, offset: number): void {
  object.elevation = offset;
  object.height = 0.02;
  for (const [key, value] of [
    ['placement.surfaceOffset', offset],
    ['placement.surfaceThickness', object.height],
  ] as const)
    object.facts!.push({
      key,
      value,
      unit: 'm',
      evidence: 'authored',
      note: 'Flat preview surface separation: green space/water below paved areas, roads and paths. Rendering convention, not measured terrain, curbs, bridge clearance or pavement construction.',
    });
}

/** Converts mapped observations only. Missing tags never become sourced detail. No fetch occurs. */
export function convertOsmToWorld(
  input: OverpassResponse,
  options: OsmImportOptions,
): { world: WorldDocument; diagnostics: OsmImportDiagnostics } {
  const inferredFrame = geographicFrame(options.bounds),
    frame = options.frame ?? inferredFrame;
  if (!input || !Array.isArray(input.elements) || input.elements.length > 20000)
    throw new Error('Expected an OSM extract containing at most 20,000 elements.');
  if (input.remark)
    throw new Error(
      `The map service reported an incomplete extract: ${input.remark.slice(0, 300)}`,
    );
  if (
    ![
      frame.width,
      frame.depth,
      frame.origin.latitude,
      frame.origin.longitude,
      frame.mercatorScale,
    ].every(Number.isFinite) ||
    frame.width <= 0 ||
    frame.depth <= 0 ||
    frame.width > 1000.01 ||
    frame.depth > 1000.01 ||
    Math.abs(frame.origin.latitude) > 85 ||
    Math.abs(frame.origin.longitude) > 180 ||
    frame.mercatorScale <= 0 ||
    frame.mercatorScale > 1
  )
    throw new Error('Invalid local coordinate frame.');
  const sw = mercator(frame.origin.longitude, frame.origin.latitude);
  const project = (p: OsmCoordinate): Point => {
    const q = mercator(p.lon, p.lat);
    return [(q[0] - sw[0]) * frame.mercatorScale, (q[1] - sw[1]) * frame.mercatorScale];
  };
  const coordinate = (p: OsmCoordinate | null | undefined): p is OsmCoordinate =>
    !!p &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lon) &&
    Math.abs(p.lat) < 85.1 &&
    Math.abs(p.lon) <= 180;
  const omission = new Map<string, number>();
  const omit = (reason: string) => omission.set(reason, (omission.get(reason) ?? 0) + 1);
  const counts = {
    inputElements: input.elements.length,
    importedObjects: 0,
    buildings: 0,
    roads: 0,
    paths: 0,
    entrances: 0,
    trees: 0,
    areas: 0,
    estimatedHeights: 0,
    clippedObjects: 0,
  };
  const diagnostics: OsmImportDiagnostics = {
    counts,
    omitted: [],
    timestamp: input.osm3s?.timestamp_osm_base ?? null,
    warnings: [
      'OpenStreetMap coverage varies: absent features and tags are unknown, not evidence that they do not exist.',
      'Imported ground is a flat local plane. No terrain, surveyed floor elevations or accessibility routing is inferred.',
    ],
  };
  const timestamp = diagnostics.timestamp;
  const world: WorldDocument = {
    format: 'wordscape',
    version: '0.3',
    name: (options.name ?? 'OpenStreetMap area').slice(0, 200),
    description:
      'A bounded OpenStreetMap interpretation. Mapped geometry and tags retain provenance; untagged dimensions are explicit scene estimates. Review omissions before use.',
    units: 'metres',
    bounds: { width: frame.width, depth: frame.depth },
    origin: {
      ...frame.origin,
      note: `Southwest local frame; x east, y north. Web Mercator scaled by ${frame.mercatorScale}. Geometry may be clipped at selection bounds.`,
    },
    seed: 1,
    sources: [
      {
        id: SOURCE,
        title: 'OpenStreetMap extract',
        url: options.sourceUrl ?? 'https://www.openstreetmap.org/copyright',
        attribution: '© OpenStreetMap contributors · Open Database License (ODbL) 1.0',
        accessed: options.accessed ?? timestamp?.slice(0, 10) ?? 'Unknown',
        notes: `Open data under https://opendatacommons.org/licenses/odbl/1-0/ . Retain attribution and ODbL terms when distributing derived data. Database timestamp: ${timestamp ?? 'not supplied'}; this is not a survey acquisition date. Individual edit timestamps, when supplied, remain on objects.`,
      },
    ],
    objects: [],
    relations: [],
  };
  const elements = input.elements
    .filter(
      (e) =>
        e && ['node', 'way', 'relation'].includes(e.type) && Number.isSafeInteger(e.id) && e.id > 0,
    )
    .sort((a, b) => a.type.localeCompare(b.type) || a.id - b.id);
  const nodes = new Map(
    elements
      .filter((e) => e.type === 'node' && coordinate(e as OsmCoordinate))
      .map((e) => [e.id, { lat: e.lat!, lon: e.lon! }]),
  );
  const tagsOf = (e: OsmElement) =>
    Object.fromEntries(
      Object.entries(e.tags ?? {}).filter(
        ([k, v]) => typeof k === 'string' && typeof v === 'string',
      ),
    );
  const rawFacts = (e: OsmElement): WorldFact[] => {
    const tags = Object.fromEntries(
      Object.entries(tagsOf(e)).sort(([a], [b]) => a.localeCompare(b)),
    );
    let text = JSON.stringify(tags);
    if (text.length > 8000) {
      text = JSON.stringify(
        Object.fromEntries(
          Object.entries(tags).filter(([k]) =>
            /^(building|roof|height|min_height|name|highway|entrance|surface|access|foot|width|oneway|maxspeed|natural|species|leisure)/.test(
              k,
            ),
          ),
        ),
      );
      omit('Long tag set: only selected tags retained in world; keep the raw extract.');
    }
    const facts = [
      sourced('osm.element', `${e.type}/${e.id}`),
      sourced('osm.url', `https://www.openstreetmap.org/${e.type}/${e.id}`),
      sourced('osm.tags', text.slice(0, 10000)),
    ];
    if (e.timestamp)
      facts.push(sourced('osm.editedAt', e.timestamp, 'OSM edit time, not a measurement date.'));
    if (e.version !== undefined) facts.push(sourced('osm.version', e.version));
    return facts;
  };
  const base = (e: OsmElement, id: string, kind: ObjectKind, label: string): WorldObject => ({
    id,
    label: label.slice(0, 200),
    kind,
    description:
      'Geometry and tags from OpenStreetMap. Source links describe community mapping, not an independently verified survey.',
    x: 0,
    y: 0,
    width: 1,
    depth: 1,
    height: 1,
    elevation: 0,
    rotation: 0,
    layer: kind === 'building' ? 3 : kind === 'tree' ? 4 : 1,
    evidence: 'observed',
    sourceId: SOURCE,
    tags: ['osm-import'],
    facts: rawFacts(e),
    references: [
      {
        sourceId: SOURCE,
        role: 'map',
        view: `${e.type}/${e.id}`,
        note: `https://www.openstreetmap.org/${e.type}/${e.id}`,
      },
    ],
  });
  const add = (object: WorldObject): boolean => {
    if (world.objects.length >= LIMIT) {
      omit('Object limit reached; remaining mapped objects omitted.');
      return false;
    }
    // Reuse the format validator so malformed/self-intersecting clipped rings never leak into a world.
    const result = validateWorld({
      ...world,
      objects: [{ ...object, parentId: undefined }],
      relations: [],
    });
    if (result.errors.length) {
      omit('Unsupported or invalid geometry/attributes.');
      return false;
    }
    world.objects.push(object);
    counts.importedObjects++;
    return true;
  };
  const shape = (
    e: OsmElement,
    id: string,
    kind: ObjectKind,
    label: string,
    points: Point[],
  ): WorldObject | undefined => {
    if (points.length > 256) {
      omit('Polygon exceeds 256 vertices; not silently simplified.');
      return;
    }
    const clipped = clipPolygon(points, frame.width, frame.depth);
    if (clipped.length < 3) return;
    const xs = clipped.map((p) => p[0]),
      ys = clipped.map((p) => p[1]);
    const minX = Math.min(...xs),
      maxX = Math.max(...xs),
      minY = Math.min(...ys),
      maxY = Math.max(...ys);
    if (maxX - minX < 0.01 || maxY - minY < 0.01) return;
    const object = base(e, id, kind, label);
    object.x = round((minX + maxX) / 2);
    object.y = round((minY + maxY) / 2);
    object.width = round(maxX - minX);
    object.depth = round(maxY - minY);
    object.footprint = clipped.map(([x, y]) => [round(x - object.x), round(y - object.y)]);
    if (points.some(([x, y]) => x < 0 || y < 0 || x > frame.width || y > frame.depth)) {
      object.facts!.push({
        key: 'import.clipped',
        value: true,
        evidence: 'authored',
        note: 'Footprint clipped to selection boundary; the real feature continues outside.',
      });
      counts.clippedObjects++;
    }
    return object;
  };
  const geometry = (e: OsmElement): OsmCoordinate[] | undefined => {
    const positions = e.geometry ?? e.nodes?.map((id) => nodes.get(id) ?? null);
    if (
      !positions ||
      positions.length < 2 ||
      positions.length > 10000 ||
      positions.some((p) => !coordinate(p))
    ) {
      omit('Missing or incomplete way geometry.');
      return;
    }
    return positions as OsmCoordinate[];
  };
  const coastlines = elements.filter((e) => e.type === 'way' && tagsOf(e).natural === 'coastline');
  if (coastlines.length) {
    const paths = coastlines.map(geometry);
    if (paths.some((p) => !p)) {
      diagnostics.warnings.push(
        'Coastal water omitted: an incomplete source coastline cannot establish safe land/sea coverage.',
      );
      omit('Incomplete coastline geometry.');
    } else {
      const water = coastalWaterPolygons(
        paths.map((p) => p!.map(project)),
        frame.width,
        frame.depth,
      );
      diagnostics.warnings.push(...water.warnings);
      if (water.warnings.length)
        omit('Coastline topology could not safely establish water polygons.');
      for (const [index, polygon] of water.polygons.entries()) {
        const object = shape(
          coastlines[0],
          `osm-coastal-water-${index + 1}`,
          'water',
          'Coastal water',
          polygon,
        );
        if (!object) continue;
        object.description =
          'Water polygon derived from mapped OSM coastlines and the selection edge. OSM places land to the left and water to the right of the directed coast. No tide height, depth or navigability is measured.';
        placeSurface(object, 0);
        object.layer = 0;
        object.facts!.push(
          sourced('water.kind', 'coastal'),
          sourced(
            'osm.coastlineWays',
            JSON.stringify(coastlines.map((e) => e.id)),
            'All source coastlines used to derive bounded water faces.',
          ),
          sourced(
            'water.boundaryModel',
            'OSM coastline: mean high-water springs',
            'Selection edges close the cropped display; they are not real shorelines.',
          ),
          unknown(
            'water.surfaceElevation',
            'The mapped coastline does not establish a water-level measurement or vertical datum.',
          ),
          {
            key: 'water.renderLevel',
            value: 0,
            unit: 'm',
            evidence: 'authored',
            note: 'Flat sea visualization at zero in the attached terrain vertical datum, if present. This is not a measured tide level and does not convert between vertical datums.',
          },
        );
        if (add(object)) counts.areas++;
      }
    }
  }

  const buildingNodes = new Map<number, string>();
  const buildings: { element: OsmElement; object: WorldObject; polygon: Point[]; part: boolean }[] =
    [];
  // Closed simple ways and simple multipolygons. Courtyard holes are omitted, never filled in.
  for (const e of elements) {
    const tags = tagsOf(e),
      isBuilding = tags.building && tags.building !== 'no',
      isPart = tags['building:part'] && tags['building:part'] !== 'no';
    const park =
        ['park', 'garden', 'playground'].includes(tags.leisure) || tags.landuse === 'grass',
      water = tags.natural === 'water';
    if (e.type === 'node' || (!isBuilding && !isPart && !park && !water)) continue;
    let positions: OsmCoordinate[] | undefined;
    if (e.type === 'relation') {
      const members = e.members ?? [];
      const outer = members.filter((m) => m.role === 'outer' || m.role === '');
      if (members.some((m) => m.role === 'inner') || outer.length !== 1) {
        omit('Complex multipolygon or courtyard holes require manual review.');
        continue;
      }
      positions = outer[0].geometry?.every(coordinate)
        ? (outer[0].geometry as OsmCoordinate[])
        : undefined;
      if (!positions) {
        omit('Incomplete relation geometry.');
        continue;
      }
    } else positions = geometry(e);
    if (!positions) continue;
    if (
      positions.length < 4 ||
      positions[0].lat !== positions.at(-1)!.lat ||
      positions[0].lon !== positions.at(-1)!.lon
    ) {
      omit('Open polygon omitted; no inferred closing edge.');
      continue;
    }
    const kind: ObjectKind =
      isBuilding || isPart
        ? 'building'
        : water
          ? 'water'
          : tags.leisure === 'playground'
            ? 'pavement'
            : 'grass';
    const polygon = positions.map(project),
      object = shape(
        e,
        `osm-${e.type}-${e.id}`,
        kind,
        tags.name ??
          (isPart
            ? 'Building part'
            : isBuilding
              ? 'Mapped building'
              : water
                ? 'Mapped water'
                : tags.leisure === 'playground'
                  ? 'Mapped playground'
                  : 'Mapped green space'),
        polygon,
      );
    if (!object) continue;
    if (kind === 'building') {
      const total = parseOsmLength(tags.height),
        minimum = parseOsmLength(tags.min_height) ?? 0,
        levels = positive(tags['building:levels']);
      const fallback = levels ? levels * 3 : 9;
      object.height = round((total ?? fallback) - minimum);
      object.elevation = minimum;
      if (object.height <= 0) {
        omit('Building height does not exceed minimum height.');
        continue;
      }
      object.facts!.push(
        total
          ? sourced(
              'building.reportedHeight',
              total,
              'OSM height is total top height above ground.',
              'm',
            )
          : inferred(
              'building.height',
              fallback,
              levels
                ? 'Estimated at 3 m per mapped level; roof detail unknown.'
                : 'Fallback mass height; no mapped height or floor count.',
              'm',
            ),
      );
      object.facts!.push(
        levels
          ? sourced('building.levels', levels)
          : unknown('building.levels', 'No usable building:levels tag.'),
      );
      if (!total) counts.estimatedHeights++;
      for (const [tag, key] of [
        ['building:material', 'building.material'],
        ['building:colour', 'building.color'],
        ['roof:colour', 'building.roofColor'],
        ['roof:shape', 'building.roofShape'],
      ] as const)
        if (tags[tag]) object.facts!.push(sourced(key, tags[tag]));
      if (!tags['roof:shape'])
        object.facts!.push(
          inferred(
            'building.roofShape',
            'flat',
            'Neutral procedural roof; roof shape is not mapped.',
          ),
        );
      if (minimum) object.facts!.push(sourced('building.minHeight', minimum, undefined, 'm'));
      if (isPart) object.tags!.push('building-part');
      if (add(object)) {
        counts.buildings++;
        buildings.push({
          element: e,
          object,
          polygon: cleanPolygon(polygon),
          part: Boolean(isPart),
        });
        for (const id of e.nodes ?? []) buildingNodes.set(id, object.id);
      }
    } else {
      placeSurface(object, kind === 'pavement' ? 0.04 : 0);
      object.layer = kind === 'water' ? 0 : 1;
      if (add(object)) counts.areas++;
    }
  }
  // Group source parts only where containment is supported by the mapped outlines.
  for (const part of buildings.filter((b) => b.part)) {
    const parent = buildings
      .filter((b) => !b.part && containsPolygon(b.polygon, part.polygon))
      .sort((a, b) => a.object.width * a.object.depth - b.object.width * b.object.depth)[0];
    if (parent) {
      part.object.parentId = parent.object.id;
      if (!parent.object.facts!.some((fact) => fact.key === 'building.isOutline'))
        parent.object.facts!.push(
          inferred(
            'building.isOutline',
            true,
            'OSM outline contains mapped building parts. Keep its footprint and metadata, but render the parts instead of an overlapping whole-building mass.',
          ),
        );
      world.relations.push({
        from: part.object.id,
        to: parent.object.id,
        type: 'within',
        note: 'Mapped building part inside an outline; source geometry can overlap.',
      });
    }
  }
  for (const e of elements) {
    const tags = tagsOf(e);
    if (
      e.type !== 'way' ||
      !tags.highway ||
      tags.highway === 'proposed' ||
      tags.highway === 'construction'
    )
      continue;
    const positions = geometry(e);
    if (!positions) continue;
    const path = ['footway', 'path', 'steps', 'pedestrian', 'cycleway', 'bridleway'].includes(
      tags.highway,
    );
    if (tags.area === 'yes') {
      omit('Highway area omitted from centerline route conversion.');
      continue;
    }
    const mappedWidth = parseOsmLength(tags.width),
      width =
        mappedWidth ??
        (path ? (tags.highway === 'steps' ? 2 : 2.5) : tags.highway === 'service' ? 4 : 7);
    for (let i = 0; i + 1 < positions.length; i++) {
      const line = clipLine(
        project(positions[i]),
        project(positions[i + 1]),
        frame.width,
        frame.depth,
      );
      if (!line) continue;
      const a = line.a,
        b = line.b,
        dx = b[0] - a[0],
        dy = b[1] - a[1],
        length = Math.hypot(dx, dy);
      if (length < 0.05) continue;
      const ox = ((-dy / length) * width) / 2,
        oy = ((dx / length) * width) / 2;
      const points: Point[] = [
        [a[0] + ox, a[1] + oy],
        [b[0] + ox, b[1] + oy],
        [b[0] - ox, b[1] - oy],
        [a[0] - ox, a[1] - oy],
      ];
      const object = shape(
        e,
        `osm-way-${e.id}-segment-${i}`,
        path ? 'pavement' : 'road',
        tags.name ??
          (path
            ? tags.highway === 'steps'
              ? 'Mapped steps'
              : 'Mapped walking path'
            : 'Mapped street'),
        points,
      );
      if (!object) continue;
      placeSurface(object, path ? 0.08 : 0.06);
      object.layer = path ? 2 : 1;
      object.tags!.push(path ? 'walking-route' : 'road-segment');
      object.facts!.push(
        sourced('osm.segmentIndex', i),
        sourced(path ? 'path.type' : 'road.class', tags.highway),
        mappedWidth
          ? sourced(path ? 'path.width' : 'road.width', width, 'Parsed mapped width.', 'm')
          : inferred(
              path ? 'path.width' : 'road.width',
              width,
              'Estimated corridor width around a mapped centerline.',
              'm',
            ),
      );
      object.facts!.push(
        sourced(
          'path.centerline',
          JSON.stringify([a, b].map((p) => p.map(round))),
          'Absolute local coordinates, clipped at the selection boundary. Endpoint OSM IDs are retained only when the original endpoint survives.',
        ),
      );
      if (e.nodes?.[i] !== undefined && !line.fromCut)
        object.facts!.push(sourced('osm.fromNode', e.nodes[i]));
      if (e.nodes?.[i + 1] !== undefined && !line.toCut)
        object.facts!.push(sourced('osm.toNode', e.nodes[i + 1]));
      if (line.fromCut || line.toCut)
        object.facts!.push({
          key: 'import.centerlineClipped',
          value: true,
          evidence: 'authored',
          note: 'Boundary cuts are not original OSM nodes and do not imply mapped junctions.',
        });
      for (const key of [
        'access',
        'foot',
        'surface',
        'wheelchair',
        'incline',
        'bridge',
        'tunnel',
        'layer',
      ])
        if (tags[key]) object.facts!.push(sourced(`path.${key}`, tags[key]));
      if (!path) {
        const direction =
          tags.oneway === 'yes' || tags.oneway === '1' || tags.oneway === '-1'
            ? 'one-way'
            : tags.oneway === 'no' || tags.oneway === '0'
              ? 'two-way'
              : undefined;
        object.facts!.push(
          direction
            ? sourced('road.direction', direction)
            : unknown('road.direction', 'No explicit one-way tag; direction not assumed.'),
        );
        if (direction === 'one-way')
          object.facts!.push(
            sourced(
              'road.bearing',
              ((Math.atan2(dx, dy) * 180) / Math.PI + (tags.oneway === '-1' ? 180 : 0) + 360) % 360,
              'Source-way travel orientation.',
              'degrees',
            ),
          );
        const lanes = positive(tags.lanes);
        object.facts!.push(
          lanes ? sourced('road.lanes', lanes) : unknown('road.lanes', 'No usable lanes tag.'),
        );
        const speed = tags.maxspeed && /^(\d+(?:\.\d+)?)\s*(mph|km\/h)?$/.exec(tags.maxspeed);
        object.facts!.push(
          speed
            ? sourced(
                'road.speedLimit',
                Number(speed[1]) * (speed[2] === 'mph' ? 1 : 0.621371),
                'Mapped segment limit, not live driving advice.',
                'mph',
              )
            : unknown('road.speedLimit', 'No numeric mapped speed limit.'),
        );
      }
      if (add(object)) {
        if (path) counts.paths++;
        else counts.roads++;
      }
    }
  }
  for (const e of elements) {
    if (e.type !== 'node' || !coordinate(e as OsmCoordinate)) continue;
    const tags = tagsOf(e),
      entrance = tags.entrance && tags.entrance !== 'no',
      tree = tags.natural === 'tree';
    if (!entrance && !tree) continue;
    const [x, y] = project(e as OsmCoordinate);
    if (x < 0 || y < 0 || x > frame.width || y > frame.depth) continue;
    const object = base(
      e,
      `osm-node-${e.id}`,
      tree ? 'tree' : 'fixture',
      tags.name ?? (tree ? 'Mapped tree' : 'Mapped entrance'),
    );
    object.x = round(x);
    object.y = round(y);
    object.width = object.depth = Math.max(
      0.01,
      Math.min(tree ? 6 : 1, 2 * x, 2 * y, 2 * (frame.width - x), 2 * (frame.depth - y)),
    );
    object.height = parseOsmLength(tags.height) ?? (tree ? 8 : 2.2);
    object.layer = 4;
    if (tree) {
      object.facts!.push(
        tags.species
          ? sourced('tree.species', tags.species)
          : unknown('tree.species', 'No mapped species.'),
        tags.height && parseOsmLength(tags.height)
          ? sourced('tree.height', object.height, undefined, 'm')
          : inferred('tree.height', object.height, 'Fallback scene height.', 'm'),
        inferred(
          'tree.canopyDiameter',
          object.width,
          'Unmeasured crown width; not trunk diameter.',
          'm',
        ),
      );
    } else {
      object.facts!.push(
        sourced('fixture.type', 'entrance'),
        sourced('entrance.type', tags.entrance),
        inferred(
          'entrance.markerDimensions',
          '1 m × 2.2 m',
          'Symbolic entrance marker, not measured door dimensions.',
        ),
      );
      for (const key of ['access', 'wheelchair', 'level'])
        if (tags[key]) object.facts!.push(sourced(`entrance.${key}`, tags[key]));
      const parent = buildingNodes.get(e.id);
      if (parent) object.parentId = parent;
    }
    if (add(object)) {
      if (tree) counts.trees++;
      else counts.entrances++;
    }
  }
  diagnostics.omitted = [...omission].map(([reason, count]) => ({ reason, count }));
  if (!timestamp)
    diagnostics.warnings.push(
      'No database snapshot timestamp supplied; acquisition time is recorded separately from element edit dates.',
    );
  if (!counts.entrances)
    diagnostics.warnings.push(
      'No mapped entrances were imported. This does not imply that buildings lack entrances.',
    );
  if (buildings.some((b) => b.part))
    diagnostics.warnings.push(
      'Parent outlines with mapped parts are marked as containers; mapped parts may still be incomplete and require review.',
    );
  if (diagnostics.omitted.length)
    diagnostics.warnings.push('Some mapped features were omitted; review the omission counts.');
  const validation = validateWorld(world);
  if (validation.errors.length)
    throw new Error(
      `OSM conversion produced invalid data: ${validation.errors.slice(0, 3).join(' ')}`,
    );
  return { world, diagnostics };
}
