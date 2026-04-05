import { cli, Strategy } from '@jackwener/opencli/registry';
import { submitText, extractAlerts, resolveText } from './utils.js';
import type { Goals } from './utils.js';

cli({
  site: 'grammarly',
  name: 'check',
  description: 'Check text for grammar, spelling, punctuation, and style issues',
  domain: 'app.grammarly.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'text', positional: true, help: 'Text to check' },
    { name: 'file', help: 'Read text from file path instead' },
    { name: 'severity', default: 'all', help: 'Filter: critical | warning | all' },
    { name: 'doc', help: 'Grammarly document ID (default: shared scratch doc)' },
    { name: 'audience', help: 'Goal: general | knowledgeable | expert' },
    { name: 'formality', help: 'Goal: informal | neutral | formal' },
    { name: 'domain', help: 'Goal: academic | business | general | email | casual | creative' },
    { name: 'intent', help: 'Goal: inform | describe | convince | tell a story' },
  ],
  columns: ['rank', 'category', 'severity', 'message', 'original', 'replacement'],
  func: async (page, args) => {
    const text = resolveText(args.text as string | undefined, args.file as string | undefined);
    const goals: Goals = {
      audience: args.audience as string | undefined,
      formality: args.formality as string | undefined,
      domain: args.domain as string | undefined,
      intent: args.intent as string | undefined,
    };
    await submitText(page, text, args.doc as string | undefined, goals);
    const alerts = await extractAlerts(page);

    const sev = args.severity as string;
    return sev === 'all' ? alerts : alerts.filter(a => a.severity === sev);
  },
});
