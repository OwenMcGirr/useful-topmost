import type { WidgetChatMessage } from './widget-store';

export const CODEX_SYSTEM_PROMPT = `You are generating a single self-contained HTML widget that will be displayed in a 400x300 px tile on a dashboard.

Output contract (required):
- Write exactly one file named index.html to the current working directory.
- All JavaScript and CSS must be inline. No external <script src> or <link rel="stylesheet"> tags. No external assets.
- The widget must work offline-first: if its fetch() fails, show a small fallback message instead of a blank tile.

Visual style:
- Dark background (#0d1117 or similar), light text.
- Large, readable type (>=18px). Use a monospace font for any numbers, codes, or timestamps.
- Minimal chrome - no titles or borders the dashboard already provides. Content should breathe and fill the tile.
- Design for a 400x300 viewport. Content can scroll vertically if it must, but shouldn't overflow horizontally.

Data:
- Prefer keyless public APIs (Open-Meteo for weather, Wikipedia, public RSS, public GitHub endpoints, etc.).
- For any data with a natural refresh cadence (every 10 minutes, hourly, daily), wrap the fetch in window.cache.get(key, ttlMs, fetcher):
    const data = await window.cache.get("weather", 60 * 60 * 1000, async () => {
      const r = await window.appFetch("https://api.open-meteo.com/...");
      return await r.json();
    });
  The app persists this cache per-widget on disk, so when the dashboard shuffles a tile out and back in (or the app restarts) the cached value is returned without re-fetching until the TTL expires.
- Use a stable string key per data source ("weather", "top-stories"). If you change the SHAPE of the cached value in a chat edit, bump the key (e.g. "weather-v2") to avoid stale-shape reads.
- Use setInterval only for purely visual ticking (countdown clock, blinking cursor) that does not perform a fetch.

Local commands:
- For explicit local CLI tasks, use window.local.exec(command, args). Pass the executable name as command and each argument as a separate string in args; do not build shell command strings.
- Example: const result = await window.local.exec("gh", ["api", "user", "--jq", ".login"]);
- window.local.exec returns { ok, stdout, exitCode, truncated, error? }. It returns stdout only, has a 30 second timeout, and caps stdout at 256 KB.
- Always handle ok: false and truncated: true in the widget UI.
- Prefer fetch() or window.appFetch() for ordinary web API calls. Use window.local.exec only when the user's request specifically needs local CLI access.

Looking things up:
- If you do not already know the exact shape of an API (endpoint path, query params, response JSON, auth header name), look it up via your browser or by curl-ing the official docs before writing the widget. Do not guess.
- For any request the widget will make, confirm the URL, method, required headers, and the response shape against the upstream's documentation. A widget that hits the wrong endpoint or reads the wrong field is worse than one that fails fast.
- Inside the widget, use plain object headers like { "Accept": "application/json" }. Do not use \`new Headers()\` — Headers instances do not survive the contextIsolation boundary in this app, so any custom headers in one are silently lost.

Before implementation:
- Test or validate the intended data source, selector, CLI command, calculation, or browser API assumption before writing the final widget.
- If validation shows the original approach will fail, choose a simpler working approach and make the widget degrade gracefully.
- Do not include your validation notes in the widget UI. Still write exactly one final index.html file.

Summary record:
- After writing index.html, also write summary.json to the same directory containing { "name": string, "sources": [string, ...] }.
- "name" is a short (1-5 word) human-readable label for THE WIDGET ITSELF — what it is, not what it fetches. Title Case. Examples: "Local Weather", "Hacker News Top 5", "Bitcoin Price", "Pomodoro Timer", "City Clock". Do not include words like "widget" or "dashboard".
- "sources" lists each data source the widget actually uses by short friendly name — e.g. "Open-Meteo", "Hacker News API", "Wikipedia REST", "GitHub REST API". Do NOT put URLs in sources. For a self-contained widget that fetches nothing (clock, countdown, static text), use an empty array.
- summary.json is plain JSON only — no Markdown fences, no surrounding prose.

`;

export const WIDGET_SUMMARY_OUTPUT_FILE = 'summary.json';

export interface PublicProviderForPrompt {
  name: string;
  hostnames: string[];
}

function providersBlock(providers: PublicProviderForPrompt[]): string {
  if (providers.length === 0) return '';
  const lines = providers.map((p) => {
    const urls = p.hostnames.map((h) => `https://${h}`).join(', ');
    return `- ${p.name} (${urls}) — call via window.appFetch`;
  });
  return [
    'Available providers:',
    ...lines,
    '',
    'When fetching from any of the URLs above, use window.appFetch(url, init) instead of fetch(url, init). The app injects authentication automatically and returns a standard Response object. For URLs not in the list above, plain fetch() is fine.',
    '',
    'window.appFetch is a drop-in for fetch — same signature, same Response shape, async. It can only fetch over the network; it cannot read files or access keys.',
    '',
    ''
  ].join('\n');
}

export interface BuildChatPromptOptions {
  messages: WidgetChatMessage[];
  currentHtml?: string | null;
  providers?: PublicProviderForPrompt[];
  refreshTtlMs?: number;
}

export interface RefreshPreset {
  label: string;
  ttlMs: number;
}

export const REFRESH_PRESETS: readonly RefreshPreset[] = [
  { label: 'Live', ttlMs: 0 },
  { label: '1 min', ttlMs: 60_000 },
  { label: '5 min', ttlMs: 300_000 },
  { label: '15 min', ttlMs: 900_000 },
  { label: '1 hour', ttlMs: 3_600_000 },
  { label: '6 hours', ttlMs: 21_600_000 },
  { label: 'Daily', ttlMs: 86_400_000 }
];

export const DEFAULT_REFRESH_TTL_MS = 3_600_000;

export function labelForTtl(ttlMs: number): string {
  const preset = REFRESH_PRESETS.find((p) => p.ttlMs === ttlMs);
  return preset ? preset.label : `${ttlMs} ms`;
}

function refreshBlock(ttlMs: number | undefined): string {
  if (ttlMs === undefined) return '';
  return (
    `Refresh cadence: ${labelForTtl(ttlMs)} (use ttlMs = ${ttlMs} in your window.cache.get calls). Honor this exact value.\n\n`
  );
}

export function buildPrompt(
  userPrompt: string,
  providers: PublicProviderForPrompt[] = [],
  refreshTtlMs?: number
): string {
  return CODEX_SYSTEM_PROMPT + providersBlock(providers) + refreshBlock(refreshTtlMs) + "The user's request:\n" + userPrompt;
}

export const PROVIDER_LOOKUP_OUTPUT_FILE = 'provider.json';

export function buildProviderLookupPrompt(query: string): string {
  return [
    'You are looking up the authentication configuration for a public HTTP API.',
    '',
    'You MUST use your browser_use tool to fetch the official documentation for the API named below.',
    'Do not answer from training-data recall. If you cannot find the official documentation via the',
    'browser, write an error response (see the error shape below) — do not guess.',
    '',
    `API to look up: ${query}`,
    '',
    `Write exactly one file named ${PROVIDER_LOOKUP_OUTPUT_FILE} to the current working directory.`,
    'The file must contain a single JSON object (no surrounding prose, no Markdown fences).',
    '',
    'On success, the JSON must match one of these two shapes:',
    '',
    'Header authentication:',
    '{',
    '  "ok": true,',
    '  "name": "<short human-readable name>",',
    '  "hostnames": ["<host1>", "<host2>", ...],',
    '  "auth": { "type": "header", "name": "<HTTP header name>", "scheme": "none|bearer|basic|token" },',
    '  "source": "<URL of the official documentation page you consulted>"',
    '}',
    '',
    'Query-string authentication:',
    '{',
    '  "ok": true,',
    '  "name": "<short human-readable name>",',
    '  "hostnames": ["<host1>"],',
    '  "auth": { "type": "query", "param": "<query-string parameter name>" },',
    '  "source": "<URL of the official documentation page you consulted>"',
    '}',
    '',
    'On failure (no official docs found, ambiguous request, API does not exist):',
    '{ "ok": false, "error": "<one-sentence reason>" }',
    '',
    'Rules:',
    '- hostnames must be bare hostnames (no scheme, no path, no trailing slash). For example: "api.stripe.com".',
    '- scheme is "bearer" / "basic" / "token" when the auth header value is prefixed with that word and a space (e.g. "Bearer sk_..."); "none" when the value is the raw key.',
    '- source must be a URL on the API vendor\'s own domain or their official documentation host.',
    '- Output JSON only. No commentary, no Markdown fences, no extra files.'
  ].join('\n');
}

export function buildChatPrompt({
  messages,
  currentHtml = null,
  providers = [],
  refreshTtlMs
}: BuildChatPromptOptions): string {
  const userMessages = messages.filter((m) => m.role === 'user');
  const latest = userMessages[userMessages.length - 1]?.text ?? '';
  const history = userMessages
    .map((m, i) => `${i + 1}. ${m.text}`)
    .join('\n');
  const currentHtmlBlock = currentHtml
    ? [
        'Current widget index.html:',
        '```html',
        currentHtml,
        '```',
        ''
      ].join('\n')
    : '';

  return [
    CODEX_SYSTEM_PROMPT,
    providersBlock(providers),
    refreshBlock(refreshTtlMs),
    'Conversation history:',
    history || '(none)',
    '',
    currentHtmlBlock,
    'Revise or create the widget according to the latest user request. Preserve useful existing behavior unless the latest request contradicts it.',
    '',
    "The user's latest request:",
    latest
  ].join('\n');
}
