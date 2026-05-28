import { describe, it, expect } from 'vitest';
import { categorizeError, stripFailedPrefix } from '../errors';

describe('categorizeError', () => {
  it('canceled', () => {
    expect(categorizeError('canceled')).toEqual({
      title: 'Canceled',
      advice: 'You canceled the build.'
    });
    expect(categorizeError('Failed: canceled')).toMatchObject({ title: 'Canceled' });
  });

  it('timeout', () => {
    expect(categorizeError('timeout').title).toBe('Codex took too long');
    expect(categorizeError('codex exited with code 1: request timed out').title).toBe('Codex took too long');
  });

  it('no index.html produced', () => {
    expect(categorizeError('no index.html produced').title).toBe("Codex finished but didn't write a widget");
  });

  it('not signed in (multiple phrasings)', () => {
    expect(categorizeError('not authenticated').title).toBe("Codex isn't signed in");
    expect(categorizeError('User is not logged in').title).toBe("Codex isn't signed in");
    expect(categorizeError('please run `codex login` first').title).toBe("Codex isn't signed in");
    expect(categorizeError('codex exited with code 1: HTTP 401 Unauthorized').title).toBe("Codex isn't signed in");
  });

  it('rate limit', () => {
    expect(categorizeError('rate limit exceeded').title).toBe('Codex is rate-limited');
    expect(categorizeError('HTTP 429 Too Many Requests').title).toBe('Codex is rate-limited');
  });

  it('network', () => {
    expect(categorizeError('Error: connect ECONNREFUSED 127.0.0.1:80').title).toBe("Couldn't reach Codex");
    expect(categorizeError('getaddrinfo ENOTFOUND api.openai.com').title).toBe("Couldn't reach Codex");
    expect(categorizeError('fetch failed').title).toBe("Couldn't reach Codex");
  });

  it('model unavailable', () => {
    expect(categorizeError('model not found: gpt-5.5').title).toBe('Model unavailable');
    expect(categorizeError('unknown model').title).toBe('Model unavailable');
  });

  it('codex exited without output', () => {
    expect(categorizeError('codex exited with code 1: ').title).toBe('Codex exited without output');
    expect(categorizeError('Failed: codex exited with code 137:   ').title).toBe('Codex exited without output');
  });

  it('default fallback', () => {
    const result = categorizeError('something we have not seen before');
    expect(result.title).toBe('Widget generation failed');
    expect(result.advice).toBeUndefined();
  });

  it('empty string falls back', () => {
    expect(categorizeError('').title).toBe('Widget generation failed');
  });
});

describe('stripFailedPrefix', () => {
  it('removes a leading "Failed: " prefix', () => {
    expect(stripFailedPrefix('Failed: codex exited')).toBe('codex exited');
    expect(stripFailedPrefix('Failed:codex exited')).toBe('codex exited');
  });

  it('leaves text without the prefix untouched', () => {
    expect(stripFailedPrefix('codex exited')).toBe('codex exited');
    expect(stripFailedPrefix('Did fail something')).toBe('Did fail something');
  });
});
