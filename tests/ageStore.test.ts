import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store,ConflictError,hash} from '../server/store.ts';
import {LOCAL_SCOPE} from '../src/decisions.ts';
import {ProfileError} from '../src/age.ts';
// SYNTHETIC: every profile, birthday, note and listing in this file is invented test data.
const captured='2026-10-04T02:35:33.636296Z';
const body=(description:string,{uid='age-synthetic',start='20800605T150000Z',extra=''}={})=>`BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:${uid}\nSUMMARY:Synthetic science class\nDESCRIPTION:${description.replace(/,/g,'\\,')}\nDTSTART:${start}\nDTEND:20800605T160000Z\n${extra}\nEND:VEVENT\nEND:VCALENDAR`;
const RULE='Ages 7-10 as of September 1, 2080.';
function intake(s:Store,text:string,key:string,part:'prcr'|'arts'='prcr',cause:'provider'|'parser'='provider'){const t=s.beginScan();try{return s.ingest(part,text,key,captured,'live',t.fence,Date.now(),cause);}finally{s.endScan(t.fence);}}
function clocked(start='2079-01-01T15:00:00Z'){const clock={now:new Date(start)};return {clock,store:new Store(':memory:',()=>clock.now)};}
let sequence=0;const key=(label='cmd')=>`synthetic-${label}-${++sequence}`;
const setProfile=(s:Store,profile:any)=>s.updateProfile({commandKey:key('profile'),expectedRevisionId:s.profileBasis().revisionId,profile});
const item=(s:Store,uid='age-synthetic'):any=>s.snapshot().items.find(i=>i.uid===uid)!;
const pass=(s:Store,patch:any={})=>{const i=item(s,patch.uid);delete patch.uid;return s.decision({id:i.id,action:'pass',shownVersion:i.version,commandKey:key('pass'),expectedActiveDecisionId:i.decision.active?.decision_id??null,reasons:['other'],...LOCAL_SCOPE,...patch});};
// Outside 7-10 at the 2080-09-01 cutoff: 5 completed years.
const OUTSIDE={kind:'birth-date',birthDate:'2075-01-01'};
test('fresh database seeds unknown once at a New York anchor; snapshots expose only the revision identity',()=>{
 const {store:s}=clocked();intake(s,body(RULE),'a');
 const view=s.profileView();
 assert.deepEqual(view.current.input,{kind:'unknown'});assert.equal(view.current.origin,'seed');assert.equal(view.current.anchorDate,'2079-01-01');assert.equal(view.revisions,1);assert.equal(view.pendingLegacy,null);
 let snapshot:any=s.snapshot(),i:any=snapshot.items[0];
 assert.deepEqual(snapshot.ageProfile,{revisionId:view.current.revisionId,known:false,pendingLegacy:false});
 assert.equal(i.age.status,'unknown');assert.equal(i.rules.find((r:any)=>r.name==='Age').result,'unknown');
 const score=i.score;
 setProfile(s,{kind:'birth-date',birthDate:'2073-09-01'});
 snapshot=s.snapshot();i=snapshot.items[0];
 assert.equal(i.age.status,'meets');assert.equal(i.rules.find((r:any)=>r.name==='Age').result,'pass');assert.equal(i.verdict,'needs checking');
 assert.equal(i.score,score);assert.equal(i.age.profileRevisionId,snapshot.ageProfile.revisionId);
 assert.equal(JSON.stringify(snapshot).includes('2073-09-01'),false);
 // Identical revision and fixed provider reference: identical assessment on later evaluation days, including after the birthday passes.
 const later=s.snapshot(new Date('2079-09-02T15:00:00Z')).items[0],muchLater=s.snapshot(new Date('2080-08-30T15:00:00Z')).items[0];
 assert.deepEqual([later.age.identity,later.age.outcomeSignature,later.age.status],[i.age.identity,i.age.outcomeSignature,'meets']);
 assert.deepEqual(muchLater.age,i.age);
});
test('profile revisions: immutable history, expected-revision races, idempotent replay, payload conflicts, no-ops and settings saves',()=>{
 const {store:s,clock}=clocked();const r0=s.profileBasis().revisionId;
 const a=s.updateProfile({commandKey:'synthetic-race-a',expectedRevisionId:r0,profile:{kind:'age-as-of',age:7,asOf:'2079-01-01'}});
 assert.equal(a.unchanged,false);
 assert.throws(()=>s.updateProfile({commandKey:'synthetic-race-b',expectedRevisionId:r0,profile:{kind:'birth-year',year:2071}}),(e:any)=>e instanceof ConflictError&&/another window/.test(e.message));
 assert.deepEqual(s.updateProfile({commandKey:'synthetic-race-a',expectedRevisionId:r0,profile:{kind:'age-as-of',age:7,asOf:'2079-01-01'}}),a);
 assert.throws(()=>s.updateProfile({commandKey:'synthetic-race-a',expectedRevisionId:r0,profile:{kind:'age-as-of',age:8,asOf:'2079-01-01'}}),/payload conflict/);
 const same=s.updateProfile({commandKey:key(),expectedRevisionId:a.revisionId,profile:{kind:'age-as-of',age:7,asOf:'2079-01-01'}});
 assert.deepEqual([same.unchanged,same.revisionId],[true,a.revisionId]);assert.equal(s.profileView().revisions,2);
 // A rejected input stores no receipt, so the same key can carry the corrected input.
 assert.throws(()=>s.updateProfile({commandKey:'synthetic-fix-1',expectedRevisionId:a.revisionId,profile:{kind:'birth-date',birthDate:'2079-01-02'}}),(e:any)=>e instanceof ProfileError&&e.field==='birthDate');
 const fixed=s.updateProfile({commandKey:'synthetic-fix-1',expectedRevisionId:a.revisionId,profile:{kind:'birth-date',birthDate:'2072-02-29'}});
 assert.equal(fixed.unchanged,false);
 assert.throws(()=>s.db.exec("UPDATE age_profile_revisions SET input_json='{}'"),/append-only/);assert.throws(()=>s.db.exec('DELETE FROM age_profile_revisions'),/append-only/);
 // Ordinary/stale preference saves never touch the profile and cannot carry a birthday.
 const before=s.profileBasis().revisionId;
 s.updateSettings({weights:{science:3}});s.updateSettings({...s.settings(),fallSaturdays:true});
 assert.throws(()=>s.updateSettings({birthDate:'2072-02-29'}),/separate private age profile/);
 assert.equal(s.profileBasis().revisionId,before);assert.equal(s.settings().birthDate,null);
 // Receipts hold revision IDs only, keyed by a local secret rather than a guessable birthday hash.
 const receipts=s.db.prepare('SELECT * FROM age_profile_commands').all();
 assert.equal(JSON.stringify(receipts).includes('2072-02-29'),false);
 const guessable=hash(JSON.stringify({kind:'set',expectedRevisionId:a.revisionId,action:null,profile:{kind:'birth-date',birthDate:'2072-02-29'}}));
 assert.equal(receipts.some((r:any)=>r.payload_mac===guessable),false);
 // Reset to unknown appends; earlier revisions remain as immutable local history.
 setProfile(s,{kind:'unknown'});assert.equal(s.profileView().revisions,4);assert.equal(s.profileBasis().feasible,null);
 // The anchor is fixed at creation: later evaluation days do not move feasible sets.
 setProfile(s,{kind:'birth-month',year:2079,month:1});
 const anchored=s.profileView().current;assert.deepEqual(anchored.feasible,{earliest:'2079-01-01',latest:'2079-01-01'});
 clock.now=new Date('2079-01-30T15:00:00Z');
 assert.deepEqual(s.profileView().current.feasible,anchored.feasible);assert.equal(s.profileView().current.anchorDate,'2079-01-01');
 assert.throws(()=>setProfile(s,{kind:'birth-month',year:2079,month:2}),/after 2079-01-30/);
});
test('migration copies a raw legacy settings birthday into a private pending record atomically; no auto-import; explicit discard/confirm',()=>{
 const dir=mkdtempSync(join(tmpdir(),'town-age-legacy-'));
 try{
  const path=join(dir,'legacy.sqlite');let raw=new DatabaseSync(path);
  const legacySettings=JSON.stringify({birthDate:'2073-13-45',fallSaturdays:true,weights:{sailing:0,chess:0,science:4,outdoors:0,education:0,'hands-on':0,art:0,craft:0}});
  raw.exec(`CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO meta VALUES ('settings','${legacySettings}');
   CREATE TABLE age_profile_revisions(seq INTEGER PRIMARY KEY AUTOINCREMENT,revision_id TEXT NOT NULL UNIQUE,subject_id TEXT NOT NULL,previous_revision_id TEXT,input_json TEXT NOT NULL,anchor_date TEXT NOT NULL,origin TEXT NOT NULL,created_at TEXT NOT NULL);
   CREATE TRIGGER fail_seed BEFORE INSERT ON age_profile_revisions BEGIN SELECT RAISE(ABORT,'injected profile seed failure'); END;`);raw.close();
  assert.throws(()=>new Store(path),/injected profile seed failure/);
  raw=new DatabaseSync(path);
  assert.equal(raw.prepare("SELECT name FROM sqlite_master WHERE name='age_legacy_birth_date'").get(),undefined);
  assert.equal(raw.prepare("SELECT value FROM meta WHERE key='settings'").get()!.value,legacySettings);
  raw.exec('DROP TRIGGER fail_seed');raw.close();
  let s=new Store(path);
  let view=s.profileView();
  assert.deepEqual(view.pendingLegacy?.raw,'2073-13-45');assert.deepEqual(view.current.input,{kind:'unknown'});assert.equal(view.revisions,1);
  assert.equal(s.settings().birthDate,null);assert.equal(s.settings().weights.science,4);assert.equal(s.settings().fallSaturdays,true);
  assert.equal(s.snapshot().ageProfile.pendingLegacy,true);assert.equal(JSON.stringify(s.snapshot()).includes('2073-13-45'),false);
  // Ordinary saves cannot erase the pending record or the stored legacy value.
  s.updateSettings({weights:{art:2}});assert.equal(s.profileView().pendingLegacy?.raw,'2073-13-45');
  assert.match(String(s.db.prepare("SELECT value FROM meta WHERE key='settings'").get()!.value),/2073-13-45/);
  s.db.close();s=new Store(path);
  assert.equal(s.db.prepare('SELECT count(*) n FROM age_legacy_birth_date').get()!.n,1);assert.equal(s.profileView().revisions,1);
  // Malformed raw input stays repairable; it is never silently normalized.
  const expected=s.profileBasis().revisionId;
  assert.throws(()=>s.resolveLegacy({commandKey:key('legacy'),action:'confirm',expectedRevisionId:expected,profile:{kind:'birth-date',birthDate:'2073-13-45'}}),ProfileError);
  assert.equal(s.profileView().pendingLegacy?.raw,'2073-13-45');
  assert.deepEqual(s.resolveLegacy({commandKey:key('legacy'),action:'discard',expectedRevisionId:expected}).status,'discarded');
  view=s.profileView();assert.equal(view.pendingLegacy,null);assert.equal(view.legacyResolution?.status,'discarded');assert.deepEqual(view.current.input,{kind:'unknown'});
  assert.equal(String(s.db.prepare("SELECT value FROM meta WHERE key='settings'").get()!.value).includes('2073-13-45'),false);
  assert.equal(s.db.prepare('SELECT raw_json FROM age_legacy_birth_date').get()!.raw_json,null);
  assert.throws(()=>s.resolveLegacy({commandKey:key('legacy'),action:'discard',expectedRevisionId:expected}),/No pending/);
  s.db.close();
  // A valid legacy value is confirmed only through explicit reviewed input, becoming a new revision.
  const path2=join(dir,'legacy-valid.sqlite');raw=new DatabaseSync(path2);raw.exec(`CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO meta VALUES ('settings','${legacySettings.replace('2073-13-45','2073-05-04')}');`);raw.close();
  s=new Store(path2,()=>new Date('2079-01-01T15:00:00Z'));
  const confirmed=s.resolveLegacy({commandKey:key('legacy'),action:'confirm',expectedRevisionId:s.profileBasis().revisionId,profile:{kind:'birth-date',birthDate:'2073-05-04'}});
  assert.equal(confirmed.status,'confirmed');assert.equal(s.profileView().current.origin,'legacy-confirm');assert.deepEqual(s.profileView().current.input,{kind:'birth-date',birthDate:'2073-05-04'});
  s.db.close();s=new Store(path2,()=>new Date('2079-01-01T15:00:00Z'));assert.equal(s.profileView().revisions,2);assert.equal(s.profileView().pendingLegacy,null);s.db.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('fit decisions: optional wrong-fit clarification, strict validation, canonical absence and exact pre-upgrade receipt replay',()=>{
 const {store:s}=clocked();intake(s,body(RULE+' A science workshop.'),'a');setProfile(s,OUTSIDE);
 const i=item(s),baseline={score:i.score,settings:s.settings()};
 for(const fitDimensions of [['too-young','too-young'],['tall'],'too-young',[1],{}])assert.throws(()=>pass(s,{reasons:['wrong-fit'],fitDimensions}),/Invalid wrong-fit clarification/);
 assert.throws(()=>pass(s,{reasons:['other'],fitDimensions:['too-young']}),/requires the wrong-fit reason/);
 // Pre-upgrade command shape: the receipt hash is exactly the earlier canonical payload.
 const legacy={id:i.id,action:'pass',shownVersion:1,commandKey:'synthetic-legacy-pass',expectedActiveDecisionId:null,reasons:['wrong-fit'],...LOCAL_SCOPE};
 const first=s.decision(legacy);
 const oldOrder={id:i.id,action:'pass',shownVersion:1,householdId:LOCAL_SCOPE.householdId,subjectId:LOCAL_SCOPE.subjectId,actorId:LOCAL_SCOPE.actorId,reasons:['wrong-fit'],dimensions:[],generalIntent:'listing',targetId:null,targetScope:null,note:'',expectedActiveDecisionId:null,targetDecisionId:null};
 assert.equal(s.db.prepare('SELECT payload_hash FROM decision_events WHERE command_key=?').get('synthetic-legacy-pass')!.payload_hash,hash(JSON.stringify(oldOrder)));
 // An empty clarification and explicit attendance kind normalize to canonical absence.
 assert.deepEqual(s.decision({...legacy,fitDimensions:[]}),first);
 assert.equal(item(s).decision.active.payload.fitDimensions,undefined);
 const fit=pass(s,{reasons:['wrong-fit','general'],fitDimensions:['too-young','other'],generalIntent:'generally',instructionVersion:'learning-instruction-v2',expectedInstructionId:null,targetId:'topic:science',targetScope:'child',note:'Synthetic note'});
 let x=item(s);const active=x.decision.active;
 assert.equal(active.decision_id,fit.decisionId);assert.deepEqual(active.payload.fitDimensions,['other','too-young']);
 assert.equal(active.payload.generalIntent,'generally');assert.equal(active.snapshot.target.id,'topic:science');
 assert.equal(active.snapshot.age.profileRevisionId,s.profileBasis().revisionId);assert.equal(active.snapshot.age.status,'outside');
 assert.equal(active.snapshot.fit.scope,'child-listing');assert.match(active.snapshot.fit.note,/not .*medical/);
 assert.equal(JSON.stringify(active).includes('2075-01-01'),false);
 assert.equal(x.score,baseline.score);assert.deepEqual(s.settings(),baseline.settings);assert.equal(s.db.prepare('SELECT count(*) n FROM feedback').get()!.n,0);
 // Exact Undo restores the earlier fit correction.
 s.decision({id:x.id,action:'undo',shownVersion:1,commandKey:key('undo'),expectedActiveDecisionId:fit.decisionId,targetDecisionId:fit.decisionId,...LOCAL_SCOPE});
 x=item(s);assert.equal(x.decision.active.decision_id,first.decisionId);assert.equal(x.decision.active.payload.fitDimensions,undefined);
});
test('age reconsideration: exact key; attendance/source review cannot acknowledge it; precision-only and current-day changes do not re-prompt',()=>{
 const {store:s,clock}=clocked();intake(s,body(RULE),'a');const id=item(s).id;s.action(id,'surface');
 pass(s,{reasons:['wrong-fit','timing'],fitDimensions:['too-young']});
 assert.equal(item(s).decision.ageReconsider,null);
 setProfile(s,OUTSIDE);
 let x=item(s);const prompt=x.decision.ageReconsider;
 assert.ok(prompt);assert.equal(x.decision.reconsider,null);assert.equal(x.passed,true);assert.equal(prompt.after.status,'outside');assert.deepEqual(prompt.fitDimensions,['too-young']);
 const review=(patch:any)=>s.decision({id,action:'reconsider_review',shownVersion:item(s).version,commandKey:key('review'),expectedActiveDecisionId:item(s).decision.active.decision_id,targetDecisionId:item(s).decision.active.decision_id,...LOCAL_SCOPE,...patch});
 review({});s.action(id,'review',{version:x.version,changeIds:x.changes.map((c:any)=>c.change_id)});
 assert.ok(item(s).decision.ageReconsider);
 assert.throws(()=>review({reviewKind:'age',reviewKey:'{"decisionId":"x"}'}),ConflictError);
 review({reviewKind:'age',reviewKey:prompt.key});
 x=item(s);assert.equal(x.decision.ageReconsider,null);assert.equal(x.passed,true);
 // Same outcome from a less precise profile, and a later current day, do not re-prompt.
 setProfile(s,{kind:'age-as-of',age:3,asOf:'2079-01-01'});assert.equal(item(s).decision.ageReconsider,null);
 clock.now=new Date('2079-12-31T15:00:00Z');assert.equal(item(s).decision.ageReconsider,null);
 // An attendance change prompts timing reconsideration only; an age acknowledgement cannot clear it.
 intake(s,body(RULE,{start:'20800606T150000Z'}),'moved');
 x=item(s);assert.ok(x.decision.reconsider);assert.equal(x.decision.ageReconsider,null);
 assert.throws(()=>review({reviewKind:'age',reviewKey:prompt.key}),ConflictError);assert.ok(item(s).decision.reconsider);
 // A material rule change re-prompts even though the comparison stays outside.
 intake(s,body('Ages 8-10 as of September 1, 2080.',{start:'20800606T150000Z'}),'rule-change');
 x=item(s);assert.equal(x.age.status,'outside');assert.ok(x.decision.ageReconsider);assert.notEqual(x.decision.ageReconsider.key,prompt.key);
 assert.throws(()=>review({reviewKind:'attendance',reviewKey:x.decision.ageReconsider.key}),/Invalid reconsideration kind|exact age/);
});
test('Show anyway: age-only placement bypass with idempotent append-only history; basis lapse is explained; Hide/pass/cancellation still apply',()=>{
 const {store:s}=clocked();intake(s,body(RULE),'a');setProfile(s,OUTSIDE);
 let x=item(s);assert.equal(x.verdict,'ineligible');assert.equal(x.age.status,'outside');
 const show=(patch:any={})=>s.ageOverride({id:x.id,action:'show',shownVersion:x.version,commandKey:key('show'),expectedOverrideId:null,basisSignature:x.age.outcomeSignature,...patch});
 assert.throws(()=>show({basisSignature:'stale'}),ConflictError);
 const input={id:x.id,action:'show',shownVersion:x.version,commandKey:'synthetic-show-once',expectedOverrideId:null,basisSignature:x.age.outcomeSignature};
 const shown=s.ageOverride(input);assert.deepEqual(s.ageOverride(input),shown);
 assert.throws(()=>s.ageOverride({...input,expectedOverrideId:'other'}),/payload conflict/);
 assert.throws(()=>s.db.exec('DELETE FROM age_overrides'),/append-only/);assert.throws(()=>s.db.exec("UPDATE age_overrides SET action='revert'"),/append-only/);
 x=item(s);assert.equal(x.verdict,'needs checking');assert.equal(x.ageBypassed,true);assert.equal(x.ageOverride.active,true);
 assert.equal(x.rules.find((r:any)=>r.name==='Age').result,'fail');assert.equal(x.age.status,'outside');
 // Independent of Hide and pass.
 s.action(x.id,'hidden',true);pass(s);x=item(s);assert.equal(x.hidden,true);assert.equal(x.passed,true);assert.equal(x.ageOverride.active,true);
 // A precision-only profile change keeps the override.
 setProfile(s,{kind:'age-as-of',age:3,asOf:'2079-01-01'});assert.equal(item(s).ageOverride.active,true);
 // Cancellation still excludes even with an active override.
 intake(s,body(RULE,{extra:'STATUS:CANCELLED'}),'cancelled');
 x=item(s);assert.equal(x.ageOverride.active,true);assert.equal(x.verdict,'ineligible');assert.equal(x.ageBypassed,false);
 // A material rule change lapses it, with a visible explanation and retained history.
 intake(s,body('Ages 8-10 as of September 1, 2080.'),'rule-change');
 x=item(s);assert.equal(x.ageOverride.active,false);assert.equal(x.ageOverride.lapsed,true);assert.match(x.ageOverride.explanation,/changed after you chose Show anyway/);assert.equal(x.verdict,'ineligible');assert.equal(x.ageOverride.history.length,1);
 assert.throws(()=>s.ageOverride({id:x.id,action:'revert',shownVersion:x.version,commandKey:key('revert'),expectedOverrideId:x.ageOverride.record.override_id,targetOverrideId:'wrong'}),/exact current/);
 s.ageOverride({id:x.id,action:'revert',shownVersion:x.version,commandKey:key('revert'),expectedOverrideId:x.ageOverride.record.override_id,targetOverrideId:x.ageOverride.record.override_id});
 x=item(s);assert.equal(x.ageOverride.record,null);assert.equal(x.ageOverride.history.length,2);
 // Show anyway applies only to a confirmed outside comparison.
 setProfile(s,{kind:'birth-date',birthDate:'2071-09-01'});x=item(s);assert.equal(x.age.status,'meets');
 assert.throws(()=>s.ageOverride({id:x.id,action:'show',shownVersion:x.version,commandKey:key('show'),expectedOverrideId:null,basisSignature:x.age.outcomeSignature}),/confirmed outside/);
});
test('provider age-rule changes create exact critical source notices that Hide, pass and exclusion cannot suppress; equivalent wording and profile edits do not',()=>{
 const {store:s}=clocked();intake(s,body(RULE),'a');const id=item(s).id;s.action(id,'surface');setProfile(s,OUTSIDE);
 intake(s,body('Ages 8-10 as of September 1, 2080.'),'b');
 s.action(id,'hidden',true);pass(s);
 let x=item(s);assert.equal(x.verdict,'ineligible');assert.equal(x.notices.length,1);
 const change=x.notices[0];assert.ok(change.fields.includes('age rule'));assert.equal(change.critical,1);assert.equal(change.cause,'provider');
 assert.deepEqual([change.before['age rule'].rules[0].min,change.after['age rule'].rules[0].min],[7,8]);
 s.action(id,'review',{version:x.version,changeIds:[change.change_id]});assert.equal(item(s).notices.length,0);
 intake(s,body('Join us! ages 8 to 10, as of Sep 1, 2080'),'c');
 x=item(s);assert.equal(x.changes[0].fields.includes('age rule'),false);assert.equal(x.changes[0].critical,0);assert.equal(x.notices.length,0);
 const changes=x.changes.length;setProfile(s,{kind:'birth-date',birthDate:'2071-09-01'});assert.equal(item(s).changes.length,changes);assert.equal(item(s).notices.length,0);
 // A parser correction that really produces a new normalized version keeps its parser cause.
 intake(s,body('Ages 9-10 as of September 1, 2080.'),'parser-fix','prcr','parser');
 x=item(s);assert.equal(x.notices[0].cause,'parser');assert.ok(x.notices[0].fields.includes('age rule'));
 // Losing formerly applicable evidence is material too.
 s.action(id,'review',{version:x.version,changeIds:x.notices.map((n:any)=>n.change_id)});
 intake(s,body('An evening program.'),'loss');assert.ok(item(s).notices[0].fields.includes('age rule'));
});
test('local extractor correction: separate exact attention for saved/surfaced items, without a pass and without a source version or change',()=>{
 const {store:s}=clocked();
 for(const uid of ['saved','plain','surfaced'])intake(s,body(RULE,{uid}),`intake-${uid}`);
 s.action(item(s,'saved').id,'interested',true);s.action(item(s,'surfaced').id,'surface');
 const counts=()=>[s.db.prepare('SELECT count(*) n FROM versions').get()!.n,s.db.prepare('SELECT count(*) n FROM changes').get()!.n];
 const before=counts();
 assert.equal(s.recheckAgeAssessments(),0);
 // Simulate state recorded by an earlier extractor revision on the same stored source version.
 s.db.exec(`UPDATE age_rule_state SET extractor_revision='age-words-v0',signature='synthetic-old',facts_json='{"rules":[],"conflict":false,"unresolved":[]}'`);
 assert.equal(s.recheckAgeAssessments(),3);
 assert.deepEqual(counts(),before);
 const saved=item(s,'saved');assert.equal(saved.ageAttention.length,1);assert.equal(item(s,'plain').ageAttention.length,0);assert.equal(item(s,'surfaced').ageAttention.length,1);
 assert.equal(saved.notices.length,0);assert.equal(saved.passed,false);assert.equal(saved.decision.ageReconsider,null);
 const attention=saved.ageAttention[0];assert.match(attention.oldRevision,/^age-words-v0\//);assert.equal(attention.after.rules[0].min,7);assert.match(attention.label,/not a source change/);
 // Hide, a pass and source review leave it pending.
 s.action(saved.id,'hidden',true);pass(s,{uid:'saved'});s.action(saved.id,'review',{version:saved.version,changeIds:[]});
 assert.equal(item(s,'saved').ageAttention.length,1);
 assert.throws(()=>s.action(saved.id,'age-attention-ack',{attentionId:attention.attentionId,oldSignature:attention.oldSignature,newSignature:'other'}),/not the one shown/);
 assert.throws(()=>s.action(item(s,'surfaced').id,'age-attention-ack',{attentionId:attention.attentionId,oldSignature:attention.oldSignature,newSignature:attention.newSignature}),/not the one shown/);
 s.action(saved.id,'age-attention-ack',{attentionId:attention.attentionId,oldSignature:attention.oldSignature,newSignature:attention.newSignature});
 assert.equal(item(s,'saved').ageAttention.length,0);assert.equal(item(s,'surfaced').ageAttention.length,1);
 assert.equal(s.recheckAgeAssessments(),0);assert.equal(s.db.prepare('SELECT count(*) n FROM age_attention').get()!.n,3);
});
test('file-backed restart keeps profile revisions, Show anyway, fit decisions and local attention without reseeding',()=>{
 const dir=mkdtempSync(join(tmpdir(),'town-age-restart-'));
 try{
  const path=join(dir,'state.sqlite');const clock={now:new Date('2079-01-01T15:00:00Z')};let s=new Store(path,()=>clock.now);
  intake(s,body(RULE),'a');setProfile(s,OUTSIDE);let x=item(s);
  s.ageOverride({id:x.id,action:'show',shownVersion:x.version,commandKey:key('show'),expectedOverrideId:null,basisSignature:x.age.outcomeSignature});
  pass(s,{reasons:['wrong-fit'],fitDimensions:['too-young']});const revision=s.profileBasis().revisionId;s.db.close();
  s=new Store(path,()=>clock.now);x=item(s);
  assert.equal(s.profileBasis().revisionId,revision);assert.equal(s.profileView().revisions,2);assert.equal(x.ageOverride.active,true);assert.deepEqual(x.decision.active.payload.fitDimensions,['too-young']);assert.equal(x.verdict,'needs checking');
  s.db.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('AGE-REVIEW-002: a formerly agreeing feed becoming ambiguous is a critical age notice and blocks confirmation',()=>{
 const {store:s}=clocked();intake(s,body(RULE),'p','prcr');intake(s,body(RULE),'a','arts');
 let x=item(s);s.action(x.id,'surface');setProfile(s,OUTSIDE);x=item(s);
 assert.equal(x.age.status,'outside');s.action(x.id,'review',{version:x.version,changeIds:x.changes.map((c:any)=>c.change_id)});
 intake(s,body('Ages 3-5 and ages 6-8 as of September 1, 2080.'),'ambiguous','arts');
 x=item(s);
 assert.equal(x.age.status,'unknown');assert.equal(x.verdict,'needs checking');assert.deepEqual(x.age.unresolved,['multiple-ranges']);
 assert.equal(x.notices.length,1);assert.equal(x.notices[0].critical,1);assert.ok(x.notices[0].fields.includes('age rule'));
 assert.deepEqual(x.notices[0].after['age rule'].unresolved,['multiple-ranges']);
});
test('AGE-REVIEW-003: an assessment-algorithm correction on unchanged source and profile gives exact local attention after restart; profile edits and revision-only changes give none',()=>{
 const dir=mkdtempSync(join(tmpdir(),'town-age-algorithm-'));
 try{
  const path=join(dir,'state.sqlite'),clock={now:new Date('2079-01-01T15:00:00Z')};let s=new Store(path,()=>clock.now);
  intake(s,body(RULE),'a');const id=item(s).id;s.action(id,'interested',true);setProfile(s,OUTSIDE);
  const counts=()=>[s.db.prepare('SELECT count(*) n FROM versions').get()!.n,s.db.prepare('SELECT count(*) n FROM changes').get()!.n];
  const before=counts();
  // Profile edits refresh the baseline silently, including ones that change the outcome.
  setProfile(s,{kind:'birth-date',birthDate:'2073-09-01'});assert.equal(item(s).age.status,'meets');
  assert.equal(s.recheckAgeAssessments(),0);assert.equal(item(s).ageAttention.length,0);assert.equal(item(s).notices.length,0);
  setProfile(s,OUTSIDE);assert.equal(s.recheckAgeAssessments(),0);
  // A revision-only change with the same material outcome is a no-op.
  s.db.exec(`UPDATE age_rule_state SET assessment_revision='age-assessment-v0'`);assert.equal(s.recheckAgeAssessments(),0);
  // Simulate the earlier comparison algorithm having stored "meets" for the same source version, facts and profile revision.
  const factsSignature=String(s.db.prepare('SELECT signature FROM age_rule_state WHERE id=?').get(id)!.signature);
  s.db.prepare(`UPDATE age_rule_state SET assessment_revision='age-assessment-v0',outcome_signature='synthetic-old-outcome',outcome_json='{"status":"meets","comparison":"meets"}' WHERE id=?`).run(id);
  s.db.close();s=new Store(path,()=>clock.now);
  assert.equal(s.recheckAgeAssessments(),1);
  const x=item(s),attention=x.ageAttention[0];
  assert.equal(x.ageAttention.length,1);assert.equal(x.passed,false);assert.equal(x.ageOverride.record,null);
  assert.equal(attention.before.outcome.status,'meets');assert.equal(attention.after.outcome.status,'outside');
  assert.deepEqual(attention.before.rules,attention.after.rules);assert.match(attention.oldRevision,/age-assessment-v0$/);
  assert.equal(String(s.db.prepare('SELECT signature FROM age_rule_state WHERE id=?').get(id)!.signature),factsSignature);
  assert.deepEqual(counts(),before);assert.equal(x.notices.length,0);
  s.action(id,'review',{version:x.version,changeIds:[]});assert.equal(item(s).ageAttention.length,1);
  s.action(id,'age-attention-ack',{attentionId:attention.attentionId,oldSignature:attention.oldSignature,newSignature:attention.newSignature});
  assert.equal(item(s).ageAttention.length,0);assert.equal(s.recheckAgeAssessments(),0);
  s.db.close();s=new Store(path,()=>clock.now);assert.equal(s.recheckAgeAssessments(),0);assert.equal(item(s).ageAttention.length,0);s.db.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('AGE-REVIEW-004: profile commands reject unsupported child/household/operator IDs and unknown fields without writing',()=>{
 const {store:s}=clocked();const expected=s.profileBasis().revisionId,profile={kind:'age-as-of',age:7,asOf:'2079-01-01'};
 for(const patch of [{subjectId:'child:unsupported'},{householdId:'household:unsupported'},{actorId:'operator:unsupported'},{extra:true},{action:'confirm'}])
  assert.throws(()=>s.updateProfile({commandKey:key('scope'),expectedRevisionId:expected,profile,...patch}),ProfileError,JSON.stringify(patch));
 assert.throws(()=>s.resolveLegacy({commandKey:key('scope'),action:'discard',expectedRevisionId:expected,subjectId:'child:unsupported'}),/single local child/);
 assert.throws(()=>s.resolveLegacy({commandKey:key('scope'),action:'discard',expectedRevisionId:expected,note:'x'}),/Unsupported profile command field: note/);
 assert.equal(s.profileView().revisions,1);assert.equal(s.db.prepare('SELECT count(*) n FROM age_profile_commands').get()!.n,0);
 // Explicit local IDs are the same command as omitted IDs.
 const first=s.updateProfile({commandKey:'synthetic-scope-ok',expectedRevisionId:expected,profile});
 assert.deepEqual(s.updateProfile({commandKey:'synthetic-scope-ok',expectedRevisionId:expected,profile,...LOCAL_SCOPE}),first);
});
test('AGE-ROOT-006: a lapsed Show anyway stays lapsed after the basis returns (profile and source A->B->A) until a fresh show',()=>{
 const {store:s}=clocked();intake(s,body(RULE),'a');setProfile(s,OUTSIDE);
 const show=()=>{const x=item(s);return s.ageOverride({id:x.id,action:'show',shownVersion:x.version,commandKey:key('show'),expectedOverrideId:x.ageOverride.record?.override_id??null,basisSignature:x.age.outcomeSignature});};
 show();assert.equal(item(s).ageOverride.active,true);
 setProfile(s,{kind:'birth-date',birthDate:'2073-09-01'});assert.equal(item(s).ageOverride.lapsed,true);
 setProfile(s,OUTSIDE);let x=item(s);
 assert.equal(x.age.outcomeSignature,x.ageOverride.record.basis.outcomeSignature);
 assert.equal(x.ageOverride.active,false);assert.equal(x.ageOverride.lapsed,true);assert.equal(x.verdict,'ineligible');assert.match(x.ageOverride.explanation,/changed after you chose Show anyway/);
 show();x=item(s);assert.equal(x.ageOverride.active,true);assert.equal(x.verdict,'needs checking');assert.equal(x.ageOverride.history.length,2);
 intake(s,body('Ages 8-10 as of September 1, 2080.'),'b');assert.equal(item(s).ageOverride.lapsed,true);
 intake(s,body(RULE),'c');x=item(s);assert.equal(x.ageOverride.lapsed,true);assert.equal(x.verdict,'ineligible');
 assert.throws(()=>s.db.exec('DELETE FROM age_override_lapses'),/append-only/);
 // Precision-only edits never lapse an active override.
 show();setProfile(s,{kind:'age-as-of',age:3,asOf:'2079-01-01'});assert.equal(item(s).ageOverride.active,true);
});
