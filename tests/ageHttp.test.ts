import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {execFileSync} from 'node:child_process';
import {Store} from '../server/store.ts';
import {createHandler} from '../server/app.ts';
// SYNTHETIC: loopback-only route checks with an in-memory store and invented profile values.
function call(port:number,method:string,path:string,{body,headers={}}:{body?:any;headers?:Record<string,string>}={}){
 return new Promise<{status:number;headers:any;json:any}>((resolve,reject)=>{
  const req=request({host:'127.0.0.1',port,method,path,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers}},res=>{let raw='';res.on('data',c=>raw+=c);res.on('end',()=>resolve({status:res.statusCode!,headers:res.headers,json:raw?JSON.parse(raw):null}));});
  req.on('error',reject);if(body!==undefined)req.write(JSON.stringify(body));req.end();
 });
}
test('profile and age routes keep loopback/same-origin/JSON guards, no-store responses, explicit 409 reloads, redacted errors and no external calls',async()=>{
 const store=new Store(':memory:',()=>new Date('2079-01-01T15:00:00Z'));
 const external:string[]=[],logs:string[]=[];const originalFetch=globalThis.fetch,originalLog=console.log,originalError=console.error;
 globalThis.fetch=(async(input:any)=>{external.push(String(input));throw Error('External network is not allowed in this test.');}) as typeof fetch;
 console.log=(...a:any[])=>{logs.push(a.join(' '));};console.error=(...a:any[])=>{logs.push(a.join(' '));};
 let port=0;
 const server=createServer(createHandler({store,port:()=>port,scan:async()=>{throw Error('Scanning is disabled in this test.');},scanState:()=>({scanning:false,lastScan:null}),fallback:(_req,res)=>{res.writeHead(404);res.end();}}));
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',()=>resolve()));port=(server.address() as any).port;
 try{
  const origin=`http://127.0.0.1:${port}`,same={Origin:origin};
  const view=await call(port,'GET','/api/profile');
  assert.equal(view.status,200);assert.equal(view.headers['cache-control'],'no-store');assert.deepEqual(view.json.current.input,{kind:'unknown'});
  const command=(profile:any,expectedRevisionId=view.json.current.revisionId,commandKey='synthetic-http-1')=>({commandKey,expectedRevisionId,profile});
  const secret={kind:'birth-date',birthDate:'2072-02-29'};
  for(const [headers,status] of [[{},403],[{Origin:'http://evil.test'},403],[{Origin:origin,'Sec-Fetch-Site':'cross-site'},403],[{Origin:origin,'Content-Type':'text/plain'},403],[{Origin:origin,Host:'evil.test'},403]] as [Record<string,string>,number][]){
   const r=await call(port,'POST','/api/profile',{body:command(secret),headers});assert.equal(r.status,status,JSON.stringify(headers));
  }
  assert.equal((await call(port,'GET','/api/profile',{headers:{Origin:'http://evil.test'}})).status,403);
  assert.equal(store.profileView().revisions,1);
  const invalid=await call(port,'POST','/api/profile',{body:command({kind:'birth-date',birthDate:'2079-01-02'}),headers:same});
  assert.equal(invalid.status,400);assert.equal(invalid.json.field,'birthDate');assert.equal(invalid.headers['cache-control'],'no-store');
  const saved=await call(port,'POST','/api/profile',{body:command(secret),headers:same});
  assert.equal(saved.status,200);assert.equal(saved.json.unchanged,false);assert.equal(JSON.stringify(saved.json).includes('2072-02-29'),false);
  const stale=await call(port,'POST','/api/profile',{body:command({kind:'unknown'},view.json.current.revisionId,'synthetic-http-2'),headers:same});
  assert.equal(stale.status,409);assert.equal(stale.json.reload,true);assert.equal(JSON.stringify(stale.json).includes('2072-02-29'),false);
  const conflict=await call(port,'POST','/api/profile',{body:command({kind:'unknown'}),headers:same});
  assert.equal(conflict.status,409);
  const snapshot=await call(port,'GET','/api/snapshot');
  assert.equal(snapshot.status,200);assert.equal(snapshot.headers['cache-control'],'no-store');assert.equal(snapshot.json.ageProfile.revisionId,saved.json.revisionId);
  assert.equal(JSON.stringify(snapshot.json).includes('2072-02-29'),false);
  const legacy=await call(port,'POST','/api/profile/legacy',{body:{commandKey:'synthetic-http-3',action:'discard',expectedRevisionId:saved.json.revisionId},headers:same});
  assert.equal(legacy.status,409);assert.match(legacy.json.error,/No pending/);
  const override=await call(port,'POST','/api/age-override',{body:{id:'missing',action:'show',shownVersion:1,commandKey:'synthetic-http-4',basisSignature:'x'},headers:same});
  assert.equal(override.status,400);assert.equal((await call(port,'POST','/api/age-override',{body:{},headers:{}})).status,403);
  assert.deepEqual(external,[]);assert.equal(logs.some(l=>l.includes('2072-02-29')),false);
 }finally{
  globalThis.fetch=originalFetch;console.log=originalLog;console.error=originalError;
  await new Promise(resolve=>server.close(resolve));store.db.close();
 }
});
test('private runtime files stay outside public artifacts: database, WAL and SHM paths are ignored and none are tracked',t=>{
 const root=new URL('..',import.meta.url).pathname;
 let tracked:string;
 try{tracked=execFileSync('git',['ls-files'],{cwd:root,encoding:'utf8'});}catch{t.skip('git is unavailable in this environment');return;}
 assert.equal(tracked.split('\n').some(f=>/\.(sqlite|db)(-wal|-shm|-journal)?$|^data\//.test(f)),false);
 const ignored=execFileSync('git',['check-ignore','data/preview.sqlite','data/preview.sqlite-wal','data/preview.sqlite-shm','scratch/synthetic.sqlite-wal'],{cwd:root,encoding:'utf8'}).trim().split('\n');
 assert.equal(ignored.length,4);
});
