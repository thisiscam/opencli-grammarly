import { cli, Strategy } from '@jackwener/opencli/registry';
import { submitText, extractDocStats } from './utils.js';

cli({
  site: 'grammarly',
  name: 'score',
  description: 'Get overall Grammarly writing score, readability, and alert counts',
  domain: 'app.grammarly.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'text', required: true, positional: true, help: 'Text to score (or file path)' },
    { name: 'doc', help: 'Grammarly document ID to reuse (default: shared scratch doc)' },
  ],
  columns: ['score', 'scoreStatus', 'readabilityScore', 'wordsCount', 'charsCount', 'critical', 'advanced'],
  func: async (page, args) => {
    await submitText(page, args.text as string, args.doc as string | undefined);
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
