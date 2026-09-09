import process from 'node:process';

process.on('SIGTERM', () => {});
setInterval(() => {}, 1_000);
