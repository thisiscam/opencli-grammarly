# opencli-grammarly

An [opencli](https://github.com/jackwener/opencli) adapter that turns grammarly.com into an agent-aware CLI. Uses your existing Chrome session — no separate login, no API keys.

## Install

```bash
# Requires opencli with Browser Bridge extension connected
opencli plugin install github:thisiscam/opencli-grammarly
```

## Commands

### check

Check text for grammar, spelling, punctuation, and style issues.

```bash
# Inline text
opencli grammarly check "Their going to the store tommorow."

# From a file
opencli grammarly check --file essay.txt

# With goals
opencli grammarly check --file report.md --audience expert --formality formal --domain academic
```

```yaml
- rank: 1
  category: correctness
  severity: critical
  message: Use the right word
  original: Their
  replacement: They're
  explanation: "It seems like you used the wrong word here..."
- rank: 2
  category: correctness
  severity: critical
  message: Correct your spelling
  original: tommorow
  replacement: tomorrow
  explanation: "Did you mean tomorrow?"
```

### score

Get writing score, readability, and alert counts.

```bash
opencli grammarly score "The quick brown fox jumps over the lazy dog."
```

```yaml
- score: 72
  scoreStatus: OK
  readabilityScore: 90
  wordsCount: 44
  charsCount: 314
  critical: 2
  advanced: 1
```

### tone

Detect tone (requires Grammarly Pro).

```bash
opencli grammarly tone "I am extremely disappointed with the service."
```

### rewrite

Apply all Grammarly suggestions and return corrected text.

```bash
opencli grammarly rewrite "Their going to the store tommorow."
```

```yaml
- original: Their going to the store tommorow.
  rewritten: They're going to the store tomorrow.
```

## Goals

All commands accept goal flags to control what Grammarly checks for:

```bash
opencli grammarly check "text" \
  --audience expert \
  --formality formal \
  --domain academic \
  --intent inform
```

| Flag | Options |
|------|---------|
| `--audience` | `general`, `knowledgeable`, `expert` |
| `--formality` | `informal`, `neutral`, `formal` |
| `--domain` | `academic`, `business`, `general`, `email`, `casual`, `creative` |
| `--intent` | `inform`, `describe`, `convince`, `tell a story` |

## Options

| Flag | Description |
|------|-------------|
| `--file <path>` | Read text from a file instead of passing inline |
| `--doc <id>` | Use a specific Grammarly document ID instead of the shared scratch doc |
| `--severity <level>` | Filter check results: `critical`, `premium`, or `all` (default) |
| `--format <fmt>` | Output format: `yaml` (default), `json`, `table`, `csv` |

## How it works

1. **Browser Bridge** — opencli's Chrome extension connects the CLI to your running Chrome. Your Grammarly session is reused; no credentials leave the browser.

2. **Scratch document** — commands create or reuse a Grammarly document titled "opencli-scratch" so your document list stays clean. Use `--doc <id>` to target a specific document.

3. **alertsRepository** — alerts are extracted from Grammarly's internal `alertsRepository` via the React fiber tree. This returns all alerts at once with full structured data (category, original, replacement, explanation, severity), regardless of list virtualization. No DOM scraping or scrolling needed.

4. **Score and stats** — pulled from Grammarly's internal `documentModel` RxJS observables (readability score, word count, alert counters).

## Prerequisites

- [opencli](https://github.com/jackwener/opencli) installed with Browser Bridge extension connected (`opencli doctor` to verify)
- Logged into grammarly.com in your Chrome browser

## Development

```bash
# After editing .ts files, rebuild:
./dev.sh

# Rebuild + smoke test:
./dev.sh test

# Rebuild + check custom text:
./dev.sh "Their going tommorow."
```
