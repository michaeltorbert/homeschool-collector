// Bounded, reversible interest learning (issue #5). Pure: feature registry, allocation, append-only replay, explicit
// instruction resolution, bounded weak tie scores and the ranking comparator. No I/O, no model, no private notes.
import {keywords,type Opportunity,type Settings} from './domain';
import type {GroundedFeature} from './decisions';
export const LEARNING_ALGORITHM_REVISION='bounded-learning-v1';
export const ATTRIBUTION_REVISION='interest-attribution-v1';
// New Generally passes must name this contract and the exact instruction they reviewed; an older tab is asked to reload.
// v1 (no reviewed-instruction binding) is accepted only for exact receipt replay.
export const INSTRUCTION_VERSION='learning-instruction-v2';
export const REPLAY_ONLY_INSTRUCTION_VERSIONS=['learning-instruction-v1'];
export const EXTRACTION_REVISION='grounded-words-v1';
export const DISTINCT_THRESHOLD=3,MAX_LIFT=2,GENERIC_CAP=8,ALLOCATION_TOTAL=1000,MIN_WEIGHT=0,MAX_WEIGHT=10;
// Generic bonuses share one cap of 8 for explicit terms and for the combined weak residual.
export const GENERIC_TERMS=['education','hands-on','craft','format:workshop'];
export interface FeatureSpec {id:string;label:string;kind:'topic'|'format';settingsKey:string|null}
// Canonical grounded IDs (src/decisions.ts groundedFeatures) and the Settings key each one maps to. Formats have no
// Settings key: their explicit baseline is zero, outside Settings. Education has no grounded feature and is Settings-only.
export const FEATURES:FeatureSpec[]=[
 {id:'format:concert',label:'Concert format',kind:'format',settingsKey:null},
 {id:'format:exhibition',label:'Exhibition format',kind:'format',settingsKey:null},
 {id:'format:performance',label:'Performance format',kind:'format',settingsKey:null},
 {id:'format:workshop',label:'Workshop format',kind:'format',settingsKey:null},
 {id:'topic:art',label:'Art',kind:'topic',settingsKey:'art'},
 {id:'topic:chess',label:'Chess',kind:'topic',settingsKey:'chess'},
 {id:'topic:crafts',label:'Crafts',kind:'topic',settingsKey:'craft'},
 {id:'topic:hands-on',label:'Hands-on',kind:'topic',settingsKey:'hands-on'},
 {id:'topic:outdoors',label:'Outdoors',kind:'topic',settingsKey:'outdoors'},
 {id:'topic:sailing',label:'Sailing',kind:'topic',settingsKey:'sailing'},
 {id:'topic:science',label:'Science',kind:'topic',settingsKey:'science'},
];
export const FEATURE_BY_ID=new Map(FEATURES.map(f=>[f.id,f]));
const FEATURE_BY_KEY=new Map(FEATURES.filter(f=>f.settingsKey).map(f=>[f.settingsKey!,f]));
export const termKey=(f:FeatureSpec)=>f.settingsKey??f.id;
export const isGeneric=(f:FeatureSpec)=>GENERIC_TERMS.includes(termKey(f));
const byText=(a:string,b:string)=>a<b?-1:a>b?1:0;
export const RULES=[
 'Explicit priorities come first: Settings weights, then a household instruction, then a child instruction for the same topic or format.',
 'Learning only adds a nonnegative tie-break lift of at most 2 per topic or format. It orders listings only when their explicit scores are equal and never moves a listing above one with a higher explicit score.',
 'Each counted Interested signal splits a fixed 1000 milli-units across the listing’s grounded topics and formats, sorted by ID; leftover units go to the first IDs.',
 `A topic or format gets no lift until ${DISTINCT_THRESHOLD} distinct confirmed opportunities include it. Then lift = 2 × the average share, at most 2 and never above 10. More signals do not inflate an average.`,
 'Another date, version or retry of the same listing or program counts once. Listings you have not confirmed as distinct are recorded but not counted.',
 'An explicit instruction (yours or a Generally pass) replaces learned lift for that topic or format. Learning recorded before an instruction stays set aside after you clear it; undoing the instruction’s pass restores it.',
 'Workshop format shares the combined cap of 8 with education, hands-on and craft. There is no time decay, no penalty for skipped listings and no enjoyment percentage.',
];
// Distribute exactly 1000 integer milli-units across unique feature IDs in sorted order; the remainder goes to the first IDs.
export function allocate(featureIds:string[]){
 const unique=[...new Set(featureIds)].sort(byText);if(!unique.length)return [];
 const base=Math.floor(ALLOCATION_TOTAL/unique.length),remainder=ALLOCATION_TOTAL-base*unique.length;
 return unique.map((featureId,i)=>({featureId,milli:base+(i<remainder?1:0)}));
}
export const allocationEffect=(featureId:string)=>{const f=FEATURE_BY_ID.get(featureId);return !f?'No effect: not a supported feature in this revision.':f.settingsKey?`Lift for Settings key “${f.settingsKey}”.`:'Lift for a format (explicit baseline 0).';};
// Unknown historical shapes fail conservatively: retained and shown, never counted.
export function recognizedAttribution(a:any){
 if(!a||a.revision!==ATTRIBUTION_REVISION||!Array.isArray(a.allocation))return false;
 if(!a.allocation.every((x:any)=>typeof x?.featureId==='string'&&Number.isInteger(x.milli)&&x.milli>=0))return false;
 const sum=a.allocation.reduce((n:number,x:any)=>n+x.milli,0);
 return a.allocation.length===0||sum===ALLOCATION_TOTAL;
}
export type Scope='child'|'household';
export interface LearningRow {seq:number;eventId:string;kind:'control'|'instruction'|'interest'|'replace'|'undo';opportunityId:string|null;epoch:number;data:any;attributionJson:string|null;originDecisionId:string|null;targetEventId:string|null;createdAt:string}
export interface Instruction {seq:number;eventId:string;scope:Scope;featureId:string;action:'set'|'clear';value:number|null;originDecisionId:string|null;provenance:any;createdAt:string;live:boolean;frozenCutoff:number|null}
export interface Entry {eventId:string;seq:number;evidenceSeq:number;kind:'interest'|'replace';mode:string|null;opportunityId:string;epoch:number;groupId:string|null;certainty:'confirmed'|'unknown'|null;counting:boolean;outcome:string;linkedEventId:string|null;attribution:any;attributionJson:string|null;recognized:boolean;status:'active'|'reversed'|'replaced'|'record';attributionFrom:string|null;replacesId:string|null;replacedBy:string|null;reversedBy:string|null;restoredBy:string|null;shownVersion:number|null;staleAtSubmit:boolean;createdAt:string}
export const OUTCOME_LABELS:Record<string,string>={
 counted:'Counted: confirmed distinct opportunity',
 provisional:'Recorded, not counted: not yet confirmed as a distinct opportunity',
 'duplicate-group':'Recorded, not counted: that program/group already has a counted signal',
 'duplicate-group-restoration':'Restored by Undo but not counted: another listing now holds that program/group',
 'duplicate-item':'Recorded, not counted: this listing already has a signal in this learning period',
 'no-signal':'Bookmark saved; learning was off or paused, so no signal was created',
 unrecognized:'Retained, not counted: unrecognized earlier attribution shape',
};
// Deterministic replay of the append-only learning log. Counting is frozen when written (and at Undo restoration), so a
// non-counting record never becomes counted because another signal later disappears.
export function projectLearning(rows:LearningRow[],activePassIds:ReadonlySet<string>){
 const control={status:'off' as 'off'|'on'|'paused',epoch:0,revision:null as string|null,history:[] as {eventId:string;action:string;epoch:number;createdAt:string}[]};
 const instructions:Instruction[]=[],entries=new Map<string,Entry>();
 for(const r of [...rows].sort((a,b)=>a.seq-b.seq)){
  if(r.kind==='control'){
   control.revision=r.eventId;
   if(r.data.action==='on')control.status='on';else if(r.data.action==='pause')control.status='paused';else if(r.data.action==='reset')control.epoch=r.epoch;
   control.history.push({eventId:r.eventId,action:r.data.action,epoch:r.epoch,createdAt:r.createdAt});
  }else if(r.kind==='instruction'){
   instructions.push({seq:r.seq,eventId:r.eventId,scope:r.data.scope,featureId:r.data.featureId,action:r.data.action,value:r.data.value??null,originDecisionId:r.originDecisionId,provenance:r.data.provenance??null,createdAt:r.createdAt,live:!r.originDecisionId||activePassIds.has(r.originDecisionId),frozenCutoff:r.data.action==='clear'&&Number.isInteger(r.data.frozenCutoff)?r.data.frozenCutoff:null});
  }else if(r.kind==='interest'||r.kind==='replace'){
   const attribution=r.attributionJson?JSON.parse(r.attributionJson):null,record=['no-signal','duplicate-item'].includes(r.data.outcome);
   const recognized=record?false:recognizedAttribution(attribution);
   const target=r.kind==='replace'?entries.get(r.targetEventId!):undefined;
   if(target){target.status='replaced';target.replacedBy=r.eventId;}
   entries.set(r.eventId,{eventId:r.eventId,seq:r.seq,evidenceSeq:Number(r.data.evidenceSeq??r.seq),kind:r.kind,mode:r.data.mode??null,opportunityId:String(r.opportunityId),epoch:r.epoch,groupId:r.data.groupId??null,certainty:r.data.certainty??null,counting:Boolean(r.data.counting)&&recognized,outcome:record||recognized?r.data.outcome:'unrecognized',linkedEventId:r.data.linkedEventId??null,attribution,attributionJson:r.attributionJson,recognized,status:record?'record':'active',attributionFrom:r.data.attributionFrom??null,replacesId:r.kind==='replace'?r.targetEventId:null,replacedBy:null,reversedBy:null,restoredBy:null,shownVersion:r.data.shownVersion??null,staleAtSubmit:Boolean(r.data.staleAtSubmit),createdAt:r.createdAt});
  }else if(r.kind==='undo'){
   const target=entries.get(r.targetEventId!);if(!target)continue;
   target.status='reversed';target.reversedBy=r.eventId;
   const restoration=r.data.restoration,original=target.replacesId?entries.get(target.replacesId):undefined;
   if(original&&restoration){original.status='active';original.replacedBy=null;original.restoredBy=r.eventId;original.counting=Boolean(restoration.counting)&&original.recognized;original.outcome=original.recognized?restoration.outcome:'unrecognized';original.linkedEventId=restoration.linkedEventId??null;}
  }
 }
 return {control,instructions,entries};
}
export type Projection=ReturnType<typeof projectLearning>;
export const activeEntryFor=(p:Projection,opportunityId:string,epoch:number)=>[...p.entries.values()].find(e=>e.opportunityId===opportunityId&&e.epoch===epoch&&e.status==='active')??null;
export const groupOccupant=(p:Projection,groupId:string,epoch:number,except?:string)=>[...p.entries.values()].find(e=>e.groupId===groupId&&e.epoch===epoch&&e.status==='active'&&e.counting&&e.eventId!==except)??null;
export const knownGroup=(p:Projection,groupId:string,epoch:number)=>[...p.entries.values()].some(e=>e.groupId===groupId&&e.epoch===epoch&&e.certainty==='confirmed'&&e.status!=='record');
// Explicit layers: the latest live instruction per scope/feature wins. A pass-linked instruction is live only while its
// exact pass is active, so supersession retracts it and Undo restores it at its ORIGINAL sequence (a newer instruction
// still wins). Manual Clear is an inherit instruction: it ends the overlay and FREEZES the suppression cutoff it ended, so
// later retraction or Undo of the originating pass cannot revive evidence the Clear set aside. Clear rows written before
// the frozen field existed fall back conservatively to every earlier set at that scope/feature.
export function resolveInstructions(instructions:Instruction[]){
 const layers={child:new Map<string,Instruction>(),household:new Map<string,Instruction>()},cutoff=new Map<string,number>();
 const sorted=[...instructions].sort((a,b)=>a.seq-b.seq),raise=(featureId:string,seq:number)=>cutoff.set(featureId,Math.max(cutoff.get(featureId)??0,seq));
 for(const i of sorted){
  if(i.action==='clear')raise(i.featureId,i.frozenCutoff??Math.max(0,...sorted.filter(s=>s.action==='set'&&s.scope===i.scope&&s.featureId===i.featureId&&s.seq<i.seq).map(s=>s.seq)));
  if(!i.live)continue;
  layers[i.scope].set(i.featureId,i);
  if(i.action==='set')raise(i.featureId,i.seq);
 }
 const overlay=(featureId:string)=>{
  for(const scope of ['child','household'] as const){const i=layers[scope].get(featureId);if(i?.action==='set')return {value:Number(i.value),scope,instructionId:i.eventId,originDecisionId:i.originDecisionId};}
  return null;
 };
 return {layers,cutoff,overlay};
}
// Instruction drafts (Preferences editor, Generally reason form) pin the instruction they were started or deliberately
// refreshed against. Polled snapshots never rebase the pin; a difference must be reviewed before submitting.
export interface ReviewedInstruction {featureId:string;scope:Scope;instructionId:string|null;shown:{action:string;value:number|null}|null}
export function reviewedInstruction(features:any[],featureId:string,scope:Scope):ReviewedInstruction{
 const i=features.find(f=>f.id===featureId)?.[scope]??null;
 return {featureId,scope,instructionId:i?.eventId??null,shown:i?{action:i.action,value:i.value??null}:null};
}
export const reviewChanged=(features:any[],reviewed:ReviewedInstruction)=>(features.find(f=>f.id===reviewed.featureId)?.[reviewed.scope]?.eventId??null)!==reviewed.instructionId;
export type Overlay=NonNullable<ReturnType<ReturnType<typeof resolveInstructions>['overlay']>>;
export interface FeatureStat {id:string;label:string;kind:'topic'|'format';settingsKey:string|null;generic:boolean;baseline:number;household:Instruction|null;child:Instruction|null;overlay:Overlay|null;resolved:number;resolvedSource:string;counted:number;suppressed:number;uncounted:number;meanShare:number;rawLift:number;lift:number;applied:number;status:string;explanation:string}
// Per-feature weak evidence from unique active, counted, unsuppressed confirmed groups in the current reset epoch.
export function featureStats(p:Projection,settings:Settings){
 const {layers,cutoff,overlay}=resolveInstructions(p.instructions),epoch=p.control.epoch,on=p.control.status==='on';
 const current=[...p.entries.values()].filter(e=>e.epoch===epoch&&e.status==='active');
 return new Map(FEATURES.map(f=>{
  const baseline=f.settingsKey?Number(settings.weights[f.settingsKey]??0):0,o=overlay(f.id),resolved=o?o.value:baseline;
  const share=(e:Entry)=>e.recognized?Number(e.attribution.allocation.find((a:any)=>a.featureId===f.id)?.milli??0):0;
  const withFeature=current.filter(e=>share(e)>0),limit=cutoff.get(f.id)??0;
  const counted=withFeature.filter(e=>e.counting&&e.evidenceSeq>limit),suppressed=withFeature.filter(e=>e.counting&&e.evidenceSeq<=limit).length,uncounted=withFeature.filter(e=>!e.counting).length;
  const sum=counted.reduce((n,e)=>n+share(e),0),meanShare=counted.length?sum/(counted.length*ALLOCATION_TOTAL):0;
  const rawLift=counted.length>=DISTINCT_THRESHOLD?Math.min(MAX_LIFT,MAX_LIFT*meanShare):0;
  const lift=o?0:Math.max(0,Math.min(rawLift,MAX_WEIGHT-resolved));
  const status=o?'explicit':counted.length<DISTINCT_THRESHOLD?'insufficient':lift<rawLift?'ceiling':'lift';
  const source=o?`${o.scope==='child'?'Child':'Household'} instruction${o.originDecisionId?' (from a Generally pass)':''}`:f.settingsKey?'Settings':'Format baseline';
  const explanation=o?`${source} sets ${resolved}. Learned lift is not applied while an instruction is active.`
   :counted.length<DISTINCT_THRESHOLD?`Insufficient evidence: ${counted.length} of ${DISTINCT_THRESHOLD} distinct confirmed opportunities.`
   :`${counted.length} distinct confirmed opportunities, average share ${(meanShare*100).toFixed(1)}% → lift ${lift.toFixed(2)}${lift<rawLift?' (limited by the 10 ceiling)':''}.`;
  return [f.id,{id:f.id,label:f.label,kind:f.kind,settingsKey:f.settingsKey,generic:isGeneric(f),baseline,household:layers.household.get(f.id)??null,child:layers.child.get(f.id)??null,overlay:o,resolved,resolvedSource:source,counted:counted.length,suppressed,uncounted,meanShare,rawLift,lift,applied:on?lift:0,status,explanation} as FeatureStat];
 }));
}
// Primary explicit relevance. With no overlays this is exactly domain.relevance(). An overlay on a mapped topic replaces
// that Settings value and matches the union of the baseline word matcher and the grounded feature, counted once. Format
// overlays add their own term over grounded matches; workshop joins the generic cap.
export function explicitRelevance(o:Opportunity,settings:Settings,overlay:(featureId:string)=>Overlay|null,grounded:GroundedFeature[]){
 const text=`${o.title} ${o.description}`,reasons:{key:string;weight:number;evidence:string;featureId:string|null;source:string;matchedBy:string}[]=[];
 const source=(v:Overlay|null)=>v?`${v.scope} instruction`:'Settings';
 for(const [key,pattern] of Object.entries(keywords)){
  const spec=FEATURE_BY_KEY.get(key),v=spec?overlay(spec.id):null,word=text.match(pattern)?.[0]??null,feature=v?grounded.find(g=>g.id===spec!.id)??null:null;
  if(!word&&!feature)continue;
  reasons.push({key,weight:v?v.value:settings.weights[key]??0,evidence:word??feature!.quote,featureId:spec?.id??null,source:source(v),matchedBy:word&&feature?'baseline word and grounded feature':word?'baseline word':'grounded feature'});
 }
 for(const spec of FEATURES.filter(f=>!f.settingsKey)){
  const v=overlay(spec.id),feature=v?grounded.find(g=>g.id===spec.id):null;
  if(v&&feature)reasons.push({key:spec.id,weight:v.value,evidence:feature.quote,featureId:spec.id,source:source(v),matchedBy:'grounded feature'});
 }
 const generic=reasons.filter(r=>GENERIC_TERMS.includes(r.key)).reduce((n,r)=>n+r.weight,0);
 return {score:reasons.filter(r=>!GENERIC_TERMS.includes(r.key)).reduce((n,r)=>n+r.weight,0)+Math.min(GENERIC_CAP,generic),reasons,genericUncapped:generic};
}
// Secondary learned tie score over the listing's actual current grounded features only.
export function learnedScore(grounded:GroundedFeature[],stats:Map<string,FeatureStat>,genericUncapped:number){
 const terms=[...new Set(grounded.map(g=>g.id))].sort(byText).map(id=>stats.get(id)).filter((s):s is FeatureStat=>Boolean(s&&s.applied>0)).map(s=>({featureId:s.id,label:s.label,lift:s.applied,generic:s.generic}));
 const room=Math.max(0,GENERIC_CAP-Math.min(GENERIC_CAP,genericUncapped)),generic=terms.filter(t=>t.generic).reduce((n,t)=>n+t.lift,0);
 const score=terms.filter(t=>!t.generic).reduce((n,t)=>n+t.lift,0)+Math.min(generic,room);
 return {score,terms,genericCapped:generic>room};
}
// Explicit score first; learned score only within equal explicit scores; then start time and stable ID.
export function compareRanked(a:{score:number;learnedScore:number;start:{local:string|null};id:string},b:typeof a){
 return b.score-a.score||b.learnedScore-a.learnedScore||(a.start.local??'zz').localeCompare(b.start.local??'zz')||byText(a.id,b.id);
}
