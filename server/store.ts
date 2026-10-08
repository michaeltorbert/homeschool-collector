import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash,createHmac,randomBytes,randomUUID} from 'node:crypto';
import {LOCAL_SCOPE,REASONS,CONCERN_DIMENSIONS,FIT_DIMENSIONS,groundedFeatures,attendanceSnapshot,projectDecision,projectOverride,ageBasis,type DecisionEvent,type ReasonCode} from '../src/decisions.ts';
import {defaults,parseCalendar,semantic,assess,PARTS,type Opportunity,type Part,type Settings} from '../src/domain.ts';
import {EVIDENCE_REVISION,UNKNOWN_LIMITS,CATALOG_LABEL,measureResponse,outcomeOf,compareMaps,overlap,type Measurement,type UidMap} from '../src/sourceEvidence.ts';
import {INSTRUCTION_VERSION,REPLAY_ONLY_INSTRUCTION_VERSIONS,LEARNING_ALGORITHM_REVISION,explicitRelevance,learnedScore,compareRanked,resolveInstructions} from '../src/learning.ts';
import {LearningService} from './learning.ts';
import {civilDateIn,validateProfile,describeProfile,AGE_DOMAIN,ProfileError,type ProfileInput} from '../src/age.ts';
import {assessAge,ageRuleFacts,canonicalAgeFacts,canonicalAgeOutcome,AGE_EXTRACTOR_REVISION,AGE_ASSESSMENT_REVISION,SUPPORTED_GRAMMAR,type ProfileBasis} from '../src/ageEvidence.ts';
export const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const json=(v:any)=>JSON.stringify(v);
const parse=(v:any)=>JSON.parse(String(v));
const COMMAND_KEY=/^[A-Za-z0-9_-]{8,100}$/;
// Thrown when an expected revision/decision/override is no longer current; the client must reload explicitly.
export class ConflictError extends Error {}
// Issue #7 acquisition evidence. A typed guard rejection (expired/superseded/stale/older) writes nothing; orchestration reports
// it as a non-persisted superseded result. Other errors are never relabelled as guard rejections.
export class AcquisitionGuardError extends Error {constructor(readonly reason:'expired'|'superseded'|'stale-sequence'|'older-acquisition',message:string){super(message);}}
// A fixed archive batch whose recorded receipt payload differs: rejected with no writes and reported safely at startup.
export class ArchiveImportConflictError extends ConflictError {}
export class ScanBusyError extends Error {}
export const FAILURE_CATEGORIES=['denied','rate-limited','http-status','transport-error','timeout','too-large','no-body','stream-error','not-calendar','parse-error','unclassified'] as const;
export type FailureCategory=typeof FAILURE_CATEGORIES[number];
export interface AcquisitionMeta {method:'ordinary-get'|'archive-import'|'unrecorded';startedAt:string|null;completedAt:string|null;runtime:string|null;status:number|null;contentType:string|null;bytes:number|null;advertisedBytes:number|null;category:FailureCategory|null}
export const SOURCE_RETENTION={attemptsPerPart:100,uidMapsPerPart:3,rawResponsesPerPart:40,historyShown:10};
const ACQUISITION_REVISION='acquisition-v1';
// One acquisition per part per scan: identity is derived from the server fence, never chosen by a caller.
export const attemptIdFor=(fence:number,part:Part)=>`scan-${fence}-${part}`;
// Fixed parent-facing labels built from structured categories/status only, never from response bodies or exception text.
export function failureLabel(category:string|null,status:number|null){
 const http=Number.isInteger(status)?` (HTTP ${status})`:'';
 switch(category){
  case 'denied':return `Access denied${http}; request stopped, no bypass attempted.`;
  case 'rate-limited':return `Rate limited${http}; request stopped, no retry.`;
  case 'http-status':return `Unsuccessful response${http}; request stopped.`;
  case 'transport-error':return 'Network or redirect failure; request stopped, no retry.';
  case 'timeout':return 'Timed out; request stopped.';
  case 'too-large':return 'Response exceeds the 2 MB limit; request stopped.';
  case 'no-body':return 'No calendar response body.';
  case 'stream-error':return 'Response stream failed before completion.';
  case 'not-calendar':return `Response was not a complete calendar${http}; not stored.`;
  case 'parse-error':return 'Calendar could not be read; not stored.';
  default:return 'Check failed; no detail recorded.';
 }
}
const OUTCOME_LABELS:Record<string,string>={ok:'Successful',empty:'Empty',partial:'Partial',failed:'Failed'};
const PARTIAL_ERROR=/^(\d{1,9}) rejected observations; last-known data retained\.$/;
const isoOrNull=(v:any)=>typeof v==='string'&&v.length<=40&&Number.isFinite(Date.parse(v))?new Date(Date.parse(v)).toISOString():null;
const countOrNull=(v:any)=>Number.isSafeInteger(v)&&v>=0?v as number:null;
// Bounds caller-supplied acquisition metadata to known shapes so no arbitrary string is persisted or replayed.
function cleanAcquisition(m:any,failed:boolean):AcquisitionMeta{
 return {method:['ordinary-get','archive-import','unrecorded'].includes(m?.method)?m.method:'unrecorded',startedAt:isoOrNull(m?.startedAt),completedAt:isoOrNull(m?.completedAt),
  runtime:typeof m?.runtime==='string'&&/^v\d{1,3}\.\d{1,4}\.\d{1,4}$/.test(m.runtime)?m.runtime:null,
  status:Number.isInteger(m?.status)&&m.status>=100&&m.status<=599?m.status:null,
  contentType:typeof m?.contentType==='string'&&/^(?:[a-z0-9!#$&^_.+-]{1,60}\/[a-z0-9!#$&^_.+-]{1,60}|unrecognized)$/.test(m.contentType)?m.contentType:null,
  bytes:countOrNull(m?.bytes),advertisedBytes:countOrNull(m?.advertisedBytes),
  category:failed?((FAILURE_CATEGORIES as readonly string[]).includes(m?.category)?m.category:'unclassified'):null};
}
// Envelope shape for versions written before representations were recorded.
const envelopeOf=(data:any,memberships:string[])=>({event:data.event,representations:data.representations??memberships.map((p,i)=>({part:p,event:data.variants?.[i]??data.event}))});
export class Store {
 db:DatabaseSync;
 private depth=0;
 clock:()=>Date;
 learning:LearningService;
 constructor(path:string,clock:()=>Date=()=>new Date()){
  this.clock=clock;
  this.learning=new LearningService(this);
  this.db=new DatabaseSync(path);
  try {
   // SQLite ignores foreign_keys changes inside a transaction. Enable and verify first.
   this.db.exec('PRAGMA foreign_keys = ON');
   if(this.db.prepare('PRAGMA foreign_keys').get()?.foreign_keys!==1)throw Error('SQLite foreign-key protection could not be enabled.');
   this.transaction(()=>{
this.db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));if(!(this.db.prepare('PRAGMA table_info(changes)').all() as any[]).some(c=>c.name==='cause'))this.db.exec("ALTER TABLE changes ADD COLUMN cause TEXT NOT NULL DEFAULT 'provider'");if(!(this.db.prepare('PRAGMA table_info(changes)').all() as any[]).some(c=>c.name==='notice_eligible')){this.db.exec('ALTER TABLE changes ADD COLUMN notice_eligible INTEGER NOT NULL DEFAULT 0');const legacy=this.db.prepare('SELECT change_id,fields_json FROM changes WHERE critical=1').all();for(const c of legacy){const fields=parse(c.fields_json);if(!fields.some((f:string)=>['start','end','status'].includes(f)))this.db.prepare('UPDATE changes SET critical=0 WHERE change_id=?').run(c.change_id);}}this.db.prepare('INSERT OR IGNORE INTO meta VALUES (?,?)').run('settings',json(defaults));this.db.prepare('INSERT OR IGNORE INTO meta VALUES (?,?)').run('fence','0');this.db.prepare('INSERT OR IGNORE INTO meta VALUES (?,?)').run('lease','0');for(const id of ['prcr','arts'])this.db.prepare('INSERT OR IGNORE INTO source_parts(id,health) VALUES (?,?)').run(id,'never checked');
    this.db.prepare('INSERT OR IGNORE INTO meta VALUES (?,?)').run('commandSecret',randomBytes(32).toString('hex'));
    // Earlier age_rule_state rows lack an outcome baseline; they are compared on facts only until refreshed.
    const stateColumns=(this.db.prepare('PRAGMA table_info(age_rule_state)').all() as any[]).map(c=>c.name);
    for(const column of ['profile_revision_id','assessment_revision','outcome_signature','outcome_json'])if(!stateColumns.includes(column))this.db.exec(`ALTER TABLE age_rule_state ADD COLUMN ${column} TEXT`);
    // Copy any legacy settings birthday, raw and unnormalized, before settings handling ignores it. Never auto-imported into a profile.
    const legacy=this.rawSettings().birthDate;
    if(legacy!==undefined&&legacy!==null&&!this.db.prepare('SELECT id FROM age_legacy_birth_date').get())this.db.prepare("INSERT INTO age_legacy_birth_date(id,raw_json,status,captured_at) VALUES (1,?,'pending',?)").run(json(legacy),this.clock().toISOString());
    // Seed unknown only when no profile exists yet.
    if(!this.db.prepare('SELECT seq FROM age_profile_revisions LIMIT 1').get())this.db.prepare("INSERT INTO age_profile_revisions(revision_id,subject_id,previous_revision_id,input_json,anchor_date,origin,created_at) VALUES (?,?,NULL,?,?,'seed',?)").run(randomUUID(),LOCAL_SCOPE.subjectId,json({kind:'unknown'}),civilDateIn(this.clock()),this.clock().toISOString());
   });
  } catch(error) {
   this.db.close();
   throw error;
  }
 }

 transaction<T>(fn:()=>T):T{const nested=this.depth>0,savepoint=`nested_${this.depth}`;this.db.exec(nested?`SAVEPOINT ${savepoint}`:'BEGIN IMMEDIATE');this.depth++;try{const result=fn();this.db.exec(nested?`RELEASE SAVEPOINT ${savepoint}`:'COMMIT');return result;}catch(e){this.db.exec(nested?`ROLLBACK TO SAVEPOINT ${savepoint}`:'ROLLBACK');if(nested)this.db.exec(`RELEASE SAVEPOINT ${savepoint}`);throw e;}finally{this.depth--;}}
 beginScan(now=Date.now()){return this.transaction(()=>{const expiry=Number(this.db.prepare('SELECT value FROM meta WHERE key=?').get('lease')?.value);if(expiry>now)throw new ScanBusyError('A scan is already in progress.');const fence=Number(this.db.prepare('SELECT value FROM meta WHERE key=?').get('fence')?.value)+1;this.db.prepare('UPDATE meta SET value=? WHERE key=?').run(String(fence),'fence');this.db.prepare('UPDATE meta SET value=? WHERE key=?').run(String(now+60_000),'lease');return {fence,expires:now+60_000};});}
 endScan(fence:number){if(Number(this.db.prepare('SELECT value FROM meta WHERE key=?').get('fence')?.value)===fence)this.db.prepare('UPDATE meta SET value=? WHERE key=?').run('0','lease');}
 ingest(part:Part,body:string,batchId:string,observedAt:string,kind:'archived'|'live',fence:number,now=Date.now(),cause:'provider'|'parser'='provider'){
  if(!Number.isFinite(Date.parse(observedAt)))throw Error('Invalid observation timestamp.');const payloadHash=hash(json({part,body,observedAt,kind,cause}));const prior=this.db.prepare('SELECT * FROM receipts WHERE batch_id=?').get(batchId);if(prior){if(prior.payload_hash!==payloadHash)throw Error('Batch ID payload conflict.');return parse(prior.receipt_json);}
  const parsed=parseCalendar(body);const received=new Date(now).toISOString();
  return this.transaction(()=>{if(fence!==Number(this.db.prepare('SELECT value FROM meta WHERE key=?').get('fence')?.value)||now>Number(this.db.prepare('SELECT value FROM meta WHERE key=?').get('lease')?.value))throw Error('Expired or superseded scan fence.');const health=this.db.prepare('SELECT * FROM source_parts WHERE id=?').get(part)!;if(fence<Number(health.sequence))throw Error('Stale acquisition sequence.');if(health.observed_at&&Date.parse(observedAt)<Date.parse(String(health.observed_at)))throw Error('Older observation cannot overwrite newer evidence.');
   this.db.prepare('INSERT INTO observations(part,batch_id,body_hash,body,observed_at,receipt_at,rejected_json) VALUES (?,?,?,?,?,?,?)').run(part,batchId,hash(body),body,observedAt,received,json(parsed.rejects));
   const seen=new Set<string>();const rejected=[...parsed.rejects];for(const e of parsed.events){if(seen.has(e.id)){rejected.push({index:-1,reason:`Duplicate UID ${e.uid} in one response; second representation quarantined.`});continue;}seen.add(e.id);this.db.prepare('INSERT INTO representations VALUES (?,?,?,?,?) ON CONFLICT(part,id) DO UPDATE SET data_json=excluded.data_json,observed_at=excluded.observed_at,kind=excluded.kind').run(part,e.id,json(e),observedAt,kind);}
   for(const id of seen){const reps=this.db.prepare('SELECT * FROM representations WHERE id=? ORDER BY part').all(id);const variants=reps.map(r=>parse(r.data_json) as Opportunity);const conflict=new Set(variants.map(e=>json(semantic(e)))).size>1;const previous=this.db.prepare('SELECT * FROM opportunities WHERE id=?').get(id);const data=variants[0];const memberships=reps.map(r=>r.part);const factObservedAt=String(reps[0].observed_at);const factKind=String(reps[0].kind);const normalized=json({facts:semantic(data),memberships,conflict,variants:conflict?variants.map(semantic):[]});const old=previous?parse(previous.data_json):null;const changed=!previous||old.normalized!==normalized;const version=Number(previous?.version??0)+(changed?1:0);if(changed){const envelope={event:data,normalized,variants:conflict?variants:[],representations:reps.map((r,i)=>({part:r.part,observedAt:r.observed_at,kind:r.kind,event:variants[i]}))};this.db.prepare('INSERT INTO opportunities VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json,version=excluded.version,observed_at=excluded.observed_at,kind=excluded.kind,conflict=excluded.conflict,memberships_json=excluded.memberships_json').run(id,json(envelope),version,previous?.first_seen??observedAt,factObservedAt,factKind,conflict?1:0,json(memberships));this.db.prepare('INSERT INTO versions VALUES (?,?,?,?)').run(id,version,json(envelope),received);const ageAfter=this.writeAgeState(id,version,envelope).facts;if(previous&&!(kind==='archived'&&previous.kind==='archived'&&previous.first_seen===observedAt)){const oldParts=parse(previous.memberships_json) as string[];const oldRepresentations=(old.representations??oldParts.map((p,i)=>({part:p,event:old.variants?.[i]??old.event}))).map((r:any)=>({part:r.part,facts:semantic(r.event)}));const newRepresentations=reps.map((r,i)=>({part:r.part,facts:semantic(variants[i])}));// Both sides use the current extractor, so an age change here is a real source-version difference.
const ageBefore=canonicalAgeFacts(ageRuleFacts(envelopeOf(old,oldParts)).facts);const before={...semantic(old.event),representations:oldRepresentations,'source agreement':Boolean(previous.conflict),'source memberships':oldParts,'age rule':ageBefore};const after={...semantic(data),representations:newRepresentations,'source agreement':conflict,'source memberships':memberships,'age rule':ageAfter};const fields=Object.keys(after).filter(k=>json((before as any)[k])!==json((after as any)[k]));const representationCritical=newRepresentations.some(r=>{const prior=oldRepresentations.find((p:any)=>p.part===r.part);const priorFacts=prior?.facts??semantic(old.event);return ['start','end','status'].some(f=>json((priorFacts as any)[f])!==json((r.facts as any)[f]));});this.db.prepare('INSERT INTO changes(id,version,fields_json,before_json,after_json,critical,created_at,cause,notice_eligible) VALUES (?,?,?,?,?,?,?,?,?)').run(id,version,json(fields),json(before),json(after),(representationCritical||fields.some(f=>['start','end','status','age rule'].includes(f)))?1:0,received,cause,(()=>{const family=this.db.prepare('SELECT interested,surfaced FROM family_state WHERE id=?').get(id);return family&&(family.interested||family.surfaced)?1:0;})());}}else this.db.prepare('UPDATE opportunities SET observed_at=?,kind=? WHERE id=?').run(factObservedAt,factKind,id);this.db.prepare('INSERT OR IGNORE INTO family_state(id) VALUES (?)').run(id);}
   this.db.prepare('UPDATE observations SET rejected_json=? WHERE batch_id=?').run(json(rejected),batchId);this.db.prepare('DELETE FROM observations WHERE part=? AND id NOT IN (SELECT id FROM observations WHERE part=? ORDER BY id DESC LIMIT 40)').run(part,part);const result={batchId,part,payloadHash,returned:parsed.returned,accepted:seen.size,rejected,processedAt:received,observedAt,kind,cause};this.db.prepare('INSERT INTO receipts VALUES (?,?,?)').run(batchId,payloadHash,json(result));if(cause==='parser')this.db.prepare('UPDATE source_parts SET sequence=? WHERE id=?').run(fence,part);else this.db.prepare('UPDATE source_parts SET health=?,observed_at=?,attempted_at=?,error=?,sequence=?,kind=? WHERE id=?').run(rejected.length?'partial':'ok',observedAt,received,rejected.length?`${rejected.length} rejected observations; last-known data retained.`:null,fence,kind,part);return result;});
 }
 // Legacy failure signature: caller text is ignored (never stored or shown). It records a bounded failed acquisition with
 // unknown transport fields under the same fence+part identity and shared guard as the new completion path.
 failure(part:Part,_error:string,fence:number,now=Date.now()){return this.completeFailure({part,fence,acquisition:{method:'unrecorded',completedAt:new Date(now).toISOString(),category:'unclassified'},now});}
 // Shared acquisition guard, checked inside the completion transaction before any attempt, evidence, ingestion or health
 // write, using the same `now` as the legacy ingestion it precedes.
 private acquisitionGuard(part:Part,fence:number,now:number,observedAt?:string){
  const meta=(key:string)=>Number(this.db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value);
  if(fence!==meta('fence'))throw new AcquisitionGuardError('superseded','Superseded scan fence.');
  if(now>meta('lease'))throw new AcquisitionGuardError('expired','Expired scan lease.');
  const health=this.db.prepare('SELECT * FROM source_parts WHERE id=?').get(part)!;
  if(fence<Number(health.sequence))throw new AcquisitionGuardError('stale-sequence','Stale acquisition sequence.');
  const latest=this.db.prepare('SELECT recorded_at FROM source_attempts WHERE part=? ORDER BY seq DESC LIMIT 1').get(part);
  if((latest&&now<Date.parse(String(latest.recorded_at)))||(health.attempted_at&&now<Date.parse(String(health.attempted_at))))throw new AcquisitionGuardError('older-acquisition','Older acquisition cannot follow a newer completed check.');
  if(observedAt&&health.observed_at&&Date.parse(observedAt)<Date.parse(String(health.observed_at)))throw new AcquisitionGuardError('older-acquisition','Older observation cannot overwrite newer evidence.');
 }
 // Exact replay of a retained acquisition returns its stored result; a differing completion for the same identity conflicts.
 // Once pruned, the identity is unknown here and its old fence fails the guard instead; nothing is regenerated.
 private replayAttempt(attemptId:string,payloadHash:string){const prior=this.db.prepare('SELECT payload_hash,result_json FROM source_attempts WHERE attempt_id=?').get(attemptId);if(!prior)return null;if(prior.payload_hash!==payloadHash)throw new ConflictError('Acquisition completion conflicts with the recorded attempt.');return parse(prior.result_json);}
 private insertAttempt(row:{attemptId:string;part:Part;fence:number;origin:string;outcome:string;payloadHash:string;batchId:string|null;observedAt:string|null;acquisition:AcquisitionMeta;measurement:Measurement|null;comparison:any;result:any;recordedAt:string}){
  const a=row.acquisition;
  this.db.prepare('INSERT INTO source_attempts(attempt_id,part,fence,origin,scope,outcome,payload_hash,batch_id,observed_at,method,started_at,completed_at,runtime,http_status,content_type,bytes,advertised_bytes,error_category,evidence_revision,parser_revision,measurement_json,comparison_json,result_json,recorded_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
   .run(row.attemptId,row.part,row.fence,row.origin,PARTS[row.part].url,row.outcome,row.payloadHash,row.batchId,row.observedAt,a.method,a.startedAt,a.completedAt,a.runtime,a.status,a.contentType,a.bytes,a.advertisedBytes,a.category,EVIDENCE_REVISION,this.parserRevision(),row.measurement?json(row.measurement):null,row.comparison?json(row.comparison):null,json(row.result),row.recordedAt);
  // Deterministic oldest-first pruning: 100 completed attempts per part; cascades remove their identity maps.
  this.db.prepare('DELETE FROM source_attempts WHERE part=? AND seq NOT IN (SELECT seq FROM source_attempts WHERE part=? ORDER BY seq DESC LIMIT ?)').run(row.part,row.part,SOURCE_RETENTION.attemptsPerPart);
 }
 // Frozen per-part comparison with the previous successful acquisition of the same configured scope, origin and evidence
 // revision. Parser receipts and failed checks are never baselines; a pruned map is unavailable, never empty.
 // The nearest previous success is the only candidate: if it was measured under another evidence or parser revision the
 // comparison is revision-changed (unknown), never an older compatible success searched for past it.
 private compareWithPrevious(part:Part,origin:string,current:UidMap,partial:boolean,parserRevision:string){
  const previous=this.db.prepare("SELECT a.attempt_id,a.recorded_at,a.observed_at,a.outcome,a.evidence_revision,a.parser_revision,m.map_json FROM source_attempts a LEFT JOIN source_uid_maps m ON m.attempt_id=a.attempt_id WHERE a.part=? AND a.origin=? AND a.scope=? AND a.outcome<>'failed' ORDER BY a.seq DESC LIMIT 1").get(part,origin,PARTS[part].url);
  if(!previous)return {status:'no-previous'};
  const base={previousAttemptId:String(previous.attempt_id),previousRecordedAt:String(previous.recorded_at),previousObservedAt:String(previous.observed_at),previousPartial:previous.outcome==='partial',currentPartial:partial};
  if(previous.evidence_revision!==EVIDENCE_REVISION||previous.parser_revision!==parserRevision)return {status:'revision-changed',...base,previousParserRevision:String(previous.parser_revision),currentParserRevision:parserRevision};
  if(previous.map_json==null)return {status:'unavailable',...base};
  return {status:'compared',...base,...compareMaps(parse(previous.map_json),current),comparability:base.previousPartial||partial?'lowered: partial response':'publisher scope unproved'};
 }
 // New guarded success completion for live checks and archive imports. Identity/replay first, then the shared guard, then
 // unchanged legacy ingestion, measurement, comparison and retention, all in one transaction.
 completeSuccess(input:{part:Part;fence:number;origin:'live'|'archived';body:string;observedAt:string;batchId?:string;acquisition:any;now?:number}){
  const {part,fence,origin,body,observedAt}=input,now=input.now??Date.now();
  if(!Object.hasOwn(PARTS,part))throw Error('Unknown source part.');
  if(origin!=='live'&&origin!=='archived')throw Error('Invalid acquisition origin.');
  if(!Number.isFinite(Date.parse(observedAt)))throw Error('Invalid observation timestamp.');
  const attemptId=attemptIdFor(fence,part),batchId=input.batchId??`acquisition-${attemptId}`,acquisition=cleanAcquisition(input.acquisition,false);
  const payloadHash=hash(json({revision:ACQUISITION_REVISION,attemptId,part,fence,origin,completion:'success',observedAt,bodyHash:hash(body),batchId,acquisition}));
  return this.transaction(()=>{
   const prior=this.replayAttempt(attemptId,payloadHash);if(prior)return prior;
   this.acquisitionGuard(part,fence,now,observedAt);
   // An existing receipt would make legacy ingestion return early without writes; never append evidence on top of it.
   if(this.db.prepare('SELECT 1 FROM receipts WHERE batch_id=?').get(batchId))throw new ConflictError('This acquisition batch is already recorded.');
   const {measurement,uidMap}=measureResponse(body,hash),outcome=outcomeOf(measurement);
   this.ingest(part,body,batchId,observedAt,origin,fence,now,'provider');
   const recordedAt=new Date(now).toISOString(),comparison=this.compareWithPrevious(part,origin,uidMap,outcome==='partial',this.parserRevision());
   const result={attemptId,part,origin,outcome,observedAt,recordedAt,returned:measurement.returned,accepted:measurement.accepted,parserRejects:measurement.parserRejects,duplicates:measurement.duplicates};
   this.insertAttempt({attemptId,part,fence,origin,outcome,payloadHash,batchId,observedAt,acquisition,measurement,comparison,result,recordedAt});
   this.db.prepare('INSERT INTO source_uid_maps(attempt_id,part,map_json) VALUES (?,?,?)').run(attemptId,part,json(uidMap));
   this.db.prepare('DELETE FROM source_uid_maps WHERE part=? AND attempt_id NOT IN (SELECT m.attempt_id FROM source_uid_maps m JOIN source_attempts a ON a.attempt_id=m.attempt_id WHERE m.part=? ORDER BY a.seq DESC LIMIT ?)').run(part,part,SOURCE_RETENTION.uidMapsPerPart);
   return result;
  });
 }
 // Failed check: bounded categorical evidence plus latest health, atomically; last successful data and times untouched.
 completeFailure(input:{part:Part;fence:number;acquisition:any;now?:number}){
  const {part,fence}=input,now=input.now??Date.now();
  if(!Object.hasOwn(PARTS,part))throw Error('Unknown source part.');
  const attemptId=attemptIdFor(fence,part),acquisition=cleanAcquisition(input.acquisition,true);
  const payloadHash=hash(json({revision:ACQUISITION_REVISION,attemptId,part,fence,origin:'live',completion:'failure',acquisition}));
  return this.transaction(()=>{
   const prior=this.replayAttempt(attemptId,payloadHash);if(prior)return prior;
   this.acquisitionGuard(part,fence,now);
   const recordedAt=new Date(now).toISOString(),result={attemptId,part,origin:'live',outcome:'failed',category:acquisition.category,status:acquisition.status,recordedAt};
   this.insertAttempt({attemptId,part,fence,origin:'live',outcome:'failed',payloadHash,batchId:null,observedAt:null,acquisition,measurement:null,comparison:null,result,recordedAt});
   this.db.prepare('UPDATE source_parts SET health=?,attempted_at=?,error=? WHERE id=?').run('failed',recordedAt,failureLabel(acquisition.category,acquisition.status),part);
   return result;
  });
 }
 // Dated archive import. observedAt stays the original capture time; completion/guard use the actual import time and the
 // runtime is the import runtime, not a claimed original network capture. An existing fixed-batch receipt without an
 // acquisition is verified through unchanged legacy replay and returned as non-acquisition evidence with no writes.
 recordArchived(input:{part:Part;body:string;observedAt:string;batchId:string;fence:number;now?:number}){
  const {part,body,observedAt,batchId,fence}=input,now=input.now??Date.now();
  const args={part,fence,origin:'archived' as const,body,observedAt,batchId,acquisition:{method:'archive-import',completedAt:new Date(now).toISOString(),runtime:process.version},now};
  if(this.db.prepare('SELECT 1 FROM source_attempts WHERE attempt_id=?').get(attemptIdFor(fence,part))){const r=this.completeSuccess(args);return {status:'replayed',attemptId:r.attemptId as string|undefined};}
  const prior=this.db.prepare('SELECT payload_hash FROM receipts WHERE batch_id=?').get(batchId);
  if(prior){
   if(prior.payload_hash!==hash(json({part,body,observedAt,kind:'archived',cause:'provider'})))throw new ArchiveImportConflictError('Archived import batch conflicts with its recorded receipt.');
   this.ingest(part,body,batchId,observedAt,'archived',fence,now);
   return {status:'existing-receipt',attemptId:undefined};
  }
  const r=this.completeSuccess(args);return {status:'recorded',attemptId:r.attemptId as string|undefined};
 }
 // Source-part rows for the snapshot with errors sanitized on read; stored legacy rows are left unchanged.
 private sourceRows():Record<string,any>[]{
  return this.db.prepare('SELECT * FROM source_parts ORDER BY id').all().map(r=>{
   let error:string|null=null;
   if(r.error!=null){
    const latest=this.db.prepare('SELECT * FROM source_attempts WHERE part=? ORDER BY seq DESC LIMIT 1').get(r.id),partial=PARTIAL_ERROR.exec(String(r.error));
    if(latest&&latest.outcome==='failed'&&r.health==='failed'&&latest.recorded_at===r.attempted_at)error=failureLabel(latest.error_category as string|null,latest.http_status as number|null);
    else if(partial)error=`${Number(partial[1])} rejected observations; last-known data retained.`;
    else error=r.health==='failed'?'Failed (legacy detail not shown)':'Detail not shown';
   }
   return {...r,error};
  });
 }
 private overlapCache=new Map<string,ReturnType<typeof overlap>>();
 // Bounded per-part evidence for polling: summaries only, never response bodies or identity maps.
 sourceEvidence(){
  const view=(r:any)=>{const m=r.measurement_json?parse(r.measurement_json) as Measurement:null;return {attemptId:String(r.attempt_id),fence:Number(r.fence),origin:String(r.origin),outcome:String(r.outcome),label:r.outcome==='failed'?failureLabel(r.error_category,r.http_status):OUTCOME_LABELS[String(r.outcome)],recordedAt:String(r.recorded_at),observedAt:r.observed_at??null,method:String(r.method),startedAt:r.started_at??null,completedAt:r.completed_at??null,runtime:r.runtime??null,status:r.http_status??null,contentType:r.content_type??null,bytes:r.bytes??null,category:r.error_category??null,returned:m?.returned??null,accepted:m?.accepted??null};};
  const parts:Record<string,any>={},currentParserRevision=this.parserRevision();
  for(const part of Object.keys(PARTS) as Part[]){
   const health=this.db.prepare('SELECT * FROM source_parts WHERE id=?').get(part)!;
   const history=this.db.prepare('SELECT * FROM source_attempts WHERE part=? ORDER BY seq DESC LIMIT ?').all(part,SOURCE_RETENTION.historyShown);
   const success=this.db.prepare("SELECT * FROM source_attempts WHERE part=? AND outcome<>'failed' ORDER BY seq DESC LIMIT 1").get(part);
   // Latest success evidence is current only when its own provider receipt is still the newest provider intake for the part.
   // A later direct legacy provider ingest (even with the same observation time) adds a newer provider receipt and so
   // unlinks it; exact receipt replay adds nothing and parser corrections add parser-cause receipts, so both keep the link.
   const linked=(row:any)=>{
    const receipt=this.db.prepare('SELECT rowid FROM receipts WHERE batch_id=?').get(row.batch_id);
    if(!receipt)return false;
    return !this.db.prepare("SELECT 1 FROM receipts WHERE rowid>? AND json_extract(receipt_json,'$.part')=? AND COALESCE(json_extract(receipt_json,'$.cause'),'provider')='provider' LIMIT 1").get(receipt.rowid,part);
   };
   const successCurrent=success&&success.observed_at===health.observed_at&&success.origin===health.kind&&linked(success)?success:null;
   // The latest attempt is current only when it is the exact acquisition behind the current health fields: a failure while
   // health is still failed at that time, or the linked latest success while health is not failed.
   const top=history[0],latestCurrent=top&&top.recorded_at===health.attempted_at&&(top.outcome==='failed'?health.health==='failed':health.health!=='failed'&&successCurrent?.attempt_id===top.attempt_id)?top:null;
   const mapRetained=Boolean(successCurrent&&this.db.prepare('SELECT 1 FROM source_uid_maps WHERE attempt_id=?').get(successCurrent.attempt_id));
   parts[part]={part,name:PARTS[part].name,
    latestAttempt:latestCurrent?view(latestCurrent):null,
    latestSuccess:successCurrent?{...view(successCurrent),measurement:parse(successCurrent.measurement_json),comparison:parse(successCurrent.comparison_json),evidenceRevision:String(successCurrent.evidence_revision),parserRevision:String(successCurrent.parser_revision),
     // Derived on read; frozen rows are never rewritten. A later parser revision makes these figures an earlier reading.
     currentParserRevision,revisionCurrent:successCurrent.parser_revision===currentParserRevision&&successCurrent.evidence_revision===EVIDENCE_REVISION,mapRetained}:null,
    // earlier-check: data from before acquisition evidence existed; unrecorded-intake: a newer intake without an acquisition
    // record (direct legacy ingest) superseded the retained one; no-longer-retained: its record was pruned.
    successEvidence:!health.observed_at?'none':successCurrent?'available':success?'unrecorded-intake':Number(this.db.prepare('SELECT count(*) n FROM source_attempts WHERE part=?').get(part)!.n)>0?'no-longer-retained':'earlier-check',
    retainedCount:Number(this.db.prepare('SELECT count(*) n FROM representations WHERE part=?').get(part)!.n),
    currentResponseCount:successCurrent?parse(successCurrent.measurement_json).accepted:null,
    history:history.map(view)};
  }
  const a=parts.prcr.latestSuccess,b=parts.arts.latestSuccess;let crossPart:any={status:'unavailable',reason:'A current successful response from each feed is needed.'};
  if(a&&b&&(a.parserRevision!==b.parserRevision||a.evidenceRevision!==b.evidenceRevision))crossPart={status:'unavailable',reason:'The two feeds were read with different parser versions, so agreement is unknown.'};
  else if(a&&b){
   const maps=[a,b].map(s=>this.db.prepare('SELECT map_json FROM source_uid_maps WHERE attempt_id=?').get(s.attemptId));
   if(maps.some(m=>!m))crossPart={status:'unavailable',reason:'Response identities for the latest successful check are no longer retained.'};
   else{
    const key=`${a.attemptId}|${b.attemptId}`;if(!this.overlapCache.has(key)){this.overlapCache.clear();this.overlapCache.set(key,overlap(parse(maps[0]!.map_json),parse(maps[1]!.map_json)));}
    const side=(s:any)=>({attemptId:s.attemptId,origin:s.origin,observedAt:s.observedAt,recordedAt:s.recordedAt,partial:s.outcome==='partial'});
    crossPart={status:'available',...this.overlapCache.get(key)!,sameScan:a.fence===b.fence,simultaneous:false,prcr:side(a),arts:side(b)};
   }
  }
  return {revision:EVIDENCE_REVISION,limits:UNKNOWN_LIMITS,catalog:{status:'not-connected',label:CATALOG_LABEL},retention:SOURCE_RETENTION,parts,crossPart};
 }
 reparseLatest(revision:string){if(this.db.prepare('SELECT value FROM meta WHERE key=?').get('parserRevision')?.value===revision)return;const token=this.beginScan();try{this.transaction(()=>{const latest=(['prcr','arts'] as Part[]).map(part=>this.db.prepare('SELECT o.*,s.kind FROM observations o JOIN source_parts s ON s.id=o.part WHERE o.part=? ORDER BY o.id DESC LIMIT 1').get(part)).filter(Boolean) as any[];for(const o of latest)for(const event of parseCalendar(String(o.body)).events)this.db.prepare('UPDATE representations SET data_json=? WHERE part=? AND id=?').run(json(event),o.part,event.id);for(const o of latest)this.ingest(o.part,String(o.body),`parser-${revision}-${o.part}-${o.body_hash}`,String(o.observed_at),String(o.kind) as 'live'|'archived',token.fence,Date.now(),'parser');this.db.prepare('INSERT INTO meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('parserRevision',revision);});}finally{this.endScan(token.fence);}}
 private rawSettings(){return parse(this.db.prepare('SELECT value FROM meta WHERE key=?').get('settings')!.value);}
 // Settings birthDate is deprecated: never exposed or used as an age authority. Any legacy value lives in the pending legacy record.
 settings(){return {...this.rawSettings(),birthDate:null} as Settings;}
 updateSettings(input:any){const current=this.settings(),stored=this.rawSettings().birthDate??null;if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid preferences.');if(input.fallSaturdays!==undefined&&typeof input.fallSaturdays!=='boolean')throw Error('Fall Saturday preference must be true or false.');const weights=Object.fromEntries(Object.keys(defaults.weights).map(k=>[k,Math.max(0,Math.min(10,Number(input.weights?.[k]??current.weights[k]??defaults.weights[k])))]));if(Object.values(weights).some(v=>!Number.isFinite(v)))throw Error('Invalid preference weights.');if(input.birthDate!=null)throw Error('Age is edited in the separate private age profile, not in preferences.');const settings={birthDate:null,fallSaturdays:input.fallSaturdays??current.fallSaturdays,weights};// An ordinary save cannot clear a stored legacy value; only explicit legacy confirm/discard does.
this.db.prepare('UPDATE meta SET value=? WHERE key=?').run(json({...settings,birthDate:stored}),'settings');return settings;}
 decisionHistory(id:string):DecisionEvent[]{return this.db.prepare('SELECT * FROM decision_events WHERE opportunity_id=? ORDER BY event_id').all(id).map(e=>({...e,payload:parse(e.payload_json),snapshot:parse(e.snapshot_json)})) as unknown as DecisionEvent[];}
 decision(input:any){
  if(!input||typeof input!=='object')throw Error('A decision command is required.');
  const {householdId=LOCAL_SCOPE.householdId,subjectId=LOCAL_SCOPE.subjectId,actorId=LOCAL_SCOPE.actorId}=input;
  if(householdId!==LOCAL_SCOPE.householdId||subjectId!==LOCAL_SCOPE.subjectId||actorId!==LOCAL_SCOPE.actorId)throw Error('Only the single local child, household and operator are supported. These labels are not authentication.');
  if(typeof input.commandKey!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(input.commandKey))throw Error('A valid idempotency key is required.');
  if(typeof input.id!=='string'||!['pass','undo','reconsider_review'].includes(input.action))throw Error('Invalid decision action.');
  const shownVersion=Number(input.shownVersion);if(!Number.isInteger(shownVersion)||shownVersion<1)throw Error('A shown source version is required.');
  if(input.action==='pass'&&(!Array.isArray(input.reasons)||input.reasons.length>Object.keys(REASONS).length))throw Error('Select at least one valid reason category.');
  const reasons:ReasonCode[]=input.action==='pass'?[...new Set(input.reasons)].sort() as ReasonCode[]:[];
  if(input.action==='pass'&&(!Array.isArray(input.reasons)||!reasons.length||reasons.some(r=>typeof r!=='string'||!Object.prototype.hasOwnProperty.call(REASONS,r))))throw Error('Select at least one valid reason category.');
  if(input.dimensions!==undefined&&(!Array.isArray(input.dimensions)||input.dimensions.length>5))throw Error('Invalid concern dimension.');
  const dimensions=input.action==='pass'&&reasons.includes('concern')?[...new Set(input.dimensions??[])].sort():[];
  if(!Array.isArray(input.dimensions??[])||dimensions.some(d=>!(CONCERN_DIMENSIONS as readonly unknown[]).includes(d)))throw Error('Invalid concern dimension.');
  if(reasons.includes('concern')&&!dimensions.length)throw Error('Select the concern: price, travel, format, duration or organizer.');
  const intent=reasons.includes('general')?input.generalIntent??'listing':'listing';if(!['listing','generally'].includes(intent))throw Error('Choose just this listing or generally.');
  const targetId=intent==='generally'?input.targetId:null,targetScope=intent==='generally'?input.targetScope:null;
  if(intent==='generally'&&(!targetId||!['child','household'].includes(targetScope)))throw Error('A grounded topic/aspect and deliberate scope are required.');
  if(input.note!==undefined&&typeof input.note!=='string')throw Error('Optional note must be text.');
  const note=input.action==='pass'?(input.note??'').trim():'';if(note.length>2000)throw Error('Optional note must be at most 2000 characters.');
  const expectedActiveDecisionId=input.expectedActiveDecisionId??null;
  if(expectedActiveDecisionId!==null&&typeof expectedActiveDecisionId!=='string')throw Error('Invalid prior decision identity.');
  const fitInput=input.fitDimensions??[];
  if(!Array.isArray(fitInput)||fitInput.length>Object.keys(FIT_DIMENSIONS).length||fitInput.some((d:any)=>typeof d!=='string'||!Object.prototype.hasOwnProperty.call(FIT_DIMENSIONS,d))||new Set(fitInput).size!==fitInput.length)throw Error('Invalid wrong-fit clarification.');
  if(fitInput.length&&(input.action!=='pass'||!reasons.includes('wrong-fit')))throw Error('A wrong-fit clarification requires the wrong-fit reason.');
  const fitDimensions=[...fitInput].sort();
  const reviewKind=input.reviewKind??'attendance';
  if(!['attendance','age'].includes(reviewKind)||(reviewKind==='age'&&input.action!=='reconsider_review')||(reviewKind!=='age'&&input.reviewKey!==undefined))throw Error('Invalid reconsideration kind.');
  if(reviewKind==='age'&&typeof input.reviewKey!=='string')throw Error('The exact age reconsideration key is required.');
  const shownProfileRevisionId=input.shownProfileRevisionId??null;
  if(shownProfileRevisionId!==null&&typeof shownProfileRevisionId!=='string')throw Error('Invalid shown profile revision.');
  // A new Generally pass names the learning-instruction contract it was shown; it sets exactly that scoped feature to 0.
  // It also names the exact instruction it reviewed at that scope/topic (null when none), so it cannot silently replace a newer one.
  const instructionVersion=input.instructionVersion;
  if(instructionVersion!==undefined&&(![INSTRUCTION_VERSION,...REPLAY_ONLY_INSTRUCTION_VERSIONS].includes(instructionVersion)||input.action!=='pass'||intent!=='generally'))throw Error('Invalid learning-instruction version.');
  const expectedInstructionId=input.expectedInstructionId;
  if(instructionVersion===INSTRUCTION_VERSION&&expectedInstructionId===undefined)throw Error('The reviewed instruction for this topic and scope is required.');
  if(expectedInstructionId!==undefined&&(instructionVersion!==INSTRUCTION_VERSION||(expectedInstructionId!==null&&(typeof expectedInstructionId!=='string'||expectedInstructionId.length>100))))throw Error('Invalid reviewed instruction identity.');
  // New fields enter the canonical payload only when present, so pre-upgrade commands replay with identical receipts.
  const canonical={id:input.id,action:input.action,shownVersion,householdId,subjectId,actorId,reasons,dimensions,generalIntent:intent,targetId,targetScope,note,expectedActiveDecisionId,targetDecisionId:input.targetDecisionId??null,...(fitDimensions.length?{fitDimensions}:{}),...(reviewKind==='age'?{reviewKind,reviewKey:input.reviewKey}:{}),...(shownProfileRevisionId?{shownProfileRevisionId}:{}),...(instructionVersion!==undefined?{instructionVersion}:{}),...(expectedInstructionId!==undefined?{expectedInstructionId}:{})};
  const payloadHash=hash(json(canonical));
  return this.transaction(()=>{
   const prior=this.db.prepare('SELECT * FROM decision_events WHERE command_key=?').get(input.commandKey);if(prior){if(prior.payload_hash!==payloadHash)throw Error('Decision idempotency key payload conflict.');return parse(prior.result_json);}
   // Checked only after exact receipt replay, so genuine pre-upgrade and earlier-version Generally receipts still replay unchanged.
   if(intent==='generally'&&instructionVersion!==INSTRUCTION_VERSION)throw new ConflictError('This page predates the current scoped learning instructions. Reload before choosing Generally.');
   if(intent==='generally'){
    const current=resolveInstructions(this.learning.project().instructions).layers[targetScope as 'child'|'household'].get(targetId)??null;
    if((current?.eventId??null)!==expectedInstructionId)throw new ConflictError('The instruction for this topic and scope changed in another window. Review the current value before passing generally; your reasons are kept.');
   }
   const opportunity=this.db.prepare('SELECT * FROM opportunities WHERE id=?').get(input.id);if(!opportunity)throw Error('Unknown opportunity.');
   const version=this.db.prepare('SELECT * FROM versions WHERE id=? AND version=?').get(input.id,shownVersion);if(!version)throw Error('Shown source version does not exist.');
   const envelope=parse(version.data_json),currentEnvelope=parse(opportunity.data_json),features=groundedFeatures(envelope.event);
   if(intent==='generally'&&!features.some(f=>f.id===targetId))throw Error('The selected topic/aspect is not grounded in the source version shown.');
   const profile=this.profileBasis();
   if(shownProfileRevisionId&&shownProfileRevisionId!==profile.revisionId)throw new ConflictError('The age profile changed after this listing was shown. Reload before submitting.');
   const currentAge=this.ageFor(currentEnvelope,Number(opportunity.version),profile),shownAge=this.ageFor(envelope,shownVersion,profile);
   const projection=projectDecision(this.decisionHistory(input.id),currentEnvelope,this.clock(),currentAge,hash);
   if((projection.active?.decision_id??null)!==expectedActiveDecisionId)throw new ConflictError('The active decision changed. Reload and review it before submitting.');
   let supersedes:string|null=null,reverses:string|null=null,target:string|null=null;
   if(input.action==='pass')supersedes=projection.active?.decision_id??null;
   else {target=canonical.targetDecisionId;if(!target||target!==projection.active?.decision_id)throw Error('Only the exact active decision can be undone or reconsidered.');if(input.action==='undo')reverses=target;}
   if(reviewKind==='age'&&projection.ageReconsider?.key!==input.reviewKey)throw new ConflictError('The age reconsideration shown is no longer current. Reload before marking it seen.');
   const learningState=intent==='generally'?this.learning.state(this.settings()):null,instructionId=intent==='generally'?randomUUID():null;
   const learning={enabled:this.learning.project().control.status==='on',algorithmRevision:LEARNING_ALGORITHM_REVISION,scope:targetScope,targetId,contribution:null,
    // Passes never create weak positive learning. Only a versioned Generally pass sets one scoped instruction, linked to this pass.
    instruction:instructionId?{instructionId,version:instructionVersion,reviewedInstructionId:expectedInstructionId,featureId:targetId,scope:targetScope,value:0,resolvedBefore:learningState!.stats.get(targetId)?.resolved??null}:null};
   const representations=(envelope.representations??[{part:'not recorded in this version',event:envelope.event}]).map((r:any)=>({part:r.part,observedAt:r.observedAt??null,kind:r.kind??null,representationHash:hash(json(r.event)),event:r.event,features:groundedFeatures(r.event)}));
   const event=envelope.event as Opportunity,decisionScope=event.recurring?'program':'occurrence';
   const snapshot={revision:'reason-decision-v1',sourceVersion:shownVersion,sourceEnvelopeHash:hash(json(envelope)),event,representations,features,attendance:attendanceSnapshot(envelope),decisionScope,identity:decisionScope==='program'?event.id:`${event.id}:single`,limitations:event.recurring?'Individual dates need checking. Master schedule only; no expanded occurrence or recurring constraint is created.':'Single nonrecurring source event; no calendar constraint is created.',target:intent==='generally'?features.find(f=>f.id===targetId):null,learning,settingsRevision:hash(json(this.settings())),
    // Shown source version assessed against the current profile revision: revision IDs and material signatures only, no birthday.
    age:ageBasis(shownAge),
    // An age review records the exact current material state it acknowledged (its key was verified just above).
    ...(reviewKind==='age'?{ageReviewed:ageBasis(currentAge)}:{}),fit:fitDimensions.length?{dimensions:fitDimensions,scope:'child-listing',note:'Parent fit judgment; not provider evidence, a topic negative or a medical/readiness assessment.'}:null};
   const decisionId=randomUUID(),createdAt=this.clock().toISOString();const result={decisionId,action:input.action,shownVersion,currentVersion:Number(opportunity.version),staleAtSubmit:shownVersion<Number(opportunity.version),createdAt,...(instructionId?{instructionId}:{})};
   this.db.prepare('INSERT INTO decision_events(decision_id,command_key,payload_hash,opportunity_id,household_id,subject_id,actor_id,action,shown_version,payload_json,snapshot_json,supersedes_id,reverses_id,target_decision_id,result_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(decisionId,input.commandKey,payloadHash,input.id,householdId,subjectId,actorId,input.action,shownVersion,json(canonical),json(snapshot),supersedes,reverses,target,json(result),createdAt);
   // Pass and its exact instruction commit together; supersession or Undo of this pass retracts or restores only it.
   if(instructionId)this.learning.linkPassInstruction({instructionId,decisionId,scope:targetScope,featureId:targetId,payloadHash});
   return result;
  });
 }
 snapshot(now=this.clock()){const settings=this.settings(),profile=this.profileBasis(),calendarParserRevision=this.parserRevision(),learning=this.learning.state(settings);const items=this.db.prepare('SELECT o.*,f.interested,f.hidden,f.reviewed_version,f.surfaced FROM opportunities o JOIN family_state f USING(id)').all().map(r=>{const data=parse(r.data_json);const e=data.event as Opportunity;
  // Computed on read from the stored source version and current profile revision; no cache, no source version created.
  const age=assessAge(data,{sourceVersion:Number(r.version),calendarParserRevision,profile,hash});const decision=projectDecision(this.decisionHistory(e.id),data,now,age,hash);const ageOverride=this.projectOverride(e.id,age);const assessed=assess(e,settings,now,Boolean(r.conflict),age);const failing=assessed.rules.filter(rule=>rule.result==='fail');
  // Show anyway bypasses only the age placement rule; cancellation and other failed rules still exclude.
  const ageBypassed=Boolean(ageOverride.active)&&failing.length>0&&failing.every(rule=>rule.name==='Age');
  const verdict=ageBypassed?(assessed.rules.some(rule=>rule.result==='unknown')?'needs checking':'passes configured rules'):assessed.verdict;
  const ageAttention=this.db.prepare('SELECT * FROM age_attention WHERE id=? AND notice_eligible=1 AND ack_at IS NULL ORDER BY attention_id').all(e.id).map(a=>({attentionId:Number(a.attention_id),sourceVersion:Number(a.source_version),oldRevision:a.old_revision,newRevision:a.new_revision,oldSignature:a.old_signature,newSignature:a.new_signature,before:parse(a.before_json),after:parse(a.after_json),createdAt:a.created_at,label:'Age extraction/algorithm correction (local assessment, not a source change)'}));const changes:any[]=this.db.prepare('SELECT * FROM changes WHERE id=? ORDER BY change_id DESC').all(e.id).map(c=>({...c,fields:parse(c.fields_json),before:parse(c.before_json),after:parse(c.after_json)}));// Primary explicit relevance (Settings plus scoped instructions) and a separate bounded learned tie score.
  const grounded=groundedFeatures(e),explicit=explicitRelevance(e,settings,learning.overlay,grounded),learned=learnedScore(grounded,learning.stats,explicit.genericUncapped);
  return {...e,decision,passed:Boolean(decision.active),groundedFeatures:grounded,learnedScore:learned.score,learned,learning:this.learning.itemView(learning.projection,e.id,Boolean(r.interested)),legacyFeedback:this.db.prepare('SELECT direction,created_at FROM feedback WHERE opportunity_id=? ORDER BY id').all(e.id),version:Number(r.version),observedAt:r.observed_at,firstSeen:r.first_seen,kind:r.kind,memberships:parse(r.memberships_json),conflict:Boolean(r.conflict),variants:data.variants,representations:this.db.prepare('SELECT part,observed_at,kind FROM representations WHERE id=? ORDER BY part').all(e.id),interested:Boolean(r.interested),hidden:Boolean(r.hidden),reviewedVersion:Number(r.reviewed_version),unread:Number(r.reviewed_version)<Number(r.version),changes,notices:changes.filter((c:any)=>c.critical&&!c.ack_at&&c.notice_eligible),...assessed,verdict,age,ageOverride,ageBypassed,ageAttention,score:explicit.score,reasons:explicit.reasons};}).sort(compareRanked);
  // Only revision identity and coarse flags are exposed with items; profile fields are served by the separate profile endpoint.
  const ageProfile={revisionId:profile.revisionId,known:profile.feasible!==null,pendingLegacy:Boolean(this.db.prepare("SELECT id FROM age_legacy_birth_date WHERE status='pending'").get())};
  return {items,sources:this.sourceRows(),sourceEvidence:this.sourceEvidence(),settings,ageProfile,learning:this.learning.publicView(learning),serverTime:now.toISOString(),coverage:'unknown',localScope:LOCAL_SCOPE,counts:{identities:items.length,memberships:items.reduce((n,i)=>n+i.memberships.length,0),closures:items.filter(i=>i.closure).length},receipts:this.db.prepare('SELECT receipt_json FROM receipts ORDER BY rowid DESC LIMIT 5').all().map(r=>parse(r.receipt_json))};}
 action(id:string,action:string,value?:any){if(!this.db.prepare('SELECT id FROM opportunities WHERE id=?').get(id))throw Error('Unknown item.');return this.transaction(()=>{if(action==='surface')this.db.prepare('UPDATE family_state SET surfaced=1 WHERE id=?').run(id);else if(action==='interested'||action==='hidden')this.db.prepare(`UPDATE family_state SET ${action}=? WHERE id=?`).run(value?1:0,id);else if(action==='feedback'){if(!['more','less'].includes(value))throw Error('Invalid feedback.');this.db.prepare('INSERT INTO feedback(opportunity_id,direction,created_at) VALUES (?,?,?)').run(id,value,new Date().toISOString());}else if(action==='review'){const version=Number(value?.version);const current=Number(this.db.prepare('SELECT version FROM opportunities WHERE id=?').get(id)!.version);if(!Number.isInteger(version)||version<1||version>current||!Array.isArray(value?.changeIds))throw Error('Invalid visible review snapshot.');const ids=value.changeIds;if(ids.length>1000||ids.some((c:any)=>!Number.isInteger(c)))throw Error('Invalid change IDs.');for(const c of ids){const change=this.db.prepare('SELECT * FROM changes WHERE change_id=?').get(c);if(!change||change.id!==id||Number(change.version)>version)throw Error('Change is not part of the visible version.');}const now=new Date().toISOString();this.db.prepare('UPDATE family_state SET reviewed_version=MAX(reviewed_version,?),surfaced=1 WHERE id=?').run(version,id);for(const c of ids)this.db.prepare('UPDATE changes SET ack_at=? WHERE change_id=?').run(now,c);this.db.prepare('INSERT INTO acknowledgements(opportunity_id,version,change_ids_json,acknowledged_at) VALUES (?,?,?,?)').run(id,version,json(ids),now);}
  // Local age-correction attention has its own exact acknowledgement; source review never clears it and it never clears source review.
  else if(action==='age-attention-ack'){const row=this.db.prepare('SELECT * FROM age_attention WHERE attention_id=?').get(Number(value?.attentionId));if(!row||row.id!==id||row.new_signature!==value?.newSignature||row.old_signature!==value?.oldSignature)throw Error('This age correction is not the one shown. Reload before acknowledging.');if(!row.ack_at)this.db.prepare('UPDATE age_attention SET ack_at=? WHERE attention_id=?').run(this.clock().toISOString(),row.attention_id);}
  else throw Error('Unknown action.');});}
 private parserRevision(){return String(this.db.prepare('SELECT value FROM meta WHERE key=?').get('parserRevision')?.value??'initial');}
 private mac(value:string){return createHmac('sha256',String(this.db.prepare('SELECT value FROM meta WHERE key=?').get('commandSecret')!.value)).update(value).digest('hex');}
 private profileRow(){
  const row=this.db.prepare('SELECT * FROM age_profile_revisions ORDER BY seq DESC LIMIT 1').get()!;
  const input=parse(row.input_json) as ProfileInput,anchorDate=String(row.anchor_date);
  return {revisionId:String(row.revision_id),seq:Number(row.seq),input,anchorDate,origin:String(row.origin),createdAt:String(row.created_at),previousRevisionId:row.previous_revision_id as string|null,feasible:validateProfile(input,anchorDate).feasible};
 }
 profileBasis():ProfileBasis{const row=this.profileRow();return {revisionId:row.revisionId,feasible:row.feasible};}
 ageFor(envelope:any,sourceVersion:number,profile=this.profileBasis()){return assessAge(envelope,{sourceVersion,calendarParserRevision:this.parserRevision(),profile,hash});}
 // Full private profile view for the Preferences editor only.
 profileView(){
  const current=this.profileRow(),legacy=this.db.prepare('SELECT * FROM age_legacy_birth_date').get();
  return {current:{...current,description:describeProfile(current.input)},revisions:Number(this.db.prepare('SELECT count(*) n FROM age_profile_revisions').get()!.n),today:civilDateIn(this.clock()),domain:AGE_DOMAIN,
   pendingLegacy:legacy&&legacy.status==='pending'?{raw:parse(legacy.raw_json),capturedAt:legacy.captured_at}:null,
   legacyResolution:legacy&&legacy.status!=='pending'?{status:legacy.status,resolvedAt:legacy.resolved_at}:null,
   grammar:SUPPORTED_GRAMMAR};
 }
 private profileCommand(input:any,kind:string,run:(current:ReturnType<Store['profileRow']>,anchor:string)=>any){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new ProfileError('A profile command is required.');
  // Only known command fields and the single local child/household/operator are accepted; nothing is silently remapped.
  const allowed=['commandKey','expectedRevisionId','profile','householdId','subjectId','actorId',...(kind==='legacy'?['action']:[])];
  for(const field of Object.keys(input))if(!allowed.includes(field))throw new ProfileError(`Unsupported profile command field: ${field}.`,field);
  const {householdId=LOCAL_SCOPE.householdId,subjectId=LOCAL_SCOPE.subjectId,actorId=LOCAL_SCOPE.actorId}=input;
  if(householdId!==LOCAL_SCOPE.householdId||subjectId!==LOCAL_SCOPE.subjectId||actorId!==LOCAL_SCOPE.actorId)throw new ProfileError('Only the single local child, household and operator are supported. These labels are not authentication.');
  if(typeof input.commandKey!=='string'||!COMMAND_KEY.test(input.commandKey))throw new ProfileError('A valid idempotency key is required.');
  if(typeof input.expectedRevisionId!=='string')throw new ProfileError('The expected current profile revision is required.');
  const mac=this.mac(json({kind,expectedRevisionId:input.expectedRevisionId,action:input.action??null,profile:input.profile??null,householdId,subjectId,actorId}));
  return this.transaction(()=>{
   const prior=this.db.prepare('SELECT * FROM age_profile_commands WHERE command_key=?').get(input.commandKey);
   if(prior){if(prior.payload_mac!==mac)throw new ConflictError('Profile idempotency key payload conflict.');return parse(prior.result_json);}
   const current=this.profileRow();
   if(current.revisionId!==input.expectedRevisionId)throw new ConflictError('The age profile changed in another window. Reload it before saving.');
   const result=run(current,civilDateIn(this.clock()));
   // Receipts hold revision identifiers only, never profile values.
   this.db.prepare('INSERT INTO age_profile_commands VALUES (?,?,?,?)').run(input.commandKey,mac,json(result),this.clock().toISOString());
   return result;
  });
 }
 private appendProfile(current:ReturnType<Store['profileRow']>,profile:ProfileInput,anchor:string,origin:'user'|'legacy-confirm'){
  if(json(profile)===json(current.input))return {revisionId:current.revisionId,seq:current.seq,unchanged:true};
  const revisionId=randomUUID();
  this.db.prepare('INSERT INTO age_profile_revisions(revision_id,subject_id,previous_revision_id,input_json,anchor_date,origin,created_at) VALUES (?,?,?,?,?,?,?)').run(revisionId,LOCAL_SCOPE.subjectId,current.revisionId,json(profile),anchor,origin,this.clock().toISOString());
  // A profile edit is a local assessment change: refresh baselines (and record any Show anyway lapse) without attention or notices.
  const profileBasis=this.profileBasis();
  for(const r of this.db.prepare('SELECT id,version,data_json FROM opportunities').all())this.writeAgeState(String(r.id),Number(r.version),parse(r.data_json),profileBasis);
  return {revisionId,seq:Number(this.db.prepare('SELECT seq FROM age_profile_revisions WHERE revision_id=?').get(revisionId)!.seq),unchanged:false,anchorDate:anchor};
 }
 updateProfile(input:any){return this.profileCommand(input,'set',(current,anchor)=>this.appendProfile(current,validateProfile(input.profile,anchor).profile,anchor,'user'));}
 // Explicit local resolution of a pending legacy settings birthday. Confirmation takes reviewed input; nothing is normalized silently.
 resolveLegacy(input:any){
  if(!['confirm','discard'].includes(input?.action))throw new ProfileError('Choose confirm or discard.');
  return this.profileCommand(input,'legacy',(current,anchor)=>{
   const legacy=this.db.prepare("SELECT * FROM age_legacy_birth_date WHERE status='pending'").get();
   if(!legacy)throw new ConflictError('No pending earlier birthday remains.');
   let result:any={status:'discarded',revisionId:current.revisionId};
   if(input.action==='confirm')result={status:'confirmed',...this.appendProfile(current,validateProfile(input.profile,anchor).profile,anchor,'legacy-confirm')};
   else if(input.profile!==undefined)throw new ProfileError('Discard takes no profile.');
   this.db.prepare('UPDATE age_legacy_birth_date SET raw_json=NULL,status=?,resolved_at=?,resolution_revision_id=? WHERE id=1').run(result.status,this.clock().toISOString(),input.action==='confirm'?result.revisionId:null);
   this.db.prepare('UPDATE meta SET value=? WHERE key=?').run(json({...this.rawSettings(),birthDate:null}),'settings');
   return result;
  });
 }
 overrideHistory(id:string){return this.db.prepare('SELECT * FROM age_overrides WHERE opportunity_id=? ORDER BY event_id').all(id).map(e=>({...e,basis:parse(e.basis_json)}));}
 overrideLapses(id:string){return new Set(this.db.prepare('SELECT override_id FROM age_override_lapses WHERE opportunity_id=?').all(id).map(r=>String(r.override_id)));}
 projectOverride(id:string,age:any){return projectOverride(this.overrideHistory(id),age,this.overrideLapses(id));}
 // Refresh one item's private assessment baseline and persist a Show anyway lapse if its basis no longer matches.
 // Called wherever an assessment can change: new source versions, new profile revisions and the startup recheck.
 private writeAgeState(id:string,version:number,envelope:any,profile=this.profileBasis()){
  const facts=canonicalAgeFacts(ageRuleFacts(envelope).facts),age=this.ageFor(envelope,version,profile);
  this.db.prepare('INSERT INTO age_rule_state VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,extractor_revision=excluded.extractor_revision,signature=excluded.signature,facts_json=excluded.facts_json,profile_revision_id=excluded.profile_revision_id,assessment_revision=excluded.assessment_revision,outcome_signature=excluded.outcome_signature,outcome_json=excluded.outcome_json')
   .run(id,version,AGE_EXTRACTOR_REVISION,hash(json(facts)),json(facts),profile.revisionId,AGE_ASSESSMENT_REVISION,age.outcomeSignature,json(canonicalAgeOutcome(age)));
  const projection=this.projectOverride(id,age);
  if(projection.record&&projection.lapsed&&!this.overrideLapses(id).has(projection.record.override_id))this.db.prepare('INSERT INTO age_override_lapses VALUES (?,?,?,?)').run(projection.record.override_id,id,age.outcomeSignature,this.clock().toISOString());
  return {facts,age};
 }
 // Show anyway / revert: idempotent append-only household/item age-placement override bound to the displayed basis.
 ageOverride(input:any){
  if(!input||typeof input!=='object')throw Error('A Show anyway command is required.');
  const {householdId=LOCAL_SCOPE.householdId,actorId=LOCAL_SCOPE.actorId}=input;
  if(householdId!==LOCAL_SCOPE.householdId||actorId!==LOCAL_SCOPE.actorId)throw Error('Only the single local household and operator are supported. These labels are not authentication.');
  if(typeof input.commandKey!=='string'||!COMMAND_KEY.test(input.commandKey))throw Error('A valid idempotency key is required.');
  if(typeof input.id!=='string'||!['show','revert'].includes(input.action))throw Error('Invalid Show anyway action.');
  const shownVersion=Number(input.shownVersion);if(!Number.isInteger(shownVersion)||shownVersion<1)throw Error('A shown source version is required.');
  const expectedOverrideId=input.expectedOverrideId??null;if(expectedOverrideId!==null&&typeof expectedOverrideId!=='string')throw Error('Invalid prior Show anyway identity.');
  if(input.action==='show'&&typeof input.basisSignature!=='string')throw Error('The shown age basis is required.');
  const canonical={id:input.id,action:input.action,shownVersion,householdId,actorId,expectedOverrideId,basisSignature:input.action==='show'?input.basisSignature:null,targetOverrideId:input.action==='revert'?input.targetOverrideId??null:null};
  const payloadHash=hash(json(canonical));
  return this.transaction(()=>{
   const prior=this.db.prepare('SELECT * FROM age_overrides WHERE command_key=?').get(input.commandKey);
   if(prior){if(prior.payload_hash!==payloadHash)throw Error('Show anyway idempotency key payload conflict.');return parse(prior.result_json);}
   const opportunity=this.db.prepare('SELECT * FROM opportunities WHERE id=?').get(input.id);if(!opportunity)throw Error('Unknown opportunity.');
   if(!this.db.prepare('SELECT 1 FROM versions WHERE id=? AND version=?').get(input.id,shownVersion))throw Error('Shown source version does not exist.');
   const current=this.ageFor(parse(opportunity.data_json),Number(opportunity.version)),projection=this.projectOverride(input.id,current);
   if((projection.record?.override_id??null)!==expectedOverrideId)throw new ConflictError('Show anyway changed in another window. Reload first.');
   if(input.action==='show'){
    if(current.status!=='outside')throw new ConflictError('Show anyway applies only to a confirmed outside age rule.');
    if(input.basisSignature!==current.outcomeSignature||shownVersion!==Number(opportunity.version))throw new ConflictError('The age evidence or profile changed since it was shown. Reload before choosing Show anyway.');
   }else if(!projection.record||canonical.targetOverrideId!==projection.record.override_id)throw Error('Only the exact current Show anyway can be reverted.');
   const overrideId=randomUUID(),createdAt=this.clock().toISOString(),result={overrideId,action:input.action,shownVersion,createdAt};
   this.db.prepare('INSERT INTO age_overrides(override_id,command_key,payload_hash,opportunity_id,household_id,action,shown_version,basis_json,target_override_id,result_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(overrideId,input.commandKey,payloadHash,input.id,householdId,input.action,shownVersion,json(ageBasis(current)),canonical.targetOverrideId,json(result),createdAt);
   return result;
  });
 }
 // Startup recheck against the private baseline. Source version and profile revision are unchanged by construction when the
 // baseline matches them, so any material difference in facts or outcome is an extractor/comparison-algorithm correction:
 // it becomes exact local attention (never a source version, change ID or source notice). Stored and current results are
 // compared in canonical semantic form, never by hashes of a revision's serialization, so a baseline written in an older
 // shape (no outcome columns, facts without `unresolved`, a status/comparison-only outcome) is not a correction by itself.
 // Revision-only changes with the same material result, and baselines for another version/profile revision, refresh silently.
 recheckAgeAssessments(){
  return this.transaction(()=>{
   let created=0;const profile=this.profileBasis();
   for(const r of this.db.prepare('SELECT * FROM opportunities').all()){
    const row=this.db.prepare('SELECT * FROM age_rule_state WHERE id=?').get(r.id),version=Number(r.version);
    const {facts,age}=this.writeAgeState(String(r.id),version,parse(r.data_json),profile);
    if(!row||Number(row.version)!==version)continue;
    const storedFacts=canonicalAgeFacts(parse(row.facts_json)),comparableOutcome=row.outcome_json!=null&&row.profile_revision_id===profile.revisionId;
    // Older outcome rows held only status/comparison; they combine with the stored facts they were computed with.
    const storedOutcome=comparableOutcome?canonicalAgeOutcome({...storedFacts,...parse(row.outcome_json)}):null,currentOutcome=canonicalAgeOutcome(age);
    if(json(storedFacts)===json(facts)&&(!comparableOutcome||json(storedOutcome)===json(currentOutcome)))continue;
    const before={...storedFacts,outcome:storedOutcome&&{status:storedOutcome.status,comparison:storedOutcome.comparison}},after={...facts,outcome:{status:currentOutcome.status,comparison:currentOutcome.comparison}};
    const family=this.db.prepare('SELECT interested,surfaced FROM family_state WHERE id=?').get(r.id);
    this.db.prepare('INSERT INTO age_attention(id,source_version,old_revision,new_revision,old_signature,new_signature,before_json,after_json,notice_eligible,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
     .run(r.id,version,`${row.extractor_revision}/${row.assessment_revision??'unrecorded'}`,`${AGE_EXTRACTOR_REVISION}/${AGE_ASSESSMENT_REVISION}`,hash(json({facts:storedFacts,outcome:storedOutcome})),hash(json({facts,outcome:comparableOutcome?currentOutcome:null})),json(before),json(after),family&&(family.interested||family.surfaced)?1:0,this.clock().toISOString());
    created++;
   }
   return created;
  });
 }
}
