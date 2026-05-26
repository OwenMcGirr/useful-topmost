import { describe, it, expect } from 'vitest';
import { CODEX_SYSTEM_PROMPT, buildPrompt } from '../codex-prompt';

describe('codex-prompt', () => {
  it('exports a non-empty system prompt that mentions the output contract', () => {
    expect(CODEX_SYSTEM_PROMPT.length).toBeGreaterThan(200);
    expect(CODEX_SYSTEM_PROMPT).toContain('index.html');
    expect(CODEX_SYSTEM_PROMPT).toContain('400');
  });

  it('buildPrompt appends the user prompt after the system prompt', () => {
    const out = buildPrompt('show the weather');
    expect(out.startsWith(CODEX_SYSTEM_PROMPT)).toBe(true);
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
});
