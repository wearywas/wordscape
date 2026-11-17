import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { startDev } from './dev.mjs';

function setup(platform) {
  let pid = 100;
  const spawnFn = vi.fn(() => {
    const child = new EventEmitter();
    child.pid = ++pid;
    child.kill = vi.fn();
    return child;
  });
  const processObject = new EventEmitter();
  processObject.execPath = 'node';
  processObject.stderr = { write: vi.fn() };
  processObject.exitCode = undefined;
  const dev = startDev({ spawnFn, processObject, platform });
  return { dev, spawnFn, processObject };
}
describe('development service lifecycle', () => {
  it('stops both owned child process trees after a Windows startup failure', () => {
    const { dev, spawnFn, processObject } = setup('win32');
    dev.children[0].emit('error', new Error('port unavailable'));
    expect(processObject.exitCode).toBe(1);
    expect(spawnFn.mock.calls.slice(2).map(([command, args]) => [command, args])).toEqual([
      ['taskkill', ['/PID', '101', '/T', '/F']],
      ['taskkill', ['/PID', '102', '/T', '/F']],
    ]);
    for (const [, , options] of spawnFn.mock.calls) expect(options.windowsHide).toBe(true);
    dev.close();
    expect(spawnFn).toHaveBeenCalledTimes(4);
  });
  it('shuts down gracefully on SIGINT and treats an unexpected clean child exit as failure', () => {
    const stopped = setup('linux');
    stopped.processObject.emit('SIGINT');
    expect(stopped.processObject.exitCode).toBe(0);
    expect(stopped.dev.children.every((child) => child.kill.mock.calls.length === 1)).toBe(true);
    const failed = setup('linux');
    failed.dev.children[1].emit('exit', 0);
    expect(failed.processObject.exitCode).toBe(1);
  });
});
