import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/store.ts';
import {retrieve,SourceChecker,USER_AGENT,type Fetcher} from '../server/sourceCheck.ts';
import {PARTS} from '../src/domain.ts';
// SYNTHETIC: injected fetch only. No real network request is made by these tests.
const calendar=(uid='x')=>`BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:${uid}\nSUMMARY:Synthetic ${uid}\nDTSTART:20801205T150000Z\nEND:VEVENT\nEND:VCALENDAR`;
function tracked(chunks:string[],{fail=false}:{fail?:boolean}={}){
 const state={cancelled:false,stream:null as unknown as ReadableStream<Uint8Array>};let i=0;
 state.stream=new ReadableStream<Uint8Array>({pull(c){if(i<chunks.length)c.enqueue(new TextEncoder().encode(chunks[i++]));else if(fail)c.error(new Error('synthetic private remote detail'));else c.close();},cancel(){state.cancelled=true;}});
 return state;
}
function spy(respond:(init:RequestInit)=>Promise<Response>|Response){const calls:{url:string;init:RequestInit}[]=[];const fetch:Fetcher=async(url,init)=>{calls.push({url,init});return respond(init);};return {fetch,calls};}
const at=()=>new Date('2080-01-01T00:00:00Z');
test('one ordinary identified GET to the exact allowlisted URL with redirect:error; complete calendar accepted with known transport fields',async()=>{
 const body=calendar();const s=tracked([body]);
 const {fetch,calls}=spy(()=>new Response(s.stream,{status:200,headers:{'content-type':'Text/Calendar; charset=utf-8','content-length':String(Buffer.byteLength(body))}}));
 const r=await retrieve('arts',{fetch,now:at,runtime:'v25.9.0'});
 assert.equal(calls.length,1);assert.equal(calls[0].url,PARTS.arts.url);
 assert.equal(calls[0].init.redirect,'error');assert.equal(calls[0].init.method,'GET');assert.ok(calls[0].init.signal);
 assert.deepEqual(calls[0].init.headers,{Accept:'text/calendar','User-Agent':USER_AGENT});
 assert.equal(r.ok,true);assert.equal(r.ok&&r.body,body);
 assert.deepEqual(r.meta,{method:'ordinary-get',startedAt:'2080-01-01T00:00:00.000Z',completedAt:'2080-01-01T00:00:00.000Z',runtime:'v25.9.0',status:200,contentType:'text/calendar',bytes:Buffer.byteLength(body),advertisedBytes:Buffer.byteLength(body),category:null});
 assert.equal(s.stream.locked,false);
});
test('unknown parts are refused before any request',async()=>{
 const {fetch,calls}=spy(()=>new Response(calendar()));
 await assert.rejects(()=>retrieve('wake' as any,{fetch}),/Unknown source part/);assert.equal(calls.length,0);
});
test('denied, rate-limited and other statuses stop with fixed categories, cancel the unread body and never retry',async()=>{
 for(const [status,category] of [[401,'denied'],[403,'denied'],[429,'rate-limited'],[500,'http-status'],[404,'http-status']] as const){
  const s=tracked(['<html>synthetic challenge page</html>']);const {fetch,calls}=spy(()=>new Response(s.stream,{status,headers:{'content-type':'text/html'}}));
  const r=await retrieve('prcr',{fetch,now:at});
  assert.equal(r.ok,false);assert.equal(r.meta.category,category);assert.equal(r.meta.status,status);assert.equal(r.meta.bytes,null);assert.equal('body' in r,false);
  assert.equal(calls.length,1);assert.equal(s.cancelled,true,String(status));
 }
});
test('redirect or network rejection is transport-error without a fabricated status; exactly one call',async()=>{
 const {fetch,calls}=spy(init=>{assert.equal(init.redirect,'error');throw new TypeError('fetch failed: synthetic private remote detail');});
 const r=await retrieve('prcr',{fetch,now:at});
 assert.equal(r.ok,false);assert.equal(r.meta.category,'transport-error');assert.equal(r.meta.status,null);assert.equal(calls.length,1);
 assert.equal(JSON.stringify(r).includes('synthetic private'),false);
});
test('HTML 200 is not a calendar and its body is not returned; empty 200 calendar is accepted; missing body is categorized',async()=>{
 const html=await retrieve('prcr',{fetch:spy(()=>new Response('<!doctype html><p>Please verify you are human</p>',{status:200,headers:{'content-type':'text/html'}})).fetch,now:at});
 assert.equal(html.ok,false);assert.equal(html.meta.category,'not-calendar');assert.equal(html.meta.contentType,'text/html');assert.equal('body' in html,false);
 const empty=await retrieve('prcr',{fetch:spy(()=>new Response('BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR')).fetch,now:at});
 assert.equal(empty.ok,true);assert.equal(empty.meta.advertisedBytes,null);
 const none=await retrieve('prcr',{fetch:spy(()=>new Response(null,{status:200})).fetch,now:at});
 assert.equal(none.ok,false);assert.equal(none.meta.category,'no-body');
});
test('advertised and streamed size bounds: oversize header stops before reading; false or missing length is caught while streaming',async()=>{
 const big=tracked([calendar()]);
 const advertised=await retrieve('prcr',{fetch:spy(()=>new Response(big.stream,{headers:{'content-length':'3000000'}})).fetch,now:at});
 assert.equal(advertised.meta.category,'too-large');assert.equal(advertised.meta.advertisedBytes,3_000_000);assert.equal(big.cancelled,true);
 const lying=tracked(['BEGIN:VCALENDAR\n'+'x'.repeat(60),'y'.repeat(60),'z'.repeat(60)]);
 const streamed=await retrieve('prcr',{fetch:spy(()=>new Response(lying.stream,{headers:{'content-length':'10'}})).fetch,now:at,maxBytes:100});
 assert.equal(streamed.meta.category,'too-large');assert.equal(streamed.meta.bytes,null);assert.equal(lying.cancelled,true);assert.equal(lying.stream.locked,false);
 const missing=tracked(['BEGIN:VCALENDAR\n'+'x'.repeat(200)]);
 const unbounded=await retrieve('prcr',{fetch:spy(()=>new Response(missing.stream)).fetch,now:at,maxBytes:100});
 assert.equal(unbounded.meta.category,'too-large');assert.equal(unbounded.meta.advertisedBytes,null);assert.equal(missing.stream.locked,false);
});
test('stream failure is stream-error and releases the reader',async()=>{
 const s=tracked(['BEGIN:VCALENDAR\n'],{fail:true});
 const r=await retrieve('prcr',{fetch:spy(()=>new Response(s.stream)).fetch,now:at});
 assert.equal(r.ok,false);assert.equal(r.meta.category,'stream-error');assert.equal(s.stream.locked,false);assert.equal(JSON.stringify(r).includes('synthetic private'),false);
});
test('the request signal times out both headers and body: aborted fetch and a stalled stream are classified timeout',async()=>{
 const waiting=await retrieve('prcr',{fetch:spy(init=>new Promise<Response>((_,reject)=>init.signal!.addEventListener('abort',()=>reject(init.signal!.reason),{once:true}))).fetch,now:at,timeoutMs:20});
 assert.equal(waiting.meta.category,'timeout');assert.equal(waiting.meta.status,null);
 const deaf=await retrieve('prcr',{fetch:spy(()=>new Promise<Response>(()=>{})).fetch,now:at,timeoutMs:20});
 assert.equal(deaf.meta.category,'timeout');
 let cancelled=false;
 const stalled=await retrieve('prcr',{fetch:spy(init=>new Response(new ReadableStream<Uint8Array>({start(c){c.enqueue(new TextEncoder().encode('BEGIN:VCALENDAR\n'));},pull(c){return new Promise<void>(resolve=>init.signal!.addEventListener('abort',()=>{c.error(init.signal!.reason);resolve();},{once:true}));},cancel(){cancelled=true;}}))).fetch,now:at,timeoutMs:20});
 assert.equal(stalled.meta.category,'timeout');assert.equal(stalled.meta.status,200);assert.equal(stalled.meta.bytes,null);
 // A stream that ignores the signal is still released by cancelling the reader on abort.
 const ignoring=await retrieve('prcr',{fetch:spy(()=>new Response(new ReadableStream<Uint8Array>({pull(){return new Promise<void>(()=>{});},cancel(){cancelled=true;}}))).fetch,now:at,timeoutMs:20});
 assert.equal(ignoring.meta.category,'timeout');assert.equal(cancelled,true);
});
// Orchestration over a real in-memory store.
const respond=(byPart:Record<string,()=>Response|Promise<Response>>)=>{const calls:string[]=[];const fetch:Fetcher=async url=>{const part=Object.keys(PARTS).find(p=>PARTS[p as keyof typeof PARTS].url===url)!;calls.push(part);return byPart[part]();};return {fetch,calls};};
test('scan: one request per part; success and denial each persist; lastScan holds fixed categories/counts only; lease released',async()=>{
 const s=new Store(':memory:');const {fetch,calls}=respond({prcr:()=>new Response(calendar('a')),arts:()=>new Response('<html>synthetic private denial text</html>',{status:403})});
 const checker=new SourceChecker(s,{fetch});const r=await checker.scan();
 assert.deepEqual(calls,['prcr','arts']);
 assert.deepEqual(r.results.map(x=>[x.part,x.ok,x.persisted,x.outcome,x.category??null,x.status??null]),[['prcr',true,true,'ok',null,null],['arts',false,true,'failed','denied',403]]);
 assert.equal(JSON.stringify(checker.state()).includes('synthetic private'),false);assert.equal(JSON.stringify(r).includes('BEGIN:VCALENDAR'),false);
 assert.equal(s.db.prepare("SELECT value FROM meta WHERE key='lease'").get()!.value,'0');assert.equal(checker.state().scanning,false);
 const arts=s.snapshot().sources.find(p=>p.id==='arts')!;assert.equal(arts.health,'failed');assert.match(arts.error,/Access denied \(HTTP 403\)/);
 assert.equal(s.db.prepare('SELECT count(*) n FROM observations').get()!.n,1);
});
test('scan: a whole-response parse failure is a failure completion, never a success followed by a failure',async()=>{
 const s=new Store(':memory:');const {fetch}=respond({prcr:()=>new Response('BEGIN:VCALENDAR\nthis line is not calendar syntax\nEND:VCALENDAR'),arts:()=>new Response(calendar('b'))});
 const r=await new SourceChecker(s,{fetch}).scan();
 assert.deepEqual(r.results.map(x=>[x.outcome,x.category??null]),[['failed','parse-error'],['ok',null]]);
 assert.equal(s.db.prepare("SELECT count(*) n FROM source_attempts WHERE part='prcr'").get()!.n,1);assert.equal(s.db.prepare("SELECT count(*) n FROM observations WHERE part='prcr'").get()!.n,0);
});
test('scan: guard rejection is non-persisted superseded; any other completion error is non-persisted internal-error; other part continues',async()=>{
 const s=new Store(':memory:');
 // A newer scan takes over while the first is retrieving: both parts of the old scan are superseded and nothing is written.
 const {fetch}=respond({prcr:()=>{s.db.prepare("UPDATE meta SET value='0' WHERE key='lease'").run();s.beginScan();return new Response(calendar('a'));},arts:()=>new Response('x',{status:500})});
 const r=await new SourceChecker(s,{fetch}).scan();
 assert.deepEqual(r.results.map(x=>[x.part,x.ok,x.persisted,x.outcome]),[['prcr',false,false,'superseded'],['arts',false,false,'superseded']]);
 assert.equal(s.db.prepare('SELECT count(*) n FROM source_attempts').get()!.n,0);assert.equal(s.db.prepare('SELECT count(*) n FROM receipts').get()!.n,0);
 assert.equal(s.snapshot().sources.every(p=>p.health==='never checked'),true);
 // An unrelated SQL failure during a success completion rolls back and is not converted into a failure record.
 const t=new Store(':memory:');t.db.exec("CREATE TRIGGER synthetic_fail BEFORE INSERT ON source_uid_maps WHEN NEW.part='prcr' BEGIN SELECT RAISE(ABORT,'synthetic private sql detail'); END;");
 const second=await new SourceChecker(t,{fetch:respond({prcr:()=>new Response(calendar('a')),arts:()=>new Response(calendar('b'))}).fetch}).scan();
 assert.deepEqual(second.results.map(x=>[x.part,x.persisted,x.outcome]),[['prcr',false,'internal-error'],['arts',true,'ok']]);
 assert.equal(JSON.stringify(second).includes('synthetic private'),false);
 assert.equal(t.db.prepare("SELECT count(*) n FROM source_attempts WHERE part='prcr'").get()!.n,0);assert.equal(t.db.prepare("SELECT count(*) n FROM observations WHERE part='prcr'").get()!.n,0);
 assert.equal(t.snapshot().sources.find(p=>p.id==='prcr')!.health,'never checked');
 assert.equal(t.db.prepare("SELECT value FROM meta WHERE key='lease'").get()!.value,'0');
});
test('scan: a concurrent scan is refused with the fixed busy message',async()=>{
 const s=new Store(':memory:');let release!:()=>void;const gate=new Promise<void>(r=>release=r);
 const checker=new SourceChecker(s,{fetch:respond({prcr:async()=>{await gate;return new Response(calendar('a'));},arts:()=>new Response(calendar('b'))}).fetch});
 const first=checker.scan();await assert.rejects(()=>checker.scan(),/Scan already in progress/);release();assert.equal((await first).results.length,2);
});
