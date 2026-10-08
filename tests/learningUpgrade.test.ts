import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Store,ConflictError,hash} from '../server/store.ts';
import {LOCAL_SCOPE} from '../src/decisions.ts';
import {INSTRUCTION_VERSION} from '../src/learning.ts';
// SYNTHETIC: file-backed temporary databases with invented listings. Pre-upgrade state is reproduced by removing the
// learning log (which did not exist before) and inserting decision rows exactly as the earlier code wrote them.
const captured='2026-10-04T02:35:33.636296Z';
const vevent=(uid:string,title:string,day:string)=>`BEGIN:VEVENT\nUID:${uid}\nSUMMARY:${title}\nDESCRIPTION:Synthetic listing.\nDTSTART:208006${day}T150000Z\nDTEND:208006${day}T160000Z\nEND:VEVENT`;
const body=`BEGIN:VCALENDAR\nVERSION:2.0\n${[['s1','Science evening one','10'],['s2','Science evening two','11'],['s3','Science evening three','12'],['s4','Science evening four','13'],['crafts','Crafts table','02']].map(r=>vevent(r[0],r[1],r[2])).join('\n')}\nEND:VCALENDAR`;
let n=0;const key=(label:string)=>`synthetic-${label}-${++n}`;
function intake(s:Store){const t=s.beginScan();try{s.ingest('prcr',body,'synthetic-batch',captured,'live',t.fence);}finally{s.endScan(t.fence);}}
const item=(s:Store,uid:string):any=>s.snapshot().items.find((i:any)=>i.uid===uid);
const learning=(s:Store):any=>s.snapshot().learning;
const feature=(s:Store,id:string):any=>learning(s).features.find((f:any)=>f.id===id);
const interest=(s:Store,uid:string,grouping:any={mode:'new'})=>{const x=item(s,uid);return s.learning.interest({commandKey:key('interest'),id:x.id,shownVersion:x.version,grouping,expectedEntryId:x.learning.active?.eventId??null,expectedControlRevision:learning(s).revision});};
const control=(s:Store,action:string)=>s.learning.control({commandKey:key(action),action,expectedControlRevision:learning(s).revision});
const dropLearning=(path:string)=>{const db=new DatabaseSync(path);db.exec('DROP TRIGGER learning_events_no_update; DROP TRIGGER learning_events_no_delete; DROP TABLE learning_events;');db.close();};
function withDirectory(label:string,run:(path:string)=>void){const directory=mkdtempSync(join(tmpdir(),`town-learning-${label}-`));try{run(join(directory,'state.sqlite'));}finally{rmSync(directory,{recursive:true,force:true});}}
function oldGenerallyPass(s:Store,uid:string){
 const x=item(s,uid);
 const old={id:x.id,action:'pass',shownVersion:1,householdId:LOCAL_SCOPE.householdId,subjectId:LOCAL_SCOPE.subjectId,actorId:LOCAL_SCOPE.actorId,reasons:['general'],dimensions:[],generalIntent:'generally',targetId:'topic:science',targetScope:'child',note:'Synthetic note',expectedActiveDecisionId:null,targetDecisionId:null};
 const snapshot={revision:'reason-decision-v1',sourceVersion:1,event:{...x},features:x.groundedFeatures,attendance:{displayed:{start:x.start,end:x.end,status:x.status,recurring:false},representations:[]},decisionScope:'occurrence',target:x.groundedFeatures[0],learning:{enabled:false,algorithmRevision:'none-phase1',scope:'child',targetId:'topic:science',contribution:null}};
 const result={decisionId:`old-${uid}`,action:'pass',shownVersion:1,currentVersion:1,staleAtSubmit:false,createdAt:captured};
 s.db.prepare('INSERT INTO decision_events(decision_id,command_key,payload_hash,opportunity_id,household_id,subject_id,actor_id,action,shown_version,payload_json,snapshot_json,supersedes_id,reverses_id,target_decision_id,result_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
  .run(`old-${uid}`,`old-key-${uid}`,hash(JSON.stringify(old)),x.id,LOCAL_SCOPE.householdId,LOCAL_SCOPE.subjectId,LOCAL_SCOPE.actorId,'pass',1,JSON.stringify(old),JSON.stringify(snapshot),null,null,null,JSON.stringify(result),captured);
 const {id,action,shownVersion,reasons,generalIntent,targetId,targetScope,note,expectedActiveDecisionId}=old;
 return {command:{id,action,shownVersion,reasons,generalIntent,targetId,targetScope,note,expectedActiveDecisionId,commandKey:`old-key-${uid}`,...LOCAL_SCOPE},result};
}
test('pre-upgrade database migrates with learning off; bookmarks, More/Less and old Generally passes stay inert; nothing is invented',()=>withDirectory('migrate',path=>{
 let s=new Store(path);intake(s);s.updateSettings({weights:{science:6}});
 s.action(item(s,'s1').id,'interested',true);s.action(item(s,'s2').id,'feedback','more');s.action(item(s,'crafts').id,'feedback','less');
 const old=oldGenerallyPass(s,'s3');const order=s.snapshot().items.map((i:any)=>i.uid),settings=s.settings();
 s.db.close();dropLearning(path);
 s=new Store(path);
 assert.equal(s.db.prepare('SELECT count(*) n FROM learning_events').get()!.n,0);
 assert.equal(learning(s).status,'off');assert.equal(learning(s).revision,null);
 assert.equal(item(s,'s1').interested,true);assert.equal(item(s,'s1').learning.legacyBookmark,true);assert.equal(item(s,'s1').learning.active,null);
 assert.equal(item(s,'s2').legacyFeedback[0].direction,'more');assert.equal(item(s,'s2').learning.history.length,0);
 assert.equal(item(s,'s3').decision.active.decision_id,'old-s3');assert.equal(feature(s,'topic:science').resolved,6);
 assert.deepEqual(s.snapshot().items.map((i:any)=>i.uid),order);assert.deepEqual(s.settings(),settings);
 assert.deepEqual(s.decision(old.command),old.result);
 assert.throws(()=>s.decision({...old.command,commandKey:key('fresh'),expectedActiveDecisionId:'old-s3'}),(e:any)=>e instanceof ConflictError);
 control(s,'on');assert.equal(feature(s,'topic:science').counted,0);assert.equal(item(s,'s1').learning.active,null);
 s.db.close();
}));
test('file-backed restart replays controls, instructions, counted groups, replacements, Undo and reset identically',()=>withDirectory('restart',path=>{
 let s=new Store(path);intake(s);control(s,'on');
 for(const uid of ['s1','s2','crafts'])interest(s,uid);interest(s,'s3',{mode:'unknown'});
 const x=item(s,'s3');s.learning.replace({commandKey:key('regroup'),id:x.id,mode:'regroup',targetEntryId:x.learning.active.eventId,grouping:{mode:'new'},expectedControlRevision:learning(s).revision});
 const p=item(s,'s4');const pass=s.decision({id:p.id,action:'pass',shownVersion:1,commandKey:'synthetic-restart-pass',expectedActiveDecisionId:null,reasons:['general'],generalIntent:'generally',instructionVersion:INSTRUCTION_VERSION,expectedInstructionId:null,targetId:'topic:science',targetScope:'household',...LOCAL_SCOPE});
 s.learning.instruction({commandKey:key('instruction'),scope:'child',featureId:'topic:crafts',action:'set',value:2,expectedInstructionId:null});
 const undoInput={commandKey:'synthetic-restart-undo',id:item(s,'crafts').id,targetEntryId:item(s,'crafts').learning.active.eventId};
 const undone=s.learning.undo(undoInput);
 const view=(t:Store)=>JSON.stringify({learning:learning(t),items:t.snapshot().items.map((i:any)=>[i.uid,i.score,i.learnedScore,i.learning,i.interested,i.passed])});
 const before=view(s);s.db.close();
 s=new Store(path);
 assert.equal(view(s),before);
 assert.equal(feature(s,'topic:science').resolved,0);assert.equal(feature(s,'topic:science').suppressed,3);
 assert.deepEqual(s.learning.undo(undoInput),undone);
 assert.deepEqual(s.decision({id:p.id,action:'pass',shownVersion:1,commandKey:'synthetic-restart-pass',expectedActiveDecisionId:null,reasons:['general'],generalIntent:'generally',instructionVersion:INSTRUCTION_VERSION,expectedInstructionId:null,targetId:'topic:science',targetScope:'household',...LOCAL_SCOPE}),pass);
 s.decision({id:p.id,action:'undo',shownVersion:1,commandKey:key('undo-pass'),expectedActiveDecisionId:pass.decisionId,targetDecisionId:pass.decisionId,...LOCAL_SCOPE});
 assert.equal(feature(s,'topic:science').counted,3);assert.equal(item(s,'s4').learnedScore,2);
 control(s,'reset');s.db.close();
 s=new Store(path);
 assert.equal(learning(s).epoch,1);assert.equal(feature(s,'topic:science').counted,0);assert.equal(feature(s,'topic:crafts').resolved,2);
 assert.equal(item(s,'s1').learning.earlierActive.length,1);
 s.db.close();
}));
test('two windows on one database: a stale second window cannot overwrite current learning intent',()=>withDirectory('race',path=>{
 const a=new Store(path);intake(a);const b=new Store(path);
 try{
  const shown=learning(b).revision,x=item(b,'s1');
  control(a,'on');
  assert.throws(()=>b.learning.interest({commandKey:key('b'),id:x.id,shownVersion:1,grouping:{mode:'new'},expectedEntryId:null,expectedControlRevision:shown}),(e:any)=>e instanceof ConflictError);
  assert.equal(item(a,'s1').interested,false);
  interest(a,'s1');const staleEntry=null;
  assert.throws(()=>b.learning.interest({commandKey:key('b2'),id:x.id,shownVersion:1,grouping:{mode:'new'},expectedEntryId:staleEntry,expectedControlRevision:learning(b).revision}),(e:any)=>e instanceof ConflictError);
  assert.throws(()=>b.learning.control({commandKey:key('b3'),action:'pause',expectedControlRevision:shown}),(e:any)=>e instanceof ConflictError);
  b.learning.instruction({commandKey:key('b4'),scope:'household',featureId:'topic:science',action:'set',value:5,expectedInstructionId:null});
  assert.throws(()=>a.learning.instruction({commandKey:key('a5'),scope:'household',featureId:'topic:science',action:'set',value:1,expectedInstructionId:null}),(e:any)=>e instanceof ConflictError);
  assert.equal(feature(a,'topic:science').resolved,5);assert.equal(feature(a,'topic:science').suppressed,1);assert.equal(item(a,'s1').learning.active.counting,true);
 }finally{a.db.close();b.db.close();}
}));
test('a failed learning migration rolls back with existing state intact and replays safely',()=>withDirectory('rollback',path=>{
 let s=new Store(path);intake(s);s.action(item(s,'s1').id,'interested',true);s.db.close();
 dropLearning(path);
 let db=new DatabaseSync(path);db.exec('CREATE TABLE learning_events_by_item(x)');db.close();
 assert.throws(()=>new Store(path),/learning_events_by_item/);
 db=new DatabaseSync(path);
 assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='learning_events'").get(),undefined);
 assert.equal(db.prepare('SELECT interested FROM family_state WHERE interested=1').all().length,1);
 db.exec('DROP TABLE learning_events_by_item');db.close();
 s=new Store(path);assert.equal(learning(s).status,'off');assert.equal(item(s,'s1').interested,true);s.db.close();
}));
const generallyScience=(s:Store,uid:string,targetScope:string,commandKey=key('generally'))=>{const x=item(s,uid);return s.decision({id:x.id,action:'pass',shownVersion:x.version,commandKey,expectedActiveDecisionId:x.decision.active?.decision_id??null,reasons:['general'],generalIntent:'generally',instructionVersion:INSTRUCTION_VERSION,expectedInstructionId:feature(s,'topic:science')[targetScope]?.eventId??null,targetId:'topic:science',targetScope,...LOCAL_SCOPE});};
const timingPass=(s:Store,uid:string)=>{const x=item(s,uid);return s.decision({id:x.id,action:'pass',shownVersion:x.version,commandKey:key('timing'),expectedActiveDecisionId:x.decision.active?.decision_id??null,reasons:['timing'],...LOCAL_SCOPE});};
const undoPass=(s:Store,uid:string)=>{const x=item(s,uid);return s.decision({id:x.id,action:'undo',shownVersion:x.version,commandKey:key('undo'),expectedActiveDecisionId:x.decision.active.decision_id,targetDecisionId:x.decision.active.decision_id,...LOCAL_SCOPE});};
test('LEARN-CODE-001: a frozen Clear boundary survives restart; a pre-repair Clear row without the field stays conservative',()=>{
 const science=(s:Store)=>({counted:feature(s,'topic:science').counted,suppressed:feature(s,'topic:science').suppressed});
 withDirectory('clear',path=>{
  let s=new Store(path);intake(s);control(s,'on');for(const uid of ['s1','s2','s3'])interest(s,uid);
  generallyScience(s,'s4','child');
  s.learning.instruction({commandKey:key('clear'),scope:'child',featureId:'topic:science',action:'clear',expectedInstructionId:feature(s,'topic:science').child.eventId});
  s.db.close();s=new Store(path);
  timingPass(s,'s4');assert.deepEqual(science(s),{counted:0,suppressed:3});
  undoPass(s,'s4');s.db.close();s=new Store(path);assert.deepEqual(science(s),{counted:0,suppressed:3});
  s.db.close();
 });
 withDirectory('legacy-clear',path=>{
  let s=new Store(path);intake(s);control(s,'on');for(const uid of ['s1','s2','s3'])interest(s,uid);
  generallyScience(s,'s4','household');
  // Exactly the shape round-1 code wrote for a manual Clear: no frozenCutoff field.
  s.db.prepare("INSERT INTO learning_events(event_id,command_key,payload_hash,kind,household_id,subject_id,actor_id,opportunity_id,epoch,data_json,attribution_json,origin_decision_id,target_event_id,result_json,created_at) VALUES ('round1-clear','round1-clear-key','synthetic-round1','instruction',?,?,?,NULL,0,?,NULL,NULL,NULL,'{}',?)")
   .run(LOCAL_SCOPE.householdId,LOCAL_SCOPE.subjectId,LOCAL_SCOPE.actorId,JSON.stringify({scope:'household',featureId:'topic:science',action:'clear',value:null,provenance:null}),captured);
  s.db.close();s=new Store(path);
  assert.equal(feature(s,'topic:science').overlay,null);assert.deepEqual(science(s),{counted:0,suppressed:3});
  timingPass(s,'s4');assert.deepEqual(science(s),{counted:0,suppressed:3});
  s.db.close();
 });
});
test('LEARN-O-10: learning, bookmark, pass, Hide, Undo, reset and restart never acknowledge or drop source or local-age attention; eligibility stays creation-time',()=>withDirectory('attention',path=>{
 const rule='Ages 7-10 as of September 1\\, 2080.';
 const cal=(agedDay:string,plainDay:string)=>`BEGIN:VCALENDAR\nVERSION:2.0\n${[['aged','Science class',agedDay],['plain','Science studio',plainDay]].map(([uid,title,day])=>`BEGIN:VEVENT\nUID:${uid}\nSUMMARY:${title}\nDESCRIPTION:${rule}\nDTSTART:208006${day}T150000Z\nDTEND:208006${day}T160000Z\nEND:VEVENT`).join('\n')}\nEND:VCALENDAR`;
 const clock={now:new Date('2079-01-01T15:00:00Z')};
 const ingest=(s:Store,text:string,batch:string)=>{const t=s.beginScan();try{s.ingest('prcr',text,batch,captured,'live',t.fence);}finally{s.endScan(t.fence);}};
 let s=new Store(path,()=>clock.now);
 ingest(s,cal('05','05'),'attention-1');s.action(item(s,'aged').id,'surface');
 // Provider schedule change: eligible for the displayed listing, created ineligible for the never-seen, unsaved one.
 ingest(s,cal('06','06'),'attention-2');
 // Local age extractor correction on unchanged stored source (same simulation as the age tests).
 s.db.exec(`UPDATE age_rule_state SET extractor_revision='age-words-v0',signature='synthetic-old',facts_json='{"rules":[],"conflict":false,"unresolved":[]}'`);
 assert.equal(s.recheckAgeAssessments(),2);
 const aged=item(s,'aged'),notice=aged.notices.map((n:any)=>n.change_id),attention=aged.ageAttention[0];
 assert.equal(notice.length,1);assert.equal(aged.ageAttention.length,1);assert.equal(aged.notices[0].critical,1);
 assert.equal(item(s,'plain').changes[0].critical,1);
 const check=(label:string)=>{
  const x=item(s,'aged'),p=item(s,'plain');
  assert.deepEqual(x.notices.map((n:any)=>n.change_id),notice,label);assert.equal(x.notices[0].ack_at,null,label);
  assert.deepEqual(x.ageAttention.map((a:any)=>a.attentionId),[attention.attentionId],label);
  assert.equal(p.notices.length,0,label);assert.equal(p.ageAttention.length,0,label);
 };
 check('initial');
 control(s,'on');interest(s,'aged');interest(s,'plain');check('Interested bookmark and signal');
 const agedId=item(s,'aged').id;
 s.learning.replace({commandKey:key('regroup'),id:agedId,mode:'regroup',targetEntryId:item(s,'aged').learning.active.eventId,grouping:{mode:'unknown'},expectedControlRevision:learning(s).revision});check('regroup');
 s.learning.instruction({commandKey:key('set'),scope:'household',featureId:'topic:science',action:'set',value:3,expectedInstructionId:null});check('explicit instruction');
 generallyScience(s,'aged','child');s.action(agedId,'hidden',true);check('Generally pass and Hide');
 undoPass(s,'aged');s.learning.undo({commandKey:key('undo-signal'),id:agedId,targetEntryId:item(s,'aged').learning.active.eventId});s.action(agedId,'interested',false);check('Undo pass, Undo Interested, Unsave');
 control(s,'reset');control(s,'pause');check('reset and pause');
 s.db.close();s=new Store(path,()=>clock.now);assert.equal(s.recheckAgeAssessments(),0);check('restart');
 // Only exact keys acknowledge, each its own kind.
 assert.throws(()=>s.action(agedId,'age-attention-ack',{attentionId:attention.attentionId,oldSignature:attention.oldSignature,newSignature:'other'}),/not the one shown/);
 s.action(agedId,'review',{version:item(s,'aged').version,changeIds:[]});check('review without change IDs');
 s.action(agedId,'review',{version:item(s,'aged').version,changeIds:notice});
 assert.equal(item(s,'aged').notices.length,0);assert.equal(item(s,'aged').ageAttention.length,1);
 s.action(agedId,'age-attention-ack',{attentionId:attention.attentionId,oldSignature:attention.oldSignature,newSignature:attention.newSignature});
 assert.equal(item(s,'aged').ageAttention.length,0);assert.equal(item(s,'plain').notices.length,0);
 // Positive control: plain is now bookmarked, so a NEW change is eligible at its creation.
 ingest(s,cal('06','07'),'attention-3');assert.equal(item(s,'plain').notices.length,1);
 s.db.close();
}));
