import { readFile, writeFile, mkdir, readdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// Export public-facing dialogue only; original JSONL stays in the ignored private archive.
// Tool traces remain in original sessions for private verification. No reasoning records are exported.
const rootId = '01a1e1f7-817a-7811-8ab8-0c113f98b64b';
const sessionsRoot = process.env.CODEX_HOME
  ? path.join(process.env.CODEX_HOME, 'sessions')
  : path.join(os.homedir(), '.codex', 'sessions');
const projectRoot = process.cwd();
const historyDir = path.join(projectRoot, 'docs', 'history');
const privateDir = path.join(projectRoot, '.history-private');
await mkdir(historyDir, { recursive: true });
await mkdir(privateDir, { recursive: true });

async function filesIn(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory()
        ? filesIn(path.join(dir, entry.name))
        : entry.name.endsWith('.jsonl')
          ? [path.join(dir, entry.name)]
          : [],
    ),
  );
  return nested.flat();
}
function redact(text) {
  return text
    .replace(
      /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,})/g,
      '[REDACTED: credential]',
    )
    .replace(/C:[\\/]Users[\\/]gary/gi, '[REDACTED: user profile path]');
}
function messageText(payload) {
  return (payload.content ?? [])
    .filter((part) => ['input_text', 'output_text', 'text'].includes(part.type))
    .map((part) => part.text)
    .join('\n');
}
const candidates = (await filesIn(sessionsRoot)).filter(
  (file) => path.basename(file) >= 'rollout-2026-11-15',
);
const records = [];
for (const file of candidates) {
  const text = await readFile(file, 'utf8');
  const rows = text
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  const meta = rows.find((row) => row.type === 'session_meta')?.payload;
  if (meta?.id !== rootId && meta?.source?.subagent?.thread_spawn?.parent_thread_id !== rootId)
    continue;
  records.push({ file, rows, meta });
}
if (!records.some((record) => record.meta.id === rootId))
  throw new Error(
    'Original project session not found. Preserve its JSONL and pass the correct CODEX_HOME.',
  );
const manifest = [];
for (const record of records) {
  const isRoot = record.meta.id === rootId;
  const task = isRoot
    ? 'main'
    : record.meta.source.subagent.thread_spawn.agent_path.split('/').at(-1);
  await copyFile(record.file, path.join(privateDir, path.basename(record.file)));
  const messages = record.rows.filter(
    (row) =>
      row.type === 'response_item' &&
      row.payload.type === 'message' &&
      ['user', 'assistant'].includes(row.payload.role) &&
      row.payload.channel !== 'analysis',
  );
  const modelNames = [
    ...new Set(
      record.rows
        .filter((row) => row.type === 'turn_context')
        .map((row) => row.payload.model)
        .filter(Boolean),
    ),
  ];
  const header = `# ${isRoot ? 'Wordscape main conversation' : `Automatic subagent: ${task}`}\n\nSession: ${record.meta.id}\n\nClient: ${record.meta.originator ?? 'Codex subagent'} ${record.meta.cli_version ?? ''}\n\nModels recorded: ${modelNames.join(', ') || 'see original session'}\n\nSnapshot generated: ${new Date().toISOString()}. This is a working snapshot; rerun after a turn ends to include its final response.\n\nContains all recorded user/assistant dialogue, including commentary. Original tool traces are retained in ignored .history-private/ and the original Codex sessions. Analysis/reasoning records are excluded. Redactions are marked explicitly. Automatic subagent instructions are not additional human prompts.\n`;
  const body = messages
    .map(
      (row, index) =>
        `\n---\n\n## ${index + 1}. ${row.payload.role === 'user' ? 'User / supplied context' : `Assistant${row.payload.channel ? ` (${row.payload.channel})` : ''}`}\n\n${redact(messageText(row.payload))}\n`,
    )
    .join('');
  await writeFile(path.join(historyDir, `${task}.md`), header + body);
  manifest.push({
    id: record.meta.id,
    task,
    originalRetained: true,
    models: modelNames,
    messages: messages.length,
  });
  if (isRoot) {
    const allUser = messages.filter((row) => row.payload.role === 'user');
    const firstPrompt = allUser.find((row) =>
      messageText(row.payload).includes('Good evening GPT!'),
    );
    if (firstPrompt)
      await writeFile(
        path.join(historyDir, 'prompt-01.md'),
        `# Prompt 1 — exact recorded text\n\n${redact(messageText(firstPrompt.payload))}\n`,
      );
    const secondPrompt = allUser.find((row) =>
      messageText(row.payload).includes("That's awesome -- thank you so much, GPT!"),
    );
    if (secondPrompt)
      await writeFile(
        path.join(historyDir, 'prompt-02.md'),
        `# Prompt 2 — exact recorded text\n\n${redact(messageText(secondPrompt.payload))}\n\nUser-supplied image: [comparison screenshot](attachments/prompt-02-reference.png). Preserved as build history; not used as a redistributed application basemap.\n`,
      );
    const thirdPrompt = allUser.find((row) =>
      messageText(row.payload).includes(
        'satellite imagery and isometric maps in general obviously obscure elevation',
      ),
    );
    if (thirdPrompt)
      await writeFile(
        path.join(historyDir, 'prompt-03.md'),
        `# Prompt 3 — exact recorded text\n\n${redact(messageText(thirdPrompt.payload))}\n`,
      );
    const fourthPrompt = allUser.find((row) =>
      messageText(row.payload).includes(
        'have the user specify a map section somewhere in the world',
      ),
    );
    if (fourthPrompt)
      await writeFile(
        path.join(historyDir, 'prompt-04.md'),
        `# Prompt 4 — exact recorded text\n\n${redact(messageText(fourthPrompt.payload))}\n`,
      );
    const fifthPrompt = allUser.find((row) =>
      messageText(row.payload).includes("slice around Fisherman's wharf"),
    );
    if (fifthPrompt)
      await writeFile(
        path.join(historyDir, 'prompt-05.md'),
        `# Prompt 5 — exact recorded text\n\n${redact(messageText(fifthPrompt.payload))}\n\nUser-supplied images: [Wharf 3D](attachments/prompt-05-wharf.png), [missing aerial](attachments/prompt-05-aerial.png). Retained as build-history evidence.\n`,
      );
    const sixthPrompt = allUser.find((row) =>
      messageText(row.payload).includes('Google Maps has a Terrain mode'),
    );
    if (sixthPrompt)
      await writeFile(
        path.join(historyDir, 'prompt-06.md'),
        `# Prompt 6 — exact recorded text\n\n${redact(messageText(sixthPrompt.payload))}\n\nUser-supplied images: [REDACTED: personal account UI; original four comparison images retained privately](attachments/prompt-06-images-redacted.md). They are build-history evidence, not application assets.\n`,
      );
    const seventhPrompt = allUser.find((row) =>
      messageText(row.payload).includes(
        'deploy some agents to map a sampling of real-world places',
      ),
    );
    if (seventhPrompt)
      await writeFile(
        path.join(historyDir, 'prompt-07.md'),
        `# Prompt 7 — exact recorded text\n\n${redact(messageText(seventhPrompt.payload))}\n`,
      );
    const eighthPrompt = allUser.find((row) =>
      messageText(row.payload).includes('refine the world generation a bit'),
    );
    if (eighthPrompt)
      await writeFile(
        path.join(historyDir, 'prompt-08.md'),
        `# Prompt 8 — exact recorded text\n\n${redact(messageText(eighthPrompt.payload))}\n`,
      );
    const ninthPrompt = allUser.find((row) =>
      messageText(row.payload).includes('For general polish'),
    );
    if (ninthPrompt)
      await writeFile(
        path.join(historyDir, 'prompt-09.md'),
        `# Prompt 9 — exact recorded text\n\n${redact(messageText(ninthPrompt.payload))}\n\nUser-supplied images: [terrain request](attachments/prompt-09-terrain-request.png), [view headings](attachments/prompt-09-headings.png).\n`,
      );
    const context = allUser.filter(
      (row) => row !== firstPrompt && messageText(row.payload).includes('# AGENTS.md instructions'),
    );
    if (context.length)
      await writeFile(
        path.join(historyDir, 'supporting-instructions.md'),
        `# User-supplied build instructions\n\n${context.map((row) => redact(messageText(row.payload))).join('\n\n')}\n`,
      );
  }
}
await writeFile(path.join(privateDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(
  `Exported ${manifest.length} conversation snapshots. Original sessions copied privately. Main prompt and supporting instructions preserved.`,
);
