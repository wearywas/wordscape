import { describe, expect, it } from 'vitest';
import {
  prepareWorldGeneration,
  reviewWorldGeneration,
  applyWorldGeneration,
  worldGenerationContext,
  buildWorldGenerationPrompt,
  worldGenerationSchema,
  type GeneratedPlacement,
  type WorldGenerationResult,
} from './worldGeneration';
import { migrateWorld, validateWorld } from './document';
import { inferSurveyBounds } from './aerial';
import { createContainerPacket } from './packet';
import { washingtonSquare as specimen } from '../data/washingtonSquare.ts';
import type { GeometryRecipe, WorldDocument } from './types';
import { getObjectBaseElevation } from './terrain';
import type { AuthoredTerrainRecipe } from './authoredTerrain';

const placement = (index: number): GeneratedPlacement => ({
  id: `new-${index}`,
  label: `Courtyard ${index}`,
  kind: index === 0 ? 'road' : 'building',
  description: 'An authored courtyard building.',
  x: 20 + (index % 5) * 30,
  y: 20 + Math.floor(index / 5) * 30,
  width: 12,
  depth: 12,
  height: index === 0 ? 0.1 : 10,
  elevation: 0,
  rotation: 0,
  layer: 1,
  parentId: null,
  tags: ['imaginary'],
  facts: [
    { key: 'building.material', value: 'brick', unit: null, note: 'Authored material choice.' },
  ],
  geometry: null,
});
const result = (): WorldGenerationResult => ({
  provider: 'codex',
  model: 'test-model',
  guideVersion: '1.0',
  context: { includedObjects: 0, omittedObjects: 0 },
  proposal: {
    summary: 'An authored courtyard district.',
    name: 'Courtyard haven',
    description: 'An imaginary place.',
    additions: Array.from({ length: 20 }, (_, i) => placement(i)),
    changes: [],
    relations: [{ from: 'new-1', to: 'new-0', type: 'near', note: 'Authored route adjacency.' }],
  },
});
const create = () =>
  prepareWorldGeneration({ provider: 'codex', mode: 'create', prompt: '', size: 180 });
const world = () => migrateWorld(specimen as WorldDocument);
const terrainRecipe = (): AuthoredTerrainRecipe => ({
  type: 'analytic-heightfield',
  version: 1,
  evidence: 'authored',
  baseElevation: 0,
  features: [{ x: 0.5, y: 0.5, radiusX: 0.5, radiusY: 0.5, height: 30, rotation: 0 }],
});

describe('whole-world generation review', () => {
  it('creates real authored terrain and keeps generated water level rather than draping it', () => {
    const request = prepareWorldGeneration({ ...create(), terrainMode: 'author' });
    const response = result();
    response.proposal.terrain = terrainRecipe();
    response.proposal.additions[0] = { ...placement(0), kind: 'water', height: 0.03, elevation: 2 };
    const review = reviewWorldGeneration(request, response);
    expect(review.terrainChanged).toBe(true);
    expect(review.world.terrain?.evidence).toBe('authored');
    expect(Math.max(...(review.world.terrain!.heights as number[]))).toBeGreaterThan(20);
    expect(review.world.objects[0]).toMatchObject({ grounding: 'absolute', elevation: 2 });
    expect(review.world.objects[1].grounding).toBe('terrain');
    expect(validateWorld(review.world).errors).toEqual([]);
    expect(worldGenerationSchema(request).properties.terrain).toHaveProperty('required');
  });
  it('allows an opted-in terrain-only imaginary revision and reports re-grounding without changing plan or facts', () => {
    const original = reviewWorldGeneration(create(), result()).world,
      before = structuredClone(original);
    const request = prepareWorldGeneration({
      provider: 'codex',
      mode: 'revise',
      world: original,
      terrainMode: 'author',
    });
    const response = result();
    response.context = { includedObjects: 20, omittedObjects: 0 };
    response.proposal = {
      ...response.proposal,
      additions: [],
      changes: [],
      relations: [],
      terrain: terrainRecipe(),
    };
    const review = reviewWorldGeneration(request, response);
    expect(review.addedIds).toEqual([]);
    expect(review.changedIds).toEqual([]);
    expect(review.regroundedIds).toHaveLength(20);
    expect(
      review.world.objects.map((o) => ({
        id: o.id,
        x: o.x,
        y: o.y,
        rotation: o.rotation,
        width: o.width,
        depth: o.depth,
        facts: o.facts,
      })),
    ).toEqual(
      original.objects.map((o) => ({
        id: o.id,
        x: o.x,
        y: o.y,
        rotation: o.rotation,
        width: o.width,
        depth: o.depth,
        facts: o.facts,
      })),
    );
    expect(review.world.sources.slice(0, original.sources.length)).toEqual(original.sources);
    expect(original).toEqual(before);
    expect(getObjectBaseElevation(review.world, review.world.objects[12])).toBeGreaterThan(0);
    const context = worldGenerationContext({ ...request, world: review.world });
    expect(context.terrain).toMatchObject({
      evidence: 'authored',
      sampleColumns: 9,
      sampleRows: 9,
    });
    expect(context.terrain?.sampleHeights).toHaveLength(81);
    expect(new TextEncoder().encode(JSON.stringify(context)).length).toBeLessThan(120 * 1024);
    const missing = structuredClone(review.world);
    missing.terrain!.heights[0] = null;
    expect(
      worldGenerationContext({ ...request, world: missing }).terrain?.sampleHeights[0],
    ).toBeNull();
  });
  it('protects survey terrain and rejects unsolicited or missing terrain replacement', () => {
    expect(() =>
      prepareWorldGeneration({
        provider: 'codex',
        mode: 'revise',
        world: world(),
        terrainMode: 'author',
      }),
    ).toThrow(/imaginary|protected/i);
    const unsolicited = result();
    unsolicited.proposal.terrain = terrainRecipe();
    expect(() => reviewWorldGeneration(create(), unsolicited)).toThrow(
      /terrain.*author|terrain.*preserv/i,
    );
    expect(() => reviewWorldGeneration({ ...create(), terrainMode: 'author' }, result())).toThrow(
      /terrain.*required|terrain.*recipe/i,
    );
    const legacy = reviewWorldGeneration(create(), result());
    expect(legacy.terrainChanged).toBe(false);
    expect(legacy.world.terrain).toBeUndefined();
  });
  it('ties organic layout guidance to route tangents without overriding explicit planned briefs', () => {
    const organic = buildWorldGenerationPrompt({
      provider: 'codex',
      mode: 'create',
      size: 180,
      layout: 'clustered',
      prompt: 'A dense village grown over time along winding lanes; avoid a rectangular grid.',
    });
    expect(organic).toContain('local route tangent');
    expect(organic).toContain('curved ribbon threaded through globally aligned rectangular rows');
    expect(organic).toContain('Source rotation:0 does not imply axis-aligned');
    expect(organic).toContain('does not prescribe the placement orientation');
    expect(organic).toContain(
      'Leave numerical coverage, median gaps and orientation percentages to the calculated review metrics',
    );
    const planned = buildWorldGenerationPrompt({
      provider: 'codex',
      mode: 'create',
      size: 180,
      layout: 'clustered',
      prompt: 'Organic planting around a planned rectangular street grid.',
    });
    expect(planned).not.toContain(
      'curved ribbon threaded through globally aligned rectangular rows',
    );
    const contextual = buildWorldGenerationPrompt({ provider: 'codex', mode: 'create' });
    expect(contextual).not.toContain(
      'curved ribbon threaded through globally aligned rectangular rows',
    );
  });
  it('creates an explicitly imaginary bounded authored world with no geographic inference', () => {
    const reviewed = reviewWorldGeneration(create(), result());
    expect(reviewed.world.version).toBe('0.8');
    expect(reviewed.world.imaginary?.guideVersion).toBe('1.0');
    expect(reviewed.world.objects).toHaveLength(20);
    expect(reviewed.world.objects.every((o) => o.evidence === 'authored')).toBe(true);
    expect(reviewed.world.objects[1].facts?.every((f) => f.evidence === 'authored')).toBe(true);
    expect(reviewed.world.aerial).toBeUndefined();
    expect(inferSurveyBounds(reviewed.world)).toBeUndefined();
    expect(validateWorld(reviewed.world).errors).toEqual([]);
    const packet = createContainerPacket(reviewed.world, reviewed.addedIds[1]);
    expect(packet.sources.some((source) => source.id === 'layout-guide')).toBe(true);
    expect(packet.objects[0].evidence).toBe('authored');
  });
  it('preserves every existing placement, source, fact, relation and terrain when revising', () => {
    const original = world(),
      before = structuredClone(original);
    const request = prepareWorldGeneration({
      provider: 'codex',
      mode: 'revise',
      world: original,
      prompt: 'Add a small seating area.',
    });
    const response = result();
    const context = worldGenerationContext(request);
    response.context = {
      includedObjects: context.includedObjects,
      omittedObjects: context.omittedObjects,
    };
    response.proposal.additions = [
      { ...placement(22), x: 180, y: 180, kind: 'fixture', width: 2, depth: 2, height: 1 },
    ];
    response.proposal.changes = [
      {
        objectId: original.objects[0].id,
        description: 'An authored descriptive interpretation.',
        geometry: null,
      },
    ];
    response.proposal.relations = [];
    const revised = applyWorldGeneration(original, request, response);
    expect(original).toEqual(before);
    expect(revised.sources).toEqual(before.sources);
    expect(revised.terrain).toEqual(before.terrain);
    expect(revised.aerial).toEqual(before.aerial);
    expect(revised.relations.slice(0, before.relations.length)).toEqual(before.relations);
    expect(revised.objects.slice(1, before.objects.length)).toEqual(before.objects.slice(1));
    expect({ ...revised.objects[0], description: before.objects[0].description }).toEqual(
      before.objects[0],
    );
    expect(revised.objects.at(-1)?.grounding).toBe('terrain');
    expect(revised.imaginary).toBeUndefined();
  });
  it('rejects stale revisions including changed facts and world metadata', () => {
    const original = world();
    const request = prepareWorldGeneration({ provider: 'codex', mode: 'revise', world: original });
    const current = structuredClone(original);
    current.name += ' edited';
    expect(() => applyWorldGeneration(current, request, result())).toThrow(
      /changed.*generation|stale/i,
    );
  });
  it('rejects executable fields, forged sources, duplicate IDs and escaped rotated envelopes', () => {
    for (const mutate of [
      (r: WorldGenerationResult) => Object.assign(r.proposal, { script: 'alert(1)' }),
      (r: WorldGenerationResult) =>
        Object.assign(r.proposal.additions[0], { sourceId: 'invented' }),
      (r: WorldGenerationResult) => {
        r.proposal.additions[1].id = r.proposal.additions[0].id;
      },
      (r: WorldGenerationResult) => {
        Object.assign(r.proposal.additions[0], { x: 5, rotation: 45 });
      },
    ]) {
      const response = result();
      mutate(response);
      expect(() => reviewWorldGeneration(create(), response)).toThrow();
    }
  });
  it('rejects missing/self parents, bogus relations, empty worlds and oversized prompts', () => {
    for (const mutate of [
      (r: WorldGenerationResult) => {
        r.proposal.additions[0].parentId = 'missing';
      },
      (r: WorldGenerationResult) => {
        r.proposal.additions[0].parentId = r.proposal.additions[0].id;
      },
      (r: WorldGenerationResult) => {
        r.proposal.relations[0].to = 'missing';
      },
      (r: WorldGenerationResult) => {
        r.proposal.additions = [];
      },
    ]) {
      const response = result();
      mutate(response);
      expect(() => reviewWorldGeneration(create(), response)).toThrow();
    }
    expect(() =>
      prepareWorldGeneration({ provider: 'codex', mode: 'create', prompt: 'x'.repeat(4001) }),
    ).toThrow(/prompt/i);
    expect(() =>
      prepareWorldGeneration({ provider: 'codex', mode: 'create', size: 1000 as 180 }),
    ).toThrow(/size/i);
  });
  it('reports overlaps for review rather than claiming coherent collision-free generation', () => {
    const response = result();
    response.proposal.additions[2].x = response.proposal.additions[1].x;
    const reviewed = reviewWorldGeneration(create(), response);
    expect(reviewed.warnings.join(' ')).toMatch(/overlap|intersect/i);
  });
  it('flags authored buildings over route or water envelopes without inventing access', () => {
    const response = result();
    Object.assign(response.proposal.additions[2], {
      x: response.proposal.additions[0].x,
      y: response.proposal.additions[0].y,
    });
    expect(reviewWorldGeneration(create(), response).warnings.join(' ')).toMatch(
      /route\/water clearance/,
    );
  });
  it('bounds large-world context and rejects false omission reports', () => {
    const existing = world();
    existing.objects = Array.from({ length: 500 }, (_, index) => ({
      ...existing.objects[0],
      id: `kept-${index}`,
      parentId: undefined,
      facts: [],
      references: [],
      description: 'Context '.repeat(300),
    }));
    existing.relations = [];
    const request = prepareWorldGeneration({ provider: 'codex', mode: 'revise', world: existing });
    const context = worldGenerationContext(request);
    expect(context.includedObjects).toBeLessThanOrEqual(160);
    expect(context.includedObjects + context.omittedObjects).toBe(500);
    expect(
      new TextEncoder().encode(buildWorldGenerationPrompt(request)).length,
    ).toBeLessThanOrEqual(200 * 1024);
    expect(() => reviewWorldGeneration(request, result())).toThrow(/context report/i);
  });
  it('keeps fact units and explains traced footprint coordinates in revision context', () => {
    const existing = world();
    existing.objects[0].facts = [
      { key: 'recorded.width', value: 20, unit: 'ft', evidence: 'authored' },
    ];
    const request = prepareWorldGeneration({ provider: 'codex', mode: 'revise', world: existing });
    const prompt = buildWorldGenerationPrompt(request);
    expect(prompt.includes('"unit":"ft"')).toBe(true);
    expect(prompt.includes('footprint coordinates are local metres')).toBe(true);
    expect(prompt.includes('rectangle inside the traced polygon')).toBe(true);
  });
  it('includes three existing fictional recipes for iterative visual fidelity', () => {
    const existing = reviewWorldGeneration(create(), result()).world;
    const geometry: GeometryRecipe = {
      type: 'parts',
      version: 1,
      space: 'normalized-object',
      evidence: 'authored',
      parts: [
        {
          id: 'slab',
          label: 'Authored slab',
          primitive: 'box',
          position: [0, 0.05, 0],
          rotation: [0, 0, 0],
          dimensions: [0.8, 0.1, 0.8],
          color: '#998877',
          footprint: null,
        },
      ],
    };
    for (const object of existing.objects.slice(1, 4)) object.geometry = structuredClone(geometry);
    const context = worldGenerationContext({ provider: 'codex', mode: 'revise', world: existing });
    const summaries = context.objects as {
      id: string;
      geometry?: GeometryRecipe;
      geometryOmitted?: string;
    }[];
    expect(summaries.filter((object) => object.geometry)).toHaveLength(3);
    for (const original of existing.objects.slice(1, 4)) {
      const summary = summaries.find((object) => object.id === original.id)!;
      expect(summary.geometry).toEqual(original.geometry);
      expect(summary.geometry).not.toBe(original.geometry);
      expect(summary.geometryOmitted).toBeUndefined();
    }
  });
  it('omits oversized recipes honestly while retaining object coverage under the context cap', () => {
    const existing = reviewWorldGeneration(create(), result()).world;
    const recipe = (count: number): GeometryRecipe => ({
      type: 'parts',
      version: 1,
      space: 'normalized-object',
      evidence: 'authored',
      parts: Array.from({ length: count }, (_, index) => ({
        id: `part-${index}`,
        label: 'A'.repeat(120),
        primitive: 'box',
        position: [0, 0.5, 0],
        rotation: [0, 0, 0],
        dimensions: [0.8, 0.5, 0.8],
        color: '#998877',
        footprint: null,
      })),
    });
    const oversized = recipe(32),
      ordinary = recipe(12);
    expect(new TextEncoder().encode(JSON.stringify(oversized)).length).toBeGreaterThan(8 * 1024);
    existing.objects = Array.from({ length: 160 }, (_, index) => ({
      ...structuredClone(existing.objects[1]),
      id: `existing-${index}`,
      geometry: index === 0 ? oversized : ordinary,
    }));
    existing.relations = [];
    expect(validateWorld(existing).errors).toEqual([]);
    const request = { provider: 'codex' as const, mode: 'revise' as const, world: existing };
    const context = worldGenerationContext(request);
    const summaries = context.objects as { geometry?: GeometryRecipe; geometryOmitted?: string }[];
    expect(context.includedObjects).toBe(160);
    expect(context.omittedObjects).toBe(0);
    expect(summaries[0].geometry).toBeUndefined();
    expect(summaries[0].geometryOmitted).toBe('recipe-exceeds-8KiB');
    expect(summaries.some((object) => object.geometry)).toBe(true);
    expect(summaries.some((object) => object.geometryOmitted === 'context-budget')).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(context)).length).toBeLessThanOrEqual(
      120 * 1024,
    );
    expect(
      buildWorldGenerationPrompt(request).includes('Never claim knowledge of omitted recipe parts'),
    ).toBe(true);
  });
  it('records unknown generated facts, derived proximity and explicit non-geographic format rules', () => {
    const response = result();
    response.proposal.relations = [];
    response.proposal.additions[0].facts[0].value = null;
    const created = reviewWorldGeneration(create(), response).world;
    expect(created.objects[0].facts?.[0].evidence).toBe('unknown');
    expect(created.relations.length).toBeGreaterThan(0);
    expect(
      created.relations.every((r) => r.type === 'near' && r.note?.includes('not a surveyed')),
    ).toBe(true);
    expect(validateWorld({ ...created, version: '0.6' }).errors.join(' ')).toMatch(/imaginary/);
    expect(
      validateWorld({ ...created, origin: { ...created.origin, latitude: 20 } }).errors.join(' '),
    ).toMatch(/placeholder/);
    expect(() => reviewWorldGeneration(create(), { ...response, guideVersion: 'forged' })).toThrow(
      /guide version/,
    );
  });
  it('uses only selected concrete references and retains their separate inspiration provenance', () => {
    const request = prepareWorldGeneration({
      provider: 'codex',
      mode: 'create',
      size: 180,
      prompt: 'A compact canal village.',
      layout: 'clustered',
      referenceIds: ['monaco-old-town', 'sf-wharf'],
    });
    const response = {
      ...result(),
      layout: 'clustered' as const,
      referenceIds: ['monaco-old-town', 'sf-wharf'],
    };
    const prompt = buildWorldGenerationPrompt(request);
    const included = JSON.parse(prompt.split('LAYOUT_EXAMPLES=')[1].split('\n')[0]);
    expect(included.map((example: { id: string }) => example.id)).toEqual(response.referenceIds);
    expect(
      included[0].cluster.objects.some((object: { footprint?: unknown }) => object.footprint),
    ).toBe(true);
    expect(new TextEncoder().encode(prompt).length).toBeLessThan(200 * 1024);
    expect(prompt.includes('prefer0 for complex layouts')).toBe(false);
    const reviewed = reviewWorldGeneration(request, response).world;
    const references = reviewed.sources.filter((source) => source.id.startsWith('layout-ref:'));
    expect(references).toHaveLength(2);
    expect(
      reviewed.sources
        .find((source) => source.id === 'layout-guide')
        ?.notes.includes('No source geometry is copied'),
    ).toBe(false);
    expect(
      references.every(
        (source) =>
          source.attribution.includes('OpenStreetMap') && source.notes.includes('not surveyed'),
      ),
    ).toBe(true);
    expect(
      reviewed.objects[0].facts?.find((fact) => fact.key === 'generation.referenceIds')?.value,
    ).toBe(JSON.stringify(response.referenceIds));
    expect(
      createContainerPacket(reviewed, reviewed.objects[0].id).sources.filter((source) =>
        source.id.startsWith('layout-ref:'),
      ),
    ).toHaveLength(2);
    expect(() =>
      reviewWorldGeneration(request, { ...response, referenceIds: ['hulhumale-grid'] }),
    ).toThrow(/reference.*match|provided/i);
  });
  it('supports no concrete references while preserving legacy result replay', () => {
    const request = prepareWorldGeneration({
      provider: 'codex',
      mode: 'create',
      size: 180,
      referenceIds: [],
    });
    const response = { ...result(), referenceIds: [], layout: 'contextual' as const };
    expect(buildWorldGenerationPrompt(request).includes('LAYOUT_EXAMPLES=[]')).toBe(true);
    expect(
      reviewWorldGeneration(request, response).world.sources.some((source) =>
        source.id.startsWith('layout-ref:'),
      ),
    ).toBe(false);
    expect(reviewWorldGeneration(create(), result()).world.objects).toHaveLength(20);
    expect(() =>
      prepareWorldGeneration({ provider: 'codex', mode: 'create', referenceIds: ['forged'] }),
    ).toThrow(/unknown/i);
    expect(() =>
      prepareWorldGeneration({
        provider: 'codex',
        mode: 'revise',
        world: { ...world(), description: 42 as unknown as string },
      }),
    ).toThrow(/description must be text/);
  });
  it('accepts bounded local authored footprints and rejects malformed or rotated escape geometry', () => {
    const response = result();
    response.proposal.additions[1].footprint = [
      [-6, -6],
      [6, -6],
      [3, 6],
      [-5, 4],
    ];
    const reviewed = reviewWorldGeneration(create(), response).world;
    expect(reviewed.objects[1].footprint).toEqual(response.proposal.additions[1].footprint);
    expect(reviewed.objects[1].evidence).toBe('authored');
    for (const footprint of [
      [
        [-7, -6],
        [6, -6],
        [6, 6],
      ],
      [
        [-6, -6],
        [6, 6],
        [-6, 6],
        [6, -6],
      ],
      [
        [0, 0],
        [1, 1],
        [2, 2],
      ],
    ]) {
      const malformed = result();
      malformed.proposal.additions[1].footprint = footprint as [number, number][];
      expect(() => reviewWorldGeneration(create(), malformed)).toThrow();
    }
    const escaped = result();
    Object.assign(escaped.proposal.additions[1], {
      x: 5,
      y: 5,
      rotation: 45,
      footprint: [
        [-6, -6],
        [6, -6],
        [6, 6],
        [-6, 6],
      ],
    });
    expect(() => reviewWorldGeneration(create(), escaped)).toThrow(/bounds/);
  });
  it('retains every existing revision fact and placement when adding reference-backed objects', () => {
    const original = world();
    const request = prepareWorldGeneration({
      provider: 'codex',
      mode: 'revise',
      world: original,
      layout: 'clustered',
      referenceIds: ['monaco-old-town'],
    });
    const response = {
      ...result(),
      layout: 'clustered' as const,
      referenceIds: ['monaco-old-town'],
    };
    const context = worldGenerationContext(request);
    response.context = {
      includedObjects: context.includedObjects,
      omittedObjects: context.omittedObjects,
    };
    response.proposal.additions = [
      { ...placement(50), kind: 'fixture', width: 2, depth: 2, height: 1 },
    ];
    response.proposal.relations = [];
    const revised = reviewWorldGeneration(request, response).world;
    expect(revised.objects.slice(0, original.objects.length)).toEqual(original.objects);
    expect(revised.sources.slice(0, original.sources.length)).toEqual(original.sources);
    expect(revised.terrain).toEqual(original.terrain);
    expect(revised.sources.length).toBe(original.sources.length + 1);
  });
  it('retains edited reference provenance and creates a distinct source for new inspiration links', () => {
    const initialRequest = prepareWorldGeneration({
      provider: 'codex',
      mode: 'create',
      size: 180,
      referenceIds: ['monaco-old-town'],
    });
    const initialResult = {
      ...result(),
      referenceIds: ['monaco-old-town'],
      layout: 'contextual' as const,
    };
    const existing = reviewWorldGeneration(initialRequest, initialResult).world;
    const editedSource = existing.sources.find((source) => source.id.startsWith('layout-ref:'))!;
    editedSource.attribution = 'User-edited retained source attribution';
    const before = structuredClone(editedSource);
    const request = prepareWorldGeneration({
      provider: 'codex',
      mode: 'revise',
      world: existing,
      referenceIds: ['monaco-old-town'],
    });
    const response = {
      ...result(),
      referenceIds: ['monaco-old-town'],
      layout: 'contextual' as const,
    };
    const context = worldGenerationContext(request);
    response.context = {
      includedObjects: context.includedObjects,
      omittedObjects: context.omittedObjects,
    };
    response.proposal.additions = [
      { ...placement(80), x: 150, y: 150, kind: 'fixture', width: 2, depth: 2 },
    ];
    response.proposal.relations = [];
    const revised = reviewWorldGeneration(request, response).world;
    expect(revised.sources.find((source) => source.id === before.id)).toEqual(before);
    expect(revised.sources.filter((source) => source.id.startsWith('layout-ref:'))).toHaveLength(2);
    expect(
      revised.objects.at(-1)?.facts?.find((fact) => fact.key === 'generation.referenceIds')
        ?.sourceIds,
    ).not.toContain(before.id);
  });
});
