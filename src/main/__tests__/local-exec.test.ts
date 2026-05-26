import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runLocalExec, widgetCwdFromSenderUrl } from '../local-exec';

async function tempDir(prefix = 'local-exec-') {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe('local exec', () => {
  it('executes a simple command and returns stdout', async () => {
    const cwd = await tempDir();

    const result = await runLocalExec({
      command: process.execPath,
      args: ['-e', 'process.stdout.write("ok")']
    }, { cwd });

    expect(result).toEqual({ ok: true, stdout: 'ok', exitCode: 0, truncated: false });
  });

  it('runs from the provided working directory', async () => {
    const cwd = await tempDir();

    const result = await runLocalExec({
      command: process.execPath,
      args: ['-e', 'process.stdout.write(process.cwd())']
    }, { cwd });

    expect(result.ok).toBe(true);
    expect(result.stdout).toBe(cwd);
  });

  it('passes argument arrays correctly', async () => {
    const cwd = await tempDir();

    const result = await runLocalExec({
      command: process.execPath,
      args: ['-e', 'process.stdout.write(process.argv[1])', 'hello world']
    }, { cwd });

    expect(result.ok).toBe(true);
    expect(result.stdout).toBe('hello world');
  });

  it('rejects invalid command input', async () => {
    const cwd = await tempDir();

    const result = await runLocalExec({ command: '   ' }, { cwd });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/command/i);
  });

  it('times out long-running commands', async () => {
    const cwd = await tempDir();

    const result = await runLocalExec({
      command: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 1000)']
    }, { cwd, timeoutMs: 50 });

    expect(result).toMatchObject({
      ok: false,
      exitCode: null,
      error: 'command timed out'
    });
  });

  it('truncates stdout at the configured cap', async () => {
    const cwd = await tempDir();

    const result = await runLocalExec({
      command: process.execPath,
      args: ['-e', 'process.stdout.write("x".repeat(2048))']
    }, { cwd, maxStdoutBytes: 1024 });

    expect(result.ok).toBe(true);
    expect(result.stdout).toHaveLength(1024);
    expect(result.truncated).toBe(true);
  });

  it('does not expose stderr', async () => {
    const cwd = await tempDir();

    const result = await runLocalExec({
      command: process.execPath,
      args: ['-e', 'process.stderr.write("secret"); process.stdout.write("public"); process.exit(1)']
    }, { cwd });

    expect(result.ok).toBe(false);
    expect(result.stdout).toBe('public');
    expect(result.stdout).not.toContain('secret');
    expect(result.error).toBe('command failed');
  });

  it('returns ok:false for non-zero exit codes', async () => {
    const cwd = await tempDir();

    const result = await runLocalExec({
      command: process.execPath,
      args: ['-e', 'process.stdout.write("nope"); process.exit(7)']
    }, { cwd });

    expect(result).toEqual({
      ok: false,
      stdout: 'nope',
      exitCode: 7,
      truncated: false,
      error: 'command failed'
    });
  });
});

describe('widgetCwdFromSenderUrl', () => {
  it('resolves a widget index.html sender to its widget directory', async () => {
    const root = await tempDir();
    const widgetsRoot = path.join(root, 'widgets');
    const widgetDir = path.join(widgetsRoot, 'abc');
    const htmlPath = path.join(widgetDir, 'index.html');

    expect(widgetCwdFromSenderUrl(pathToFileURL(htmlPath).toString(), widgetsRoot)).toBe(widgetDir);
  });

  it('rejects non-file URLs', async () => {
    const root = await tempDir();

    expect(widgetCwdFromSenderUrl('https://example.com/index.html', root)).toBeNull();
  });

  it('rejects paths outside the widget root', async () => {
    const root = await tempDir();
    const other = path.join(await tempDir('other-widget-'), 'index.html');

    expect(widgetCwdFromSenderUrl(pathToFileURL(other).toString(), path.join(root, 'widgets'))).toBeNull();
  });

  it('rejects malformed widget paths', async () => {
    const root = await tempDir();
    const widgetsRoot = path.join(root, 'widgets');
    const nestedHtml = path.join(widgetsRoot, 'abc', 'nested', 'index.html');

    expect(widgetCwdFromSenderUrl(pathToFileURL(nestedHtml).toString(), widgetsRoot)).toBeNull();
  });
});
