import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store,hash} from '../server/store.ts';
import {LOCAL_SCOPE} from '../src/decisions.ts';
import {ageMaterialKey,canonicalAgeFacts,canonicalAgeOutcome} from '../src/ageEvidence.ts';
// SYNTHETIC: invented listings and profiles. Earlier-revision state is reproduced by inserting rows exactly as the
// age-words-v1/age-assessment-v1 code wrote them; no append-only decision or Show anyway row is ever edited or deleted.
const captured='2026-10-04T02:35:33.636296Z';
const RULE='Ages 7-10 as of September 1, 2080.';
const body=(description:string,uid:string)=>`BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:${uid}\nSUMMARY:Synthetic science class\nDESCRIPTION:${description.replace(/,/g,'\\,')}\nDTSTART:20800605T150000Z\nDTEND:20800605T160000Z\n\nEND:VEVENT\nEND:VCALENDAR`;
function intake(s:Store,text:string,key:string){const t=s.beginScan();try{s.ingest('prcr',text,key,captured,'live',t.fence);}finally{s.endScan(t.fence);}}
const item=(s:Store,uid:string):any=>s.snapshot().items.find(i=>i.uid===uid)!;
let n=0;const key=(label:string)=>`synthetic-${label}-${++n}`;
const setProfile=(s:Store,profile:any)=>s.updateProfile({commandKey:key('profile'),expectedRevisionId:s.profileBasis().revisionId,profile});
const OUTSIDE={kind:'birth-date',birthDate:'2075-01-01'};
// age-assessment-v1 outcome signature: a hash of its own serialization (no `unresolved`, per-rule list, top-level comparison).
const v1Signature=(b:any)=>hash(JSON.stringify({rules:b.rules.map((r:any)=>({min:r.min,max:r.max,reference:r.reference})),conflict:b.conflict,perRule:b.rules.map((r:any)=>r.comparison),status:b.status,comparison:b.rules.length===1?b.rules[0].comparison:null}));
// The basis shape ageBasis() wrote under v1: no `unresolved`, no top-level `comparison`, v1 signatures.
function v1Basis(age:any){
 const basis:any={algorithmRevision:'age-assessment-v1',extractorRevision:'age-words-v1',calendarParserRevision:age.calendarParserRevision,sourceVersion:age.sourceVersion,profileRevisionId:age.profileRevisionId,identity:'synthetic-v1-identity',ruleSignature:hash(JSON.stringify({rules:age.rules.map((r:any)=>({min:r.min,max:r.max,reference:r.reference})),conflict:age.conflict})),outcomeSignature:'',status:age.status,rules:age.rules.map((r:any)=>({min:r.min,max:r.max,reference:r.reference,comparison:r.comparison,quotes:r.evidence.map((e:any)=>({part:e.part,quote:e.quote,representationHash:e.representationHash}))})),conflict:age.conflict,hints:[]};
 basis.outcomeSignature=v1Signature(basis);return basis;
}
function insertEvent(s:Store,e:{id:string;action:string;payload:any;snapshot:any;supersedes?:string|null;target?:string|null}){
 const decisionId=randomUUID();
 s.db.prepare('INSERT INTO decision_events(decision_id,command_key,payload_hash,opportunity_id,household_id,subject_id,actor_id,action,shown_version,payload_json,snapshot_json,supersedes_id,reverses_id,target_decision_id,result_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
  .run(decisionId,key('v1-command'),'synthetic-v1-payload-hash',e.id,LOCAL_SCOPE.householdId,LOCAL_SCOPE.subjectId,LOCAL_SCOPE.actorId,e.action,1,JSON.stringify(e.payload),JSON.stringify(e.snapshot),e.supersedes??null,null,e.target??null,JSON.stringify({decisionId}),new Date('2079-01-01T15:00:00Z').toISOString());
 return decisionId;
}
// A real pass supplies a realistic snapshot; a later v1-shaped pass (superseding it) carries the v1 age basis and is active.
function v1FitPass(s:Store,uid:string,basis:any){
 const x=item(s,uid);
 const real=s.decision({id:x.id,action:'pass',shownVersion:x.version,commandKey:key('pass'),expectedActiveDecisionId:x.decision.active?.decision_id??null,reasons:['wrong-fit'],...LOCAL_SCOPE});
 const row=s.db.prepare('SELECT payload_json,snapshot_json FROM decision_events WHERE decision_id=?').get(real.decisionId)!;
 const snapshot=JSON.parse(String(row.snapshot_json));snapshot.revision='reason-decision-v1';snapshot.age=basis;delete snapshot.fit;
 return insertEvent(s,{id:x.id,action:'pass',payload:JSON.parse(String(row.payload_json)),snapshot,supersedes:real.decisionId});
}
function v1AgeReview(s:Store,uid:string,decisionId:string,reviewedBasis:any,signature:string){
 const x=item(s,uid);
 const snapshot=JSON.parse(String(s.db.prepare('SELECT snapshot_json FROM decision_events WHERE decision_id=?').get(decisionId)!.snapshot_json));
 snapshot.age=reviewedBasis;
 return insertEvent(s,{id:x.id,action:'reconsider_review',payload:{id:x.id,action:'reconsider_review',shownVersion:1,...LOCAL_SCOPE,reasons:[],dimensions:[],generalIntent:'listing',targetId:null,targetScope:null,note:'',expectedActiveDecisionId:decisionId,targetDecisionId:decisionId,reviewKind:'age',reviewKey:JSON.stringify({decisionId,outcomeSignature:signature})},snapshot,target:decisionId});
}
// Builds a database as the first (v1) artifact left it, then returns the identifiers involved.
function buildV1Database(path:string,clock:{now:Date}){
 const s=new Store(path,()=>clock.now);
 for(const uid of ['show','fit','reviewed','bogus','control'])intake(s,body(RULE,uid),`intake-${uid}`);
 for(const uid of ['show','fit','reviewed','bogus','control']){s.action(item(s,uid).id,'surface');s.action(item(s,uid).id,'interested',true);}
 // Fit passes recorded while the profile was unknown (basis status unknown), under v1.
 const unknownPasses=Object.fromEntries(['reviewed','bogus','control'].map(uid=>[uid,v1FitPass(s,uid,v1Basis(item(s,uid).age))]));
 setProfile(s,OUTSIDE);
 // A fit pass made after the profile was set: its v1 basis matches the current outcome.
 const fitPass=v1FitPass(s,'fit',v1Basis(item(s,'fit').age));
 // Legacy age reviews of unknown -> outside: one genuine v1 key, one whose signature does not match its basis.
 v1AgeReview(s,'reviewed',unknownPasses.reviewed,v1Basis(item(s,'reviewed').age),v1Basis(item(s,'reviewed').age).outcomeSignature);
 v1AgeReview(s,'bogus',unknownPasses.bogus,v1Basis(item(s,'bogus').age),'not-a-real-v1-signature');
 // v1 Show anyway with its v1 basis.
 const show=item(s,'show'),overrideId=randomUUID();
 s.db.prepare('INSERT INTO age_overrides(override_id,command_key,payload_hash,opportunity_id,household_id,action,shown_version,basis_json,target_override_id,result_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
  .run(overrideId,key('v1-show'),'synthetic-v1-payload-hash',show.id,LOCAL_SCOPE.householdId,'show',show.version,JSON.stringify(v1Basis(show.age)),null,JSON.stringify({overrideId}),clock.now.toISOString());
 // v1 schema: baseline table without outcome columns, facts without `unresolved`; no lapse table yet.
 const v1Rows=s.db.prepare('SELECT o.id,o.version,o.data_json FROM opportunities o').all().map(r=>{const age=item(s,JSON.parse(String(r.data_json)).event.uid).age;const facts={rules:age.rules.map((x:any)=>({min:x.min,max:x.max,reference:x.reference})),conflict:age.conflict};return [r.id,r.version,'age-words-v1',hash(JSON.stringify(facts)),JSON.stringify(facts)];});
 s.db.exec('DROP TABLE age_rule_state; DROP TABLE age_override_lapses; CREATE TABLE age_rule_state (id TEXT PRIMARY KEY, version INTEGER NOT NULL, extractor_revision TEXT NOT NULL, signature TEXT NOT NULL, facts_json TEXT NOT NULL);');
 for(const row of v1Rows)s.db.prepare('INSERT INTO age_rule_state VALUES (?,?,?,?,?)').run(...(row as [string,number,string,string,string]));
 s.db.close();
 return {fitPass,overrideId,unknownPasses};
}
const counts=(s:Store)=>({versions:s.db.prepare('SELECT count(*) n FROM versions').get()!.n,changes:s.db.prepare('SELECT count(*) n FROM changes').get()!.n,attention:s.db.prepare('SELECT count(*) n FROM age_attention').get()!.n,lapses:s.db.prepare('SELECT count(*) n FROM age_override_lapses').get()!.n,decisions:s.db.prepare('SELECT count(*) n FROM decision_events').get()!.n,overrides:s.db.prepare('SELECT count(*) n FROM age_overrides').get()!.n});
test('AGE-REVIEW-005: v1 stored shapes are compared by meaning, not serialization hashes',()=>{
 const age={rules:[{min:7,max:10,reference:{kind:'cutoff',date:'2080-09-01'},comparison:'outside'}],conflict:false,status:'outside'};
 const current={...age,unresolved:[],comparison:'outside',outcomeSignature:'v2-hash',someFutureField:{x:1}};
 assert.equal(ageMaterialKey(age),ageMaterialKey(current));
 assert.deepEqual(canonicalAgeFacts({rules:age.rules,conflict:false}),canonicalAgeFacts({rules:[{reference:{date:'2080-09-01',kind:'cutoff'},max:10,min:7}],conflict:false,unresolved:[]}));
 // Real differences stay material: new unresolved wording, a changed bound or reference, status or comparison.
 for(const changed of [{...current,unresolved:['negated']},{...current,rules:[{...age.rules[0],min:8}]},{...current,rules:[{...age.rules[0],reference:{kind:'cutoff',date:'2080-10-01'}}]},{...current,status:'unknown',comparison:null}])
  assert.notEqual(ageMaterialKey(changed),ageMaterialKey(current));
 // An older status/comparison-only outcome row combines with its stored facts.
 assert.deepEqual(canonicalAgeOutcome({...canonicalAgeFacts({rules:age.rules,conflict:false}),status:'outside',comparison:'outside'}),canonicalAgeOutcome(current));
});
test('AGE-REVIEW-005: upgrading a v1 database with unchanged evidence creates no correction, lapse or reconsideration, across restarts',()=>{
 const dir=mkdtempSync(join(tmpdir(),'town-age-upgrade-'));
 try{
  const path=join(dir,'v1.sqlite'),clock={now:new Date('2079-01-01T15:00:00Z')};
  const {fitPass,overrideId}=buildV1Database(path,clock);
  let s=new Store(path,()=>clock.now);
  const before=counts(s);
  assert.equal(s.recheckAgeAssessments(),0);
  const check=()=>{
   const show=item(s,'show');
   assert.equal(show.ageOverride.record.override_id,overrideId);assert.equal(show.ageOverride.active,true);assert.equal(show.ageOverride.lapsed,false);
   assert.equal(show.verdict,'needs checking');assert.equal(show.ageBypassed,true);
   const fit=item(s,'fit');assert.equal(fit.decision.active.decision_id,fitPass);assert.equal(fit.decision.ageReconsider,null);
   // A genuine legacy age review still acknowledges its exact state.
   assert.equal(item(s,'reviewed').decision.ageReconsider,null);
   for(const uid of ['show','fit','reviewed','bogus','control']){assert.equal(item(s,uid).ageAttention.length,0,uid);assert.equal(item(s,uid).notices.length,0,uid);}
   // No weak acceptance: a legacy review whose signature does not match its basis acknowledges nothing, and a real
   // unknown -> outside change without any review still prompts.
   assert.ok(item(s,'bogus').decision.ageReconsider);assert.ok(item(s,'control').decision.ageReconsider);
  };
  check();assert.deepEqual(counts(s),before);
  assert.equal(s.recheckAgeAssessments(),0);check();
  s.db.close();s=new Store(path,()=>clock.now);assert.equal(s.recheckAgeAssessments(),0);check();assert.deepEqual(counts(s),before);
  // Real changes after the upgrade still count. A comparison-algorithm correction gives exactly one local item...
  const fit=item(s,'fit');
  s.db.prepare(`UPDATE age_rule_state SET assessment_revision='age-assessment-v0',outcome_json='{"status":"meets","comparison":"meets"}' WHERE id=?`).run(fit.id);
  s.db.close();s=new Store(path,()=>clock.now);assert.equal(s.recheckAgeAssessments(),1);assert.equal(s.recheckAgeAssessments(),0);
  assert.equal(item(s,'fit').ageAttention.length,1);assert.equal(item(s,'show').ageAttention.length,0);
  // ...a current-revision age review acknowledges exactly the shown state...
  const control=item(s,'control');
  s.decision({id:control.id,action:'reconsider_review',shownVersion:control.version,commandKey:key('review'),expectedActiveDecisionId:control.decision.active.decision_id,targetDecisionId:control.decision.active.decision_id,reviewKind:'age',reviewKey:control.decision.ageReconsider.key,...LOCAL_SCOPE});
  assert.equal(item(s,'control').decision.ageReconsider,null);
  // ...and a real rule change lapses the v1 override permanently and prompts the v1 fit pass.
  intake(s,body('Ages 8-10 as of September 1, 2080.','show'),'show-rule-change');intake(s,body('Ages 8-10 as of September 1, 2080.','fit'),'fit-rule-change');
  assert.equal(item(s,'show').ageOverride.lapsed,true);assert.equal(item(s,'show').notices.length,1);assert.ok(item(s,'fit').decision.ageReconsider);
  intake(s,body(RULE,'show'),'show-rule-back');assert.equal(item(s,'show').ageOverride.lapsed,true);
  s.db.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('AGE-REVIEW-005: profile and precision-only changes on upgraded v1 state stay correct',()=>{
 const dir=mkdtempSync(join(tmpdir(),'town-age-upgrade-profile-'));
 try{
  const path=join(dir,'v1.sqlite'),clock={now:new Date('2079-01-01T15:00:00Z')};buildV1Database(path,clock);
  const s=new Store(path,()=>clock.now);assert.equal(s.recheckAgeAssessments(),0);
  // Precision-only: still outside, nothing changes.
  setProfile(s,{kind:'age-as-of',age:3,asOf:'2079-01-01'});
  assert.equal(item(s,'show').ageOverride.active,true);assert.equal(item(s,'fit').decision.ageReconsider,null);
  assert.equal(s.recheckAgeAssessments(),0);assert.equal(counts(s).attention,0);
  // A material profile change lapses the v1 override and prompts the fit pass, without attention or source notices.
  setProfile(s,{kind:'birth-date',birthDate:'2073-09-01'});
  assert.equal(item(s,'show').ageOverride.lapsed,true);assert.ok(item(s,'fit').decision.ageReconsider);
  assert.equal(s.recheckAgeAssessments(),0);assert.equal(counts(s).attention,0);assert.equal(item(s,'show').notices.length,0);
  s.db.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
