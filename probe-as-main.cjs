const electron = require('electron');
const fs = require('fs');
const out = {
  type_of_electron: typeof electron,
  process_type: process.type,
  process_electron_ver: process.versions.electron,
  keys: typeof electron === 'object' ? Object.keys(electron) : '(not object)',
  has_app: !!(electron && electron.app),
  has_BrowserWindow: !!(electron && electron.BrowserWindow),
};
fs.writeFileSync('probe-result.json', JSON.stringify(out, null, 2));
process.exit(0);
