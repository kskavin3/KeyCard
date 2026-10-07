import { adaToLovelace, formatAda } from './money.js';
import { cloneProviderTemplate } from './provider-templates.js';

/**
 * KeyCard Provider Onboarding Wizard
 * Handles: OpenAPI spec parsing, operations pricing table,
 *          Cardano wallet generation/import/CIP-30, and listing publish.
 */

// ─── UTILITIES ────────────────────────────────────────────────
const toast = document.querySelector('#toast');
let toastTimer;
function announce(message, isError = false) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = isError ? 'error' : '';
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 5000);
}

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
    credentials: 'same-origin',
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || `Request failed (${res.status}).`);
    error.status = res.status;
    throw error;
  }
  return data;
}

// ─── WIZARD STATE ─────────────────────────────────────────────
const state = {
  currentStep: 1,
  parsedSpec: null,       // raw parsed OpenAPI object
  operations: [],         // [{id, method, path, name, description, inputSchema, outputSchema, priceAda, markupBasisPoints, enabled}]
  selectedTemplate: null,
  payoutAddress: null,
  mnemonic: null,
};

// ─── STEP NAVIGATION ──────────────────────────────────────────
function showStep(n) {
  document.querySelectorAll('.wizard-step').forEach(el => el.classList.add('hidden'));
  const target = document.querySelector(`#step-${n}`);
  if (target) { target.classList.remove('hidden'); target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  // Update progress nav
  document.querySelectorAll('.step[data-step]').forEach(btn => {
    const s = Number(btn.dataset.step);
    btn.classList.remove('active', 'done');
    if (s === n) btn.classList.add('active');
    else if (s < n) btn.classList.add('done');
  });
  state.currentStep = n;
}

document.querySelectorAll('.step[data-step]').forEach(btn => {
  btn.addEventListener('click', () => {
    const s = Number(btn.dataset.step);
    if (s < state.currentStep) showStep(state.selectedTemplate && s === 2 ? 1 : s);
  });
});

// ─── STEP 1: OPENAPI UPLOAD ────────────────────────────────────

// Minimal YAML→JSON converter (handles simple flat and nested objects/lists)
function parseYaml(text) {
  // For most OpenAPI specs a full YAML parser is ideal.
  // We support JSON natively; for YAML we use a lightweight recursive parser.
  // Try JSON first, then fall back to a simple YAML parser.
  try { return JSON.parse(text); } catch {}
  return parseSimpleYaml(text);
}

function parseSimpleYaml(text) {
  // Very lightweight subset parser — handles key:value, lists, and nesting via indentation.
  // Supports enough of OpenAPI 3 for path/method/schema extraction.
  const lines = text.split('\n');
  function parseLines(lines, baseIndent) {
    const result = {};
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trimStart();
      if (!trimmed || trimmed.startsWith('#')) { i++; continue; }
      const indent = line.length - trimmed.length;
      if (indent < baseIndent) break;
      if (indent > baseIndent) { i++; continue; } // already consumed

      // List item
      if (trimmed.startsWith('- ')) {
        // collect siblings
        return parseList(lines, baseIndent);
      }

      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) { i++; continue; }

      const key = trimmed.slice(0, colonIdx).trim();
      const rest = trimmed.slice(colonIdx + 1).trim();

      if (rest) {
        // inline value
        result[key] = parseScalar(rest);
        i++;
      } else {
        // look ahead for children
        const childLines = [];
        i++;
        while (i < lines.length) {
          const child = lines[i];
          const childTrimmed = child.trimStart();
          if (!childTrimmed || childTrimmed.startsWith('#')) { i++; continue; }
          const childIndent = child.length - childTrimmed.length;
          if (childIndent <= indent) break;
          childLines.push(child.slice(indent + 2 > childIndent ? childIndent : indent + 2));
          i++;
        }
        if (childLines.length) {
          if (childLines[0].trimStart().startsWith('- ')) {
            result[key] = parseList(childLines.map(l => l), 0);
          } else {
            result[key] = parseLines(childLines, 0);
          }
        } else {
          result[key] = null;
        }
      }
    }
    return result;
  }

  function parseList(lines, baseIndent) {
    const items = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trimStart();
      if (!trimmed || trimmed.startsWith('#')) { i++; continue; }
      const indent = line.length - trimmed.length;
      if (indent < baseIndent) break;
      if (trimmed.startsWith('- ')) {
        const rest = trimmed.slice(2).trim();
        if (rest) {
          items.push(parseScalar(rest));
        } else {
          // nested object
          const childLines = [];
          i++;
          while (i < lines.length) {
            const child = lines[i];
            const childTrimmed = child.trimStart();
            if (!childTrimmed) { i++; continue; }
            const childIndent = child.length - childTrimmed.length;
            if (childIndent <= indent) break;
            childLines.push(child.slice(indent + 2 > childIndent ? childIndent : indent + 2));
            i++;
          }
          items.push(parseLines(childLines, 0));
          continue;
        }
      }
      i++;
    }
    return items;
  }

  function parseScalar(s) {
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s === 'null' || s === '~') return null;
    const n = Number(s);
    if (!isNaN(n) && s !== '') return n;
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      return s.slice(1, -1);
    }
    return s;
  }

  return parseLines(lines, 0);
}

// ─── OpenAPI extraction ─────────────────────────────────────
function extractFromOpenAPI(spec) {
  const isV3 = !!spec.openapi;
  const isV2 = !!spec.swagger;

  const title = spec.info?.title ?? 'Untitled API';
  const version = spec.info?.version ?? '';
  const description = spec.info?.description ?? '';

  // Base URL
  let baseUrl = '';
  if (isV3 && Array.isArray(spec.servers) && spec.servers.length) {
    baseUrl = spec.servers[0]?.url ?? '';
    // If relative, skip
    if (!baseUrl.startsWith('http')) baseUrl = '';
  } else if (isV2) {
    const scheme = (spec.schemes || ['https'])[0];
    const host = spec.host ?? '';
    const basePath = spec.basePath ?? '';
    if (host) baseUrl = `${scheme}://${host}`;
  }

  // Paths → operations
  const ops = [];
  const paths = spec.paths ?? {};
  const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

  for (const [path, pathObj] of Object.entries(paths)) {
    if (typeof pathObj !== 'object' || !pathObj) continue;
    for (const method of METHODS) {
      const op = pathObj[method];
      if (!op) continue;

      const operationId = op.operationId
        ?? `${method}-${path.replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')}`;

      // Build input schema from parameters
      let inputSchema = { type: 'object', properties: {}, additionalProperties: false };
      const required = [];
      if (Array.isArray(op.parameters)) {
        for (const param of op.parameters) {
          if (!param?.name) continue;
          if (['query', 'path'].includes(param.in)) {
            const schema = param.schema ?? { type: param.type ?? 'string' };
            inputSchema.properties[param.name] = schema;
            if (param.required) required.push(param.name);
          }
        }
      }
      if (required.length) inputSchema.required = required;

      // For POST/PUT/PATCH with requestBody
      if (['post', 'put', 'patch'].includes(method) && op.requestBody) {
        const content = op.requestBody?.content ?? {};
        const jsonContent = content['application/json'];
        if (jsonContent?.schema) {
          inputSchema = jsonContent.schema;
        }
      }

      // Output schema from 200/201 response
      let outputSchema = { type: 'object', additionalProperties: true };
      const responses = op.responses ?? {};
      const success = responses['200'] ?? responses['201'];
      if (success) {
        const jsonResp = success?.content?.['application/json'] ?? success?.content?.['*/*'];
        if (jsonResp?.schema) outputSchema = jsonResp.schema;
        // Swagger 2
        else if (success?.schema) outputSchema = success.schema;
      }

      ops.push({
        id: operationId,
        name: op.summary ?? operationId,
        description: op.description ?? op.summary ?? '',
        method: method.toUpperCase(),
        path,
        inputSchema,
        outputSchema,
        priceAda: '1.5',
        markupBasisPoints: 200,
        enabled: true,
      });
    }
  }

  return { title, version, description, baseUrl, operations: ops };
}

function handleSpecText(text) {
  let spec;
  try {
    spec = parseYaml(text);
  } catch (e) {
    announce('Could not parse the spec. Please check the file format.', true);
    return;
  }
  const extracted = extractFromOpenAPI(spec);
  state.parsedSpec = extracted;
  state.operations = extracted.operations;

  // Show parse result
  document.querySelector('#parse-api-title').textContent = extracted.title + (extracted.version ? ` v${extracted.version}` : '');
  document.querySelector('#parse-api-meta').textContent =
    `${extracted.operations.length} operation${extracted.operations.length !== 1 ? 's' : ''} found` +
    (extracted.baseUrl ? ` · Base URL: ${extracted.baseUrl}` : ' · No base URL detected');

  const tagRow = document.querySelector('#parse-operations-summary');
  tagRow.innerHTML = '';
  const counts = {};
  for (const op of extracted.operations) counts[op.method] = (counts[op.method] || 0) + 1;
  for (const [m, c] of Object.entries(counts)) {
    const tag = document.createElement('span');
    tag.className = `tag ${m.toLowerCase()}`;
    tag.textContent = `${c} ${m}`;
    tagRow.appendChild(tag);
  }

  document.querySelector('#parse-result').hidden = false;
  document.querySelector('#step1-next').disabled = false;

  // Pre-fill step 2
  if (extracted.title) document.querySelector('#listing-name').value = extracted.title;
  if (extracted.description) document.querySelector('#listing-desc').value = extracted.description.slice(0, 4000);
  if (extracted.baseUrl) {
    try {
      const u = new URL(extracted.baseUrl);
      document.querySelector('#base-url').value = u.origin;
    } catch {}
  }

  announce(`Parsed "${extracted.title}" — ${extracted.operations.length} operations found.`);
}

const presetKeyPanel = document.querySelector('#preset-key-panel');
const presetKeyInput = document.querySelector('#preset-api-key');
const customSpecFlow = document.querySelector('#custom-spec-flow');
const step1Next = document.querySelector('#step1-next');

function selectProviderTemplate(id) {
  document.querySelectorAll('.provider-tile').forEach(tile => tile.classList.toggle('selected', tile.dataset.provider === id));
  if (id === 'custom') {
    state.selectedTemplate = null;
    state.parsedSpec = null;
    state.operations = [];
    presetKeyPanel.hidden = true;
    customSpecFlow.hidden = false;
    step1Next.disabled = true;
    return;
  }

  const template = cloneProviderTemplate(id);
  if (!template) return;
  state.selectedTemplate = template;
  state.parsedSpec = { title: template.name, description: template.description, baseUrl: template.baseUrl };
  state.operations = template.operations;
  customSpecFlow.hidden = true;
  presetKeyPanel.hidden = false;
  document.querySelector('#preset-provider-name').textContent = `${template.name} API key`;
  document.querySelector('#preset-provider-summary').textContent = template.summary;
  presetKeyInput.value = '';
  presetKeyInput.placeholder = `Paste your ${template.name} API key`;
  document.querySelector('#listing-name').value = `${template.name} API access`;
  document.querySelector('#listing-desc').value = template.description;
  document.querySelector('#listing-capabilities').value = template.capabilities.join(', ');
  document.querySelector('#base-url').value = template.baseUrl;
  document.querySelector('#auth-mode').value = template.credential.mode;
  document.querySelector('#auth-field').value = template.credential.field;
  document.querySelector('#api-secret').value = '';
  document.querySelector('#request-timeout').value = '30000';
  step1Next.disabled = true;
  presetKeyInput.focus();
}

document.querySelectorAll('.provider-tile').forEach(tile => {
  tile.addEventListener('click', () => selectProviderTemplate(tile.dataset.provider));
});

presetKeyInput.addEventListener('input', () => {
  document.querySelector('#api-secret').value = presetKeyInput.value.trim();
  step1Next.disabled = presetKeyInput.value.trim().length < 4;
});

// File drop + browse
const dropzone = document.querySelector('#dropzone');
const fileInput = document.querySelector('#spec-file-input');

dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
dropzone.addEventListener('drop', e => {
  e.preventDefault(); dropzone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) readSpecFile(file);
});
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });
document.querySelector('#spec-browse-btn').addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });
fileInput.addEventListener('change', () => { if (fileInput.files[0]) readSpecFile(fileInput.files[0]); });

function readSpecFile(file) {
  const reader = new FileReader();
  reader.onload = e => handleSpecText(e.target.result);
  reader.readAsText(file);
}

// URL fetch
document.querySelector('#spec-fetch-btn').addEventListener('click', async () => {
  const url = document.querySelector('#spec-url-input').value.trim();
  if (!url) return;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    handleSpecText(await res.text());
  } catch (e) {
    announce(`Could not fetch spec: ${e.message}`, true);
  }
});

document.querySelector('#step1-next').addEventListener('click', () => {
  if (!state.selectedTemplate) {
    showStep(2);
    return;
  }
  const secret = presetKeyInput.value.trim();
  if (secret.length < 4) {
    announce('Enter the provider API key to continue.', true);
    return;
  }
  document.querySelector('#api-secret').value = secret;
  buildOpsTable();
  showStep(3);
});

// ─── STEP 2: Auth & Config ─────────────────────────────────────
document.querySelector('#step2-back').addEventListener('click', () => showStep(1));
document.querySelector('#step2-next').addEventListener('click', () => {
  const name = document.querySelector('#listing-name').value.trim();
  const desc = document.querySelector('#listing-desc').value.trim();
  const caps = document.querySelector('#listing-capabilities').value.trim();
  const baseUrl = document.querySelector('#base-url').value.trim();
  const authField = document.querySelector('#auth-field').value.trim();
  const secret = document.querySelector('#api-secret').value;

  if (!name || !desc || !caps || !baseUrl || !authField || !secret) {
    announce('Please fill in all required fields.', true); return;
  }
  try { new URL(baseUrl); } catch {
    announce('Upstream base URL must be a valid HTTPS URL.', true); return;
  }
  if (!baseUrl.startsWith('https://')) {
    announce('Upstream URL must use HTTPS.', true); return;
  }
  buildOpsTable();
  showStep(3);
});

// Eye toggle
document.querySelector('#toggle-secret').addEventListener('click', () => {
  const input = document.querySelector('#api-secret');
  const isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';
  document.querySelector('#eye-icon').innerHTML = isPassword
    ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'
    : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
});

// ─── STEP 3: Operations Table ──────────────────────────────────
function buildOpsTable() {
  const tbody = document.querySelector('#ops-tbody');
  tbody.innerHTML = '';

  if (!state.operations.length) {
    document.querySelector('#ops-empty').hidden = false;
    return;
  }
  document.querySelector('#ops-empty').hidden = true;

  for (const op of state.operations) {
    const tr = document.createElement('tr');
    tr.dataset.opId = op.id;
    tr.innerHTML = `
      <td><input type="checkbox" class="op-select" data-id="${esc(op.id)}" /></td>
      <td><span class="method-badge method-${esc(op.method)}">${esc(op.method)}</span></td>
      <td class="path-cell">${esc(op.path)}</td>
      <td>${esc(op.name)}</td>
      <td><input type="number" class="op-price" data-id="${esc(op.id)}" value="${esc(op.priceAda)}" min="0.000001" step="0.000001" /></td>
      <td><input type="number" class="op-markup" data-id="${esc(op.id)}" value="${esc(op.markupBasisPoints / 100)}" min="0" max="10000" step="0.01" /></td>
      <td><label class="toggle-switch"><input type="checkbox" class="op-enabled" data-id="${esc(op.id)}" ${op.enabled ? 'checked' : ''} /></label></td>
    `;
    tbody.appendChild(tr);
  }

  updateOpsCount();

  tbody.addEventListener('change', e => {
    const id = e.target.dataset.id;
    if (!id) return;
    const op = state.operations.find(o => o.id === id);
    if (!op) return;
    if (e.target.classList.contains('op-price')) op.priceAda = e.target.value;
    if (e.target.classList.contains('op-markup')) op.markupBasisPoints = Math.round(Number(e.target.value) * 100);
    if (e.target.classList.contains('op-enabled')) op.enabled = e.target.checked;
    updateOpsCount();
  });
}

function updateOpsCount() {
  const enabled = state.operations.filter(o => o.enabled).length;
  document.querySelector('#ops-count').textContent =
    `${state.operations.length} operations total · ${enabled} enabled`;
}

document.querySelector('#ops-search').addEventListener('input', e => {
  const q = e.target.value.toLowerCase();
  document.querySelectorAll('#ops-tbody tr').forEach(tr => {
    const text = tr.textContent.toLowerCase();
    tr.style.display = text.includes(q) ? '' : 'none';
  });
});

document.querySelector('#enable-all-ops').addEventListener('click', () => {
  state.operations.forEach(o => o.enabled = true);
  document.querySelectorAll('.op-enabled').forEach(cb => cb.checked = true);
  updateOpsCount();
});

document.querySelector('#disable-all-ops').addEventListener('click', () => {
  state.operations.forEach(o => o.enabled = false);
  document.querySelectorAll('.op-enabled').forEach(cb => cb.checked = false);
  updateOpsCount();
});

document.querySelector('#apply-bulk-price').addEventListener('click', () => {
  const price = document.querySelector('#bulk-price').value;
  if (!price) return;
  state.operations.forEach(o => o.priceAda = price);
  document.querySelectorAll('.op-price').forEach(inp => inp.value = price);
});

document.querySelector('#select-all-ops').addEventListener('change', e => {
  document.querySelectorAll('.op-select').forEach(cb => cb.checked = e.target.checked);
});

document.querySelector('#step3-back').addEventListener('click', () => showStep(state.selectedTemplate ? 1 : 2));
document.querySelector('#step3-next').addEventListener('click', () => {
  const enabled = state.operations.filter(o => o.enabled);
  if (!enabled.length) {
    announce('Enable at least one operation before continuing.', true); return;
  }
  showStep(4);
  scanCip30Wallets();
});

// ─── STEP 4: Cardano Wallet ────────────────────────────────────

// Wallet tab switching
document.querySelectorAll('.wallet-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.wallet-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.wallet-tab-panel').forEach(p => p.classList.add('hidden'));
    tab.classList.add('active');
    document.querySelector(`#tab-${tab.dataset.tab}`).classList.remove('hidden');
  });
});

async function checkAdaBalance(address) {
  const projectId = window.__BLOCKFROST_PROJECT_ID__ ?? '';
  if (!projectId) {
    return null; // skip if not configured
  }
  try {
    const res = await fetch(`https://cardano-preprod.blockfrost.io/api/v0/addresses/${address}`, {
      headers: { project_id: projectId },
    });
    if (res.status === 404) return 0n; // new address, no UTXOs yet
    if (!res.ok) return null;
    const data = await res.json();
    const lovelace = data.amount?.find(a => a.unit === 'lovelace')?.quantity ?? '0';
    return BigInt(lovelace);
  } catch {
    return null;
  }
}

function formatLovelace(lovelace) {
  return formatAda(lovelace);
}

function setPayoutAddress(address) {
  state.payoutAddress = address;
  document.querySelector('#step4-next').disabled = false;
}

function setFaucetLinks(address) {
  const url = `https://docs.cardano.org/cardano-testnets/tools/faucet/?address=${encodeURIComponent(address)}`;
  document.querySelectorAll('[id$="faucet-link"]').forEach(a => a.href = url);
}

// Generate wallet
document.querySelector('#generate-wallet-btn').addEventListener('click', async () => {
  announce('Create a Preprod wallet in Lace, Eternl, or the KeyCard wallet CLI, then connect it or paste its payout address.', true);
});

document.querySelector('#refresh-balance-btn').addEventListener('click', async () => {
  if (!state.payoutAddress) return;
  const bal = await checkAdaBalance(state.payoutAddress);
  document.querySelector('#wallet-balance').textContent = formatLovelace(bal ?? 0n);
});

document.querySelector('#copy-addr-btn').addEventListener('click', async () => {
  if (!state.payoutAddress) return;
  await navigator.clipboard.writeText(state.payoutAddress).catch(() => {});
  announce('Address copied to clipboard.');
});

document.querySelector('#toggle-mnemonic-btn').addEventListener('click', () => {
  const grid = document.querySelector('#mnemonic-words');
  const isHidden = grid.classList.toggle('hidden');
  document.querySelector('#toggle-mnemonic-btn').textContent = isHidden ? 'Show phrase' : 'Hide phrase';
});

document.querySelector('#download-mnemonic-btn').addEventListener('click', () => {
  if (!state.mnemonic) return;
  const content = `KeyCard Provider Wallet — Cardano Preprod Recovery Phrase\n\nAddress: ${state.payoutAddress}\n\nRecovery phrase:\n${state.mnemonic}\n\nKeep this file secure and offline. Never share it.`;
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'keycard-wallet-backup.txt';
  a.click(); URL.revokeObjectURL(url);
});

// Use existing address
document.querySelector('#use-existing-btn').addEventListener('click', async () => {
  const address = document.querySelector('#existing-address').value.trim();
  try { await apiFetch('/api/cardano/validate-address', { method: 'POST', body: JSON.stringify({ address }) }); }
  catch (error) { announce(error.message, true); return; }

  document.querySelector('#existing-wallet-address').textContent = address;
  document.querySelector('#existing-wallet-result').hidden = false;
  setPayoutAddress(address);
  setFaucetLinks(address);

  const bal = await checkAdaBalance(address);
  document.querySelector('#existing-wallet-balance').textContent = formatLovelace(bal);
  announce('Address set. You can now continue.');
});

document.querySelector('#existing-refresh-btn').addEventListener('click', async () => {
  const address = document.querySelector('#existing-address').value.trim();
  if (!address) return;
  const bal = await checkAdaBalance(address);
  document.querySelector('#existing-wallet-balance').textContent = formatLovelace(bal ?? 0n);
});

// CIP-30 browser wallet detection
const CIP30_KNOWN = ['nami', 'eternl', 'flint', 'lace', 'gerowallet', 'typhoncip30', 'yoroi', 'vespr'];
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
function bech32Polymod(values) {
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    generators.forEach((generator, index) => { if ((top >>> index) & 1) checksum ^= generator; });
  }
  return checksum;
}
function bech32Address(hex) {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2) throw new Error('Wallet returned an invalid address.');
  const bytes = Uint8Array.from(hex.match(/../g).map(value => Number.parseInt(value, 16)));
  if ((bytes[0] & 0x0f) !== 0) throw new Error('Connect a Cardano Preprod wallet.');
  const words = []; let accumulator = 0; let bits = 0;
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; words.push((accumulator >>> bits) & 31); }
  }
  if (bits) words.push((accumulator << (5 - bits)) & 31);
  const hrp = 'addr_test';
  const expanded = [...hrp].map(c => c.charCodeAt(0) >>> 5).concat([0], [...hrp].map(c => c.charCodeAt(0) & 31));
  const polymod = bech32Polymod(expanded.concat(words, [0, 0, 0, 0, 0, 0])) ^ 1;
  const checksum = Array.from({ length: 6 }, (_, index) => (polymod >>> (5 * (5 - index))) & 31);
  return `${hrp}1${words.concat(checksum).map(value => BECH32_CHARSET[value]).join('')}`;
}
function scanCip30Wallets() {
  const container = document.querySelector('#cip30-wallets');
  const none = document.querySelector('#cip30-none');
  const found = CIP30_KNOWN.filter(name => window.cardano?.[name]);

  if (!found.length) {
    none.textContent = 'No CIP-30 wallets detected. Try the Nami, Eternl, or Lace browser extension.';
    return;
  }
  none.hidden = true;
  container.innerHTML = '';
  for (const name of found) {
    const wallet = window.cardano[name];
    const btn = document.createElement('button');
    btn.className = 'cip30-wallet-btn';
    if (wallet.icon) btn.innerHTML = `<img src="${esc(wallet.icon)}" alt="" />`;
    btn.innerHTML += esc(wallet.name ?? name);
    btn.addEventListener('click', async () => {
      try {
        const api = await wallet.enable();
        const addrHex = await api.getChangeAddress();
        const address = addrHex.startsWith('addr_test1') ? addrHex : bech32Address(addrHex);
        await apiFetch('/api/cardano/validate-address', { method: 'POST', body: JSON.stringify({ address }) });
        document.querySelector('#cip30-address').textContent = address;
        document.querySelector('#cip30-wallet-result').hidden = false;
        setPayoutAddress(address);
        setFaucetLinks(address);
        const balance = await checkAdaBalance(address);
        document.querySelector('#cip30-balance').textContent = formatLovelace(balance);
        announce(`Connected to ${wallet.name ?? name}.`);
      } catch (e) {
        announce(`Could not connect to ${name}: ${e.message}`, true);
      }
    });
    container.appendChild(btn);
  }
}

document.querySelector('#step4-back').addEventListener('click', () => showStep(3));
document.querySelector('#step4-next').addEventListener('click', () => {
  populateReview();
  showStep(5);
});

// ─── STEP 5: Review & Publish ──────────────────────────────────
function reviewRow(label, value) {
  const div = document.createElement('div');
  div.className = 'review-row';
  div.innerHTML = `<span>${esc(label)}</span><span>${esc(value)}</span>`;
  return div;
}

function populateReview() {
  // Listing card
  const listingRows = document.querySelector('#review-listing-rows');
  listingRows.innerHTML = '';
  listingRows.append(
    reviewRow('Name', document.querySelector('#listing-name').value),
    reviewRow('Description', document.querySelector('#listing-desc').value.slice(0, 80) + (document.querySelector('#listing-desc').value.length > 80 ? '…' : '')),
    reviewRow('Capabilities', document.querySelector('#listing-capabilities').value),
    reviewRow('Base URL', document.querySelector('#base-url').value),
  );

  // Auth card
  const authRows = document.querySelector('#review-auth-rows');
  authRows.innerHTML = '';
  authRows.append(
    reviewRow('Credential location', document.querySelector('#auth-mode').value === 'header' ? 'HTTP Header' : 'Query parameter'),
    reviewRow('Header / parameter', document.querySelector('#auth-field').value),
    reviewRow('API key', '••••••••' + document.querySelector('#api-secret').value.slice(-4)),
    reviewRow('Timeout', `${document.querySelector('#request-timeout').value} ms`),
  );

  // Wallet card
  const walletRows = document.querySelector('#review-wallet-rows');
  walletRows.innerHTML = '';
  const addr = state.payoutAddress ?? '—';
  walletRows.append(
    reviewRow('Network', 'Cardano Preprod'),
    reviewRow('Address', addr.slice(0, 16) + '…' + addr.slice(-8)),
  );

  // Operations
  const enabledOps = state.operations.filter(o => o.enabled);
  document.querySelector('#review-ops-count').textContent = `${enabledOps.length} enabled`;
  const tbody = document.querySelector('#review-ops-tbody');
  tbody.innerHTML = enabledOps.map(op => `
    <tr>
      <td><span class="method-badge method-${esc(op.method)}">${esc(op.method)}</span></td>
      <td>${esc(op.path)}</td>
      <td>${esc(op.name)}</td>
      <td>₳ ${esc(op.priceAda)}</td>
      <td>${(op.markupBasisPoints / 100).toFixed(2)}%</td>
    </tr>
  `).join('');
}

document.querySelector('#step5-back').addEventListener('click', () => showStep(4));

document.querySelector('#publish-btn').addEventListener('click', async () => {
  const btn = document.querySelector('#publish-btn');
  const spinner = document.querySelector('#publish-spinner');
  const btnText = document.querySelector('#publish-btn-text');
  btn.disabled = true; spinner.classList.remove('hidden'); btnText.textContent = 'Publishing…';

  try {
    const enabledOps = state.operations.filter(o => o.enabled);
    if (!enabledOps.length) throw new Error('Enable at least one operation.');

    // Convert operations to KeyCard format
    const operations = enabledOps.map(op => ({
      operationId: op.id,
      name: op.name,
      description: op.description || op.name,
      method: op.method,
      path: op.path,
      inputSchema: op.inputSchema ?? { type: 'object', properties: {}, additionalProperties: false },
      outputSchema: op.outputSchema ?? { type: 'object', additionalProperties: true },
      priceLovelace: adaToLovelace(op.priceAda),
      markupBasisPoints: Math.max(0, Math.min(1_000_000, op.markupBasisPoints)),
      enabled: true,
    }));

    const listingIdInput = document.querySelector('#listing-id').value.trim();
    const payload = {
      listing: {
        ...(listingIdInput ? { listingId: listingIdInput } : {}),
        name: document.querySelector('#listing-name').value.trim(),
        description: document.querySelector('#listing-desc').value.trim(),
        capabilities: document.querySelector('#listing-capabilities').value
          .split(',').map(s => s.trim()).filter(Boolean),
      },
      upstream: {
        baseUrl: document.querySelector('#base-url').value.trim(),
        requestTimeoutMs: Number(document.querySelector('#request-timeout').value) || 5000,
        staticHeaders: state.selectedTemplate?.staticHeaders ?? {},
      },
      credential: {
        mode: document.querySelector('#auth-mode').value,
        field: document.querySelector('#auth-field').value.trim(),
        value: `${state.selectedTemplate?.credential.prefix ?? ''}${document.querySelector('#api-secret').value}`,
      },
      operations,
      payoutAddress: state.payoutAddress,
    };

    const result = await apiFetch('/api/provider/listings', {
      method: 'POST', body: JSON.stringify(payload),
    });

    // Success
    document.querySelector('#success-listing-id').textContent = result.listingId;
    document.querySelector('#success-proxy-url').textContent =
      result.proxyEndpoints?.[0]?.proxyUrl ?? 'No enabled proxy endpoint returned.';
    document.querySelector('#success-op-count').textContent = result.operationIds?.length ?? operations.length;

    showStep('success');
  } catch (e) {
    announce(e.message, true);
  } finally {
    btn.disabled = false; spinner.classList.add('hidden'); btnText.textContent = 'Publish listing';
  }
});

// ─── INIT ─────────────────────────────────────────────────────
showStep(1);
