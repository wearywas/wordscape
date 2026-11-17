import { describe, it, expect } from 'vitest';
import { makeObject, parseWorld, serializeWorld } from './document';
import { createContainerPacket } from './packet';
import type { WorldDocument } from './types';

describe('container packets', () => {
  it('keeps the full terrain grid and its source even when no object directly cites that source', () => {
    const object = { ...makeObject('building', 40, 40), id: 'root', grounding: 'terrain' as const };
    const source = {
      id: 'dem',
      title: 'DEM',
      url: '',
      attribution: 'Test',
      accessed: '',
      notes: '',
    };
    const world: WorldDocument = {
      format: 'wordscape',
      version: '0.3',
      name: 'Terrain packet',
      description: '',
      units: 'metres',
      bounds: { width: 100, depth: 100 },
      origin: { latitude: 0, longitude: 0, note: '' },
      seed: 1,
      objects: [object],
      sources: [source],
      relations: [],
      terrain: {
        type: 'height-grid',
        columns: 2,
        rows: 2,
        spacing: 100,
        origin: { x: 0, y: 0 },
        heights: [10, 20, 30, 40],
        verticalDatum: 'Test datum',
        referenceElevation: 10,
        sourceId: 'dem',
        sourceResolution: 1,
        interpolation: 'bilinear',
      },
    };
    const packet = createContainerPacket(world, 'root');
    expect(packet.terrain).toEqual(world.terrain);
    expect(packet.terrain).not.toBe(world.terrain);
    expect(packet.sources).toEqual([source]);
    expect(parseWorld(serializeWorld(packet))).toEqual(packet);
  });
  it('preserves child coordinates, facts and their sources without dangling external references', () => {
    const root = {
      ...makeObject('building', 40, 40),
      id: 'root',
      parentId: 'outside',
      facts: [
        { key: 'building.levels', value: 3, evidence: 'sourced' as const, sourceIds: ['facts'] },
      ],
    };
    const child = {
      ...makeObject('fixture', 42, 41),
      id: 'child',
      parentId: 'root',
      references: [{ sourceId: 'photo', role: 'photo' as const }],
    };
    const outside = { ...makeObject('grass', 50, 50), id: 'outside' };
    const source = {
      title: 'Source',
      url: 'https://example.com',
      attribution: 'Test',
      accessed: '2026-11-15',
      notes: '',
    };
    const world: WorldDocument = {
      format: 'wordscape',
      version: '0.2',
      name: 'Fixture',
      description: '',
      units: 'metres',
      bounds: { width: 100, depth: 100 },
      origin: { latitude: 0, longitude: 0, note: '' },
      seed: 1,
      objects: [root, child, outside],
      sources: [
        { ...source, id: 'facts' },
        { ...source, id: 'photo' },
        { ...source, id: 'unused' },
      ],
      relations: [
        { from: 'root', to: 'child', type: 'within' },
        { from: 'root', to: 'outside', type: 'near' },
      ],
    };
    const packet = createContainerPacket(world, 'root');
    expect(packet.objects.map((object) => object.id)).toEqual(['root', 'child']);
    expect(packet.objects[0].parentId).toBeUndefined();
    expect(packet.objects[1]).toEqual(child);
    expect(packet.sources.map((source) => source.id)).toEqual(['facts', 'photo']);
    expect(packet.relations).toEqual([{ from: 'root', to: 'child', type: 'within' }]);
    expect(parseWorld(serializeWorld(packet))).toEqual(packet);
    expect(world.objects[0].parentId).toBe('outside');
    packet.objects[0].label = 'Changed';
    expect(world.objects[0].label).not.toBe('Changed');
  });

  it('preserves a valid Unicode placement label in the packet name', () => {
    const label = '🌳'.repeat(150);
    const object = { ...makeObject('tree', 10, 10), id: 'root', label };
    const world: WorldDocument = {
      format: 'wordscape',
      version: '0.2',
      name: 'Unicode',
      description: '',
      units: 'metres',
      bounds: { width: 100, depth: 100 },
      origin: { latitude: 0, longitude: 0, note: '' },
      seed: 1,
      objects: [object],
      sources: [],
      relations: [],
    };
    expect(createContainerPacket(world, 'root').name).toBe(`${label} — container`);
  });

  it('exports an accepted near-limit container without metadata pushing it beyond the import budget', () => {
    const root = { ...makeObject('fixture', 10, 10), id: 'root', label: 'Root' };
    const world: WorldDocument = {
      format: 'wordscape',
      version: '0.2',
      name: 'Near limit',
      description: '',
      units: 'metres',
      bounds: { width: 100, depth: 100 },
      origin: { latitude: 0, longitude: 0, note: '' },
      seed: 1,
      objects: [root],
      sources: [],
      relations: [],
    };
    for (let index = 0; index < 499; index++)
      world.objects.push({ ...root, id: `child-${index}`, parentId: 'root' });
    let remaining =
      4 * 1024 * 1024 - 64 - new TextEncoder().encode(JSON.stringify(world)).byteLength;
    for (const object of world.objects) {
      const length = Math.min(10000, remaining);
      object.description = 'x'.repeat(length);
      remaining -= length;
    }
    expect(remaining).toBe(0);
    const accepted = parseWorld(serializeWorld(world, false));
    const packet = createContainerPacket(accepted, 'root');
    expect(parseWorld(serializeWorld(packet)).objects).toEqual(world.objects);
  });
});
