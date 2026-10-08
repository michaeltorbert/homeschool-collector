import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {defaults,parseCalendar,relevance,type Opportunity,type Settings} from '../src/domain.ts';
import {groundedFeatures} from '../src/decisions.ts';
import {ATTRIBUTION_REVISION,EXTRACTION_REVISION,FEATURES,allocate,projectLearning,featureStats,resolveInstructions,explicitRelevance,learnedScore,compareRanked,reviewedInstruction,reviewChanged,type LearningRow} from '../src/learning.ts';
// SYNTHETIC: pure contract cases. Rows are built directly so every allocation/order rule is checked without storage.
const fixture=(part:string)=>readFileSync(new URL(`../fixtures/${part}.ics`,import.meta.url),'utf8');
const event=(title:string,description='',id=title):Opportunity=>({id,uid:id,title,description,location:'Arts Center',start:{kind:'known',local:'2080-06-05T11:00:00',instant:'2080-06-05T15:00:00.000Z',zone:'America/New_York'},end:{kind:'unknown',local:null,instant:null,zone:null},status:'confirmed',detailUrl:null,closure:false,recurring:false,timeWarnings:[],sourceStampWarnings:[]});
const settingsWith=(weights:Record<string,number>={}):Settings=>({...defaults,weights:{...defaults.weights,...weights}});
let seq=0;
function row(kind:LearningRow['kind'],data:any,extra:{opportunityId?:string;epoch?:number;attribution?:any;origin?:string;target?:string}={}):LearningRow{
 seq++;return {seq,eventId:`e${seq}`,kind,opportunityId:extra.opportunityId??null,epoch:extra.epoch??0,data,attributionJson:extra.attribution?JSON.stringify(extra.attribution):null,originDecisionId:extra.origin??null,targetEventId:extra.target??null,createdAt:'2080-01-01T00:00:00Z'};
}
const attribution=(ids:string[])=>({revision:ATTRIBUTION_REVISION,allocation:allocate(ids),shown:{title:'Synthetic'}});
const on=()=>row('control',{action:'on'});
const signal=(item:string,ids:string[],groupId:string,{counting=true,certainty='confirmed',outcome='counted',epoch=0}:{counting?:boolean;certainty?:string;outcome?:string;epoch?:number}={})=>row('interest',{outcome,counting,groupId,certainty},{opportunityId:item,attribution:attribution(ids),epoch});
const set=(featureId:string,value:number,scope='child',origin?:string)=>row('instruction',{scope,featureId,action:'set',value},{origin});
const clear=(featureId:string,scope='child')=>row('instruction',{scope,featureId,action:'clear',value:null});
const stats=(rows:LearningRow[],settings=settingsWith(),active:Set<string>=new Set())=>featureStats(projectLearning(rows,active),settings);
const science=(rows:LearningRow[],settings?:Settings,active?:Set<string>)=>stats(rows,settings,active).get('topic:science')!;

test('allocation splits exactly 1000 milli-units over unique sorted features with a deterministic remainder',()=>{
 assert.deepEqual(allocate(['topic:science','format:workshop','topic:crafts']),[{featureId:'format:workshop',milli:334},{featureId:'topic:crafts',milli:333},{featureId:'topic:science',milli:333}]);
 assert.deepEqual(allocate(['topic:art','topic:art']),[{featureId:'topic:art',milli:1000}]);
 assert.deepEqual(allocate([]),[]);
 const seven=allocate(FEATURES.slice(0,7).map(f=>f.id).reverse());
 assert.equal(seven.reduce((n,a)=>n+a.milli,0),1000);
 assert.deepEqual(seven.map(a=>a.milli),[143,143,143,143,143,143,142]);
 assert.deepEqual(seven.map(a=>a.featureId),[...seven.map(a=>a.featureId)].sort());
});
test('the registry covers exactly the grounded features the extractor can produce, at the same revision',()=>{
 const all=event('Sailing chess science outdoor painting crafts hands-on concert performance workshop exhibition');
 const grounded=groundedFeatures(all);
 assert.deepEqual(grounded.map(f=>f.id).sort(),FEATURES.map(f=>f.id).sort());
 assert.ok(grounded.every(f=>f.revision===EXTRACTION_REVISION));
});
test('without overlays explicit relevance is exactly the existing baseline on real public fixtures and synthetic text',()=>{
 const events=[...parseCalendar(fixture('prcr')).events,...parseCalendar(fixture('arts')).events,event('Science hands-on learning craft workshop'),event('Clay sculpture','A maker workshop of painting')];
 for(const weights of [{},{science:3,art:9,craft:5,education:6,'hands-on':4},{sailing:10,chess:1,outdoors:7}] as Record<string,number>[]){
  const settings=settingsWith(weights);
  for(const e of events){
   const baseline=relevance(e,settings),current=explicitRelevance(e,settings,()=>null,groundedFeatures(e));
   assert.equal(current.score,baseline.score,e.title);
   assert.deepEqual(current.reasons.map(r=>({key:r.key,weight:r.weight,evidence:r.evidence})),baseline.reasons);
  }
 }
});
test('a mapped overlay replaces its Settings value, matches baseline word OR grounded feature once, and never touches another topic',()=>{
 const settings=settingsWith({art:9,science:5,craft:3});
 const sculpture=event('Clay sculpture'),overlay=(map:Record<string,number>)=>(id:string)=>id in map?{value:map[id],scope:'child' as const,instructionId:'i',originDecisionId:null}:null;
 // Baseline art words do not include "sculpture": no art term until a deliberate art overlay exists.
 assert.equal(explicitRelevance(sculpture,settings,()=>null,groundedFeatures(sculpture)).score,0);
 const withArt=explicitRelevance(sculpture,settings,overlay({'topic:art':7}),groundedFeatures(sculpture));
 assert.equal(withArt.score,7);assert.equal(withArt.reasons[0].matchedBy,'grounded feature');
 const painting=event('Painting night');
 const once=explicitRelevance(painting,settings,overlay({'topic:art':4}),groundedFeatures(painting));
 assert.equal(once.score,4);assert.equal(once.reasons.length,1);assert.equal(once.reasons[0].matchedBy,'baseline word and grounded feature');
 // topicA instruction leaves topicB unchanged.
 const mixed=event('Science and crafts');
 assert.equal(explicitRelevance(mixed,settings,()=>null,groundedFeatures(mixed)).score,8);
 const zeroScience=explicitRelevance(mixed,settings,overlay({'topic:science':0}),groundedFeatures(mixed));
 assert.equal(zeroScience.score,3);assert.equal(zeroScience.reasons.find(r=>r.key==='craft')!.weight,3);
});
test('format overlays add their own term; workshop shares the generic cap of 8 with education/hands-on/craft',()=>{
 const settings=settingsWith({science:2,education:6});
 const overlay=(map:Record<string,number>)=>(id:string)=>id in map?{value:map[id],scope:'household' as const,instructionId:'i',originDecisionId:null}:null;
 const workshop=event('Science workshop to learn');
 assert.equal(explicitRelevance(workshop,settings,()=>null,groundedFeatures(workshop)).score,8);
 const capped=explicitRelevance(workshop,settings,overlay({'format:workshop':5}),groundedFeatures(workshop));
 assert.equal(capped.genericUncapped,11);assert.equal(capped.score,2+8);
 const concert=event('Evening concert');
 assert.equal(explicitRelevance(concert,settings,overlay({'format:concert':3}),groundedFeatures(concert)).score,3);
 assert.equal(explicitRelevance(concert,settings,overlay({'format:workshop':9}),groundedFeatures(concert)).score,0);
});
test('weak evidence needs three distinct confirmed groups; uncertain and duplicate records never count; averages do not inflate',()=>{
 const two=[on(),signal('a',['topic:science'],'g1'),signal('b',['topic:science'],'g2')];
 assert.equal(science(two).status,'insufficient');assert.equal(science(two).applied,0);
 const three=[...two,signal('c',['topic:science'],'g3')];
 assert.equal(science(three).counted,3);assert.equal(science(three).applied,2);
 // Two uncertain/duplicate records alongside two counted groups are still insufficient.
 const uncertain=[...two,signal('c',['topic:science'],'u1',{counting:false,certainty:'unknown',outcome:'provisional'}),signal('d',['topic:science'],'g1',{counting:false,outcome:'duplicate-group'})];
 assert.equal(science(uncertain).counted,2);assert.equal(science(uncertain).uncounted,2);assert.equal(science(uncertain).applied,0);
 const halves=(n:number)=>[on(),...Array.from({length:n},(_,i)=>signal(`h${i}`,['topic:crafts','topic:science'],`hg${i}`))];
 assert.equal(science(halves(3)).applied,1);assert.equal(science(halves(9)).applied,1);
 // Other features of a multi-topic signal get their own share; nothing is transferred.
 assert.equal(stats(halves(3)).get('topic:crafts')!.applied,1);assert.equal(stats(halves(3)).get('topic:chess')!.applied,0);
});
test('lift is clamped by the 10 ceiling, applied only while on, and limited to the current reset epoch',()=>{
 const rows=[on(),signal('a',['topic:science'],'g1'),signal('b',['topic:science'],'g2'),signal('c',['topic:science'],'g3')];
 const high=science(rows,settingsWith({science:9}));assert.equal(high.lift,1);assert.equal(high.status,'ceiling');
 assert.equal(science(rows,settingsWith({science:10})).lift,0);
 assert.equal(science([...rows,row('control',{action:'pause'})]).applied,0);
 assert.equal(science([...rows,row('control',{action:'pause'})]).lift,2);
 const reset=[...rows,row('control',{action:'reset'},{epoch:1})];
 assert.equal(science(reset).counted,0);
 assert.equal(science([...reset,signal('a',['topic:science'],'n1',{epoch:1}),signal('b',['topic:science'],'n2',{epoch:1}),signal('c',['topic:science'],'n3',{epoch:1})]).applied,2);
});
test('explicit layers: child over household over Settings, and an active instruction blocks learned lift for that feature only',()=>{
 const signals=[on(),signal('a',['topic:science','topic:crafts'],'g1'),signal('b',['topic:science','topic:crafts'],'g2'),signal('c',['topic:science','topic:crafts'],'g3')];
 const settings=settingsWith({science:4});
 const before=stats(signals,settings);
 const household=[...signals,set('topic:science',6,'household')];
 assert.equal(science(household,settings).resolved,6);assert.equal(science(household,settings).applied,0);
 assert.deepEqual(stats(household,settings).get('topic:crafts'),before.get('topic:crafts'));
 const child=[...household,set('topic:science',3,'child')];
 assert.equal(science(child,settings).resolved,3);assert.equal(science(child,settings).resolvedSource,'Child instruction');
 assert.equal(science([...child,clear('topic:science','child')],settings).resolved,6);
 assert.equal(science([...child,clear('topic:science','child'),clear('topic:science','household')],settings).resolved,4);
});
test('manual Clear keeps the suppression cutoff; exact pass retraction removes it; later signals count normally',()=>{
 const base=[on(),signal('a',['topic:science'],'g1'),signal('b',['topic:science'],'g2'),signal('c',['topic:science'],'g3')];
 const cleared=[...base,set('topic:science',5),clear('topic:science')];
 assert.equal(science(cleared).overlay,null);assert.equal(science(cleared).counted,0);assert.equal(science(cleared).suppressed,3);assert.equal(science(cleared).applied,0);
 const later=[...cleared,signal('d',['topic:science'],'g4'),signal('e',['topic:science'],'g5'),signal('f',['topic:science'],'g6')];
 assert.equal(science(later).counted,3);assert.equal(science(later).applied,2);
 const passLinked=[...base,set('topic:science',0,'child','P1')];
 assert.equal(science(passLinked,undefined,new Set(['P1'])).status,'explicit');
 // Retracted (pass superseded or undone): no overlay and no cutoff, so the earlier evidence is restored.
 const retracted=science(passLinked,undefined,new Set());
 assert.equal(retracted.overlay,null);assert.equal(retracted.counted,3);assert.equal(retracted.applied,2);
});
test('restored pass instruction keeps its ORIGINAL sequence: a newer independent instruction Q still wins (P1/Q/P2 example)',()=>{
 const rows=[on(),set('topic:science',0,'child','P1'),set('topic:science',6,'child')];
 const overlay=(active:string[])=>resolveInstructions(projectLearning(rows,new Set(active)).instructions).overlay('topic:science');
 assert.equal(overlay(['P1'])!.value,6);// Q is newer than I1
 assert.equal(overlay(['P2'])!.value,6);// P2 superseded P1: I1 retracted, Q unaffected
 assert.equal(overlay([])!.value,6);// Undo P1 never clears Q
 const withoutQ=[on(),set('topic:science',0,'child','P1')];
 assert.equal(resolveInstructions(projectLearning(withoutQ,new Set(['P1'])).instructions).overlay('topic:science')!.value,0);
 assert.equal(resolveInstructions(projectLearning(withoutQ,new Set(['P2'])).instructions).overlay('topic:science'),null);
});
test('ranking: explicit score first, learned lift only within equal explicit scores, then start and stable ID',()=>{
 const at=(local:string|null)=>({local});
 const high={id:'h',score:1,learnedScore:0,start:at('2080-06-09T10:00:00')},liftedLow={id:'l',score:0,learnedScore:2,start:at('2080-06-01T10:00:00')};
 // Counterexample for effective-score-first ordering: 0+2 > 1, yet the higher explicit priority stays first.
 assert.ok(liftedLow.score+liftedLow.learnedScore>high.score+high.learnedScore);
 assert.deepEqual([liftedLow,high].sort(compareRanked).map(x=>x.id),['h','l']);
 const tieEarly={id:'a',score:0,learnedScore:0,start:at('2080-06-01T09:00:00')},tieLifted={id:'b',score:0,learnedScore:0.5,start:at('2080-06-07T09:00:00')};
 assert.deepEqual([tieEarly,tieLifted].sort(compareRanked).map(x=>x.id),['b','a']);
 const sameStart=[{id:'z',score:0,learnedScore:0,start:at(null)},{id:'y',score:0,learnedScore:0,start:at(null)}];
 assert.deepEqual(sameStart.sort(compareRanked).map(x=>x.id),['y','z']);
});
test('learned tie score uses actual grounded features only and the generic residual under the shared cap',()=>{
 const s=stats([on(),...['a','b','c'].map((x,i)=>signal(x,['topic:crafts'],`c${i}`)),...['d','e','f'].map((x,i)=>signal(x,['topic:hands-on'],`h${i}`)),...['g','h','i'].map((x,i)=>signal(x,['topic:science'],`s${i}`))]);
 const crafty=event('Hands-on crafts and science');
 const full=learnedScore(groundedFeatures(crafty),s,0);
 assert.equal(full.score,6);
 const capped=learnedScore(groundedFeatures(crafty),s,7);
 assert.equal(capped.score,2+1);assert.equal(capped.genericCapped,true);
 assert.equal(learnedScore(groundedFeatures(event('Chess club')),s,0).score,0);
});
test('replay freezes counting: a blocked Undo restoration stays non-counting even after the occupant disappears; unknown shapes never count',()=>{
 const c1=signal('itemA',['topic:science'],'G');
 const r=row('replace',{mode:'regroup',outcome:'counted',counting:true,groupId:'H',certainty:'confirmed',evidenceSeq:c1.seq},{opportunityId:'itemA',attribution:attribution(['topic:science']),target:c1.eventId});
 const c2=signal('itemB',['topic:science'],'G');
 const undoR=row('undo',{restoration:{eventId:c1.eventId,counting:false,outcome:'duplicate-group-restoration',linkedEventId:c2.eventId}},{opportunityId:'itemA',target:r.eventId});
 const undoC2=row('undo',{restoration:null},{opportunityId:'itemB',target:c2.eventId});
 const p=projectLearning([on(),c1,r,c2,undoR,undoC2],new Set());
 const original=p.entries.get(c1.eventId)!;
 assert.equal(original.status,'active');assert.equal(original.counting,false);assert.equal(original.outcome,'duplicate-group-restoration');
 assert.equal(p.entries.get(r.eventId)!.status,'reversed');assert.equal(p.entries.get(c2.eventId)!.status,'reversed');
 const future=row('interest',{outcome:'counted',counting:true,groupId:'F',certainty:'confirmed'},{opportunityId:'x',attribution:{revision:'future-v9',allocation:[{featureId:'topic:science',milli:1000}]}});
 const q=projectLearning([on(),future],new Set());
 assert.equal(q.entries.get(future.eventId)!.counting,false);assert.equal(q.entries.get(future.eventId)!.outcome,'unrecognized');
});
test('LEARN-CODE-001: a manual Clear freezes the boundary it ended; later retraction of the originating pass cannot revive suppressed evidence',()=>{
 const signals=[on(),signal('a',['topic:science'],'g1'),signal('b',['topic:science'],'g2'),signal('c',['topic:science'],'g3')];
 const i1=set('topic:science',0,'child','P1');
 const between=signal('d',['topic:science'],'g4');// recorded while I1 was active: after its cutoff, so the Clear does not set it aside
 const cleared=row('instruction',{scope:'child',featureId:'topic:science',action:'clear',value:null,frozenCutoff:i1.seq});
 const rows=[...signals,i1,between,cleared];
 for(const active of [new Set(['P1']),new Set<string>(),new Set(['P2'])]){
  const s=science(rows,undefined,active);
  assert.equal(s.overlay,null);assert.equal(s.suppressed,3,[...active].join());assert.equal(s.counted,1);assert.equal(s.applied,0);
 }
 // Without a Clear, retraction still removes the boundary (exact pass lifecycle unchanged).
 assert.equal(science([...signals,i1,between],undefined,new Set()).counted,4);
 // Once P1 is live again its instruction keeps its original sequence, so the later Clear still wins.
 assert.equal(resolveInstructions(projectLearning(rows,new Set(['P1'])).instructions).overlay('topic:science'),null);
 const later=[...rows,signal('e',['topic:science'],'g5'),signal('f',['topic:science'],'g6')];
 assert.equal(science(later,undefined,new Set()).counted,3);assert.equal(science(later,undefined,new Set()).applied,2);
 // A Clear row written before the frozen field existed falls back conservatively to every earlier set at its own scope,
 // live or not, so it never revives evidence; a set at the other scope does not widen it.
 const legacy=row('instruction',{scope:'child',featureId:'topic:science',action:'clear',value:null});
 const legacyRows=[...signals,i1,between,legacy];
 assert.equal(science(legacyRows,undefined,new Set()).suppressed,3);assert.equal(science(legacyRows,undefined,new Set()).counted,1);
 const otherScope=[...signals,set('topic:science',4,'household','P9'),signal('h',['topic:science'],'g9'),row('instruction',{scope:'child',featureId:'topic:science',action:'clear',value:null})];
 assert.equal(science(otherScope,undefined,new Set()).suppressed,0);
});
test('LEARN-CODE-003: a pinned instruction draft is never rebased by a newer polled snapshot',()=>{
 const before=[{id:'topic:science',child:null,household:{eventId:'h1',action:'set',value:6}}];
 const pinned=reviewedInstruction(before,'topic:science','household');
 assert.deepEqual(pinned,{featureId:'topic:science',scope:'household',instructionId:'h1',shown:{action:'set',value:6}});
 assert.equal(reviewChanged(before,pinned),false);
 const polled=[{id:'topic:science',child:null,household:{eventId:'h2',action:'set',value:5}}];
 assert.equal(reviewChanged(polled,pinned),true);assert.equal(pinned.instructionId,'h1');
 assert.equal(reviewChanged([{id:'topic:science',child:null,household:null}],reviewedInstruction(before,'topic:science','child')),false);
 assert.equal(reviewChanged([{id:'topic:science',child:{eventId:'c1',action:'set',value:0},household:null}],reviewedInstruction(before,'topic:science','child')),true);
});
