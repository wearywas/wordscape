import type { WorldDocument, WorldFact, WorldObject } from './types';
import { getObjectBaseElevation, sampleTerrain } from './terrain';

type ReviewStatus = 'missing' | 'interpreted' | 'sourced';
export interface SurveyQuestion {
  key: string;
  label: string;
  status: ReviewStatus;
  value?: WorldFact['value'];
  evidence?: WorldFact['evidence'];
  unit?: string;
  sourceIds?: string[];
  note?: string;
}
const isBuildingLike = (object: WorldObject): boolean =>
  object.kind === 'building' ||
  (object.kind === 'landmark' &&
    Boolean(
      object.facts?.some((fact) => fact.key.startsWith('building.')) ||
      object.tags?.some((tag) => ['building', 'church', 'tower'].includes(tag)),
    ));

const questionsFor = (object: WorldObject): [string, string][] => {
  if (isBuildingLike(object))
    return [
      ['building.reportedHeight', 'Exterior height'],
      ['building.levels', 'Floor count'],
      ['building.material', 'Construction material'],
    ];
  if (object.kind === 'tree')
    return [
      ['tree.species', 'Species'],
      ['tree.height', 'Tree height'],
    ];
  if (object.kind === 'road')
    return [
      ['road.direction', 'Traffic direction'],
      ['road.lanes', 'Lane count'],
      ['road.speedLimit', 'Whole-road speed limit'],
    ];
  return [];
};

/** A source link alone does not promote an estimate to a sourced fact. */
export function surveyQuestions(object: WorldObject): SurveyQuestion[] {
  return questionsFor(object).map(([key, label]) => {
    const fact = object.facts?.find((candidate) => candidate.key === key);
    // The scene's mass height is an interpretation, not a reported measurement.
    // An explicitly unknown fact takes precedence over that rendering fallback.
    if (
      !fact &&
      key === 'building.reportedHeight' &&
      Number.isFinite(object.height) &&
      object.height > 0
    )
      return {
        key,
        label,
        status: 'interpreted',
        value: object.height,
        unit: 'm',
        evidence: 'inferred',
        note: 'Recorded mesh height; not sourced building measurement',
      };
    const known = fact && fact.value !== null && fact.evidence !== 'unknown';
    return {
      key,
      label,
      status: !known ? 'missing' : fact.evidence === 'sourced' ? 'sourced' : 'interpreted',
      ...(fact
        ? {
            value: fact.value,
            evidence: fact.evidence,
            ...(fact.unit !== undefined ? { unit: fact.unit } : {}),
            ...(fact.sourceIds ? { sourceIds: [...fact.sourceIds] } : {}),
            ...(fact.note !== undefined ? { note: fact.note } : {}),
          }
        : {}),
    };
  });
}

export function terrainOverview(world: WorldDocument) {
  const terrain = world.terrain;
  if (!terrain) return undefined;
  const values = terrain.heights.filter((value): value is number => value !== null);
  return {
    min: values.length ? Math.min(...values) : undefined,
    max: values.length ? Math.max(...values) : undefined,
    relief: values.length ? Math.max(...values) - Math.min(...values) : undefined,
    validSamples: values.length,
    missingSamples: terrain.heights.length - values.length,
  };
}

/** Local slope of the sampled ground, not a measured street/accessibility grade. */
export function terrainSlope(world: WorldDocument, x: number, y: number): number | undefined {
  if (!world.terrain) return undefined;
  const terrain = world.terrain;
  const maxX = terrain.origin.x + (terrain.columns - 1) * terrain.spacing;
  const maxY = terrain.origin.y + (terrain.rows - 1) * terrain.spacing;
  if (x < terrain.origin.x || y < terrain.origin.y || x > maxX || y > maxY) return undefined;
  const half = terrain.spacing / 2;
  const x0 = Math.max(terrain.origin.x, x - half),
    x1 = Math.min(maxX, x + half);
  const y0 = Math.max(terrain.origin.y, y - half),
    y1 = Math.min(maxY, y + half);
  const west = sampleTerrain(world, x0, y),
    east = sampleTerrain(world, x1, y);
  const south = sampleTerrain(world, x, y0),
    north = sampleTerrain(world, x, y1);
  if (west === undefined || east === undefined || south === undefined || north === undefined)
    return undefined;
  return (
    (Math.atan(Math.hypot((east - west) / (x1 - x0), (north - south) / (y1 - y0))) * 180) / Math.PI
  );
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b),
    middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
const round = (value: number | null) => (value === null ? null : Math.round(value * 100) / 100);

/** Describes this document, not an exhaustive survey or a set of generation laws. */
export function analyzeSurvey(world: WorldDocument) {
  const evidence = { sourced: 0, observed: 0, inferred: 0, authored: 0, unknown: 0 };
  for (const object of world.objects)
    for (const fact of object.facts ?? []) evidence[fact.evidence] += 1;
  const checks = world.objects.map((object) => ({
    objectId: object.id,
    label: object.label,
    questions: surveyQuestions(object),
    unresolvedGround:
      object.grounding === 'terrain' && getObjectBaseElevation(world, object) === undefined,
  }));
  const review = checks.filter(
    (item) =>
      item.unresolvedGround || item.questions.some((question) => question.status !== 'sourced'),
  );
  const trees = world.objects.filter((object) => object.kind === 'tree');
  const spacings =
    trees.length < 2
      ? []
      : trees.map((tree) =>
          Math.min(
            ...trees
              .filter((other) => other !== tree)
              .map((other) => Math.hypot(tree.x - other.x, tree.y - other.y)),
          ),
        );
  const masses = world.objects.filter(isBuildingLike);
  const fields = checks.flatMap((object) => object.questions);
  return {
    format: 'wordscape-survey-notebook',
    version: '0.1',
    world: world.name,
    worldVersion: world.version,
    objectCount: world.objects.length,
    factEvidence: evidence,
    terrain: world.terrain
      ? {
          ...terrainOverview(world),
          spacing: world.terrain.spacing,
          sourceResolution: world.terrain.sourceResolution,
          sampledResolution: world.terrain.sampledResolution,
          verticalDatum: world.terrain.verticalDatum,
          sourceId: world.terrain.sourceId,
          acquired: world.terrain.acquired,
        }
      : null,
    checkedFields: {
      sourced: fields.filter((check) => check.status === 'sourced').length,
      interpreted: fields.filter((check) => check.status === 'interpreted').length,
      missing: fields.filter((check) => check.status === 'missing').length,
    },
    checks,
    review,
    patterns: {
      recordedObjectsPerHectare: round(
        world.objects.length / ((world.bounds.width * world.bounds.depth) / 10_000),
      ),
      medianRecordedBuildingHeight: {
        metres: round(median(masses.map((object) => object.height))),
        sampleCount: masses.length,
      },
      medianTreeNearestNeighbor: { metres: round(median(spacings)), sampleCount: spacings.length },
    },
    limitations: [
      'Counts describe recorded data, not completeness or correctness of the real place.',
      'A sourced fact is attributed, not independently verified here. Dates and scope remain in its source and notes.',
      'Review checks target a small set of useful fields. Untested fields and absent real-world objects are not counted.',
      'A scoped street-segment limit does not resolve a whole-road speed limit.',
      'Patterns describe this authored specimen. Building heights are often estimates; tree centers may represent crowns or groups. These are design references, not rules for other places.',
      'Terrain slope is derived from sampled ground and is not a measured road grade or accessibility assessment.',
    ],
    sources: world.sources,
  };
}
