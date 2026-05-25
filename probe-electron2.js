// Try every place the API might live
console.log('process.versions.electron:', process.versions.electron);
console.log('process.type:', process.type);
console.log('process.electronBinding type:', typeof process.electronBinding);
console.log('process._linkedBinding type:', typeof process._linkedBinding);

try {
  const electron = require('electron');
  console.log('require(electron):', typeof electron, electron && electron.length < 200 ? electron : '(too big)');
} catch (e) { console.log('require electron threw:', e.message); }

try {
  const api = process._linkedBinding('electron_browser_app');
  console.log('linked browser_app:', Object.keys(api || {}));
} catch (e) { console.log('linked browser_app threw:', e.message); }

// Maybe v42 uses node:electron?
try {
  const x = require('node:electron');
  console.log('node:electron:', typeof x, Object.keys(x || {}));
} catch (e) { console.log('node:electron threw:', e.message); }

process.exit(0);
