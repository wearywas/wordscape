import { spawn } from 'node:child_process';
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDirectory = fileURLToPath(new URL('..', import.meta.url));

export function startDev({
  spawnFn = spawn,
  processObject = process,
  platform = process.platform,
} = {}) {
  const options = { cwd: projectDirectory, stdio: 'inherit', windowsHide: true, shell: false };
  const children = [
    spawnFn(processObject.execPath, ['--env-file-if-exists=.env', 'server/index.mjs'], options),
    spawnFn(
      processObject.execPath,
      ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'],
      options,
    ),
  ];
  let closing = false;
  const close = (code = 0) => {
    if (closing) return;
    closing = true;
    processObject.exitCode = code;
    for (const child of children) {
      if (platform === 'win32' && Number.isInteger(child.pid)) {
        // Terminate only the process trees this launcher created, including a
        // Codex subprocess. child.kill() alone leaves grandchildren on Windows.
        const killer = spawnFn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
          shell: false,
        });
        killer.on('error', () => child.kill());
        killer.on('exit', (exitCode) => {
          if (exitCode && child.exitCode === null) child.kill();
        });
      } else child.kill();
    }
  };
  for (const child of children) {
    child.on('error', (error) => {
      processObject.stderr.write(`${error.message}\n`);
      close(1);
    });
    child.on('exit', (code) => {
      if (!closing) close(code || 1);
    });
  }
  for (const event of ['SIGINT', 'SIGTERM']) processObject.on(event, () => close());
  return { children, close };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startDev();
