/**
 * Shared Grammarly automation helpers.
 *
 * All functions accept an opencli IPage — they never create their own
 * browser session.  opencli's runtime handles the browser bridge,
 * session reuse, and cookie-based auth.
 */

import type { IPage } from '@jackwener/opencli/types';

// ── Constants ───────────────────────────────────────���────────────────

const EDITOR_URL = 'https://app.grammarly.com/docs/new';
const API_PATTERN = 'capi.grammarly.com';

// Selectors: auth'd editor (app.grammarly.com)
const SEL_EDITOR = '[contenteditable="true"]';
const SEL_ASSISTANT = [
  '[data-purpose="assistant"]',
  '[class*="Assistant"]',
  '[class*="sidebar"]',
].join(', ');
const SEL_CARD = [
  '[data-purpose="alert-card"]',
  '[class*="suggestion"]',
  '[class*="AlertCard"]',
  '[class*="card"][class*="alert"]',
].join(', ');
const SEL_SCORE = [
  '[data-purpose="score"]',
  '[class*="OverallScore"]',
  '[class*="score-circle"]',
].join(', ');
const SEL_TONE = [
  '[data-purpose*="tone"]',
  '[class*="ToneDetector"]',
  '[class*="tone-chip"]',
].join(', ');

// Selectors: public grammar checker (grammarly.com/grammar-check)
const PUBLIC_EDITOR_URL = 'https://www.grammarly.com/grammar-check';
const SEL_PUBLIC_EDITOR = '[role="textbox"]';
const SEL_PUBLIC_SUGGESTIONS = '[role="region"][aria-label="Grammarly"]';

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

// ── Submit text to the Grammarly editor ──────────────────────────────

export async function submitText(page: IPage, text: string, usePublic = false): Promise<void> {
  const url = usePublic ? PUBLIC_EDITOR_URL : EDITOR_URL;
  const editorSel = usePublic ? SEL_PUBLIC_EDITOR : SEL_EDITOR;

  await page.goto(url, { waitUntil: 'load' });
  await page.wait({ selector: editorSel, timeout: 15 });
  await page.wait(2000);  // let editor JS initialize

  // Clear existing text and paste new text via evaluate
  await page.evaluate(`
    (() => {
      const ed = document.querySelector('${editorSel}');
      if (!ed) throw new Error('Editor not found');
      ed.focus();
      document.execCommand('selectAll');
      document.execCommand('delete');
      document.execCommand('insertText', false, ${JSON.stringify(text)});
    })()
  `);

  // Install network interceptor BEFORE waiting, so we capture analysis responses
  await page.installInterceptor(API_PATTERN);

  await waitForAnalysis(page);
}

// ── Wait for analysis to settle ──────────────────────────────────────

async function waitForAnalysis(page: IPage): Promise<void> {
  // Wait for the assistant panel to appear (may not if text is clean)
  await page.wait({ selector: SEL_ASSISTANT, timeout: 15 }).catch(() => {});

  // Poll until underline count stabilizes
  await page.evaluate(`
    new Promise(resolve => {
      let lastCount = -1, stableFor = 0;
      const iv = setInterval(() => {
        const n = document.querySelectorAll(
          '[class*="underline"], [class*="alert"], [data-gr-id]'
        ).length;
        const loading = document.querySelector(
          '[class*="loading"], [class*="spinner"], [class*="progress"]'
        );
        if (n === lastCount && !loading) stableFor += 500;
        else stableFor = 0;
        lastCount = n;
        if (stableFor >= 3000) { clearInterval(iv); resolve(); }
      }, 500);
      setTimeout(() => { clearInterval(iv); resolve(); }, 60000);
    })
  `);
}

// ── Extract alerts (network intercept → DOM fallback) ────────────────

export async function extractAlerts(page: IPage): Promise<Alert[]> {
  // Strategy 1: Parse intercepted API responses
  const intercepted = await page.getInterceptedRequests();
  const apiAlerts = parseInterceptedAlerts(intercepted);
  if (apiAlerts.length > 0) return apiAlerts;

  // Strategy 2: Scrape suggestion cards from the DOM
  return page.evaluate(`
    (() => {
      const cards = document.querySelectorAll('${SEL_CARD}');
      const alerts = [];
      let idx = 0;
      for (const card of cards) {
        const text = (card.textContent || '').trim();
        if (!text) continue;

        const catEl = card.querySelector('[class*="category"], [class*="type"]');
        const catRaw = (catEl?.textContent || '').toLowerCase();
        let category = 'unknown';
        if (catRaw.includes('correct')) category = 'correctness';
        else if (catRaw.includes('clar')) category = 'clarity';
        else if (catRaw.includes('engag')) category = 'engagement';
        else if (catRaw.includes('deliver')) category = 'delivery';

        const classes = card.className || '';
        let severity = 'warning';
        if (classes.includes('critical') || classes.includes('error')) severity = 'critical';
        else if (classes.includes('info') || classes.includes('enhance')) severity = 'info';

        const msgEl = card.querySelector('[class*="message"], [class*="title"]');
        const message = msgEl?.textContent?.trim() || text.slice(0, 120);

        const origEl = card.querySelector('[class*="original"], del, s');
        const replEl = card.querySelector('[class*="replacement"], ins, [class*="correct"]');
        const expEl  = card.querySelector('[class*="explanation"], [class*="detail"]');

        alerts.push({
          rank: ++idx,
          category,
          severity,
          message,
          original:    origEl?.textContent?.trim() || '',
          replacement: replEl?.textContent?.trim() || '',
          explanation: expEl?.textContent?.trim()  || '',
        });
      }
      return alerts;
    })()
  `) as Alert[];
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

// ── Extract score ────────────────────────────────────────────────────

export async function extractScore(page: IPage): Promise<number> {
  return page.evaluate(`
    (() => {
      const el = document.querySelector('${SEL_SCORE}');
      if (el) {
        const n = parseInt(el.textContent || '', 10);
        if (!isNaN(n) && n >= 0 && n <= 100) return n;
      }
      // Fallback: look for any prominent number 0-100 near "score"
      const all = document.querySelectorAll('[class*="score"], [class*="Score"]');
      for (const s of all) {
        const n = parseInt(s.textContent || '', 10);
        if (!isNaN(n) && n >= 0 && n <= 100) return n;
      }
      return -1;
    })()
  `) as Promise<number>;
}

// ── Extract tones ────────────────────────────────────────────────────

export async function extractTones(page: IPage): Promise<ToneSignal[]> {
  return page.evaluate(`
    (() => {
      const tones = [];
      const els = document.querySelectorAll('${SEL_TONE}');
      let idx = 0;
      for (const el of els) {
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
