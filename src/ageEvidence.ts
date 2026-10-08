import {parseCivil,formatCivil,daysInMonth,civilDateIn,possibleAges,compareBounds,type AgeBounds,type Feasible} from './age';
// Narrow, versioned, deterministic provider age-wording extractor. Quote presence proves provenance,
// not semantics: only the documented participant grammar below becomes an executable rule.
export const AGE_EXTRACTOR_REVISION='age-words-v2';
export const AGE_ASSESSMENT_REVISION='age-assessment-v2';
type Field='title'|'description';
export interface Span {field:Field;quote:string;start:number;end:number}
export type CutoffWording={kind:'date';date:string;span:Span}|{kind:'event-start';meeting:boolean;span:Span}|{kind:'unsupported';reason:string;span:Span};
export interface RuleEvidence {type:'rule';bounds:AgeBounds;exclusiveUpper:boolean;span:Span;cutoff:CutoffWording|null}
export type HintKind='preschool'|'children'|'teen'|'family'|'all-ages'|'adult';
export interface HintEvidence {type:'hint';hint:HintKind;span:Span}
export interface SupervisionEvidence {type:'supervision';span:Span;note:string}
// blocking: potentially applicable age wording whose numeric/role/reference meaning is unresolved. It blocks any
// confirmation and is part of the material facts. Non-blocking entries are non-age quantities retained as written.
export interface UnsupportedEvidence {type:'unsupported';code:string;reason:string;blocking:boolean;span:Span}
export type AgeEvidence=RuleEvidence|HintEvidence|SupervisionEvidence|UnsupportedEvidence;
export const AGE_STATUS_LABELS={'meets':'Meets stated age rule','outside':'Outside stated age rule','unknown':'Age rule needs checking','provisional':'Provisional age comparison','no-rule':'No supported provider age rule'} as const;
export type AgeStatus=keyof typeof AGE_STATUS_LABELS;
export const HINT_LABELS:Record<HintKind,string>={'preschool':'Preschool / toddlers','children':'Children / youth','teen':'Teens','family':'Families','all-ages':'All ages','adult':'Adults'};
export const SUPPORTED_GRAMMAR=[
 'Ages N-M / Ages N to M / Ages N through M (inclusive completed years)',
 'N-M year olds (inclusive)',
 'Ages N and up / and older / Ages N+ (inclusive minimum)',
 'Ages N and under / and younger (inclusive maximum)',
 'Must be at least N years (old / of age) / must be N years or older / must be at least age N (inclusive minimum)',
 'For / open to children, kids, youth or participants under N (exclusive maximum => N-1 completed years)',
 'Cutoff: “as of / on / by <Month D, YYYY | YYYY-MM-DD>” after the rule, “Age as of …”, or “Age cutoff …”',
 'Event reference: “as of / on the first day of class”, “the day of the event” (single nonrecurring event only)',
 'Never executable: negated, excluding, recommended or otherwise qualified clauses, and numbers with non-age units (height, weight, counts, durations). Any other unresolved age wording in the listing, in any feed, blocks confirmation.',
];
const MONTHS=['january','february','march','april','may','june','july','august','september','october','november','december'];
const MONTH='(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)\\.?';
const EVENT_NOUN='(?:event|class|program|session|camp|course|performance|show|workshop)';
const DATE=`(?:${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?|the\\s+(?:first|1st|opening)\\s+(?:day|meeting|session|class)(?:\\s+of\\s+(?:the\\s+)?${EVENT_NOUN})?|the\\s+(?:start|day|date)\\s+of\\s+(?:the\\s+)?${EVENT_NOUN})`;
const ROLE_BEFORE=/\b(?:volunteers?|staff|counselors?|instructors?|chaperones?|coach(?:es)?|helpers?|leaders?|teachers?|performers?|vendors?|parents?|adults?|caregivers?|guardians?|siblings?|spectators?|audience)\b/i;
const ROLE_AFTER=/\b(?:volunteers?|staff|counselors?|instructors?|chaperones?|coach(?:es)?|helpers?|leaders?|teachers?|performers?|vendors?)\b/i;
const FEE=/\$\s?\d|\bfree\b|\bprices?\b|\btickets?\b|\badmission\b|\bcosts?\b|\bfees?\b|\bdiscount/i;
const MONTH_UNITS=/\bmonths?\b|\bmos?\.?(?=\s|$)/i;
const SUPERVISION=/\b(?:must\s+be\s+)?accompanied\s+by\s+(?:a\s+|an\s+|their\s+)?(?:parents?|guardians?|adults?|caregivers?)(?:\s+or\s+(?:a\s+|an\s+)?(?:parents?|guardians?|adults?|caregivers?))?|\b(?:parents?|guardians?|adults?|caregivers?)\s+(?:must|should)\s+(?:accompany|attend|stay|remain)\b|\bwith\s+(?:a|an|their)\s+(?:parent|guardian|adult|caregiver)s?\b|\bparent\s+participation\b/i;
// Negation/exclusion and qualification change meaning; such clauses are retained whole and never executed.
const NEGATION_BEFORE=/\b(?:not|no|never|except|excluding|excludes?|nor|cannot|can['’]t|isn['’]t|aren['’]t|unless|without|other\s+than)\b/i;
const NEGATION_AFTER=/\b(?:may\s+not|must\s+not|cannot|can['’]t|(?:are|is)\s+not|not\s+(?:eligible|permitted|allowed|admitted)|excluded|ineligible|prohibited|except|unless)\b/i;
const QUALIFIER_BEFORE=/\b(?:recommended|suggested|ideal(?:ly)?|best|geared|designed|intended|appropriate|suitable|preferred|perfect|great|aimed|targeted|typically|usually|mostly|primarily|especially|generally|approximately|roughly)\b/i;
const QUALIFIER_AFTER=/\b(?:recommended|suggested|preferred|encouraged|(?:with|by)\s+(?:instructor\s+|staff\s+|teacher\s+)?(?:approval|permission)|exceptions?|flexible|approximately)\b/i;
const NON_AGE_UNIT=/^\s*(?:feet|foot|ft\.?|inches|inch|in\.|cm|centimeters?|meters?|metres?|lbs?\.?|pounds?|kg|kilograms?|minutes?|mins?|hours?|hrs?|days?|weeks?|people|persons|players|participants|tickets|seats|spots|miles?|laps?|percent|%)(?![\w])/i;
const AGE_CONTEXT=/\b(?:ages?|aged|years?\s+old|year[\s-]olds?|kids|children|youth|teens?|adults?|grades?)\b/i;
interface RulePattern {re:RegExp;parse:(m:RegExpExecArray)=>{bounds:AgeBounds;exclusiveUpper:boolean;under:boolean}|string}
const n=(v:string|undefined)=>Number(v);
const RULES:RulePattern[]=[
 {re:/\bages?\s+(\d{1,2})\s*(?:-|–|—|to|through|thru)\s*(\d{1,2})\b(?:\s*(?:years?|yrs?\.?)(?:\s+old)?)?/gi,parse:m=>n(m[1])>n(m[2])?'Reversed age range.':{bounds:{min:n(m[1]),max:n(m[2])},exclusiveUpper:false,under:false}},
 {re:/\b(\d{1,2})\s*(?:-|–|—|to)\s*(\d{1,2})[\s-]*(?:years?|yrs?)[\s-]*olds?\b/gi,parse:m=>n(m[1])>n(m[2])?'Reversed age range.':{bounds:{min:n(m[1]),max:n(m[2])},exclusiveUpper:false,under:false}},
 {re:/\bages?\s+(\d{1,2})\s*(?:\+|(?:years?\s+(?:old\s+)?)?(?:and|&|or)\s+(?:up|older|over|above)\b)/gi,parse:m=>({bounds:{min:n(m[1]),max:null},exclusiveUpper:false,under:false})},
 {re:/\bages?\s+(\d{1,2})\s*(?:years?\s+(?:old\s+)?)?(?:and|&|or)\s+(?:under|younger|below)\b/gi,parse:m=>({bounds:{min:null,max:n(m[1])},exclusiveUpper:false,under:true})},
 // An explicit completed-year unit or “age” is required: “must be at least 8 feet tall” is not an age.
 {re:/\bmust\s+be\s+(?:at\s+least\s+(\d{1,2})\s+(?:years?(?:\s+old|\s+of\s+age)?|yrs?\.?)|at\s+least\s+age\s+(\d{1,2})|(\d{1,2})\s+(?:years?(?:\s+old|\s+of\s+age)?|yrs?\.?)\s+or\s+older)/gi,parse:m=>({bounds:{min:n(m[1]??m[2]??m[3]),max:null},exclusiveUpper:false,under:false})},
 {re:/\b(?:open\s+to|for|limited\s+to)\s+(?:children|kids|youth|participants)\s+(?:under|younger\s+than)\s+(?:the\s+age\s+of\s+|age\s+)?(\d{1,2})\b/gi,parse:m=>n(m[1])<1?'Unsupported bound.':{bounds:{min:null,max:n(m[1])-1},exclusiveUpper:true,under:true}},
];
const UNSUPPORTED:{re:RegExp;code:string;reason:string;context?:boolean}[]=[
 {re:/\badults?\s+only\b/gi,code:'adults-only',reason:'Adults-only wording states no numeric bound; it is not converted into an age rule.'},
 {re:/\b(?:grades?\s+(?:k|pre-?k|\d{1,2})(?:\s*(?:-|–|to|through)\s*(?:\d{1,2}|k))?|(?:k|\d{1,2})(?:st|nd|rd|th)?\s*(?:-|–|to|through)\s*\d{1,2}(?:st|nd|rd|th)\s+grades?)\b/gi,code:'grade',reason:'Grade wording; no grade-to-age conversion is guessed.'},
 {re:/(?<![\w$])\d{1,2}\s?\+(?!\w)/g,code:'isolated-plus',reason:'Isolated “N+” has no stated age role or unit.'},
 {re:/\b(?:older\s+than|over(?:\s+the\s+age\s+of)?)\s+\d{1,2}\b/gi,code:'older-than',reason:'“Older than / over N” is ambiguous for completed years.',context:true},
 {re:/\b(?:under|younger\s+than)\s+(?:the\s+age\s+of\s+|age\s+)?\d{1,2}\b/gi,code:'under-unsupported',reason:'“Under N” outside the supported participant phrasing.',context:true},
 {re:/\bages?\s+\d{1,2}\b[^.;!?]{0,20}/gi,code:'unparsed-age',reason:'Age wording outside the supported grammar.'},
 {re:/\b\d{1,2}\s*(?:years?|yrs?)[\s-]*olds?\b/gi,code:'unparsed-age',reason:'Age wording outside the supported grammar.'},
 {re:/\bmust\s+be\s+(?:at\s+least\s+)?\d{1,2}\b/gi,code:'unparsed-minimum',reason:'“Must be N” without an explicit age unit; not treated as an age rule.',context:true},
];
const HINTS:{re:RegExp;hint:HintKind}[]=[
 {re:/\ball[\s-]ages\b/gi,hint:'all-ages'},
 {re:/\b(?:pre-?school(?:ers?)?|toddlers?|pre-?k)\b/gi,hint:'preschool'},
 {re:/\bteen(?:s|agers?)?\b/gi,hint:'teen'},
 {re:/\bfamil(?:y|ies)(?:[\s-]friendly)?\b/gi,hint:'family'},
 {re:/\b(?:kids|children|youth)\b/gi,hint:'children'},
 {re:/\badults?\b/gi,hint:'adult'},
];
const ABBREVIATION=/\b(?:jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|mr|mrs|ms|dr|st|no)$/i;
function sentences(text:string){
 const out:{text:string;offset:number}[]=[];let start=0;
 for(let i=0;i<text.length;i++){
  const c=text[i];let end='!?;\n'.includes(c);
  if(c==='.'){const next=/^\s*(\S)/.exec(text.slice(i+1));end=(!next||!/\d/.test(next[1]))&&!ABBREVIATION.test(text.slice(start,i));}
  if(end){out.push({text:text.slice(start,i+1),offset:start});start=i+1;}
 }
 if(start<text.length)out.push({text:text.slice(start),offset:start});
 return out;
}
function classifyDate(raw:string,span:Span):CutoffWording{
 const text=raw.toLowerCase().replace(/\s+/g,' ');
 if(text.startsWith('the ')){const meeting=/first|1st|opening|class|program|session|camp|course/.test(text);return {kind:'event-start',meeting,span};}
 if(/^\d{4}-\d{2}-\d{2}$/.test(text)){const d=parseCivil(text);return d?{kind:'date',date:formatCivil(d),span}:{kind:'unsupported',reason:'Impossible cutoff date.',span};}
 if(text.includes('/'))return {kind:'unsupported',reason:'Numeric cutoff date order is ambiguous.',span};
 const m=/^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/.exec(text);
 if(!m)return {kind:'unsupported',reason:'Unrecognized cutoff date.',span};
 const month=MONTHS.findIndex(name=>name.startsWith(m[1]==='sept'?'sep':m[1]))+1;
 if(!m[3])return {kind:'unsupported',reason:'Cutoff date has no year.',span};
 const y=Number(m[3]),d=Number(m[2]);
 if(month<1||d<1||d>daysInMonth(y,month))return {kind:'unsupported',reason:'Impossible cutoff date.',span};
 return {kind:'date',date:formatCivil({y,m:month,d}),span};
}
const cutoffKey=(c:CutoffWording)=>c.kind==='date'?`date:${c.date}`:c.kind==='event-start'?`event:${c.meeting}`:`unsupported:${c.reason}`;
export function extractAgeEvidence(event:{title:string;description:string}):AgeEvidence[]{
 const result:AgeEvidence[]=[];const rules:RuleEvidence[]=[];const standaloneCutoffs:CutoffWording[]=[];
 for(const field of ['title','description'] as const){
  const text=event[field]??'';const used:[number,number][]=[];
  const free=(s:number,e:number)=>!used.some(([a,b])=>s<b&&e>a);
  const span=(s:number,e:number):Span=>({field,quote:text.slice(s,e),start:s,end:e});
  for(const sentence of sentences(text)){
   const s=sentence.text,o=sentence.offset;
   const supervised=SUPERVISION.exec(s);
   if(supervised){used.push([o+supervised.index,o+supervised.index+supervised[0].length]);result.push({type:'supervision',span:span(o+supervised.index,o+supervised.index+supervised[0].length),note:'Supervision condition. It is not an admission rule and never means adults-only.'});}
   for(const pattern of RULES){
    pattern.re.lastIndex=0;let m:RegExpExecArray|null;
    while((m=pattern.re.exec(s))){
     const start=o+m.index,end=start+m[0].length;if(!free(start,end))continue;
     const parsed=pattern.parse(m);let tailEnd=end;
     // A cutoff immediately following the rule belongs to that rule.
     const tail=new RegExp(`^\\s*(?:years?\\s+old|yrs?\\.?)?\\s*,?\\s*(?:as\\s+of|on|by)\\s+(${DATE})`,'i').exec(s.slice(m.index+m[0].length));
     let cutoff:CutoffWording|null=null;
     if(tail){const ds=end+tail[0].length-tail[1].length;cutoff=classifyDate(tail[1],span(ds,ds+tail[1].length));tailEnd=end+tail[0].length;}
     used.push([start,tailEnd]);
     const before=s.slice(0,m.index),after=s.slice(m.index+m[0].length);
     const unsupported=(code:string,reason:string,blocking=true,whole=false)=>{
      // Negated or qualified clauses keep the entire sentence as the quote so their meaning stays visible.
      const lead=s.length-s.trimStart().length,trail=s.trimEnd().length;
      result.push({type:'unsupported',code,reason,blocking,span:whole?span(o+lead,o+trail):span(start,end)});
     };
     if(typeof parsed==='string'){unsupported('invalid-bound',parsed);continue;}
     if(MONTH_UNITS.test(s)){unsupported('month-units','Mixed or month age units are unsupported.');continue;}
     if(NON_AGE_UNIT.test(after)){unsupported('non-age-quantity','The number measures something other than age; not an age rule.',false);continue;}
     if(supervised&&parsed.under){result.push({type:'supervision',span:span(start,end),note:'Applies to who must be accompanied, not to who may attend.'});continue;}
     if(NEGATION_BEFORE.test(before)||NEGATION_AFTER.test(after)){unsupported('negated','Negated or excluding age wording; its meaning is not executed.',true,true);continue;}
     if(QUALIFIER_BEFORE.test(before)||QUALIFIER_AFTER.test(after)){unsupported('qualified','Recommended or qualified age wording is not an admission rule.',true,true);continue;}
     if(ROLE_BEFORE.test(before)||ROLE_AFTER.test(after)){unsupported('role-ambiguous','The age wording’s participant role is ambiguous.');continue;}
     if(FEE.test(s)){unsupported('price-tier','Price or admission-tier wording; not an attendance rule.');continue;}
     rules.push({type:'rule',bounds:parsed.bounds,exclusiveUpper:parsed.exclusiveUpper,span:span(start,end),cutoff});
    }
   }
   const standalone=new RegExp(`\\b(?:ages?\\s+(?:is\\s+|are\\s+|will\\s+be\\s+)?(?:determined\\s+|calculated\\s+|based\\s+)?(?:as\\s+of|on|by)|age\\s+cutoff(?:\\s+date)?\\s*(?:is|:)?)\\s+(${DATE})`,'gi');
   let c:RegExpExecArray|null;
   while((c=standalone.exec(s))){const start=o+c.index,end=start+c[0].length;if(!free(start,end))continue;used.push([start,end]);const ds=end-c[1].length;standaloneCutoffs.push(classifyDate(c[1],span(ds,end)));}
   for(const pattern of UNSUPPORTED){
    if(pattern.context&&!AGE_CONTEXT.test(s))continue;
    pattern.re.lastIndex=0;let m:RegExpExecArray|null;
    while((m=pattern.re.exec(s))){const start=o+m.index,end=start+m[0].length;if(!free(start,end))continue;used.push([start,end]);
     if(NON_AGE_UNIT.test(s.slice(m.index+m[0].length)))result.push({type:'unsupported',code:'non-age-quantity',reason:'The number measures something other than age; not an age rule.',blocking:false,span:span(start,end)});
     else if(supervised&&/under|younger/i.test(m[0]))result.push({type:'supervision',span:span(start,end),note:'Applies to who must be accompanied, not to who may attend.'});
     else result.push({type:'unsupported',code:pattern.code,reason:pattern.reason,blocking:true,span:span(start,end)});}
   }
   for(const pattern of HINTS){
    pattern.re.lastIndex=0;let m:RegExpExecArray|null;
    while((m=pattern.re.exec(s))){const start=o+m.index,end=start+m[0].length;if(!free(start,end))continue;used.push([start,end]);
     if(!result.some(r=>r.type==='hint'&&r.hint===pattern.hint&&r.span.field===field))result.push({type:'hint',hint:pattern.hint,span:span(start,end)});}
   }
  }
 }
 // Several distinct numeric ranges in one representation are ambiguous; identical repeats corroborate.
 const distinct=new Set(rules.map(r=>JSON.stringify(r.bounds)));
 if(distinct.size>1){for(const r of rules)result.push({type:'unsupported',code:'multiple-ranges',reason:'Multiple different age ranges; applicability is ambiguous.',blocking:true,span:r.span});return result;}
 // The remaining rules state the same bounds, so they are one rule: every cutoff stated anywhere in this
 // representation must agree, and a repeat without its own cutoff shares it.
 const candidates=[...rules.flatMap(r=>r.cutoff?[r.cutoff]:[]),...standaloneCutoffs],kinds=new Set(candidates.map(cutoffKey));
 const shared:CutoffWording|null=!candidates.length?null:kinds.size===1?candidates[0]:{kind:'unsupported',reason:'Conflicting age cutoff wording.',span:candidates[0].span};
 for(const rule of rules)result.push({...rule,cutoff:rule.cutoff&&kinds.size===1?rule.cutoff:shared});
 if(!rules.length)for(const cutoff of standaloneCutoffs)result.push({type:'unsupported',code:'cutoff-without-rule',reason:'Age cutoff wording without a supported age rule.',blocking:true,span:cutoff.span});
 return result;
}
// Source-local reference date for a single nonrecurring event. The Town publishes New York local times.
export function eventStartDate(event:any):{date:string}|{reason:string}{
 if(event.recurring)return {reason:'unsupported-recurrence'};
 if(event.start?.kind==='all-day'&&parseCivil(event.start.local?.slice(0,10)))return {date:event.start.local.slice(0,10)};
 if(event.start?.kind==='known'&&event.start.instant){
  if(event.start.zone==='UTC')return {date:civilDateIn(new Date(event.start.instant),'America/New_York')};
  if(parseCivil(event.start.local?.slice(0,10)))return {date:event.start.local.slice(0,10)};
 }
 return {reason:'unknown-start'};
}
export type NormalizedReference={kind:'cutoff';date:string}|{kind:'event-start';date:string;meeting:boolean}|{kind:'provisional-event-start';date:string}|{kind:'unresolved';reason:string};
export interface NormalizedRule {min:number|null;max:number|null;reference:NormalizedReference}
function normalizeReference(rule:RuleEvidence,event:any):NormalizedReference{
 const cutoff=rule.cutoff;
 if(cutoff?.kind==='date')return {kind:'cutoff',date:cutoff.date};
 if(cutoff?.kind==='unsupported')return {kind:'unresolved',reason:'unsupported-cutoff'};
 const start=eventStartDate(event);
 if(cutoff?.kind==='event-start')return 'date' in start?{kind:'event-start',date:start.date,meeting:cutoff.meeting}:{kind:'unresolved',reason:start.reason==='unsupported-recurrence'?'session-reference-unsupported':start.reason};
 return 'date' in start?{kind:'provisional-event-start',date:start.date}:{kind:'unresolved',reason:start.reason==='unsupported-recurrence'?'missing-cutoff-recurring':'missing-cutoff-unknown-start'};
}
export interface ProfileBasis {revisionId:string;feasible:Feasible|null}
interface Representation {part:string;event:any}
const representationsOf=(envelope:any):Representation[]=>(envelope.representations?.length?envelope.representations:[{part:'not recorded in this version',event:envelope.event}]).map((r:any)=>({part:r.part,event:r.event})).sort((a:Representation,b:Representation)=>a.part.localeCompare(b.part));
const stable=(rules:NormalizedRule[])=>[...new Map(rules.map(r=>[JSON.stringify(r),r])).values()].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
// Profile-independent material provider facts: applicable rule semantics, references, conflicts and the kinds of
// unresolved (potentially applicable) age wording. Quotes, formatting, representation order, audience hints,
// supervision clauses and non-age quantities are not material.
export function ageRuleFacts(envelope:any){
 const perPart=representationsOf(envelope).map(r=>({part:r.part,event:r.event,evidence:extractAgeEvidence(r.event)}));
 const withRules=perPart.map(p=>({...p,
  rules:stable(p.evidence.filter((e):e is RuleEvidence=>e.type==='rule').map(rule=>({min:rule.bounds.min,max:rule.bounds.max,reference:normalizeReference(rule,p.event)}))),
  unresolved:[...new Set(p.evidence.filter((e):e is UnsupportedEvidence=>e.type==='unsupported'&&e.blocking).map(e=>e.code))].sort()}));
 const applicable=stable(withRules.flatMap(p=>p.rules)),unresolved=[...new Set(withRules.flatMap(p=>p.unresolved))].sort();
 return {perPart:withRules,facts:{rules:applicable,conflict:applicable.length>1,unresolved}};
}
// Version-independent material semantics. Every comparison of a stored baseline, decision basis or Show anyway basis
// with a current assessment goes through these canonical forms, never through hashes of a particular serialization:
// fields are picked explicitly, so a stored structure from an older revision (e.g. facts without `unresolved`, a basis
// without a top-level `comparison`) or a future one with extra fields compares by meaning alone.
function canonicalReference(ref:any){
 switch(ref?.kind){
  case 'cutoff':return {kind:'cutoff',date:String(ref.date)};
  case 'event-start':return {kind:'event-start',date:String(ref.date),meeting:Boolean(ref.meeting)};
  case 'provisional-event-start':return {kind:'provisional-event-start',date:String(ref.date)};
  default:return {kind:String(ref?.kind??'unresolved'),reason:ref?.reason==null?null:String(ref.reason)};
 }
}
const byJson=(a:unknown,b:unknown)=>JSON.stringify(a).localeCompare(JSON.stringify(b));
export function canonicalAgeFacts(facts:any){
 const rules=(facts?.rules??[]).map((r:any)=>({min:r.min??null,max:r.max??null,reference:canonicalReference(r.reference)}));
 // A missing `unresolved` list (structures written before it existed) means no unresolved wording was recorded.
 return {rules:[...new Map(rules.map((r:any)=>[JSON.stringify(r),r])).values()].sort(byJson),conflict:Boolean(facts?.conflict),unresolved:[...new Set<string>((facts?.unresolved??[]).map(String))].sort()};
}
// Material outcome: canonical facts plus status and the comparison. The per-rule comparison is determined by these
// (only a single applicable rule is ever compared), so a stored basis lacking a top-level comparison derives it.
export function canonicalAgeOutcome(x:any){
 const comparison=x?.comparison!==undefined?x.comparison:x?.rules?.length===1?x.rules[0].comparison??null:null;
 return {...canonicalAgeFacts(x),status:String(x?.status),comparison:comparison??null};
}
export const ageMaterialKey=(x:any)=>JSON.stringify(canonicalAgeOutcome(x));
export interface AgeAssessment {
 algorithmRevision:string;extractorRevision:string;calendarParserRevision:string;sourceVersion:number;profileRevisionId:string;
 status:AgeStatus;comparison:'meets'|'outside'|'unknown'|null;explanation:string;
 rules:(NormalizedRule&{comparison:'meets'|'outside'|'unknown'|null;evidence:{part:string;representationHash:string;field:Field;quote:string;start:number;end:number;cutoff:CutoffWording|null}[]})[];
 possibleAges:{min:number;max:number;reference:string}|null;conflict:boolean;unresolved:string[];
 hints:(HintEvidence&{part:string;representationHash:string})[];supervision:(SupervisionEvidence&{part:string;representationHash:string})[];unsupported:(UnsupportedEvidence&{part:string;representationHash:string})[];
 corroboration:string[];identity:string;ruleSignature:string;outcomeSignature:string;
}
export function assessAge(envelope:any,context:{sourceVersion:number;calendarParserRevision:string;profile:ProfileBasis;hash:(value:string)=>string}):AgeAssessment{
 const {perPart,facts}=ageRuleFacts(envelope),hash=context.hash;
 const repHash=new Map(perPart.map(p=>[p.part,hash(JSON.stringify(p.event))]));
 const tagged=<T extends AgeEvidence>(type:T['type'])=>perPart.flatMap(p=>p.evidence.filter(e=>e.type===type).map(e=>({...(e as T),part:p.part,representationHash:repHash.get(p.part)!})));
 const rules=facts.rules.map(rule=>({...rule,comparison:null as 'meets'|'outside'|'unknown'|null,evidence:perPart.flatMap(p=>p.rules.some(r=>JSON.stringify(r)===JSON.stringify(rule))?p.evidence.filter((e):e is RuleEvidence=>e.type==='rule'&&e.bounds.min===rule.min&&e.bounds.max===rule.max).map(e=>({part:p.part,representationHash:repHash.get(p.part)!,...e.span,cutoff:e.cutoff})):[])}));
 // Only a feed with no rule and no unresolved age wording is silent; ambiguous wording is not silence.
 const silent=perPart.filter(p=>!p.rules.length&&!p.unresolved.length).map(p=>p.part);
 const corroboration=facts.rules.length&&silent.length?[`No age rule or age wording in ${silent.join(', ')}; silence is incomplete corroboration, not contradiction or endorsement.`]:[];
 let status:AgeStatus,comparison:'meets'|'outside'|'unknown'|null=null,explanation:string,ages:AgeAssessment['possibleAges']=null;
 if(!rules.length&&!facts.unresolved.length){
  status='no-rule';explanation='No provider age rule or age wording found; provider eligibility is unverified.';
 }else if(!rules.length){
  status='unknown';explanation='Age wording is present but unsupported or ambiguous; provider eligibility needs checking.';
 }else if(facts.conflict){
  status='unknown';explanation='Applicable age rules or references disagree; needs checking.';
 }else if(facts.unresolved.length){
  // Unresolved age wording anywhere in the listing may qualify or contradict the supported rule.
  status='unknown';explanation='Other age wording in this listing is unsupported, negated, qualified or ambiguous, so the stated rule cannot be confirmed; needs checking.';
 }else{
  const rule=rules[0],ref=rule.reference;
  if(ref.kind==='unresolved'){
   status='unknown';
   explanation={'unsupported-cutoff':'The stated cutoff date is unsupported or ambiguous.','session-reference-unsupported':'The age reference is a session or meeting of an unsupported recurring program; it stays unknown.','missing-cutoff-recurring':'No cutoff is stated and recurring sessions are unsupported; no reference date is invented.','missing-cutoff-unknown-start':'No cutoff is stated and the event start date is unknown.'}[ref.reason]??'Age reference date is unknown.';
  }else{
   const range=context.profile.feasible?possibleAges(context.profile.feasible,ref.date):null;
   comparison=range?compareBounds(rule,range):'unknown';rule.comparison=comparison;
   if(range)ages={...range,reference:ref.date};
   if(ref.kind==='provisional-event-start'){
    status='provisional';
    explanation=`No cutoff is stated. Provisional comparison at the event start (${ref.date}) only: ${comparison==='meets'?'within':comparison==='outside'?'outside':'overlaps or unknown for'} the stated range. Never a confirmation.`;
   }else{
    status=comparison;
    explanation=!range?'Age profile is unknown; the stated rule cannot be compared.':comparison==='meets'?'Every feasible age meets this one stated provider age rule. This is not overall eligibility.':comparison==='outside'?'Every feasible age is outside this stated provider age rule.':'Possible ages overlap the boundary; needs checking.';
   }
  }
 }
 const identity=hash(JSON.stringify({algorithm:AGE_ASSESSMENT_REVISION,extractor:AGE_EXTRACTOR_REVISION,parser:context.calendarParserRevision,sourceVersion:context.sourceVersion,representations:[...repHash.entries()],profile:context.profile.revisionId,references:facts.rules.map(r=>r.reference)}));
 return {algorithmRevision:AGE_ASSESSMENT_REVISION,extractorRevision:AGE_EXTRACTOR_REVISION,calendarParserRevision:context.calendarParserRevision,sourceVersion:context.sourceVersion,profileRevisionId:context.profile.revisionId,status,comparison,explanation,rules,possibleAges:ages,conflict:facts.conflict,unresolved:facts.unresolved,hints:tagged<HintEvidence>('hint'),supervision:tagged<SupervisionEvidence>('supervision'),unsupported:tagged<UnsupportedEvidence>('unsupported'),corroboration,identity,ruleSignature:hash(JSON.stringify(canonicalAgeFacts(facts))),outcomeSignature:hash(ageMaterialKey({...facts,status,comparison}))};
}
export function describeBounds(rule:{min:number|null;max:number|null}){
 return rule.min!==null&&rule.max!==null?`ages ${rule.min}–${rule.max}`:rule.min!==null?`age ${rule.min} or older`:rule.max!==null?`age ${rule.max} or younger`:'unbounded';
}
export function describeReference(ref:NormalizedReference){
 return ref.kind==='cutoff'?`age as of stated cutoff ${ref.date}`:ref.kind==='event-start'?`age on the stated ${ref.meeting?'first meeting':'event'} date ${ref.date}`:ref.kind==='provisional-event-start'?`no cutoff stated; provisional at event start ${ref.date}`:'reference date unknown';
}
