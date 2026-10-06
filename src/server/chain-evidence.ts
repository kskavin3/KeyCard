import { decodeCardanoTransaction } from '@x402/cardano';
import type { PaymentPayload, PaymentRequirements, SettleResponse } from '@x402/core/types';

export function createChainEvidence({ projectId, request = fetch }: { projectId: () => string | undefined; request?: typeof fetch }) {
  const get = async (path: string) => {
    const key = projectId();
    if (!key) throw new Error('BLOCKFROST_PROJECT_ID is required for independent reconciliation.');
    const response = await request(`https://cardano-preprod.blockfrost.io/api/v0${path}`, {
      headers: { project_id: key }, signal: AbortSignal.timeout(5000),
    });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error('Chain evidence is unavailable.');
    return response.json();
  };
  const confirmedTransfer = async (hash: string, payTo: string, amount: string) => {
    const tx = await get(`/txs/${hash}`);
    if (!tx || tx.hash !== hash || tx.valid_contract !== true || !Number.isSafeInteger(tx.block_height)) return undefined;
    const [tip, utxos] = await Promise.all([get('/blocks/latest'), get(`/txs/${hash}/utxos`)]);
    if (!tip || !Number.isSafeInteger(tip.height) || tip.height - tx.block_height < 1 || !Array.isArray(utxos?.outputs)) return undefined;
    const paid = utxos.outputs.some((output: any) => output.address === payTo &&
      Array.isArray(output.amount) && output.amount.some((value: any) => value.unit === 'lovelace' &&
        typeof value.quantity === 'string' && /^[0-9]+$/.test(value.quantity) && BigInt(value.quantity) >= BigInt(amount)));
    return paid ? tx : undefined;
  };
  return {
    async confirmed(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse | undefined> {
      if (!projectId()) return undefined;
      if (requirements.network !== 'cardano:preprod' || requirements.asset !== 'lovelace' || requirements.scheme !== 'exact' ||
          (requirements.extra.assetTransferMethod && requirements.extra.assetTransferMethod !== 'default')) return undefined;
      const decoded = decodeCardanoTransaction(String(payload.payload.transaction));
      // Ledger inclusion authenticates the signed body and witnesses. A hash
      // alone or a pending mempool transaction cannot authorize the resource.
      const tx = await confirmedTransfer(decoded.txHash, requirements.payTo, requirements.amount);
      if (!tx) return undefined;
      return { success: true, transaction: decoded.txHash, network: 'cardano:preprod',
        extra: { evidenceSource: 'blockfrost', blockTime: tx.block_time } };
    },
    async verifyRefund(txHash: string, payer: string, amount: string, paymentTx: string) {
      if (txHash === paymentTx) return false;
      const refund = await confirmedTransfer(txHash, payer, amount);
      const payment = await get(`/txs/${paymentTx}`);
      return Boolean(refund && payment && Number.isSafeInteger(refund.block_time) && Number.isSafeInteger(payment.block_time) &&
        refund.block_time >= payment.block_time);
    },
  };
}
