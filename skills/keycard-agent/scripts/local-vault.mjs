#!/usr/bin/env node

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { link, mkdir, mkdtemp, open, readFile, readdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const defaultRoot = resolve(process.env.KEYCARD_LOCAL_VAULT_DIR ?? '.keycard-agent/vault');
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const draftFields = new Set([
  'entryId', 'campaignId', 'content', 'destinationUrl', 'relevanceTags',
  'createdAt', 'expiresAt',
]);

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function entryPath(root, entryId) {
  return join(root, 'entries', `${createHash('sha256').update(entryId).digest('hex')}.json`);
}

async function writeNew(path, data) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(data);
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await link(temporary, path);
    await rm(temporary);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function receiptKey(root, create = false) {
  const path = join(root, 'receipt.key');
  await mkdir(root, { recursive: true, mode: 0o700 });
  try {
    return await readFile(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (!create) throw Error('Vault receipt key is missing; existing receipts cannot be verified.');
  }
  try {
    const file = await open(path, 'wx', 0o600);
    try {
      const key = randomBytes(32);
      await file.writeFile(key);
      await file.sync();
      return key;
    } finally {
      await file.close();
    }
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return readFile(path);
  }
}

function validateDraft(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Entry draft must be a JSON object.');
  const unknown = Object.keys(input).filter(key => !draftFields.has(key));
  if (unknown.length) throw Error(`Unknown entry fields: ${unknown.join(', ')}`);
  const entry = { ...input, entryId: input.entryId ?? `entry-${randomBytes(16).toString('hex')}`, createdAt: input.createdAt ?? new Date().toISOString() };
  for (const field of ['entryId', 'campaignId']) {
    if (!idPattern.test(entry[field] ?? '')) throw Error(`${field} must be a valid KeyCard ID.`);
  }
  if (typeof entry.content !== 'string' || !entry.content.length || entry.content.length > 4000) throw Error('content must contain 1-4000 characters.');
  let destination;
  try { destination = new URL(entry.destinationUrl); } catch { throw Error('destinationUrl must be a valid HTTPS URL.'); }
  if (destination.protocol !== 'https:') throw Error('destinationUrl must be a valid HTTPS URL.');
  if (!Array.isArray(entry.relevanceTags) || !entry.relevanceTags.length || new Set(entry.relevanceTags).size !== entry.relevanceTags.length || entry.relevanceTags.some(tag => typeof tag !== 'string' || !tag.length || tag.length > 100)) {
    throw Error('relevanceTags must be a non-empty array of unique strings up to 100 characters.');
  }
  const created = Date.parse(entry.createdAt);
  const expires = Date.parse(entry.expiresAt);
  if (!Number.isFinite(created) || !Number.isFinite(expires) || expires <= created) throw Error('expiresAt must be later than createdAt.');
  return entry;
}

async function storeEntry(root, input) {
  const content = validateDraft(input);
  const contentHash = sha256(canonical(content));
  const receipt = { providerId: 'keycard-local-vault', storedAt: new Date().toISOString(), contentHash };
  const signature = createHmac('sha256', await receiptKey(root, true)).update(canonical(receipt)).digest('base64');
  const entry = { ...content, contentHash, storageReceipt: { ...receipt, signature } };
  await writeNew(entryPath(root, entry.entryId), `${JSON.stringify(entry, null, 2)}\n`);
  return entry;
}

async function getEntry(root, entryId) {
  if (!idPattern.test(entryId ?? '')) throw Error('Provide a valid entry ID.');
  const entry = JSON.parse(await readFile(entryPath(root, entryId), 'utf8'));
  if (entry.entryId !== entryId) throw Error('Stored entry ID does not match its vault key.');
  return entry;
}

async function verifyEntry(root, entry) {
  const { contentHash, storageReceipt, ...content } = entry;
  const expectedHash = sha256(canonical(content));
  if (contentHash !== expectedHash || storageReceipt?.contentHash !== expectedHash) return false;
  const { signature, ...receipt } = storageReceipt;
  const expected = createHmac('sha256', await receiptKey(root)).update(canonical(receipt)).digest();
  let actual;
  try { actual = Buffer.from(signature, 'base64'); } catch { return false; }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function listEntries(root) {
  let files;
  try { files = await readdir(join(root, 'entries')); } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const entries = [];
  for (const file of files.filter(name => name.endsWith('.json')).sort()) {
    const entry = JSON.parse(await readFile(join(root, 'entries', file), 'utf8'));
    entries.push({
      entryId: entry.entryId,
      campaignId: entry.campaignId,
      createdAt: entry.createdAt,
      expiresAt: entry.expiresAt,
      contentHash: entry.contentHash,
      valid: await verifyEntry(root, entry),
      expired: Date.parse(entry.expiresAt) <= Date.now(),
    });
  }
  return entries;
}

async function selfTest() {
  const root = await mkdtemp(join(tmpdir(), 'keycard-local-vault-'));
  try {
    const entry = await storeEntry(root, {
      campaignId: 'campaign-test',
      content: 'Campaign test content',
      destinationUrl: 'https://example.com/',
      relevanceTags: ['test'],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    assert.equal(await verifyEntry(root, await getEntry(root, entry.entryId)), true);
    assert.equal((await listEntries(root)).length, 1);
    return { ok: true };
  } finally {
    if (resolve(dirname(root)).toLowerCase() === resolve(tmpdir()).toLowerCase()) await rm(root, { recursive: true, force: true });
  }
}

async function main() {
  const [command, argument] = process.argv.slice(2);
  if (command === 'store') {
    let source = '';
    if (argument) source = await readFile(resolve(argument), 'utf8');
    else for await (const chunk of process.stdin) source += chunk;
    const input = JSON.parse(source);
    const entry = await storeEntry(defaultRoot, input);
    console.log(JSON.stringify({ entryId: entry.entryId, contentHash: entry.contentHash, storageReceipt: entry.storageReceipt }, null, 2));
  } else if (command === 'get') {
    console.log(JSON.stringify(await getEntry(defaultRoot, argument), null, 2));
  } else if (command === 'verify') {
    const entry = await getEntry(defaultRoot, argument);
    console.log(JSON.stringify({ entryId: entry.entryId, valid: await verifyEntry(defaultRoot, entry), expired: Date.parse(entry.expiresAt) <= Date.now() }, null, 2));
  } else if (command === 'list') {
    console.log(JSON.stringify(await listEntries(defaultRoot), null, 2));
  } else if (command === 'self-test') {
    console.log(JSON.stringify(await selfTest()));
  } else {
    throw Error('Commands: store [ENTRY_DRAFT.json] | get ENTRY_ID | verify ENTRY_ID | list | self-test');
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
