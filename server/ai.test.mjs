import { describe, expect, it, vi } from 'vitest';
import { createAiService, validateAiRequest, validateAiProposal, buildAiPrompt } from './ai.mjs';

const object = {
  id: 'church',
  label: 'Church',
  kind: 'building',
  description: 'Observed footprint; inferred height.',
  x: 10,
  y: 10,
  width: 20,
  depth: 30,
  height: 12,
  elevation: 0,
  rotation: 0,
  layer: 1,
  evidence: 'inferred',
};
const request = () => ({
  provider: 'codex',
  prompt: 'Suggest a restrained facade.',
  context: { worldName: 'Test', objects: [object] },
});
const proposal = () => ({
  summary: 'A proposed detail.',
  changes: [{ objectId: 'church', description: 'Authored facade interpretation.', geometry: null }],
});

describe('bounded AI proposal contract', () => {
  it('explains part-centre axes and includes a slab example that passes the shared validator', () => {
    const prompt = buildAiPrompt(request());
    expect(prompt).toContain('position = [east, up, north]');
    expect(prompt).toContain('dimensions = [width, height, depth]');
    expect(prompt).toContain('centre, not its bottom');
    expect(prompt).toContain('abs(east) + width/2 <= 0.5');
    expect(prompt).toContain('up - height/2 >= 0');
    expect(prompt).toContain('up + height/2 <= 1');
    expect(prompt).toContain('abs(north) + depth/2 <= 0.5');
    const example = JSON.parse(prompt.split('VALID_SLAB_EXAMPLE=')[1].split('\n')[0]);
    expect(
      validateAiProposal(
        {
          summary: 'Example',
          changes: [{ objectId: 'church', description: 'Authored example.', geometry: example }],
        },
        request(),
      ),
    ).toBeTruthy();
  });
  it('rejects unselected IDs, duplicate changes and unknown executable fields', () => {
    expect(() =>
      validateAiProposal(
        { ...proposal(), changes: [{ ...proposal().changes[0], objectId: 'other' }] },
        request(),
      ),
    ).toThrow(/selected/i);
    expect(() =>
      validateAiProposal(
        { ...proposal(), changes: [proposal().changes[0], proposal().changes[0]] },
        request(),
      ),
    ).toThrow(/duplicate/i);
    expect(() => validateAiProposal({ ...proposal(), script: 'alert(1)' }, request())).toThrow(
      /unexpected/i,
    );
  });
  it('rejects oversized prompts, too many objects and arbitrary providers', () => {
    expect(() => validateAiRequest({ ...request(), prompt: 'x'.repeat(4001) })).toThrow(/prompt/i);
    expect(() =>
      validateAiRequest({
        ...request(),
        context: { worldName: 'x', objects: Array(4).fill(object) },
      }),
    ).toThrow(/three|3/i);
    expect(() => validateAiRequest({ ...request(), provider: 'https://evil.test' })).toThrow(
      /provider/i,
    );
  });
  it('rejects non-finite context and an unsafe geometry recipe', () => {
    expect(() =>
      validateAiRequest({
        ...request(),
        context: { worldName: 'x', objects: [{ ...object, width: Infinity }] },
      }),
    ).toThrow(/width/i);
    expect(() =>
      validateAiProposal(
        {
          ...proposal(),
          changes: [{ ...proposal().changes[0], geometry: { type: 'script', code: 'alert(1)' } }],
        },
        request(),
      ),
    ).toThrow(/geometry/i);
  });
});

describe('AI provider lifecycle', () => {
  it('validates before contacting a provider and never falls back to paid API implicitly', async () => {
    const generate = vi.fn().mockRejectedValue(new Error('Codex unavailable'));
    const apiFetch = vi.fn();
    const service = createAiService({
      clientFactory: async () => ({ generate, close() {} }),
      fetchFn: apiFetch,
      env: { OPENAI_API_KEY: 'test-only' },
    });
    await expect(service.generate({ ...request(), prompt: '' })).rejects.toThrow(/prompt/i);
    expect(generate).not.toHaveBeenCalled();
    await expect(service.generate(request())).rejects.toThrow(/Codex unavailable/);
    expect(apiFetch).not.toHaveBeenCalled();
    await service.close();
  });
  it('prevents concurrent generations and cancels the current operation', async () => {
    let started;
    const ready = new Promise((resolve) => {
      started = resolve;
    });
    const service = createAiService({
      clientFactory: async () => ({
        generate: (_request, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('Generation cancelled')), {
              once: true,
            });
            started();
          }),
        close() {},
      }),
    });
    const active = service.generate(request());
    await ready;
    await expect(service.generate(request())).rejects.toThrow(/already/i);
    expect(await service.cancel()).toEqual({ cancelled: true });
    await expect(active).rejects.toThrow(/cancelled/i);
    expect(await service.cancel()).toEqual({ cancelled: false });
    await service.close();
  });
  it('returns a validated proposal without changing the submitted object', async () => {
    const input = request();
    const before = JSON.stringify(input);
    const service = createAiService({
      clientFactory: async () => ({
        generate: async () => ({ text: JSON.stringify(proposal()), model: 'test-model' }),
        close() {},
      }),
    });
    expect(await service.generate(input)).toEqual({
      proposal: proposal(),
      provider: 'codex',
      model: 'test-model',
    });
    expect(JSON.stringify(input)).toBe(before);
    await service.close();
  });
  it('rejects malformed model output and reconnects for the next request', async () => {
    const close = vi.fn();
    const clientFactory = vi
      .fn()
      .mockResolvedValueOnce({ generate: async () => ({ text: 'not JSON', model: 'test' }), close })
      .mockResolvedValueOnce({
        generate: async () => ({ text: JSON.stringify(proposal()), model: 'test' }),
        close,
      });
    const service = createAiService({ clientFactory });
    await expect(service.generate(request())).rejects.toThrow(/JSON proposal/);
    expect(close).toHaveBeenCalledTimes(1);
    expect((await service.generate(request())).proposal).toEqual(proposal());
    expect(clientFactory).toHaveBeenCalledTimes(2);
    await service.close();
  });
  it('preserves the original generation error when cleanup also fails', async () => {
    const original = new Error('Original structured-output failure');
    const service = createAiService({
      clientFactory: async () => ({
        generate: async () => {
          throw original;
        },
        close: async () => {
          throw new Error('EBUSY temporary directory');
        },
      }),
    });
    await expect(service.generate(request())).rejects.toBe(original);
    await service.close();
  });
  it('keeps the API key server-side, requests no tools and caps output', async () => {
    const apiFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: JSON.stringify(proposal()) }],
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const service = createAiService({
      fetchFn: apiFetch,
      env: { OPENAI_API_KEY: 'test-only-secret' },
    });
    const result = await service.generate({ ...request(), provider: 'api', model: 'test-model' });
    const [url, options] = apiFetch.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(options.headers.Authorization).toBe('Bearer test-only-secret');
    const body = JSON.parse(options.body);
    expect(body.tools).toEqual([]);
    expect(body.max_output_tokens).toBeLessThanOrEqual(12000);
    expect(body.store).toBe(false);
    expect(JSON.stringify(result)).not.toContain('test-only-secret');
    await service.close();
  });
});
