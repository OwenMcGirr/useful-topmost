import { describe, it, expect } from 'vitest';
import { CODEX_SYSTEM_PROMPT, REFRESH_PRESETS, buildChatPrompt, buildPrompt, labelForTtl } from '../codex-prompt';

describe('codex-prompt', () => {
  it('exports a non-empty system prompt that mentions the output contract', () => {
    expect(CODEX_SYSTEM_PROMPT.length).toBeGreaterThan(200);
    expect(CODEX_SYSTEM_PROMPT).toContain('index.html');
    expect(CODEX_SYSTEM_PROMPT).toContain('resizable dashboard tile');
  });

  it('instructs Codex to create responsive widgets for dynamic tile sizes', () => {
    expect(CODEX_SYSTEM_PROMPT).not.toContain('displayed in a 400x300 px tile');
    expect(CODEX_SYSTEM_PROMPT).not.toContain('Design for a 400x300 viewport');
    expect(CODEX_SYSTEM_PROMPT).toContain('resizable dashboard tile');
    expect(CODEX_SYSTEM_PROMPT).toContain('320x240');
    expect(CODEX_SYSTEM_PROMPT).toContain('any tile width or height');
    expect(CODEX_SYSTEM_PROMPT).toContain('minmax(0, 1fr)');
    expect(CODEX_SYSTEM_PROMPT).toContain('overflow-wrap: anywhere');
    expect(CODEX_SYSTEM_PROMPT).toContain('ResizeObserver');
    expect(CODEX_SYSTEM_PROMPT).toContain('400x600');
    expect(CODEX_SYSTEM_PROMPT).toContain('800x600');
  });

  it('documents local CLI execution for widgets', () => {
    expect(CODEX_SYSTEM_PROMPT).toContain('window.local.exec(command, args)');
    expect(CODEX_SYSTEM_PROMPT).toContain('["api", "user", "--jq", ".login"]');
    expect(CODEX_SYSTEM_PROMPT).toContain('30 second timeout');
    expect(CODEX_SYSTEM_PROMPT).toContain('256 KB');
    expect(CODEX_SYSTEM_PROMPT).toContain('do not build shell command strings');
  });

  it('instructs widget creation to validate before implementation', () => {
    expect(CODEX_SYSTEM_PROMPT).toContain('Before implementation:');
    expect(CODEX_SYSTEM_PROMPT).toContain('Test or validate the intended data source');
    expect(CODEX_SYSTEM_PROMPT).toContain('before writing the final widget');
    expect(CODEX_SYSTEM_PROMPT).toContain('Do not include your validation notes in the widget UI');
  });

  it('instructs Codex to write a plan.json sidecar with providers_needed', () => {
    expect(CODEX_SYSTEM_PROMPT).toContain('Plan record:');
    expect(CODEX_SYSTEM_PROMPT).toContain('plan.json');
    expect(CODEX_SYSTEM_PROMPT).toContain('providers_needed');
    expect(CODEX_SYSTEM_PROMPT).toContain('Before writing index.html');
  });

  it('instructs Codex to write a summary.json sidecar with name, conclusion, and sources', () => {
    expect(CODEX_SYSTEM_PROMPT).toContain('Summary record:');
    expect(CODEX_SYSTEM_PROMPT).toContain('summary.json');
    expect(CODEX_SYSTEM_PROMPT).toContain('"name"');
    expect(CODEX_SYSTEM_PROMPT).toContain('"conclusion"');
    expect(CODEX_SYSTEM_PROMPT).toContain('"sources"');
    expect(CODEX_SYSTEM_PROMPT).toContain('one short sentence in sentence case');
    expect(CODEX_SYSTEM_PROMPT).toContain('Do NOT put URLs in sources');
    // Old "Sources record" wording is gone (rolled into "Summary record").
    expect(CODEX_SYSTEM_PROMPT).not.toContain('Sources record:');
  });

  it('REFRESH_PRESETS exposes the seven cadence options in order', () => {
    expect(REFRESH_PRESETS.map((p) => p.label)).toEqual([
      'Live', '1 min', '5 min', '15 min', '1 hour', '6 hours', 'Daily'
    ]);
    expect(REFRESH_PRESETS.map((p) => p.ttlMs)).toEqual([
      0, 60_000, 300_000, 900_000, 3_600_000, 21_600_000, 86_400_000
    ]);
    expect(labelForTtl(3_600_000)).toBe('1 hour');
    expect(labelForTtl(0)).toBe('Live');
  });

  it('does not inject refresh cadence into generated widget prompts', () => {
    const withTtl = buildPrompt('show weather', [], 3_600_000);
    expect(withTtl).not.toContain('Refresh cadence:');
    expect(withTtl).not.toContain('Honor this exact value');
    expect(withTtl).not.toContain('use ttlMs =');

    const without = buildPrompt('show weather', []);
    expect(without).not.toContain('Refresh cadence:');
    expect(without).not.toContain('Honor this exact value.');
  });

  it('does not inject refresh cadence into generated widget chat prompts', () => {
    const withTtl = buildChatPrompt({
      messages: [{ id: 'm1', role: 'user', text: 'tweak', created_at: '' }],
      refreshTtlMs: 86_400_000
    });
    expect(withTtl).not.toContain('Refresh cadence:');
    expect(withTtl).not.toContain('Honor this exact value');
    expect(withTtl).not.toContain('use ttlMs =');

    const without = buildChatPrompt({
      messages: [{ id: 'm1', role: 'user', text: 'tweak', created_at: '' }]
    });
    expect(without).not.toContain('Refresh cadence:');
  });

  it('instructs Codex to use app-owned runtime refresh cadence for cached fetches', () => {
    expect(CODEX_SYSTEM_PROMPT).toContain('window.cache.get(key, fetcher)');
    expect(CODEX_SYSTEM_PROMPT).toContain('The app and shared LAN UI reload widget frames');
    expect(CODEX_SYSTEM_PROMPT).toContain('do not hard-code refresh intervals');
    expect(CODEX_SYSTEM_PROMPT).toContain('implement data-refresh timers inside the widget');
    expect(CODEX_SYSTEM_PROMPT).toContain('persists this cache per-widget on disk');
    expect(CODEX_SYSTEM_PROMPT).toContain('bump the key');
    expect(CODEX_SYSTEM_PROMPT).not.toContain('window.cache.get(key, ttlMs, fetcher)');
    expect(CODEX_SYSTEM_PROMPT).not.toContain('Refresh cadence:');
    expect(CODEX_SYSTEM_PROMPT).not.toContain('Honor this exact value');
    expect(CODEX_SYSTEM_PROMPT).not.toContain('use ttlMs =');
    // The old "bake it into a setInterval" line is gone (cache replaces it).
    expect(CODEX_SYSTEM_PROMPT).not.toContain('bake it into a setInterval');
  });

  it('instructs Codex not to render widget refresh timestamps', () => {
    expect(CODEX_SYSTEM_PROMPT).toContain('Do not display app-refresh or generation timestamps inside the widget');
    expect(CODEX_SYSTEM_PROMPT).toContain('Updated at');
    expect(CODEX_SYSTEM_PROMPT).toContain('Last refreshed');
    expect(CODEX_SYSTEM_PROMPT).toContain('Generated at');
    expect(CODEX_SYSTEM_PROMPT).toContain('The app owns refresh cadence');
    expect(CODEX_SYSTEM_PROMPT).toContain('It is okay to display times that are the primary subject of the widget');
  });

  it('buildPrompt appends the user prompt after the system prompt', () => {
    const out = buildPrompt('show the weather');
    expect(out.startsWith(CODEX_SYSTEM_PROMPT)).toBe(true);
    expect(out).toContain('any tile width or height');
    expect(out).toContain('ResizeObserver');
    expect(out.endsWith('show the weather')).toBe(true);
  });

  it('buildPrompt with an empty providers array is identical to no providers', () => {
    expect(buildPrompt('x', [])).toBe(buildPrompt('x'));
  });

  it('buildPrompt with providers inserts the providers block before the user request', () => {
    const out = buildPrompt('show weather', [
      { name: 'OpenWeather', hostnames: ['api.openweathermap.org'] },
      { name: 'NewsAPI', hostnames: ['newsapi.org', 'www.newsapi.org'] }
    ]);

    expect(out).toContain('Available providers:');
    expect(out).toContain('- OpenWeather (https://api.openweathermap.org) — call via window.appFetch');
    expect(out).toContain('- NewsAPI (https://newsapi.org, https://www.newsapi.org) — call via window.appFetch');
    expect(out).toContain('window.appFetch(url, init) instead of fetch(url, init)');
    expect(out.endsWith('show weather')).toBe(true);

    const providersIdx = out.indexOf('Available providers:');
    const userReqIdx = out.indexOf("The user's request:");
    expect(providersIdx).toBeGreaterThan(0);
    expect(userReqIdx).toBeGreaterThan(providersIdx);
  });

  it('buildChatPrompt includes chat history and current HTML', () => {
    const out = buildChatPrompt({
      messages: [
        { id: '1', role: 'user', text: 'make a clock', created_at: 't1' },
        { id: '2', role: 'status', text: 'Updated', created_at: 't2', status: 'updated' },
        { id: '3', role: 'user', text: 'make it blue', created_at: 't3' }
      ],
      currentHtml: '<html><body>clock</body></html>'
    });

    expect(out).toContain(CODEX_SYSTEM_PROMPT);
    expect(out).toContain('any tile width or height');
    expect(out).toContain('ResizeObserver');
    expect(out).toContain('Conversation history:');
    expect(out).toContain('1. make a clock');
    expect(out).toContain('2. make it blue');
    expect(out).toContain('Current widget index.html:');
    expect(out).toContain('<html><body>clock</body></html>');
    expect(out).toMatch(/user's latest request:\s*make it blue/i);
  });

  it('buildChatPrompt includes provider block', () => {
    const out = buildChatPrompt({
      messages: [{ id: '1', role: 'user', text: 'show weather', created_at: 't1' }],
      providers: [{ name: 'OpenWeather', hostnames: ['api.openweathermap.org'] }]
    });

    expect(out).toContain('Available providers:');
    expect(out).toContain('OpenWeather');
    expect(out).toContain('window.appFetch');
  });
});
