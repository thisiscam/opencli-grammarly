import { cli, Strategy } from '@jackwener/opencli/registry';
import { submitText, extractTones } from './utils.js';
import type { Goals } from './utils.js';

cli({
  site: 'grammarly',
  name: 'tone',
  description: 'Detect the tone of the text (requires Grammarly Pro)',
  domain: 'app.grammarly.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'text', required: true, positional: true, help: 'Text to analyze (or file path)' },
    { name: 'doc', help: 'Grammarly document ID (default: shared scratch doc)' },
    { name: 'audience', help: 'Goal: general | knowledgeable | expert' },
    { name: 'formality', help: 'Goal: informal | neutral | formal' },
    { name: 'domain', help: 'Goal: academic | business | general | email | casual | creative' },
    { name: 'intent', help: 'Goal: inform | describe | convince | tell a story' },
  ],
  columns: ['rank', 'emoji', 'tone', 'confidence'],
  func: async (page, args) => {
    const goals: Goals = {
      audience: args.audience as string | undefined,
      formality: args.formality as string | undefined,
      domain: args.domain as string | undefined,
      intent: args.intent as string | undefined,
    };
    await submitText(page, args.text as string, args.doc as string | undefined, goals);
    const tones = await extractTones(page);

    if (tones.length === 0) {
      return [{ rank: 1, emoji: '', tone: '(tone detection requires Grammarly Pro)', confidence: 'n/a' }];
    }
    return tones;
  },
});
