import { describe, expect, it } from 'vitest';
import { getLayoutIntent, selectLayoutReferences } from './layoutReferences';

// Exact briefs retained by scripts/world-layout-live-check.mjs. These verbose
// inputs catch weak lexical signals that short synthetic briefs can miss.
const liveCanalBrief =
  'Create Lanternwater Lanes, a fictional storybook canal village on a flat 180 metre square. Retain the idea of a copper-domed archive, workshops, cottages, market courts, orchard planting and a canal, but make a denser settlement that feels grown over time. Use 45–60 objects, including about 24–30 varied buildings arranged into three close clusters along a gently bending market lane and a short waterfront spine. Aim for about 25–35% summed building footprint coverage, with varied narrow gaps and occasional shared walls, while keeping useful routes clear. Include two small uneven gathering courts rather than a giant central square. Orient buildings to their nearby route and cluster; avoid identical rows, equal setbacks and right-angle symmetry. Let the canal or shore have a simple bent polygon outline. Place only a few useful trees and fixtures in leftover pockets. Keep all footprints inside the scene and avoid solid overlaps. Use original bounded geometry for the copper-domed archive and one workshop, with other roofs interpreted from authored facts. Reference real layout relationships creatively; this is fiction, not a copy of a real town.';
const liveWoodlandBrief =
  'Create Mossbell Retreat, an imaginary woodland clearing on a flat 180 metre square. This should feel open and rural, not urban: only five small huts, a shared pavilion, a narrow meandering footpath, a small irregular pond, and groups of trees of varied size concentrated at the edges and in a few loose groves. Use 24–32 total objects. Keep a generous irregular central clearing and three small hut groups following the path, with orientations reflecting the local bend. Avoid grids, evenly spaced trees, giant straight boulevards and urban density. Keep dry buildings and tree trunks clear of water and routes. Simple authored geometry is sufficient; a memorable little pavilion may use a few normalized parts. All geometry and claims are invented.';

describe('bounded concrete layout references', () => {
  it('respects both complete live briefs, including woodland water-clearance and urban exclusions', () => {
    expect(
      selectLayoutReferences({ prompt: liveCanalBrief, layout: 'clustered' }).referenceIds,
    ).toEqual(['monaco-old-town', 'sf-wharf']);
    const woodland = selectLayoutReferences({ prompt: liveWoodlandBrief, layout: 'open' });
    expect(woodland.referenceIds).not.toContain('sf-wharf');
    expect(
      woodland.examples.every((example) =>
        example.tags.some((tag) => ['sparse', 'dispersed', 'open-spacing'].includes(tag)),
      ),
    ).toBe(true);
    expect(getLayoutIntent({ prompt: liveWoodlandBrief, layout: 'open' })).toBe('organic');
  });
  it('does not infer a harbor from generic water or a negated waterfront request', () => {
    for (const prompt of [
      'An open rural woodland with a lake and a pond; keep huts clear of water.',
      'A sparse rural settlement, not a harbor or waterfront town.',
    ])
      expect(selectLayoutReferences({ prompt, layout: 'open' }).referenceIds).not.toContain(
        'sf-wharf',
      );
  });
  it('matches two real harbor/irregular examples deterministically from the brief', () => {
    const input = {
      prompt: 'A historic compact canal harbor town with irregular clustered lanes.',
      layout: 'clustered' as const,
    };
    const selected = selectLayoutReferences(input);
    expect(selected.referenceIds).toHaveLength(2);
    expect(selected.referenceIds).toContain('sf-wharf');
    expect(selected.referenceIds).toContain('monaco-old-town');
    expect(selected.examples.every((example) => example.cluster.objects.length >= 20)).toBe(true);
    expect(selectLayoutReferences(input)).toEqual(selected);
    expect(selected.reason).toMatch(/heuristic/i);
  });
  it('lets a sparse nature brief outweigh a clustered preference and does not force density', () => {
    const selected = selectLayoutReferences({
      prompt: 'An open forest clearing, sparse roadside cabins and dispersed rural buildings.',
      layout: 'clustered',
    });
    expect(selected.referenceIds).not.toContain('monaco-old-town');
    expect(
      selected.referenceIds.some((id) => ['lefaga-village', 'la-digue-rural'].includes(id)),
    ).toBe(true);
  });
  it('prefers organic route patterns for dense grown-over-time canal clusters', () => {
    const selected = selectLayoutReferences({
      prompt:
        'A dense canal village grown over time, with three close clusters along a gently bending market lane. Avoid a uniform grid. A close settlement of small varied buildings and footprints along narrow routes by the waterfront.',
      layout: 'clustered',
    });
    expect(selected.referenceIds).toContain('monaco-old-town');
    expect(selected.referenceIds).toContain('sf-wharf');
    expect(selected.referenceIds).not.toContain('thulusdhoo-village');
    expect(selected.referenceIds).not.toContain('hulhumale-grid');
  });
  it('lets an affirmative planned grid brief override a clustered preference', () => {
    const selected = selectLayoutReferences({
      prompt: 'Dense organic garden clusters within a deliberately planned street grid.',
      layout: 'clustered',
    });
    expect(selected.referenceIds[0]).toBe('hulhumale-grid');
  });
  it('distinguishes negated grid wording from an affirmative layout request', () => {
    expect(getLayoutIntent({ prompt: 'Winding lanes, not a formal grid.' })).toBe('organic');
    expect(getLayoutIntent({ prompt: 'Avoid a grid; use gently bending lanes.' })).toBe('organic');
    expect(
      getLayoutIntent({ prompt: 'No organic lanes, but a planned grid.', layout: 'clustered' }),
    ).toBe('planned');
    expect(getLayoutIntent({ prompt: 'A garden with a pavilion.', layout: 'contextual' })).toBe(
      'unspecified',
    );
  });
  it('keeps unknown contextual selection diverse instead of applying an urban morphology rule', () => {
    expect(selectLayoutReferences({ prompt: '', layout: 'contextual' }).referenceIds).toEqual([
      'monaco-old-town',
      'malbun-village',
    ]);
  });
  it('validates explicit selections and supports choosing no references', () => {
    expect(selectLayoutReferences({ referenceIds: [] })).toMatchObject({
      mode: 'none',
      referenceIds: [],
      examples: [],
    });
    expect(selectLayoutReferences({ referenceIds: ['sf-wharf'] })).toMatchObject({
      mode: 'explicit',
      referenceIds: ['sf-wharf'],
    });
    expect(() => selectLayoutReferences({ referenceIds: ['forged'] })).toThrow(/unknown/i);
    expect(() => selectLayoutReferences({ referenceIds: ['sf-wharf', 'sf-wharf'] })).toThrow(
      /unique/i,
    );
    expect(() =>
      selectLayoutReferences({ referenceIds: ['sf-wharf', 'monaco-old-town', 'hulhumale-grid'] }),
    ).toThrow(/two|2/i);
  });
  it('returns independent examples so preview selection cannot alter future prompts', () => {
    const first = selectLayoutReferences({ referenceIds: ['sf-wharf'] });
    first.examples[0].cluster.objects.length = 0;
    expect(
      selectLayoutReferences({ referenceIds: ['sf-wharf'] }).examples[0].cluster.objects.length,
    ).toBeGreaterThan(0);
  });
});
