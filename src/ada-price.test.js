import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdaUsdRate, toLovelace, usdRateScaled } from './server/ada-price.ts';

test('ADA quotes preserve integer precision and round rate down/payment up', () => {
  assert.equal(usdRateScaled(0.27124575084983005),27124575n);
  assert.equal(usdRateScaled('0.27124575999999999999'),27124575n);
  assert.equal(toLovelace('1000000',usdRateScaled('0.27124575084983005'),1n),3686694n);
  assert.equal(toLovelace('1000',usdRateScaled('0.27124575'),1500000n),1500000n);
  assert.equal(toLovelace('9007199254740993',usdRateScaled('1'),1n),9007199254740993n);
  for (const value of [0,-1,NaN,Infinity,'0.000000001','-0.1',null,{},'nan','', '1e-2']) assert.throws(()=>usdRateScaled(value));
});
test('conversion uses Bearer authentication, explicit USD, coalesces requests and expires cache',async()=>{
  let time=1000,requests=0;
  const rate=createAdaUsdRate({apiKey:()=> 'fixture-key',now:()=>time,request:async(url,options)=>{
    requests++; assert.equal(url,'https://api.freecryptoapi.com/v1/getConversion?from=ADA&to=USD&amount=1');
    assert.equal(options.headers.Authorization,'Bearer fixture-key');assert.ok(options.signal instanceof AbortSignal);
    return new Response(JSON.stringify({status:'success',result:0.27124575084983005}));
  }});
  assert.deepEqual(await Promise.all([rate(),rate(),rate()]),[27124575n,27124575n,27124575n]);assert.equal(requests,1);
  time+=59999;await rate();assert.equal(requests,1);time+=1;await rate();assert.equal(requests,2);
});
test('expired quotes fail closed on transport, plan/auth or invalid rate errors',async()=>{
  let time=0,mode='success';
  const rate=createAdaUsdRate({apiKey:()=> 'fixture',now:()=>time,request:async()=>{
    if(mode==='timeout')throw Error('timeout');
    if(mode==='http')return new Response('{}',{status:429});
    return new Response(JSON.stringify(mode==='refused'?{status:false,error:'No access'}:
      {status:'success',result:mode==='invalid'?0:0.27}));
  }});
  assert.equal(await rate(),27000000n);time=60000;
  for(const error of ['http','refused','invalid','timeout']){mode=error;await assert.rejects(()=>rate());}
  mode='success';assert.equal(await rate(),27000000n);
  await assert.rejects(()=>createAdaUsdRate({apiKey:()=>undefined})(),/FREECRYPTOAPI_API_KEY/);
});
