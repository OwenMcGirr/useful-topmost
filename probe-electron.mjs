import * as electron from 'electron';
console.log('keys:', Object.keys(electron));
console.log('app:', electron.app && typeof electron.app);
console.log('default keys:', electron.default ? Object.keys(electron.default) : '(no default)');
process.exit(0);
