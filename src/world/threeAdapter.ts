import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { KIND_COLORS, type ObjectKind, type WorldDocument, type WorldObject } from './types';
import { addGeometryRecipe } from './threeRecipe';
import { validateGeometryRecipe } from './geometryRecipe';
import {
  applyTerrainToObject,
  createTerrainContext,
  createTerrainGroup,
  viewObjectBase,
} from './threeTerrain';

type Point = [number, number];
const ALL_KINDS = Object.keys(KIND_COLORS) as ObjectKind[];
const UP = new THREE.Vector3(0, 1, 0);
const MAX_LEVELS = 16;
const MAX_WINDOWS = 512;

function variation(seed: number, id: string): number {
  let hash = seed | 0;
  for (let i = 0; i < id.length; i += 1) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return (hash >>> 0) / 4294967295;
}
function knownFact(object: WorldObject, key: string): string | number | boolean | undefined {
  const fact = object.facts?.find((candidate) => candidate.key === key);
  return fact && fact.evidence !== 'unknown' && fact.value !== null ? fact.value : undefined;
}
function textFact(object: WorldObject, key: string): string {
  const value = knownFact(object, key);
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}
function numberFact(object: WorldObject, key: string): number | undefined {
  const value = knownFact(object, key);
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function colorFact(object: WorldObject, key: string, fallback: string): string {
  const value = textFact(object, key);
  const palette: Record<string, string> = {
    white: '#e8e3d3',
    cream: '#e4d3b7',
    beige: '#ccb697',
    tan: '#baa68e',
    brick: '#ad7661',
    red: '#a96956',
    terracotta: '#b8795b',
    gray: '#a6a69d',
    grey: '#a6a69d',
    brown: '#987653',
    green: '#6c8c67',
    bronze: '#777d65',
    black: '#4e5753',
    concrete: '#b6b4a7',
    stone: '#c9c0a9',
  };
  return /^#[0-9a-f]{6}$/.test(value) ? value : (palette[value] ?? fallback);
}
function footprint(object: WorldObject): Point[] {
  const points: Point[] =
    object.footprint && object.footprint.length >= 3
      ? object.footprint
      : [
          [-object.width / 2, -object.depth / 2],
          [object.width / 2, -object.depth / 2],
          [object.width / 2, object.depth / 2],
          [-object.width / 2, object.depth / 2],
        ];
  const area = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0);
  return area < 0 ? [...points].reverse() : points;
}
function prism(points: Point[], height: number): THREE.ExtrudeGeometry {
  const geometry = new THREE.ExtrudeGeometry(
    new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y))),
    {
      depth: Math.max(height, 0.001),
      bevelEnabled: false,
    },
  );
  return geometry.rotateX(-Math.PI / 2);
}
function triangles(vertices: number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}
function clipPolygon(points: Point[], normal: Point, limit: number, positive: boolean): Point[] {
  const result: Point[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    const da = a[0] * normal[0] + a[1] * normal[1] - limit;
    const db = b[0] * normal[0] + b[1] * normal[1] - limit;
    const insideA = positive ? da >= -1e-8 : da <= 1e-8;
    const insideB = positive ? db >= -1e-8 : db <= 1e-8;
    if (insideA) result.push(a);
    if (insideA !== insideB) {
      const t = da / (da - db);
      result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return result;
}
function insidePolygon(point: Point, points: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i],
      b = points[j];
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
function axisFor(points: Point[]): {
  along: Point;
  across: Point;
  min: number;
  max: number;
  sideMin: number;
  sideMax: number;
} {
  let best = 0;
  let along: Point = [1, 0];
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length > best) {
      best = length;
      along = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
    }
  }
  const across: Point = [-along[1], along[0]];
  const longitudinal = points.map(([x, y]) => x * along[0] + y * along[1]);
  const lateral = points.map(([x, y]) => x * across[0] + y * across[1]);
  return {
    along,
    across,
    min: Math.min(...longitudinal),
    max: Math.max(...longitudinal),
    sideMin: Math.min(...lateral),
    sideMax: Math.max(...lateral),
  };
}

/** Triangulated roof patches remain inside the traced polygon, including concave parcels. */
function roofGeometry(
  points: Point[],
  base: number,
  top: number,
  shape: string,
): THREE.BufferGeometry {
  const axis = axisFor(points);
  const alongMid = (axis.min + axis.max) / 2,
    acrossMid = (axis.sideMin + axis.sideMax) / 2;
  const halfLength = Math.max((axis.max - axis.min) / 2, 0.01),
    halfWidth = Math.max((axis.sideMax - axis.sideMin) / 2, 0.01);
  const lines: { normal: Point; limit: number }[] = [{ normal: axis.across, limit: acrossMid }];
  if (shape !== 'gabled') {
    lines.push({ normal: axis.along, limit: alongMid });
    for (const sign of [-1, 1])
      lines.push({
        normal: [
          axis.along[0] / halfLength + (sign * axis.across[0]) / halfWidth,
          axis.along[1] / halfLength + (sign * axis.across[1]) / halfWidth,
        ],
        limit: alongMid / halfLength + (sign * acrossMid) / halfWidth,
      });
  }
  const roofY = ([x, y]: Point): number => {
    const acrossHeight =
      1 - Math.abs((x * axis.across[0] + y * axis.across[1] - acrossMid) / halfWidth);
    const alongHeight =
      1 - Math.abs((x * axis.along[0] + y * axis.along[1] - alongMid) / halfLength);
    return (
      base +
      (top - base) *
        Math.max(
          0,
          Math.min(1, shape === 'gabled' ? acrossHeight : Math.min(acrossHeight, alongHeight)),
        )
    );
  };
  const vertices: number[] = [];
  for (const indices of THREE.ShapeUtils.triangulateShape(
    points.map(([x, y]) => new THREE.Vector2(x, y)),
    [],
  )) {
    let pieces: Point[][] = [indices.map((index) => points[index])];
    for (const line of lines)
      pieces = pieces
        .flatMap((piece) => [
          clipPolygon(piece, line.normal, line.limit, true),
          clipPolygon(piece, line.normal, line.limit, false),
        ])
        .filter((piece) => piece.length >= 3);
    for (const piece of pieces)
      for (let i = 1; i + 1 < piece.length; i += 1) {
        const triangle = [piece[0], piece[i], piece[i + 1]];
        const cross =
          (triangle[1][0] - triangle[0][0]) * (triangle[2][1] - triangle[0][1]) -
          (triangle[1][1] - triangle[0][1]) * (triangle[2][0] - triangle[0][0]);
        if (cross < 0) triangle.reverse();
        triangle.forEach((point) => vertices.push(point[0], roofY(point), -point[1]));
      }
  }
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i],
      b = points[(i + 1) % points.length],
      ts = [0, 1];
    for (const line of lines) {
      const da = a[0] * line.normal[0] + a[1] * line.normal[1] - line.limit;
      const db = b[0] * line.normal[0] + b[1] * line.normal[1] - line.limit;
      if (da * db < 0) ts.push(da / (da - db));
    }
    ts.sort((x, y) => x - y);
    for (let j = 0; j + 1 < ts.length; j += 1) {
      const p: Point = [a[0] + (b[0] - a[0]) * ts[j], a[1] + (b[1] - a[1]) * ts[j]];
      const q: Point = [a[0] + (b[0] - a[0]) * ts[j + 1], a[1] + (b[1] - a[1]) * ts[j + 1]];
      vertices.push(
        p[0],
        base,
        -p[1],
        q[0],
        base,
        -q[1],
        q[0],
        roofY(q),
        -q[1],
        p[0],
        base,
        -p[1],
        q[0],
        roofY(q),
        -q[1],
        p[0],
        roofY(p),
        -p[1],
      );
    }
  }
  return triangles(vertices);
}

interface Painter {
  group: THREE.Group;
  mesh: (
    role: string,
    geometry: THREE.BufferGeometry,
    color: string,
    x?: number,
    y?: number,
    z?: number,
    surface?: boolean,
  ) => THREE.Mesh;
  box: (
    role: string,
    width: number,
    height: number,
    depth: number,
    color: string,
    x?: number,
    y?: number,
    z?: number,
  ) => THREE.Mesh;
}
function facadeQuad(
  output: number[],
  a: Point,
  b: Point,
  start: number,
  end: number,
  bottom: number,
  top: number,
): void {
  const p: Point = [a[0] + (b[0] - a[0]) * start, a[1] + (b[1] - a[1]) * start];
  const q: Point = [a[0] + (b[0] - a[0]) * end, a[1] + (b[1] - a[1]) * end];
  output.push(
    p[0],
    bottom,
    -p[1],
    q[0],
    bottom,
    -q[1],
    q[0],
    top,
    -q[1],
    p[0],
    bottom,
    -p[1],
    q[0],
    top,
    -q[1],
    p[0],
    top,
    -p[1],
  );
}
function facadeShape(
  painter: Painter,
  role: string,
  geometry: THREE.BufferGeometry,
  a: Point,
  b: Point,
  t: number,
  y: number,
  color: string,
): THREE.Mesh {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const tangent = new THREE.Vector3((b[0] - a[0]) / length, 0, -(b[1] - a[1]) / length);
  geometry.applyMatrix4(new THREE.Matrix4().makeBasis(tangent, UP, tangent.clone().cross(UP)));
  return painter.mesh(
    role,
    geometry,
    color,
    a[0] + (b[0] - a[0]) * t,
    y,
    -(a[1] + (b[1] - a[1]) * t),
    true,
  );
}
function arch(width: number, height: number): THREE.ShapeGeometry {
  const radius = Math.min(width / 2, height * 0.45),
    shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(width / 2, height - radius);
  for (let i = 0; i <= 12; i += 1) {
    const angle = (i * Math.PI) / 12;
    shape.lineTo((Math.cos(angle) * width) / 2, height - radius + Math.sin(angle) * radius);
  }
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

function churchFacade(
  painter: Painter,
  object: WorldObject,
  points: Point[],
  bodyHeight: number,
  tower: boolean,
): void {
  const bands: number[] = [];
  for (let edge = 0; edge < points.length; edge += 1) {
    const a = points[edge],
      b = points[(edge + 1) % points.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (tower) {
      for (const t of [0.33, 0.67]) {
        facadeShape(
          painter,
          'belfry-surround',
          arch(length * 0.23, bodyHeight * 0.2),
          a,
          b,
          t,
          bodyHeight * 0.7,
          '#e4d5b8',
        );
        facadeShape(
          painter,
          'belfry-opening',
          arch(length * 0.16, bodyHeight * 0.16),
          a,
          b,
          t,
          bodyHeight * 0.715,
          '#626d64',
        );
      }
      facadeShape(
        painter,
        'tower-arch',
        arch(length * 0.2, bodyHeight * 0.14),
        a,
        b,
        0.5,
        bodyHeight * 0.4,
        '#a8ad9c',
      );
      for (const h of [0.32, 0.65, 0.94])
        facadeQuad(bands, a, b, 0.02, 0.98, bodyHeight * h, bodyHeight * (h + 0.025));
    } else facadeQuad(bands, a, b, 0.01, 0.99, bodyHeight * 0.91, bodyHeight * 0.96);
  }
  if (bands.length) painter.mesh('church-stone-bands', triangles(bands), '#d2c4a9', 0, 0, 0, true);
  if (tower) return;
  let winding = 0;
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length];
    winding += a[0] * b[1] - b[0] * a[1];
  });
  const bearing = THREE.MathUtils.degToRad(
    (numberFact(object, 'building.frontBearing') ?? 180) + object.rotation,
  );
  const desired: Point = [Math.sin(bearing), Math.cos(bearing)];
  let chosen = 0,
    best = -Infinity;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      length = Math.hypot(dx, dy);
    const score = ((winding > 0 ? 1 : -1) * (dy * desired[0] - dx * desired[1])) / length;
    if (score > best) {
      chosen = i;
      best = score;
    }
  }
  const a = points[chosen],
    b = points[(chosen + 1) % points.length];
  const width = Math.hypot(b[0] - a[0], b[1] - a[1]);
  for (const t of [0.23, 0.5, 0.77]) {
    const portalWidth = width * (t === 0.5 ? 0.18 : 0.145),
      portalHeight = bodyHeight * (t === 0.5 ? 0.38 : 0.3);
    facadeShape(
      painter,
      'portal-surround',
      arch(portalWidth * 1.24, portalHeight * 1.08),
      a,
      b,
      t,
      0.03,
      '#d4c5a7',
    );
    facadeShape(
      painter,
      'church-portal',
      arch(portalWidth, portalHeight),
      a,
      b,
      t,
      0.03,
      '#7b7665',
    );
  }
  const radius = Math.min(width * 0.105, bodyHeight * 0.19);
  facadeShape(
    painter,
    'rose-window',
    new THREE.CircleGeometry(radius, 32),
    a,
    b,
    0.5,
    bodyHeight * 0.68,
    '#708d8b',
  );
  facadeShape(
    painter,
    'rose-stone-ring',
    new THREE.RingGeometry(radius * 0.78, radius, 32),
    a,
    b,
    0.5,
    bodyHeight * 0.68,
    '#eadfc8',
  );
  for (let i = 0; i < 8; i += 1) {
    const spoke = new THREE.PlaneGeometry(radius * 1.48, radius * 0.065);
    spoke.rotateZ((i * Math.PI) / 8);
    facadeShape(painter, 'rose-tracery', spoke, a, b, 0.5, bodyHeight * 0.68, '#ded4bc');
  }
}
function drawBuilding(
  painter: Painter,
  object: WorldObject,
  points: Point[],
  height: number,
): void {
  const facade = textFact(object, 'building.facade');
  const church =
    facade === 'front-church' ||
    facade === 'church-tower' ||
    object.tags?.includes('church') === true;
  const tower = facade === 'church-tower' || object.tags?.includes('tower') === true;
  const material = textFact(object, 'building.material');
  const materialColors: Record<string, string> = {
    brick: '#b9816e',
    stucco: '#d8c6ae',
    stone: '#cfccb9',
    wood: '#beaf98',
    concrete: '#b8b8ae',
  };
  const bodyColor = colorFact(
    object,
    'building.color',
    church ? '#e8dfca' : (materialColors[material] ?? '#c7c1b4'),
  );
  let roofShape =
    textFact(object, 'building.roofShape') || (church ? (tower ? 'spire' : 'gabled') : 'flat');
  if (!['gabled', 'hipped', 'pyramidal', 'spire', 'flat'].includes(roofShape) || points.length > 64)
    roofShape = 'flat';
  const roofRise =
    roofShape === 'flat'
      ? Math.min(0.25, height * 0.06)
      : Math.min(
          height * (tower ? 0.19 : 0.24),
          Math.min(object.width, object.depth) * (tower ? 1.4 : 0.4),
        );
  const crossHeight = church && tower ? height * 0.04 : 0,
    roofTop = height - crossHeight;
  const bodyHeight = Math.max(height * 0.3, roofTop - roofRise);
  painter.mesh('building-body', prism(points, bodyHeight), bodyColor);
  const roofColor = colorFact(
    object,
    'building.roofColor',
    church ? '#c6b797' : roofShape === 'flat' ? '#aaa89a' : '#ad8066',
  );
  if (roofShape === 'flat')
    painter.mesh('roof', prism(points, height - bodyHeight), roofColor, 0, bodyHeight, 0);
  else painter.mesh('roof', roofGeometry(points, bodyHeight, roofTop, roofShape), roofColor);
  painter.group.userData.rendering = {
    roofShape,
    facade: church ? (tower ? 'church-tower' : 'front-church') : 'neutral',
    material: material || 'unspecified',
  };
  if (church) {
    churchFacade(painter, object, points, bodyHeight, tower);
    if (tower) {
      painter.box(
        'spire-cross',
        Math.min(object.width * 0.035, 0.3),
        crossHeight,
        Math.min(object.depth * 0.035, 0.3),
        '#8e7c5f',
        0,
        roofTop + crossHeight / 2,
        0,
      );
      painter.box(
        'spire-crossbar',
        object.width * 0.2,
        Math.min(crossHeight * 0.14, 0.28),
        Math.min(object.depth * 0.035, 0.3),
        '#8e7c5f',
        0,
        roofTop + crossHeight * 0.66,
        0,
      );
    }
    return;
  }
  const levels = numberFact(object, 'building.levels');
  const floors =
    levels === undefined || levels <= 0 ? 0 : Math.min(MAX_LEVELS, Math.max(1, Math.round(levels)));
  painter.group.userData.rendering.levels = floors || null;
  painter.group.userData.rendering.detailCapped = levels !== undefined && levels > MAX_LEVELS;
  const panes: number[] = [],
    surrounds: number[] = [],
    bands: number[] = [];
  let windowCount = 0;
  for (let floor = 0; floor < floors; floor += 1) {
    const storey = bodyHeight / floors,
      y = storey * (floor + 0.54),
      windowHeight = Math.min(storey * 0.47, 2.2);
    for (let edge = 0; edge < Math.min(points.length, 64); edge += 1) {
      const a = points[edge],
        b = points[(edge + 1) % points.length];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]),
        columns = Math.min(8, Math.max(1, Math.floor(length / 3.4)));
      if (length < 1.6) continue;
      for (let column = 0; column < columns && windowCount < MAX_WINDOWS; column += 1) {
        const center = (column + 0.5) / columns,
          halfWidth = Math.min(0.28 / columns, 0.9 / length);
        facadeQuad(
          surrounds,
          a,
          b,
          center - halfWidth * 1.15,
          center + halfWidth * 1.15,
          y - windowHeight * 0.58,
          y + windowHeight * 0.58,
        );
        facadeQuad(
          panes,
          a,
          b,
          center - halfWidth,
          center + halfWidth,
          y - windowHeight / 2,
          y + windowHeight / 2,
        );
        windowCount += 1;
      }
      facadeQuad(bands, a, b, 0.015, 0.985, storey * (floor + 0.96), storey * (floor + 0.985));
    }
  }
  if (panes.length) {
    painter.mesh('window-surrounds', triangles(surrounds), '#e4dcca', 0, 0, 0, true);
    painter.mesh('windows', triangles(panes), '#738886', 0, 0, 0, true);
    painter.mesh('floor-bands', triangles(bands), '#b6ab95', 0, 0, 0, true);
  }
}

function drawTree(painter: Painter, object: WorldObject, height: number, seed: number): void {
  const species = textFact(object, 'tree.species');
  let form = textFact(object, 'tree.form');
  if (!form)
    form = /populus nigra|lombardy|sempervirens/.test(species)
      ? 'columnar'
      : /palm|phoenix|washingtonia/.test(species)
        ? 'palm'
        : /pinus|pine|cedar|picea/.test(species)
          ? 'conical'
          : /ficus|platanus|oak|quercus|elm/.test(species)
            ? 'spreading'
            : 'rounded';
  if (!['columnar', 'palm', 'conical', 'spreading', 'rounded'].includes(form)) form = 'rounded';
  const variant = variation(seed, object.id);
  const foliage = colorFact(
    object,
    'tree.color',
    form === 'columnar' ? '#7c965d' : form === 'conical' ? '#567862' : '#709365',
  );
  const trunkHeight = height * (form === 'palm' ? 0.88 : form === 'columnar' ? 0.33 : 0.4);
  painter.mesh(
    'tree-trunk',
    new THREE.CylinderGeometry(
      Math.min(object.width, object.depth) * 0.035,
      Math.min(object.width, object.depth) * 0.055,
      trunkHeight,
      8,
    ),
    '#897559',
    0,
    trunkHeight / 2,
    0,
  );
  painter.group.userData.rendering = { treeForm: form, species: species || null };
  if (form === 'palm') {
    for (let leaf = 0; leaf < 9; leaf += 1) {
      const angle = (leaf * Math.PI * 2) / 9 + variant;
      const frond = painter.mesh(
        'palm-frond',
        new THREE.IcosahedronGeometry(1, 1),
        foliage,
        Math.cos(angle) * object.width * 0.13,
        height * 0.91,
        Math.sin(angle) * object.depth * 0.13,
      );
      frond.scale.set(object.width * 0.34, height * 0.055, object.depth * 0.09);
      frond.rotation.y = -angle;
    }
    const bud = painter.mesh(
      'palm-crown',
      new THREE.IcosahedronGeometry(1, 1),
      '#8d9c68',
      0,
      height * 0.94,
      0,
    );
    bud.scale.set(object.width * 0.16, height * 0.06, object.depth * 0.16);
  } else if (form === 'conical') {
    for (let tier = 0; tier < 3; tier += 1) {
      const cone = painter.mesh(
        'conifer-canopy',
        new THREE.ConeGeometry(1, 1, 10),
        foliage,
        0,
        height * (0.43 + tier * 0.19),
        0,
      );
      cone.scale.set(
        object.width * (0.48 - tier * 0.11),
        height * 0.38,
        object.depth * (0.48 - tier * 0.11),
      );
    }
  } else if (form === 'columnar') {
    const crown = painter.mesh(
      'columnar-canopy',
      new THREE.SphereGeometry(1, 10, 9),
      foliage,
      0,
      height * 0.59,
      0,
    );
    crown.scale.set(object.width * 0.43, height * 0.41, object.depth * 0.43);
    const tip = painter.mesh(
      'columnar-tip',
      new THREE.ConeGeometry(1, 1, 10),
      foliage,
      0,
      height * 0.87,
      0,
    );
    tip.scale.set(object.width * 0.24, height * 0.26, object.depth * 0.24);
  } else {
    const spreading = form === 'spreading';
    for (let clump = 0; clump < 5; clump += 1) {
      const angle = (clump * Math.PI * 2) / 5 + variant * 2,
        radius = clump ? 0.19 : 0;
      const crown = painter.mesh(
        'broadleaf-canopy',
        new THREE.IcosahedronGeometry(1, 2),
        clump === 3 ? '#829e6c' : foliage,
        Math.cos(angle) * object.width * radius,
        height * (clump ? 0.65 : 0.73),
        Math.sin(angle) * object.depth * radius,
      );
      crown.scale.set(
        object.width * (spreading ? 0.31 : 0.29),
        height * (spreading ? 0.22 : 0.27),
        object.depth * (spreading ? 0.31 : 0.29),
      );
    }
  }
}

function drawFixture(painter: Painter, object: WorldObject, points: Point[], height: number): void {
  const type = textFact(object, 'fixture.type'),
    width = object.width,
    depth = object.depth;
  const color = colorFact(
    object,
    'fixture.color',
    textFact(object, 'fixture.material') === 'metal' ? '#626e65' : '#a18c6c',
  );
  painter.group.userData.rendering = { fixtureType: type || 'unspecified' };
  if (type === 'bench') {
    painter.box(
      'bench-seat',
      width * 0.96,
      height * 0.12,
      depth * 0.76,
      color,
      0,
      height * 0.48,
      0,
    );
    painter.box(
      'bench-back',
      width * 0.96,
      height * 0.42,
      depth * 0.1,
      color,
      0,
      height * 0.79,
      depth * 0.35,
    );
    for (const x of [-0.34, 0.34]) {
      painter.box(
        'bench-leg',
        width * 0.055,
        height * 0.42,
        depth * 0.12,
        '#657066',
        x * width,
        height * 0.21,
        -depth * 0.23,
      );
      painter.box(
        'bench-leg',
        width * 0.055,
        height * 0.42,
        depth * 0.12,
        '#657066',
        x * width,
        height * 0.21,
        depth * 0.24,
      );
      painter.box(
        'bench-arm',
        width * 0.055,
        height * 0.07,
        depth * 0.82,
        '#657066',
        x * width,
        height * 0.65,
        0,
      );
    }
  } else if (type === 'lamp' || type === 'street-lamp') {
    painter.mesh(
      'lamp-post',
      new THREE.CylinderGeometry(
        Math.min(width, depth) * 0.055,
        Math.min(width, depth) * 0.095,
        height * 0.85,
        8,
      ),
      '#5c6c62',
      0,
      height * 0.425,
      0,
    );
    painter.box(
      'lamp-lantern',
      width * 0.64,
      height * 0.12,
      depth * 0.64,
      '#eee4b7',
      0,
      height * 0.87,
      0,
    );
    const cap = painter.mesh(
      'lamp-cap',
      new THREE.ConeGeometry(1, 1, 4),
      '#5c6c62',
      0,
      height * 0.965,
      0,
    );
    cap.scale.set(width * 0.5, height * 0.07, depth * 0.5);
    cap.rotation.y = Math.PI / 4;
  } else if (type === 'bollard') {
    painter.mesh(
      'bollard',
      new THREE.CylinderGeometry(
        Math.min(width, depth) * 0.4,
        Math.min(width, depth) * 0.44,
        height * 0.9,
        12,
      ),
      color,
      0,
      height * 0.45,
      0,
    );
    const cap = painter.mesh(
      'bollard-cap',
      new THREE.SphereGeometry(1, 12, 6),
      color,
      0,
      height * 0.9,
      0,
    );
    cap.scale.set(width * 0.4, height * 0.1, depth * 0.4);
  } else if (type === 'statue' || type === 'monument') {
    const materialName = textFact(object, 'fixture.material');
    const figureColor = colorFact(
      object,
      'fixture.color',
      /bronze/.test(materialName)
        ? '#7b8068'
        : /metal|zinc/.test(materialName)
          ? '#87918d'
          : '#9b9a8a',
    );
    let baseHeight = Math.min(
      height * 0.95,
      Math.max(height * 0.05, numberFact(object, 'fixture.baseHeight') ?? height * 0.48),
    );
    let figureHeight = Math.max(
      height * 0.05,
      numberFact(object, 'fixture.figureHeight') ?? height - baseHeight,
    );
    const fit = Math.min(1, height / (baseHeight + figureHeight));
    baseHeight *= fit;
    figureHeight *= fit;
    painter.group.userData.rendering.baseHeight = baseHeight;
    painter.group.userData.rendering.figureHeight = figureHeight;
    painter.box(
      'statue-plinth',
      width,
      baseHeight * 0.16,
      depth,
      '#bbb8a9',
      0,
      baseHeight * 0.08,
      0,
    );
    painter.box(
      'statue-pedestal',
      width * 0.76,
      baseHeight * 0.74,
      depth * 0.76,
      '#cfccbc',
      0,
      baseHeight * 0.53,
      0,
    );
    painter.box(
      'statue-pedestal-cap',
      width * 0.88,
      baseHeight * 0.1,
      depth * 0.88,
      '#dfdbc8',
      0,
      baseHeight * 0.95,
      0,
    );
    painter.mesh(
      'statue-coat',
      new THREE.CylinderGeometry(width * 0.18, width * 0.29, figureHeight * 0.66, 8),
      figureColor,
      0,
      baseHeight + figureHeight * 0.34,
      0,
    );
    const head = painter.mesh(
      'statue-head',
      new THREE.IcosahedronGeometry(1, 2),
      figureColor,
      0,
      baseHeight + figureHeight * 0.855,
      0,
    );
    head.scale.set(width * 0.19, figureHeight * 0.145, depth * 0.2);
    for (const side of [-1, 1]) {
      const arm = painter.box(
        'statue-arm',
        width * 0.13,
        figureHeight * 0.44,
        depth * 0.16,
        figureColor,
        width * side * 0.24,
        baseHeight + figureHeight * 0.46,
        0,
      );
      arm.rotation.z = side * 0.18;
    }
  } else if (type === 'playground' || type === 'play-structure') {
    for (const x of [-0.22, 0.22])
      for (const z of [-0.23, 0.23])
        painter.box(
          'playground-post',
          width * 0.045,
          height * 0.66,
          depth * 0.05,
          '#8d8967',
          x * width,
          height * 0.33,
          z * depth,
        );
    painter.box(
      'playground-platform',
      width * 0.52,
      height * 0.07,
      depth * 0.54,
      '#cbac6b',
      0,
      height * 0.38,
      0,
    );
    const roof = painter.mesh(
      'playground-roof',
      new THREE.ConeGeometry(1, 1, 4),
      '#9aa67d',
      0,
      height * 0.83,
      0,
    );
    roof.scale.set(width * 0.4, height * 0.34, depth * 0.4);
    roof.rotation.y = Math.PI / 4;
    const slide = painter.box(
      'playground-slide',
      width * 0.18,
      height * 0.035,
      depth * 0.6,
      '#92aca7',
      0,
      height * 0.23,
      -depth * 0.22,
    );
    slide.rotation.x = -0.5;
  } else if (type === 'crosswalk') {
    const axis = axisFor(points),
      extent = axis.max - axis.min;
    const count = Math.min(28, Math.max(2, Math.floor(extent / 0.8))),
      vertices: number[] = [];
    const baseTriangles = THREE.ShapeUtils.triangulateShape(
      points.map(([x, y]) => new THREE.Vector2(x, y)),
      [],
    );
    for (let stripe = 0; stripe < count; stripe += 1) {
      const start = axis.min + (extent * (stripe + 0.15)) / count,
        end = axis.min + (extent * (stripe + 0.7)) / count;
      for (const triangle of baseTriangles) {
        let piece = clipPolygon(
          triangle.map((i) => points[i]),
          axis.along,
          start,
          true,
        );
        piece = clipPolygon(piece, axis.along, end, false);
        for (let i = 1; i + 1 < piece.length; i += 1)
          for (const point of [piece[0], piece[i], piece[i + 1]])
            vertices.push(point[0], height, -point[1]);
      }
    }
    painter.mesh('crosswalk-stripes', triangles(vertices), '#eee9d9', 0, 0, 0, true);
  } else if (type === 'fountain') {
    const radius = Math.min(width, depth) * 0.48;
    painter.mesh(
      'fountain-basin',
      new THREE.CylinderGeometry(radius, radius * 0.92, height * 0.3, 24),
      '#c4bfa9',
      0,
      height * 0.15,
      0,
    );
    painter.mesh(
      'fountain-water',
      new THREE.CylinderGeometry(radius * 0.84, radius * 0.84, height * 0.025, 24),
      '#83b2b7',
      0,
      height * 0.31,
      0,
    );
    painter.mesh(
      'fountain-pedestal',
      new THREE.CylinderGeometry(radius * 0.11, radius * 0.19, height * 0.65, 10),
      '#b0b39f',
      0,
      height * 0.675,
      0,
    );
  } else painter.mesh('neutral-fixture', prism(points, height), '#a6a397');
}

function drawRoad(painter: Painter, object: WorldObject, points: Point[], height: number): void {
  const direction = textFact(object, 'road.direction'),
    rawLanes = numberFact(object, 'road.lanes');
  const lanes = rawLanes === undefined ? 0 : Math.min(8, Math.max(1, Math.round(rawLanes))),
    axis = axisFor(points);
  const width = axis.sideMax - axis.sideMin,
    middle = (axis.sideMin + axis.sideMax) / 2;
  const vertices: number[] = [],
    arrows: number[] = [];
  const pointAt = (along: number, across: number): Point => [
    axis.along[0] * along + axis.across[0] * across,
    axis.along[1] * along + axis.across[1] * across,
  ];
  const rect = (along: number, across: number, length: number, thickness: number): void => {
    const corners = [
      pointAt(along - length / 2, across - thickness / 2),
      pointAt(along + length / 2, across - thickness / 2),
      pointAt(along + length / 2, across + thickness / 2),
      pointAt(along - length / 2, across + thickness / 2),
    ];
    if (!corners.every((point) => insidePolygon(point, points))) return;
    for (const index of [0, 1, 2, 0, 2, 3])
      vertices.push(corners[index][0], height, -corners[index][1]);
  };
  if (direction === 'two-way')
    for (let dash = 0; dash < 48; dash += 1) {
      const along = axis.min + 6 + dash * 12;
      if (along > axis.max - 6) break;
      rect(along, middle - 0.16, 8, 0.12);
      rect(along, middle + 0.16, 8, 0.12);
    }
  if (lanes > 1)
    for (let lane = 1; lane < lanes; lane += 1) {
      if (direction === 'two-way' && lane === lanes / 2) continue;
      for (let dash = 0; dash < 40; dash += 1) {
        const along = axis.min + 8 + dash * 15;
        if (along > axis.max - 5) break;
        rect(along, axis.sideMin + (width * lane) / lanes, 4.5, 0.13);
      }
    }
  const arrow = (along: number, across: number, sign: number): void => {
    const length = Math.min(6, (axis.max - axis.min) * 0.1),
      half = Math.min(1.15, width * 0.12);
    const local: Point[] = [
      [-length * 0.5, -half * 0.25],
      [length * 0.12, -half * 0.25],
      [length * 0.12, -half],
      [length * 0.5, 0],
      [length * 0.12, half],
      [length * 0.12, half * 0.25],
      [-length * 0.5, half * 0.25],
    ];
    const shape = local.map(([x, y]) => pointAt(along + x * sign, across + y));
    if (!shape.every((point) => insidePolygon(point, points))) return;
    THREE.ShapeUtils.triangulateShape(
      shape.map(([x, y]) => new THREE.Vector2(x, y)),
      [],
    ).forEach((face) =>
      face.forEach((index) => arrows.push(shape[index][0], height, -shape[index][1])),
    );
  };
  if (direction === 'two-way') {
    arrow(axis.min * 0.4 + axis.max * 0.6, middle - width * 0.22, 1);
    arrow(axis.min * 0.6 + axis.max * 0.4, middle + width * 0.22, -1);
  } else if (direction === 'one-way') {
    const bearing = numberFact(object, 'road.bearing'),
      flow = textFact(object, 'road.flow');
    if (bearing !== undefined || flow === 'forward' || flow === 'reverse') {
      const radians = THREE.MathUtils.degToRad(((bearing ?? 0) % 360) + object.rotation);
      const sign =
        bearing === undefined
          ? flow === 'reverse'
            ? -1
            : 1
          : Math.sin(radians) * axis.along[0] + Math.cos(radians) * axis.along[1] >= 0
            ? 1
            : -1;
      arrow((axis.min + axis.max) / 2, middle, sign);
    }
  }
  if (vertices.length)
    painter.mesh(
      'road-markings',
      triangles(vertices),
      direction === 'two-way' ? '#dad2a7' : '#deded0',
      0,
      0,
      0,
      true,
    );
  if (arrows.length) painter.mesh('direction-arrows', triangles(arrows), '#e4e2d2', 0, 0, 0, true);
  painter.group.userData.rendering = {
    direction: direction || 'unknown',
    lanes: lanes || null,
    speedLimit: numberFact(object, 'road.speedLimit') ?? null,
    speedSign: 'No sign generated without a located fixture.',
  };
}

/** Decorative geometry stays in its source envelope, including long thin imported canopies. */
function fitEnvelope(group: THREE.Group, points: Point[], height: number): void {
  const bounds = new THREE.Box3();
  group.children.forEach((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.updateMatrix();
    child.geometry.computeBoundingBox();
    if (child.geometry.boundingBox)
      bounds.union(child.geometry.boundingBox.clone().applyMatrix4(child.matrix));
  });
  if (bounds.isEmpty()) return;
  const limits = {
    x: [Math.min(...points.map((point) => point[0])), Math.max(...points.map((point) => point[0]))],
    y: [0, height],
    z: [
      -Math.max(...points.map((point) => point[1])),
      -Math.min(...points.map((point) => point[1])),
    ],
  };
  const scale = new THREE.Vector3(1, 1, 1),
    offset = new THREE.Vector3();
  for (const axis of ['x', 'y', 'z'] as const) {
    const [min, max] = limits[axis];
    scale[axis] = Math.min(
      1,
      (max - min) / Math.max(0.000001, bounds.max[axis] - bounds.min[axis]),
    );
    offset[axis] = Math.min(
      max - bounds.max[axis] * scale[axis],
      Math.max(min - bounds.min[axis] * scale[axis], 0),
    );
  }
  const fit = new THREE.Matrix4().makeScale(scale.x, scale.y, scale.z).setPosition(offset);
  group.children.forEach((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    // Bake the local transform first: nonuniform scaling of a rotated child must use group axes.
    child.updateMatrix();
    child.geometry.applyMatrix4(child.matrix).applyMatrix4(fit);
    child.position.set(0, 0, 0);
    child.quaternion.identity();
    child.scale.set(1, 1, 1);
    child.updateMatrix();
  });
}

export function disposeWorldGroup(group: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>();
  group.traverse((node) => {
    if (!(node instanceof THREE.Mesh || node instanceof THREE.Line)) return;
    geometries.add(node.geometry);
    (Array.isArray(node.material) ? node.material : [node.material]).forEach((material) =>
      materials.add(material),
    );
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

/** Source coordinates remain absolute even when parentId describes a semantic hierarchy. */
export function createWorldGroup(
  world: WorldDocument,
  visibleKinds: ObjectKind[] = ALL_KINDS,
  options: { terrainEnabled?: boolean } = {},
): THREE.Group {
  // Fail before allocating any terrain/material resources, including when called outside the editor.
  for (const object of world.objects) {
    if (object.geometry && visibleKinds.includes(object.kind)) {
      const errors = validateGeometryRecipe(object.geometry, object);
      if (errors.length) throw new Error(`Invalid geometry for ${object.id}: ${errors[0]}`);
    }
  }
  const terrainEnabled = options.terrainEnabled !== false;
  const terrainContext = createTerrainContext(world, terrainEnabled);
  const root = new THREE.Group();
  root.name = world.name;
  root.userData = {
    wordscape: JSON.parse(JSON.stringify(world)),
    coordinateSystem: 'x=east, y=up, z=south; centred on world bounds',
    hierarchy: 'parentId is semantic; all object transforms use absolute source coordinates.',
    terrainEnabled,
    verticalExaggeration: 1,
    unresolvedPlacements: [],
  };
  const visible = new Set(visibleKinds),
    parentsWithChildren = new Set(
      world.objects.flatMap((object) => (object.parentId ? [object.parentId] : [])),
    ),
    materialCache = new Map<string, THREE.MeshStandardMaterial>();
  const material = (color: string, surface: boolean, role: string): THREE.MeshStandardMaterial => {
    const offset = surface
      ? /opening|portal$|windows$|tracery/.test(role)
        ? -3
        : /ring/.test(role)
          ? -4
          : -1
      : 0;
    const key = `${color}:${surface}:${offset}`;
    let value = materialCache.get(key);
    if (!value) {
      value = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.88,
        metalness: 0,
        side: THREE.DoubleSide,
        polygonOffset: surface,
        polygonOffsetFactor: offset,
        polygonOffsetUnits: offset,
      });
      materialCache.set(key, value);
    }
    return value;
  };
  const painterFor = (group: THREE.Group): Painter => {
    const painter: Painter = {
      group,
      mesh: (role, geometry, color, x = 0, y = 0, z = 0, surface = false) => {
        if (surface) {
          // glTF has no polygonOffset. Real millimetre separation keeps exported inlays legible.
          // fitEnvelope subsequently keeps the combined object inside its declared bounds.
          const separation = /ring/.test(role)
            ? 0.008
            : /opening|portal$|windows$|tracery/.test(role)
              ? 0.006
              : 0.002;
          const positions = geometry.getAttribute('position'),
            normals = geometry.getAttribute('normal');
          for (let index = 0; index < positions.count; index += 1) {
            const ny = normals.getY(index);
            positions.setXYZ(
              index,
              positions.getX(index) + normals.getX(index) * separation,
              positions.getY(index) + (Math.abs(ny) > 0.9 ? Math.abs(ny) : ny) * separation,
              positions.getZ(index) + normals.getZ(index) * separation,
            );
          }
          positions.needsUpdate = true;
        }
        const result = new THREE.Mesh(geometry, material(color, surface, role));
        result.name = role;
        result.userData = {
          renderRole: role,
          detailEvidence: 'inferred',
          detailNote:
            'Procedural shape guided by recorded facts; decorative dimensions and placement are an interpretation.',
        };
        result.position.set(x, y, z);
        result.castShadow = !surface;
        result.receiveShadow = true;
        group.add(result);
        return result;
      },
      box: (role, width, height, depth, color, x = 0, y = 0, z = 0) =>
        painter.mesh(
          role,
          new THREE.BoxGeometry(
            Math.max(width, 0.001),
            Math.max(height, 0.001),
            Math.max(depth, 0.001),
          ),
          color,
          x,
          y,
          z,
        ),
    };
    return painter;
  };
  const slab = new THREE.Group();
  slab.name = 'Presentation base';
  slab.userData = { presentationOnly: true };
  const slabPainter = painterFor(slab),
    slabDepth = Math.max(world.bounds.width, world.bounds.depth) * 0.017;
  slabPainter.box(
    'base',
    world.bounds.width + 2,
    slabDepth,
    world.bounds.depth + 2,
    '#c5c3b4',
    0,
    -slabDepth / 2 - 0.92,
    0,
  );
  slabPainter.box(
    'base-cap',
    world.bounds.width + 2.4,
    0.8,
    world.bounds.depth + 2.4,
    '#ece7d9',
    0,
    -0.52,
    0,
  );
  if (terrainContext) {
    disposeWorldGroup(slab);
    root.add(createTerrainGroup(terrainContext));
  } else if (terrainEnabled && world.terrain) {
    disposeWorldGroup(slab);
    root.userData.terrainStatus = 'No resolved terrain surface; no flat replacement was generated.';
  } else root.add(slab);
  for (const object of world.objects) {
    if (!visible.has(object.kind)) continue;
    const baseElevation = viewObjectBase(world, object, terrainEnabled);
    if (baseElevation === undefined) {
      root.userData.unresolvedPlacements.push({
        id: object.id,
        reason: 'Terrain placement is outside recorded coverage or includes missing samples.',
      });
      continue;
    }
    const group = new THREE.Group();
    group.name = object.label;
    group.userData = {
      worldObjectId: object.id,
      parentId: object.parentId ?? null,
      worldObject: JSON.parse(JSON.stringify(object)),
      source: world.sources.find((source) => source.id === object.sourceId) ?? null,
      references: JSON.parse(JSON.stringify(object.references ?? [])),
      proceduralDetails:
        'Fact-driven stylized representation. Individual windows, foliage clusters, markings and fixture details are interpretations; unknown facts receive neutral fallback geometry.',
    };
    const painter = painterFor(group),
      points = footprint(object),
      height = Math.max(object.height, 0.001);
    const church =
      object.tags?.includes('church') ||
      ['front-church', 'church-tower'].includes(textFact(object, 'building.facade'));
    const outlineOnly =
      !object.geometry &&
      object.kind === 'building' &&
      knownFact(object, 'building.isOutline') === true &&
      parentsWithChildren.has(object.id);
    if (object.geometry) addGeometryRecipe(group, object);
    else if (outlineOnly)
      group.userData.rendering = {
        adapter: 'building-outline',
        note: 'Mapped building parts supply the geometry; this parent preserves the outline and metadata.',
      };
    else if (object.kind === 'tree') drawTree(painter, object, height, world.seed);
    else if (object.kind === 'building' || church) drawBuilding(painter, object, points, height);
    else if (object.kind === 'fixture' || textFact(object, 'fixture.type'))
      drawFixture(painter, object, points, height);
    else {
      const colors: Partial<Record<ObjectKind, string>> = {
        grass: '#a9bd87',
        pavement: '#ddd4bd',
        road: '#a3aaa7',
        water: '#85b7bd',
      };
      painter.mesh(
        'surface',
        prism(points, height),
        colors[object.kind] ?? KIND_COLORS[object.kind],
      );
      if (object.kind === 'road') drawRoad(painter, object, points, height);
    }
    fitEnvelope(group, points, height);
    if (terrainContext)
      applyTerrainToObject(
        group,
        object,
        points,
        terrainContext,
        baseElevation,
        !outlineOnly && (object.kind === 'building' || Boolean(church)),
      );
    group.traverse((node) => {
      if (node !== group)
        node.userData = {
          ...node.userData,
          worldObjectId: object.id,
          kind: object.kind,
          evidence: object.evidence,
          sourceId: object.sourceId ?? null,
        };
    });
    group.position.set(
      object.x - world.bounds.width / 2,
      baseElevation + object.layer * 0.018,
      -(object.y - world.bounds.depth / 2),
    );
    group.rotation.y = THREE.MathUtils.degToRad(object.rotation);
    root.add(group);
  }
  return root;
}

export async function exportWorldGlb(world: WorldDocument): Promise<Blob> {
  const group = createWorldGroup(world, ALL_KINDS);
  try {
    group.updateMatrixWorld(true);
    const data = await new GLTFExporter().parseAsync(group, { binary: true, onlyVisible: true });
    if (!(data instanceof ArrayBuffer))
      throw new Error('The GLB exporter did not return binary data.');
    return new Blob([data], { type: 'model/gltf-binary' });
  } finally {
    disposeWorldGroup(group);
  }
}
