import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request,type Server} from 'node:http';
import {Store,ScanBusyError} from '../server/store.ts';
import {createHandler} from '../server/app.ts';
import {SourceChecker,type Fetcher} from '../server/sourceCheck.ts';
import {PARTS} from '../src/domain.ts';
// SYNTHETIC: loopback routes with an injected retriever; the global fetch is trapped to prove no external request.
function call(port:number,method:string,path:string,headers:Record<string,string>={}){
 return new Promise<{status:number;json:any;raw:string}>((resolve,reject)=>{const req=request({host:'127.0.0.1',port,method,path,headers:{...(method==='POST'?{'Content-Type':'application/json'}:{}),...headers}},res=>{let raw='';res.on('data',c=>raw+=c);res.on('end',()=>resolve({status:res.statusCode!,json:raw?JSON.parse(raw):null,raw}));});req.on('error',reject);if(method==='POST')req.write('{}');req.end();});
}
async function serve(store:Store,scan:()=>Promise<any>,state:()=>any,run:(port:number)=>Promise<void>){
 let port=0;const server:Server=createServer(createHandler({store,port:()=>port,scan,scanState:state,fallback:(_q,res)=>{res.writeHead(404);res.end();}}));
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',()=>r()));port=(server.address() as any).port;
 try{await run(port);}finally{await new Promise(r=>server.close(r));}
}
test('POST /api/scan returns fixed categories/counts only; snapshot carries bounded evidence without bodies, maps or remote text',async()=>{
 const external:string[]=[];const original=globalThis.fetch;globalThis.fetch=(async(u:any)=>{external.push(String(u));throw Error('no network');}) as typeof fetch;
 const store=new Store(':memory:');
 const fakeFetch:Fetcher=async url=>url===PARTS.prcr.url?new Response('BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:h1\nSUMMARY:Synthetic\nDTSTART:20801205T150000Z\nEND:VEVENT\nEND:VCALENDAR'):new Response('<html>SENTINEL private challenge</html>',{status:403});
 const checker=new SourceChecker(store,{fetch:fakeFetch});
 try{
  await serve(store,()=>checker.scan(),()=>checker.state(),async port=>{
   const origin={Origin:`http://127.0.0.1:${port}`};
   assert.equal((await call(port,'POST','/api/scan')).status,403);
   const scan=await call(port,'POST','/api/scan',origin);
   assert.equal(scan.status,200);assert.deepEqual(scan.json.results.map((r:any)=>[r.part,r.outcome,r.category??null,r.status??null]),[['prcr','ok',null,null],['arts','failed','denied',403]]);
   assert.equal(scan.raw.includes('SENTINEL'),false);assert.equal(scan.raw.includes('BEGIN:VCALENDAR'),false);
   const snap=await call(port,'GET','/api/snapshot');
   assert.equal(snap.status,200);assert.equal(snap.json.coverage,'unknown');assert.equal(snap.json.sourceEvidence.parts.prcr.latestSuccess.measurement.accepted,1);
   assert.equal(snap.json.sourceEvidence.catalog.label,'Classes and camps are not connected; the complete registration listings are unavailable');
   assert.equal(snap.raw.includes('SENTINEL'),false);assert.equal(snap.raw.includes('BEGIN:VCALENDAR'),false);assert.equal(snap.raw.includes('map_json'),false);
   assert.deepEqual(snap.json.lastScan,scan.json);
  });
  assert.deepEqual(external,[]);
 }finally{globalThis.fetch=original;store.db.close();}
});
test('scan route failures never echo SQL, remote or exception text; the fixed busy message is kept',async()=>{
 const store=new Store(':memory:');
 await serve(store,async()=>{throw Error('SQLITE_CONSTRAINT SENTINEL private detail');},()=>({scanning:false,lastScan:null}),async port=>{
  const r=await call(port,'POST','/api/scan',{Origin:`http://127.0.0.1:${port}`});
  assert.equal(r.status,500);assert.equal(r.raw.includes('SENTINEL'),false);assert.equal(r.json.error,'Source check could not run. Last-known results are retained.');
 });
 await serve(store,async()=>{throw new ScanBusyError('A scan is already in progress.');},()=>({scanning:true,lastScan:null}),async port=>{
  const r=await call(port,'POST','/api/scan',{Origin:`http://127.0.0.1:${port}`});assert.equal(r.status,409);assert.equal(r.json.error,'A scan is already in progress.');
 });
 store.db.close();
});
