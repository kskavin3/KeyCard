import 'dotenv/config';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

// Spawning npm.cmd directly is rejected with EINVAL by newer Node releases on
// Windows. npm exposes the JavaScript CLI used for the parent `npm run dev`
// invocation, so execute that CLI with the current Node binary instead.
const npmCli = process.env.npm_execpath;
if (!npmCli || !existsSync(npmCli)) {
  throw new Error('npm_execpath is unavailable. Start the development stack with `npm run dev`.');
}

const requiredEnvironment = [
  'DATABASE_URL',
  'KEYCARD_DASHBOARD_PASSWORD',
  'KEYCARD_SESSION_SECRET',
  'KEYCARD_ENCRYPTION_KEY',
];
const missing = requiredEnvironment.filter(name => !process.env[name]);
if (missing.length) {
  console.error(`KeyCard development configuration is incomplete. Missing: ${missing.join(', ')}`);
  console.error('Copy .env.example to .env, add your Supabase Session pooler URL, and replace the placeholder secrets before running `npm run dev`.');
  process.exit(1);
}

const children = ['dev:client', 'dev:api'].map(script => spawn(process.execPath, [npmCli, 'run', script], {
  stdio: 'inherit',
  env: process.env,
  windowsHide: true,
}));

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  process.exitCode = code;
}

for (const child of children) {
  child.on('error', error => {
    console.error(`Could not start a KeyCard development process: ${error.message}`);
    shutdown(1);
  });
  child.on('exit', code => shutdown(code ?? 1));
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
