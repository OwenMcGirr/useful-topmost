#!/usr/bin/env node
// Regenerate resources/icon.ico from resources/icon.png with the multi-resolution
// frames (16/24/32/48/64/128/256) Windows installer + shortcut icons expect.
//
// Requires ffmpeg on PATH (winget install Gyan.FFmpeg on Windows).
//
// Run:  node scripts/build-icon.js
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const pngToIco = require('png-to-ico').default;

const root = path.join(__dirname, '..');
const pngPath = path.join(root, 'resources', 'icon.png');
const icoPath = path.join(root, 'resources', 'icon.ico');

// Sizes Windows uses across system contexts (system tray 16, shortcut/alt-tab
// 32-48, file explorer thumbnails up to 256). All sizes must be <= the source.
const SIZES = [16, 24, 32, 48, 64, 128, 256];

function findFfmpeg() {
  // Try PATH first.
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['ffmpeg']);
  if (probe.status === 0) {
    const found = String(probe.stdout).split(/\r?\n/).find(Boolean);
    if (found) return found.trim();
  }
  // Common winget install path on Windows (PATH refresh requires a new shell;
  // node spawnSync can hit this gap when run right after `winget install`).
  if (process.platform === 'win32') {
    const wingetGlob = path.join(
      process.env.LOCALAPPDATA || '',
      'Microsoft', 'WinGet', 'Packages'
    );
    if (fs.existsSync(wingetGlob)) {
      for (const pkg of fs.readdirSync(wingetGlob)) {
        if (!pkg.startsWith('Gyan.FFmpeg')) continue;
        const pkgDir = path.join(wingetGlob, pkg);
        for (const sub of fs.readdirSync(pkgDir)) {
          const candidate = path.join(pkgDir, sub, 'bin', 'ffmpeg.exe');
          if (fs.existsSync(candidate)) return candidate;
        }
      }
    }
  }
  throw new Error('ffmpeg not found on PATH. Install it (e.g. winget install Gyan.FFmpeg) and retry.');
}

const ffmpeg = findFfmpeg();

function resizePng(srcPng, size, dstPng) {
  // Lanczos for sharp downscaling. -y to overwrite without prompt.
  const result = spawnSync(ffmpeg, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', srcPng,
    '-vf', `scale=${size}:${size}:flags=lanczos`,
    '-map_metadata', '-1',
    '-compression_level', '100',
    dstPng
  ], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`ffmpeg failed for size ${size}`);
}

(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'icon-build-'));
  try {
    const scaled = SIZES.map((size) => {
      const out = path.join(tmpDir, `icon-${size}.png`);
      resizePng(pngPath, size, out);
      return out;
    });
    const ico = await pngToIco(scaled);
    fs.writeFileSync(icoPath, ico);
    console.log(`wrote ${icoPath} (${ico.length} bytes, ${SIZES.length} frames)`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
})();
