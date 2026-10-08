import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {Store} from '../server/store.ts';
import {createHandler} from '../server/app.ts';
import {LOCAL_SCOPE} from '../src/decisions.ts';
import {INSTRUCTION_VERSION} from '../src/learning.ts';
// SYNTHETIC: loopback-only learning routes over an in-memory store with invented listings.
function call(port:number,method:string,path:string,{body,headers={}}:{body?:any;headers?:Record<string,string>}={}){
 return new Promise<{status:number;headers:any;json:any}>((resolve,reject)=>{
  const req=request({host:'127.0.0.1',port,method,path,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers}},res=>{let raw='';res.on('data',c=>raw+=c);res.on('end',()=>resolve({status:res.statusCode!,headers:res.headers,json:raw?JSON.parse(raw):null}));});
  req.on('error',reject);if(body!==undefined)req.write(JSON.stringify(body));req.end();
 });
}
const calendar=`BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:http-science\nSUMMARY:Science and crafts evening\nDESCRIPTION:Synthetic listing.\nDTSTART:20800605T150000Z\nDTEND:20800605T160000Z\nEND:VEVENT\nEND:VCALENDAR`;
test('learning routes keep loopback/same-origin/JSON guards, no-store, 409 reloads for stale state, and never call out or echo private text',async()=>{
 const store=new Store(':memory:');const t=store.beginScan();store.ingest('prcr',calendar,'http-batch','2026-10-04T02:35:33.636296Z','live',t.fence);store.endScan(t.fence);
 const external:string[]=[],logs:string[]=[];const originalFetch=globalThis.fetch,originalLog=console.log,originalError=console.error;
 globalThis.fetch=(async(input:any)=>{external.push(String(input));throw Error('External network is not allowed in this test.');}) as typeof fetch;
 console.log=(...a:any[])=>{logs.push(a.join(' '));};console.error=(...a:any[])=>{logs.push(a.join(' '));};
 let port=0;
 const server=createServer(createHandler({store,port:()=>port,scan:async()=>{throw Error('Scanning is disabled in this test.');},scanState:()=>({scanning:false,lastScan:null}),fallback:(_req,res)=>{res.writeHead(404);res.end();}}));
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',()=>resolve()));port=(server.address() as any).port;
 try{
  const origin=`http://127.0.0.1:${port}`,same={Origin:origin};
  const on={commandKey:'synthetic-http-on',action:'on',expectedControlRevision:null};
  for(const route of ['control','interest','replace','undo','instruction'])
   for(const headers of [{},{Origin:'http://evil.test'},{Origin:origin,'Sec-Fetch-Site':'cross-site'},{Origin:origin,'Content-Type':'text/plain'},{Origin:origin,Host:'evil.test'}] as Record<string,string>[])
    assert.equal((await call(port,'POST',`/api/learning/${route}`,{body:on,headers})).status,403,`${route} ${JSON.stringify(headers)}`);
  assert.equal(store.db.prepare('SELECT count(*) n FROM learning_events').get()!.n,0);
  const enabled=await call(port,'POST','/api/learning/control',{body:on,headers:same});
  assert.equal(enabled.status,200);assert.equal(enabled.headers['cache-control'],'no-store');assert.equal(enabled.json.status,'on');
  const stale=await call(port,'POST','/api/learning/control',{body:{...on,commandKey:'synthetic-http-pause',action:'pause'},headers:same});
  assert.equal(stale.status,409);assert.equal(stale.json.reload,true);
  let snapshot=(await call(port,'GET','/api/snapshot')).json;const x=snapshot.items[0];
  assert.equal(snapshot.learning.status,'on');assert.equal(snapshot.learning.revision,enabled.json.eventId);
  const secret='synthetic-private-note-text';
  const unknown=await call(port,'POST','/api/learning/interest',{body:{commandKey:'synthetic-http-bad',id:x.id,shownVersion:1,grouping:{mode:'new'},note:secret},headers:same});
  assert.equal(unknown.status,400);assert.equal(JSON.stringify(unknown.json).includes(secret),false);
  const signal=await call(port,'POST','/api/learning/interest',{body:{commandKey:'synthetic-http-signal',id:x.id,shownVersion:1,grouping:{mode:'new'},expectedEntryId:null,expectedControlRevision:enabled.json.eventId,...LOCAL_SCOPE},headers:same});
  assert.equal(signal.status,200);assert.equal(signal.json.outcome,'counted');assert.equal(signal.json.bookmark,true);
  const conflict=await call(port,'POST','/api/learning/interest',{body:{commandKey:'synthetic-http-signal',id:x.id,shownVersion:1,grouping:{mode:'unknown'},expectedEntryId:null,expectedControlRevision:enabled.json.eventId},headers:same});
  assert.equal(conflict.status,400);assert.match(conflict.json.error,/payload conflict/);
  const unversioned=await call(port,'POST','/api/decision',{body:{id:x.id,action:'pass',shownVersion:1,commandKey:'synthetic-http-pass-old',expectedActiveDecisionId:null,reasons:['general'],generalIntent:'generally',targetId:'topic:science',targetScope:'child',note:secret,...LOCAL_SCOPE},headers:same});
  assert.equal(unversioned.status,409);assert.equal(unversioned.json.reload,true);assert.equal(JSON.stringify(unversioned.json).includes(secret),false);
  const versioned=await call(port,'POST','/api/decision',{body:{id:x.id,action:'pass',shownVersion:1,commandKey:'synthetic-http-pass',expectedActiveDecisionId:null,reasons:['general'],generalIntent:'generally',instructionVersion:INSTRUCTION_VERSION,expectedInstructionId:null,targetId:'topic:science',targetScope:'child',note:secret,...LOCAL_SCOPE},headers:same});
  assert.equal(versioned.status,200);assert.ok(versioned.json.instructionId);
  snapshot=(await call(port,'GET','/api/snapshot')).json;
  const science=snapshot.learning.features.find((f:any)=>f.id==='topic:science'),crafts=snapshot.learning.features.find((f:any)=>f.id==='topic:crafts');
  assert.equal(science.resolved,0);assert.equal(science.child.originDecisionId,versioned.json.decisionId);assert.equal(crafts.child,null);
  // A Generally form that reviewed an older child science instruction (none) cannot replace the current one.
  const stalePass=await call(port,'POST','/api/decision',{body:{id:x.id,action:'pass',shownVersion:1,commandKey:'synthetic-http-pass-stale',expectedActiveDecisionId:versioned.json.decisionId,reasons:['general'],generalIntent:'generally',instructionVersion:INSTRUCTION_VERSION,expectedInstructionId:null,targetId:'topic:science',targetScope:'child',...LOCAL_SCOPE},headers:same});
  assert.equal(stalePass.status,409);assert.equal(stalePass.json.reload,true);
  assert.equal(JSON.stringify(snapshot.learning).includes(secret),false);assert.equal(JSON.stringify(snapshot.items[0].learning).includes(secret),false);
  const paused=await call(port,'POST','/api/learning/control',{body:{commandKey:'synthetic-http-pause-2',action:'pause',expectedControlRevision:enabled.json.eventId},headers:same});
  assert.equal(paused.status,200);
  const replace=await call(port,'POST','/api/learning/replace',{body:{commandKey:'synthetic-http-replace',id:x.id,mode:'regroup',targetEntryId:signal.json.eventId,grouping:{mode:'unknown'},expectedControlRevision:paused.json.eventId},headers:same});
  assert.equal(replace.status,409);assert.equal(replace.json.reload,true);
  const undo=await call(port,'POST','/api/learning/undo',{body:{commandKey:'synthetic-http-undo',id:x.id,targetEntryId:signal.json.eventId},headers:same});
  assert.equal(undo.status,200);assert.equal(undo.json.bookmarkUnchanged,true);
  const instruction=await call(port,'POST','/api/learning/instruction',{body:{commandKey:'synthetic-http-set',scope:'household',featureId:'format:concert',action:'set',value:4,expectedInstructionId:null},headers:same});
  assert.equal(instruction.status,200);
  snapshot=(await call(port,'GET','/api/snapshot')).json;
  assert.equal(snapshot.items[0].interested,true);assert.equal(snapshot.items[0].learning.active,null);
  assert.equal(snapshot.learning.features.find((f:any)=>f.id==='format:concert').resolved,4);
  assert.deepEqual(external,[]);assert.equal(logs.some(l=>l.includes(secret)),false);
 }finally{
  globalThis.fetch=originalFetch;console.log=originalLog;console.error=originalError;
  await new Promise(resolve=>server.close(resolve));store.db.close();
 }
});
