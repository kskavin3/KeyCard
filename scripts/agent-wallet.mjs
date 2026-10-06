import 'dotenv/config';
import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { readFile, mkdir, open } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { toClientCardanoSigner } from '@x402/cardano';
import { ExactCardanoScheme } from '@x402/cardano/exact/client';
import { WalletJournal, paidCall } from './agent-client.mjs';

const directory=resolve(process.env.KEYCARD_AGENT_WALLET_DIR ?? '.keycard-agent');
const mnemonicPath=join(directory,'mnemonic');
const policyPath=join(directory,'limits.json');
const [command,...args]=process.argv.slice(2);
async function writeNew(path,text) { const file=await open(path,'wx',0o600); try { await file.writeFile(text); await file.sync(); } finally { await file.close(); } }
try {
  if (command==='init') {
    const [maxCallLovelace,maxTotalLovelace]=args;
    if (![maxCallLovelace,maxTotalLovelace].every(value=>/^[1-9][0-9]*$/.test(value ?? ''))) throw Error('Usage: init MAX_CALL_LOVELACE MAX_TOTAL_LOVELACE (limits include network fees).');
    await mkdir(directory,{recursive:true,mode:0o700});
    await writeNew(mnemonicPath,generateMnemonic(wordlist,256));
    await writeNew(policyPath,JSON.stringify({maxCallLovelace,maxTotalLovelace}));
    console.log('Dedicated Preprod wallet created. Mnemonic saved locally; run info for its funding address.');
  } else {
    const mnemonic=await readFile(mnemonicPath,'utf8');
    const projectId=process.env.BLOCKFROST_PROJECT_ID;
    const signer=toClientCardanoSigner({mnemonic,network:'cardano:preprod',provider:{blockfrost:{baseUrl:'https://cardano-preprod.blockfrost.io/api/v0',projectId},requestTimeoutMs:10000}});
    if (command==='info') {
      const address=signer.getAddress(); let balanceLovelace=null;
      if (projectId) {
        let total=0n;
        for (let page=1;;page++) {
          const response=await fetch(`https://cardano-preprod.blockfrost.io/api/v0/addresses/${address}/utxos?count=100&page=${page}`,{headers:{project_id:projectId},signal:AbortSignal.timeout(10000)});
          if(response.status===404) {balanceLovelace='0';break;}
          if(!response.ok) throw Error('Could not read wallet balance.');
          const outputs=await response.json();
          for(const output of outputs) for(const amount of output.amount) if(amount.unit==='lovelace') total+=BigInt(amount.quantity);
          if(outputs.length<100) {balanceLovelace=total.toString();break;}
        }
      }
      console.log(JSON.stringify({network:'cardano:preprod',address,balanceLovelace,limits:JSON.parse(await readFile(policyPath,'utf8')),
        funding:'Optional: send Preprod test ADA to this address. Paid calls need service amount plus fees; sponsorship is not implemented.'},null,2));
    } else if(command==='call') {
      const [url,requestId,method='GET',bodyText]=args;
      if(!projectId) throw Error('BLOCKFROST_PROJECT_ID is required to build payments.');
      const policy=JSON.parse(await readFile(policyPath,'utf8'));
      console.log(JSON.stringify(await paidCall({journal:new WalletJournal(directory),url,requestId,method,
        body:bodyText===undefined?undefined:JSON.parse(bodyText),signer:new ExactCardanoScheme(signer),policy}),null,2));
    } else throw Error('Commands: init MAX_CALL MAX_TOTAL | info | call URL REQUEST_ID [METHOD] [JSON_BODY]');
  }
} catch(error) {console.error(error.message);process.exitCode=1;}
