import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parseCalendar,assess,defaults} from '../src/domain.ts';
import {validateProfile} from '../src/age.ts';
import {extractAgeEvidence,assessAge,ageRuleFacts,eventStartDate,type RuleEvidence} from '../src/ageEvidence.ts';
// Wholly synthetic listings and profiles; public fixtures are used only for the wording measurement.
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const event=(description:string,patch:any={})=>({title:'Synthetic program',description,recurring:false,status:'confirmed',start:{kind:'known',local:'2080-06-05T11:00:00',instant:'2080-06-05T15:00:00.000Z',zone:'America/New_York'},end:{kind:'unknown',local:null,instant:null,zone:null},...patch});
const one=(e:any)=>({event:e,representations:[{part:'prcr',event:e}]});
const profile=(input:any,anchor='2079-01-01',revisionId='synthetic-r1')=>({revisionId,feasible:validateProfile(input,anchor).feasible});
const unknown={revisionId:'synthetic-unknown',feasible:null};
const run=(envelope:any,p:any=unknown)=>assessAge(envelope,{sourceVersion:1,calendarParserRevision:'synthetic',profile:p,hash});
const rules=(text:string)=>extractAgeEvidence({title:'',description:text}).filter((e):e is RuleEvidence=>e.type==='rule');
const types=(text:string)=>extractAgeEvidence({title:'',description:text}).map(e=>e.type==='hint'?`hint:${e.hint}`:e.type);
test('supported participant grammar yields inclusive/exclusive completed-year bounds with exact quote spans and cutoffs',()=>{
 const text='Ages 7-10 as of September 1, 2080. Bring water.';
 const [r]=rules(text);
 assert.deepEqual(r.bounds,{min:7,max:10});assert.equal(text.slice(r.span.start,r.span.end),r.span.quote);assert.equal(r.span.quote,'Ages 7-10');
 assert.deepEqual(r.cutoff&&{kind:r.cutoff.kind,date:(r.cutoff as any).date,quote:r.cutoff.span.quote},{kind:'date',date:'2080-09-01',quote:'September 1, 2080'});
 assert.deepEqual(rules('Ages 5 and up.')[0].bounds,{min:5,max:null});
 assert.deepEqual(rules('Ages 5+ welcome.')[0].bounds,{min:5,max:null});
 assert.deepEqual(rules('Ages 12 and under.')[0].bounds,{min:null,max:12});
 assert.deepEqual(rules('For 6-9 year olds.')[0].bounds,{min:6,max:9});
 assert.deepEqual(rules('Participants must be at least 13 years old by 2080-05-01.')[0].bounds,{min:13,max:null});
 assert.equal((rules('Participants must be at least 13 years old by 2080-05-01.')[0].cutoff as any).date,'2080-05-01');
 const under=rules('Open to children under 8.')[0];assert.deepEqual(under.bounds,{min:null,max:7});assert.equal(under.exclusiveUpper,true);
 assert.equal((rules('Ages 6-9. Age as of Sept. 1, 2080.')[0].cutoff as any).date,'2080-09-01');
 assert.deepEqual(rules('Ages 6-9 on the day of the event.')[0].cutoff?.kind,'event-start');
});
test('isolated N+, ambiguous roles, units, grades, prices, ranges and dates stay unsupported with raw wording retained',()=>{
 for(const text of ['Great for 5+.','Volunteers ages 14 and up needed.','Ages 18 months to 3 years.','Grades K-5.','Kids ages 3-12: $5.','Ages 3-5 and ages 6-8.','Parents and children ages 2-4.','Over 5 kids per table.','Ages 9-6.']){
  const evidence=extractAgeEvidence({title:'',description:text});
  assert.equal(evidence.some(e=>e.type==='rule'),false,text);assert.ok(evidence.some(e=>e.type==='unsupported'),text);
  for(const e of evidence)assert.equal(text.slice(e.span.start,e.span.end),e.span.quote);
 }
 assert.equal((rules('Ages 7-10 as of 9/1/2080.')[0].cutoff as any).kind,'unsupported');
 assert.match((rules('Ages 7-10 as of September 1.')[0].cutoff as any).reason,/no year/);
 assert.match((rules('Ages 7-10 as of September 1, 2080. Age as of August 1, 2080.')[0].cutoff as any).reason,/Conflicting/);
 assert.equal(types('Adults only.').includes('rule'),false);
});
test('supervision clauses never become participant bounds or adults-only; audience hints carry no numbers',()=>{
 assert.deepEqual(types('Children under 8 must be accompanied by an adult.').sort(),['hint:children','supervision','supervision']);
 const accompanied=extractAgeEvidence({title:'',description:'Ages 2-5 with a parent.'});
 assert.deepEqual(accompanied.map(e=>e.type).sort(),['rule','supervision']);
 assert.deepEqual(types('For children under 8, must be accompanied by an adult.').includes('rule'),false);
 assert.deepEqual(types('Fun for all ages! Family-friendly. Teen night and preschool story time.').sort(),['hint:all-ages','hint:family','hint:preschool','hint:teen']);
 const a=run(one(event('Fun for all ages!')),profile({kind:'age-as-of',age:7,asOf:'2079-01-01'}));
 assert.equal(a.status,'no-rule');assert.equal(a.rules.length,0);assert.equal(a.hints[0].hint,'all-ages');
 // A hint never admits or excludes.
 assert.equal(assess(event('x') as any,defaults,new Date('2079-01-02'),false,a).rules.find(r=>r.name==='Age')!.result,'unknown');
 const sup=run(one(event('Children under 8 must be accompanied by an adult.')),profile({kind:'age-as-of',age:3,asOf:'2079-01-01'}));
 assert.equal(sup.status,'no-rule');assert.equal(sup.supervision.length,2);
});
test('assessment: confirmed meets/outside only with a supported cutoff; missing cutoff is provisional even far outside; unknown profile stays valid',()=>{
 const withCutoff=one(event('Ages 7-10 as of September 1, 2080.'));
 const born=(b:string)=>profile({kind:'birth-date',birthDate:b});
 assert.equal(run(withCutoff,born('2073-09-01')).status,'meets');
 assert.equal(run(withCutoff,born('2073-09-02')).status,'outside');
 assert.equal(run(withCutoff,unknown).status,'unknown');
 assert.equal(run(withCutoff,profile({kind:'birth-year',year:2073})).status,'unknown');
 const outside=run(withCutoff,born('2073-09-02'));
 assert.equal(assess(event('') as any,defaults,new Date('2079-01-02'),false,outside).rules.find(r=>r.name==='Age')!.result,'fail');
 assert.equal(assess(event('') as any,defaults,new Date('2079-01-02'),false,run(withCutoff,born('2073-09-01'))).verdict,'needs checking');
 const missing=run(one(event('Ages 3-5.')),profile({kind:'age-as-of',age:20,asOf:'2079-01-01'}));
 assert.equal(missing.status,'provisional');assert.equal(missing.comparison,'outside');assert.match(missing.explanation,/Never a confirmation/);
 assert.equal(assess(event('') as any,defaults,new Date('2079-01-02'),false,missing).rules.find(r=>r.name==='Age')!.result,'unknown');
 assert.equal(missing.rules[0].reference.kind,'provisional-event-start');
 const eventStart=run(one(event('Ages 6-9 on the day of the event.')),born('2071-06-05'));
 assert.equal(eventStart.status,'meets');assert.equal((eventStart.rules[0].reference as any).date,'2080-06-05');
 assert.equal(run(one(event('Ages 6-9 on the day of the event.')),born('2071-06-06')).status,'meets');
 assert.equal(run(one(event('Ages 6-9 on the day of the event.')),born('2074-06-06')).status,'outside');
});
test('recurrence: a program-wide fixed cutoff compares only the stated rule; session/first-meeting/missing references stay unknown',()=>{
 const recurring=(d:string)=>one(event(d,{recurring:true}));
 const p=profile({kind:'birth-date',birthDate:'2069-01-01'});
 const fixed=run(recurring('Ages 7-10 as of September 1, 2080.'),p);
 assert.equal(fixed.status,'outside');assert.match(fixed.explanation,/stated provider age rule/);
 // Attendance and sessions remain unknown in the general rules.
 const rules=assess(event('',{recurring:true}) as any,defaults,new Date('2079-01-02'),false,fixed).rules;
 assert.equal(rules.find(r=>r.name==='Session dates')!.result,'unknown');assert.equal(rules.find(r=>r.name==='Attendance')!.result,'unknown');
 assert.equal(run(recurring('Ages 7-10 as of the first day of class.'),p).status,'unknown');
 assert.equal(run(recurring('Ages 7-10.'),p).status,'unknown');
 assert.match(run(recurring('Ages 7-10.'),p).explanation,/no reference date is invented/);
});
test('representations: equivalent quotes corroborate, silence is incomplete corroboration, contradictory rules/cutoffs stay unknown',()=>{
 const a=event('Ages 7–10 as of September 1, 2080.'),b={...event('Join us: ages 7 to 10 as of Sep 1, 2080'),title:'Ages 7-10 program'},silent=event('An evening program.');
 const p=profile({kind:'birth-date',birthDate:'2073-09-01'});
 const same=run({event:a,representations:[{part:'prcr',event:a},{part:'arts',event:b}]},p);
 assert.equal(same.status,'meets');assert.equal(same.conflict,false);assert.equal(same.rules[0].evidence.length,3);
 const quiet=run({event:a,representations:[{part:'prcr',event:a},{part:'arts',event:silent}]},p);
 assert.equal(quiet.status,'meets');assert.match(quiet.corroboration[0],/incomplete corroboration, not contradiction/);
 const other=event('Ages 8-10 as of September 1, 2080.');
 const conflict=run({event:a,representations:[{part:'prcr',event:a},{part:'arts',event:other}]},p);
 assert.equal(conflict.status,'unknown');assert.equal(conflict.conflict,true);
 const otherCutoff=event('Ages 7-10 as of August 1, 2080.');
 assert.equal(run({event:a,representations:[{part:'prcr',event:a},{part:'arts',event:otherCutoff}]},p).status,'unknown');
 // Display ordering establishes no authority: swapping representations gives the same material result.
 assert.equal(run({event:other,representations:[{part:'arts',event:other},{part:'prcr',event:a}]},p).outcomeSignature,conflict.outcomeSignature);
});
test('material signatures: wording/precision-only changes are stable; rule/reference changes differ even when still outside; audit identity keeps revisions',()=>{
 const v1=one(event('Ages 7-10 as of September 1, 2080.')),reworded=one(event('Join us! ages 7 to 10, as of Sep 1, 2080'));
 const asOf=profile({kind:'age-as-of',age:2,asOf:'2079-01-01'},'2079-01-01','synthetic-a'),exact=profile({kind:'birth-date',birthDate:'2076-06-01'},'2079-01-01','synthetic-b');
 const x=run(v1,asOf),y=run(v1,exact),z=run(reworded,asOf);
 assert.equal(x.status,'outside');assert.equal(y.status,'outside');
 assert.equal(x.outcomeSignature,y.outcomeSignature);assert.notEqual(x.identity,y.identity);
 assert.equal(x.ruleSignature,z.ruleSignature);assert.equal(x.outcomeSignature,z.outcomeSignature);
 const changed=run(one(event('Ages 8-10 as of September 1, 2080.')),asOf);
 assert.equal(changed.status,'outside');assert.notEqual(changed.ruleSignature,x.ruleSignature);assert.notEqual(changed.outcomeSignature,x.outcomeSignature);
 const cutoffMoved=run(one(event('Ages 7-10 as of October 1, 2080.')),asOf);
 assert.notEqual(cutoffMoved.ruleSignature,x.ruleSignature);
 // Profile-independent facts ignore the profile entirely.
 assert.deepEqual(ageRuleFacts(v1).facts,ageRuleFacts(reworded).facts);
 const json=JSON.stringify(y);assert.equal(json.includes('2076-06-01'),false);
});
test('source-local reference dates: UTC instants use the New York date; unknown or recurring starts are unsupported',()=>{
 assert.deepEqual(eventStartDate({recurring:false,start:{kind:'known',local:'2080-11-01T03:30:00Z',instant:'2080-11-01T03:30:00.000Z',zone:'UTC'}}),{date:'2080-10-31'});
 assert.deepEqual(eventStartDate({recurring:false,start:{kind:'all-day',local:'2080-06-05',instant:null,zone:null}}),{date:'2080-06-05'});
 assert.deepEqual(eventStartDate({recurring:false,start:{kind:'unknown',local:'2080-06-05T10:00:00',instant:null,zone:null}}),{reason:'unknown-start'});
 assert.deepEqual(eventStartDate({recurring:true,start:{kind:'all-day',local:'2080-06-05',instant:null,zone:null}}),{reason:'unsupported-recurrence'});
});
test('AGE-010 measurement: archived and current PUBLIC Town feeds contain no executable age rule, hint, supervision or unsupported age wording',()=>{
 const counts={events:0,withEvidence:0,rule:0,hint:0,supervision:0,unsupported:0};
 for(const part of ['prcr','arts','current-prcr','current-arts']){
  for(const e of parseCalendar(readFileSync(new URL(`../fixtures/${part}.ics`,import.meta.url),'utf8')).events){
   counts.events++;const evidence=extractAgeEvidence(e);if(evidence.length)counts.withEvidence++;
   for(const x of evidence)counts[x.type]++;
  }
 }
 assert.deepEqual(counts,{events:54,withEvidence:0,rule:0,hint:0,supervision:0,unsupported:0});
});
test('AGE-REVIEW-001: negated, excluding and qualified participant clauses never execute; the whole clause is retained',()=>{
 const p=profile({kind:'birth-date',birthDate:'2073-09-01'});
 for(const [text,code] of [['Not for ages 7-10 as of September 1, 2080.','negated'],['Ages 7-10 may not attend.','negated'],['Open to ages 7-10 except returning campers.','negated'],['No ages 7-10 this session.','negated'],['Recommended for ages 7-10.','qualified'],['Best for ages 7-10.','qualified'],['Ages 7-10 suggested.','qualified']] as const){
  const evidence=extractAgeEvidence({title:'',description:text});
  assert.equal(evidence.some(e=>e.type==='rule'),false,text);
  const u=evidence.find(e=>e.type==='unsupported') as any;assert.equal(u.code,code,text);assert.equal(u.blocking,true);
  assert.equal(u.span.quote,text,text);assert.equal(text.slice(u.span.start,u.span.end),u.span.quote);
  const a=run(one(event(text)),p);assert.equal(a.status,'unknown',text);assert.notEqual(assess(event('') as any,defaults,new Date('2079-01-02'),false,a).rules.find(r=>r.name==='Age')!.result,'fail');
 }
 // Positive controls stay executable.
 assert.equal(run(one(event('Ages 7-10 as of September 1, 2080.')),p).status,'meets');
 assert.equal(run(one(event('Ages 7-10 as of September 1, 2080. No experience needed.')),p).status,'meets');
});
test('AGE-ROOT-005: non-age quantities never become age rules; true completed-year minimums still do',()=>{
 const seven=profile({kind:'birth-date',birthDate:'2073-01-01'});
 const tall=run(one(event('Participants must be at least 8 feet tall. Age cutoff: October 10, 2080.')),seven);
 assert.equal(tall.rules.length,0);assert.equal(tall.status,'unknown');
 assert.equal(rules('Must be at least 2 inches tall.').length,0);
 assert.equal(rules('Kids must be at least 48 inches tall.').length,0);
 const height=extractAgeEvidence({title:'',description:'For children under 48 inches.'});
 assert.equal(height.some(e=>e.type==='rule'),false);assert.deepEqual(height.filter(e=>e.type==='unsupported').map((e:any)=>[e.code,e.blocking]),[['non-age-quantity',false]]);
 assert.deepEqual(rules('Participants must be at least 8 years old.')[0].bounds,{min:8,max:null});
 assert.deepEqual(rules('Participants must be at least 8 years of age.')[0].bounds,{min:8,max:null});
 assert.deepEqual(rules('Participants must be at least age 8.')[0].bounds,{min:8,max:null});
 assert.deepEqual(rules('Must be 13 years or older.')[0].bounds,{min:13,max:null});
 // A non-age quantity next to a supported rule neither blocks it nor changes its material facts.
 const fine=one(event('Ages 7-10 as of September 1, 2080. Children must be at least 48 inches tall.'));
 assert.equal(run(fine,profile({kind:'birth-date',birthDate:'2073-09-01'})).status,'meets');
 assert.equal(run(fine,unknown).ruleSignature,run(one(event('Ages 7-10 as of September 1, 2080.')),unknown).ruleSignature);
});
test('AGE-REVIEW-002: unresolved applicable age wording in the same or another feed blocks confirmation and is material; hints stay separate',()=>{
 const p=profile({kind:'birth-date',birthDate:'2073-09-01'});
 const plain=event('Ages 7-10 as of September 1, 2080.'),ambiguous=event('Ages 3-5 and ages 6-8 as of September 1, 2080.');
 const agreeing=run({event:plain,representations:[{part:'prcr',event:plain},{part:'arts',event:plain}]},p);
 const split=run({event:plain,representations:[{part:'prcr',event:plain},{part:'arts',event:ambiguous}]},p);
 assert.equal(agreeing.status,'meets');
 assert.equal(split.status,'unknown');assert.deepEqual(split.unresolved,['multiple-ranges']);assert.equal(split.corroboration.length,0);
 assert.notEqual(split.ruleSignature,agreeing.ruleSignature);assert.notEqual(split.outcomeSignature,agreeing.outcomeSignature);
 assert.equal(run({event:plain,representations:[{part:'prcr',event:plain},{part:'arts',event:ambiguous}]},profile({kind:'birth-date',birthDate:'2075-01-01'})).status,'unknown');
 const qualified=run(one(event('Ages 7-10 as of September 1, 2080. Children older than 8 may not attend.')),p);
 assert.equal(qualified.status,'unknown');assert.match(qualified.explanation,/cannot be confirmed/);assert.ok(qualified.unresolved.includes('older-than'));
 // Unresolved wording without a supported rule is not "no rule".
 assert.equal(run(one(event('Great for 5+.')),p).status,'unknown');
 // Audience hints, supervision and truly absent wording do not block or alter material facts.
 const hinted=run(one(event('Ages 7-10 as of September 1, 2080. Family-friendly fun for all ages.')),p);
 assert.equal(hinted.status,'meets');assert.equal(hinted.ruleSignature,run(one(plain),p).ruleSignature);assert.equal(hinted.hints.length,2);
 assert.equal(run(one(event('Ages 7-10 as of September 1, 2080. Children under 8 must be accompanied by an adult.')),p).status,'meets');
 assert.equal(run(one(event('An evening program.')),p).status,'no-rule');
});
