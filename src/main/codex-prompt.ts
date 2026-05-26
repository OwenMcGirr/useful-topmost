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
- Pick a sensible refresh cadence and bake it into a setInterval.

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

`;

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
}

export function buildPrompt(userPrompt: string, providers: PublicProviderForPrompt[] = []): string {
  return CODEX_SYSTEM_PROMPT + providersBlock(providers) + "The user's request:\n" + userPrompt;
}

export function buildChatPrompt({
  messages,
  currentHtml = null,
  providers = []
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
