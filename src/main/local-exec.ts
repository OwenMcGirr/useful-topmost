import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface LocalExecRequest {
  command: string;
  args?: string[];
}

export type LocalExecResult =
  | {
      ok: true;
      stdout: string;
      exitCode: number;
      truncated: boolean;
    }
  | {
      ok: false;
      stdout: string;
      exitCode: number | null;
      truncated: boolean;
      error: string;
    };

export interface LocalExecOptions {
  cwd: string;
  timeoutMs?: number;
  maxStdoutBytes?: number;
  env?: NodeJS.ProcessEnv;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_STDOUT_BYTES = 256 * 1024;

function invalidRequest(error: string): LocalExecResult {
  return { ok: false, stdout: '', exitCode: null, truncated: false, error };
}

function appendStdout(
  chunks: Buffer[],
  chunk: Buffer,
  capturedBytes: number,
  maxBytes: number
): { capturedBytes: number; truncated: boolean } {
  const remaining = maxBytes - capturedBytes;
  if (remaining <= 0) return { capturedBytes, truncated: true };
  if (chunk.byteLength <= remaining) {
    chunks.push(chunk);
    return { capturedBytes: capturedBytes + chunk.byteLength, truncated: false };
  }
  chunks.push(chunk.subarray(0, remaining));
  return { capturedBytes: maxBytes, truncated: true };
}

export function widgetCwdFromSenderUrl(senderUrl: string, widgetsRoot: string): string | null {
  let senderPath: string;
  try {
    const url = new URL(senderUrl);
    if (url.protocol !== 'file:') return null;
    senderPath = fileURLToPath(url);
  } catch {
    return null;
  }

  const normalizedRoot = path.resolve(widgetsRoot);
  const htmlPath = path.resolve(senderPath);
  if (path.basename(htmlPath).toLowerCase() !== 'index.html') return null;

  const cwd = path.dirname(htmlPath);
  if (path.dirname(cwd) !== normalizedRoot) return null;

  const relative = path.relative(normalizedRoot, cwd);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;

  return cwd;
}

export function runLocalExec(
  request: LocalExecRequest,
  options: LocalExecOptions
): Promise<LocalExecResult> {
  if (!request || typeof request.command !== 'string' || request.command.trim() === '') {
    return Promise.resolve(invalidRequest('command must be a non-empty string'));
  }

  const args = request.args ?? [];
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === 'string')) {
    return Promise.resolve(invalidRequest('args must be an array of strings'));
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxStdoutBytes = options.maxStdoutBytes ?? DEFAULT_MAX_STDOUT_BYTES;
  const stdoutChunks: Buffer[] = [];
  let capturedBytes = 0;
  let truncated = false;
  let settled = false;
  let timedOut = false;

  return new Promise((resolve) => {
    const child = spawn(request.command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore']
    });

    const finish = (result: LocalExecResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout?.on('data', (data: Buffer) => {
      const next = appendStdout(stdoutChunks, data, capturedBytes, maxStdoutBytes);
      capturedBytes = next.capturedBytes;
      truncated = truncated || next.truncated;
    });

    child.on('error', (error) => {
      finish({
        ok: false,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        exitCode: null,
        truncated,
        error: error.message
      });
    });

    child.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      if (timedOut) {
        finish({ ok: false, stdout, exitCode: null, truncated, error: 'command timed out' });
        return;
      }
      if (code === 0) {
        finish({ ok: true, stdout, exitCode: 0, truncated });
        return;
      }
      finish({
        ok: false,
        stdout,
        exitCode: code,
        truncated,
        error: 'command failed'
      });
    });
  });
}
