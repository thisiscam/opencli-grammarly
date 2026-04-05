import { cli, Strategy } from '@jackwener/opencli/registry';
import { submitText, extractDocStats, resolveText } from './utils.js';
import type { Goals } from './utils.js';

cli({
  site: 'grammarly',
  name: 'score',
  description: 'Get overall Grammarly writing score, readability, and alert counts',
  domain: 'app.grammarly.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'text', positional: true, help: 'Text to score' },
    { name: 'file', help: 'Read text from file path instead' },
    { name: 'doc', help: 'Grammarly document ID (default: shared scratch doc)' },
    { name: 'audience', help: 'Goal: general | knowledgeable | expert' },
    { name: 'formality', help: 'Goal: informal | neutral | formal' },
    { name: 'domain', help: 'Goal: academic | business | general | email | casual | creative' },
    { name: 'intent', help: 'Goal: inform | describe | convince | tell a story' },
  ],
  columns: ['score', 'scoreStatus', 'readabilityScore', 'wordsCount', 'charsCount', 'critical', 'advanced'],
  func: async (page, args) => {
    const text = resolveText(args.text as string | undefined, args.file as string | undefined);
    const goals: Goals = {
      audience: args.audience as string | undefined,
      formality: args.formality as string | undefined,
      domain: args.domain as string | undefined,
      intent: args.intent as string | undefined,
    };
    await submitText(page, text, args.doc as string | undefined, goals);
    const stats = await extractDocStats(page);

    return [{
      score: stats.score,
      scoreStatus: stats.scoreStatus,
      readabilityScore: stats.readabilityScore,
      wordsCount: stats.wordsCount,
      charsCount: stats.charsCount,
      critical: stats.counters.critical,
      advanced: stats.counters.advanced,
    }];
  },
});
