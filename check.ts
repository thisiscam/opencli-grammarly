import { cli, Strategy } from '@jackwener/opencli/registry';
import { submitText, extractAlerts, extractScore, textStats } from './utils.js';

cli({
  site: 'grammarly',
  name: 'check',
  description: 'Check text for grammar, spelling, punctuation, and style issues',
  domain: 'app.grammarly.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'text', required: true, positional: true, help: 'Text to check (or file path)' },
    { name: 'severity', default: 'all', help: 'Filter: critical | warning | all' },
    { name: 'doc', help: 'Grammarly document ID to reuse (default: shared scratch doc)' },
  ],
  columns: ['rank', 'category', 'severity', 'message', 'original', 'replacement'],
  func: async (page, args) => {
    await submitText(page, args.text as string, args.doc as string | undefined);
    const alerts = await extractAlerts(page);

    // Filter by severity if requested
    const sev = args.severity as string;
    const filtered = sev === 'all' ? alerts : alerts.filter(a => a.severity === sev);

    return filtered;
  },
});
