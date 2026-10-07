import 'dotenv/config';
import { spawn } from 'node:child_process';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required. Configure the Supabase Session pooler URL in .env.');
  process.exit(1);
}

const child = spawn(process.execPath, [
  '--import', 'tsx',
  '--test',
  '--test-concurrency=1',
  'src/paid-calls.test.js',
  'src/provider-listings.test.js',
  'src/provider-payments.test.js',
], {
  stdio: 'inherit',
  env: { ...process.env, KEYCARD_TEST_DATABASE_URL: process.env.DATABASE_URL },
  windowsHide: true,
});

child.on('error', error => {
  console.error(`Could not start payment tests: ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', code => {
  process.exitCode = code ?? 1;
});
