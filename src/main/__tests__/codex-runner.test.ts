import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_CODEX_TIMEOUT_MS, runCodex } from '../codex-runner';

function fakeChild() {
  const ee: any = new EventEmitter();
  ee.stderr = new EventEmitter();
  ee.stdout = new EventEmitter();
  ee.stdin = { end: vi.fn() };
  ee.kill = vi.fn();
  return ee;
}

async function tempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'codex-runner-'));
}

describe('runCodex', () => {
  it('uses a 10 minute default timeout', () => {
    expect(DEFAULT_CODEX_TIMEOUT_MS).toBe(600_000);
  });

  it('resolves ok when subprocess exits 0 and index.html exists', async () => {
    const cwd = await tempDir();
    const child = fakeChild();
    const spawnFn = vi.fn(() => {
      queueMicrotask(async () => {
        await fs.writeFile(path.join(cwd, 'index.html'), '<html></html>');
        child.emit('exit', 0);
      });
      return child;
    });

    const result = await runCodex({ prompt: 'p', cwd, spawnFn: spawnFn as any, timeoutMs: 1000 });

    expect(result.ok).toBe(true);
    expect(result.path).toBe(path.join(cwd, 'index.html'));
    expect(spawnFn).toHaveBeenCalledOnce();
  });

  it('resolves not-ok when subprocess exits non-zero', async () => {
    const cwd = await tempDir();
    const child = fakeChild();
    const spawnFn = vi.fn(() => {
      queueMicrotask(() => {
        child.stderr.emit('data', Buffer.from('boom'));
        child.emit('exit', 1);
      });
      return child;
    });

    const result = await runCodex({ prompt: 'p', cwd, spawnFn: spawnFn as any, timeoutMs: 1000 });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('1');
    expect(result.error).toContain('boom');
  });

  it('resolves not-ok with "no output" when exit 0 but file missing', async () => {
    const cwd = await tempDir();
    const child = fakeChild();
    const spawnFn = vi.fn(() => {
      queueMicrotask(() => child.emit('exit', 0));
      return child;
    });

    const result = await runCodex({ prompt: 'p', cwd, spawnFn: spawnFn as any, timeoutMs: 1000 });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no .*output|index\.html/i);
  });

  it('resolves not-ok with "timeout" when subprocess never exits', async () => {
    const cwd = await tempDir();
    const child = fakeChild();
    const spawnFn = vi.fn(() => child);

    const result = await runCodex({ prompt: 'p', cwd, spawnFn: spawnFn as any, timeoutMs: 30 });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('timeout');
    expect(child.kill).toHaveBeenCalled();
  });

  it('writes stderr to logPath when provided', async () => {
    const cwd = await tempDir();
    const logPath = path.join(cwd, 'codex.log');
    const child = fakeChild();
    const spawnFn = vi.fn(() => {
      queueMicrotask(() => {
        child.stderr.emit('data', Buffer.from('hello log'));
        child.emit('exit', 1);
      });
      return child;
    });

    await runCodex({ prompt: 'p', cwd, spawnFn: spawnFn as any, timeoutMs: 1000, logPath });

    const log = await fs.readFile(logPath, 'utf8');
    expect(log).toContain('hello log');
  });

  it('captureLastMessage adds --output-last-message <path> to the codex args', async () => {
    const cwd = await tempDir();
    const child = fakeChild();
    const spawnFn = vi.fn(() => {
      queueMicrotask(async () => {
        await fs.writeFile(path.join(cwd, 'provider.json'), '{"ok":true}');
        child.emit('exit', 0);
      });
      return child;
    });

    const result = await runCodex({
      prompt: 'p', cwd,
      outputFile: 'provider.json',
      captureLastMessage: true,
      spawnFn: spawnFn as any,
      timeoutMs: 1000
    });

    expect(result.ok).toBe(true);
    const [, args] = spawnFn.mock.calls[0] as unknown as [string, string[]];
    expect(args).toContain('--output-last-message');
    expect(args).toContain(path.join(cwd, 'provider.json'));
  });

  it('writes the prompt to stdin (not argv) so cmd.exe never sees user text', async () => {
    const cwd = await tempDir();
    const child = fakeChild();
    const spawnFn = vi.fn(() => {
      queueMicrotask(async () => {
        await fs.writeFile(path.join(cwd, 'index.html'), '<html></html>');
        child.emit('exit', 0);
      });
      return child;
    });

    await runCodex({ prompt: 'PROMPT_TEXT', cwd, spawnFn: spawnFn as any, timeoutMs: 1000 });

    expect(child.stdin.end).toHaveBeenCalledWith('PROMPT_TEXT');
    const [, args] = spawnFn.mock.calls[0] as unknown as [string, string[]];
    expect(args).not.toContain('PROMPT_TEXT');
    expect(args).toContain('-');
  });
});
