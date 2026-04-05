import { cli, Strategy } from '@jackwener/opencli/registry';
import { submitText, extractAlerts } from './utils.js';

cli({
  site: 'grammarly',
  name: 'rewrite',
  description: 'Apply all Grammarly suggestions and return corrected text',
  domain: 'app.grammarly.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'text', required: true, positional: true, help: 'Text to rewrite (or file path)' },
  ],
  columns: ['original', 'rewritten'],
  func: async (page, args) => {
    const original = args.text as string;
    await submitText(page, original);

    // Accept all suggestions by clicking each one
    const accepted = await page.evaluate(`
      (async () => {
        // Find and click all "accept" buttons for suggestions
        const acceptAll = async () => {
          const buttons = document.querySelectorAll(
            '[class*="accept"], [data-purpose="accept"], ' +
            '[class*="Apply"], [aria-label*="Accept"], ' +
            '[class*="suggestion"] button'
          );
          for (const btn of buttons) {
            btn.click();
            await new Promise(r => setTimeout(r, 300));
          }
          return buttons.length;
        };

        // Keep clicking until no more suggestions
        let total = 0;
        for (let i = 0; i < 10; i++) {
          const n = await acceptAll();
          if (n === 0) break;
          total += n;
          await new Promise(r => setTimeout(r, 1000));
        }
        return total;
      })()
    `);

    // Extract the corrected text from the editor
    const rewritten = await page.evaluate(`
      (() => {
        const ed = document.querySelector('[contenteditable="true"]');
        return ed?.innerText?.trim() || '';
      })()
    `) as string;

    return [{ original, rewritten: rewritten || original }];
  },
});
