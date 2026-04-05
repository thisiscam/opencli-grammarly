import { cli, Strategy } from '@jackwener/opencli/registry';
import { submitText, extractAlerts } from './utils.js';
import type { Goals } from './utils.js';

cli({
  site: 'grammarly',
  name: 'rewrite',
  description: 'Apply all Grammarly suggestions and return corrected text',
  domain: 'app.grammarly.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'text', required: true, positional: true, help: 'Text to rewrite (or file path)' },
    { name: 'doc', help: 'Grammarly document ID (default: shared scratch doc)' },
    { name: 'audience', help: 'Goal: general | knowledgeable | expert' },
    { name: 'formality', help: 'Goal: informal | neutral | formal' },
    { name: 'domain', help: 'Goal: academic | business | general | email | casual | creative' },
    { name: 'intent', help: 'Goal: inform | describe | convince | tell a story' },
  ],
  columns: ['original', 'rewritten'],
  func: async (page, args) => {
    const original = args.text as string;
    const goals: Goals = {
      audience: args.audience as string | undefined,
      formality: args.formality as string | undefined,
      domain: args.domain as string | undefined,
      intent: args.intent as string | undefined,
    };
    await submitText(page, original, args.doc as string | undefined, goals);
    const alerts = await extractAlerts(page);

    // Apply replacements locally
    let rewritten = original;
    for (const alert of alerts) {
      if (alert.original && alert.replacement) {
        rewritten = rewritten.replace(alert.original, alert.replacement);
      }
    }

    return [{ original, rewritten }];
  },
});
