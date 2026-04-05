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

// ── Submit text to the Grammarly editor ──────────────────────────────

export async function submitText(page: IPage, text: string, docId?: string): Promise<void> {
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

  // Focus the editor body
  await page.evaluate(`document.querySelector('${SEL_EDITOR}')?.focus()`);
  await page.wait(300);

  // Select all + delete existing text, then type new text via CDP
  // Using pressKey + insertText (CDP native) instead of execCommand,
  // because Grammarly uses ProseMirror which ignores execCommand.
  await page.pressKey('Meta+a');
  await page.wait(200);
  await page.pressKey('Backspace');
  await page.wait(200);

  if (page.insertText) {
    await page.insertText(text);
  } else {
    // Fallback: type char-by-char (slow but works)
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

// ── Extract alerts via React fiber tree (fullContent SDUI) ───────────

export async function extractAlerts(page: IPage): Promise<Alert[]> {
  // Walk the React fiber tree to find every longFormCard component.
  // Each card's fullContent SDUI tree contains:
  //   - Category + message: first text string like "Correctness · Use the right word"
  //   - Original word: text immediately before a "strikeoutHorizontal" marker
  //   - Replacement: text immediately after the "strikeoutHorizontal" + original pair
  //
  // This data is present for ALL cards, even collapsed ones.
  return page.evaluate(`
    (() => {
      // ── Flatten all text strings from an SDUI tree ──
      function extractTexts(obj, depth, out) {
        if (!obj || depth > 15 || out.length > 50) return;
        if (typeof obj === 'string') { out.push(obj); return; }
        if (typeof obj.text === 'string') out.push(obj.text);
        for (const k of Object.keys(obj)) {
          const v = obj[k];
          if (Array.isArray(v)) v.forEach(x => extractTexts(x, depth + 1, out));
          else if (v && typeof v === 'object') extractTexts(v, depth + 1, out);
        }
      }

      // ── Parse a fullContent text list into {message, original, replacement} ──
      function parseCard(texts) {
        let message = '';
        let original = '';
        let replacement = '';

        // First text that contains "·" or starts with a known category prefix is the message
        for (const t of texts) {
          if (/^(Correctness|Clarity|Engagement|Delivery)\\s/.test(t) || /Correct |Use the |Rewrite|Consider|Add a/.test(t)) {
            message = t;
            break;
          }
        }

        // Find the original: the text right before "strikeoutHorizontal"
        for (let i = 0; i < texts.length; i++) {
          if (texts[i] === 'strikeoutHorizontal') {
            // Original is the text before this marker, skipping formatting tokens
            for (let j = i - 1; j >= 0; j--) {
              if (texts[j] !== 'bold' && texts[j] !== 'italic' && texts[j].trim()) {
                original = texts[j];
                break;
              }
            }
            // Replacement is the next non-formatting text after the marker
            for (let j = i + 1; j < texts.length; j++) {
              if (texts[j] === 'bold' || texts[j] === 'italic' || texts[j] === ' ') continue;
              if (texts[j] === 'strikeoutHorizontal') break;  // next card section
              if (texts[j] === 'Accept' || texts[j] === 'Dismiss') break;
              if (texts[j].trim()) {
                replacement = texts[j];
                break;
              }
            }
            break;  // only need first occurrence
          }
        }

        return { message, original, replacement };
      }

      // ── Get category from editor spans (they have alerts-{category} class) ──
      const categoryMap = new Map();
      const editorSpans = document.querySelectorAll('${SEL_FLAGGED}');
      for (const span of editorSpans) {
        const text = span.textContent?.trim();
        if (!text) continue;
        const cls = span.className || '';
        let cat = 'unknown';
        if (cls.includes('alerts-correctness')) cat = 'correctness';
        else if (cls.includes('alerts-clarity')) cat = 'clarity';
        else if (cls.includes('alerts-engagement')) cat = 'engagement';
        else if (cls.includes('alerts-delivery')) cat = 'delivery';
        categoryMap.set(text, cat);
      }

      // ── Walk UP from assistant panel DOM elements to find longFormCard fibers ──
      // Top-down fiber traversal can't reach portal-mounted cards, but every
      // rendered DOM element has a __reactFiber reference. We walk UP from
      // each <span>/<strong> inside the assistant to find the nearest
      // longFormCard ancestor (has fullContent + collapsedContent props).
      const targets = document.querySelectorAll('${SEL_ASSISTANT} span, ${SEL_ASSISTANT} strong');
      const cardMap = new Map();  // card id → fullContent texts

      for (const el of targets) {
        const fk = Object.keys(el).find(k => k.startsWith('__reactFiber'));
        if (!fk) continue;
        let f = el[fk];
        for (let i = 0; i < 25 && f; i++) {
          const p = f.memoizedProps;
          if (p?.fullContent && p?.collapsedContent && p?.id && !cardMap.has(p.id)) {
            const texts = [];
            extractTexts(p.fullContent, 0, texts);
            cardMap.set(p.id, texts);
            break;
          }
          f = f.return;
        }
      }

      // If fiber approach found nothing, fall back to editor spans
      if (cardMap.size === 0) {
        for (const [text, cat] of categoryMap) {
          alerts.push({ rank: ++idx, category: cat, severity: 'warning', message: '', original: text, replacement: '', explanation: '' });
        }
        return alerts;
      }

      const cards = [...cardMap.values()];

      // ── Build alert objects from card data ──
      const alerts = [];
      let idx = 0;
      for (const texts of cards) {
        const { message, original, replacement } = parseCard(texts);
        if (!original) continue;

        // Parse category from message or from editor span
        let category = categoryMap.get(original) || 'unknown';
        if (category === 'unknown' && message) {
          const msgLower = message.toLowerCase();
          if (msgLower.startsWith('correctness') || msgLower.includes('spelling') || msgLower.includes('subject-verb')) category = 'correctness';
          else if (msgLower.startsWith('clarity')) category = 'clarity';
          else if (msgLower.startsWith('engagement')) category = 'engagement';
          else if (msgLower.startsWith('delivery')) category = 'delivery';
        }

        alerts.push({
          rank: ++idx,
          category,
          severity: 'warning',
          message,
          original,
          replacement,
          explanation: '',
        });
      }

      return alerts;
    })()
  `) as Promise<Alert[]>;
}

function parseInterceptedAlerts(requests: any[]): Alert[] {
  const alerts: Alert[] = [];
  let idx = 0;

  for (const req of requests) {
    try {
      const body = typeof req.responseBody === 'string'
        ? JSON.parse(req.responseBody)
        : req.responseBody;

      // Grammarly's CAPI returns alerts in various shapes
      const items = body?.alerts || body?.result?.alerts || body?.data?.alerts;
      if (!Array.isArray(items)) continue;

      for (const a of items) {
        alerts.push({
          rank: ++idx,
          category: a.category?.toLowerCase() || a.group?.toLowerCase() || 'unknown',
          severity: a.impact === 'critical' ? 'critical' : a.impact === 'advanced' ? 'info' : 'warning',
          message: a.title || a.details || a.message || '',
          original: a.highlightBegin != null && a.highlightEnd != null
            ? a.text?.slice(a.highlightBegin, a.highlightEnd) || ''
            : a.misspelled || '',
          replacement: (a.replacements?.[0] || a.suggestion || ''),
          explanation: a.explanation || a.details || '',
        });
      }
    } catch {
      // Not JSON or unexpected shape — skip
    }
  }
  return alerts;
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
  return page.evaluate(`
    (() => {
      const dm = ${FIND_DOC_MODEL};
      if (!dm) return -1;

      // score is an RxJS BehaviorSubject; _value is a tagged union {_tag, value}
      const scoreObj = dm.score?._value;
      if (scoreObj?._tag === 'Some' && typeof scoreObj.value === 'number') {
        return scoreObj.value;
      }

      // Fallback: parse from the DOM button
      const btns = document.querySelectorAll('button');
      for (const btn of btns) {
        if (btn.textContent?.includes('Overall score')) {
          const span = btn.querySelector('span');
          const n = parseInt(span?.textContent || '', 10);
          if (!isNaN(n) && n >= 0 && n <= 100) return n;
        }
      }
      return -1;
    })()
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
  return page.evaluate(`
    (() => {
      const dm = ${FIND_DOC_MODEL};
      if (!dm) return { score: -1, scoreStatus: 'unknown', readabilityScore: -1, counters: {}, wordsCount: 0, charsCount: 0 };

      const scoreObj = dm.score?._value;
      const score = scoreObj?._tag === 'Some' ? scoreObj.value : -1;
      const scoreStatus = dm.scoreStatus?._value?.value || dm.scoreStatus?._value?._tag || 'unknown';
      const counters = dm.counters?._value || {};
      const textInfo = dm.textInfo?._value?.value || {};

      return {
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
      };
    })()
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
