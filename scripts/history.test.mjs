import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exportScript = fileURLToPath(new URL('./export-history.mjs', import.meta.url));
const finalizeScript = fileURLToPath(new URL('./finalize-history.mjs', import.meta.url));
const rootId = '01a1e1f7-817a-7811-8ab8-0c113f98b64b';
const temporary = [];
const prompts = [
  'Good evening GPT!',
  "That's awesome -- thank you so much, GPT!",
  'satellite imagery and isometric maps in general obviously obscure elevation',
  'have the user specify a map section somewhere in the world',
  "slice around Fisherman's wharf",
  'Google Maps has a Terrain mode',
  'deploy some agents to map a sampling of real-world places',
  'refine the world generation a bit',
  'For general polish',
  'shall we go ahead and do our final prep?',
];
const row = (type, payload) => ({ timestamp: '2026-11-18T22:00:00Z', type, payload });
const message = (role, text, phase) =>
  row('response_item', {
    type: 'message',
    role,
    ...(phase ? { phase } : {}),
    content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }],
  });

async function fixture({ complete = false } = {}) {
  const project = await mkdtemp(path.join(tmpdir(), 'wordscape-history-test-'));
  temporary.push(project);
  const codexHome = path.join(project, 'codex-fixture');
  const sessions = path.join(codexHome, 'sessions');
  await mkdir(sessions, { recursive: true });
  await mkdir(path.join(project, 'docs'), { recursive: true });
  await writeFile(path.join(project, '.gitignore'), '.history-private/\n');
  await writeFile(
    path.join(project, 'docs/PROMPT_LEDGER.md'),
    prompts
      .map((_, i) => `| [${i + 1}](history/prompt.md) | Purpose | Outcome ${i + 1} |`)
      .join('\n'),
  );
  const rows = [
    row('session_meta', { id: rootId, originator: 'Recorded client', cli_version: '1.2.3' }),
    message('user', '# AGENTS.md instructions\nPreserve these exact instructions.'),
  ];
  prompts.forEach((prompt, i) => {
    rows.push(
      row('event_msg', { type: 'task_started', turn_id: `turn-${i + 1}` }),
      row('turn_context', { turn_id: `turn-${i + 1}`, model: 'recorded-model' }),
      message('user', prompt),
    );
    if (i < 9 || complete) {
      const text = `Actual reply ${i + 1}`;
      rows.push(
        message('assistant', text, 'final_answer'),
        row('event_msg', {
          type: 'task_complete',
          turn_id: `turn-${i + 1}`,
          last_agent_message: text,
        }),
      );
    }
  });
  const file = path.join(sessions, `rollout-2026-11-18-${rootId}.jsonl`);
  async function save() {
    await writeFile(file, rows.map(JSON.stringify).join('\n') + '\n');
  }
  await save();
  for (const task of ['survey', 'world_engine', 'renderer']) {
    const child = [
      row('session_meta', {
        id: `${task}-id`,
        originator: 'Child client',
        cli_version: '4.5.6',
        source: {
          subagent: { thread_spawn: { parent_thread_id: rootId, agent_path: `/root/${task}` } },
        },
      }),
      row('turn_context', { model: 'child-recorded-model' }),
      message('assistant', `Readable ${task} dialogue`, 'commentary'),
      row('response_item', {
        type: 'agent_message',
        author: '/root',
        recipient: `/root/${task}`,
        content: [
          { type: 'input_text', text: 'Automatic task\n' },
          { type: 'encrypted_content', encrypted_content: 'PRIVATE_ENCRYPTED_BYTES' },
        ],
      }),
    ];
    await writeFile(
      path.join(sessions, `rollout-2026-11-18-${task}.jsonl`),
      child.map(JSON.stringify).join('\n') + '\n',
    );
  }
  return { project, codexHome, rows, save, file };
}

function run(script, f) {
  return spawnSync(process.execPath, [script], {
    cwd: f.project,
    env: { ...process.env, CODEX_HOME: f.codexHome },
    encoding: 'utf8',
  });
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

it('exports all ten exact prompts, combined outcomes and recorded metadata without pretending an active reply is complete', async () => {
  const f = await fixture();
  const result = run(exportScript, f);
  expect(result.status, result.stderr).toBe(0);
  expect(await readFile(path.join(f.project, 'docs/history/prompt-10.md'), 'utf8')).toContain(
    prompts[9],
  );
  const combined = await readFile(path.join(f.project, 'docs/history/prompts-all.md'), 'utf8');
  expect(combined).toContain('Outcome 10');
  expect(combined).toContain('Preserve these exact instructions.');
  const manifest = JSON.parse(
    await readFile(path.join(f.project, 'docs/history/export-manifest.json'), 'utf8'),
  );
  expect(manifest.finalReply.complete).toBe(false);
  expect(manifest.conversations).toHaveLength(4);
  expect(manifest.conversations.find((c) => c.task === 'main')).toMatchObject({
    client: 'Recorded client',
    clientVersion: '1.2.3',
    models: ['recorded-model'],
  });
  expect(manifest.conversations.find((c) => c.task === 'survey').models).toEqual([
    'child-recorded-model',
  ]);
});

it('fails finalization until the actual final message and matching task completion are both recorded', async () => {
  const f = await fixture();
  expect(run(finalizeScript, f).status).toBe(1);
  f.rows.push(message('assistant', 'Actual reply 10', 'final_answer'));
  await f.save();
  expect(run(finalizeScript, f).status).toBe(1);
  f.rows.push(
    row('event_msg', {
      type: 'task_complete',
      turn_id: 'other-turn',
      last_agent_message: 'Actual reply 10',
    }),
  );
  await f.save();
  expect(run(finalizeScript, f).status).toBe(1);
  f.rows.push(
    row('event_msg', {
      type: 'task_complete',
      turn_id: 'turn-10',
      last_agent_message: 'Actual reply 10',
    }),
  );
  await f.save();
  const result = run(finalizeScript, f);
  expect(result.status, result.stderr).toBe(0);
  const manifest = JSON.parse(
    await readFile(path.join(f.project, 'docs/history/export-manifest.json'), 'utf8'),
  );
  expect(manifest.finalReply).toMatchObject({ complete: true, turnId: 'turn-10' });
  expect(await readFile(path.join(f.project, 'docs/history/main.md'), 'utf8')).toContain(
    'Actual reply 10',
  );
});

it('preserves originals byte-for-byte while redacting public credentials, profile paths and encrypted attachment content', async () => {
  const f = await fixture({ complete: true });
  const secret = `sk-${'a'.repeat(30)}`;
  f.rows.push(
    message('assistant', `Path C:\\Users\\gary\\private.txt key ${secret}`, 'commentary'),
  );
  f.rows.push(
    row('response_item', {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_image', image_url: 'data:image/png;base64,PRIVATE_IMAGE_BYTES' }],
    }),
  );
  await f.save();
  const result = run(exportScript, f);
  expect(result.status, result.stderr).toBe(0);
  const main = await readFile(path.join(f.project, 'docs/history/main.md'), 'utf8');
  expect(main).not.toContain(secret);
  expect(main).not.toContain('C:\\Users\\gary');
  expect(main).not.toContain('PRIVATE_IMAGE_BYTES');
  const child = await readFile(path.join(f.project, 'docs/history/world_engine.md'), 'utf8');
  expect(child).toContain('encrypted');
  expect(child).not.toContain('PRIVATE_ENCRYPTED_BYTES');
  expect(
    await readFile(path.join(f.project, '.history-private', path.basename(f.file)), 'utf8'),
  ).toBe(await readFile(f.file, 'utf8'));
});

it('rejects missing or duplicate prompts and malformed complete JSONL rather than silently exporting a complete history', async () => {
  const f = await fixture({ complete: true });
  f.rows.push(message('user', prompts[9]));
  await f.save();
  expect(run(finalizeScript, f).status).toBe(1);
  f.rows.pop();
  const originalPrompt = f.rows.find((entry) => entry.payload.content?.[0]?.text === prompts[9]);
  originalPrompt.payload.content[0].text = 'Unrecognized request';
  await f.save();
  expect(run(finalizeScript, f).status).toBe(1);
  originalPrompt.payload.content[0].text = prompts[9];
  await f.save();
  await writeFile(f.file, (await readFile(f.file, 'utf8')) + '{malformed}\n');
  expect(run(exportScript, f).status).toBe(1);
});
