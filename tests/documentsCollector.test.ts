import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DocumentStore,StaleFenceError} from '../server/documents/store.ts';
import {DocumentCollector} from '../server/documents/collector.ts';
import {LIMITS,USER_AGENT,TOWN_HOST,sha256} from '../server/documents/policy.ts';
import {analyzeDocument,PARSER_REVISION} from '../server/documents/layout.ts';
import type {PdfResult} from '../server/documents/pdf.ts';
import {pdf,twoColumnPage} from './helpers/documents.ts';
// SYNTHETIC Town site: injected transport, fake clock and fake extraction; the global fetch is trapped to prove no
// external request. Temporary document databases only.
const T0=Date.parse('2080-01-06T00:00:00Z'),DAY=86_400_000;
const H=`https://${TOWN_HOST}`;
const a=(href:string,text:string)=>`<a href="${href}">${text}</a>`;
const html=(links:string[])=>`<html><head><title>Synthetic</title><script>var t='SENTINELSCRIPT'</script></head><body>${links.join('')}</body></html>`;
const PROGRAMS=html([a('/DocumentCenter/View/101/Fall-Brochure','Fall Brochure'),a('/DocumentCenter/View/102/Athletics-Brochure','Athletics'),
 a('https://ncfuquayvarinaweb.myvscloud.com/webtrac/web/splash.html?ccode=X&amp;_csrf_token=SENTINELTOKEN','Register')]);
const SUMMER=html([a('/DocumentCenter/View/101/Fall-Brochure-Alias','Same brochure, other slug'),a('/DocumentCenter/View/103/Camp-Brochure','Camp')]);
const DANCE=html([a('https://online.flippingbook.com/view/1/','Dance Brochure')]);
const PDFS:Record<string,PdfResult>={'%PDF-1.4 A1':pdf([twoColumnPage(2)]),'%PDF-1.4 B1':pdf([twoColumnPage(5)],6,'pages'),'%PDF-1.4 C1':pdf([twoColumnPage(9)])};
type Route=(init:RequestInit)=>Response|Promise<Response>;
const text=(body:string,type:string,status=200):Route=>()=>new Response(body,{status,headers:{'content-type':type}});
const pdfRoute=(body:string,headers:Record<string,string>={}):Route=>()=>new Response(Buffer.from(body,'latin1'),{headers:{'content-type':'application/pdf',...headers}});
function routes():Record<string,Route>{return {
 [`${H}/robots.txt`]:text('User-agent: *\nDisallow: /Search\nDisallow: /admin\n','text/plain'),
 [`${H}/311/Programs`]:text(PROGRAMS,'text/html; charset=utf-8'),[`${H}/328/Summer-Camp-Programs`]:text(SUMMER,'text/html'),[`${H}/1088/Dance-Class`]:text(DANCE,'text/html'),
 [`${H}/DocumentCenter/View/101/Fall-Brochure`]:init=>(init.headers as any)['If-None-Match']==='"a1"'?new Response(null,{status:304,headers:{etag:'"a1"'}}):pdfRoute('%PDF-1.4 A1',{etag:'"a1"'})(init),
 [`${H}/DocumentCenter/View/102/Athletics-Brochure`]:pdfRoute('%PDF-1.4 B1'),[`${H}/DocumentCenter/View/103/Camp-Brochure`]:pdfRoute('%PDF-1.4 C1'),
};}
function harness(path:string,r:Record<string,Route>,start=T0){
 const state={t:start,calls:[] as {url:string;at:number;headers:any}[],extracts:0};
 const store=new DocumentStore(path,()=>state.t);
 const collector=new DocumentCollector(store,{now:()=>state.t,sleep:async ms=>{state.t+=ms;},log:()=>{},
  fetch:async(url,init)=>{state.calls.push({url,at:state.t,headers:init.headers});const route=r[url];return route?route(init):new Response('',{status:404});},
  extract:async bytes=>{state.extracts++;const s=Buffer.from(bytes).toString('latin1');return PDFS[s]??(s.startsWith('%PDF-1.4 D')?pdf([twoColumnPage(1)]):{ok:false,category:'malformed'});}});
 return {state,store,collector};
}
function temp(){const dir=mkdtempSync(join(tmpdir(),'documents-collector-'));return {dir,path:join(dir,'documents.sqlite'),done:()=>rmSync(dir,{recursive:true,force:true})};}
async function noExternal(fn:()=>Promise<void>){
 const external:string[]=[],original=globalThis.fetch;
 globalThis.fetch=(async(u:any)=>{external.push(String(u));throw Error('no network');}) as typeof fetch;
 try{await fn();}finally{globalThis.fetch=original;}
 assert.deepEqual(external,[]);
}
test('robots first, fixed seeds, one request per canonical document, persisted 5 s pacing, link provenance and sanitized storage',()=>noExternal(async()=>{
 const {dir,path,done}=temp();
 try{
  const h=harness(path,routes());
  const report=await h.collector.runIfDue('startup');
  assert.deepEqual(h.state.calls.map(c=>c.url.slice(H.length)),['/robots.txt','/311/Programs','/328/Summer-Camp-Programs','/1088/Dance-Class',
   '/DocumentCenter/View/101/Fall-Brochure','/DocumentCenter/View/102/Athletics-Brochure','/DocumentCenter/View/103/Camp-Brochure']);
  for(let i=1;i<h.state.calls.length;i++)assert.ok(h.state.calls[i].at-h.state.calls[i-1].at>=LIMITS.requestGapMs);
  for(const c of h.state.calls){assert.equal(new URL(c.url).hostname,TOWN_HOST);assert.equal(c.headers['User-Agent'],USER_AGENT);assert.equal(c.headers.Cookie,undefined);}
  assert.equal(report.outcome,'partial');assert.equal(report.stoppedBy,null);assert.equal(report.coverage.fullCoverageClaim,false);
  assert.deepEqual(report.coverage.seedsWithExcludedBrochures,['seed:dance']);
  assert.deepEqual(report.documents.map((d:any)=>[d.docId,d.outcome,d.parseStatus]),[[101,'new-version','ok'],[102,'new-version','partial'],[103,'new-version','ok']]);
  const status=h.store.status();
  const doc101=status.sources.find((s:any)=>s.docId===101);
  assert.deepEqual(doc101.links.map((l:any)=>[l.seed,l.url.slice(H.length)]),[['seed:programs','/DocumentCenter/View/101/Fall-Brochure'],['seed:summer-camps','/DocumentCenter/View/101/Fall-Brochure-Alias']]);
  assert.equal(doc101.currentlyLinked,true);assert.equal(doc101.display,'last-good');
  assert.equal(status.sources.find((s:any)=>s.docId===102).display,'latest-partial');
  assert.deepEqual(status.sources.find((s:any)=>s.key==='seed:dance').inventory.excludedBrochureLinks,[{reason:'off-host',host:'online.flippingbook.com',path:null,text:'Dance Brochure'}]);
  const list=h.store.listCandidates();assert.equal(list.total,12);assert.equal(list.limits.bookable,false);
  assert.ok(list.candidates.some((c:any)=>c.docId===102&&c.parse.status==='partial'&&!c.parse.lastGood));
  h.store.close();
  for(const f of readdirSync(dir)){assert.match(f,/^documents\.sqlite/);const bytes=readFileSync(join(dir,f)).toString('latin1');for(const s of ['SENTINELTOKEN','SENTINELSCRIPT','_csrf_token','myvscloud'])assert.equal(bytes.includes(s),false,`${f}:${s}`);}
 }finally{done();}
}));
test('restarts and a concurrent process cannot fetch inside the due window; unchanged/304 bytes are verified without re-extraction',()=>noExternal(async()=>{
 const {path,done}=temp();
 try{
  let h=harness(path,routes());await h.collector.runIfDue('startup');h.store.close();
  for(const offset of [3_600_000,7_200_000]){
   h=harness(path,routes(),T0+offset);
   assert.equal((await h.collector.runIfDue('startup')).reason,'not-due');assert.equal(h.state.calls.length,0);h.store.close();
  }
  const one=harness(path,routes(),T0+DAY+60_000),two=harness(path,routes(),T0+DAY+60_000);
  const [ra,rb]=await Promise.all([one.collector.runIfDue('timer'),two.collector.runIfDue('cli')]);
  assert.equal(ra.admitted,true);assert.deepEqual(rb,{admitted:false,reason:'busy'});assert.equal(two.state.calls.length,0);
  assert.equal(one.state.calls.length,4);assert.equal(ra.notDue,3);assert.deepEqual(ra.seeds.map((s:any)=>s.outcome),['unchanged','unchanged','unchanged']);
  one.store.close();two.store.close();
  h=harness(path,routes(),T0+8*DAY);
  const before=h.store.sourceDetail(101)!.source.latestDownload;
  const week=await h.collector.runIfDue('timer');
  assert.deepEqual(week.documents.map((d:any)=>[d.docId,d.outcome]),[[101,'not-modified'],[102,'unchanged'],[103,'unchanged']]);
  assert.equal(h.state.extracts,0);
  assert.equal(h.state.calls.find(c=>c.url.endsWith('/101/Fall-Brochure'))!.headers['If-None-Match'],'"a1"');
  assert.equal(h.state.calls.find(c=>c.url.endsWith('/102/Athletics-Brochure'))!.headers['If-None-Match'],undefined);
  const after=h.store.sourceDetail(101)!.source.latestDownload;
  assert.equal(after.acquiredAt,before.acquiredAt);assert.ok(Date.parse(after.verifiedAt)>Date.parse(before.verifiedAt));assert.equal(after.versionId,before.versionId);
  h.store.close();
 }finally{done();}
}));
test('sticky stops: denial, challenge-like HTML for a PDF and robots prohibitions block the Town lane across restart',()=>noExternal(async()=>{
 const scenarios:[string,(r:Record<string,Route>)=>void,string,string[]][]=[
  ['seed 403',r=>{r[`${H}/311/Programs`]=text('SENTINEL','text/html',403);},'denied',['/robots.txt','/311/Programs']],
  ['html instead of pdf',r=>{r[`${H}/DocumentCenter/View/101/Fall-Brochure`]=text('<html>SENTINEL</html>','text/html');},'html-instead-of-pdf',['/robots.txt','/311/Programs','/328/Summer-Camp-Programs','/1088/Dance-Class','/DocumentCenter/View/101/Fall-Brochure']],
  ['robots disallows documents',r=>{r[`${H}/robots.txt`]=text('User-agent: *\nDisallow: /DocumentCenter/','text/plain');},'robots-disallow',['/robots.txt','/311/Programs','/328/Summer-Camp-Programs','/1088/Dance-Class']],
  ['robots disallows a seed',r=>{r[`${H}/robots.txt`]=text('User-agent: *\nDisallow: /311/','text/plain');},'robots-disallow',['/robots.txt']],
  ['robots 404',r=>{r[`${H}/robots.txt`]=text('','text/html',404);},'robots-unavailable',['/robots.txt']],
  ['robots unsupported',r=>{r[`${H}/robots.txt`]=text('User-agent: *\nCrawl-delay: 99','text/plain');},'robots-unsupported',['/robots.txt']],
 ];
 for(const [name,change,category,urls] of scenarios){
  const {path,done}=temp();
  try{
   const r=routes();change(r);
   let h=harness(path,r);const report=await h.collector.runIfDue('startup');
   assert.equal(report.stoppedBy,category,name);assert.equal(report.outcome,'stopped',name);
   assert.deepEqual(h.state.calls.map(c=>c.url.slice(H.length)),urls,name);h.store.close();
   h=harness(path,routes(),T0+30*DAY);
   assert.deepEqual(await h.collector.runIfDue('cli'),{admitted:false,reason:'blocked',category},name);assert.equal(h.state.calls.length,0,name);
   assert.equal(h.store.status().lane.state,'blocked');h.store.close();
  }finally{done();}
 }
}));
test('transient robots failure aborts without inferring permission; 429 backs off at least 24 h; robots crawl delay paces requests',()=>noExternal(async()=>{
 let r=routes();r[`${H}/robots.txt`]=text('','text/plain',503);
 let h=harness(':memory:',r);let report=await h.collector.runIfDue('startup');
 assert.equal(report.stoppedBy,'server-error');assert.equal(h.state.calls.length,1);assert.equal(h.store.status().lane.state,'idle');
 h.state.t=T0+DAY;r[`${H}/robots.txt`]=routes()[`${H}/robots.txt`];
 report=await h.collector.runIfDue('timer');assert.equal(report.admitted,true);assert.ok(h.state.calls.length>1);h.store.close();
 r=routes();r[`${H}/328/Summer-Camp-Programs`]=()=>new Response('',{status:429,headers:{'retry-after':'60'}});
 h=harness(':memory:',r);report=await h.collector.runIfDue('startup');
 assert.equal(report.stoppedBy,'rate-limited');assert.deepEqual(h.state.calls.map(c=>c.url.slice(H.length)),['/robots.txt','/311/Programs','/328/Summer-Camp-Programs']);
 // The 429 arrived ~10 s after admission; its 24 h backoff outlasts the 24 h due window.
 h.state.t=T0+DAY+5_000;assert.equal((await h.collector.runIfDue('timer')).reason,'rate-limit-backoff');
 h.state.t=T0+DAY+3_600_000;assert.equal((await h.collector.runIfDue('timer')).admitted,true);h.store.close();
 r=routes();r[`${H}/robots.txt`]=text('User-agent: *\nCrawl-delay: 10\nDisallow: /admin','text/plain');
 h=harness(':memory:',r);await h.collector.runIfDue('startup');
 for(let i=2;i<h.state.calls.length;i++)assert.ok(h.state.calls[i].at-h.state.calls[i-1].at>=10_000);
 h.store.close();
}));
test('changed bytes with a failed parse keep last-good candidates; an unrequested 304 fails safely; partial first parse stays visible',()=>noExternal(async()=>{
 const r=routes();const h=harness(':memory:',r);await h.collector.runIfDue('startup');
 const v1=h.store.listCandidates({doc:101}).candidates.map((c:any)=>c.id);
 r[`${H}/DocumentCenter/View/101/Fall-Brochure`]=pdfRoute('%PDF-1.4 A2-unreadable');
 r[`${H}/DocumentCenter/View/103/Camp-Brochure`]=()=>new Response(null,{status:304});
 h.state.t=T0+8*DAY;const report=await h.collector.runIfDue('timer');
 assert.deepEqual(report.documents.map((d:any)=>[d.docId,d.outcome,d.parseStatus??d.category]),[[101,'new-version','failed'],[102,'unchanged',undefined],[103,'failed','unexpected-not-modified']]);
 assert.equal(h.state.calls.find(c=>c.url.endsWith('/103/Camp-Brochure')&&c.at>=T0+8*DAY)!.headers['If-None-Match'],undefined);
 const src=h.store.sourceDetail(101)!.source;
 assert.equal(src.latestParse.status,'failed');assert.equal(src.latestParse.errorCategory,'malformed');assert.equal(src.lastGoodParse.status,'ok');assert.equal(src.display,'last-good');
 assert.equal(src.latestDownload.rawSha256,sha256(Buffer.from('%PDF-1.4 A2-unreadable','latin1')));
 const shown=h.store.listCandidates({doc:101});assert.deepEqual(shown.candidates.map((c:any)=>c.id),v1);assert.ok(shown.candidates.every((c:any)=>c.parse.lastGood));
 assert.equal(h.store.listCandidates({doc:101,view:'latest'}).total,0);
 const c103=h.store.sourceDetail(103)!.source;assert.equal(c103.currentFailure,'Unrequested not-modified response; nothing changed.');assert.equal(h.store.listCandidates({doc:103}).total,4);
 assert.equal(h.store.listCandidates({doc:102}).candidates[0].parse.status,'partial');
 h.store.close();
}));
test('run caps defer documents to the next run; disappearance and zero-link seeds remove or cancel nothing',()=>noExternal(async()=>{
 const r=routes();const ids=[201,202,203,204,205,206,207,208];
 r[`${H}/311/Programs`]=text(html(ids.map(i=>a(`/DocumentCenter/View/${i}/Doc-${i}`,`Doc ${i}`))),'text/html');
 r[`${H}/328/Summer-Camp-Programs`]=text(html([]),'text/html');
 for(const i of ids)r[`${H}/DocumentCenter/View/${i}/Doc-${i}`]=pdfRoute(`%PDF-1.4 D${i}`);
 const h=harness(':memory:',r);
 const first=await h.collector.runIfDue('startup');
 assert.deepEqual(first.documents.map((d:any)=>d.docId),[201,202,203,204,205,206]);
 assert.deepEqual(first.deferred,[{docId:207,reason:'run-pdf-count'},{docId:208,reason:'run-pdf-count'}]);assert.equal(first.outcome,'partial');
 h.state.t=T0+DAY;const second=await h.collector.runIfDue('timer');
 assert.deepEqual(second.documents.map((d:any)=>d.docId),[207,208]);assert.equal(second.notDue,6);
 const total=h.store.listCandidates().total;
 r[`${H}/311/Programs`]=text(html([]),'text/html');
 h.state.t=T0+2*DAY;const third=await h.collector.runIfDue('timer');
 assert.deepEqual(third.documents,[]);assert.equal(third.seeds[0].documentLinks,0);
 const docs=h.store.status().sources.filter((s:any)=>s.kind==='document');
 assert.equal(docs.length,8);assert.ok(docs.every((d:any)=>d.currentlyLinked===false&&d.display==='last-good'));
 assert.equal(h.store.listCandidates().total,total);
 h.store.close();
}));
test('a completion after lease expiry is superseded and writes nothing; shutdown cancels an in-flight run',()=>noExternal(async()=>{
 const r=routes();const h=harness(':memory:',r);
 r[`${H}/DocumentCenter/View/101/Fall-Brochure`]=init=>{h.state.t+=LIMITS.leaseMs;return pdfRoute('%PDF-1.4 A1')(init);};
 const report=await h.collector.runIfDue('startup');
 assert.equal(report.outcome,'superseded');
 const doc=h.store.source('doc:101');assert.equal(Number((h.store.db.prepare('SELECT COUNT(*) n FROM attempts WHERE source_id=?').get(doc.id) as any).n),0);
 assert.equal(h.store.status().lastRun!.outcome,'superseded');h.store.close();
 const r2=routes();const g=harness(':memory:',r2);
 r2[`${H}/311/Programs`]=init=>new Promise((_,reject)=>init.signal!.addEventListener('abort',()=>reject(init.signal!.reason)));
 const running=g.collector.runIfDue('startup');
 while(g.state.calls.length<2)await new Promise(res=>setImmediate(res));
 await g.collector.stop();
 const stopped=await running;assert.equal(stopped.stoppedBy,'cancelled');assert.equal(g.state.calls.length,2);
 assert.deepEqual(await g.collector.runIfDue('cli'),{admitted:false,reason:'stopped'});
 g.store.close();
}));
test('local reparse uses retained bytes only and replay is read-only and deterministic',()=>noExternal(async()=>{
 const h=harness(':memory:',routes());await h.collector.runIfDue('startup');
 assert.equal((await h.collector.replay(101)).outcome,'match');
 // A version parsed under an earlier revision is reprocessed with no request, attempt or verification time.
 const src=h.store.source('doc:101'),body=Buffer.from('%PDF-1.4 A1-old','latin1');PDFS['%PDF-1.4 A1-old']=pdf([twoColumnPage(3)]);
 const {fence}=h.store.acquireLocal(h.state.t);
 h.store.complete({fence,sourceId:src.id,url:src.fetch_url,now:h.state.t,meta:null,outcome:'new-version',category:null,
  version:{rawSha256:sha256(body),rawBytes:body.byteLength,body,storedKind:'raw-pdf',contentType:'application/pdf',etag:null,lastModified:null},
  analysis:analyzeDocument(pdf([twoColumnPage(3)]),{key:src.key,documentSha256:sha256(body)},'earlier-revision')});
 h.store.finishRun(fence,{outcome:'test'},h.state.t);
 const attempts=Number((h.store.db.prepare('SELECT COUNT(*) n FROM attempts').get() as any).n),calls=h.state.calls.length;
 assert.equal(h.store.sourceDetail(101)!.source.latestParse.parserRevision,'earlier-revision');
 const result=await h.collector.reparse();
 assert.deepEqual(result.results.find((x:any)=>x.docId===101),{docId:101,outcome:'reparsed',parseStatus:'ok',candidates:4});
 const view=h.store.sourceDetail(101)!.source;assert.equal(view.latestParse.parserRevision,PARSER_REVISION);assert.equal(view.latestParse.kind,'reparse');
 assert.equal(Number((h.store.db.prepare('SELECT COUNT(*) n FROM attempts').get() as any).n),attempts);assert.equal(h.state.calls.length,calls);
 assert.equal((await h.collector.reparse()).results.find((x:any)=>x.docId===101).outcome,'current');
 assert.equal((await h.collector.replay(101)).outcome,'match');
 const busy=h.store.admit(h.state.t+2*DAY,'cli');assert.equal(busy.admitted,true);
 await assert.rejects(h.collector.reparse(),StaleFenceError);
 delete PDFS['%PDF-1.4 A1-old'];h.store.close();
}));
test('SOL-DOC-001: publisher rollback A→B→A records a new attempt, makes the retained version current and the batch continues',()=>noExternal(async()=>{
 const r=routes();const h=harness(':memory:',r);PDFS['%PDF-1.4 A2']=pdf([twoColumnPage(4)]);
 try{
  await h.collector.runIfDue('startup');
  const a1Ids=h.store.listCandidates({doc:101}).candidates.map((c:any)=>c.id),b1Ids=h.store.listCandidates({doc:102}).candidates.map((c:any)=>c.id);
  // Week 2: 101 changes to a good A2; 102's new bytes cannot be extracted, so its partial B1 stays the usable fallback.
  r[`${H}/DocumentCenter/View/101/Fall-Brochure`]=pdfRoute('%PDF-1.4 A2');r[`${H}/DocumentCenter/View/102/Athletics-Brochure`]=pdfRoute('%PDF-1.4 B2-unreadable');
  h.state.t=T0+8*DAY;const week2=await h.collector.runIfDue('timer');
  assert.deepEqual(week2.documents.map((d:any)=>[d.docId,d.outcome,d.parseStatus]),[[101,'new-version','ok'],[102,'new-version','failed'],[103,'unchanged',undefined]]);
  const extracts=h.state.extracts;
  // Week 3: both return to their earlier bytes.
  r[`${H}/DocumentCenter/View/101/Fall-Brochure`]=pdfRoute('%PDF-1.4 A1');r[`${H}/DocumentCenter/View/102/Athletics-Brochure`]=pdfRoute('%PDF-1.4 B1');
  h.state.t=T0+16*DAY;const week3=await h.collector.runIfDue('timer');
  assert.deepEqual(week3.documents.map((d:any)=>[d.docId,d.outcome]),[[101,'retained-version'],[102,'retained-version'],[103,'unchanged']]);
  assert.notEqual(week3.outcome,'internal-error');assert.equal(h.state.extracts,extracts);
  const s101=h.store.sourceDetail(101)!;
  assert.equal(s101.source.latestDownload.rawSha256,sha256(Buffer.from('%PDF-1.4 A1','latin1')));assert.equal(s101.source.display,'last-good');assert.equal(s101.source.current.shownIsLatest,true);
  assert.deepEqual(s101.attempts.map((a:any)=>a.outcome),['retained-version','new-version','new-version']);
  assert.deepEqual(h.store.listCandidates({doc:101}).candidates.map((c:any)=>c.id),a1Ids);
  const s102=h.store.sourceDetail(102)!;
  assert.equal(s102.source.display,'latest-partial');assert.equal(s102.source.latestParse.status,'partial');
  assert.deepEqual(h.store.listCandidates({doc:102}).candidates.map((c:any)=>c.id),b1Ids);
  assert.equal((await h.collector.replay(101)).outcome,'match');assert.equal((await h.collector.replay(102)).outcome,'match');
 }finally{delete PDFS['%PDF-1.4 A2'];h.store.close();}
}));
test('SOL-DOC-004: seed inventory overflow is explicit and partial; duplicates and aliases do not count; the six-PDF run cap stays separate',()=>noExternal(async()=>{
 const r=routes();const ids=Array.from({length:205},(_,i)=>1000+i);
 const anchors=[...ids.map(i=>a(`/DocumentCenter/View/${i}/Doc`,`Doc ${i}`)),...ids.slice(0,20).map(i=>a(`/DocumentCenter/View/${i}/Doc`,'repeat'))];
 r[`${H}/311/Programs`]=text(html(anchors),'text/html');r[`${H}/328/Summer-Camp-Programs`]=text(html([]),'text/html');
 for(const i of ids)r[`${H}/DocumentCenter/View/${i}/Doc`]=pdfRoute(`%PDF-1.4 D${i}`);
 const h=harness(':memory:',r);
 const report=await h.collector.runIfDue('startup');
 const programs=report.seeds[0];
 assert.deepEqual([programs.documentLinks,programs.inventoryTruncated,programs.truncatedReasons,programs.documentLinksOmitted,programs.documentIdsOmitted],[200,true,['document-link-cap'],5,5]);
 assert.deepEqual(report.coverage.inventoryTruncatedSeeds,['seed:programs']);assert.equal(report.coverage.documentLinksOmitted,5);assert.equal(report.outcome,'partial');
 assert.equal(report.documents.length,6);assert.equal(report.deferred.length,194);assert.ok(report.deferred.every((d:any)=>d.reason==='run-pdf-count'));
 assert.equal(h.state.calls.some(c=>/\/DocumentCenter\/View\/120[0-4]\//.test(c.url)),false);
 const inv=h.store.status().sources.find((s:any)=>s.key==='seed:programs').inventory;
 assert.deepEqual([inv.truncated,inv.truncatedReasons,inv.documentLinksOmitted,inv.documentIdsOmitted],[true,['document-link-cap'],5,5]);
 assert.equal(h.store.status().lastRun!.report.coverage.documentIdsOmitted,5);
 h.store.close();
}));
test('the collector touches only its own database file',()=>noExternal(async()=>{
 const {dir,path,done}=temp();
 try{const h=harness(path,routes());await h.collector.runIfDue('startup');h.store.close();
  assert.ok(readdirSync(dir).every(f=>f.startsWith('documents.sqlite')));assert.equal(existsSync(join(dir,'preview.sqlite')),false);}
 finally{done();}
}));
