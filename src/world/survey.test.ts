import { describe, expect, it } from 'vitest';
import { washingtonSquare } from '../data/washingtonSquare';
import { analyzeSurvey, surveyQuestions, terrainSlope } from './survey';
import type { WorldObject } from './types';

describe('survey notebook', () => {
  it('does not treat linked estimates or scoped speed limits as documented whole-road facts', () => {
    const road = {
      ...washingtonSquare.objects[0],
      kind: 'road',
      facts: [
        {
          key: 'road.direction',
          value: 'both',
          evidence: 'inferred',
          sourceIds: ['street-directions'],
        },
        { key: 'road.lanes', value: null, evidence: 'unknown' },
        {
          key: 'road.parkFrontageSpeedLimit',
          value: 20,
          evidence: 'sourced',
          sourceIds: ['street-speeds'],
        },
      ],
    } as WorldObject;
    expect(surveyQuestions(road).map((item) => item.status)).toEqual([
      'interpreted',
      'missing',
      'missing',
    ]);
  });
  it('reports patterns deterministically and treats an empty sample as unknown', () => {
    const empty = { ...washingtonSquare, objects: [] };
    const report = analyzeSurvey(empty);
    expect(report.patterns.medianTreeNearestNeighbor.metres).toBeNull();
    expect(report.patterns.medianRecordedBuildingHeight.metres).toBeNull();
    expect(report.review).toEqual([]);
    expect(analyzeSurvey(washingtonSquare)).toEqual(analyzeSurvey(washingtonSquare));
  });
  it('distinguishes modeled building height from an explicit unknown', () => {
    const building = {
      ...washingtonSquare.objects[0],
      kind: 'building',
      height: 12,
      evidence: 'observed',
      facts: [],
    } as WorldObject;
    expect(surveyQuestions(building)[0]).toMatchObject({
      status: 'interpreted',
      value: 12,
      unit: 'm',
      evidence: 'inferred',
      note: 'Recorded mesh height; not sourced building measurement',
    });
    building.facts = [
      {
        key: 'building.reportedHeight',
        value: null,
        evidence: 'unknown',
        note: 'No exterior measurement available.',
      },
    ];
    expect(surveyQuestions(building)[0]).toMatchObject({
      status: 'missing',
      value: null,
      evidence: 'unknown',
      note: 'No exterior measurement available.',
    });
    building.facts = [
      { key: 'building.reportedHeight', value: 12, evidence: 'sourced', sourceIds: ['parish'] },
    ];
    expect(surveyQuestions(building)[0].status).toBe('sourced');
  });
  it('does not describe structural material as a confirmed wall finish', () => {
    const building = {
      ...washingtonSquare.objects[0],
      kind: 'building',
      facts: [
        {
          key: 'building.material',
          value: 'concrete',
          evidence: 'sourced',
          sourceIds: ['church-guide'],
        },
      ],
    } as WorldObject;
    expect(
      surveyQuestions(building).find((question) => question.key === 'building.material'),
    ).toMatchObject({ label: 'Construction material', status: 'sourced' });
  });
  it('exports standalone provenance for fully sourced objects outside the review queue', () => {
    const building = {
      ...washingtonSquare.objects[0],
      id: 'source-trace',
      kind: 'building',
      grounding: 'absolute',
      facts: [
        {
          key: 'building.reportedHeight',
          value: 12,
          unit: 'm',
          evidence: 'sourced',
          sourceIds: ['parish'],
          note: 'Example exterior measurement with retained scope.',
        },
        { key: 'building.levels', value: 3, evidence: 'sourced', sourceIds: ['park-history'] },
        {
          key: 'building.material',
          value: 'concrete',
          evidence: 'sourced',
          sourceIds: ['church-guide'],
        },
      ],
    } as WorldObject;
    const report = analyzeSurvey({ ...washingtonSquare, objects: [building] });
    const standalone: ReturnType<typeof analyzeSurvey> = JSON.parse(JSON.stringify(report));
    expect(standalone.review).toEqual([]);
    expect(standalone.checks).toHaveLength(1);
    expect(standalone.checks[0].objectId).toBe('source-trace');
    const height = standalone.checks[0].questions[0];
    expect(height).toMatchObject({
      status: 'sourced',
      value: 12,
      unit: 'm',
      evidence: 'sourced',
      sourceIds: ['parish'],
      note: 'Example exterior measurement with retained scope.',
    });
    expect(standalone.sources.find((source) => source.id === height.sourceIds![0])?.url).toBe(
      'https://www.salesiansspp.org/our-history',
    );
    expect(standalone.checkedFields).toEqual({ sourced: 3, interpreted: 0, missing: 0 });
  });
  it('excludes nonarchitectural landmarks from building questions and height patterns', () => {
    const base = washingtonSquare.objects[0];
    const building = {
      ...base,
      id: 'building',
      kind: 'building',
      height: 10,
      facts: [],
      tags: [],
    } as WorldObject;
    const statue = {
      ...base,
      id: 'statue',
      kind: 'landmark',
      height: 80,
      facts: [],
      tags: ['statue'],
    } as WorldObject;
    const church = {
      ...base,
      id: 'church',
      kind: 'landmark',
      height: 15,
      facts: [],
      tags: ['church'],
    } as WorldObject;
    expect(surveyQuestions(statue)).toEqual([]);
    expect(surveyQuestions(church)).toHaveLength(3);
    expect(
      analyzeSurvey({ ...washingtonSquare, objects: [building, statue, church] }).patterns
        .medianRecordedBuildingHeight,
    ).toEqual({ metres: 12.5, sampleCount: 2 });
  });
  it('computes planar slope at edges and retains unknown data', () => {
    const world = {
      ...washingtonSquare,
      terrain: {
        type: 'height-grid' as const,
        columns: 3,
        rows: 3,
        spacing: 5,
        origin: { x: 0, y: 0 },
        heights: [10, 15, 20, 10, 15, 20, 10, 15, 20] as (number | null)[],
        verticalDatum: 'test',
        referenceElevation: 10,
        sourceId: 'test',
        sourceResolution: 1,
        interpolation: 'bilinear' as const,
      },
    };
    expect(terrainSlope(world, 0, 0)).toBeCloseTo(45);
    expect(terrainSlope(world, 5, 5)).toBeCloseTo(45);
    expect(terrainSlope(world, -1, 5)).toBeUndefined();
    world.terrain.heights[4] = null;
    expect(terrainSlope(world, 5, 5)).toBeUndefined();
  });
});
