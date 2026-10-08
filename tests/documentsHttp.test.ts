import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request,type Server} from 'node:http';
import {Store} from '../server/store.ts';
import {createHandler} from '../server/app.ts';
import {DocumentStore} from '../server/documents/store.ts';
import {analyzeDocument} from '../server/documents/layout.ts';
import {sha256} from '../server/documents/policy.ts';
import {block,page,pdf,twoColumnPage} from './helpers/documents.ts';
// SYNTHETIC loopback routes over a temporary document database; the global fetch is trapped to prove GETs never fetch.
const T0=Date.parse('2080-01-06T00:00:00Z');
function call(port:number,method:string,path:string,headers:Record<string,string>={}){
 return new Promise<{status:number;json:any;raw:string;type:string|undefined;nosniff:string|undefined}>((resolve,reject)=>{
  const req=request({host:'127.0.0.1',port,method,path,headers:{...(method==='POST'?{'Content-Type':'application/json'}:{}),...headers}},res=>{let raw='';res.on('data',c=>raw+=c);res.on('end',()=>resolve({status:res.statusCode!,json:raw?JSON.parse(raw):null,raw,type:res.headers['content-type'],nosniff:res.headers['x-content-type-options'] as string|undefined}));});
  req.on('error',reject);if(method==='POST')req.write('{}');req.end();});
}
async function serve(store:Store,documents:DocumentStore|null,run:(port:number)=>Promise<void>){
 let port=0;const server:Server=createServer(createHandler({store,documents,port:()=>port,scan:async()=>{throw Error('no scan');},scanState:()=>({scanning:false,lastScan:null}),fallback:(_q,res)=>{res.writeHead(404);res.end();}}));
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',()=>r()));port=(server.address() as any).port;
 try{await run(port);}finally{await new Promise(r=>server.close(r));}
}
const HOSTILE='</script><img src=x onerror=alert(1)>{{constructor}}';
function seeded(){
 const docs=new DocumentStore(':memory:',()=>T0);
 docs.db.prepare("INSERT INTO sources(key,kind,doc_id,fetch_url,first_seen_at) VALUES ('doc:7','document',7,'https://www.fuquay-varina.org/DocumentCenter/View/7/x',?)").run(new Date(T0).toISOString());
 const src=docs.source('doc:7'),body=Buffer.from('%PDF-1.4 synthetic'),fence=(docs.admit(T0,'cli') as any).fence;
 const hostile=block({x:82,top:300,heading:[HOSTILE],code:'EDU0901',ages:'Ages 9-12',desc:['"quoted" & <b>bold</b>'],groups:[{dayTime:'Fridays',dates:['Dec. 4'],location:['Hall']}],instructor:'X',fee:'$0'});
 const a=analyzeDocument(pdf([twoColumnPage(1),twoColumnPage(2),page(3,hostile)]),{key:src.key,documentSha256:sha256(body)});
 docs.complete({fence,sourceId:src.id,url:src.fetch_url,now:T0+1,meta:null,outcome:'new-version',category:null,analysis:a,
  version:{rawSha256:sha256(body),rawBytes:body.byteLength,body,storedKind:'raw-pdf',contentType:'application/pdf',etag:null,lastModified:null}});
 docs.finishRun(fence,{outcome:'complete'},T0+2);
 return docs;
}
test('GET /api/documents: bounded pages, filters, detail with block evidence; GET never fetches or changes the schedule',async()=>{
 const external:string[]=[];const original=globalThis.fetch;globalThis.fetch=(async(u:any)=>{external.push(String(u));throw Error('no network');}) as typeof fetch;
 const store=new Store(':memory:'),docs=seeded();const lane=JSON.stringify(docs.db.prepare('SELECT * FROM lane').get());
 try{
  await serve(store,docs,async port=>{
   const first=await call(port,'GET','/api/documents?limit=3');
   assert.equal(first.status,200);assert.equal(first.json.total,9);assert.equal(first.json.candidates.length,3);assert.equal(first.json.nextCursor,'3');
   assert.equal(first.json.limits.bookable,false);assert.equal(first.json.limits.availability,'unknown');assert.equal(first.json.limits.coverage,'incomplete');
   const c=first.json.candidates[0];
   assert.deepEqual(Object.keys(c).sort(),['acquiredAt','ages','bbox','blockSha256','codeNormalized','codeRaw','column','current','docId','documentSha256','duplicateCodeCount','evidenceText','fee','heading','id','instructor','page','parse','scheduleGroups','warnings']);
   assert.deepEqual([c.current.display,c.current.shownIsLatest,c.current.latestParseStatus,c.current.currentFailure],['last-good',true,'ok',null]);
   assert.ok(c.evidenceText.includes(c.codeRaw));
   const last=await call(port,'GET','/api/documents?limit=3&cursor=6');assert.equal(last.json.nextCursor,null);assert.equal(last.json.candidates.length,3);
   assert.equal((await call(port,'GET','/api/documents?code=fit0941')).json.total,2);
   assert.equal((await call(port,'GET','/api/documents?q=tumble')).json.total,2);
   assert.equal((await call(port,'GET','/api/documents?q=100%25')).json.total,0);
   assert.equal((await call(port,'GET','/api/documents?doc=7&view=latest')).json.total,9);
   const detail=await call(port,'GET',`/api/documents/candidates/${c.id}`);
   assert.equal(detail.status,200);assert.equal(detail.json.candidate.text.split('\n')[0],c.heading);
   assert.ok(detail.json.candidate.lines.every((l:any)=>typeof l.text==='string'&&Number.isFinite(l.y)));
   assert.equal(detail.json.version.rawSha256,c.documentSha256);assert.equal(detail.json.parse.isLastGood,true);
   const source=await call(port,'GET','/api/documents/sources/7');
   assert.equal(source.status,200);assert.equal(source.json.attempts.length,1);assert.equal(source.json.versions[0].retained,true);
   assert.equal((await call(port,'GET','/api/documents/status')).json.lane.state,'idle');
   for(const raw of [first.raw,detail.raw,source.raw])for(const s of ['/data/','documents.sqlite','%PDF','Error'])assert.equal(raw.includes(s),false,s);
  });
  assert.deepEqual(external,[]);assert.equal(JSON.stringify(docs.db.prepare('SELECT * FROM lane').get()),lane);
 }finally{globalThis.fetch=original;docs.close();store.db.close();}
});
test('hostile source text is returned as inert JSON; invalid queries get fixed 400s; unknown IDs 404',async()=>{
 const store=new Store(':memory:'),docs=seeded();
 try{
  await serve(store,docs,async port=>{
   const r=await call(port,'GET','/api/documents?code=EDU0901');
   assert.equal(r.type,'application/json');assert.equal(r.nosniff,'nosniff');assert.equal(r.json.candidates[0].heading,HOSTILE);
   assert.equal(r.json.candidates[0].scheduleGroups[0].dates[0],'Dec. 4');
   for(const [q,error] of [['limit=0','Limit must be 1 to 100.'],['limit=101','Limit must be 1 to 100.'],['cursor=-1','Invalid cursor.'],['view=raw','View must be display or latest.'],
    ['code=SELECT','Code must be letters followed by digits.'],['doc=1%20OR%201','Document ID must be numeric.'],[`q=${'x'.repeat(101)}`,'Search text is limited to 100 characters.']]){
    const bad=await call(port,'GET',`/api/documents?${q}`);assert.equal(bad.status,400,q);assert.deepEqual(bad.json,{error},q);
   }
   for(const path of ['/api/documents/candidates/dc_'+'0'.repeat(32),'/api/documents/candidates/..%2F..%2Fetc','/api/documents/sources/999','/api/documents/sources/abc'])assert.equal((await call(port,'GET',path)).status,404,path);
   assert.equal((await call(port,'GET','/api/documents/other')).status,404);
  });
 }finally{docs.close();store.db.close();}
});
test('existing loopback, Host, cross-site and mutation guards apply to every document route; absent store is 503',async()=>{
 const store=new Store(':memory:'),docs=seeded();
 try{
  await serve(store,docs,async port=>{
   assert.equal((await call(port,'GET','/api/documents',{Host:'evil.example'})).status,403);
   assert.equal((await call(port,'GET','/api/documents',{Origin:'https://evil.example'})).status,403);
   assert.equal((await call(port,'GET','/api/documents/status',{'Sec-Fetch-Site':'cross-site'})).status,403);
   assert.equal((await call(port,'POST','/api/documents')).status,403);
   const post=await call(port,'POST','/api/documents',{Origin:`http://127.0.0.1:${port}`});assert.equal(post.status,405);
   assert.equal((await call(port,'POST','/api/documents/run',{Origin:`http://127.0.0.1:${port}`})).status,405);
  });
  await serve(store,null,async port=>{const r=await call(port,'GET','/api/documents');assert.equal(r.status,503);assert.deepEqual(r.json,{error:'Document evidence is unavailable.'});});
 }finally{docs.close();store.db.close();}
});
