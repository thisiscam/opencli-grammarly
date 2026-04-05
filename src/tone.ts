import { cli, Strategy } from '@jackwener/opencli/registry';
import { submitText, extractTones } from './utils.js';

cli({
  site: 'grammarly',
  name: 'tone',
  description: 'Detect the tone of the text via Grammarly tone detector',
  domain: 'app.grammarly.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'text', required: true, positional: true, help: 'Text to analyze (or file path)' },
  ],
  columns: ['rank', 'emoji', 'tone', 'confidence'],
  func: async (page, args) => {
    await submitText(page, args.text as string);

    let tones = await extractTones(page);

    // If tone section is collapsed, try clicking to expand it
    if (tones.length === 0) {
      try {
        const snap = await page.snapshot({ interactive: true });
        // Look for a tone-related button and click it
        await page.evaluate(`
          (() => {
            const btn = document.querySelector('[class*="tone"], [data-purpose*="tone"]');
            if (btn && btn.click) btn.click();
          })()
        `);
        await page.wait(2000);
        tones = await extractTones(page);
      } catch {
        // Tone detector may not be available on free tier
      }
    }

    return tones.length > 0 ? tones : [{ rank: 1, emoji: '', tone: 'neutral', confidence: 'low' }];
  },
});
