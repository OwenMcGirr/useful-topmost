const electron = require('electron');
console.log('typeof electron:', typeof electron);
console.log('electron keys:', electron && typeof electron === 'object' ? Object.keys(electron) : '(not an object)');
console.log('electron.app:', electron && electron.app);
console.log('electron.default:', electron && electron.default && typeof electron.default);
console.log('process.versions.electron:', process.versions.electron);
process.exit(0);
