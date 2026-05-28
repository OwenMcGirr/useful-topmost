import { describe, it, expect } from 'vitest';
import { isExternalHttpUrl } from '../external-links';

describe('isExternalHttpUrl', () => {
  it('returns true for http and https URLs', () => {
    expect(isExternalHttpUrl('http://example.com/')).toBe(true);
    expect(isExternalHttpUrl('https://example.com/path?q=1')).toBe(true);
  });

  it('returns false for non-external protocols the app uses internally', () => {
    expect(isExternalHttpUrl('file:///C:/tmp/index.html')).toBe(false);
    expect(isExternalHttpUrl('devtools://devtools/bundled/inspector.html')).toBe(false);
    expect(isExternalHttpUrl('blob:https://example.com/abc')).toBe(false);
    expect(isExternalHttpUrl('about:blank')).toBe(false);
  });

  it('returns false for unsafe / scheme-less inputs', () => {
    expect(isExternalHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isExternalHttpUrl('mailto:a@b.com')).toBe(false);
    expect(isExternalHttpUrl('not a url')).toBe(false);
    expect(isExternalHttpUrl('')).toBe(false);
    expect(isExternalHttpUrl(undefined)).toBe(false);
    expect(isExternalHttpUrl(null)).toBe(false);
  });
});
