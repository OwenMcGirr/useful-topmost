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

const DEFAULT_TIMEOUT_MS = 90_000;

export async function runCodex(opts: CodexRunOptions): Promise<CodexRunResult> {
  const { prompt, cwd, timeoutMs = DEFAULT_TIMEOUT_MS, logPath, spawnFn = nodeSpawn } = opts;
  const outputPath = path.join(cwd, 'index.html');

  return new Promise<CodexRunResult>((resolve) => {
    const args = ['exec', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '-C', cwd, prompt];
    const child: ChildProcess = spawnFn('codex', args, { cwd });
    let stderrBuf = '';
    let settled = false;

    const finish = async (result: CodexRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (logPath) {
        try { await fs.writeFile(logPath, stderrBuf); } catch { /* swallow */ }
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* swallow */ }
      finish({ ok: false, error: 'timeout' });
    }, timeoutMs);

    child.stderr?.on('data', (chunk: Buffer) => { stderrBuf += chunk.toString(); });
    // Drain stdout: if we leave it unread the pipe (~64KB on Windows) fills up
    // and Codex blocks on write, which manifests as a spurious timeout.
    child.stdout?.on('data', () => {});
    child.on('error', (err: Error) => { finish({ ok: false, error: err.message }); });

    child.on('exit', async (code) => {
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
