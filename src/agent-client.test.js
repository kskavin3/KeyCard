import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { WalletJournal, paidCall, checkBudget } from '../scripts/agent-client.mjs';
import { encodePaymentRequiredHeader } from '@x402/core/http';

const policy={maxCallLovelace:'2000000',maxTotalLovelace:'4000000'};
test('spending limits include network fees and reservations with integer precision',()=>{
  assert.equal(checkBudget('1500000','200000','0',policy),'1700000');
  assert.throws(()=>checkBudget('1900000','200000','0',policy),/per-call/);
  assert.throws(()=>checkBudget('1500000','200000','3000000',policy),/cumulative/);
  assert.throws(()=>checkBudget('1','0','0',{maxCallLovelace:'0',maxTotalLovelace:'1'}),/positive/);
  assert.equal(checkBudget('9007199254740992','1','0',{maxCallLovelace:'9007199254740993',maxTotalLovelace:'9007199254740993'}),'9007199254740993');
});
test('wallet init and info use actual Cardano signer; secrets stay in owner-only files',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'keycard-wallet-'));
  try {
    const env={...process.env,KEYCARD_AGENT_WALLET_DIR:directory,BLOCKFROST_PROJECT_ID:''};
    const output=execFileSync(process.execPath,['scripts/agent-wallet.mjs','init','2000000','10000000'],{env,encoding:'utf8'});
    assert.equal(output.includes(await readFile(join(directory,'mnemonic'),'utf8')),false);
    assert.equal((await stat(join(directory,'mnemonic'))).mode & 0o777,0o600);
    const info=JSON.parse(execFileSync(process.execPath,['scripts/agent-wallet.mjs','info'],{env,encoding:'utf8'}));
    assert.ok(info.address.startsWith('addr_test1')); assert.equal(info.network,'cardano:preprod');
    assert.equal(info.limits.maxCallLovelace,'2000000');
    assert.throws(()=>execFileSync(process.execPath,['scripts/agent-wallet.mjs','init','1','1'],{env,stdio:'pipe'}));
  } finally { await rm(directory,{recursive:true,force:true}); }
});
test('agent persists signed bytes before sending and resumes after a transport timeout',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'keycard-journal-')); const journal=new WalletJournal(directory);
  const requestId='a'.repeat(48),url='http://127.0.0.1/api/proxy/l/o';
  const requirements={scheme:'exact',network:'cardano:preprod',asset:'lovelace',amount:'1500000',payTo:'fixture',maxTimeoutSeconds:300,extra:{}};
  let signatures=[],signed=0,mode='timeout';
  const request=async(_url,options)=>{
    if(!options.headers['PAYMENT-SIGNATURE']) return new Response(JSON.stringify({quote:{expiresAt:new Date(Date.now()+300000).toISOString()}}),{
      status:402,headers:{'PAYMENT-REQUIRED':encodePaymentRequiredHeader({x402Version:2,resource:{url},accepts:[requirements]})}});
    const persisted=JSON.parse(await readFile(join(directory,'journal.json'),'utf8'));
    assert.equal(persisted.reservedLovelace,'1700000'); assert.equal(persisted.calls[requestId].signature,options.headers['PAYMENT-SIGNATURE']);
    signatures.push(options.headers['PAYMENT-SIGNATURE']);
    if(mode==='timeout') throw Error('transport timeout');
    return new Response(JSON.stringify({result:{ok:true},receipt:{paymentConfirmed:true,transaction:'tx1'}}),{status:200});
  };
  const options={journal,url,requestId,policy,request,maxAttempts:1,signer:{createPaymentPayload:async()=>{
    signed++; return {x402Version:2,payload:{transaction:'signed bytes',nonce:'fixture#0'}};
  }},decodeTransaction:()=>({fee:200000n,txHash:'tx1'})};
  try {
    assert.equal((await paidCall(options)).status,'pending'); mode='success';
    assert.deepEqual((await paidCall({...options,journal:new WalletJournal(directory)})).result,{ok:true});
    assert.equal(signed,1); assert.equal(signatures[0],signatures[1]);
    await paidCall(options); assert.equal(signatures.length,2);
    await assert.rejects(()=>paidCall({...options,url:url+'?different=true'}),/different call/);
    const persisted=JSON.parse(await readFile(join(directory,'journal.json'),'utf8')); assert.equal(persisted.reservedLovelace,'1700000');
  } finally {await rm(directory,{recursive:true,force:true});}
});
test('wallet refuses overlapping calls, overspending, and unsigned insufficient-funds attempts',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'keycard-wallet-lock-'));const journal=new WalletJournal(directory);
  try {
    await journal.locked(async()=>{await assert.rejects(()=>journal.locked(async()=>{}),/locked/);});
    const url='http://localhost/api/proxy/l/o';
    const challenge={x402Version:2,resource:{url},accepts:[{scheme:'exact',network:'cardano:preprod',asset:'lovelace',amount:'1500000',payTo:'fixture',maxTimeoutSeconds:300,extra:{}}]};
    const options={journal,url,requestId:'b'.repeat(48),policy,signer:{createPaymentPayload:async()=>{throw Error('Funding wallet has no UTXOs');}},
      request:async()=>new Response(JSON.stringify({quote:{expiresAt:new Date(Date.now()+300000).toISOString()}}),{status:402,headers:{'PAYMENT-REQUIRED':encodePaymentRequiredHeader(challenge)}})};
    await assert.rejects(()=>paidCall(options),/no UTXOs/);
    assert.equal(JSON.parse(await readFile(join(directory,'journal.json'),'utf8')).reservedLovelace,'0');
    await assert.rejects(()=>paidCall({...options,policy:{maxCallLovelace:'1',maxTotalLovelace:'1'}}),/per-call/);
  } finally {await rm(directory,{recursive:true,force:true});}
});
