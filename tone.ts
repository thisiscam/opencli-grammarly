import { cli, Strategy } from '@jackwener/opencli/registry';
import { submitText, extractTones } from './utils.js';

cli({
  site: 'grammarly',
  name: 'tone',
  description: 'Detect the tone of the text (requires Grammarly Pro)',
  domain: 'app.grammarly.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'text', required: true, positional: true, help: 'Text to analyze (or file path)' },
    { name: 'doc', help: 'Grammarly document ID to reuse (default: shared scratch doc)' },
  ],
  columns: ['rank', 'emoji', 'tone', 'confidence'],
  func: async (page, args) => {
    await submitText(page, args.text as string, args.doc as string | undefined);
    const tones = await extractTones(page);

    if (tones.length === 0) {
      return [{ rank: 1, emoji: '', tone: '(tone detection requires Grammarly Pro)', confidence: 'n/a' }];
    }
    return tones;
  },
});
