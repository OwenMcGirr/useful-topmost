import { describe, it, expect } from 'vitest';
import { CODEX_SYSTEM_PROMPT, buildChatPrompt, buildPrompt } from '../codex-prompt';

describe('codex-prompt', () => {
  it('exports a non-empty system prompt that mentions the output contract', () => {
    expect(CODEX_SYSTEM_PROMPT.length).toBeGreaterThan(200);
    expect(CODEX_SYSTEM_PROMPT).toContain('index.html');
    expect(CODEX_SYSTEM_PROMPT).toContain('400');
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

  it('instructs Codex to write a summary.json sources sidecar', () => {
    expect(CODEX_SYSTEM_PROMPT).toContain('Sources record:');
    expect(CODEX_SYSTEM_PROMPT).toContain('summary.json');
    expect(CODEX_SYSTEM_PROMPT).toContain('"sources"');
    expect(CODEX_SYSTEM_PROMPT).toContain('Do NOT put URLs in sources');
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
