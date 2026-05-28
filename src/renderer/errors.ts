export interface FriendlyError {
  title: string;
  advice?: string;
}

// Pattern match in priority order. The categorizer is intentionally string-based
// against the raw error so it works for both renderer-side display surfaces
// (tile error state and chat-panel failed messages) without any IPC shape change.
const RULES: Array<{ match: RegExp; title: string; advice?: string }> = [
  {
    match: /^(?:Failed:\s*)?canceled\b/i,
    title: 'Canceled',
    advice: 'You canceled the build.'
  },
  {
    match: /\btimeout\b|timed out/i,
    title: 'Codex took too long',
    advice: 'The run hit the timeout. Try Retry or simplify your prompt.'
  },
  {
    match: /no\s+index\.html\s+produced/i,
    title: "Codex finished but didn't write a widget",
    advice: 'It ran without errors but emitted no index.html. Try Retry or sharpen your prompt.'
  },
  {
    match: /not\s+authenticated|not\s+logged\s+in|please\s+run.*codex\s+login|\b401\b/i,
    title: "Codex isn't signed in",
    advice: 'Run `codex login` in your terminal and Retry.'
  },
  {
    match: /rate\s*limit|\b429\b|too\s+many\s+requests/i,
    title: 'Codex is rate-limited',
    advice: 'Wait a minute or two and Retry.'
  },
  {
    match: /ECONNREFUSED|ENOTFOUND|ENETUNREACH|fetch\s+failed|getaddrinfo/i,
    title: "Couldn't reach Codex",
    advice: 'Check your internet connection and Retry.'
  },
  {
    match: /model\s+not\s+found|unknown\s+model/i,
    title: 'Model unavailable',
    advice: "The configured model isn't available right now. Try Retry."
  },
  {
    match: /^(?:Failed:\s*)?codex\s+exited\s+with\s+code\s+\d+:\s*$/i,
    title: 'Codex exited without output',
    advice: 'No output to interpret. Try Retry; if it persists run `codex login status` in your terminal.'
  }
];

export function categorizeError(raw: string): FriendlyError {
  const normalized = (raw ?? '').trim();
  for (const rule of RULES) {
    if (rule.match.test(normalized)) {
      return { title: rule.title, advice: rule.advice };
    }
  }
  return { title: 'Widget generation failed' };
}

/** Strip the chat-panel `Failed: ` prefix that the main process prepends. */
export function stripFailedPrefix(text: string): string {
  return text.replace(/^Failed:\s*/i, '');
}
