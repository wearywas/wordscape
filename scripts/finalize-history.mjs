// Export-only: no model requests, Git commands, network access, or immutable sharing.
import { exportHistory, redact } from './history-lib.mjs';

try {
  const manifest = await exportHistory();
  if (!manifest.finalReply.complete) {
    console.error(
      'Not finalized: the original session does not yet contain the actual Round 10 final assistant reply and its matching task_complete event. Wait until the reply finishes, then run this same command again. Working snapshots were refreshed; no completion was invented.',
    );
    process.exitCode = 1;
  } else {
    console.log(
      `Final reply verified in the original session. Exported ${manifest.conversations.length} conversations and all ten prompts with outcomes.`,
    );
    console.log(
      'Review docs/history/export-manifest.json and docs/history/prompts-all.md. Private originals remain in .history-private/.',
    );
    console.log(
      'This command does not publish or submit anything. Native export or reviewed screenshots/recording are still needed for encrypted content and original attachments; inspect privacy before sharing.',
    );
  }
} catch (error) {
  console.error(redact(error.message));
  process.exitCode = 1;
}
