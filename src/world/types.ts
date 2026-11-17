export const CURRENT_WORLD_VERSION = '0.8' as const;
export type ObjectKind =
  'grass' | 'pavement' | 'road' | 'building' | 'water' | 'tree' | 'landmark' | 'fixture';
export type Evidence = 'observed' | 'inferred' | 'authored';
export interface WorldFact {
  key: string;
  value: string | number | boolean | null;
  unit?: string;
  evidence: Evidence | 'sourced' | 'unknown';
  sourceIds?: string[];
  note?: string;
}
export interface ObjectReference {
  sourceId: string;
  role: 'photo' | 'map' | 'history' | 'dataset' | 'inspiration';
  view?: string;
  note?: string;
}
export type GeometryPrimitive = 'box' | 'cylinder' | 'cone' | 'sphere' | 'extruded-polygon';
export interface GeometryPart {
  id: string;
  label: string;
  primitive: GeometryPrimitive;
  /** Normalized east/up/north centre. */
  position: [number, number, number];
  /** Coordinate rotations applied X, then Y, then Z, in degrees. */
  rotation: [number, number, number];
  /** Fractions of the object's width/height/depth, before part rotation. */
  dimensions: [number, number, number];
  color: string;
  /** Normalized part-local east/north outline; required only for extruded-polygon. */
  footprint: [number, number][] | null;
}
export interface GeometryRecipe {
  type: 'parts';
  version: 1;
  space: 'normalized-object';
  evidence: 'authored';
  parts: GeometryPart[];
}
export interface WorldObject {
  id: string;
  label: string;
  kind: ObjectKind;
  description: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  height: number;
  elevation: number;
  /** Absolute local base by default; terrain mode treats elevation as a ground offset. */
  grounding?: 'absolute' | 'terrain';
  terrainAnchor?: 'center' | 'highest-footprint';
  /** Derived atlas resampling compensation for grounded solids; excluded from flat comparison. */
  terrainCorrection?: number;
  rotation: number;
  layer: number;
  evidence: Evidence;
  sourceId?: string;
  /** Optional local footprint in metres, centered on x/y; rotation applies. */
  footprint?: [number, number][];
  tags?: string[];
  /** Parent container. Placements remain in absolute world metres. */
  parentId?: string;
  facts?: WorldFact[];
  references?: ObjectReference[];
  geometry?: GeometryRecipe;
}
export interface WorldTerrain {
  type: 'height-grid';
  /** Explicit provenance class; absent legacy terrain is never assumed authored. */
  evidence?: 'authored' | 'sourced';
  columns: number;
  rows: number;
  spacing: number;
  origin: { x: number; y: number };
  /** Row-major absolute datum heights: west to east, then south to north. Null is no data. */
  heights: (number | null)[];
  verticalDatum: string;
  referenceElevation: number;
  sourceId: string;
  /** Native DEM resolution, omitted in 0.5 when unknown. Never substitute served raster pitch. */
  sourceResolution?: number;
  /** Ground pixel pitch of the served elevation raster, distinct from grid spacing. */
  sampledResolution?: number;
  interpolation: 'bilinear';
  verticalAccuracy?: number;
  acquired?: { start: string; end: string };
  notes?: string;
}
export interface WorldSource {
  id: string;
  title: string;
  url: string;
  attribution: string;
  accessed: string;
  notes: string;
}
export interface GeographicBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}
export interface WorldAerial {
  type: 'online-imagery';
  provider: 'usgs-imagery';
  /** Geographic extent corresponding to the complete local world rectangle, in Web Mercator. */
  bounds: GeographicBounds;
  sourceId: string;
}
export interface WorldComposition {
  type: 'survey-atlas';
  tiles: {
    id: string;
    name: string;
    description: string;
    seed: number;
    bounds: GeographicBounds;
    sourceIds: string[];
  }[];
}
export interface WorldDocument {
  format: 'wordscape';
  version: '0.1' | '0.2' | '0.3' | '0.4' | '0.5' | '0.6' | '0.7' | '0.8';
  name: string;
  description: string;
  units: 'metres';
  bounds: { width: number; depth: number };
  origin: { latitude: number; longitude: number; note: string };
  seed: number;
  sources: WorldSource[];
  terrain?: WorldTerrain;
  aerial?: WorldAerial;
  composition?: WorldComposition;
  /** Authored local fiction, never a geographic survey at the numeric origin placeholder. */
  imaginary?: { brief: string; guideVersion: string };
  objects: WorldObject[];
  relations: {
    from: string;
    to: string;
    type: 'near' | 'within' | 'connects' | 'overlaps';
    note?: string;
  }[];
}
export const KIND_COLORS: Record<ObjectKind, string> = {
  grass: '#b4c89b',
  pavement: '#ddd4c1',
  road: '#a8aeb1',
  building: '#d8b89c',
  water: '#89bec8',
  tree: '#638a62',
  landmark: '#d5a756',
  fixture: '#8b8271',
};
export const KIND_LABELS: Record<ObjectKind, string> = {
  grass: 'Green space',
  pavement: 'Path / plaza',
  road: 'Street',
  building: 'Building',
  water: 'Water',
  tree: 'Tree',
  landmark: 'Landmark',
  fixture: 'Street furniture',
};
