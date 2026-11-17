import type { GeometryPart, GeometryRecipe, ObjectKind } from './types';

export const GEOMETRY_TEMPLATE_IDS = ['bench', 'pavilion', 'sculpture'] as const;
export type GeometryTemplateId = (typeof GEOMETRY_TEMPLATE_IDS)[number];
export interface GeometryTemplate {
  label: string;
  kind: ObjectKind;
  width: number;
  depth: number;
  height: number;
  geometry: GeometryRecipe;
}

function part(
  id: string,
  primitive: GeometryPart['primitive'],
  position: GeometryPart['position'],
  dimensions: GeometryPart['dimensions'],
  color: string,
  rotation: GeometryPart['rotation'] = [0, 0, 0],
  footprint: GeometryPart['footprint'] = null,
): GeometryPart {
  return {
    id,
    label: id.replaceAll('-', ' '),
    primitive,
    position,
    dimensions,
    color,
    rotation,
    footprint,
  };
}
function recipe(parts: GeometryPart[]): GeometryRecipe {
  return { type: 'parts', version: 1, space: 'normalized-object', evidence: 'authored', parts };
}

/** Examples are editable recipes, not remote model assets. Each call creates independent data. */
export function createGeometryTemplate(id: GeometryTemplateId): GeometryTemplate {
  if (id === 'bench')
    return {
      label: 'Recipe bench',
      kind: 'fixture',
      width: 2.1,
      depth: 0.75,
      height: 1,
      geometry: recipe([
        part('seat', 'box', [0, 0.48, 0], [0.94, 0.12, 0.8], '#a18b63'),
        part('back', 'box', [0, 0.78, 0.34], [0.94, 0.4, 0.1], '#a18b63'),
        ...([-0.35, 0.35] as const).flatMap((x, side) => [
          part(`leg-${side}-front`, 'box', [x, 0.21, -0.25], [0.06, 0.42, 0.09], '#56685b'),
          part(`leg-${side}-back`, 'box', [x, 0.21, 0.25], [0.06, 0.42, 0.09], '#56685b'),
          part(`arm-${side}`, 'box', [x, 0.64, 0], [0.06, 0.08, 0.86], '#56685b'),
        ]),
      ]),
    };
  if (id === 'pavilion')
    return {
      label: 'Recipe pavilion',
      kind: 'building',
      width: 6,
      depth: 6,
      height: 4,
      geometry: recipe([
        part('platform', 'box', [0, 0.035, 0], [0.92, 0.07, 0.92], '#c5bca7'),
        ...([-0.35, 0.35] as const).flatMap((x, side) =>
          ([-0.35, 0.35] as const).map((z, row) =>
            part(`column-${side}-${row}`, 'cylinder', [x, 0.34, z], [0.06, 0.68, 0.06], '#ded3b8'),
          ),
        ),
        part(
          'gable-roof',
          'extruded-polygon',
          [0, 0.82, 0],
          [0.96, 0.94, 0.3],
          '#a97860',
          [90, 0, 0],
          [
            [-0.5, 0.5],
            [0, -0.5],
            [0.5, 0.5],
          ],
        ),
      ]),
    };
  if (id === 'sculpture')
    return {
      label: 'Recipe sculpture',
      kind: 'landmark',
      width: 3,
      depth: 3,
      height: 5,
      geometry: recipe([
        part('plinth', 'cylinder', [0, 0.08, 0], [0.66, 0.16, 0.66], '#c6c0ae'),
        part('left-support', 'box', [-0.15, 0.41, 0], [0.1, 0.5, 0.1], '#648b82', [0, 0, -20]),
        part('right-support', 'box', [0.15, 0.41, 0], [0.1, 0.5, 0.1], '#648b82', [0, 0, 20]),
        part('orb', 'sphere', [0, 0.78, 0], [0.34, 0.32, 0.34], '#bd865c'),
        part('finial', 'cone', [0, 0.96, 0], [0.1, 0.08, 0.1], '#8d7056'),
      ]),
    };
  throw new Error('Unknown geometry template.');
}
