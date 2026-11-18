import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

export const ROOT_SESSION_ID = '01a1e1f7-817a-7811-8ab8-0c113f98b64b';
const PROMPT_MARKERS = [
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
const ATTACHMENTS = {
  2: 'User-supplied image: [comparison screenshot](attachments/prompt-02-reference.png). Preserved as build history; not used as a redistributed application basemap.',
  5: 'User-supplied images: [Wharf 3D](attachments/prompt-05-wharf.png), [missing aerial](attachments/prompt-05-aerial.png). Retained as build-history evidence.',
  6: 'User-supplied images: [REDACTED: personal account UI; original four comparison images retained privately](attachments/prompt-06-images-redacted.md). They are build-history evidence, not application assets.',
  9: 'User-supplied images: [terrain request](attachments/prompt-09-terrain-request.png), [view headings](attachments/prompt-09-headings.png).',
  10: 'User-supplied image: [final submission rules](attachments/prompt-10-rules.png). This privacy-reviewed attachment is retained byte-for-byte with a [hash record](attachments/prompt-10-rules.json); the original is also retained privately.',
};

const hash = (text) => createHash('sha256').update(text).digest('hex');
const phase = (payload) => payload.phase ?? payload.channel;
const textParts = (payload) =>
  (payload.content ?? [])
    .filter((part) => ['input_text', 'output_text', 'text'].includes(part.type))
    .map((part) => part.text ?? '')
    .join('\n');

export function redact(text) {
  return text
    .replace(
      /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,})/g,
      '[REDACTED: credential]',
    )
    .replace(
      /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
      '[REDACTED: credential]',
    )
    .replace(
      /([?&](?:access_token|refresh_token|id_token|api_key|client_secret|code|state)=)[^\s&<>"']+/gi,
      '$1[REDACTED: credential]',
    )
    .replace(
      /(\b(?:OPENAI_API_KEY|access_token|refresh_token|id_token|client_secret)\s*[=:]\s*["']?)[A-Za-z0-9_./+\-=]{16,}/gi,
      '$1[REDACTED: credential]',
    )
    .replace(/C:[\\/]Users[\\/]gary/gi, '[REDACTED: user profile path]')
    .replace(
      /!?\[[^\]\n]*\]\([^\n)]*prompt-06-(?:terrain|buildings|church-1|church-2)\.png[^\n)]*\)/g,
      '[REDACTED: account-bearing image withheld](attachments/prompt-06-images-redacted.md)',
    );
}

async function filesIn(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory()
          ? filesIn(path.join(dir, entry.name))
          : entry.name.endsWith('.jsonl')
            ? [path.join(dir, entry.name)]
            : [],
      ),
    )
  ).flat();
}

function parseRows(text, filename) {
  const lines = text.split(/\r?\n/);
  let trailingPartial = false;
  const rows = [];
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    try {
      rows.push(JSON.parse(line));
    } catch {
      if (i === lines.length - 1 && !text.endsWith('\n')) trailingPartial = true;
      else
        throw new Error(
          `Malformed complete JSONL record in ${filename}, line ${i + 1}; export stopped.`,
        );
    }
  });
  return { rows, trailingPartial };
}

function findPrompts(rows) {
  let previousIndex = -1;
  return PROMPT_MARKERS.map((marker, i) => {
    const matches = rows.flatMap((row, index) =>
      row.type === 'response_item' &&
      row.payload.type === 'message' &&
      row.payload.role === 'user' &&
      !textParts(row.payload).includes('# AGENTS.md instructions') &&
      textParts(row.payload).includes(marker)
        ? [{ row, index }]
        : [],
    );
    if (matches.length !== 1)
      throw new Error(
        `Prompt ${i + 1} must have exactly one original user record; found ${matches.length}. Nothing was silently selected or omitted.`,
      );
    if (matches[0].index <= previousIndex)
      throw new Error('Original prompts are not in the expected chronological order.');
    previousIndex = matches[0].index;
    return { ...matches[0], number: i + 1 };
  });
}

function finalReplyStatus(record, prompt) {
  const before = record.rows.slice(0, prompt.index + 1);
  const turnId =
    before.findLast((row) => row.type === 'event_msg' && row.payload.type === 'task_started')
      ?.payload.turn_id ?? before.findLast((row) => row.type === 'turn_context')?.payload.turn_id;
  const after = record.rows.slice(prompt.index + 1);
  const nextTurn = after.findIndex(
    (row) =>
      row.type === 'event_msg' &&
      row.payload.type === 'task_started' &&
      row.payload.turn_id !== turnId,
  );
  const turnRows = nextTurn < 0 ? after : after.slice(0, nextTurn);
  const finalIndex = turnRows.findLastIndex(
    (row) =>
      row.type === 'response_item' &&
      row.payload.type === 'message' &&
      row.payload.role === 'assistant' &&
      ['final', 'final_answer'].includes(phase(row.payload)) &&
      textParts(row.payload).trim(),
  );
  const final = turnRows[finalIndex];
  const completed = turnRows
    .slice(finalIndex + 1)
    .find(
      (row) =>
        row.type === 'event_msg' &&
        row.payload.type === 'task_complete' &&
        row.payload.turn_id === turnId &&
        row.payload.last_agent_message?.trim() === textParts(final?.payload ?? {}).trim(),
    );
  const complete = Boolean(turnId && final && completed && !record.trailingPartial);
  return {
    complete,
    turnId: turnId ?? null,
    finalRecordedAt: final?.timestamp ?? null,
    completedAt: completed?.timestamp ?? null,
    finalTextSha256: final ? hash(textParts(final.payload)) : null,
    note: complete
      ? 'Actual final message matches the original task completion event.'
      : 'Round 10 remains in progress or the matching completion evidence is unavailable.',
  };
}

function dialogueRows(rows) {
  return rows.filter(
    (row) =>
      row.type === 'response_item' &&
      ((row.payload.type === 'message' &&
        ['user', 'assistant'].includes(row.payload.role) &&
        phase(row.payload) !== 'analysis') ||
        row.payload.type === 'agent_message'),
  );
}

function renderContent(payload) {
  return (payload.content ?? [])
    .map((part) => {
      if (['input_text', 'output_text', 'text'].includes(part.type)) return redact(part.text ?? '');
      if (part.type === 'encrypted_content')
        return '[UNAVAILABLE: this original content block is encrypted by the Codex client. Retained privately; not decrypted or reconstructed by this exporter.]';
      return '[ATTACHMENT: binary/non-text content remains in the original session. See retained attachment files or the marked privacy notice; pixels are not exported here.]';
    })
    .join('\n');
}

function label(payload) {
  if (payload.type === 'agent_message')
    return `Automatic agent message: ${payload.author ?? 'unknown sender'} → ${payload.recipient ?? 'unknown recipient'}`;
  return payload.role === 'user'
    ? 'User / supplied context'
    : `Assistant${phase(payload) ? ` (${phase(payload)})` : ''}`;
}

function readOutcomes(ledger) {
  return PROMPT_MARKERS.map((_, index) => {
    const number = index + 1;
    const line = ledger
      .split(/\r?\n/)
      .find((line) =>
        new RegExp(`^\\|\\s*(?:\\[${number}\\]\\([^)]*\\)|${number})\\s*\\|`).test(line),
      );
    const outcome = line?.split('|').at(-2)?.trim();
    if (!outcome)
      throw new Error(`The prompt ledger needs a one-line outcome for prompt ${number}.`);
    return outcome;
  });
}

export async function exportHistory({
  projectRoot = process.cwd(),
  sessionsRoot = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions'),
} = {}) {
  const ignored = await readFile(path.join(projectRoot, '.gitignore'), 'utf8');
  if (
    !ignored
      .split(/\r?\n/)
      .some((line) => ['.history-private/', '/.history-private/'].includes(line.trim()))
  )
    throw new Error(
      'Refusing to archive originals: .history-private/ must be explicitly ignored by this repository.',
    );
  const candidates = [];
  const candidatesAfterProjectStart = (await filesIn(sessionsRoot)).filter(
    (file) => path.basename(file) >= 'rollout-2026-11-15',
  );
  for (const file of candidatesAfterProjectStart) {
    const text = await readFile(file, 'utf8');
    let first;
    try {
      first = JSON.parse(text.split('\n', 1)[0]);
    } catch {
      continue;
    }
    if (first.type !== 'session_meta') continue;
    const meta = first.payload;
    candidates.push({
      file,
      text,
      meta,
      parentId: meta.source?.subagent?.thread_spawn?.parent_thread_id ?? meta.parent_thread_id,
    });
  }
  const selectedIds = new Set([ROOT_SESSION_ID]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of candidates)
      if (selectedIds.has(record.parentId) && !selectedIds.has(record.meta.id)) {
        selectedIds.add(record.meta.id);
        changed = true;
      }
  }
  const records = candidates
    .filter((record) => selectedIds.has(record.meta.id))
    .map((record) => {
      const task =
        record.meta.id === ROOT_SESSION_ID
          ? 'main'
          : (record.meta.source?.subagent?.thread_spawn?.agent_path ?? record.meta.agent_path ?? '')
              .replace(/^\/root\//, '')
              .replaceAll('/', '--');
      if (!/^[a-z0-9_-]+$/.test(task))
        throw new Error('Unexpected agent task path; refusing unsafe output filename.');
      return { ...record, task, ...parseRows(record.text, path.basename(record.file)) };
    })
    .sort((a, b) =>
      a.task === 'main' ? -1 : b.task === 'main' ? 1 : a.task.localeCompare(b.task),
    );
  for (const task of ['main', 'survey', 'world_engine', 'renderer']) {
    if (records.filter((record) => record.task === task).length !== 1)
      throw new Error(
        `Exactly one original ${task} session is required. Preserve the originals and check CODEX_HOME.`,
      );
  }
  if (
    new Set(records.map((record) => record.task)).size !== records.length ||
    new Set(records.map((record) => record.meta.id)).size !== records.length
  )
    throw new Error(
      'Duplicate original session or task names would overwrite history; export stopped.',
    );
  const main = records.find((record) => record.task === 'main');
  const prompts = findPrompts(main.rows);
  const outcomes = readOutcomes(
    await readFile(path.join(projectRoot, 'docs/PROMPT_LEDGER.md'), 'utf8'),
  );
  const finalReply = finalReplyStatus(main, prompts[9]);
  const generatedAt = new Date().toISOString();
  const historyDir = path.join(projectRoot, 'docs/history');
  const privateDir = path.join(projectRoot, '.history-private');
  await mkdir(historyDir, { recursive: true });
  await mkdir(privateDir, { recursive: true });
  const conversations = [];
  for (const record of records) {
    // Archive the exact bytes used to derive this snapshot, not a later racing read/copy.
    await writeFile(path.join(privateDir, path.basename(record.file)), record.text);
    const messages = dialogueRows(record.rows);
    const models = [
      ...new Set(
        record.rows
          .filter((row) => row.type === 'turn_context')
          .map((row) => row.payload.model)
          .filter(Boolean),
      ),
    ];
    const encryptedBlocks = messages
      .flatMap((row) => row.payload.content ?? [])
      .filter((part) => part.type === 'encrypted_content').length;
    const title =
      record.task === 'main' ? 'Wordscape main conversation' : `Automatic subagent: ${record.task}`;
    const header = `# ${title}\n\nSession: ${record.meta.id}\n\nClient recorded at session creation: ${record.meta.originator ?? 'not recorded'} ${record.meta.cli_version ?? ''}\n\nModels recorded in original turn_context entries: ${models.join(', ') || 'not recorded'}\n\nSnapshot generated: ${generatedAt}. ${finalReply.complete ? 'The actual Round 10 final reply and matching completion event are recorded.' : 'Working snapshot: Round 10 is not yet recorded as complete; rerun after its final reply.'}\n\nContains recorded readable user/assistant dialogue, including commentary, and automatic agent-message envelopes. Encrypted blocks are marked unavailable, not invented or silently removed. Original JSONL/tool traces are retained in ignored .history-private/ and original Codex sessions. Analysis/reasoning and other tool traces are excluded from this public dialogue. Attachments are referenced separately; account-bearing images remain withheld. This is not a native full-history export. Automatic subagent work is not an additional human prompt.\n`;
    const body = messages
      .map(
        (row, index) =>
          `\n---\n\n## ${index + 1}. ${redact(label(row.payload))}\n\nRecorded: ${row.timestamp ?? 'timestamp unavailable'}\n\n${renderContent(row.payload)}\n`,
      )
      .join('');
    await writeFile(path.join(historyDir, `${record.task}.md`), header + body);
    conversations.push({
      id: record.meta.id,
      task: record.task,
      client: record.meta.originator ?? null,
      clientVersion: record.meta.cli_version ?? null,
      models,
      messages: messages.length,
      encryptedBlocks,
      originalRetained: true,
      originalSha256: hash(record.text),
      trailingPartial: record.trailingPartial,
    });
  }
  const promptRecords = [];
  const promptSections = [];
  for (const prompt of prompts) {
    const text = redact(textParts(prompt.row.payload));
    const filename = `prompt-${String(prompt.number).padStart(2, '0')}.md`;
    const attachments = ATTACHMENTS[prompt.number] ? `\n\n${ATTACHMENTS[prompt.number]}\n` : '\n';
    await writeFile(
      path.join(historyDir, filename),
      `# Prompt ${prompt.number} — exact recorded text\n\n${text}${attachments}`,
    );
    promptSections.push(
      `## Prompt ${prompt.number}\n\nOutcome recorded in the ledger: ${outcomes[prompt.number - 1]}\n\n${text}${attachments}`,
    );
    promptRecords.push({
      number: prompt.number,
      recordedAt: prompt.row.timestamp ?? null,
      file: filename,
      outcome: outcomes[prompt.number - 1],
      originalTextSha256: hash(textParts(prompt.row.payload)),
    });
  }
  const instructions = main.rows.filter(
    (row) =>
      row.type === 'response_item' &&
      row.payload.type === 'message' &&
      row.payload.role === 'user' &&
      textParts(row.payload).includes('# AGENTS.md instructions'),
  );
  const instructionText = instructions
    .map(
      (row, index) =>
        `## Instruction record ${index + 1}\n\nRecorded: ${row.timestamp ?? 'timestamp unavailable'}\n\n${redact(textParts(row.payload))}`,
    )
    .join('\n\n---\n\n');
  await writeFile(
    path.join(historyDir, 'supporting-instructions.md'),
    `# User-supplied build instructions\n\n${instructionText}\n`,
  );
  await writeFile(
    path.join(historyDir, 'prompts-all.md'),
    `# How I spent my ten — exact prompts and recorded outcomes\n\nGenerated from the original main-session user records. Text is verbatim except marked privacy/credential redactions. Attachment notices follow the relevant prompts. The separate [main dialogue](main.md) retains setup acknowledgements and all readable assistant responses.\n\n${finalReply.complete ? 'The actual final reply is recorded.' : '**Working snapshot:** the Round 10 final reply is not yet recorded as complete.'} This export does not by itself establish contest eligibility or replace a required native full-history artifact.\n\n${promptSections.join('\n---\n\n')}\n\n---\n\n# Supporting instructions supplied with the build\n\n${instructionText}\n`,
  );
  const manifest = {
    generatedAt,
    rootSessionId: ROOT_SESSION_ID,
    finalReply,
    prompts: promptRecords,
    conversations,
    supportingInstructionRecords: instructions.length,
    limitations: [
      'Encrypted content cannot be decoded by this exporter and is explicitly marked.',
      'Binary attachments and tool/reasoning traces are not included in the public Markdown; original sessions are retained privately.',
      'Recorded client/version is session-creation metadata, not an inferred current app version.',
      'Exporting does not publish, submit, share, or create a native full-history artifact.',
    ],
  };
  await writeFile(
    path.join(historyDir, 'export-manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  await writeFile(path.join(privateDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
