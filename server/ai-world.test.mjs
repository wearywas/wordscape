import { describe, expect, it, vi } from 'vitest';
import { createAiService } from './ai.mjs';
import {
  buildWorldGenerationPrompt,
  prepareWorldGeneration,
  worldGenerationSchema,
  reviewWorldGeneration,
} from '../src/world/worldGeneration.ts';

const request = () => ({
  provider: 'codex',
  mode: 'create',
  size: 180,
  prompt: 'A quiet canal courtyard.',
});
const proposal = () => ({
  summary: 'A coherent authored district.',
  name: 'Quiet Courts',
  description: 'Imaginary courtyards beside a route.',
  changes: [],
  relations: [],
  additions: Array.from({ length: 20 }, (_, index) => ({
    id: `court-${index}`,
    label: `Court ${index}`,
    kind: 'building',
    description: 'An authored building.',
    x: 20 + (index % 5) * 30,
    y: 20 + Math.floor(index / 5) * 30,
    width: 10,
    depth: 10,
    height: 9,
    elevation: 0,
    rotation: 0,
    layer: 1,
    parentId: null,
    tags: [],
    facts: [],
    geometry: null,
  })),
});

describe('whole-world provider integration', () => {
  it('passes explicit terrain authoring through the provider schema and rejects unrequested terrain', async () => {
    const output = {
      ...proposal(),
      terrain: {
        type: 'analytic-heightfield',
        version: 1,
        evidence: 'authored',
        baseElevation: 0,
        features: [{ x: 0.5, y: 0.5, radiusX: 0.4, radiusY: 0.3, height: 30, rotation: 0 }],
      },
    };
    const generate = vi.fn(async () => ({ text: JSON.stringify(output), model: 'test-model' }));
    const service = createAiService({ clientFactory: async () => ({ generate, close() {} }) });
    try {
      const result = await service.generateWorld({ ...request(), terrainMode: 'author' });
      expect(result.proposal.terrain).toEqual(output.terrain);
      expect(generate.mock.calls[0][0].schema.properties.terrain.properties.evidence.const).toBe(
        'authored',
      );
      expect(generate.mock.calls[0][0].prompt).toContain('TERRAIN_MODE=author');
      await expect(service.generateWorld(request())).rejects.toThrow(
        /terrain.*author|terrain.*preserv/i,
      );
      expect(worldGenerationSchema(request()).properties.terrain).toEqual({ type: 'null' });
      const protectedWorld = reviewWorldGeneration(
        { ...request(), terrainMode: 'author' },
        result,
      ).world;
      protectedWorld.objects[0].evidence = 'observed';
      generate.mockClear();
      await expect(
        service.generateWorld({
          provider: 'codex',
          mode: 'revise',
          world: protectedWorld,
          terrainMode: 'author',
        }),
      ).rejects.toThrow(/protected/i);
      expect(generate).not.toHaveBeenCalled();
    } finally {
      await service.close();
    }
  });
  it('gives whole-world requests six minutes while retaining the three-minute object deadline', async () => {
    vi.useFakeTimers();
    let activeSignal;
    const service = createAiService({
      clientFactory: async () => ({
        generate: (_input, { signal }) =>
          new Promise((_resolve, reject) => {
            activeSignal = signal;
            signal.addEventListener('abort', () => reject(new Error('Deadline reached')), {
              once: true,
            });
          }),
        close() {},
      }),
    });
    const objectRequest = {
      provider: 'codex',
      prompt: 'Add a detail.',
      context: {
        worldName: 'Existing',
        objects: [{ ...proposal().additions[0], geometry: undefined }],
      },
    };
    try {
      const objectOutcome = service.generate(objectRequest).catch((error) => error);
      await vi.advanceTimersByTimeAsync(179999);
      expect(activeSignal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(activeSignal.aborted).toBe(true);
      expect((await objectOutcome).message).toMatch(/timed out/);
      expect(vi.getTimerCount()).toBe(0);

      const worldOutcome = service.generateWorld(request()).catch((error) => error);
      await vi.advanceTimersByTimeAsync(180000);
      expect(activeSignal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(179999);
      expect(activeSignal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(activeSignal.aborted).toBe(true);
      expect((await worldOutcome).message).toMatch(/timed out/);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await service.close();
      vi.useRealTimers();
    }
  });
  it('honors explicit deadline overrides on both paths and clears the longer timer on cancellation', async () => {
    vi.useFakeTimers();
    const services = [];
    let activeSignal;
    const makeService = (options = {}) => {
      const service = createAiService({
        ...options,
        clientFactory: async () => ({
          generate: (_input, { signal }) =>
            new Promise((_resolve, reject) => {
              activeSignal = signal;
              signal.addEventListener('abort', () => reject(new Error('Stopped')), { once: true });
            }),
          close() {},
        }),
      });
      services.push(service);
      return service;
    };
    const objectRequest = {
      provider: 'codex',
      prompt: 'Add a detail.',
      context: {
        worldName: 'Existing',
        objects: [{ ...proposal().additions[0], geometry: undefined }],
      },
    };
    try {
      for (const method of ['generate', 'generateWorld']) {
        const service = makeService({ timeoutMs: 50 });
        const outcome = service[method](method === 'generate' ? objectRequest : request()).catch(
          (error) => error,
        );
        await vi.advanceTimersByTimeAsync(49);
        expect(activeSignal.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(activeSignal.aborted).toBe(true);
        expect((await outcome).message).toMatch(/timed out/);
        expect(vi.getTimerCount()).toBe(0);
      }
      const service = makeService();
      const outcome = service.generateWorld(request()).catch((error) => error);
      await vi.advanceTimersByTimeAsync(180001);
      expect(activeSignal.aborted).toBe(false);
      expect(await service.cancel()).toEqual({ cancelled: true });
      expect((await outcome).message).toMatch(/cancelled/i);
      expect(activeSignal.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(360000);
      expect(await service.cancel()).toEqual({ cancelled: false });
    } finally {
      for (const service of services) await service.close();
      vi.useRealTimers();
    }
  });
  it('uses the existing isolated provider with strict scene output and validates before returning', async () => {
    const generate = vi.fn(async () => ({ text: JSON.stringify(proposal()), model: 'test-model' }));
    const service = createAiService({ clientFactory: async () => ({ generate, close() {} }) });
    try {
      const result = await service.generateWorld(request());
      expect(result.proposal.additions).toHaveLength(20);
      expect(result.context).toEqual({ includedObjects: 0, omittedObjects: 0 });
      expect(generate.mock.calls[0][0].schema).toEqual(worldGenerationSchema(request()));
      expect(generate.mock.calls[0][0].prompt).toContain('A quiet canal courtyard.');
    } finally {
      await service.close();
    }
  });
  it('binds result provenance to provided examples and asks for nullable authored footprints', async () => {
    const output = proposal();
    output.additions[0].footprint = [
      [-5, -5],
      [5, -5],
      [3, 5],
      [-5, 3],
    ];
    const generate = vi.fn(async () => ({ text: JSON.stringify(output), model: 'test-model' }));
    const service = createAiService({ clientFactory: async () => ({ generate, close() {} }) });
    try {
      const input = { ...request(), layout: 'clustered', referenceIds: ['monaco-old-town'] };
      const result = await service.generateWorld(input);
      expect(result.referenceIds).toEqual(input.referenceIds);
      expect(result.layout).toBe('clustered');
      const call = generate.mock.calls[0][0];
      expect(call.schema.properties.additions.items.required).toContain('footprint');
      expect(call.schema.properties.additions.items.properties.footprint.anyOf).toContainEqual({
        type: 'null',
      });
      const supplied = JSON.parse(call.prompt.split('LAYOUT_EXAMPLES=')[1].split('\n')[0]);
      expect(supplied.map((example) => example.id)).toEqual(input.referenceIds);
      expect(Buffer.byteLength(call.prompt)).toBeLessThanOrEqual(200 * 1024);
      expect(result.proposal.additions[0].footprint).toEqual(output.additions[0].footprint);
    } finally {
      await service.close();
    }
  });
  it('rejects invented reference input before provider contact and forged model provenance afterward', async () => {
    const generate = vi.fn(async () => ({
      text: JSON.stringify({ ...proposal(), referenceIds: ['made-up-source'] }),
      model: 'test-model',
    }));
    const service = createAiService({ clientFactory: async () => ({ generate, close() {} }) });
    try {
      await expect(
        service.generateWorld({ ...request(), referenceIds: ['not-in-corpus'] }),
      ).rejects.toThrow(/unknown/i);
      expect(generate).not.toHaveBeenCalled();
      await expect(service.generateWorld(request())).rejects.toThrow(
        /unexpected field referenceIds/,
      );
    } finally {
      await service.close();
    }
  });
  it('rejects malformed placements and invalid requests without applying a world', async () => {
    const output = proposal();
    output.additions[0].x = -5;
    const generate = vi.fn(async () => ({ text: JSON.stringify(output), model: 'test-model' }));
    const service = createAiService({ clientFactory: async () => ({ generate, close() {} }) });
    try {
      await expect(service.generateWorld({ ...request(), provider: 'remote' })).rejects.toThrow(
        /provider/i,
      );
      expect(generate).not.toHaveBeenCalled();
      await expect(service.generateWorld(request())).rejects.toThrow(/Addition x/i);
    } finally {
      await service.close();
    }
  });
  it('shares busy/cancel state with object generation, never implicitly falls back to API', async () => {
    let started;
    const ready = new Promise((resolve) => {
      started = resolve;
    });
    const fetchFn = vi.fn();
    const service = createAiService({
      env: { OPENAI_API_KEY: 'test-only' },
      fetchFn,
      clientFactory: async () => ({
        generate: (_input, { signal }) =>
          new Promise((_resolve, reject) => {
            started();
            signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true });
          }),
        close() {},
      }),
    });
    const pending = service.generateWorld(request());
    await ready;
    await expect(service.generateWorld(request())).rejects.toThrow(/already running/);
    await expect(
      service.generate({
        provider: 'codex',
        prompt: 'Add a detail.',
        context: {
          worldName: 'Existing',
          objects: [{ ...proposal().additions[0], geometry: undefined }],
        },
      }),
    ).rejects.toThrow(/already running/);
    await service.cancel();
    await expect(pending).rejects.toThrow(/cancelled/i);
    expect(fetchFn).not.toHaveBeenCalled();
    await service.close();
  });
  it('allows optional briefs and includes coordinate safety and advisory guide provenance', () => {
    expect(prepareWorldGeneration({ provider: 'codex', mode: 'create' }).prompt).toBe('');
    const prompt = buildWorldGenerationPrompt(request());
    expect(prompt).toContain('20–60');
    expect(prompt).toContain('PART CENTRE');
    expect(prompt).toContain('LAYOUT_GUIDE=');
    expect(prompt).toContain('not universal rules');
    expect(prompt).toContain('No tools');
  });
  it('uses only explicitly selected API billing with strict output and no tools', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: 'completed',
            output: [
              {
                type: 'message',
                content: [{ type: 'output_text', text: JSON.stringify(proposal()) }],
              },
            ],
          }),
        ),
    );
    const service = createAiService({
      env: { OPENAI_API_KEY: 'test-only', WORDSCAPE_API_MODEL: 'test-model' },
      fetchFn,
    });
    try {
      const result = await service.generateWorld({ ...request(), provider: 'api' });
      expect(result.provider).toBe('api');
      const body = JSON.parse(fetchFn.mock.calls[0][1].body);
      expect(body.tools).toEqual([]);
      expect(body.store).toBe(false);
      expect(body.max_output_tokens).toBe(24000);
      expect(body.text.format.schema).toEqual(worldGenerationSchema(request()));
      expect(body.text.format.strict).toBe(true);
    } finally {
      await service.close();
    }
  });
});
