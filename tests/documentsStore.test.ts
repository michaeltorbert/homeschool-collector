import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DocumentStore,StaleFenceError,CompletionConflictError,QuotaError,type VersionInput} from '../server/documents/store.ts';
import {LIMITS,sha256} from '../server/documents/policy.ts';
import {analyzeDocument} from '../server/documents/layout.ts';
import {pdf,twoColumnPage,page,it} from './helpers/documents.ts';
// SYNTHETIC temporary document databases only; the family preview database is never opened.
const T0=Date.parse('2080-01-06T00:00:00Z');
function temp(){const dir=mkdtempSync(join(tmpdir(),'documents-store-'));return {path:join(dir,'documents.sqlite'),done:()=>rmSync(dir,{recursive:true,force:true})};}
function addDoc(s:DocumentStore,docId:number){s.db.prepare("INSERT INTO sources(key,kind,doc_id,fetch_url,first_seen_at) VALUES (?,'document',?,?,?)").run(`doc:${docId}`,docId,`https://www.fuquay-varina.org/DocumentCenter/View/${docId}`,new Date(T0).toISOString());return s.source(`doc:${docId}`);}
const version=(text:string,bytes=0):VersionInput=>{const body=Buffer.concat([Buffer.from(`%PDF-1.4 ${text}`),Buffer.alloc(bytes)]);return {rawSha256:sha256(body),rawBytes:body.byteLength,body,storedKind:'raw-pdf',contentType:'application/pdf',etag:null,lastModified:null};};
const analysis=(key:string,v:VersionInput,ok=true)=>analyzeDocument(ok?pdf([twoColumnPage(1)]):pdf([page(1,[it('no codes',82,700)])],1,'pages'),{key,documentSha256:v.rawSha256});
const count=(s:DocumentStore,table:string)=>Number((s.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as any).n);
test('admission is persisted before network: busy, not-due, sticky block and backoff survive close/reopen',()=>{
 const {path,done}=temp();
 try{
  let s=new DocumentStore(path,()=>T0);
  const a=s.admit(T0,'startup');assert.ok(a.admitted);
  assert.deepEqual(s.admit(T0+1000,'cli'),{admitted:false,reason:'busy'});
  s.close();s=new DocumentStore(path,()=>T0);
  // Restart while the lease is held and after it ends: still no new admission inside the due window.
  assert.equal((s.admit(T0+2000,'startup') as any).reason,'busy');
  s.finishRun((a as any).fence,{outcome:'complete'},T0+3000);
  assert.equal((s.admit(T0+4000,'startup') as any).reason,'not-due');s.close();
  s=new DocumentStore(path,()=>T0);assert.equal((s.admit(T0+LIMITS.htmlDueMs-1,'timer') as any).reason,'not-due');
  const b=s.admit(T0+LIMITS.htmlDueMs,'timer');assert.ok(b.admitted);
  s.backoff(T0+3*LIMITS.htmlDueMs);s.finishRun((b as any).fence,{outcome:'stopped'},T0+LIMITS.htmlDueMs+10);
  assert.equal((s.admit(T0+2*LIMITS.htmlDueMs+20,'cli') as any).reason,'rate-limit-backoff');
  s.block('denied',T0);s.block('challenge',T0);s.close();
  s=new DocumentStore(path,()=>T0);
  assert.deepEqual(s.admit(T0+100*LIMITS.htmlDueMs,'cli'),{admitted:false,reason:'blocked',category:'denied'});
  assert.equal(s.status(T0).lane.state,'blocked');assert.equal(s.status(T0).lane.blockedCategory,'denied');
  s.close();
 }finally{done();}
});
test('pacing reservation is persisted per lane and honours a larger robots crawl delay',()=>{
 const s=new DocumentStore(':memory:',()=>T0);
 const {fence}=s.admit(T0,'cli') as any;
 assert.equal(s.reserveRequest(fence,T0),0);assert.equal(s.reserveRequest(fence,T0+1000),4000);assert.equal(s.reserveRequest(fence,T0+5000),0);
 s.setRequestGap(fence,12_000,T0+5000);assert.equal(s.reserveRequest(fence,T0+10_000),7000);
 s.setRequestGap(fence,1000,T0+5000);assert.equal(s.status(T0).lane.requestGapMs,5000);
 assert.throws(()=>s.reserveRequest(fence+1,T0+20_000),StaleFenceError);
 assert.throws(()=>s.reserveRequest(fence,T0+LIMITS.leaseMs+1),StaleFenceError);
 s.close();
});
test('completion: exact replay, conflicting payload, stale fence and expired lease write nothing; evidence rows are immutable',()=>{
 const s=new DocumentStore(':memory:',()=>T0);const doc=addDoc(s,1);
 const {fence}=s.admit(T0,'cli') as any;const v=version('one');
 const input={fence,sourceId:doc.id,url:doc.fetch_url,now:T0+10,meta:null,outcome:'new-version' as const,category:null,version:v,analysis:analysis(doc.key,v)};
 const first=s.complete(input);assert.equal(first.replayed,false);
 const before=['attempts','versions','blobs','parses','candidates'].map(t=>count(s,t));
 assert.deepEqual(s.complete(input),{replayed:true,attemptId:first.attemptId,versionId:first.versionId});
 assert.throws(()=>s.complete({...input,outcome:'failed',category:'timeout',version:undefined,analysis:undefined}),CompletionConflictError);
 const other=addDoc(s,2);
 assert.throws(()=>s.complete({...input,sourceId:other.id,fence:fence+1}),StaleFenceError);
 assert.throws(()=>s.complete({...input,sourceId:other.id,now:T0+LIMITS.leaseMs+1}),StaleFenceError);
 assert.deepEqual(['attempts','versions','blobs','parses','candidates'].map(t=>count(s,t)),before);
 for(const [table,set] of [['attempts','outcome=\'failed\''],['versions','raw_bytes=0'],['blobs','body=x\'00\''],['parses','status=\'ok\''],['candidates','heading=\'x\'']])
  assert.throws(()=>s.db.exec(`UPDATE ${table} SET ${set}`),/immutable/);
 s.close();
});
test('retention keeps the latest two good versions plus current/fallback references, and 100 attempts per source',()=>{
 const s=new DocumentStore(':memory:',()=>T0);const doc=addDoc(s,1);
 let now=T0;const fenceAt=()=>{s.db.exec("UPDATE lane SET lease_until=0,next_run_at=0");return (s.admit(now,'cli') as any).fence;};
 const good=version('good');s.complete({fence:fenceAt(),sourceId:doc.id,url:doc.fetch_url,now:now+1,meta:null,outcome:'new-version',category:null,version:good,analysis:analysis(doc.key,good)});
 for(const n of [1,2,3]){now+=1000;const v=version(`partial-${n}`);s.complete({fence:fenceAt(),sourceId:doc.id,url:doc.fetch_url,now:now+1,meta:null,outcome:'new-version',category:null,version:v,analysis:analysis(doc.key,v,false)});}
 const shas=(s.db.prepare('SELECT raw_sha256 FROM versions ORDER BY id').all() as any[]).map(r=>r.raw_sha256);
 // The good version and the current download are protected; partial versions without fragments are neither good,
 // usable nor current once superseded, so they are pruned with their parses.
 assert.deepEqual(shas,[good.rawSha256,version('partial-3').rawSha256]);
 const view=s.sourceDetail(1)!;assert.equal(view.source.lastGoodParse.status,'ok');assert.equal(view.source.latestParse.status,'partial');
 assert.equal(view.source.display,'last-good');
 for(let i=0;i<105;i++){now+=1000;s.complete({fence:fenceAt(),sourceId:doc.id,url:doc.fetch_url,now:now+1,meta:null,outcome:'failed',category:'timeout'});}
 assert.equal(Number((s.db.prepare('SELECT COUNT(*) n FROM attempts WHERE source_id=?').get(doc.id) as any).n),100);
 assert.equal(s.sourceDetail(1)!.source.lastGoodParse.status,'ok');
 s.close();
});
test('quota prunes only unprotected evidence and otherwise fails atomically',()=>{
 const saved=LIMITS.totalBlobBytes;
 const s=new DocumentStore(':memory:',()=>T0);
 try{
  const a=addDoc(s,1),b=addDoc(s,2);
  let now=T0;const fenceAt=()=>{s.db.exec("UPDATE lane SET lease_until=0,next_run_at=0");return (s.admit(now,'cli') as any).fence;};
  const put=(src:any,v:VersionInput,ok=true)=>s.complete({fence:fenceAt(),sourceId:src.id,url:src.fetch_url,now:(now+=1000),meta:null,outcome:'new-version',category:null,version:v,analysis:analysis(src.key,v,ok)});
  const a1=version('a1',1000),a2=version('a2',1000),b1=version('b1',1000);
  put(a,a1,false);put(a,a2);put(b,b1);
  LIMITS.totalBlobBytes=a2.rawBytes+b1.rawBytes+150;
  // a1 (partial, no fragments) was already pruned by count retention; b1 stays protected as one of b's two good versions.
  const b2=version('b2',100);put(b,b2);
  assert.ok(s.db.prepare('SELECT 1 FROM versions WHERE raw_sha256=?').get(b1.rawSha256));
  assert.equal(s.db.prepare('SELECT 1 FROM versions WHERE raw_sha256=?').get(a1.rawSha256),undefined);
  const before=['attempts','versions','blobs','parses','candidates'].map(t=>count(s,t));
  // Everything left is protected (latest/last-good pointers): the new version is refused and nothing changes.
  assert.throws(()=>put(a,version('a3',5000)),QuotaError);
  assert.deepEqual(['attempts','versions','blobs','parses','candidates'].map(t=>count(s,t)),before);
  assert.equal(s.latestVersion(a.id).raw_sha256,a2.rawSha256);
 }finally{LIMITS.totalBlobBytes=saved;s.close();}
});
// Builds parses of a chosen outcome for one source and completes them in fresh fences.
function sequence(s:DocumentStore,docId:number){
 const doc=addDoc(s,docId);let now=T0+docId*1000;
 const fenceAt=()=>{s.db.exec("UPDATE lane SET lease_until=0,next_run_at=0");return (s.admit(now,'cli') as any).fence;};
 const src={key:doc.key};
 const parsed=(kind:'ok'|'partial'|'failed'|'empty',v:VersionInput)=>{const id={...src,documentSha256:v.rawSha256};
  return kind==='failed'?analyzeDocument({ok:false,category:'malformed'},id):kind==='empty'?analyzeDocument(pdf([page(1,[it('Cover only',100,700)])]),id)
   :kind==='partial'?analyzeDocument(pdf([twoColumnPage(1)],2,'pages'),id):analyzeDocument(pdf([twoColumnPage(1)]),id);};
 const put=(name:string,kind:'ok'|'partial'|'failed'|'empty')=>{const v=version(`${docId}-${name}`);s.complete({fence:fenceAt(),sourceId:doc.id,url:doc.fetch_url,now:(now+=10_000),meta:null,outcome:'new-version',category:null,version:v,analysis:parsed(kind,v)});return v;};
 const shas=()=>(s.db.prepare('SELECT raw_sha256 FROM versions WHERE source_id=? ORDER BY id').all(doc.id) as any[]).map(r=>r.raw_sha256);
 return {doc,put,shas,fenceAt,next:()=>(now+=10_000)};
}
test('SOL-DOC-003: the latest two good versions survive later failed downloads; superseded failures are pruned',()=>{
 const s=new DocumentStore(':memory:',()=>T0);const {put,shas}=sequence(s,1);
 const g1=put('g1','ok'),g2=put('g2','ok');put('f1','failed');const f2=put('f2','failed');
 assert.deepEqual(shas(),[g1.rawSha256,g2.rawSha256,f2.rawSha256]);
 const g3=put('g3','ok');
 // A third good version moves the two-good window; the oldest good and the superseded failure are pruned.
 assert.deepEqual(shas(),[g2.rawSha256,g3.rawSha256]);
 const view=s.sourceDetail(1)!.source;assert.equal(view.display,'last-good');assert.equal(view.current.shownIsLatest,true);
 s.close();
});
test('SOL-DOC-002: usable partial fragments stay displayed and retained through failed, repeated failed and empty replacements',()=>{
 const s=new DocumentStore(':memory:',()=>T0);const {put,shas}=sequence(s,2);
 const p1=put('p1','partial');
 const first=s.listCandidates({doc:2});assert.equal(first.total,4);assert.equal(first.candidates[0].current.display,'latest-partial');
 const ids=first.candidates.map((c:any)=>c.id);
 put('f1','failed');
 let shown=s.listCandidates({doc:2});
 assert.deepEqual(shown.candidates.map((c:any)=>c.id),ids);
 assert.deepEqual(shown.candidates.map((c:any)=>[c.parse.status,c.parse.lastUsable,c.parse.lastGood]),ids.map(()=>['partial',true,false]));
 const cur=shown.candidates[0].current;
 assert.equal(cur.display,'last-known-partial');assert.equal(cur.shownIsLatest,false);assert.equal(cur.latestParseStatus,'failed');assert.equal(cur.latestParseFailure,'malformed');
 assert.equal(cur.label,'Earlier partial extraction shown; the latest download could not be extracted.');
 put('f2','failed');put('f3','failed');const e=put('e1','empty');
 shown=s.listCandidates({doc:2});assert.deepEqual(shown.candidates.map((c:any)=>c.id),ids);
 assert.equal(shown.candidates[0].current.latestParseStatus,'empty');assert.equal(shown.candidates[0].current.label,'Earlier partial extraction shown; the latest download had no recognizable program blocks.');
 assert.equal(s.listCandidates({doc:2,view:'latest'}).total,0);
 // The usable partial bytes stay protected; superseded failures are pruned; nothing is promoted to complete.
 assert.deepEqual(shas(),[p1.rawSha256,e.rawSha256]);
 const src=s.sourceDetail(2)!.source;assert.equal(src.lastGoodParse,null);assert.equal(src.lastUsableParse.status,'partial');assert.equal(src.display,'last-known-partial');
 assert.equal(shown.limits.bookable,false);assert.equal(shown.limits.coverage,'incomplete');
 s.close();
});
test('SOL-DOC-001: returning to retained bytes reuses the immutable earlier version; replay and conflict still hold',()=>{
 const s=new DocumentStore(':memory:',()=>T0);const {doc,put,fenceAt,next,shas}=sequence(s,3);
 // A partial A stays retained (usable fallback) while B's extraction fails; then the publisher returns to A.
 const a=put('A','partial');put('B','failed');
 const aVersion=s.retainedVersion(doc.id,a.rawSha256);
 const rowsOfA=()=>JSON.stringify([s.db.prepare('SELECT * FROM versions WHERE id=?').get(aVersion.id),s.db.prepare('SELECT * FROM parses WHERE version_id=?').all(aVersion.id),
  s.db.prepare('SELECT c.* FROM candidates c JOIN parses p ON p.id=c.parse_id WHERE p.version_id=? ORDER BY c.ordinal').all(aVersion.id)]);
 const before=rowsOfA(),shownBefore=s.listCandidates({doc:3}).candidates.map((c:any)=>c.id);
 const fence=fenceAt(),now=next();
 const input={fence,sourceId:doc.id,url:doc.fetch_url,now,meta:null,outcome:'retained-version' as const,category:null,versionId:Number(aVersion.id)};
 const r=s.complete(input);assert.equal(r.replayed,false);assert.equal(r.versionId,Number(aVersion.id));
 assert.deepEqual(s.complete(input),{replayed:true,attemptId:r.attemptId,versionId:r.versionId});
 assert.throws(()=>s.complete({...input,outcome:'unchanged'}),CompletionConflictError);
 // A's immutable rows are reused unchanged (no duplicate fragment identities); superseded failed B is pruned by retention.
 assert.equal(rowsOfA(),before);assert.deepEqual(shas(),[a.rawSha256]);
 const view=s.sourceDetail(3)!;
 assert.equal(view.source.latestDownload.rawSha256,a.rawSha256);assert.equal(view.source.latestParse.versionId,Number(aVersion.id));
 assert.equal(view.source.lastUsableParse.versionId,Number(aVersion.id));assert.equal(view.source.lastGoodParse,null);
 assert.equal(view.source.current.label,'Latest download, partial extraction.');assert.equal(view.source.display,'latest-partial');
 assert.deepEqual(s.listCandidates({doc:3}).candidates.map((c:any)=>c.id),shownBefore);
 assert.deepEqual(view.attempts.map((x:any)=>x.outcome),['retained-version','new-version','new-version']);
 assert.equal(view.source.latestDownload.verifiedAt,new Date(now).toISOString());
 const f2=fenceAt();
 assert.throws(()=>s.complete({fence:f2,sourceId:doc.id,url:doc.fetch_url,now:next(),meta:null,outcome:'retained-version',category:null}),/existing version/);
 s.close();
});
// The R2 document schema: attempts without 'retained-version' and sources without the usable-partial pointer.
const R2_SCHEMA=`CREATE TABLE sources(id INTEGER PRIMARY KEY,key TEXT NOT NULL UNIQUE,kind TEXT NOT NULL CHECK(kind IN('robots','seed','document')),doc_id INTEGER UNIQUE,fetch_url TEXT NOT NULL,first_seen_at TEXT NOT NULL,latest_version_id INTEGER,latest_parse_id INTEGER,last_good_parse_id INTEGER);
CREATE TABLE attempts(id INTEGER PRIMARY KEY,source_id INTEGER NOT NULL REFERENCES sources(id),fence INTEGER NOT NULL,url TEXT NOT NULL,payload_hash TEXT NOT NULL,outcome TEXT NOT NULL CHECK(outcome IN('new-version','unchanged','not-modified','failed')),category TEXT,status INTEGER,content_type TEXT,bytes INTEGER,advertised_bytes INTEGER,started_at TEXT,completed_at TEXT NOT NULL,version_id INTEGER,UNIQUE(source_id,fence));
CREATE TABLE versions(id INTEGER PRIMARY KEY,source_id INTEGER NOT NULL REFERENCES sources(id),fence INTEGER NOT NULL,raw_sha256 TEXT NOT NULL,raw_bytes INTEGER NOT NULL,stored_sha256 TEXT NOT NULL,stored_kind TEXT NOT NULL,content_type TEXT NOT NULL,etag TEXT,last_modified TEXT,acquired_at TEXT NOT NULL);
CREATE TABLE blobs(version_id INTEGER PRIMARY KEY REFERENCES versions(id) ON DELETE CASCADE,body BLOB NOT NULL);
CREATE TABLE parses(id INTEGER PRIMARY KEY,version_id INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,parser_rev TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('initial','reparse')),status TEXT NOT NULL,error_category TEXT,summary_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(version_id,parser_rev));
CREATE TABLE candidates(id TEXT PRIMARY KEY,parse_id INTEGER NOT NULL REFERENCES parses(id) ON DELETE CASCADE,source_id INTEGER NOT NULL,ordinal INTEGER NOT NULL,page INTEGER NOT NULL,col INTEGER NOT NULL,code_raw TEXT NOT NULL,code_norm TEXT NOT NULL,heading TEXT,block_text TEXT NOT NULL,data_json TEXT NOT NULL);
CREATE TRIGGER attempts_immutable BEFORE UPDATE ON attempts BEGIN SELECT RAISE(ABORT,'immutable'); END;`;
test('upgrade of an R2 document database keeps every row and timestamp, adds the usable-partial fallback, then quota-prunes only unprotected evidence',async()=>{
 const {DatabaseSync}=await import('node:sqlite');
 const {path,done}=temp();const saved=LIMITS.totalBlobBytes;
 try{
  const old=new DatabaseSync(path);old.exec(R2_SCHEMA);
  const at='2080-01-01T00:00:00.000Z',v1=version('r2-old',2000),v2=version('r2-current',2000);
  old.prepare("INSERT INTO sources(id,key,kind,doc_id,fetch_url,first_seen_at) VALUES (1,'doc:16','document',16,'https://www.fuquay-varina.org/DocumentCenter/View/16/x',?)").run(at);
  [v1,v2].forEach((v,i)=>{old.prepare('INSERT INTO versions VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(i+1,1,i+1,v.rawSha256,v.rawBytes,sha256(v.body),'raw-pdf','application/pdf',null,null,at);old.prepare('INSERT INTO blobs VALUES (?,?)').run(i+1,v.body);
   old.prepare("INSERT INTO attempts(source_id,fence,url,payload_hash,outcome,completed_at,version_id) VALUES (1,?,?,?,'new-version',?,?)").run(i+1,'https://www.fuquay-varina.org/DocumentCenter/View/16/x','h'.repeat(64),at,i+1);});
  const p1=analyzeDocument(pdf([page(1,[it('no codes',82,700)])],1,'pages'),{key:'doc:16',documentSha256:v1.rawSha256});
  const p2=analyzeDocument(pdf([twoColumnPage(1)],2,'pages'),{key:'doc:16',documentSha256:v2.rawSha256});
  [p1,p2].forEach((a,i)=>{old.prepare("INSERT INTO parses VALUES (?,?,?,'initial',?,NULL,?,?)").run(i+1,i+1,a.parserRevision,a.status,JSON.stringify({gaps:a.gaps,candidates:a.candidates.length}),at);
   for(const c of a.candidates)old.prepare('INSERT INTO candidates VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(c.id,i+1,1,c.ordinal,c.page,c.column,c.codeRaw,c.codeNormalized,c.heading?.text??null,c.text,JSON.stringify(c));});
  old.exec('UPDATE sources SET latest_version_id=2,latest_parse_id=2 WHERE id=1');
  const snapshot=(db:any)=>['attempts','versions','parses','candidates'].map(t=>JSON.stringify(db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()));
  const before=snapshot(old);old.close();
  let s=new DocumentStore(path,()=>T0);
  assert.deepEqual(snapshot(s.db),before);
  assert.match(String((s.db.prepare("SELECT sql FROM sqlite_master WHERE name='attempts'").get() as any).sql),/'retained-version'/);
  assert.throws(()=>s.db.exec("UPDATE attempts SET outcome='failed'"),/immutable/);
  assert.equal(s.source('doc:16').last_usable_parse_id,2);
  const list=s.listCandidates({doc:16});assert.equal(list.total,4);assert.equal(list.candidates[0].current.display,'latest-partial');
  s.close();s=new DocumentStore(path,()=>T0);assert.deepEqual(snapshot(s.db),before);
  // The R2 store kept an older non-current, fragment-less version: unprotected, so quota pruning may remove it; the
  // current/usable version is protected, so a request that still does not fit is refused with nothing changed.
  const total=Number((s.db.prepare('SELECT SUM(length(body)) n FROM blobs').get() as any).n);
  LIMITS.totalBlobBytes=total+500;
  const other=addDoc(s,17);s.db.exec('UPDATE lane SET lease_until=0,next_run_at=0');const fence=(s.admit(T0,'cli') as any).fence;
  const small=version('17-small',1000);
  s.complete({fence,sourceId:other.id,url:other.fetch_url,now:T0+1,meta:null,outcome:'new-version',category:null,version:small,analysis:analyzeDocument(pdf([twoColumnPage(1)]),{key:other.key,documentSha256:small.rawSha256})});
  assert.equal(s.db.prepare('SELECT 1 FROM versions WHERE raw_sha256=?').get(v1.rawSha256),undefined);
  assert.ok(s.db.prepare('SELECT 1 FROM versions WHERE raw_sha256=?').get(v2.rawSha256));
  const counts=['attempts','versions','blobs','parses','candidates'].map(t=>count(s,t));
  s.db.exec('UPDATE lane SET lease_until=0,next_run_at=0');const f2=(s.admit(T0+10,'cli') as any).fence;
  assert.throws(()=>s.complete({fence:f2,sourceId:other.id,url:other.fetch_url,now:T0+11,meta:null,outcome:'new-version',category:null,version:version('17-big',5000)}),QuotaError);
  assert.deepEqual(['attempts','versions','blobs','parses','candidates'].map(t=>count(s,t)),counts);
  s.close();
 }finally{LIMITS.totalBlobBytes=saved;done();}
});
test('two file-backed connections share one lease and fence; a superseded completion is rejected',()=>{
 const {path,done}=temp();
 const one=new DocumentStore(path,()=>T0),two=new DocumentStore(path,()=>T0);
 try{
  const a=one.admit(T0,'startup') as any;
  assert.deepEqual(two.admit(T0+1,'cli'),{admitted:false,reason:'busy'});
  assert.equal(two.reserveRequest(a.fence,T0+2),0);assert.equal(one.reserveRequest(a.fence,T0+3),4999);
  one.finishRun(a.fence,{outcome:'complete'},T0+10);
  two.db.exec('UPDATE lane SET next_run_at=0');const b=two.admit(T0+20,'cli') as any;assert.equal(b.fence,a.fence+1);
  const robots=one.source('robots');
  assert.throws(()=>one.complete({fence:a.fence,sourceId:robots.id,url:robots.fetch_url,now:T0+30,meta:null,outcome:'failed',category:'timeout'}),StaleFenceError);
  assert.equal(count(two,'attempts'),0);
 }finally{one.close();two.close();done();}
});
