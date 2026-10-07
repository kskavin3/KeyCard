import { randomBytes, createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { jcs, decodeCardanoTransaction } from '@x402/cardano';
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from '@x402/core/http';

export class WalletJournal {
  constructor(directory) { this.directory = directory; this.path = join(directory, 'journal.json'); }
  async locked(run) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const lock = await open(join(this.directory, 'wallet.lock'), 'wx', 0o600).catch(() => {
      throw Error('Wallet is locked by another call. Do not start another payment until that call finishes.');
    });
    try {
      await lock.writeFile(String(process.pid));
      let journal;
      try { journal = JSON.parse(await readFile(this.path, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; journal = { reservedLovelace: '0', calls: {} }; }
      return await run(journal, async () => {
        const temp = `${this.path}.${randomBytes(8).toString('hex')}.tmp`;
        const file = await open(temp, 'wx', 0o600);
        try { await file.writeFile(JSON.stringify(journal)); await file.sync(); } finally { await file.close(); }
        await rename(temp, this.path);
        // Persist the rename before submitting a signed transaction.
        const directory = await open(this.directory, 'r');
        try {
          await directory.sync().catch(error => {
            // Windows does not support fsync on directory handles. The file was
            // already flushed before the atomic rename, which is the strongest
            // portable durability guarantee available there.
            if (process.platform !== 'win32' || !['EPERM', 'EINVAL', 'EBADF'].includes(error.code)) throw error;
          });
        } finally { await directory.close(); }
      });
    } finally { await lock.close(); await unlink(join(this.directory, 'wallet.lock')); }
  }
}
const positive = value => typeof value === 'string' && /^[1-9][0-9]*$/.test(value);
export function checkBudget(service, fee, reserved, policy) {
  if (![service,fee,reserved].every(value=>/^[0-9]+$/.test(value)) ||
      !positive(policy.maxCallLovelace) || !positive(policy.maxTotalLovelace)) throw Error('Configure positive call and total spending limits in lovelace.');
  const cost = BigInt(service) + BigInt(fee);
  if (cost > BigInt(policy.maxCallLovelace)) throw Error('Payment plus network fee exceeds the per-call spending limit.');
  if (BigInt(reserved)+cost > BigInt(policy.maxTotalLovelace)) throw Error('Payment exceeds the wallet’s cumulative spending limit.');
  return cost.toString();
}

// A separate signer can implement CIP-30 or hardware-wallet authorization.
// The reference CLI uses the SDK's local dedicated Preprod signer.
export async function paidCall({ journal, url, method='GET', body, requestId, signer, policy,
  request=fetch, decodeTransaction=decodeCardanoTransaction, maxAttempts=8, wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)) }) {
  const destination = new URL(url);
  if (destination.protocol !== 'https:' && !(destination.protocol === 'http:' && ['localhost','127.0.0.1'].includes(destination.hostname))) throw Error('Use HTTPS or a local KeyCard server.');
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(requestId ?? '')) throw Error('Provide a stable random request ID of at least 32 characters.');
  if (!['GET','POST','PUT','PATCH','DELETE'].includes(method)) throw Error('Unsupported method.');
  if (['GET','DELETE'].includes(method) && body !== undefined) throw Error('Pass GET/DELETE inputs as URL query parameters.');
  const fingerprint = createHash('sha256').update(jcs({ url, method, body: body ?? null })).digest('hex');
  return journal.locked(async (state, save) => {
    let call = state.calls[requestId];
    if (call && call.fingerprint !== fingerprint) throw Error('Request ID was already used for a different call.');
    if (!call) { call = { fingerprint, status: 'unpaid' }; state.calls[requestId]=call; await save(); }
    if (call.status === 'completed' || call.status === 'failed') return call.response;
    const send = () => request(url,{method,redirect:'error',signal:AbortSignal.timeout(45000),
      headers:{'Idempotency-Key':requestId,...(body === undefined ? {} : {'content-type':'application/json'}),
        ...(call.signature ? {'PAYMENT-SIGNATURE':call.signature} : {})}, body:body === undefined ? undefined : JSON.stringify(body)});
    if (!call.signature) {
      const challengeResponse = await send();
      if (challengeResponse.status !== 402) throw Error(`Expected a payment challenge; received ${challengeResponse.status}.`);
      const header = challengeResponse.headers.get('PAYMENT-REQUIRED');
      if (!header) throw Error('Server did not provide an x402 challenge.');
      const challenge = decodePaymentRequiredHeader(header);
      const envelope = await challengeResponse.json();
      if (!envelope.quote?.expiresAt || Date.parse(envelope.quote.expiresAt) <= Date.now()) throw Error('Quote expired. Request a fresh quote before signing.');
      const requirements=challenge.accepts.find(r=>r.network==='cardano:preprod' && r.asset==='lovelace' && r.scheme==='exact');
      if (challenge.x402Version!==2 || !requirements ||
          (requirements.extra.assetTransferMethod && requirements.extra.assetTransferMethod !== 'default') ||
          requirements.extra.paymentFlow || challenge.resource.url !== new URL(url).href) throw Error('Unsupported payment terms or mismatched resource.');
      checkBudget(requirements.amount,'0',state.reservedLovelace,policy);
      const payment = await signer.createPaymentPayload(2,requirements);
      const decoded = decodeTransaction(payment.payload.transaction);
      const cost = checkBudget(requirements.amount,decoded.fee.toString(),state.reservedLovelace,policy);
      if (Date.parse(envelope.quote.expiresAt) <= Date.now()) throw Error('Quote expired while signing. The transaction was not submitted.');
      call.signature=encodePaymentSignatureHeader({ ...payment, accepted: requirements, resource: challenge.resource });
      call.transaction=decoded.txHash; call.costLovelace=cost; call.status='pending';
      state.reservedLovelace=(BigInt(state.reservedLovelace)+BigInt(cost)).toString();
      await save(); // Signed bytes and spending reservation survive network errors.
    }
    for (let attempt=0;attempt<maxAttempts;attempt++) {
      let response;
      try { response=await send(); } catch { if (attempt+1<maxAttempts) { await wait(5000); continue; } break; }
      const payload=await response.json();
      if (response.status===200 && payload.receipt?.paymentConfirmed && payload.receipt.transaction===call.transaction) {
        call.status='completed'; call.response=payload; await save(); return payload;
      }
      // Never respond to a subsequent 402 by signing another transaction.
      if (response.status!==202 && response.status!==503) {
        call.status='failed'; call.response={ httpStatus:response.status,...payload }; await save(); return call.response;
      }
      if (response.status===503 && payload.receipt?.state==='review') {
        call.response={httpStatus:503,...payload}; await save(); return call.response;
      }
      if (attempt+1<maxAttempts) await wait(5000);
    }
    return { status:'pending',requestId,transaction:call.transaction,
      retry:'Run this same command with the same request ID. The saved transaction will be reused.' };
  });
}
