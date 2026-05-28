// Decide whether a URL should be opened in the system's default browser rather
// than navigated to inside the app. We hand off http(s) URLs to the OS; anything
// else (file://, devtools://, blob:, the renderer's dev-server URL) stays put.

export function isExternalHttpUrl(value: string | undefined | null): boolean {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
