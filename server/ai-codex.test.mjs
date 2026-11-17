import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { CodexRpc, codexEnvironment, SAFE_CONFIG, codexFailureSummary } from './ai-codex.mjs';

function fakeProcess() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => {
    queueMicrotask(() => child.emit('exit', 0));
    return true;
  });
  return child;
}

describe('local Codex protocol boundary', () => {
  it('strips keys and inherited runtime overrides from the child environment', () => {
    const actual = codexEnvironment(
      {
        PATH: 'bin',
        HOME: 'user',
        OPENAI_API_KEY: 'secret',
        CODEX_HOME: 'shared',
        CODEX_ACCESS_TOKEN: 'secret2',
        NODE_OPTIONS: '--require malicious.js',
        CUSTOM_SECRET: 'secret3',
      },
      'isolated',
    );
    expect(actual).toEqual({ PATH: 'bin', HOME: 'user', CODEX_HOME: 'isolated' });
    expect(SAFE_CONFIG['features.shell_tool']).toBe(false);
    expect(SAFE_CONFIG['features.plugins']).toBe(false);
    expect(SAFE_CONFIG['features.hooks']).toBe(false);
    expect(SAFE_CONFIG.web_search).toBe('disabled');
  });
  it('correlates split JSON lines and refuses all server tool or approval requests', async () => {
    const child = fakeProcess();
    const rpc = new CodexRpc(child);
    const sent = [];
    child.stdin.on('data', (chunk) => sent.push(JSON.parse(chunk.toString())));
    const result = rpc.request('account/read');
    child.stdout.write('{"id":1,"result":');
    child.stdout.write('{"account":null}}\n');
    expect(await result).toEqual({ account: null });
    const listener = vi.fn();
    rpc.listeners.add(listener);
    child.stdout.write('{"id":99,"method":"item/commandExecution/requestApproval","params":{}}\n');
    expect(sent.at(-1)).toEqual({
      id: 99,
      error: {
        code: -32601,
        message: 'Wordscape does not permit tools, approvals or credential forwarding.',
      },
    });
    expect(listener).toHaveBeenCalledWith({ method: 'wordscape/forbiddenTool', params: {} });
    rpc.close();
  });
  it('never forwards raw provider error text and closes malformed protocol streams', async () => {
    const child = fakeProcess();
    const rpc = new CodexRpc(child);
    const request = rpc.request('account/read');
    child.stdout.write('{"id":1,"error":{"code":401,"message":"token=private-secret"}}\n');
    await expect(request).rejects.toThrow('Codex account/read rejected (401)');
    const pending = rpc.request('model/list');
    child.stdout.write('not-json\n');
    await expect(pending).rejects.toThrow(/invalid protocol/i);
    expect(child.kill).toHaveBeenCalled();
  });
  it('waits for process exit before reporting shutdown complete', async () => {
    const child = fakeProcess();
    child.kill.mockImplementation(() => true);
    const rpc = new CodexRpc(child);
    let stopped = false;
    const closed = Promise.resolve(rpc.close()).then((result) => {
      stopped = true;
      return result;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    child.emit('exit', 0);
    expect(await closed).toBe(true);
    expect(rpc.close()).toBe(rpc.close());
  });
  it('reports only recognized error categories and status codes, never provider detail', () => {
    expect(
      codexFailureSummary({
        codexErrorInfo: { responseStreamConnectionFailed: { httpStatusCode: 400 } },
        message: 'Authorization: Bearer private-token',
      }),
    ).toBe('responseStreamConnectionFailed; HTTP 400');
    expect(
      codexFailureSummary({ codexErrorInfo: 'usageLimitExceeded', message: 'private-token' }),
    ).toBe('usageLimitExceeded');
    expect(codexFailureSummary({ codexErrorInfo: 'private-token', message: 'private-token' })).toBe(
      'unknown provider error',
    );
  });
});
