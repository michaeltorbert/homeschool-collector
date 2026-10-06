import type {Opportunity} from './domain';
export const LOCAL_SCOPE = {householdId:'household:local',subjectId:'child:local',actorId:'operator:local'} as const;
export const REASONS = {
 timing:'This date or time does not work',
 conflict:'Schedule conflict',
 general:'Not generally interested in this',
 'wrong-fit':'Too young, too old, or otherwise the wrong fit',
 concern:'Price, travel, format, duration, or organizer concern',
 other:'Other / not sure',
} as const;
export type ReasonCode=keyof typeof REASONS;
export const CONCERN_DIMENSIONS=['price','travel','format','duration','organizer'] as const;
export interface GroundedFeature {id:string;label:string;kind:'topic'|'format';quote:string;start:number;end:number;field:'title'|'description';revision:string;type:'inferred';uncertainty:string;}
const featurePatterns:Record<string,{label:string;kind:'topic'|'format';pattern:RegExp}>={
 sailing:{label:'Sailing',kind:'topic',pattern:/\bsail(?:ing|boat)?\b/i},
 chess:{label:'Chess',kind:'topic',pattern:/\bchess\b/i},
 science:{label:'Science',kind:'topic',pattern:/\b(?:science|STEM|experiment|astronomy)\b/i},
 outdoors:{label:'Outdoors',kind:'topic',pattern:/\b(?:outdoor|nature|hike|trail)\b/i},
 art:{label:'Art',kind:'topic',pattern:/\b(?:painting|drawing|sculpture|art workshop)\b/i},
 crafts:{label:'Crafts',kind:'topic',pattern:/\bcrafts?\b/i},
 'hands-on':{label:'Hands-on',kind:'topic',pattern:/\bhands.on\b/i},
 concert:{label:'Concert format',kind:'format',pattern:/\bconcert\b/i},
 performance:{label:'Performance format',kind:'format',pattern:/\b(?:performance|theater|theatre)\b/i},
 workshop:{label:'Workshop format',kind:'format',pattern:/\bworkshop\b/i},
 exhibition:{label:'Exhibition format',kind:'format',pattern:/\bexhibition\b/i},
};
// A selectable target is a conservative textual inference, not verified audience or eligibility.
// Venue fields and generic "Arts Center" are intentionally not topic evidence.
export function groundedFeatures(event:Opportunity):GroundedFeature[]{
 const result:GroundedFeature[]=[];
 for(const [key,spec] of Object.entries(featurePatterns)){
  for(const field of ['title','description'] as const){
   const match=spec.pattern.exec(event[field]);
   if(match){result.push({id:`${spec.kind}:${key}`,label:spec.label,kind:spec.kind,quote:match[0],start:match.index,end:match.index+match[0].length,field,revision:'grounded-words-v1',type:'inferred',uncertainty:'Source word match; activity meaning and suitability are not independently verified.'});break;}
  }
 }
 return result;
}
export function attendanceSnapshot(envelope:any){
 const event=envelope.event as Opportunity;
 const facts=(e:Opportunity)=>({start:e.start,end:e.end,status:e.status,recurring:e.recurring});
 return {displayed:facts(event),representations:(envelope.representations??[]).map((r:any)=>({part:r.part,facts:facts(r.event)})).sort((a:any,b:any)=>a.part.localeCompare(b.part)),recurrenceCapture:event.recurring?'Master schedule only; RRULE/RDATE/EXDATE values are not captured and individual dates need checking.':'No event recurrence observed.'};
}
const normalizedTime=(t:any)=>!t?{kind:'unknown'}:t.kind==='known'&&t.instant?{kind:'known',instant:new Date(t.instant).toISOString()}:t.kind==='all-day'?{kind:'all-day',date:t.local?.slice(0,10)??null}:{kind:'unknown',local:t.local??null,zone:t.zone??null};
const normalizedAttendance=(facts:any)=>({start:normalizedTime(facts.start),end:normalizedTime(facts.end),cancelled:String(facts.status??'unknown').toLowerCase()==='cancelled',recurring:Boolean(facts.recurring)});
 export function attendanceKey(snapshot:any){
 const displayed=normalizedAttendance(snapshot.displayed);
 const variants=[...new Set([JSON.stringify(displayed),...(snapshot.representations??[]).map((r:any)=>JSON.stringify(normalizedAttendance(r.facts)))])].sort();
 return JSON.stringify({displayed,variants});
}
export function attendanceDifferences(before:any,after:any){
 const differences:{source:string;field:string;before:any;after:any}[]=[];
 const compare=(source:string,a:any,b:any)=>{
  if(!a||!b){differences.push({source,field:'evidence',before:a??null,after:b??null});return;}
  const old=normalizedAttendance(a),current=normalizedAttendance(b);
  for(const field of ['start','end','cancelled','recurring'] as const){if(JSON.stringify(old[field])!==JSON.stringify(current[field]))differences.push({source,field:field==='cancelled'?'status':field,before:a[field==='cancelled'?'status':field],after:b[field==='cancelled'?'status':field]});}
 };
 compare('Displayed listing',before.displayed,after.displayed);
 const oldParts=new Map<string,any>((before.representations??[]).map((r:any)=>[r.part,r.facts]));
 const newParts=new Map<string,any>((after.representations??[]).map((r:any)=>[r.part,r.facts]));
 for(const part of [...new Set([...oldParts.keys(),...newParts.keys()])].sort())compare(part,oldParts.get(part),newParts.get(part));
 return differences;
}
export function timingReason(reasons:ReasonCode[]){return reasons.includes('timing')||reasons.includes('conflict');}
export function primaryReconsider(reasons:ReasonCode[]){return timingReason(reasons)&&!reasons.includes('general');}
export interface DecisionEvent {decision_id:string;action:string;supersedes_id:string|null;reverses_id:string|null;target_decision_id:string|null;payload:any;snapshot:any;created_at:string;}
export function projectDecision(events:DecisionEvent[],currentEnvelope:any,now:Date){
 const byId=new Map<string,DecisionEvent>(),reversed=new Set<string>();let active:DecisionEvent|null=null;
 for(const e of events){byId.set(e.decision_id,e);if(e.action==='pass')active=e;
  else if(e.action==='undo'){reversed.add(e.reverses_id!);if(active?.decision_id===e.reverses_id){let prior:DecisionEvent|null=active.supersedes_id?byId.get(active.supersedes_id)??null:null;while(prior&&reversed.has(prior.decision_id))prior=prior.supersedes_id?byId.get(prior.supersedes_id)??null:null;active=prior;}}
 }
 if(!active)return {active:null,reconsider:null,history:events};
 const current=attendanceSnapshot(currentEnvelope),changed=attendanceKey(active.snapshot.attendance)!==attendanceKey(current);
 const shown=currentEnvelope.event as Opportunity;
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const upcoming=shown.status!=='cancelled'&&(shown.recurring||(shown.start.instant?new Date(shown.end.instant??shown.start.instant)>=now:shown.start.kind==='all-day'?(shown.end.local?shown.end.local.slice(0,10)>today:(shown.start.local??'')>=today):!shown.start.local||shown.start.local.slice(0,10)>=today));
 const reviewed=events.some(e=>e.action==='reconsider_review'&&e.target_decision_id===active!.decision_id&&attendanceKey(e.snapshot.attendance)===attendanceKey(current));
 const reasons=active.payload.reasons as ReasonCode[];
 const reconsider=changed&&timingReason(reasons)&&upcoming&&!reviewed?{decisionId:active.decision_id,primary:primaryReconsider(reasons),reason:'You passed because of timing or a conflict; the displayed attendance facts changed.',before:active.snapshot.attendance,after:current,programLevel:active.snapshot.decisionScope==='program'||current.displayed.recurring,scopeChanged:Boolean(active.snapshot.event.recurring)!==Boolean(current.displayed.recurring),differences:attendanceDifferences(active.snapshot.attendance,current)}:null;
 return {active,reconsider,history:events};
}
