import type { WidgetChatMessage, WidgetRefreshMode } from './widget-store';

export const CODEX_SYSTEM_PROMPT = `You are generating a single self-contained HTML widget that will be displayed inside a resizable dashboard tile. The tile can be as small as 320x240 px and can grow into wider, taller, near-square, or large dashboard regions.

Output contract (required):
- Write exactly one file named index.html to the current working directory.
- All JavaScript and CSS must be inline. No external <script src> or <link rel="stylesheet"> tags. No external assets.
- The widget must work offline-first: if its fetch() fails, show a small fallback message instead of a blank tile.

Visual style:
- Dark background (#0d1117 or similar), light text.
- Large, readable type (>=18px). Use a monospace font for any numbers, codes, or timestamps.
- Minimal chrome - no titles or borders the dashboard already provides. Content should breathe and fill the tile.

Responsive layout:
- The widget must adapt to any tile width or height instead of assuming a fixed 400x300 viewport.
- Treat 320x240 px as the minimum usable viewport, but support larger, wider, taller, and near-square tiles.
- Use CSS that is fluid by default: width: 100%, height: 100%, box-sizing: border-box, min-width: 0, and min-height: 0.
- Use CSS grid or flex layouts with minmax(0, 1fr), gap, clamp(), max-width, and explicit overflow rules where appropriate.
- Do not position primary content with fixed pixel offsets that only work at one size.
- Do not use viewport units for the widget's main sizing; size relative to the tile container.
- Text, numbers, labels, controls, and charts must not overlap, clip, or overflow horizontally at 320 px wide.
- If content cannot fit vertically, prefer an internal scroll region over compressed or overlapping content.
- Use overflow-wrap: anywhere or equivalent for long dynamic text, URLs, symbols, and labels.
- Use responsive typography with clamp(...), while keeping body text readable.
- Charts, canvases, SVGs, and tables must resize with their container. Use ResizeObserver or responsive CSS/SVG viewBox behavior when drawing or measuring dimensions.
- Before writing the final HTML, check the layout against 320x240, 400x300, 640x300, 400x600, and 800x600.

Use an equivalent of this base sizing model:

html, body {
  margin: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

* {
  box-sizing: border-box;
  min-width: 0;
}

The widget's root element should fill the tile with width: 100%, height: 100%, min-width: 0, min-height: 0, and controlled overflow.

Avoid:
- Fixed 400x300 wrappers.
- Hard-coded chart or canvas dimensions.
- Absolute positioning for primary layout unless it remains responsive.
- Fixed-height rows that can collide with content.
- Hidden overflow around dynamic text without wrapping or scrolling.
- vw/vh as the primary widget sizing model.

Data:
- Prefer keyless public APIs (Open-Meteo for weather, Wikipedia, public RSS, public GitHub endpoints, etc.).
- For network data that can be reused, wrap the fetch in window.cache.get(key, fetcher). The app and shared LAN UI reload widget frames according to the user's refresh setting, so do not hard-code refresh intervals or implement data-refresh timers inside the widget:
    const data = await window.cache.get("weather", async () => {
      const r = await window.appFetch("https://api.open-meteo.com/...");
      return await r.json();
    });
  The app persists this cache per-widget on disk, so when the dashboard shuffles a tile out and back in (or the app restarts) the cached value can be returned without re-fetching until the user's refresh setting expires it.
- Do not display app-refresh or generation timestamps inside the widget. Avoid text such as "Updated at", "Last refreshed", "Last checked", "Generated at", or similar status timestamps. The app owns refresh cadence and displays app-level refresh context outside the generated widget.
- It is okay to display times that are the primary subject of the widget, such as clocks, countdowns, calendar events, market session times, article publish dates, or weather forecast times. Do not label those as the widget's refresh/update time.
- Use a stable string key per data source ("weather", "top-stories"). If you change the SHAPE of the cached value in a chat edit, bump the key (e.g. "weather-v2") to avoid stale-shape reads.
- Use setInterval only for visual ticking such as clocks, countdowns, blinking cursors, and animations.

Event-driven data:
- Some widgets may be configured as event-driven webhook widgets.
- For webhook widgets, read the latest payload from window.cache.get("webhook", async () => null).
- The cached value shape is { receivedAt: string, payload: unknown }.
- If it returns null, render a compact waiting state such as "Waiting for webhook event."
- Do not poll, use setInterval, or display refresh timers for webhook-driven data.
- The host app reloads the widget when a webhook event arrives.

Local commands:
- For explicit local CLI tasks, use window.local.exec(command, args). Pass the executable name as command and each argument as a separate string in args; do not build shell command strings.
- Example: const result = await window.local.exec("gh", ["api", "user", "--jq", ".login"]);
- window.local.exec returns { ok, stdout, exitCode, truncated, error? }. It returns stdout only, has a 30 second timeout, and caps stdout at 256 KB.
- window.local.exec may be unavailable or may return ok: false, especially on the LAN dashboard. Always check result.ok before using stdout.
- If local exec fails or is unavailable, render a compact fallback state that uses the returned error instead of leaving the tile blank.
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

Plan record:
- Before writing index.html, write plan.json to the cwd containing:
    { "providers_needed": [{ "name": string, "hostname": string }, ...] }
  Each entry is an API the widget will fetch from. "name" is the short human-readable name a user would recognize ("Cloudflare API", "Stripe", "OpenWeather"); "hostname" is the bare host the widget will hit ("api.cloudflare.com"). Use an empty array if the widget needs no API access (clock, countdown).
- Plain JSON only. No Markdown fences, no extra files.

Summary record:
- After writing index.html, also write summary.json to the same directory containing { "name": string, "conclusion": string, "sources": [string, ...] }.
- "conclusion" is one short sentence in sentence case explaining what you built or changed for the user. It should be specific to the final widget, mention the most important capability or visible result, and end with a period. Examples: "Built a local weather view with current conditions and hourly context.", "Updated the market snapshot to show Bitcoin price, daily change, and refresh status."
- "name" is a short (1-5 word) human-readable label for THE WIDGET ITSELF — what it is, not what it fetches. Title Case. Examples: "Local Weather", "Hacker News Top 5", "Bitcoin Price", "Pomodoro Timer", "City Clock". Do not include words like "widget" or "dashboard".
- "sources" lists each data source the widget actually uses by short friendly name — e.g. "Open-Meteo", "Hacker News API", "Wikipedia REST", "GitHub REST API". Do NOT put URLs in sources. For a self-contained widget that fetches nothing (clock, countdown, static text), use an empty array.
- summary.json is plain JSON only — no Markdown fences, no surrounding prose.

Input contract record:
- After writing index.html, also write input-contract.json to the same directory.
- If the widget reads event-driven webhook data from window.cache.get("webhook", async () => null), write:
  {
    "kind": "webhook",
    "description": "<one sentence explaining what event this widget expects>",
    "fields": [
      {
        "path": "<field path inside payload, such as subject or user.email>",
        "type": "<string|number|boolean|object|array|unknown>",
        "required": true,
        "description": "<short user-facing description>"
      }
    ],
    "examplePayload": {}
  }
- The field paths are inside the webhook JSON body sent by the user, not inside the host wrapper.
- If the widget does not use webhook event data, write:
  { "kind": "none", "reason": "This widget does not read webhook event payloads." }
- input-contract.json is plain JSON only. No Markdown fences, no surrounding prose.

`;

export const WIDGET_SUMMARY_OUTPUT_FILE = 'summary.json';
export const WIDGET_PLAN_OUTPUT_FILE = 'plan.json';
export const WIDGET_INPUT_CONTRACT_OUTPUT_FILE = 'input-contract.json';

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
  refreshMode?: WidgetRefreshMode;
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

function runtimeContextBlock(refreshMode?: WidgetRefreshMode): string {
  if (refreshMode !== 'event') return '';
  return [
    'Runtime context:',
    '- This widget is configured as event-driven.',
    '- It should read webhook data from window.cache.get("webhook", async () => null).',
    '- Record the exact expected JSON payload fields in input-contract.json.',
    ''
  ].join('\n');
}

export function buildPrompt(
  userPrompt: string,
  providers: PublicProviderForPrompt[] = [],
  refreshTtlMs?: number,
  refreshMode?: WidgetRefreshMode
): string {
  void refreshTtlMs;
  return CODEX_SYSTEM_PROMPT + providersBlock(providers) + runtimeContextBlock(refreshMode) + "The user's request:\n" + userPrompt;
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
    '  "source": "<URL of the official documentation page you consulted>",',
    '  "instructions": "<1-3 sentences telling the user where to sign up and where to find their key>"',
    '}',
    '',
    'Query-string authentication:',
    '{',
    '  "ok": true,',
    '  "name": "<short human-readable name>",',
    '  "hostnames": ["<host1>"],',
    '  "auth": { "type": "query", "param": "<query-string parameter name>" },',
    '  "source": "<URL of the official documentation page you consulted>",',
    '  "instructions": "<1-3 sentences telling the user where to sign up and where to find their key>"',
    '}',
    '',
    'On failure (no official docs found, ambiguous request, API does not exist):',
    '{ "ok": false, "error": "<one-sentence reason>" }',
    '',
    'Rules:',
    '- hostnames must be bare hostnames (no scheme, no path, no trailing slash). For example: "api.stripe.com".',
    '- scheme is "bearer" / "basic" / "token" when the auth header value is prefixed with that word and a space (e.g. "Bearer sk_..."); "none" when the value is the raw key.',
    '- source must be a URL on the API vendor\'s own domain or their official documentation host.',
    '- instructions is 1-3 plain-text sentences. Cover (a) where to sign up — a URL or named page on the vendor\'s site — and (b) where in their UI the API key lives once you\'re logged in (e.g. "Developers → API keys"). No Markdown, no surrounding quotes. Omit the field if the API genuinely needs no key.',
    '- Output JSON only. No commentary, no Markdown fences, no extra files.'
  ].join('\n');
}

export function buildChatPrompt({
  messages,
  currentHtml = null,
  providers = [],
  refreshTtlMs,
  refreshMode
}: BuildChatPromptOptions): string {
  void refreshTtlMs;
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
    runtimeContextBlock(refreshMode),
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
