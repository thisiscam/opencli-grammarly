/**
 * Shared Grammarly automation helpers.
 *
 * All functions accept an opencli IPage — they never create their own
 * browser session.  opencli's runtime handles the browser bridge,
 * session reuse, and cookie-based auth.
 *
 * Selectors calibrated against live app.grammarly.com (April 2026).
 */

import type { IPage } from '@jackwener/opencli/types';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ── Input resolution ─────────────────────────────────────────────────

/**
 * Resolve input text: if --file is provided, read the file.
 * Otherwise use the positional text argument directly.
 */
export function resolveText(text: string | undefined, file: string | undefined): string {
  if (file) {
    const resolved = resolve(file);
    if (!existsSync(resolved)) {
      throw new Error(`File not found: ${file}`);
    }
    return readFileSync(resolved, 'utf-8');
  }
  if (!text) {
    throw new Error('Provide text as a positional argument or use --file <path>');
  }
  return text;
}

// ── Constants ────────────────────────────────────────────────────────

const EDITOR_NEW_URL = 'https://app.grammarly.com/ddocs/new';
const EDITOR_DOC_URL = (id: string) => `https://app.grammarly.com/ddocs/${id}`;
const DASHBOARD_URL = 'https://app.grammarly.com/';
const DEFAULT_DOC_TITLE = 'opencli-scratch';
const API_PATTERN = 'capi.grammarly.com';

// ── Selectors (calibrated against live DOM) ──────────────────────────

// Editor body: <section name="text"> ... <div contenteditable="true">
const SEL_EDITOR = 'section[name="text"] div[contenteditable="true"]';

// Document title: <h1 contenteditable placeholder="Untitled document">
const SEL_TITLE = 'h1[contenteditable="true"][placeholder="Untitled document"]';

// Assistant panel: <div data-testid="assistant" role="dialog">
const SEL_ASSISTANT = '[data-testid="assistant"]';

// Suggestion feed: <article data-testid="long-form-feed">
const SEL_FEED = 'article[data-testid="long-form-feed"]';

// Suggestion count header: <h3 aria-label="4 suggestions">
const SEL_SUGGESTION_COUNT = 'h3[aria-label*="suggestion"]';

// Flagged words in editor: <span> children inside editor <p> tags
// Grammarly wraps flagged text in <span> elements
const SEL_FLAGGED = 'section[name="text"] div[contenteditable="true"] p span';

// Score button: contains "Overall score" text + <span> with number
// <button aria-label="Text is too short"> or <button aria-label="Overall score: 72">
const SEL_SCORE_BTN = 'button[aria-label*="score" i], button[aria-label*="Overall"]';

// Dashboard doc links: <a href="/ddocs/XXXXXXX" aria-label="Open document that starts with...">
const SEL_DASHBOARD_DOC = 'a[href*="/ddocs/"]';

// Goals button: <button aria-label="Goals: Adjust goals">
const SEL_GOALS_BTN = 'button[aria-label*="Goals"]';

// ── Goal options (valid values for each goal group) ──────────────────

export const GOAL_OPTIONS = {
  audience: ['general', 'knowledgeable', 'expert'] as const,
  formality: ['informal', 'neutral', 'formal'] as const,
  domain: ['academic', 'business', 'general', 'email', 'casual', 'creative'] as const,
  intent: ['inform', 'describe', 'convince', 'tell a story'] as const,
} as const;

export interface Goals {
  audience?: string;
  formality?: string;
  domain?: string;
  intent?: string;
}

// ── Types ────────────────────────────────────────────────────────────

export interface Alert {
  rank: number;
  category: string;
  severity: string;
  message: string;
  original: string;
  replacement: string;
  explanation: string;
}

export interface ToneSignal {
  rank: number;
  tone: string;
  confidence: string;
  emoji: string;
}

// ── Resolve document URL ─────────────────────────────────────────────

/**
 * Resolve which Grammarly document to use:
 *   1. Explicit --doc <id>  → go straight to that doc
 *   2. No --doc             → find or create the "opencli-scratch" doc
 *
 * The scratch doc is reused across invocations so we never pollute the
 * user's document list.  We detect it by scanning dashboard links for
 * one whose aria-label matches "Open document that starts with opencli-scratch".
 */
async function resolveDocUrl(page: IPage, docId?: string): Promise<string> {
  if (docId) return EDITOR_DOC_URL(docId);

  // Navigate to dashboard and scan for existing scratch doc
  await page.goto(DASHBOARD_URL, { waitUntil: 'load' });
  await page.wait(3000);

  const existingId = await page.evaluate(`
    (() => {
      const links = document.querySelectorAll('${SEL_DASHBOARD_DOC}');
      for (const a of links) {
        const label = a.getAttribute('aria-label') || '';
        if (label.includes('${DEFAULT_DOC_TITLE}')) {
          const match = a.getAttribute('href')?.match(/\\/ddocs\\/(\\d+)/);
          if (match) return match[1];
        }
      }
      return null;
    })()
  `) as string | null;

  if (existingId) return EDITOR_DOC_URL(existingId);

  // No scratch doc found — will create a new one
  return EDITOR_NEW_URL;
}

// ── Set goals via the Goals dialog ───────────────────────────────────

async function setGoals(page: IPage, goals: Goals): Promise<void> {
  // Click the Goals button to open the dialog
  await page.evaluate(`document.querySelector('${SEL_GOALS_BTN}')?.click()`);
  await page.wait(1000);

  // For each goal, find the matching radio input by name + label and click it
  // The dialog has <input name="audience"> + <label>general</label> pairs
  for (const [group, value] of Object.entries(goals)) {
    if (!value) continue;
    await page.evaluate(`
      (() => {
        const inputs = document.querySelectorAll('input[name="${group}"]');
        for (const input of inputs) {
          const label = input.nextElementSibling || input.closest('label');
          const labelText = (label?.textContent || '').trim().toLowerCase();
          if (labelText === '${value.toLowerCase()}') {
            input.click();
            return true;
          }
        }
        // Fallback: find label by text and click it
        const labels = document.querySelectorAll('label');
        for (const lbl of labels) {
          if (lbl.textContent?.trim().toLowerCase() === '${value.toLowerCase()}') {
            lbl.click();
            return true;
          }
        }
        return false;
      })()
    `);
    await page.wait(200);
  }

  // Click Done to close the dialog
  await page.evaluate(`
    (() => {
      const btns = document.querySelectorAll('button');
      for (const btn of btns) {
        if (btn.textContent?.trim() === 'Done') { btn.click(); return; }
      }
    })()
  `);
  await page.wait(500);
}

// ── Submit text to the Grammarly editor ──────────────────────────────

export async function submitText(page: IPage, text: string, docId?: string, goals?: Goals): Promise<void> {
  const url = await resolveDocUrl(page, docId);

  // Install interceptor BEFORE navigating so we capture all API traffic
  await page.installInterceptor(API_PATTERN);

  await page.goto(url, { waitUntil: 'load' });
  await page.wait({ selector: SEL_EDITOR, timeout: 15 });
  await page.wait(2000);  // let editor JS initialize

  // If this is a new doc, set the title to our scratch name via CDP
  if (url === EDITOR_NEW_URL) {
    await page.evaluate(`document.querySelector('${SEL_TITLE}')?.focus()`);
    await page.wait(300);
    await page.pressKey('Meta+a');
    if (page.insertText) {
      await page.insertText(DEFAULT_DOC_TITLE);
    } else {
      await page.evaluate(`document.execCommand('insertText', false, '${DEFAULT_DOC_TITLE}')`);
    }
    await page.wait(500);
  }

  // Set goals if provided (before inserting text so analysis uses them)
  if (goals && Object.keys(goals).length > 0) {
    await setGoals(page, goals);
  }

  // Clear the editor via DOM manipulation.
  // pressKey('Meta+a') + pressKey('Backspace') does NOT work because
  // opencli's CDP keyboard dispatch doesn't trigger ProseMirror's
  // Cmd+A handler. Direct innerHTML replacement is reliable.
  await page.evaluate(`
    (() => {
      const ed = document.querySelector('${SEL_EDITOR}');
      if (!ed) return;
      ed.innerHTML = '<p><br></p>';
      ed.dispatchEvent(new Event('input', { bubbles: true }));
      ed.focus();
    })()
  `);
  await page.wait(500);

  // Insert new text via CDP Input.insertText (works with ProseMirror)
  if (page.insertText) {
    await page.insertText(text);
  } else {
    for (const ch of text) {
      await page.pressKey(ch);
    }
  }

  await page.wait(1000);  // let Grammarly start processing
  await waitForAnalysis(page);
}

// ── Wait for analysis to settle ──────────────────────────────────────

async function waitForAnalysis(page: IPage): Promise<void> {
  // Wait for assistant panel to appear
  await page.wait({ selector: SEL_ASSISTANT, timeout: 15 }).catch(() => {});

  // Mandatory minimum wait — Grammarly needs time to start analysis
  await page.wait(5000);

  // Then poll until suggestion count stabilizes (non-zero or stable at zero)
  await page.evaluate(`
    new Promise(resolve => {
      let lastCount = '', stableFor = 0;
      let seenNonZero = false;
      const iv = setInterval(() => {
        const h3 = document.querySelector('${SEL_SUGGESTION_COUNT}');
        const countText = h3?.getAttribute('aria-label') || '';
        const spans = document.querySelectorAll('${SEL_FLAGGED}').length;
        const key = countText + '|' + spans;

        if (spans > 0 || countText.match(/\\d+/)) seenNonZero = true;

        if (key === lastCount) stableFor += 500;
        else stableFor = 0;
        lastCount = key;

        // Only consider stable if we've seen suggestions, or waited long enough
        const threshold = seenNonZero ? 2000 : 8000;
        if (stableFor >= threshold) { clearInterval(iv); resolve(); }
      }, 500);
      setTimeout(() => { clearInterval(iv); resolve(); }, 60000);
    })
  `);
}

// ── Extract alerts from alertsRepository ─────────────────────────────

export async function extractAlerts(page: IPage): Promise<Alert[]> {
  // Access Grammarly's internal alertsRepository via React fiber tree.
  // denaliViewModels._engine.alertsRepository.toArray() returns ALL alerts
  // with structured data — no scrolling, no SDUI parsing, no DOM scraping.
  return page.evaluate(`
    (() => {
      const root = document.querySelector('#page');
      const ck = root && Object.keys(root).find(k => k.startsWith('__reactContainer'));
      if (!ck) return [];
      const fiber = root[ck];

      // Find denaliViewModels in the fiber tree
      let dvm = null;
      const seen = new WeakSet();
      function walk(f, d) {
        if (!f || d > 65 || dvm || seen.has(f)) return;
        seen.add(f);
        if (f.memoizedProps?.denaliViewModels) { dvm = f.memoizedProps.denaliViewModels; return; }
        walk(f.child, d + 1);
        walk(f.sibling, d + 1);
      }
      walk(fiber, 0);
      if (!dvm?._engine?.alertsRepository) return [];

      const raw = dvm._engine.alertsRepository.toArray();
      const alerts = [];
      let idx = 0;

      for (const a of raw) {
        // Skip disposed or invalid alerts
        if (a._disposed || !a._isValid) continue;

        const original = (a.highlightTexts || []).join(' ').trim();
        if (!original) continue;

        // Strip HTML tags from explanation
        const explanation = (a.explanation || '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\\s+/g, ' ')
          .trim();

        alerts.push({
          rank: ++idx,
          category: a.lensType || 'unknown',
          severity: a.alertType === 'premium' ? 'premium' : a.priority >= 2 ? 'critical' : 'warning',
          message: a.categoryHuman || a.category || '',
          original,
          // replaceText sometimes equals the original (e.g. "arises" -> "arises").
          // In that case, the real replacement is in labels[0].replacementTexts[0].
          replacement: (a.replaceText && a.replaceText !== original)
            ? a.replaceText
            : (a.labels?.[0]?.replacementTexts?.[0] || a.labels?.[0]?.label || a.replaceText || ''),
          explanation,
        });
      }

      return alerts;
    })()
  `) as Promise<Alert[]>;
}

// ── Shared: find documentModel via React fiber ──────────────────────

const FIND_DOC_MODEL = `
  (() => {
    const root = document.querySelector('#page');
    const ck = root && Object.keys(root).find(k => k.startsWith('__reactContainer'));
    if (!ck) return null;
    const fiber = root[ck];
    let dm = null;
    function walk(f, d) {
      if (!f || d > 65 || dm) return;
      if (f.memoizedProps?.documentModel) { dm = f.memoizedProps.documentModel; return; }
      walk(f.child, d + 1);
      walk(f.sibling, d + 1);
    }
    walk(fiber, 0);
    return dm;
  })()
`;

// ── Extract score from documentModel.score observable ────────────────

export async function extractScore(page: IPage): Promise<number> {
  // Poll the score observable — Grammarly computes it asynchronously
  // after analysis completes. Wait up to 15s for it to populate.
  return page.evaluate(`
    new Promise(resolve => {
      const dm = ${FIND_DOC_MODEL};
      if (!dm) { resolve(-1); return; }

      let attempts = 0;
      const iv = setInterval(() => {
        attempts++;
        const scoreObj = dm.score?._value;
        if (scoreObj?._tag === 'Some' && typeof scoreObj.value === 'number') {
          clearInterval(iv);
          resolve(scoreObj.value);
          return;
        }

        // Fallback: check DOM button for rendered score
        const btns = document.querySelectorAll('button');
        for (const btn of btns) {
          const label = btn.getAttribute('aria-label') || '';
          const m = label.match(/score[:\\s]*(\\d+)/i);
          if (m) { clearInterval(iv); resolve(parseInt(m[1], 10)); return; }
          if (btn.textContent?.includes('Overall score')) {
            const span = btn.querySelector('span');
            const n = parseInt(span?.textContent || '', 10);
            if (!isNaN(n) && n >= 0 && n <= 100) { clearInterval(iv); resolve(n); return; }
          }
        }

        if (attempts >= 30) { clearInterval(iv); resolve(-1); }
      }, 500);
    })
  `) as Promise<number>;
}

// ── Extract detailed stats from documentModel ────────────────────────

export async function extractDocStats(page: IPage): Promise<{
  score: number;
  scoreStatus: string;
  readabilityScore: number;
  counters: Record<string, number>;
  wordsCount: number;
  charsCount: number;
}> {
  // Poll until score populates (up to 15s), then snapshot all stats
  return page.evaluate(`
    new Promise(resolve => {
      const dm = ${FIND_DOC_MODEL};
      if (!dm) { resolve({ score: -1, scoreStatus: 'unknown', readabilityScore: -1, counters: {}, wordsCount: 0, charsCount: 0 }); return; }

      let attempts = 0;
      const iv = setInterval(() => {
        attempts++;
        const scoreObj = dm.score?._value;
        const ready = (scoreObj?._tag === 'Some') || attempts >= 30;
        if (!ready) return;

        clearInterval(iv);
        const score = scoreObj?._tag === 'Some' ? scoreObj.value : -1;
        const scoreStatus = dm.scoreStatus?._value?.value || dm.scoreStatus?._value?._tag || 'unknown';
        const counters = dm.counters?._value || {};
        const textInfo = dm.textInfo?._value?.value || {};

        resolve({
          score: typeof score === 'number' ? score : -1,
          scoreStatus: String(scoreStatus),
          readabilityScore: textInfo.readabilityScore ?? -1,
          counters: {
            critical: counters.critical || 0,
            advanced: counters.advanced || 0,
            free: counters.free || 0,
            paid: counters.paid || 0,
          },
          wordsCount: textInfo.wordsCount || 0,
          charsCount: textInfo.charsCount || 0,
        });
      }, 500);
    })
  `);
}

// ── Extract tones (Pro feature — returns empty on free tier) ─────────

export async function extractTones(page: IPage): Promise<ToneSignal[]> {
  // Tone detection is a Grammarly Pro feature.
  // On free tier, no tone data is available in the DOM or React state.
  // We still check both DOM and fiber in case the user has Pro.
  return page.evaluate(`
    (() => {
      const tones = [];
      let idx = 0;

      // Check DOM for tone elements
      const candidates = document.querySelectorAll(
        '[data-purpose*="tone"], [class*="tone" i], [aria-label*="tone" i]'
      );
      for (const el of candidates) {
        const raw = (el.textContent || '').trim();
        if (!raw || raw.length > 50) continue;
        const emojiMatch = raw.match(/(\\p{Emoji_Presentation}|\\p{Emoji}\\uFE0F)/u);
        const emoji = emojiMatch ? emojiMatch[0] : '';
        const tone = raw.replace(/(\\p{Emoji_Presentation}|\\p{Emoji}\\uFE0F)/gu, '').trim();
        if (tone && tone.length < 30) {
          tones.push({ rank: ++idx, tone, confidence: 'high', emoji });
        }
      }
      return tones;
    })()
  `) as Promise<ToneSignal[]>;
}

// ── Extract corrected text from editor ───────────────────────────────

export async function extractEditorText(page: IPage): Promise<string> {
  return page.evaluate(`
    (() => {
      const editor = document.querySelector('${SEL_EDITOR}');
      return editor?.innerText?.trim() || '';
    })()
  `) as Promise<string>;
}

// ── Text stats (local, no browser needed) ────────────────────────────

export function textStats(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  return {
    word_count: words.length,
    char_count: text.length,
    sentence_count: sentences.length,
    reading_time_sec: Math.ceil(words.length / 238 * 60),
  };
}
