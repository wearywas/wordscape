import { exportHistory, redact } from './history-lib.mjs';
try {
  const manifest = await exportHistory();
  console.log(
    `Exported ${manifest.conversations.length} conversations and ${manifest.prompts.length} prompts. Original JSONL copied privately.`,
  );
  console.log(
    manifest.finalReply.complete
      ? 'Actual Round 10 final reply and matching completion event are recorded.'
      : 'Working snapshot only: Round 10 final reply is not yet recorded as complete.',
  );
  console.log(
    'Encrypted agent content and binary attachments are explicitly marked; this is not a native full-history export.',
  );
} catch (error) {
  console.error(redact(error.message));
  process.exitCode = 1;
}
