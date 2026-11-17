import * as THREE from 'three';
import { getObjectBaseElevation, sampleTerrain } from './terrain';
import type { WorldDocument, WorldObject } from './types';

type Point = [number, number];
type Vertex = { x: number; y: number; z: number };

export interface TerrainRenderContext {
  world: WorldDocument;
  enabled: boolean;
  columns: number;
  rows: number;
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  heights: (number | undefined)[];
  validCells: boolean[];
  min: number;
  max: number;
  bottom: number;
}

/** This bounded render grid samples the recorded bilinear field, without vertical exaggeration. */
export function createTerrainContext(
  world: WorldDocument,
  enabled = true,
): TerrainRenderContext | undefined {
  const terrain = world.terrain;
  if (!terrain || !enabled) return undefined;
  const subdivisions = Math.min(
    2,
    Math.max(1, Math.floor(160 / Math.max(terrain.columns - 1, terrain.rows - 1))),
  );
  const columns = Math.min(161, (terrain.columns - 1) * subdivisions + 1);
  const rows = Math.min(161, (terrain.rows - 1) * subdivisions + 1);
  const dx = (terrain.spacing * (terrain.columns - 1)) / (columns - 1);
  const dy = (terrain.spacing * (terrain.rows - 1)) / (rows - 1);
  const heights: (number | undefined)[] = [];
  let min = Infinity,
    max = -Infinity;
  for (let row = 0; row < rows; row += 1)
    for (let column = 0; column < columns; column += 1) {
      const source = sampleTerrain(
        world,
        terrain.origin.x + column * dx,
        terrain.origin.y + row * dy,
      );
      const height = source === undefined ? undefined : source - terrain.referenceElevation;
      heights.push(height);
      if (height !== undefined) {
        min = Math.min(min, height);
        max = Math.max(max, height);
      }
    }
  if (!Number.isFinite(min)) return undefined;
  const validCells: boolean[] = [];
  for (let row = 0; row + 1 < rows; row += 1)
    for (let column = 0; column + 1 < columns; column += 1) {
      const left = terrain.origin.x + column * dx,
        bottom = terrain.origin.y + row * dy;
      const firstColumn = Math.max(
        0,
        Math.floor((left - terrain.origin.x) / terrain.spacing + 1e-8),
      );
      const lastColumn = Math.min(
        terrain.columns - 2,
        Math.ceil((left + dx - terrain.origin.x) / terrain.spacing - 1e-8) - 1,
      );
      const firstRow = Math.max(
        0,
        Math.floor((bottom - terrain.origin.y) / terrain.spacing + 1e-8),
      );
      const lastRow = Math.min(
        terrain.rows - 2,
        Math.ceil((bottom + dy - terrain.origin.y) / terrain.spacing - 1e-8) - 1,
      );
      let covered = true;
      for (let sourceRow = firstRow; sourceRow <= lastRow && covered; sourceRow += 1)
        for (let sourceColumn = firstColumn; sourceColumn <= lastColumn; sourceColumn += 1) {
          const index = sourceRow * terrain.columns + sourceColumn;
          if (
            ![index, index + 1, index + terrain.columns, index + terrain.columns + 1].every(
              (i) => terrain.heights[i] !== null && Number.isFinite(terrain.heights[i]),
            )
          ) {
            covered = false;
            break;
          }
        }
      validCells.push(covered);
    }
  const thickness = Math.max(world.bounds.width, world.bounds.depth) * 0.017;
  return {
    world,
    enabled,
    columns,
    rows,
    x0: terrain.origin.x,
    y0: terrain.origin.y,
    dx,
    dy,
    heights,
    validCells,
    min,
    max,
    bottom: Math.min(-0.92, min - 0.92) - thickness,
  };
}

/** Height of the actual triangles displayed, a close approximation of the source bilinear field. */
export function renderedTerrainHeight(
  context: TerrainRenderContext,
  x: number,
  y: number,
): number | undefined {
  const fx = (x - context.x0) / context.dx,
    fy = (y - context.y0) / context.dy;
  if (fx < -1e-6 || fy < -1e-6 || fx > context.columns - 1 + 1e-6 || fy > context.rows - 1 + 1e-6)
    return undefined;
  const column = Math.min(context.columns - 2, Math.max(0, Math.floor(fx)));
  const row = Math.min(context.rows - 2, Math.max(0, Math.floor(fy)));
  if (!context.validCells[row * (context.columns - 1) + column]) return undefined;
  const u = Math.max(0, Math.min(1, fx - column)),
    v = Math.max(0, Math.min(1, fy - row));
  const sw = context.heights[row * context.columns + column];
  const se = context.heights[row * context.columns + column + 1];
  const nw = context.heights[(row + 1) * context.columns + column];
  const ne = context.heights[(row + 1) * context.columns + column + 1];
  if (sw === undefined || ne === undefined || (u >= v ? se : nw) === undefined) return undefined;
  return u >= v ? sw * (1 - u) + se! * (u - v) + ne * v : sw * (1 - v) + ne * u + nw! * (v - u);
}

function geometry(vertices: number[]): THREE.BufferGeometry {
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  result.computeVertexNormals();
  return result;
}

export function createTerrainGroup(context: TerrainRenderContext): THREE.Group {
  const { world, columns, rows, x0, y0, dx, dy, heights, bottom } = context;
  const group = new THREE.Group();
  group.name = 'Recorded terrain';
  group.userData = {
    terrain: JSON.parse(JSON.stringify(world.terrain)),
    source: world.sources.find((source) => source.id === world.terrain?.sourceId) ?? null,
    verticalExaggeration: 1,
    referenceElevation: world.terrain?.referenceElevation,
    rendering:
      'Triangulated bilinear samples; missing samples remain holes. Cut sides and underside are presentation geometry.',
  };
  const positions: number[] = [],
    indices: number[] = [];
  for (let row = 0; row < rows; row += 1)
    for (let column = 0; column < columns; column += 1) {
      positions.push(
        x0 + column * dx - world.bounds.width / 2,
        heights[row * columns + column] ?? bottom,
        -(y0 + row * dy - world.bounds.depth / 2),
      );
    }
  for (let row = 0; row + 1 < rows; row += 1)
    for (let column = 0; column + 1 < columns; column += 1) {
      if (!context.validCells[row * (columns - 1) + column]) continue;
      const sw = row * columns + column,
        se = sw + 1,
        nw = sw + columns,
        ne = nw + 1;
      if ([sw, se, ne].every((index) => heights[index] !== undefined)) indices.push(sw, se, ne);
      if ([sw, ne, nw].every((index) => heights[index] !== undefined)) indices.push(sw, ne, nw);
    }
  const terrainGeometry = new THREE.BufferGeometry();
  terrainGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  terrainGeometry.setIndex(indices);
  terrainGeometry.computeVertexNormals();
  const terrainMesh = new THREE.Mesh(
    terrainGeometry,
    new THREE.MeshStandardMaterial({ color: '#e3ddca', roughness: 0.96, side: THREE.DoubleSide }),
  );
  terrainMesh.name = 'terrain-surface';
  terrainMesh.userData = {
    renderRole: 'terrain-surface',
    evidence: 'sourced',
    sourceId: world.terrain?.sourceId,
  };
  terrainMesh.receiveShadow = true;
  terrainMesh.castShadow = true;
  group.add(terrainMesh);
  const walls: number[] = [];
  const addWall = (a: number, b: number): void => {
    if (heights[a] === undefined || heights[b] === undefined) return;
    const ax = positions[a * 3],
      az = positions[a * 3 + 2],
      bx = positions[b * 3],
      bz = positions[b * 3 + 2];
    walls.push(
      ax,
      bottom,
      az,
      bx,
      bottom,
      bz,
      bx,
      heights[b]!,
      bz,
      ax,
      bottom,
      az,
      bx,
      heights[b]!,
      bz,
      ax,
      heights[a]!,
      az,
    );
  };
  for (let column = 0; column + 1 < columns; column += 1) {
    addWall(column, column + 1);
    addWall((rows - 1) * columns + column + 1, (rows - 1) * columns + column);
  }
  for (let row = 0; row + 1 < rows; row += 1) {
    addWall((row + 1) * columns, row * columns);
    addWall(row * columns + columns - 1, (row + 1) * columns + columns - 1);
  }
  const wallMesh = new THREE.Mesh(
    geometry(walls),
    new THREE.MeshStandardMaterial({ color: '#b9b39d', roughness: 1, side: THREE.DoubleSide }),
  );
  wallMesh.name = 'terrain-cut-sides';
  wallMesh.userData = { presentationOnly: true };
  wallMesh.castShadow = true;
  wallMesh.receiveShadow = true;
  group.add(wallMesh);
  const underside = new THREE.Mesh(
    new THREE.BoxGeometry((columns - 1) * dx, 0.35, (rows - 1) * dy),
    new THREE.MeshStandardMaterial({ color: '#aaa58f', roughness: 1 }),
  );
  underside.position.set(
    x0 + ((columns - 1) * dx) / 2 - world.bounds.width / 2,
    bottom - 0.175,
    -(y0 + ((rows - 1) * dy) / 2 - world.bounds.depth / 2),
  );
  underside.userData = { presentationOnly: true };
  group.add(underside);
  return group;
}

/** Flat comparison removes a terrain ancestor's displacement from its absolute architectural children. */
export function viewObjectBase(
  world: WorldDocument,
  object: WorldObject,
  terrainEnabled = true,
): number | undefined {
  if (terrainEnabled) return getObjectBaseElevation(world, object);
  if (object.grounding === 'terrain') return object.elevation;
  let parent = object.parentId;
  const visited = new Set<string>();
  while (parent && !visited.has(parent)) {
    visited.add(parent);
    const ancestor = world.objects.find((candidate) => candidate.id === parent);
    if (!ancestor) break;
    if (ancestor.grounding === 'terrain') {
      const base = getObjectBaseElevation(world, ancestor);
      return base === undefined ? object.elevation : object.elevation - (base - ancestor.elevation);
    }
    parent = ancestor.parentId;
  }
  return object.elevation;
}

function clip(points: Point[], nx: number, ny: number, limit: number, positive: boolean): Point[] {
  const result: Point[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    const da = a[0] * nx + a[1] * ny - limit,
      db = b[0] * nx + b[1] * ny - limit;
    const insideA = positive ? da >= -1e-8 : da <= 1e-8,
      insideB = positive ? db >= -1e-8 : db <= 1e-8;
    if (insideA) result.push(a);
    if (insideA !== insideB) {
      const t = da / (da - db);
      result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return result;
}

function pointTransforms(object: WorldObject): {
  toWorld: (vertex: Vertex) => Point;
  toLocal: (point: Point, y: number) => Vertex;
} {
  const angle = THREE.MathUtils.degToRad(object.rotation),
    cos = Math.cos(angle),
    sin = Math.sin(angle);
  return {
    toWorld: (vertex) => [
      object.x + vertex.x * cos + vertex.z * sin,
      object.y + vertex.x * sin - vertex.z * cos,
    ],
    toLocal: (point, y) => ({
      x: (point[0] - object.x) * cos + (point[1] - object.y) * sin,
      y,
      z: (point[0] - object.x) * sin - (point[1] - object.y) * cos,
    }),
  };
}

/** Split horizontal faces at render-grid cell boundaries and diagonals, so overlays never bridge hills. */
function drapeGeometry(
  source: THREE.BufferGeometry,
  object: WorldObject,
  context: TerrainRenderContext,
  groundBase: number,
): THREE.BufferGeometry {
  const transform = pointTransforms(object),
    input = source.index ? source.toNonIndexed() : source;
  const positions = input.getAttribute('position'),
    vertices: number[] = [];
  const emit = (point: Point, originalHeight: number): boolean => {
    const ground = renderedTerrainHeight(context, point[0], point[1]);
    if (ground === undefined) return false;
    const local = transform.toLocal(point, originalHeight + ground - groundBase);
    vertices.push(local.x, local.y, local.z);
    return true;
  };
  for (let index = 0; index < positions.count; index += 3) {
    const triangle: Vertex[] = [0, 1, 2].map((offset) => ({
      x: positions.getX(index + offset),
      y: positions.getY(index + offset),
      z: positions.getZ(index + offset),
    }));
    const world = triangle.map(transform.toWorld);
    const area =
      (world[1][0] - world[0][0]) * (world[2][1] - world[0][1]) -
      (world[1][1] - world[0][1]) * (world[2][0] - world[0][0]);
    const flat =
      Math.max(...triangle.map((vertex) => vertex.y)) -
        Math.min(...triangle.map((vertex) => vertex.y)) <
      1e-5;
    if (flat && Math.abs(area) > 1e-8) {
      const firstColumn = Math.max(
        0,
        Math.floor((Math.min(...world.map((point) => point[0])) - context.x0) / context.dx),
      );
      const lastColumn = Math.min(
        context.columns - 2,
        Math.floor((Math.max(...world.map((point) => point[0])) - context.x0) / context.dx),
      );
      const firstRow = Math.max(
        0,
        Math.floor((Math.min(...world.map((point) => point[1])) - context.y0) / context.dy),
      );
      const lastRow = Math.min(
        context.rows - 2,
        Math.floor((Math.max(...world.map((point) => point[1])) - context.y0) / context.dy),
      );
      for (let row = firstRow; row <= lastRow; row += 1)
        for (let column = firstColumn; column <= lastColumn; column += 1) {
          const x0 = context.x0 + column * context.dx,
            y0 = context.y0 + row * context.dy;
          let piece = clip(world, 1, 0, x0, true);
          piece = clip(piece, 1, 0, x0 + context.dx, false);
          piece = clip(piece, 0, 1, y0, true);
          piece = clip(piece, 0, 1, y0 + context.dy, false);
          if (piece.length < 3) continue;
          for (const positive of [true, false]) {
            const half = clip(
              piece,
              -1 / context.dx,
              1 / context.dy,
              -x0 / context.dx + y0 / context.dy,
              positive,
            );
            for (let p = 1; p + 1 < half.length; p += 1) {
              const points = [half[0], half[p], half[p + 1]];
              if (
                !points.every(
                  (point) => renderedTerrainHeight(context, point[0], point[1]) !== undefined,
                )
              )
                continue;
              points.forEach((point) => emit(point, triangle[0].y));
            }
          }
        }
    } else {
      // Thin extrusion walls also need subdivisions, rather than a single straight sloping edge.
      const pending: { triangle: Vertex[]; depth: number }[] = [{ triangle, depth: 0 }];
      while (pending.length) {
        const current = pending.pop()!;
        const lengths = [0, 1, 2].map((i) =>
          Math.hypot(
            current.triangle[i].x - current.triangle[(i + 1) % 3].x,
            current.triangle[i].z - current.triangle[(i + 1) % 3].z,
          ),
        );
        const longest = lengths.indexOf(Math.max(...lengths));
        if (lengths[longest] > Math.min(context.dx, context.dy) && current.depth < 10) {
          const a = current.triangle[longest],
            b = current.triangle[(longest + 1) % 3],
            c = current.triangle[(longest + 2) % 3];
          const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
          pending.push(
            { triangle: [a, middle, c], depth: current.depth + 1 },
            { triangle: [middle, b, c], depth: current.depth + 1 },
          );
        } else {
          const points = current.triangle.map(transform.toWorld);
          if (
            points.every(
              (point) => renderedTerrainHeight(context, point[0], point[1]) !== undefined,
            )
          )
            points.forEach((point, i) => emit(point, current.triangle[i].y));
        }
      }
    }
  }
  if (input !== source) input.dispose();
  return geometry(vertices);
}

function foundationGeometry(
  object: WorldObject,
  points: Point[],
  context: TerrainRenderContext,
  base: number,
): THREE.BufferGeometry | undefined {
  const transform = pointTransforms(object),
    vertices: number[] = [];
  const terrainAt = (point: Point): number | undefined => {
    const world = transform.toWorld({ x: point[0], y: 0, z: -point[1] });
    return renderedTerrainHeight(context, world[0], world[1]);
  };
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    const segments = Math.min(
      256,
      Math.max(
        1,
        Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / Math.min(context.dx, context.dy)),
      ),
    );
    for (let segment = 0; segment < segments; segment += 1) {
      const p: Point = [
        a[0] + ((b[0] - a[0]) * segment) / segments,
        a[1] + ((b[1] - a[1]) * segment) / segments,
      ];
      const q: Point = [
        a[0] + ((b[0] - a[0]) * (segment + 1)) / segments,
        a[1] + ((b[1] - a[1]) * (segment + 1)) / segments,
      ];
      const groundP = terrainAt(p),
        groundQ = terrainAt(q);
      if (groundP === undefined || groundQ === undefined) continue;
      const yp = Math.min(0, groundP - base),
        yq = Math.min(0, groundQ - base);
      if (yp >= -0.005 && yq >= -0.005) continue;
      vertices.push(
        p[0],
        yp,
        -p[1],
        q[0],
        yq,
        -q[1],
        q[0],
        0,
        -q[1],
        p[0],
        yp,
        -p[1],
        q[0],
        0,
        -q[1],
        p[0],
        0,
        -p[1],
      );
    }
  }
  return vertices.length ? geometry(vertices) : undefined;
}

/** The engine owns the level base; this adapter only drapes surfaces and fills inferred foundations. */
export function applyTerrainToObject(
  group: THREE.Group,
  object: WorldObject,
  points: Point[],
  context: TerrainRenderContext,
  base: number,
  solidBuilding: boolean,
): void {
  const crosswalk = object.facts?.some(
    (fact) =>
      fact.key === 'fixture.type' && fact.value === 'crosswalk' && fact.evidence !== 'unknown',
  );
  const draped =
    !object.geometry &&
    object.grounding === 'terrain' &&
    (['road', 'pavement', 'grass'].includes(object.kind) || crosswalk);
  group.userData.grounding = {
    mode: object.grounding ?? 'absolute',
    anchor: object.terrainAnchor ?? 'center',
    baseElevation: base,
    verticalExaggeration: 1,
    surface: draped ? 'draped to terrain triangles' : 'upright at shared engine base',
  };
  if (draped) {
    group.children.forEach((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const original = child.geometry;
      child.geometry = drapeGeometry(original, object, context, base - object.elevation);
      original.dispose();
    });
  } else if (solidBuilding) {
    const foundation = foundationGeometry(object, points, context, base + object.layer * 0.018);
    if (foundation) {
      const mesh = new THREE.Mesh(
        foundation,
        new THREE.MeshStandardMaterial({ color: '#bdb59f', roughness: 1, side: THREE.DoubleSide }),
      );
      mesh.name = 'terrain-foundation';
      mesh.userData = {
        renderRole: 'terrain-foundation',
        detailEvidence: 'inferred',
        detailNote:
          'Vertical foundation fills from the level recorded anchor to sampled terrain; this is not a measured basement or foundation.',
      };
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
}
