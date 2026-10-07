#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { cp, mkdir, rename, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const usage = `Install the KeyCard agent skill.

Usage: keycard-agent-skill [--project] [--force]

  --project  Install into .codex/skills in the current project.
  --force    Replace an existing keycard-agent installation.
  --help     Show this help.`;

const args = new Set(process.argv.slice(2));
if (args.has('--help')) {
  console.log(usage);
  process.exit(0);
}
const unknown = [...args].filter(arg => !['--project', '--force'].includes(arg));
if (unknown.length) throw Error(`Unknown option: ${unknown.join(', ')}\n\n${usage}`);

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skillsRoot = args.has('--project')
  ? resolve(process.cwd(), '.codex', 'skills')
  : resolve(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'skills');
const target = join(skillsRoot, 'keycard-agent');
if (dirname(target) !== skillsRoot || basename(target) !== 'keycard-agent') {
  throw Error('Refusing to install outside the selected skills directory.');
}

async function exists(path) {
  try { await stat(path); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

await mkdir(skillsRoot, { recursive: true });
const staging = join(skillsRoot, `.keycard-agent-${process.pid}-${randomBytes(6).toString('hex')}`);
try {
  await mkdir(staging);
  await cp(join(packageRoot, 'SKILL.md'), join(staging, 'SKILL.md'));
  await cp(join(packageRoot, 'agents'), join(staging, 'agents'), { recursive: true });
  await cp(join(packageRoot, 'scripts'), join(staging, 'scripts'), { recursive: true });

  if (await exists(target)) {
    if (!args.has('--force')) throw Error(`Skill already exists at ${target}. Re-run with --force to replace it.`);
    await rm(target, { recursive: true, force: true });
  }
  await rename(staging, target);
  console.log(`Installed keycard-agent to ${target}`);
} catch (error) {
  await rm(staging, { recursive: true, force: true });
  throw error;
}
