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

The user's request:
`;

export function buildPrompt(userPrompt: string): string {
  return CODEX_SYSTEM_PROMPT + userPrompt;
}
