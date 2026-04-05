import { cli, Strategy } from '@jackwener/opencli/registry';
import { submitText, extractScore, textStats } from './utils.js';

cli({
  site: 'grammarly',
  name: 'score',
  description: 'Get overall Grammarly writing score and text statistics',
  domain: 'app.grammarly.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'text', required: true, positional: true, help: 'Text to score (or file path)' },
  ],
  columns: ['overall', 'word_count', 'char_count', 'sentence_count', 'reading_time_sec'],
  func: async (page, args) => {
    const text = args.text as string;
    await submitText(page, text);
    const overall = await extractScore(page);
    const stats = textStats(text);

    return [{ overall, ...stats }];
  },
});
