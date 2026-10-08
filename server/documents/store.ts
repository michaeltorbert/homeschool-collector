import {DatabaseSync} from 'node:sqlite';
import {LIMITS,SEEDS,ROBOTS_URL,sha256,type LinkInventory} from './policy.ts';
import type {FetchMeta} from './fetch.ts';
import type {Analysis} from './layout.ts';
// Independent local document-evidence database (ignored data/documents.sqlite). It never opens, migrates or resets the
// family preview database. Attempts, versions, blobs, parses and candidates are immutable while retained (UPDATE
// triggers); only source pointers, link associations, lane admission state and run summaries change.
export const DOCUMENTS_DB_PATH=new URL('../../data/documents.sqlite',import.meta.url).pathname;
export class StaleFenceError extends Error {}
export class CompletionConflictError extends Error {}
export class QuotaError extends Error {}
export class DocumentQueryError extends Error {}
export const DOCUMENT_LIMITS={
 label:'Published Town brochure text only. Incomplete and possibly historical; not the registration catalog, not bookable, and availability is unknown.',
 coverage:'incomplete',publisherScope:'unknown',bookable:false,availability:'unknown',registration:'not-connected',semantics:'raw-source-text',
} as const;
const TRANSIENT=['server-error','transport-error','timeout','cancelled','stream-error','run-budget-exceeded'];
const FAILURE_LABELS:Record<string,string>={
 denied:'Access denied; Town collection stopped. No bypass attempted.',challenge:'Challenge or interstitial page; Town collection stopped. No bypass attempted.',
 'rate-limited':'Rate limited; Town collection paused until the backoff ends.','server-error':'Server error; next scheduled check only.',
 'transport-error':'Network or redirect failure; next scheduled check only.',timeout:'Timed out; next scheduled check only.',cancelled:'Stopped because the collector shut down.',
 'stream-error':'Response stream failed; next scheduled check only.','http-status':'Unsuccessful response; last-known evidence kept.','too-large':'Response exceeds the size limit; not stored.',
 'no-body':'No response body.','wrong-type':'Unexpected media type; not stored.','html-instead-of-pdf':'A web page arrived instead of a PDF; Town collection stopped.',
 'not-pdf':'Not a PDF; not stored.','unexpected-not-modified':'Unrequested not-modified response; nothing changed.','quota-exceeded':'Local storage limit reached; new evidence not stored, existing evidence kept.',
 'robots-disallow':'robots.txt disallows a target; Town collection stopped.','robots-unavailable':'robots.txt unavailable; Town collection stopped (fail closed).',
 'robots-unsupported':'robots.txt policy not supported; Town collection stopped (fail closed).','run-budget-exceeded':'Run byte budget reached; deferred to the next check.',
};
export const failureLabel=(c:string|null)=>c===null?null:FAILURE_LABELS[c]??'Failed; no detail recorded.';
// 'retained-version': the publisher returned to bytes still retained under an earlier version of the same source; the
// earlier immutable version and parse become current again (no duplicate fragment identities, no re-extraction).
const ATTEMPTS=(name:string)=>`CREATE TABLE IF NOT EXISTS ${name}(id INTEGER PRIMARY KEY,source_id INTEGER NOT NULL REFERENCES sources(id),fence INTEGER NOT NULL,url TEXT NOT NULL,payload_hash TEXT NOT NULL,outcome TEXT NOT NULL CHECK(outcome IN('new-version','retained-version','unchanged','not-modified','failed')),category TEXT,status INTEGER,content_type TEXT,bytes INTEGER,advertised_bytes INTEGER,started_at TEXT,completed_at TEXT NOT NULL,version_id INTEGER,UNIQUE(source_id,fence));`;
// A usable parse has extracted fragments: complete-traversal 'ok', or 'partial' with at least one candidate.
const USABLE=`(p.status='ok' OR (p.status='partial' AND EXISTS(SELECT 1 FROM candidates c WHERE c.parse_id=p.id)))`;
const SCHEMA=`
CREATE TABLE IF NOT EXISTS lane(id TEXT PRIMARY KEY CHECK(id='town'),fence INTEGER NOT NULL DEFAULT 0,lease_until INTEGER NOT NULL DEFAULT 0,next_run_at INTEGER NOT NULL DEFAULT 0,backoff_until INTEGER NOT NULL DEFAULT 0,blocked_category TEXT,blocked_at TEXT,last_request_at INTEGER NOT NULL DEFAULT 0,request_gap_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS runs(fence INTEGER PRIMARY KEY,trigger TEXT NOT NULL,started_at TEXT NOT NULL,finished_at TEXT,outcome TEXT,report_json TEXT);
CREATE TABLE IF NOT EXISTS sources(id INTEGER PRIMARY KEY,key TEXT NOT NULL UNIQUE,kind TEXT NOT NULL CHECK(kind IN('robots','seed','document')),doc_id INTEGER UNIQUE,fetch_url TEXT NOT NULL,first_seen_at TEXT NOT NULL,latest_version_id INTEGER,latest_parse_id INTEGER,last_good_parse_id INTEGER,last_usable_parse_id INTEGER);
CREATE TABLE IF NOT EXISTS links(document_id INTEGER NOT NULL REFERENCES sources(id),seed_id INTEGER NOT NULL REFERENCES sources(id),url TEXT NOT NULL,link_text TEXT NOT NULL,first_seen_at TEXT NOT NULL,last_seen_at TEXT NOT NULL,last_seen_version_id INTEGER NOT NULL,PRIMARY KEY(document_id,seed_id,url));
${ATTEMPTS('attempts')}
CREATE TABLE IF NOT EXISTS versions(id INTEGER PRIMARY KEY,source_id INTEGER NOT NULL REFERENCES sources(id),fence INTEGER NOT NULL,raw_sha256 TEXT NOT NULL,raw_bytes INTEGER NOT NULL,stored_sha256 TEXT NOT NULL,stored_kind TEXT NOT NULL,content_type TEXT NOT NULL,etag TEXT,last_modified TEXT,acquired_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS blobs(version_id INTEGER PRIMARY KEY REFERENCES versions(id) ON DELETE CASCADE,body BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS parses(id INTEGER PRIMARY KEY,version_id INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,parser_rev TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('initial','reparse')),status TEXT NOT NULL,error_category TEXT,summary_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(version_id,parser_rev));
CREATE TABLE IF NOT EXISTS candidates(id TEXT PRIMARY KEY,parse_id INTEGER NOT NULL REFERENCES parses(id) ON DELETE CASCADE,source_id INTEGER NOT NULL,ordinal INTEGER NOT NULL,page INTEGER NOT NULL,col INTEGER NOT NULL,code_raw TEXT NOT NULL,code_norm TEXT NOT NULL,heading TEXT,block_text TEXT NOT NULL,data_json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS candidates_parse ON candidates(parse_id,ordinal);
CREATE INDEX IF NOT EXISTS candidates_code ON candidates(code_norm);
CREATE INDEX IF NOT EXISTS attempts_source ON attempts(source_id,id);
CREATE INDEX IF NOT EXISTS versions_source ON versions(source_id,id);
CREATE TRIGGER IF NOT EXISTS attempts_immutable BEFORE UPDATE ON attempts BEGIN SELECT RAISE(ABORT,'immutable'); END;
CREATE TRIGGER IF NOT EXISTS versions_immutable BEFORE UPDATE ON versions BEGIN SELECT RAISE(ABORT,'immutable'); END;
CREATE TRIGGER IF NOT EXISTS blobs_immutable BEFORE UPDATE ON blobs BEGIN SELECT RAISE(ABORT,'immutable'); END;
CREATE TRIGGER IF NOT EXISTS parses_immutable BEFORE UPDATE ON parses BEGIN SELECT RAISE(ABORT,'immutable'); END;
CREATE TRIGGER IF NOT EXISTS candidates_immutable BEFORE UPDATE ON candidates BEGIN SELECT RAISE(ABORT,'immutable'); END;`;
export type Outcome='new-version'|'retained-version'|'unchanged'|'not-modified'|'failed';
export interface VersionInput {rawSha256:string;rawBytes:number;body:Buffer;storedKind:'raw-pdf'|'sanitized-link-inventory'|'robots-text';contentType:string;etag:string|null;lastModified:string|null}
export interface Completion {fence:number;sourceId:number;url:string;now:number;meta:FetchMeta|null;outcome:Outcome;category:string|null;versionId?:number;version?:VersionInput;analysis?:Analysis;inventory?:LinkInventory}
export type Admission={admitted:true;fence:number;leaseUntil:number}|{admitted:false;reason:'blocked'|'rate-limit-backoff'|'busy'|'not-due';category?:string;until?:string};
const iso=(ms:number)=>new Date(ms).toISOString();
const isoOrNull=(ms:number)=>ms>0?iso(ms):null;
const json=(v:any)=>JSON.stringify(v);
export class DocumentStore {
 db:DatabaseSync;
 private depth=0;
 constructor(path:string,readonly clock:()=>number=Date.now){
  this.db=new DatabaseSync(path);
  try{
   this.db.exec('PRAGMA foreign_keys = ON');
   if(this.db.prepare('PRAGMA foreign_keys').get()?.foreign_keys!==1)throw Error('SQLite foreign-key protection could not be enabled.');
   this.db.exec('PRAGMA busy_timeout = 5000');
   if(path!==':memory:')this.db.exec('PRAGMA journal_mode = WAL');
   this.tx(()=>{
    this.db.exec(SCHEMA);
    this.upgrade();
    this.db.prepare('INSERT OR IGNORE INTO lane(id,request_gap_ms) VALUES (?,?)').run('town',LIMITS.requestGapMs);
    const at=iso(this.clock());
    this.db.prepare("INSERT OR IGNORE INTO sources(key,kind,fetch_url,first_seen_at) VALUES ('robots','robots',?,?)").run(ROBOTS_URL,at);
    for(const s of SEEDS)this.db.prepare("INSERT OR IGNORE INTO sources(key,kind,fetch_url,first_seen_at) VALUES (?,'seed',?,?)").run(s.key,s.url,at);
   });
  }catch(e){this.db.close();throw e;}
 }
 // Upgrade of an earlier document database inside the opening transaction (all or nothing). The attempts table is
 // rebuilt only to widen its outcome check: every row and id is copied unchanged and the immutability trigger and index
 // are recreated. The usable-partial pointer is added and backfilled from retained parses. No attempt, version, blob,
 // parse, candidate, acquisition or verification time is modified, and nothing is fetched.
 private upgrade(){
  const sql=String((this.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='attempts'").get() as any).sql);
  if(!sql.includes("'retained-version'")){
   this.db.exec(`${ATTEMPTS('attempts_upgrade')} INSERT INTO attempts_upgrade SELECT * FROM attempts; DROP TABLE attempts; ALTER TABLE attempts_upgrade RENAME TO attempts;`);
   this.db.exec(SCHEMA);
  }
  if(!(this.db.prepare('PRAGMA table_info(sources)').all() as any[]).some(c=>c.name==='last_usable_parse_id')){
   this.db.exec('ALTER TABLE sources ADD COLUMN last_usable_parse_id INTEGER');
   this.db.exec(`UPDATE sources SET last_usable_parse_id=COALESCE((SELECT p.id FROM parses p WHERE p.id=sources.latest_parse_id AND ${USABLE}),
    (SELECT MAX(p.id) FROM parses p JOIN versions v ON v.id=p.version_id WHERE v.source_id=sources.id AND ${USABLE}))`);
  }
 }
 close(){if(this.db.isOpen)this.db.close();}
 tx<T>(fn:()=>T):T{const nested=this.depth>0,sp=`sp_${this.depth}`;this.db.exec(nested?`SAVEPOINT ${sp}`:'BEGIN IMMEDIATE');this.depth++;try{const r=fn();this.db.exec(nested?`RELEASE SAVEPOINT ${sp}`:'COMMIT');return r;}catch(e){this.db.exec(nested?`ROLLBACK TO SAVEPOINT ${sp}`:'ROLLBACK');if(nested)this.db.exec(`RELEASE SAVEPOINT ${sp}`);throw e;}finally{this.depth--;}}
 private lane(){return this.db.prepare("SELECT * FROM lane WHERE id='town'").get() as any;}
 // ---- Admission, fencing and pacing (persisted before any network) ----
 // One admitted network run per due window across server and CLI processes: the next due time and a lease long enough
 // for a full run are committed before robots is requested, so restarts and concurrent processes cannot fetch again.
 admit(now:number,trigger:'startup'|'timer'|'cli'):Admission{
  return this.tx(()=>{
   const l=this.lane();
   if(l.blocked_category)return {admitted:false,reason:'blocked',category:l.blocked_category};
   if(l.backoff_until>now)return {admitted:false,reason:'rate-limit-backoff',until:iso(l.backoff_until)};
   if(l.lease_until>now)return {admitted:false,reason:'busy'};
   if(l.next_run_at>now)return {admitted:false,reason:'not-due',until:iso(l.next_run_at)};
   const fence=l.fence+1,leaseUntil=now+LIMITS.leaseMs;
   this.db.prepare("UPDATE lane SET fence=?,lease_until=?,next_run_at=? WHERE id='town'").run(fence,leaseUntil,now+LIMITS.htmlDueMs);
   this.openRun(fence,trigger,now);
   return {admitted:true,fence,leaseUntil};
  });
 }
 // Local reprocessing lease: excludes concurrent runs without touching the network schedule or lane stops.
 acquireLocal(now:number):{fence:number}{
  return this.tx(()=>{
   const l=this.lane();if(l.lease_until>now)throw new StaleFenceError('busy');
   const fence=l.fence+1;this.db.prepare("UPDATE lane SET fence=?,lease_until=? WHERE id='town'").run(fence,now+LIMITS.leaseMs);
   this.openRun(fence,'local-reparse',now);return {fence};
  });
 }
 private openRun(fence:number,trigger:string,now:number){
  this.db.prepare('INSERT INTO runs(fence,trigger,started_at) VALUES (?,?,?)').run(fence,trigger,iso(now));
  this.db.prepare('DELETE FROM runs WHERE fence NOT IN (SELECT fence FROM runs ORDER BY fence DESC LIMIT ?)').run(LIMITS.runsRetained);
 }
 private guard(fence:number,now:number){const l=this.lane();if(l.fence!==fence||now>l.lease_until)throw new StaleFenceError('Expired or superseded collector lease.');}
 leaseRemaining(fence:number,now:number){const l=this.lane();return l.fence===fence?l.lease_until-now:-1;}
 // Returns 0 after persisting this request's time, or the wait before the next request is allowed.
 reserveRequest(fence:number,now:number):number{
  return this.tx(()=>{this.guard(fence,now);const l=this.lane();const wait=l.last_request_at+l.request_gap_ms-now;if(wait>0)return wait;this.db.prepare("UPDATE lane SET last_request_at=? WHERE id='town'").run(now);return 0;});
 }
 setRequestGap(fence:number,ms:number,now:number){this.tx(()=>{this.guard(fence,now);this.db.prepare("UPDATE lane SET request_gap_ms=? WHERE id='town'").run(Math.max(LIMITS.requestGapMs,Math.ceil(ms)));});}
 // Sticky Town lane stop. There is deliberately no clear/reset/force operation in the runtime or CLI.
 block(category:string,now:number){this.db.prepare("UPDATE lane SET blocked_category=?,blocked_at=? WHERE id='town' AND blocked_category IS NULL").run(category,iso(now));}
 backoff(until:number){this.db.prepare("UPDATE lane SET backoff_until=MAX(backoff_until,?) WHERE id='town'").run(until);}
 finishRun(fence:number,report:any,now:number){
  this.tx(()=>{
   this.db.prepare('UPDATE runs SET finished_at=?,outcome=?,report_json=? WHERE fence=? AND finished_at IS NULL').run(iso(now),String(report?.outcome??'unknown'),json(report),fence);
   this.db.prepare("UPDATE lane SET lease_until=0 WHERE id='town' AND fence=?").run(fence);
  });
 }
 // ---- Sources and retained representations ----
 source(key:string){return this.db.prepare('SELECT * FROM sources WHERE key=?').get(key) as any;}
 documentSources(){return this.db.prepare("SELECT * FROM sources WHERE kind='document' ORDER BY doc_id").all() as any[];}
 latestVersion(sourceId:number){return this.db.prepare('SELECT v.* FROM sources s JOIN versions v ON v.id=s.latest_version_id WHERE s.id=?').get(sourceId) as any;}
 blob(versionId:number):Buffer|null{const r=this.db.prepare('SELECT body FROM blobs WHERE version_id=?').get(versionId) as any;return r?Buffer.from(r.body):null;}
 // Validators come only from the latest version whose representation is still retained; otherwise no conditional request.
 conditionalFor(sourceId:number){
  const v=this.latestVersion(sourceId);
  if(!v||(!v.etag&&!v.last_modified)||!this.db.prepare('SELECT 1 FROM blobs WHERE version_id=?').get(v.id))return null;
  return {versionId:Number(v.id),etag:v.etag as string|null,lastModified:v.last_modified as string|null};
 }
 // Due time counts from the latest attempt that was not a transient failure, so transient failures retry next schedule.
 isDue(sourceId:number,dueMs:number,now:number){
  const r=this.db.prepare(`SELECT MAX(completed_at) at FROM attempts WHERE source_id=? AND NOT (outcome='failed' AND category IN (${TRANSIENT.map(()=>'?').join(',')}))`).get(sourceId,...TRANSIENT) as any;
  return !r?.at||Date.parse(r.at)+dueMs<=now;
 }
 hasParse(versionId:number,parserRev:string){return !!this.db.prepare('SELECT 1 FROM parses WHERE version_id=? AND parser_rev=?').get(versionId,parserRev);}
 // An earlier retained version of this source with exactly these bytes (publisher rollback A→B→A).
 retainedVersion(sourceId:number,rawSha256:string){return this.db.prepare('SELECT * FROM versions WHERE source_id=? AND raw_sha256=? ORDER BY id DESC LIMIT 1').get(sourceId,rawSha256) as any;}
 // One atomic completion per source per fence. An identical repeat returns the stored attempt; a differing one is a
 // conflict. The fence/lease guard precedes every write; quota failure rolls back without pruning protected evidence.
 complete(c:Completion){
  const payloadHash=sha256(json({sourceId:c.sourceId,url:c.url,outcome:c.outcome,category:c.category,versionId:c.versionId??null,meta:c.meta,
   version:c.version?{raw:c.version.rawSha256,stored:sha256(c.version.body),etag:c.version.etag,lastModified:c.version.lastModified}:null,
   analysis:c.analysis?{rev:c.analysis.parserRevision,status:c.analysis.status,blocks:c.analysis.candidates.map(x=>[x.id,x.blockSha256])}:null,inventory:c.inventory?sha256(json(c.inventory)):null}));
  return this.tx(()=>{
   const prior=this.db.prepare('SELECT * FROM attempts WHERE source_id=? AND fence=?').get(c.sourceId,c.fence) as any;
   if(prior){if(prior.payload_hash!==payloadHash)throw new CompletionConflictError('Conflicting completion for this source and fence.');return {replayed:true,attemptId:Number(prior.id),versionId:prior.version_id as number|null};}
   this.guard(c.fence,c.now);
   let versionId:number|null=null;
   if(c.version)versionId=this.insertVersion(c.sourceId,c.fence,c.version,c.now);
   else if(c.versionId!==undefined){if(!this.db.prepare('SELECT 1 FROM versions WHERE id=? AND source_id=?').get(c.versionId,c.sourceId))throw Error('Unknown retained version.');versionId=c.versionId;}
   if(c.outcome==='retained-version'){if(versionId===null||c.version||c.analysis)throw Error('A retained-version completion references an existing version only.');this.adoptVersion(c.sourceId,versionId);}
   if(c.analysis&&versionId!==null)this.insertParse(c.sourceId,versionId,c.analysis,'initial',c.now);
   if(c.inventory&&versionId!==null)this.recordLinks(c.sourceId,versionId,c.inventory,c.now);
   const m=c.meta;
   const r=this.db.prepare('INSERT INTO attempts(source_id,fence,url,payload_hash,outcome,category,status,content_type,bytes,advertised_bytes,started_at,completed_at,version_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(c.sourceId,c.fence,c.url,payloadHash,c.outcome,c.category,m?.status??null,m?.contentType??null,m?.bytes??null,m?.advertisedBytes??null,m?.startedAt??null,iso(c.now),versionId);
   this.db.prepare('DELETE FROM attempts WHERE source_id=? AND id NOT IN (SELECT id FROM attempts WHERE source_id=? ORDER BY id DESC LIMIT ?)').run(c.sourceId,c.sourceId,LIMITS.attemptsPerSource);
   this.pruneSource(c.sourceId);
   return {replayed:false,attemptId:Number(r.lastInsertRowid),versionId};
  });
 }
 // Parser reprocessing of retained bytes: new local evidence under its own revision, with no attempt, acquisition or
 // verification time.
 recordReparse(fence:number,versionId:number,analysis:Analysis,now:number){
  return this.tx(()=>{
   this.guard(fence,now);
   const v=this.db.prepare('SELECT * FROM versions WHERE id=?').get(versionId) as any;if(!v)throw Error('Unknown retained version.');
   if(this.hasParse(versionId,analysis.parserRevision))return null;
   return this.insertParse(Number(v.source_id),versionId,analysis,'reparse',now);
  });
 }
 // Protected from both count and quota pruning: every current/fallback reference (latest download, latest parse, last
 // complete-good parse, last usable parse) plus the latest two good versions per source. A document version is good
 // when it has a complete-traversal ('ok') parse; robots/seed representations are good once stored.
 private protectedVersions(){
  return new Set((this.db.prepare(`SELECT latest_version_id id FROM sources WHERE latest_version_id IS NOT NULL
   UNION SELECT version_id FROM parses WHERE id IN (SELECT latest_parse_id FROM sources UNION SELECT last_good_parse_id FROM sources UNION SELECT last_usable_parse_id FROM sources)
   UNION SELECT id FROM (SELECT v.id,ROW_NUMBER() OVER (PARTITION BY v.source_id ORDER BY v.id DESC) rn FROM versions v JOIN sources s ON s.id=v.source_id
    WHERE s.kind!='document' OR EXISTS(SELECT 1 FROM parses p WHERE p.version_id=v.id AND p.status='ok')) WHERE rn<=?`).all(LIMITS.goodVersionsPerSource) as any[]).map(r=>Number(r.id)));
 }
 // Pointer moves for a parse becoming current: latest always; complete-good and usable only when they qualify, so a
 // failed or empty current parse never hides the earlier usable fragments.
 private pointParse(sourceId:number,parseId:number,status:string,usable:boolean){
  this.db.prepare('UPDATE sources SET latest_parse_id=? WHERE id=?').run(parseId,sourceId);
  if(status==='ok')this.db.prepare('UPDATE sources SET last_good_parse_id=? WHERE id=?').run(parseId,sourceId);
  if(usable)this.db.prepare('UPDATE sources SET last_usable_parse_id=? WHERE id=?').run(parseId,sourceId);
 }
 private adoptVersion(sourceId:number,versionId:number){
  this.db.prepare('UPDATE sources SET latest_version_id=? WHERE id=?').run(versionId,sourceId);
  const p=this.db.prepare(`SELECT p.id,p.status,${USABLE} usable FROM parses p WHERE p.version_id=? ORDER BY p.id DESC LIMIT 1`).get(versionId) as any;
  if(p)this.pointParse(sourceId,Number(p.id),String(p.status),!!p.usable);
 }
 private insertVersion(sourceId:number,fence:number,v:VersionInput,now:number){
  const limit=LIMITS.totalBlobBytes,incoming=v.body.byteLength;
  let total=Number((this.db.prepare('SELECT COALESCE(SUM(length(body)),0) n FROM blobs').get() as any).n);
  if(total+incoming>limit){
   const keep=this.protectedVersions();
   for(const old of this.db.prepare('SELECT v.id,length(b.body) n FROM versions v JOIN blobs b ON b.version_id=v.id ORDER BY v.id').all() as any[]){
    if(total+incoming<=limit)break;if(keep.has(Number(old.id)))continue;
    this.db.prepare('DELETE FROM versions WHERE id=?').run(old.id);total-=Number(old.n);
   }
   if(total+incoming>limit)throw new QuotaError('quota');
  }
  const r=this.db.prepare('INSERT INTO versions(source_id,fence,raw_sha256,raw_bytes,stored_sha256,stored_kind,content_type,etag,last_modified,acquired_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
   .run(sourceId,fence,v.rawSha256,v.rawBytes,sha256(v.body),v.storedKind,v.contentType,v.etag,v.lastModified,iso(now));
  const id=Number(r.lastInsertRowid);
  this.db.prepare('INSERT INTO blobs(version_id,body) VALUES (?,?)').run(id,v.body);
  this.db.prepare('UPDATE sources SET latest_version_id=? WHERE id=?').run(id,sourceId);
  return id;
 }
 private insertParse(sourceId:number,versionId:number,a:Analysis,kind:'initial'|'reparse',now:number){
  const r=this.db.prepare('INSERT INTO parses(version_id,parser_rev,kind,status,error_category,summary_json,created_at) VALUES (?,?,?,?,?,?,?)')
   .run(versionId,a.parserRevision,kind,a.status,a.errorCategory,json({gaps:a.gaps,candidates:a.candidates.length}),iso(now));
  const parseId=Number(r.lastInsertRowid);
  const insert=this.db.prepare('INSERT INTO candidates(id,parse_id,source_id,ordinal,page,col,code_raw,code_norm,heading,block_text,data_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  for(const c of a.candidates)insert.run(c.id,parseId,sourceId,c.ordinal,c.page,c.column,c.codeRaw,c.codeNormalized,c.heading?.text??null,c.text,json(c));
  this.pointParse(sourceId,parseId,a.status,a.status==='ok'||(a.status==='partial'&&a.candidates.length>0));
  return parseId;
 }
 private recordLinks(seedId:number,versionId:number,inv:LinkInventory,now:number){
  const at=iso(now);
  for(const d of inv.documents){
   // One source per numeric document ID; every published slug URL stays a separate link row under its actual seed.
   this.db.prepare("INSERT INTO sources(key,kind,doc_id,fetch_url,first_seen_at) VALUES (?,'document',?,?,?) ON CONFLICT(key) DO NOTHING").run(`doc:${d.docId}`,d.docId,d.url,at);
   const doc=this.source(`doc:${d.docId}`);
   this.db.prepare('INSERT INTO links(document_id,seed_id,url,link_text,first_seen_at,last_seen_at,last_seen_version_id) VALUES (?,?,?,?,?,?,?) ON CONFLICT(document_id,seed_id,url) DO UPDATE SET link_text=excluded.link_text,last_seen_at=excluded.last_seen_at,last_seen_version_id=excluded.last_seen_version_id')
    .run(doc.id,seedId,d.url,d.text,at,at,versionId);
  }
 }
 private pruneSource(sourceId:number){
  const keep=this.protectedVersions();
  for(const r of this.db.prepare('SELECT id FROM versions WHERE source_id=?').all(sourceId) as any[])if(!keep.has(Number(r.id)))this.db.prepare('DELETE FROM versions WHERE id=?').run(r.id);
 }
 // ---- Bounded read views (no bodies except the bounded candidate block text; no paths, errors or tokens) ----
 private versionView(id:number|null){
  if(id===null||id===undefined)return null;
  const v=this.db.prepare('SELECT v.*,(SELECT 1 FROM blobs b WHERE b.version_id=v.id) retained,(SELECT MAX(completed_at) FROM attempts a WHERE a.version_id=v.id AND a.outcome!=\'failed\') verified FROM versions v WHERE v.id=?').get(id) as any;
  return v?{versionId:Number(v.id),rawSha256:v.raw_sha256,rawBytes:Number(v.raw_bytes),storedSha256:v.stored_sha256,storedKind:v.stored_kind,contentType:v.content_type,acquiredAt:v.acquired_at,verifiedAt:v.verified??null,retained:!!v.retained}:null;
 }
 private parseView(id:number|null){
  if(id===null||id===undefined)return null;
  const p=this.db.prepare('SELECT * FROM parses WHERE id=?').get(id) as any;
  return p?{parseId:Number(p.id),versionId:Number(p.version_id),parserRevision:p.parser_rev,kind:p.kind,status:p.status,errorCategory:p.error_category,createdAt:p.created_at,...JSON.parse(p.summary_json)}:null;
 }
 // What a document's displayed fragments are and how they relate to the current download/extraction. Display basis:
 // last complete-good parse, else last usable partial parse, else the latest parse. Earlier evidence is labelled as
 // earlier, never as complete coverage or bookable.
 private current(s:any){
  const latest=s.latest_parse_id?this.db.prepare('SELECT status,error_category FROM parses WHERE id=?').get(s.latest_parse_id) as any:null;
  const attempt=this.db.prepare('SELECT outcome,category FROM attempts WHERE source_id=? ORDER BY id DESC LIMIT 1').get(s.id) as any;
  const shown=s.last_good_parse_id??s.last_usable_parse_id??s.latest_parse_id??null;
  const shownIsLatest=shown!==null&&Number(shown)===Number(s.latest_parse_id);
  const display=shown===null?'none':s.last_good_parse_id?'last-good':s.last_usable_parse_id?(shownIsLatest?'latest-partial':'last-known-partial'):`latest-${latest.status}`;
  const latestText=latest?.status==='failed'?'could not be extracted':latest?.status==='empty'?'had no recognizable program blocks':latest?.status==='partial'?'is a partial extraction':'was fully traversed';
  const label=shown===null?'No extracted text yet.'
   :shownIsLatest?(latest.status==='ok'?'Latest download, fully traversed (brochure text only; coverage still incomplete).':latest.status==='partial'?'Latest download, partial extraction.':`Latest download ${latestText}; no earlier usable text is retained.`)
   :`Earlier ${s.last_good_parse_id?'fully traversed':'partial'} extraction shown; the latest download ${latestText}.`;
  return {display,label,shownParseId:shown===null?null:Number(shown),shownIsLatest,latestParseStatus:latest?.status??null,latestParseFailure:latest?.error_category??null,
   latestAttemptOutcome:attempt?.outcome??null,currentFailure:attempt?.outcome==='failed'?failureLabel(attempt.category):null};
 }
 private sourceView(s:any){
  const attempt=this.db.prepare('SELECT * FROM attempts WHERE source_id=? ORDER BY id DESC LIMIT 1').get(s.id) as any;
  const view:any={key:s.key,kind:s.kind,docId:s.doc_id??null,fetchUrl:s.fetch_url,firstSeenAt:s.first_seen_at,
   latestDownload:this.versionView(s.latest_version_id),latestParse:this.parseView(s.latest_parse_id),lastGoodParse:this.parseView(s.last_good_parse_id),lastUsableParse:this.parseView(s.last_usable_parse_id),
   latestAttempt:attempt?{outcome:attempt.outcome,category:attempt.category,status:attempt.status,completedAt:attempt.completed_at}:null,
   currentFailure:attempt?.outcome==='failed'?failureLabel(attempt.category):null};
  if(s.kind==='document'){
   const links=this.db.prepare('SELECT l.*,seed.key seed_key,seed.latest_version_id seed_version FROM links l JOIN sources seed ON seed.id=l.seed_id WHERE l.document_id=? ORDER BY seed.key,l.url').all(s.id) as any[];
   view.links=links.map(l=>({seed:l.seed_key,url:l.url,text:l.link_text,firstSeenAt:l.first_seen_at,lastSeenAt:l.last_seen_at,inLatestSeedVersion:Number(l.seed_version)===Number(l.last_seen_version_id)}));
   // Absence from a seed page is reported only; it never removes or cancels anything.
   view.currentlyLinked=view.links.some((l:any)=>l.inLatestSeedVersion);
   view.current=this.current(s);view.display=view.current.display;
  }
  if(s.kind==='seed'&&s.latest_version_id){
   const body=this.blob(s.latest_version_id);
   if(body){const inv=JSON.parse(body.toString('utf8')) as LinkInventory;view.inventory={documentLinks:inv.documents.length,excludedBrochureLinks:inv.excluded,counts:inv.counts,truncated:inv.truncated,
    truncatedReasons:inv.truncatedReasons??[],documentLinksOmitted:inv.counts.documentLinksOmitted??0,documentIdsOmitted:inv.counts.documentIdsOmitted??0};}
  }
  return view;
 }
 status(now=this.clock()){
  const l=this.lane(),run=this.db.prepare('SELECT * FROM runs ORDER BY fence DESC LIMIT 1').get() as any;
  return {limits:DOCUMENT_LIMITS,
   lane:{state:l.blocked_category?'blocked':l.backoff_until>now?'rate-limit-backoff':l.lease_until>now?'running':'idle',blockedCategory:l.blocked_category,blockedLabel:failureLabel(l.blocked_category),blockedAt:l.blocked_at,backoffUntil:l.backoff_until>now?iso(l.backoff_until):null,nextRunAt:isoOrNull(l.next_run_at),requestGapMs:l.request_gap_ms},
   lastRun:run?{fence:run.fence,trigger:run.trigger,startedAt:run.started_at,finishedAt:run.finished_at,outcome:run.outcome,report:run.report_json?JSON.parse(run.report_json):null}:null,
   sources:(this.db.prepare("SELECT * FROM sources ORDER BY CASE kind WHEN 'robots' THEN 0 WHEN 'seed' THEN 1 ELSE 2 END,doc_id,key").all() as any[]).map(s=>this.sourceView(s))};
 }
 listCandidates(input:{q?:string|null;code?:string|null;doc?:string|number|null;view?:string|null;limit?:string|number|null;cursor?:string|number|null}={}){
  const q=input.q??'',view=input.view??'display';
  if(typeof q!=='string'||q.length>100)throw new DocumentQueryError('Search text is limited to 100 characters.');
  if(view!=='display'&&view!=='latest')throw new DocumentQueryError('View must be display or latest.');
  const code=input.code?String(input.code).toUpperCase():null;if(code!==null&&!/^[A-Z]{2,6} ?\d{3,4}$/.test(code))throw new DocumentQueryError('Code must be letters followed by digits.');
  const doc=input.doc===null||input.doc===undefined||input.doc===''?null:String(input.doc);if(doc!==null&&!/^[1-9]\d{0,8}$/.test(doc))throw new DocumentQueryError('Document ID must be numeric.');
  const limit=input.limit===null||input.limit===undefined||input.limit===''?50:Number(input.limit);if(!Number.isInteger(limit)||limit<1||limit>100)throw new DocumentQueryError('Limit must be 1 to 100.');
  const offset=input.cursor===null||input.cursor===undefined||input.cursor===''?0:Number(input.cursor);if(!Number.isInteger(offset)||offset<0||offset>10_000)throw new DocumentQueryError('Invalid cursor.');
  const where=[view==='latest'?'c.parse_id=s.latest_parse_id':'c.parse_id=COALESCE(s.last_good_parse_id,s.last_usable_parse_id,s.latest_parse_id)'],args:any[]=[];
  if(code){where.push('c.code_norm=?');args.push(code.replace(' ',''));}
  if(doc){where.push('s.doc_id=?');args.push(Number(doc));}
  if(q.trim()){const like=`%${q.trim().replace(/[\\%_]/g,m=>`\\${m}`)}%`;where.push("(c.code_norm LIKE ? ESCAPE '\\' OR c.code_raw LIKE ? ESCAPE '\\' OR c.heading LIKE ? ESCAPE '\\' OR c.block_text LIKE ? ESCAPE '\\')");args.push(like,like,like,like);}
  const from=`FROM candidates c JOIN sources s ON s.id=c.source_id JOIN parses p ON p.id=c.parse_id JOIN versions v ON v.id=p.version_id WHERE ${where.join(' AND ')}`;
  const total=Number((this.db.prepare(`SELECT COUNT(*) n ${from}`).get(...args) as any).n);
  const rows=this.db.prepare(`SELECT c.*,s.doc_id,s.last_good_parse_id,s.last_usable_parse_id,p.status,p.parser_rev,p.kind parse_kind,p.created_at parse_at,v.raw_sha256,v.acquired_at ${from} ORDER BY s.doc_id,c.ordinal LIMIT ? OFFSET ?`).all(...args,limit,offset) as any[];
  const l=this.lane(),now=this.clock(),currents=new Map<number,any>();
  // Each row carries its source's current download/extraction status next to the displayed (possibly earlier) evidence.
  const currentOf=(sourceId:number)=>{if(!currents.has(sourceId))currents.set(sourceId,this.current(this.db.prepare('SELECT * FROM sources WHERE id=?').get(sourceId)));return currents.get(sourceId);};
  return {limits:DOCUMENT_LIMITS,view,total,nextCursor:offset+rows.length<total?String(offset+rows.length):null,
   lane:{state:l.blocked_category?'blocked':l.backoff_until>now?'rate-limit-backoff':l.lease_until>now?'running':'idle',blockedLabel:failureLabel(l.blocked_category),nextRunAt:isoOrNull(l.next_run_at)},
   candidates:rows.map(r=>{const d=JSON.parse(r.data_json);return {id:r.id,docId:r.doc_id,page:r.page,column:r.col,codeRaw:r.code_raw,codeNormalized:r.code_norm,heading:r.heading,ages:d.ages?.text??null,
    scheduleGroups:d.scheduleGroups.map((g:any)=>({dayTime:g.dayTime?.text??null,location:g.location?.text??null,dates:g.dates.map((x:any)=>x.text)})),instructor:d.instructor?.text??null,fee:d.fee?.text??null,
    warnings:d.warnings,duplicateCodeCount:d.duplicateCodeCount,evidenceText:String(r.block_text).slice(0,4000),blockSha256:d.blockSha256,bbox:d.bbox,documentSha256:r.raw_sha256,acquiredAt:r.acquired_at,
    parse:{parseId:r.parse_id,status:r.status,parserRevision:r.parser_rev,kind:r.parse_kind,createdAt:r.parse_at,lastGood:Number(r.last_good_parse_id)===Number(r.parse_id),lastUsable:Number(r.last_usable_parse_id)===Number(r.parse_id)},
    current:currentOf(Number(r.source_id))};})};
 }
 candidateDetail(id:string){
  if(!/^dc_[a-f0-9]{32}$/.test(id))return null;
  const r=this.db.prepare('SELECT c.*,s.id sid FROM candidates c JOIN sources s ON s.id=c.source_id WHERE c.id=?').get(id) as any;if(!r)return null;
  const s=this.db.prepare('SELECT * FROM sources WHERE id=?').get(r.sid) as any,parse=this.parseView(r.parse_id)!;
  return {limits:DOCUMENT_LIMITS,candidate:JSON.parse(r.data_json),docId:s.doc_id,parse:{...parse,isLatest:Number(s.latest_parse_id)===Number(r.parse_id),isLastGood:Number(s.last_good_parse_id)===Number(r.parse_id),isLastUsable:Number(s.last_usable_parse_id)===Number(r.parse_id)},
   version:this.versionView(parse.versionId),source:this.sourceView(s)};
 }
 sourceDetail(docId:string|number){
  if(!/^[1-9]\d{0,8}$/.test(String(docId)))return null;
  const s=this.db.prepare("SELECT * FROM sources WHERE kind='document' AND doc_id=?").get(Number(docId)) as any;if(!s)return null;
  const attempts=(this.db.prepare('SELECT * FROM attempts WHERE source_id=? ORDER BY id DESC LIMIT 10').all(s.id) as any[]).map(a=>({fence:a.fence,url:a.url,outcome:a.outcome,category:a.category,label:failureLabel(a.category),status:a.status,contentType:a.content_type,bytes:a.bytes,startedAt:a.started_at,completedAt:a.completed_at,versionId:a.version_id}));
  const versions=(this.db.prepare('SELECT id FROM versions WHERE source_id=? ORDER BY id DESC').all(s.id) as any[]).map(v=>this.versionView(Number(v.id)));
  const parses=(this.db.prepare('SELECT p.id FROM parses p JOIN versions v ON v.id=p.version_id WHERE v.source_id=? ORDER BY p.id DESC').all(s.id) as any[]).map(p=>this.parseView(Number(p.id)));
  return {limits:DOCUMENT_LIMITS,source:this.sourceView(s),attempts,versions,parses};
 }
}
