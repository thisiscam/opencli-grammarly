import { cli, Strategy } from '@jackwener/opencli/registry';
import { submitText, extractAlerts, extractEditorText } from './utils.js';

cli({
  site: 'grammarly',
  name: 'rewrite',
  description: 'Apply all Grammarly suggestions and return corrected text',
  domain: 'app.grammarly.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'text', required: true, positional: true, help: 'Text to rewrite (or file path)' },
    { name: 'doc', help: 'Grammarly document ID to reuse (default: shared scratch doc)' },
  ],
  columns: ['original', 'rewritten'],
  func: async (page, args) => {
    const original = args.text as string;
    await submitText(page, original, args.doc as string | undefined);

    // Get all alerts to know what replacements are available
    const alerts = await extractAlerts(page);

    // Apply replacements locally (more reliable than clicking Accept buttons)
    let rewritten = original;
    // Sort by position descending so replacements don't shift offsets
    // Since we don't have exact positions, do simple string replacement
    for (const alert of alerts) {
      if (alert.original && alert.replacement) {
        rewritten = rewritten.replace(alert.original, alert.replacement);
      }
    }

    return [{ original, rewritten }];
  },
});
