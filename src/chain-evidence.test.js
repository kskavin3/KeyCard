import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeCardanoTransaction } from '@x402/cardano';
import { createChainEvidence } from './server/chain-evidence.ts';

// A real CBOR transaction body for decoder/identity tests. Ledger responses are
// fixtures; this does not claim a live blockchain payment or valid witnesses.
const hex='84a40081825820'+'11'.repeat(32)+'00018182581d60'+'22'.repeat(28)+'1a0016e360021a00030d40031a05f5e100a0f5f6';
const transaction=Buffer.from(hex,'hex').toString('base64');
const decoded=decodeCardanoTransaction(transaction);
const requirements={network:'cardano:preprod',scheme:'exact',asset:'lovelace',amount:'1500000',payTo:decoded.outputs[0].address,extra:{},maxTimeoutSeconds:300};
const payload={x402Version:2,accepted:requirements,payload:{transaction}};

test('independent evidence requires canonical hash, ledger success, depth and correct ADA output',async()=>{
  let tx={hash:decoded.txHash,valid_contract:true,block_height:100,block_time:1000};
  let tip={height:101};let outputs=[{address:requirements.payTo,amount:[{unit:'lovelace',quantity:'1500000'}]}];
  let status=200;
  const chain=createChainEvidence({projectId:()=> 'fixture',request:async(url,init)=>{
    assert.equal(init.headers.project_id,'fixture'); assert.ok(url.startsWith('https://cardano-preprod.blockfrost.io/'));
    const body=url.endsWith('/blocks/latest')?tip:url.endsWith('/utxos')?{outputs}:tx;
    return new Response(JSON.stringify(body),{status});
  }});
  assert.equal((await chain.confirmed(payload,requirements)).transaction,decoded.txHash);
  tip.height=100;assert.equal(await chain.confirmed(payload,requirements),undefined);tip.height=101;
  tx.valid_contract=false;assert.equal(await chain.confirmed(payload,requirements),undefined);tx.valid_contract=true;
  outputs[0].amount[0].quantity='1499999';assert.equal(await chain.confirmed(payload,requirements),undefined);
  outputs[0].amount[0].quantity='1500000';outputs[0].address='wrong-recipient';assert.equal(await chain.confirmed(payload,requirements),undefined);
  outputs[0].address=requirements.payTo;tx.hash='wrong-hash';assert.equal(await chain.confirmed(payload,requirements),undefined);tx.hash=decoded.txHash;
  status=404;assert.equal(await chain.confirmed(payload,requirements),undefined);
  status=503;await assert.rejects(()=>chain.confirmed(payload,requirements),/unavailable/);
  assert.equal(await chain.confirmed(payload,{...requirements,network:'cardano:mainnet'}),undefined);
});
test('refund evidence must return full amount to payer after payment and cannot reuse payment hash',async()=>{
  const hash='33'.repeat(32);let time=1001;
  const chain=createChainEvidence({projectId:()=> 'fixture',request:async url=>new Response(JSON.stringify(
    url.endsWith('/blocks/latest')?{height:101}:url.endsWith('/utxos')?{outputs:[{address:'payer',amount:[{unit:'lovelace',quantity:'1500000'}]}]}:
    {hash:url.includes(hash)?hash:decoded.txHash,valid_contract:true,block_height:100,block_time:url.includes(hash)?time:1000}
  ))});
  assert.equal(await chain.verifyRefund(hash,'payer','1500000',decoded.txHash),true);
  assert.equal(await chain.verifyRefund(hash,'wrong-payer','1500000',decoded.txHash),false);
  assert.equal(await chain.verifyRefund(hash,'payer','1500001',decoded.txHash),false);
  time=999;assert.equal(await chain.verifyRefund(hash,'payer','1500000',decoded.txHash),false);
  assert.equal(await chain.verifyRefund(decoded.txHash,'payer','1500000',decoded.txHash),false);
});
