import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = ['dev:client', 'dev:api'].map(script => spawn(npm, ['run', script], {
  stdio: 'inherit',
  env: process.env,
}));

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  process.exitCode = code;
}

for (const child of children) {
  child.on('error', () => shutdown(1));
  child.on('exit', code => shutdown(code ?? 1));
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
