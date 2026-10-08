import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,ConflictError,hash} from '../server/store.ts';
import {LOCAL_SCOPE} from '../src/decisions.ts';
import {INSTRUCTION_VERSION,allocate} from '../src/learning.ts';
// SYNTHETIC: invented listings only. No household data, profile or notes.
const captured='2026-10-04T02:35:33.636296Z';
const vevent=(uid:string,title:string,description:string,day:string)=>`BEGIN:VEVENT\nUID:${uid}\nSUMMARY:${title}\nDESCRIPTION:${description}\nDTSTART:208006${day}T150000Z\nDTEND:208006${day}T160000Z\nEND:VEVENT`;
const LISTINGS:[string,string,string,string][]=[
 ['s1','Science evening one','Synthetic telescope talk.','10'],['s2','Science evening two','Synthetic telescope talk.','11'],['s3','Science evening three','Synthetic telescope talk.','12'],['s4','Science evening four','Synthetic telescope talk.','13'],
 ['crafts','Crafts table','Synthetic paper crafts.','02'],['chess','Chess club','Synthetic board games.','20'],['mixed','Science and crafts afternoon','Synthetic mixed session.','21'],
 ['pa','Sailing lesson','Synthetic harbor session A.','14'],['pb','Sailing lesson','Synthetic harbor session B.','15'],['pc','Sailing lesson','Synthetic harbor session C.','16'],
];
const calendar=(rows=LISTINGS)=>`BEGIN:VCALENDAR\nVERSION:2.0\n${rows.map(r=>vevent(...r)).join('\n')}\nEND:VCALENDAR`;
let n=0;const key=(label:string)=>`synthetic-${label}-${++n}`;
function intake(s:Store,body=calendar(),batch=key('batch')){const t=s.beginScan();try{s.ingest('prcr',body,batch,captured,'live',t.fence);}finally{s.endScan(t.fence);}}
function setup(weights:Record<string,number>={}){const s=new Store(':memory:');intake(s);if(Object.keys(weights).length)s.updateSettings({weights});return s;}
const item=(s:Store,uid:string):any=>s.snapshot().items.find((i:any)=>i.uid===uid);
const learning=(s:Store):any=>s.snapshot().learning;
const feature=(s:Store,id:string):any=>learning(s).features.find((f:any)=>f.id===id);
const order=(s:Store)=>s.snapshot().items.map((i:any)=>i.uid);
const control=(s:Store,action:string)=>s.learning.control({commandKey:key(action),action,expectedControlRevision:learning(s).revision});
function interest(s:Store,uid:string,grouping:any={mode:'new'},patch:any={}){const x=item(s,uid);return s.learning.interest({commandKey:key('interest'),id:x.id,shownVersion:x.version,grouping,expectedEntryId:x.learning.active?.eventId??null,expectedControlRevision:learning(s).revision,...patch});}
function regroup(s:Store,uid:string,grouping:any){const x=item(s,uid);return s.learning.replace({commandKey:key('regroup'),id:x.id,mode:'regroup',targetEntryId:x.learning.active.eventId,grouping,expectedControlRevision:learning(s).revision});}
function rerecord(s:Store,uid:string,preview?:any[]){const x=item(s,uid);return s.learning.replace({commandKey:key('rerecord'),id:x.id,mode:'rerecord',targetEntryId:x.learning.active.eventId,grouping:{mode:'keep'},shownVersion:x.version,previewAllocation:preview??allocate(x.groundedFeatures.map((f:any)=>f.id)),expectedControlRevision:learning(s).revision});}
const undoSignal=(s:Store,uid:string,eventId=item(s,uid).learning.active.eventId)=>s.learning.undo({commandKey:key('undo-signal'),id:item(s,uid).id,targetEntryId:eventId});
function instruction(s:Store,featureId:string,scope:string,action:'set'|'clear',value?:number,extra:any={}){return s.learning.instruction({commandKey:key('instruction'),scope,featureId,action,...(action==='set'?{value}:{}),expectedInstructionId:feature(s,featureId)?.[scope]?.eventId??null,...extra});}
// A Generally form reviews the instruction currently at its scope/topic unless a test supplies a stale one explicitly.
const reviewed=(s:Store,patch:any)=>patch.instructionVersion&&!('expectedInstructionId' in patch)?{expectedInstructionId:feature(s,patch.targetId)?.[patch.targetScope]?.eventId??null}:{};
function pass(s:Store,uid:string,patch:any={}){const x=item(s,uid);return s.decision({id:x.id,action:'pass',shownVersion:x.version,commandKey:key('pass'),expectedActiveDecisionId:x.decision.active?.decision_id??null,reasons:['other'],...LOCAL_SCOPE,...reviewed(s,patch),...patch});}
const generally=(targetId:string,targetScope='child',reasons=['general'])=>({reasons,generalIntent:'generally',instructionVersion:INSTRUCTION_VERSION,targetId,targetScope});
function undoPass(s:Store,uid:string){const x=item(s,uid);return s.decision({id:x.id,action:'undo',shownVersion:x.version,commandKey:key('undo'),expectedActiveDecisionId:x.decision.active.decision_id,targetDecisionId:x.decision.active.decision_id,...LOCAL_SCOPE});}
const rows=(s:Store)=>Number(s.db.prepare('SELECT count(*) n FROM learning_events').get()!.n);
const countThree=(s:Store,uids=['s1','s2','s3'])=>{for(const uid of uids)interest(s,uid);};

test('fresh install starts off; Interested saves the bookmark and records only that no signal was created; turning on never backfills',()=>{
 const s=setup();
 assert.equal(learning(s).status,'off');assert.equal(learning(s).revision,null);
 const r=interest(s,'s1');
 assert.equal(r.outcome,'no-signal');assert.equal(r.bookmark,true);assert.equal(item(s,'s1').interested,true);
 assert.equal(item(s,'s1').learning.active,null);assert.equal(item(s,'s1').learning.history[0].outcome,'no-signal');
 assert.equal(item(s,'s1').learning.history[0].attribution,null);
 s.action(item(s,'s2').id,'interested',true);
 control(s,'on');
 assert.equal(learning(s).status,'on');assert.equal(feature(s,'topic:science').counted,0);
 assert.equal(item(s,'s1').learning.active,null);assert.equal(item(s,'s2').learning.legacyBookmark,true);
 assert.equal(interest(s,'s1').outcome,'counted');assert.equal(feature(s,'topic:science').counted,1);
});
test('three distinct confirmed opportunities lift ties; two, uncertain, retries and one repeated program do not',()=>{
 const s=setup();control(s,'on');
 assert.ok(order(s).indexOf('crafts')<order(s).indexOf('s4'));
 countThree(s,['s1','s2']);
 assert.equal(feature(s,'topic:science').status,'insufficient');assert.equal(item(s,'s4').learnedScore,0);
 // A retry/resave of the same listing under a new command key adds no credit.
 assert.equal(interest(s,'s1').outcome,'duplicate-item');assert.equal(feature(s,'topic:science').counted,2);
 // Different UIDs of one program: the parent identifies them as the same program, so they count once.
 assert.equal(interest(s,'pa').outcome,'counted');const g=item(s,'pa').learning.active.groupId;
 assert.equal(interest(s,'pb',{mode:'same',groupId:g}).outcome,'duplicate-group');
 assert.equal(interest(s,'pc',{mode:'same',groupId:g}).outcome,'duplicate-group');
 assert.equal(feature(s,'topic:sailing').counted,1);assert.equal(feature(s,'topic:sailing').uncounted,2);
 // Unsure independence is recorded and inspectable but not counted.
 assert.equal(interest(s,'s3',{mode:'unknown'}).outcome,'provisional');
 assert.equal(feature(s,'topic:science').counted,2);assert.equal(item(s,'s4').learnedScore,0);
 assert.equal(regroup(s,'s3',{mode:'new'}).outcome,'counted');
 assert.equal(feature(s,'topic:science').counted,3);assert.equal(feature(s,'topic:science').applied,2);
 assert.equal(item(s,'s4').learnedScore,2);
 assert.ok(order(s).indexOf('s4')<order(s).indexOf('crafts'));
});
test('weak lift never overtakes a strictly higher explicit score; pause reproduces the explicit baseline order exactly',()=>{
 const s=setup({chess:1});const baseline=order(s);
 control(s,'on');countThree(s);
 assert.equal(item(s,'s4').learnedScore,2);assert.equal(item(s,'chess').score,1);
 assert.ok(order(s).indexOf('chess')<order(s).indexOf('s4'));
 assert.notDeepEqual(order(s),baseline);
 control(s,'pause');
 assert.deepEqual(order(s),baseline);assert.equal(item(s,'s4').learnedScore,0);assert.equal(feature(s,'topic:science').lift,2);
 control(s,'on');assert.equal(item(s,'s4').learnedScore,2);
});
test('a Generally pass sets exactly its scoped feature to 0; timing, fit, concern, Hide, review, exposure and listing-only passes change nothing',()=>{
 const s=setup({science:5,craft:3});control(s,'on');countThree(s,['crafts','s1','s2']);
 const before=JSON.stringify({features:learning(s).features,scores:s.snapshot().items.map((i:any)=>[i.uid,i.score,i.learnedScore])}),settings=s.settings();
 const unchanged=()=>assert.equal(JSON.stringify({features:learning(s).features,scores:s.snapshot().items.map((i:any)=>[i.uid,i.score,i.learnedScore])}),before);
 const id=item(s,'mixed').id;
 pass(s,'mixed',{reasons:['timing']});unchanged();
 pass(s,'mixed',{reasons:['wrong-fit'],fitDimensions:['too-young']});unchanged();
 pass(s,'mixed',{reasons:['concern','conflict'],dimensions:['price','organizer']});unchanged();
 pass(s,'mixed',{reasons:['general']});unchanged();
 s.action(id,'hidden',true);s.action(id,'surface');s.action(id,'review',{version:1,changeIds:[]});s.action(id,'feedback','less');unchanged();
 assert.equal(s.db.prepare("SELECT count(*) n FROM learning_events WHERE kind='instruction'").get()!.n,0);
 // Mixed reasons with Generally: only the one selected topic at the selected scope changes.
 const r=pass(s,'mixed',generally('topic:science','child',['general','timing']));
 assert.ok(r.instructionId);
 assert.equal(feature(s,'topic:science').resolved,0);assert.equal(feature(s,'topic:science').child.originDecisionId,r.decisionId);assert.equal(feature(s,'topic:science').household,null);
 assert.equal(feature(s,'topic:crafts').resolved,3);assert.equal(feature(s,'topic:crafts').applied,feature(s,'topic:crafts').lift);
 assert.equal(item(s,'mixed').score,3);assert.equal(item(s,'s4').score,0);assert.equal(item(s,'crafts').score,3);
 assert.deepEqual(s.settings(),settings);
 assert.equal(item(s,'mixed').decision.active.snapshot.learning.instruction.resolvedBefore,5);
});
test('pass-linked instruction: supersession retracts only it, Undo restores it at its original sequence, a newer independent instruction still wins',()=>{
 const s=setup({science:5});
 pass(s,'s1',generally('topic:science'));const i1=feature(s,'topic:science').child.eventId;
 assert.equal(feature(s,'topic:science').resolved,0);
 instruction(s,'topic:science','child','set',6);assert.equal(feature(s,'topic:science').resolved,6);
 pass(s,'s1',{reasons:['timing']});assert.equal(feature(s,'topic:science').resolved,6);
 undoPass(s,'s1');assert.equal(item(s,'s1').decision.active.payload.generalIntent,'generally');assert.equal(feature(s,'topic:science').resolved,6);
 undoPass(s,'s1');assert.equal(feature(s,'topic:science').resolved,6);
 instruction(s,'topic:science','child','clear');assert.equal(feature(s,'topic:science').resolved,5);
 const t=setup({science:5});
 pass(t,'s1',generally('topic:science'));const first=feature(t,'topic:science').child.eventId;
 pass(t,'s1',{reasons:['timing']});assert.equal(feature(t,'topic:science').resolved,5);assert.equal(feature(t,'topic:science').child,null);
 undoPass(t,'s1');assert.equal(feature(t,'topic:science').resolved,0);assert.equal(feature(t,'topic:science').child.eventId,first);
 pass(t,'s1',generally('topic:science'));const second=feature(t,'topic:science').child.eventId;
 assert.notEqual(second,first);
 undoPass(t,'s1');assert.equal(feature(t,'topic:science').child.eventId,first);
 assert.notEqual(i1,first);
});
test('instructions suppress earlier weak evidence: Clear keeps the cutoff, pass retraction restores the evidence, later signals count',()=>{
 const s=setup();control(s,'on');countThree(s);
 assert.equal(item(s,'s4').learnedScore,2);
 pass(s,'mixed',generally('topic:science','household'));
 assert.equal(feature(s,'topic:science').status,'explicit');assert.equal(item(s,'s4').learnedScore,0);
 pass(s,'mixed',{reasons:['timing']});// retracts only that pass's instruction
 assert.equal(feature(s,'topic:science').overlay,null);assert.equal(item(s,'s4').learnedScore,2);
 instruction(s,'topic:science','household','set',4);assert.equal(item(s,'s4').score,4);assert.equal(item(s,'s4').learnedScore,0);
 instruction(s,'topic:science','household','clear');
 assert.equal(feature(s,'topic:science').suppressed,3);assert.equal(feature(s,'topic:science').counted,0);assert.equal(item(s,'s4').learnedScore,0);
 for(const uid of ['s1','s2','s3'])undoSignal(s,uid);
 countThree(s);assert.equal(feature(s,'topic:science').counted,3);assert.equal(item(s,'s4').learnedScore,2);
});
test('child overrides household overrides Settings; scopes stay separate and Settings are never rewritten',()=>{
 const s=setup({science:4});const settings=s.settings();
 instruction(s,'topic:science','household','set',7);assert.equal(item(s,'s1').score,7);
 instruction(s,'topic:science','child','set',2);assert.equal(item(s,'s1').score,2);assert.equal(feature(s,'topic:science').household.value,7);
 instruction(s,'format:concert','household','set',3);assert.equal(feature(s,'format:concert').resolved,3);assert.equal(feature(s,'topic:chess').resolved,0);
 instruction(s,'topic:science','child','clear');assert.equal(item(s,'s1').score,7);
 instruction(s,'topic:science','household','clear');assert.equal(item(s,'s1').score,4);
 assert.throws(()=>instruction(s,'topic:science','household','clear'),/no instruction to clear/);
 assert.deepEqual(s.settings(),settings);
});
test('pre-upgrade Generally receipts replay unchanged; a fresh unversioned Generally asks for reload; Apply as preference is independent',()=>{
 const s=setup({science:5});const x=item(s,'s1');
 // Reproduce exactly what the pre-upgrade code wrote: canonical payload without an instruction version, no instruction row.
 const old={id:x.id,action:'pass',shownVersion:1,householdId:LOCAL_SCOPE.householdId,subjectId:LOCAL_SCOPE.subjectId,actorId:LOCAL_SCOPE.actorId,reasons:['general'],dimensions:[],generalIntent:'generally',targetId:'topic:science',targetScope:'household',note:'',expectedActiveDecisionId:null,targetDecisionId:null};
 const real=pass(s,'s2');const snapshot=JSON.parse(String(s.db.prepare('SELECT snapshot_json FROM decision_events WHERE decision_id=?').get(real.decisionId)!.snapshot_json));
 snapshot.learning={enabled:false,algorithmRevision:'none-phase1',scope:'household',targetId:'topic:science',contribution:null};
 const result={decisionId:'pre-upgrade-pass',action:'pass',shownVersion:1,currentVersion:1,staleAtSubmit:false,createdAt:captured};
 s.db.prepare('INSERT INTO decision_events(decision_id,command_key,payload_hash,opportunity_id,household_id,subject_id,actor_id,action,shown_version,payload_json,snapshot_json,supersedes_id,reverses_id,target_decision_id,result_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
  .run('pre-upgrade-pass','pre-upgrade-key',hash(JSON.stringify(old)),x.id,LOCAL_SCOPE.householdId,LOCAL_SCOPE.subjectId,LOCAL_SCOPE.actorId,'pass',1,JSON.stringify(old),JSON.stringify(snapshot),null,null,null,JSON.stringify(result),captured);
 const {id,action,shownVersion,reasons,generalIntent,targetId,targetScope,expectedActiveDecisionId}=old;
 assert.deepEqual(s.decision({id,action,shownVersion,reasons,generalIntent,targetId,targetScope,expectedActiveDecisionId,commandKey:'pre-upgrade-key',...LOCAL_SCOPE}),result);
 assert.equal(feature(s,'topic:science').resolved,5);assert.equal(item(s,'s1').decision.active.decision_id,'pre-upgrade-pass');
 const before=s.db.prepare('SELECT count(*) n FROM decision_events').get()!.n;
 assert.throws(()=>s.decision({id,action,shownVersion,reasons,generalIntent,targetId,targetScope,expectedActiveDecisionId:'pre-upgrade-pass',commandKey:key('fresh-unversioned'),...LOCAL_SCOPE}),(e:any)=>e instanceof ConflictError&&/predates/.test(e.message));
 assert.equal(s.db.prepare('SELECT count(*) n FROM decision_events').get()!.n,before);
 assert.throws(()=>instruction(s,'topic:science','child','set',0,{provenance:{legacyDecisionId:'pre-upgrade-pass'}}),/does not name/);
 instruction(s,'topic:science','household','set',0,{provenance:{legacyDecisionId:'pre-upgrade-pass'}});
 assert.equal(feature(s,'topic:science').resolved,0);assert.deepEqual(feature(s,'topic:science').household.provenance,{legacyDecisionId:'pre-upgrade-pass'});
 undoPass(s,'s1');assert.equal(item(s,'s1').passed,false);assert.equal(feature(s,'topic:science').resolved,0);
});
test('frozen attribution survives source edits; regroup copies it byte-for-byte; re-record needs the confirmed preview; exact Undo restores',()=>{
 const s=setup();control(s,'on');
 interest(s,'mixed');const original=item(s,'mixed').learning.active;
 assert.deepEqual(original.attribution.allocation.map((a:any)=>[a.featureId,a.milli]),[['topic:crafts',500],['topic:science',500]]);
 intake(s,calendar(LISTINGS.map(r=>r[0]==='mixed'?['mixed','Chess afternoon','Synthetic board games only.','21']:r)));
 let x=item(s,'mixed');
 assert.equal(x.version,2);assert.deepEqual(x.groundedFeatures.map((f:any)=>f.id),['topic:chess']);
 assert.equal(x.learning.active.eventId,original.eventId);assert.equal(x.learning.active.attribution.sourceVersion,1);
 assert.equal(feature(s,'topic:science').counted,1);assert.equal(feature(s,'topic:chess').counted,0);
 regroup(s,'mixed',{mode:'unknown'});
 const raw=(eventId:string)=>String(s.db.prepare('SELECT attribution_json FROM learning_events WHERE event_id=?').get(eventId)!.attribution_json);
 x=item(s,'mixed');assert.equal(raw(x.learning.active.eventId),raw(original.eventId));assert.equal(x.learning.active.outcome,'provisional');
 assert.throws(()=>rerecord(s,'mixed',allocate(['topic:crafts','topic:science'])),(e:any)=>e instanceof ConflictError);
 const replaced=x.learning.active.eventId;
 rerecord(s,'mixed');x=item(s,'mixed');
 assert.equal(x.learning.active.attribution.sourceVersion,2);assert.deepEqual(x.learning.active.attribution.allocation.map((a:any)=>a.featureId),['topic:chess']);
 assert.equal(x.learning.active.certainty,'unknown');assert.equal(x.learning.active.replacesId,replaced);
 undoSignal(s,'mixed');assert.equal(item(s,'mixed').learning.active.eventId,replaced);
 undoSignal(s,'mixed');x=item(s,'mixed');
 assert.equal(x.learning.active.eventId,original.eventId);assert.equal(x.learning.active.counting,true);assert.equal(feature(s,'topic:science').counted,1);
 // Stale-tab submission freezes the version that was shown.
 const stale=s.learning.interest({commandKey:key('stale'),id:x.id,shownVersion:1,grouping:{mode:'new'},expectedEntryId:x.learning.active.eventId,expectedControlRevision:learning(s).revision});
 assert.equal(stale.staleAtSubmit,true);assert.equal(stale.outcome,'duplicate-item');
});
test('Undo of a replacement whose original group is now held elsewhere restores it visibly non-counting, permanently',()=>{
 const s=setup();control(s,'on');
 interest(s,'pa');const g=item(s,'pa').learning.active.groupId,c1=item(s,'pa').learning.active.eventId;
 regroup(s,'pa',{mode:'new'});
 assert.equal(interest(s,'pb',{mode:'same',groupId:g}).outcome,'counted');const c2=item(s,'pb').learning.active.eventId;
 const undo=undoSignal(s,'pa');
 assert.deepEqual(undo.restoration,{eventId:c1,counting:false,outcome:'duplicate-group-restoration',linkedEventId:c2});
 assert.equal(item(s,'pa').learning.active.eventId,c1);assert.equal(item(s,'pa').learning.active.counting,false);
 assert.equal(feature(s,'topic:sailing').counted,1);
 undoSignal(s,'pb');
 assert.equal(item(s,'pa').learning.active.counting,false);assert.equal(feature(s,'topic:sailing').counted,0);
 assert.equal(regroup(s,'pa',{mode:'new'}).outcome,'counted');assert.equal(feature(s,'topic:sailing').counted,1);
});
test('pause allows exact Undo but rejects new regroup/re-record; reset keeps history and settings and isolates periods',()=>{
 const s=setup({chess:2});control(s,'on');countThree(s);
 pass(s,'chess',generally('topic:chess','household'));s.action(item(s,'crafts').id,'interested',true);
 control(s,'pause');
 assert.throws(()=>regroup(s,'s1',{mode:'unknown'}),(e:any)=>e instanceof ConflictError&&/nothing is deferred/.test(e.message));
 assert.throws(()=>rerecord(s,'s1'),(e:any)=>e instanceof ConflictError);
 undoSignal(s,'s3');assert.equal(feature(s,'topic:science').counted,2);
 assert.equal(interest(s,'s3').outcome,'no-signal');assert.equal(item(s,'s3').interested,true);
 control(s,'on');assert.equal(feature(s,'topic:science').counted,2);
 interest(s,'s4');assert.equal(feature(s,'topic:science').counted,3);
 const settings=s.settings(),history=rows(s),old=item(s,'s2').learning.active;
 control(s,'reset');
 assert.equal(learning(s).epoch,1);assert.equal(learning(s).status,'on');assert.equal(feature(s,'topic:science').counted,0);
 assert.equal(rows(s),history+1);assert.deepEqual(s.settings(),settings);
 assert.equal(feature(s,'topic:chess').resolved,0);assert.equal(item(s,'chess').passed,true);assert.equal(item(s,'crafts').interested,true);assert.equal(item(s,'s1').interested,true);
 assert.equal(item(s,'s2').learning.active,null);assert.equal(item(s,'s2').learning.earlierActive[0].eventId,old.eventId);
 assert.throws(()=>s.learning.replace({commandKey:key('old-replace'),id:item(s,'s2').id,mode:'regroup',targetEntryId:old.eventId,grouping:{mode:'unknown'},expectedControlRevision:learning(s).revision}),(e:any)=>e instanceof ConflictError&&/earlier learning period/.test(e.message));
 countThree(s);assert.equal(feature(s,'topic:science').counted,3);
 undoSignal(s,'s2',old.eventId);
 assert.equal(feature(s,'topic:science').counted,3);assert.equal(item(s,'s2').learning.active.epoch,1);assert.equal(item(s,'s2').learning.earlierActive.length,0);
});
test('Unsave, Hide, passes and source review never reverse learning; Undo Interested never touches the bookmark; notices stay independent',()=>{
 const s=setup();control(s,'on');interest(s,'s1');const id=item(s,'s1').id;s.action(id,'surface');
 intake(s,calendar(LISTINGS.map(r=>r[0]==='s1'?['s1','Science evening one','Synthetic telescope talk.','17']:r)));
 const notice=()=>item(s,'s1').notices;
 assert.equal(notice().length,1);
 s.action(id,'hidden',true);pass(s,'s1',{reasons:['timing']});s.action(id,'interested',false);
 let x=item(s,'s1');
 assert.equal(x.interested,false);assert.equal(x.hidden,true);assert.equal(x.passed,true);assert.equal(x.learning.active.counting,true);assert.equal(notice().length,1);
 s.action(id,'interested',true);undoSignal(s,'s1');
 x=item(s,'s1');assert.equal(x.interested,true);assert.equal(x.learning.active,null);assert.equal(x.learning.history[0].status,'reversed');
 control(s,'reset');control(s,'pause');instruction(s,'topic:science','child','set',3);
 assert.equal(notice().length,1);assert.equal(notice()[0].ack_at,null);assert.equal(item(s,'s1').hidden,true);assert.equal(item(s,'s1').passed,true);
 const before=rows(s);
 s.action(id,'review',{version:item(s,'s1').version,changeIds:item(s,'s1').changes.map((c:any)=>c.change_id)});
 assert.equal(notice().length,0);assert.equal(rows(s),before);
});
test('commands are idempotent, strictly validated, guarded against stale windows and atomic with their bookmark or pass',()=>{
 const s=setup();
 const on={commandKey:'synthetic-on-key',action:'on',expectedControlRevision:null};
 const first=s.learning.control(on);assert.deepEqual(s.learning.control(on),first);assert.equal(rows(s),1);
 assert.throws(()=>s.learning.control({...on,action:'pause'}),/payload conflict/);
 assert.throws(()=>s.learning.control({...on,commandKey:key('stale'),action:'pause'}),(e:any)=>e instanceof ConflictError);
 const x=item(s,'s1'),base={id:x.id,shownVersion:1,grouping:{mode:'new'},expectedEntryId:null,expectedControlRevision:first.eventId};
 for(const bad of [{...base,note:'x'},{...base,subjectId:'child:second'},{...base,grouping:{mode:'auto'}},{...base,grouping:{mode:'same'}},{...base,shownVersion:0}])assert.throws(()=>s.learning.interest({...bad,commandKey:key('bad')}));
 assert.throws(()=>instruction(s,'topic:science','child','set',11),/whole number/);
 assert.throws(()=>instruction(s,'topic:organizer','child','set',1),/supported grounded/);
 assert.throws(()=>s.learning.instruction({commandKey:key('scope'),scope:'provider',featureId:'topic:science',action:'set',value:1,expectedInstructionId:null}),/child or household/);
 assert.equal(rows(s),1);
 const signal=s.learning.interest({...base,commandKey:'synthetic-interest-key'});
 assert.deepEqual(s.learning.interest({...base,commandKey:'synthetic-interest-key'}),signal);assert.equal(rows(s),2);
 assert.throws(()=>s.learning.interest({...base,commandKey:key('stale-entry')}),(e:any)=>e instanceof ConflictError);
 instruction(s,'topic:science','child','set',4);
 assert.throws(()=>s.learning.instruction({commandKey:key('stale-instruction'),scope:'child',featureId:'topic:science',action:'set',value:1,expectedInstructionId:null}),(e:any)=>e instanceof ConflictError);
 assert.throws(()=>s.db.exec("UPDATE learning_events SET kind='undo'"),/append-only/);
 assert.throws(()=>s.db.exec('DELETE FROM learning_events'),/append-only/);
 // Injected failure: bookmark+signal and pass+instruction each roll back together.
 s.db.exec("CREATE TRIGGER fail_learning BEFORE INSERT ON learning_events BEGIN SELECT RAISE(ABORT,'injected learning failure'); END;");
 const count=rows(s),decisions=s.db.prepare('SELECT count(*) n FROM decision_events').get()!.n;
 assert.throws(()=>interest(s,'s2'),/injected/);assert.equal(item(s,'s2').interested,false);
 assert.throws(()=>pass(s,'s2',generally('topic:science')),/injected/);
 assert.equal(item(s,'s2').passed,false);assert.equal(s.db.prepare('SELECT count(*) n FROM decision_events').get()!.n,decisions);assert.equal(rows(s),count);
 s.db.exec('DROP TRIGGER fail_learning');
 interest(s,'s2');assert.equal(item(s,'s2').interested,true);
});
test('LEARN-CODE-001: Clear of a Generally-pass instruction keeps its boundary through supersession and Undo of that pass',()=>{
 const s=setup();control(s,'on');countThree(s);
 pass(s,'mixed',generally('topic:science'));const i1=feature(s,'topic:science').child.eventId;
 instruction(s,'topic:science','child','clear');
 const clearRow=JSON.parse(String(s.db.prepare("SELECT data_json FROM learning_events WHERE kind='instruction' AND json_extract(data_json,'$.action')='clear'").get()!.data_json));
 assert.equal(clearRow.frozenCutoff,Number(s.db.prepare('SELECT seq FROM learning_events WHERE event_id=?').get(i1)!.seq));
 const state=()=>({counted:feature(s,'topic:science').counted,suppressed:feature(s,'topic:science').suppressed,learned:item(s,'s4').learnedScore,resolved:feature(s,'topic:science').resolved});
 const expected={counted:0,suppressed:3,learned:0,resolved:0};
 assert.deepEqual(state(),expected);
 pass(s,'mixed',{reasons:['timing']});assert.deepEqual(state(),expected);// Sol probe: previously counted 3 / lift 2
 undoPass(s,'mixed');assert.deepEqual(state(),expected);// I1 live again at its original sequence; the newer Clear still wins
 undoPass(s,'mixed');assert.deepEqual(state(),expected);
 interest(s,'s4');interest(s,'mixed');
 assert.equal(feature(s,'topic:science').counted,2);// only signals after the frozen boundary count
});
test('LEARN-CODE-002: a stale Generally pass cannot overwrite a newer instruction at its scope; old receipts still replay',()=>{
 const s=setup({science:5});
 const decisions=()=>Number(s.db.prepare('SELECT count(*) n FROM decision_events').get()!.n);
 // Window A reviews household science (no instruction) and prepares a Generally pass on s1.
 const a=item(s,'s1'),prepared={id:a.id,action:'pass',shownVersion:a.version,commandKey:'synthetic-stale-generally',expectedActiveDecisionId:null,...LOCAL_SCOPE,...generally('topic:science','household'),expectedInstructionId:null};
 // Window B independently sets household science to 6.
 instruction(s,'topic:science','household','set',6);const six=feature(s,'topic:science').household.eventId;
 const before={decisions:decisions(),learning:rows(s)};
 assert.throws(()=>s.decision(prepared),(e:any)=>e instanceof ConflictError&&/changed in another window/.test(e.message));
 assert.deepEqual({decisions:decisions(),learning:rows(s)},before);
 assert.equal(feature(s,'topic:science').resolved,6);assert.equal(item(s,'s1').passed,false);
 // Retrying the same stale command stays a 409; it is never turned into a new command silently.
 assert.throws(()=>s.decision(prepared),(e:any)=>e instanceof ConflictError);
 // After deliberately reviewing the current value, a new command applies.
 s.decision({...prepared,commandKey:'synthetic-reviewed-generally',expectedInstructionId:six});
 assert.equal(feature(s,'topic:science').resolved,0);assert.equal(item(s,'s1').decision.active.snapshot.learning.instruction.reviewedInstructionId,six);
 // Different-listing race: two windows both reviewed the current household science instruction.
 const reviewedNow=feature(s,'topic:science').household.eventId,b=item(s,'s2'),c=item(s,'s3');
 const forListing=(x:any,k:string)=>({id:x.id,action:'pass',shownVersion:x.version,commandKey:k,expectedActiveDecisionId:null,...LOCAL_SCOPE,...generally('topic:science','household'),expectedInstructionId:reviewedNow});
 s.decision(forListing(b,'synthetic-listing-b'));
 assert.throws(()=>s.decision(forListing(c,'synthetic-listing-c')),(e:any)=>e instanceof ConflictError);
 assert.equal(item(s,'s3').passed,false);
 // Validation: the current version requires the reviewed identity; it is not accepted on other commands.
 assert.throws(()=>s.decision({...forListing(c,key('missing')),expectedInstructionId:undefined}),/reviewed instruction/);
 assert.throws(()=>s.decision({...forListing(c,key('listing-only')),generalIntent:'listing'}),/learning-instruction version/);
 // A fresh command naming the earlier v1 contract asks for reload; a genuine v1 receipt (no reviewed identity) replays exactly.
 assert.throws(()=>s.decision({...forListing(c,key('v1')),instructionVersion:'learning-instruction-v1',expectedInstructionId:undefined}),(e:any)=>e instanceof ConflictError&&/predates/.test(e.message));
 const v1={id:c.id,action:'pass',shownVersion:1,householdId:LOCAL_SCOPE.householdId,subjectId:LOCAL_SCOPE.subjectId,actorId:LOCAL_SCOPE.actorId,reasons:['general'],dimensions:[],generalIntent:'generally',targetId:'topic:science',targetScope:'household',note:'',expectedActiveDecisionId:null,targetDecisionId:null,instructionVersion:'learning-instruction-v1'};
 const result={decisionId:'round1-v1-pass',action:'pass',shownVersion:1,currentVersion:1,staleAtSubmit:false,createdAt:captured,instructionId:'round1-v1-instruction'};
 const snapshot=JSON.parse(String(s.db.prepare('SELECT snapshot_json FROM decision_events WHERE opportunity_id=? LIMIT 1').get(b.id)!.snapshot_json));
 s.db.prepare('INSERT INTO decision_events(decision_id,command_key,payload_hash,opportunity_id,household_id,subject_id,actor_id,action,shown_version,payload_json,snapshot_json,supersedes_id,reverses_id,target_decision_id,result_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
  .run('round1-v1-pass','round1-v1-key',hash(JSON.stringify(v1)),c.id,LOCAL_SCOPE.householdId,LOCAL_SCOPE.subjectId,LOCAL_SCOPE.actorId,'pass',1,JSON.stringify(v1),JSON.stringify(snapshot),null,null,null,JSON.stringify(result),captured);
 const {id,action,shownVersion,reasons,generalIntent,targetId,targetScope,instructionVersion}=v1;
 assert.deepEqual(s.decision({id,action,shownVersion,reasons,generalIntent,targetId,targetScope,instructionVersion,expectedActiveDecisionId:null,commandKey:'round1-v1-key',...LOCAL_SCOPE}),result);
});
