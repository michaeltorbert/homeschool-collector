import {parseCalendar,semantic,type Opportunity} from './domain.ts';
// Issue #7 bounded calendar evidence: pure, versioned measurements of one successful calendar response, computed with the
// current parser at acquisition time and then frozen. Observed dates/counts/order describe this response only; they are not
// occurrence expansion, a publisher horizon, truncation proof or catalog completeness.
export const EVIDENCE_REVISION='source-evidence-v1';
export const UNKNOWN_LIMITS={publisherHorizon:'unknown',truncation:'unknown',pagination:'unknown',catalogCompleteness:'unknown'} as const;
// Parent-facing copy. The technical limit (no permitted complete catalog route; registration landing denied) is documented
// in docs/plans/source-and-hosting.md.
export const CATALOG_LABEL='Classes and camps are not connected; the complete registration listings are unavailable';
export type DocumentOrder='ascending'|'descending'|'unsorted'|'n/a';
export interface Measurement {
 revision:string;
 returned:number;accepted:number;parserRejects:number;duplicates:number;
 knownStarts:{count:number;earliest:string|null;latest:string|null};
 allDayStarts:{count:number;earliest:string|null;latest:string|null};
 unknownTime:number;recurringMasters:number;order:DocumentOrder;
}
export type UidMap=Record<string,string>;
// Document order of the accepted known-start subsequence only. Fewer than two, or all equal, is n/a; date-only and unknown
// starts are excluded and counted separately.
export function documentOrder(instants:number[]):DocumentOrder{
 let up=false,down=false;
 for(let i=1;i<instants.length;i++){if(instants[i]>instants[i-1])up=true;else if(instants[i]<instants[i-1])down=true;}
 return up&&down?'unsorted':up?'ascending':down?'descending':'n/a';
}
const range=(values:string[],key:(v:string)=>number)=>{const sorted=[...values].sort((a,b)=>key(a)-key(b)||(a<b?-1:a>b?1:0));return {count:values.length,earliest:sorted[0]??null,latest:sorted.at(-1)??null};};
// Throws exactly when the current parser rejects the whole response (not a complete calendar).
export function measureResponse(body:string,hash:(v:string)=>string){
 const parsed=parseCalendar(body);
 // Same rule as ingestion: the first representation of a UID is accepted, later ones are quarantined duplicates.
 const accepted:Opportunity[]=[],seen=new Set<string>();
 for(const e of parsed.events){if(seen.has(e.id))continue;seen.add(e.id);accepted.push(e);}
 const known=accepted.filter(e=>e.start.kind==='known'&&e.start.instant).map(e=>e.start.instant!);
 const allDay=accepted.filter(e=>e.start.kind==='all-day'&&e.start.local).map(e=>e.start.local!.slice(0,10));
 const measurement:Measurement={revision:EVIDENCE_REVISION,returned:parsed.returned,accepted:accepted.length,parserRejects:parsed.rejects.length,duplicates:parsed.events.length-accepted.length,
  knownStarts:range(known,Date.parse),allDayStarts:range(allDay,v=>Date.parse(`${v}T00:00:00Z`)),
  unknownTime:accepted.filter(e=>e.start.kind==='unknown').length,recurringMasters:accepted.filter(e=>e.recurring).length,order:documentOrder(known.map(Date.parse))};
 const uidMap:UidMap=Object.fromEntries(accepted.map(e=>[e.id,hash(JSON.stringify(semantic(e)))] as [string,string]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0));
 return {measurement,uidMap};
}
// An empty calendar is a successful empty check; any parser reject or duplicate makes the response partial.
export const outcomeOf=(m:Measurement)=>m.returned===0?'empty':m.parserRejects+m.duplicates>0?'partial':'ok';
// Observed UID presence/semantic differences between two responses. Not observed in the newer response is never a
// disappearance or cancellation claim: publisher scope completeness is unproved for every pair.
export function compareMaps(previous:UidMap,current:UidMap){
 let added=0,notObservedInNewer=0,changedCommon=0,unchangedCommon=0;
 for(const [id,h] of Object.entries(current)){if(!Object.hasOwn(previous,id))added++;else if(previous[id]===h)unchangedCommon++;else changedCommon++;}
 for(const id of Object.keys(previous))if(!Object.hasOwn(current,id))notObservedInNewer++;
 return {added,notObservedInNewer,changedCommon,unchangedCommon};
}
export function overlap(a:UidMap,b:UidMap){
 let common=0,agree=0;
 for(const [id,h] of Object.entries(a))if(Object.hasOwn(b,id)){common++;if(b[id]===h)agree++;}
 return {common,agree,conflict:common-agree};
}
