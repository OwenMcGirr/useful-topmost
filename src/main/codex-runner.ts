import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface CodexRunResult {
  ok: boolean;
  path?: string;
  error?: string;
}

export interface CodexRunOptions {
  prompt: string;
  cwd: string;
  timeoutMs?: number;
  logPath?: string;
  /** Injected for testing */
  spawnFn?: typeof nodeSpawn;
}

const DEFAULT_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 500;

export async function runCodex(opts: CodexRunOptions): Promise<CodexRunResult> {
  const { prompt, cwd, timeoutMs = DEFAULT_TIMEOUT_MS, logPath, spawnFn = nodeSpawn } = opts;
  const outputPath = path.join(cwd, 'index.html');

  return new Promise<CodexRunResult>((resolve) => {
    // Read prompt from stdin (the trailing '-') so user-supplied text never
    // touches cmd.exe metacharacter expansion when shell: true is on.
    // browser_use + shell_tool are stable+default-on in Codex, but pass them
    // explicitly so a config change can't silently disable them.
    const args = [
      'exec',
      '--skip-git-repo-check',
      '--dangerously-bypass-approvals-and-sandbox',
      '--enable', 'browser_use',
      '--enable', 'shell_tool',
      '-'
    ];
    // shell: true lets Windows find codex.cmd (npm-global shims aren't .exe).
    // It's a no-op on POSIX beyond going through /bin/sh.
    const child: ChildProcess = spawnFn('codex', args, { cwd, shell: true });
    child.stdin?.end(prompt);
    let stderrBuf = '';
    let settled = false;

    const finish = async (result: CodexRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poller);
      if (logPath) {
        try { await fs.writeFile(logPath, stderrBuf); } catch { /* swallow */ }
      }
      // If we succeeded by file-watch before Codex exited, kill the lingering
      // process so post-write transcript work doesn't keep it alive.
      if (result.ok) {
        try { child.kill(); } catch { /* swallow */ }
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* swallow */ }
      finish({ ok: false, error: 'timeout' });
    }, timeoutMs);

    // Poll for index.html — Codex often keeps doing post-write transcript
    // work for a minute or two after the file lands, so don't wait for exit.
    const poller = setInterval(async () => {
      try {
        await fs.access(outputPath);
        finish({ ok: true, path: outputPath });
      } catch { /* not yet */ }
    }, POLL_INTERVAL_MS);

    child.stderr?.on('data', (chunk: Buffer) => { stderrBuf += chunk.toString(); });
    // Drain stdout: if we leave it unread the pipe (~64KB on Windows) fills up
    // and Codex blocks on write, which manifests as a spurious timeout.
    child.stdout?.on('data', () => {});
    child.on('error', (err: Error) => { finish({ ok: false, error: err.message }); });

    child.on('exit', async (code) => {
      // If the poller already saw the file we'd be settled — short-circuit.
      if (settled) return;
      if (code !== 0) {
        finish({ ok: false, error: `codex exited with code ${code}: ${stderrBuf.slice(-500)}` });
        return;
      }
      try {
        await fs.access(outputPath);
        finish({ ok: true, path: outputPath });
      } catch {
        finish({ ok: false, error: 'no index.html produced' });
      }
    });
  });
}
