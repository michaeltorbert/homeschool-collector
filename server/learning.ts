// Interest learning commands and projections over the append-only learning_events log (issue #5).
// Every command validates its canonical payload, replays an exact receipt BEFORE checking mutable state, then applies
// expected-state guards inside one transaction. Nothing here calls a model or reads private notes.
import {randomUUID} from 'node:crypto';
import {LOCAL_SCOPE,groundedFeatures,activeDecision,type DecisionEvent} from '../src/decisions.ts';
import {ATTRIBUTION_REVISION,LEARNING_ALGORITHM_REVISION,EXTRACTION_REVISION,FEATURE_BY_ID,MAX_WEIGHT,MIN_WEIGHT,OUTCOME_LABELS,RULES,DISTINCT_THRESHOLD,MAX_LIFT,allocate,allocationEffect,projectLearning,featureStats,resolveInstructions,activeEntryFor,groupOccupant,knownGroup,type Entry,type Instruction,type LearningRow,type Projection,type Scope} from '../src/learning.ts';
import {ConflictError,hash,type Store} from './store.ts';
import type {Settings} from '../src/domain.ts';
const json=(v:any)=>JSON.stringify(v);
const parse=(v:any)=>JSON.parse(String(v));
const COMMAND_KEY=/^[A-Za-z0-9_-]{8,100}$/;
const ID=/^[A-Za-z0-9_:-]{1,100}$/;
const SCOPE_FIELDS=['householdId','subjectId','actorId'];
const nullableId=(value:any,label:string)=>{if(value===undefined||value===null)return null;if(typeof value!=='string'||!ID.test(value))throw Error(`Invalid ${label}.`);return value;};
// Strict fields, the single local household/child/operator and a valid idempotency key. Labels are not authentication.
function base(input:any,allowed:string[]){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('A learning command is required.');
 for(const field of Object.keys(input))if(!allowed.includes(field)&&!SCOPE_FIELDS.includes(field))throw Error(`Unsupported learning command field: ${field}.`);
 const {householdId=LOCAL_SCOPE.householdId,subjectId=LOCAL_SCOPE.subjectId,actorId=LOCAL_SCOPE.actorId}=input;
 if(householdId!==LOCAL_SCOPE.householdId||subjectId!==LOCAL_SCOPE.subjectId||actorId!==LOCAL_SCOPE.actorId)throw Error('Only the single local child, household and operator are supported. These labels are not authentication.');
 if(typeof input.commandKey!=='string'||!COMMAND_KEY.test(input.commandKey))throw Error('A valid idempotency key is required.');
 return {householdId,subjectId,actorId};
}
function grouping(value:any,allowKeep:boolean){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['mode','groupId'].includes(k)))throw Error('Choose whether this is a distinct opportunity, the same program as an earlier signal, or unsure.');
 const modes=allowKeep?['new','same','unknown','keep']:['new','same','unknown'];
 if(!modes.includes(value.mode))throw Error('Choose whether this is a distinct opportunity, the same program as an earlier signal, or unsure.');
 const groupId=value.mode==='same'?nullableId(value.groupId,'program/group'):null;
 if(value.mode==='same'&&!groupId)throw Error('Choose the earlier program/group this listing belongs to.');
 if(value.mode!=='same'&&value.groupId!==undefined&&value.groupId!==null)throw Error('Only “same program” takes a group.');
 return {mode:value.mode as 'new'|'same'|'unknown'|'keep',groupId};
}
const shownVersionOf=(value:any)=>{const v=Number(value);if(!Number.isInteger(v)||v<1)throw Error('A shown source version is required.');return v;};
export class LearningService {
 constructor(private store:Store){}
 private get db(){return this.store.db;}
 rows():LearningRow[]{return this.db.prepare('SELECT * FROM learning_events ORDER BY seq').all().map(r=>({seq:Number(r.seq),eventId:String(r.event_id),kind:String(r.kind) as LearningRow['kind'],opportunityId:r.opportunity_id==null?null:String(r.opportunity_id),epoch:Number(r.epoch),data:parse(r.data_json),attributionJson:r.attribution_json==null?null:String(r.attribution_json),originDecisionId:r.origin_decision_id==null?null:String(r.origin_decision_id),targetEventId:r.target_event_id==null?null:String(r.target_event_id),createdAt:String(r.created_at)}));}
 // Exact active passes across all listings; pass-linked instructions follow them.
 activePassIds(){
  const byItem=new Map<string,DecisionEvent[]>();
  for(const e of this.db.prepare('SELECT decision_id,action,supersedes_id,reverses_id,opportunity_id FROM decision_events ORDER BY event_id').all())byItem.set(String(e.opportunity_id),[...(byItem.get(String(e.opportunity_id))??[]),e as unknown as DecisionEvent]);
  return new Set([...byItem.values()].map(events=>activeDecision(events)?.decision_id).filter((id):id is string=>Boolean(id)));
 }
 project(){return projectLearning(this.rows(),this.activePassIds());}
 state(settings:Settings){const projection=this.project();return {projection,stats:featureStats(projection,settings),overlay:resolveInstructions(projection.instructions).overlay};}
 private replay(commandKey:string,payloadHash:string){
  const prior=this.db.prepare('SELECT payload_hash,result_json FROM learning_events WHERE command_key=?').get(commandKey);
  if(!prior)return null;if(prior.payload_hash!==payloadHash)throw Error('Learning idempotency key payload conflict.');return parse(prior.result_json);
 }
 private append(row:{eventId?:string;commandKey:string|null;payloadHash:string;kind:LearningRow['kind'];scope:{householdId:string;subjectId:string;actorId:string};opportunityId?:string|null;epoch:number;data:any;attributionJson?:string|null;originDecisionId?:string|null;targetEventId?:string|null;result:(eventId:string,createdAt:string)=>any}){
  const eventId=row.eventId??randomUUID(),createdAt=this.store.clock().toISOString(),result=row.result(eventId,createdAt);
  this.db.prepare('INSERT INTO learning_events(event_id,command_key,payload_hash,kind,household_id,subject_id,actor_id,opportunity_id,epoch,data_json,attribution_json,origin_decision_id,target_event_id,result_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
   .run(eventId,row.commandKey,row.payloadHash,row.kind,row.scope.householdId,row.scope.subjectId,row.scope.actorId,row.opportunityId??null,row.epoch,json(row.data),row.attributionJson??null,row.originDecisionId??null,row.targetEventId??null,json(result),createdAt);
  return result;
 }
 private checkRevision(p:Projection,expected:any){if((p.control.revision??null)!==(expected??null))throw new ConflictError('Learning was turned on, paused or reset in another window. Reload before continuing.');}
 // Frozen attribution of the source version actually shown: hashes, grounded spans, revisions and the 1000-unit allocation.
 attribution(envelope:any,shownVersion:number,currentVersion:number){
  const event=envelope.event,features=groundedFeatures(event).map(f=>({id:f.id,label:f.label,kind:f.kind,quote:f.quote,field:f.field,start:f.start,end:f.end,revision:f.revision}));
  return {revision:ATTRIBUTION_REVISION,algorithmRevision:LEARNING_ALGORITHM_REVISION,extractionRevision:EXTRACTION_REVISION,sourceVersion:shownVersion,staleAtSubmit:shownVersion<currentVersion,sourceEnvelopeHash:hash(json(envelope)),
   representations:(envelope.representations??[]).map((r:any)=>({part:r.part,representationHash:hash(json(r.event))})).sort((a:any,b:any)=>a.part.localeCompare(b.part)),
   shown:{title:event.title,description:event.description,start:event.start},features,
   allocation:allocate(features.map(f=>f.id)).map(a=>({...a,effect:allocationEffect(a.featureId)})),
   settingsRevision:hash(json(this.store.settings())),subjectId:LOCAL_SCOPE.subjectId,actorId:LOCAL_SCOPE.actorId};
 }
 private version(id:string,shownVersion:number){
  const opportunity=this.db.prepare('SELECT version FROM opportunities WHERE id=?').get(id);if(!opportunity)throw Error('Unknown opportunity.');
  const row=this.db.prepare('SELECT data_json FROM versions WHERE id=? AND version=?').get(id,shownVersion);if(!row)throw Error('Shown source version does not exist.');
  return {envelope:parse(row.data_json),currentVersion:Number(opportunity.version)};
 }
 // Interested: bookmark + frozen weak signal (or an explicit no-signal record) + receipt, atomically.
 interest(input:any){
  const scope=base(input,['commandKey','id','shownVersion','grouping','expectedEntryId','expectedControlRevision']);
  if(typeof input.id!=='string')throw Error('Unknown opportunity.');
  const canonical={kind:'interest',id:input.id,shownVersion:shownVersionOf(input.shownVersion),grouping:grouping(input.grouping,false),expectedEntryId:nullableId(input.expectedEntryId,'current signal'),expectedControlRevision:nullableId(input.expectedControlRevision,'learning revision'),...scope};
  const payloadHash=hash(json(canonical));
  return this.store.transaction(()=>{
   const prior=this.replay(input.commandKey,payloadHash);if(prior)return prior;
   const {envelope,currentVersion}=this.version(canonical.id,canonical.shownVersion);
   const p=this.project(),epoch=p.control.epoch;this.checkRevision(p,canonical.expectedControlRevision);
   const current=activeEntryFor(p,canonical.id,epoch);
   if((current?.eventId??null)!==canonical.expectedEntryId)throw new ConflictError('This listing’s learning signal changed in another window. Reload before continuing.');
   this.db.prepare('INSERT OR IGNORE INTO family_state(id) VALUES (?)').run(canonical.id);
   this.db.prepare('UPDATE family_state SET interested=1 WHERE id=?').run(canonical.id);
   const staleAtSubmit=canonical.shownVersion<currentVersion;
   let data:any,attributionJson:string|null=null;
   if(p.control.status!=='on')data={outcome:'no-signal',reason:p.control.status,counting:false,shownVersion:canonical.shownVersion,staleAtSubmit};
   else{
    attributionJson=json(this.attribution(envelope,canonical.shownVersion,currentVersion));
    if(current)data={outcome:'duplicate-item',counting:false,linkedEventId:current.eventId,groupId:current.groupId,certainty:current.certainty,shownVersion:canonical.shownVersion,staleAtSubmit};
    else data={...this.placement(p,canonical.grouping,epoch,null,null),shownVersion:canonical.shownVersion,staleAtSubmit};
   }
   return this.append({commandKey:input.commandKey,payloadHash,kind:'interest',scope,opportunityId:canonical.id,epoch,data,attributionJson,result:(eventId,createdAt)=>({eventId,kind:'interest',id:canonical.id,outcome:data.outcome,counting:data.counting,groupId:data.groupId??null,certainty:data.certainty??null,linkedEventId:data.linkedEventId??null,learningStatus:p.control.status,epoch,shownVersion:canonical.shownVersion,currentVersion,staleAtSubmit,bookmark:true,createdAt})});
  });
 }
 // Group placement. Independence is never inferred: only a deliberate confirmed group counts, one counted signal per group.
 private placement(p:Projection,choice:{mode:string;groupId:string|null},epoch:number,target:Entry|null,except:string|null){
  let groupId:string,certainty:'confirmed'|'unknown';
  if(choice.mode==='keep'){groupId=target!.groupId!;certainty=target!.certainty!;}
  else if(choice.mode==='same'){if(!knownGroup(p,choice.groupId!,epoch))throw new ConflictError('That program/group is not part of the current learning period. Reload and choose again.');groupId=choice.groupId!;certainty='confirmed';}
  else{groupId=randomUUID();certainty=choice.mode==='new'?'confirmed':'unknown';}
  if(certainty==='unknown')return {outcome:'provisional',counting:false,groupId,certainty,linkedEventId:null};
  const occupant=groupOccupant(p,groupId,epoch,except??undefined);
  return occupant?{outcome:'duplicate-group',counting:false,groupId,certainty,linkedEventId:occupant.eventId}:{outcome:'counted',counting:true,groupId,certainty,linkedEventId:null};
 }
 // Deliberate Replace: regroup (copy frozen attribution byte-for-byte) or re-record (freeze the displayed source after preview).
 replace(input:any){
  const scope=base(input,['commandKey','id','mode','targetEntryId','grouping','shownVersion','previewAllocation','expectedControlRevision']);
  if(typeof input.id!=='string')throw Error('Unknown opportunity.');
  if(!['regroup','rerecord'].includes(input.mode))throw Error('Choose regroup or re-record.');
  const rerecord=input.mode==='rerecord',choice=grouping(input.grouping,rerecord);
  if(!rerecord&&(input.shownVersion!==undefined||input.previewAllocation!==undefined))throw Error('Regrouping keeps the original attribution; it takes no source version.');
  let preview:{featureId:string;milli:number}[]|null=null;
  if(rerecord){if(!Array.isArray(input.previewAllocation)||input.previewAllocation.length>50||input.previewAllocation.some((a:any)=>!a||typeof a.featureId!=='string'||!Number.isInteger(a.milli)||Object.keys(a).some(k=>!['featureId','milli'].includes(k))))throw Error('Re-recording requires the previewed allocation you confirmed.');preview=input.previewAllocation.map((a:any)=>({featureId:a.featureId,milli:a.milli}));}
  const targetEntryId=nullableId(input.targetEntryId,'signal');if(!targetEntryId)throw Error('The exact current signal is required.');
  const canonical={kind:'replace',id:input.id,mode:input.mode,targetEntryId,grouping:choice,shownVersion:rerecord?shownVersionOf(input.shownVersion):null,previewAllocation:preview,expectedControlRevision:nullableId(input.expectedControlRevision,'learning revision'),...scope};
  const payloadHash=hash(json(canonical));
  return this.store.transaction(()=>{
   const prior=this.replay(input.commandKey,payloadHash);if(prior)return prior;
   const p=this.project(),epoch=p.control.epoch;this.checkRevision(p,canonical.expectedControlRevision);
   if(p.control.status!=='on')throw new ConflictError('Learning is off or paused. Turn it on before regrouping or re-recording; nothing is deferred. Undo remains available.');
   const target=p.entries.get(targetEntryId);
   if(!target||target.opportunityId!==canonical.id||target.status!=='active')throw new ConflictError('That signal is no longer the active one for this listing. Reload before replacing it.');
   if(target.epoch!==epoch)throw new ConflictError('That signal belongs to an earlier learning period. It can be undone but not replaced; record fresh interest instead.');
   let attributionJson:string,evidenceSeq:number|undefined,staleAtSubmit=false,shownVersion=target.shownVersion;
   if(!rerecord){
    if(!target.recognized||!target.attributionJson)throw Error('This signal’s attribution is not recognized; record fresh interest instead.');
    if((choice.mode==='same'&&choice.groupId===target.groupId)||(choice.mode==='unknown'&&target.certainty==='unknown'))throw Error('Regrouping must change the program/group or its certainty.');
    attributionJson=target.attributionJson;evidenceSeq=target.evidenceSeq;
   }else{
    const {envelope,currentVersion}=this.version(canonical.id,canonical.shownVersion!);
    const attribution=this.attribution(envelope,canonical.shownVersion!,currentVersion);
    if(json(attribution.allocation.map(a=>({featureId:a.featureId,milli:a.milli})))!==json(preview))throw new ConflictError('The source attribution you confirmed no longer matches that version. Reload and confirm again.');
    attributionJson=json(attribution);staleAtSubmit=attribution.staleAtSubmit;shownVersion=canonical.shownVersion;
   }
   const placed=this.placement(p,choice,epoch,target,target.eventId);
   const data={mode:canonical.mode,...placed,...(evidenceSeq!==undefined?{evidenceSeq}:{}),attributionFrom:rerecord?null:(target.mode==='regroup'?target.attributionFrom??target.eventId:target.eventId),previous:{eventId:target.eventId,groupId:target.groupId,certainty:target.certainty,outcome:target.outcome},shownVersion,staleAtSubmit};
   return this.append({commandKey:input.commandKey,payloadHash,kind:'replace',scope,opportunityId:canonical.id,epoch,data,attributionJson,targetEventId:target.eventId,result:(eventId,createdAt)=>({eventId,kind:'replace',mode:canonical.mode,id:canonical.id,replacesId:target.eventId,outcome:placed.outcome,counting:placed.counting,groupId:placed.groupId,certainty:placed.certainty,linkedEventId:placed.linkedEventId,staleAtSubmit,createdAt})});
  });
 }
 // Exact Undo of one active signal (any period, allowed while paused). Undoing a replacement restores its original; if
 // another listing now holds the original's group, the original returns visibly and permanently non-counting.
 undo(input:any){
  const scope=base(input,['commandKey','id','targetEntryId']);
  if(typeof input.id!=='string')throw Error('Unknown opportunity.');
  const targetEntryId=nullableId(input.targetEntryId,'signal');if(!targetEntryId)throw Error('The exact signal to undo is required.');
  const canonical={kind:'undo',id:input.id,targetEntryId,...scope},payloadHash=hash(json(canonical));
  return this.store.transaction(()=>{
   const prior=this.replay(input.commandKey,payloadHash);if(prior)return prior;
   const p=this.project(),target=p.entries.get(targetEntryId);
   if(!target||target.opportunityId!==canonical.id||target.status!=='active')throw new ConflictError('That signal is no longer active. Reload before undoing.');
   const original=target.replacesId?p.entries.get(target.replacesId)??null:null;
   let restoration=null;
   if(original){
    const occupant=original.counting&&original.groupId?groupOccupant(p,original.groupId,original.epoch,target.eventId):null;
    restoration=occupant?{eventId:original.eventId,counting:false,outcome:'duplicate-group-restoration',linkedEventId:occupant.eventId}:{eventId:original.eventId,counting:original.counting,outcome:original.outcome,linkedEventId:original.linkedEventId};
   }
   const data={restoration,targetEpoch:target.epoch};
   return this.append({commandKey:input.commandKey,payloadHash,kind:'undo',scope,opportunityId:canonical.id,epoch:p.control.epoch,data,targetEventId:target.eventId,result:(eventId,createdAt)=>({eventId,kind:'undo',id:canonical.id,reverses:target.eventId,restoration,bookmarkUnchanged:true,createdAt})});
  });
 }
 // Opt-in, pause and reset. Reset appends an epoch boundary; it deletes nothing and leaves Settings and instructions alone.
 control(input:any){
  const scope=base(input,['commandKey','action','expectedControlRevision']);
  if(!['on','pause','reset'].includes(input.action))throw Error('Choose on, pause or reset.');
  const canonical={kind:'control',action:input.action,expectedControlRevision:nullableId(input.expectedControlRevision,'learning revision'),...scope},payloadHash=hash(json(canonical));
  return this.store.transaction(()=>{
   const prior=this.replay(input.commandKey,payloadHash);if(prior)return prior;
   const p=this.project();this.checkRevision(p,canonical.expectedControlRevision);
   if(canonical.action==='on'&&p.control.status==='on')throw Error('Learning is already on.');
   if(canonical.action==='pause'&&p.control.status!=='on')throw Error('Learning is not on.');
   const epoch=canonical.action==='reset'?p.control.epoch+1:p.control.epoch;
   const status=canonical.action==='on'?'on':canonical.action==='pause'?'paused':p.control.status;
   return this.append({commandKey:input.commandKey,payloadHash,kind:'control',scope,epoch,data:{action:canonical.action},result:(eventId,createdAt)=>({eventId,action:canonical.action,status,epoch,createdAt})});
  });
 }
 // Deliberate scoped explicit instruction: a 0–10 value or Clear (inherit). Baseline Settings are untouched.
 instruction(input:any){
  const scope=base(input,['commandKey','scope','featureId','action','value','expectedInstructionId','provenance']);
  if(!['child','household'].includes(input.scope))throw Error('Choose child or household scope.');
  if(typeof input.featureId!=='string'||!FEATURE_BY_ID.has(input.featureId))throw Error('Choose a supported grounded topic or format.');
  if(!['set','clear'].includes(input.action))throw Error('Choose set or clear.');
  const value=input.action==='set'?Number(input.value):null;
  if(input.action==='set'&&(typeof input.value!=='number'||!Number.isInteger(value)||value!<MIN_WEIGHT||value!>MAX_WEIGHT))throw Error('An instruction value must be a whole number from 0 to 10.');
  if(input.action==='clear'&&input.value!==undefined&&input.value!==null)throw Error('Clear takes no value.');
  let provenance=null;
  if(input.provenance!==undefined&&input.provenance!==null){if(typeof input.provenance!=='object'||Array.isArray(input.provenance)||Object.keys(input.provenance).some(k=>k!=='legacyDecisionId')||typeof input.provenance.legacyDecisionId!=='string')throw Error('Invalid instruction provenance.');provenance={legacyDecisionId:input.provenance.legacyDecisionId};}
  const canonical={kind:'instruction',scope:input.scope as Scope,featureId:input.featureId,action:input.action,value,expectedInstructionId:nullableId(input.expectedInstructionId,'current instruction'),provenance,...scope},payloadHash=hash(json(canonical));
  return this.store.transaction(()=>{
   const prior=this.replay(input.commandKey,payloadHash);if(prior)return prior;
   const p=this.project(),current=resolveInstructions(p.instructions).layers[canonical.scope].get(canonical.featureId)??null;
   if((current?.eventId??null)!==canonical.expectedInstructionId)throw new ConflictError('This instruction changed in another window. Reload before saving.');
   if(canonical.action==='clear'&&(!current||current.action==='clear'))throw Error('There is no instruction to clear at this scope.');
   if(provenance){
    // Applying an earlier (pre-upgrade) Generally pass is a fresh, independent instruction that only references it.
    const pass=this.db.prepare("SELECT payload_json FROM decision_events WHERE decision_id=? AND action='pass'").get(provenance.legacyDecisionId);
    const payload=pass?parse(pass.payload_json):null;
    if(!payload||payload.generalIntent!=='generally'||payload.targetId!==canonical.featureId||payload.targetScope!==canonical.scope||canonical.action!=='set'||canonical.value!==0)throw Error('That earlier pass does not name this topic/format and scope.');
    if(p.instructions.some(i=>i.originDecisionId===provenance!.legacyDecisionId))throw Error('That pass already has its own linked instruction.');
   }
   // Clear freezes the suppression boundary of the live sets it ends at this scope, independent of later pass state.
   const frozenCutoff=canonical.action==='clear'?Math.max(0,...p.instructions.filter(i=>i.live&&i.action==='set'&&i.scope===canonical.scope&&i.featureId===canonical.featureId).map(i=>i.seq)):undefined;
   return this.append({commandKey:input.commandKey,payloadHash,kind:'instruction',scope,epoch:p.control.epoch,data:{scope:canonical.scope,featureId:canonical.featureId,action:canonical.action,value,provenance,...(frozenCutoff!==undefined?{frozenCutoff}:{})},result:(eventId,createdAt)=>({eventId,scope:canonical.scope,featureId:canonical.featureId,action:canonical.action,value,createdAt})});
  });
 }
 // Called inside the decision transaction: a versioned Generally pass sets exactly its scoped feature to 0, linked to that pass.
 linkPassInstruction(link:{instructionId:string;decisionId:string;scope:Scope;featureId:string;payloadHash:string}){
  if(!FEATURE_BY_ID.has(link.featureId))throw Error('The selected topic/aspect is not a supported learning feature.');
  const p=this.project();
  this.append({eventId:link.instructionId,commandKey:null,payloadHash:link.payloadHash,kind:'instruction',scope:LOCAL_SCOPE,epoch:p.control.epoch,data:{scope:link.scope,featureId:link.featureId,action:'set',value:0,provenance:{passDecisionId:link.decisionId}},originDecisionId:link.decisionId,result:eventId=>({eventId,decisionId:link.decisionId})});
 }
 // Snapshot views. Entries expose frozen attribution for inspection; no notes or private profile values are included.
 entryView(e:Entry,epoch:number){
  const a=e.recognized?e.attribution:null;
  return {eventId:e.eventId,kind:e.kind,mode:e.mode,epoch:e.epoch,currentEpoch:e.epoch===epoch,groupId:e.groupId,certainty:e.certainty,counting:e.counting,outcome:e.outcome,outcomeLabel:OUTCOME_LABELS[e.outcome]??e.outcome,linkedEventId:e.linkedEventId,status:e.status,replacesId:e.replacesId,replacedBy:e.replacedBy,reversedBy:e.reversedBy,restoredBy:e.restoredBy,attributionFrom:e.attributionFrom,shownVersion:e.shownVersion,staleAtSubmit:e.staleAtSubmit,createdAt:e.createdAt,
   attribution:a?{sourceVersion:a.sourceVersion,sourceEnvelopeHash:a.sourceEnvelopeHash,extractionRevision:a.extractionRevision,algorithmRevision:a.algorithmRevision,title:a.shown?.title,features:a.features,allocation:a.allocation.map((x:any)=>({...x,label:FEATURE_BY_ID.get(x.featureId)?.label??x.featureId,supported:FEATURE_BY_ID.has(x.featureId),effect:allocationEffect(x.featureId)}))}:null};
 }
 itemView(p:Projection,id:string,interested:boolean){
  const all=[...p.entries.values()].filter(e=>e.opportunityId===id).sort((a,b)=>a.seq-b.seq),epoch=p.control.epoch;
  const active=activeEntryFor(p,id,epoch);
  return {active:active?this.entryView(active,epoch):null,earlierActive:all.filter(e=>e.status==='active'&&e.epoch!==epoch).map(e=>this.entryView(e,epoch)),history:all.map(e=>this.entryView(e,epoch)),legacyBookmark:interested&&all.length===0};
 }
 publicView(state:ReturnType<LearningService['state']>){
  const {projection:p,stats}=state,epoch=p.control.epoch,current=[...p.entries.values()].filter(e=>e.epoch===epoch&&e.status!=='record');
  const summary=(i:Instruction|null)=>i?{eventId:i.eventId,action:i.action,value:i.value,originDecisionId:i.originDecisionId,provenance:i.provenance,createdAt:i.createdAt}:null;
  const groups=[...new Set(current.filter(e=>e.certainty==='confirmed').map(e=>e.groupId!))].map(groupId=>{
   const members=current.filter(e=>e.groupId===groupId).sort((a,b)=>a.seq-b.seq),occupant=members.find(e=>e.status==='active'&&e.counting)??null;
   return {groupId,label:members[0]?.attribution?.shown?.title??'Earlier listing',occupantEventId:occupant?.eventId??null,occupantTitle:occupant?.attribution?.shown?.title??null,members:members.filter(e=>e.status==='active').length};
  });
  const active=current.filter(e=>e.status==='active');
  return {status:p.control.status,epoch,revision:p.control.revision,history:p.control.history,algorithmRevision:LEARNING_ALGORITHM_REVISION,threshold:DISTINCT_THRESHOLD,maxLift:MAX_LIFT,rules:RULES,
   features:[...stats.values()].map(s=>({...s,household:summary(s.household),child:summary(s.child)})),groups,
   counts:{active:active.length,counted:active.filter(e=>e.counting).length,uncounted:active.filter(e=>!e.counting).length}};
 }
}
