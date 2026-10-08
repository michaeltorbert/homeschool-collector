import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dayNumber,fromDayNumber,formatCivil,parseCivil,completedYears,validateProfile,possibleAges,compareBounds,civilDateIn,ProfileError} from '../src/age.ts';
// All profiles, birthdays and anchors here are wholly synthetic test values.
const c=(s:string)=>parseCivil(s)!;
test('date-only civil arithmetic matches the proleptic Gregorian calendar across leap centuries',()=>{
 for(let n=dayNumber(c('1899-12-25'));n<dayNumber(c('2101-03-05'));n+=1){const civil=fromDayNumber(n);assert.equal(dayNumber(civil),n);assert.equal(formatCivil(civil),new Date(n*86400000).toISOString().slice(0,10));}
 assert.equal(parseCivil('1900-02-29'),null);assert.equal(parseCivil('2100-02-29'),null);assert.ok(parseCivil('2000-02-29'));assert.equal(parseCivil('2023-02-29'),null);assert.equal(parseCivil('2026-13-01'),null);assert.equal(parseCivil('2026-1-01'),null);
});
test('completed years on, the day before and the day after a birthday; February 29 anniversaries keep both interpretations',()=>{
 assert.deepEqual(completedYears(c('2019-09-01'),c('2026-09-01')),[7]);
 assert.deepEqual(completedYears(c('2019-09-01'),c('2026-08-31')),[6]);
 assert.deepEqual(completedYears(c('2019-09-01'),c('2026-09-02')),[7]);
 assert.deepEqual(completedYears(c('2020-02-29'),c('2026-02-28')),[5,6]);
 assert.deepEqual(completedYears(c('2020-02-29'),c('2026-03-01')),[6]);
 assert.deepEqual(completedYears(c('2020-02-29'),c('2028-02-29')),[8]);
 assert.deepEqual(completedYears(c('2020-02-29'),c('2028-02-28')),[7]);
 // 2100 is not a leap year; 2000 was.
 assert.deepEqual(completedYears(c('2096-02-29'),c('2100-02-28')),[3,4]);
 assert.deepEqual(completedYears(c('1996-02-29'),c('2000-02-28')),[3]);
});
test('profile validation: discriminated fields, unsupported kinds/extra fields, impossible and future dates, product domain',()=>{
 const anchor='2026-10-07';
 assert.deepEqual(validateProfile({kind:'unknown'},anchor),{profile:{kind:'unknown'},feasible:null});
 const bad:[unknown,RegExp][]=[
  [null,/Choose/],[[],/Choose/],[{kind:'grade',grade:2},/Unsupported age description/],[{kind:'unknown',name:'Synthetic'},/Unsupported profile field: name/],
  [{kind:'birth-date',birthDate:'2019-02-29'},/real calendar date/],[{kind:'birth-date',birthDate:'2026-10-08'},/after 2026-10-07/],[{kind:'birth-date'},/Required: birthDate/],
  [{kind:'birth-month',year:2026,month:11},/after 2026-10-07/],[{kind:'birth-month',year:2019,month:13},/1 to 12/],[{kind:'birth-year',year:'2019'},/four-digit/],
  [{kind:'age-as-of',age:26,asOf:'2026-01-01'},/0 to 25/],[{kind:'age-as-of',age:7.5,asOf:'2026-01-01'},/whole completed years/],[{kind:'age-as-of',age:'7',asOf:'2026-01-01'},/whole/],
  [{kind:'age-as-of',age:7,asOf:'2026-10-08'},/as-of date cannot be after 2026-10-07/],[{kind:'age-as-of',age:7,asOf:'10/01/2026'},/real as-of date/],
  [{kind:'birth-year',year:1990},/children aged 0–25/],[{kind:'age-as-of',age:25,asOf:'2010-01-01'},/children aged 0–25/],[{kind:'birth-date',birthDate:'2019-01-01',extra:true},/extra/],
 ];
 for(const [input,message] of bad)assert.throws(()=>validateProfile(input,anchor),(e:any)=>e instanceof ProfileError&&message.test(e.message));
 // A birth year straddling the domain edge is accepted: some feasible birthdays are within 0–25 at the anchor.
 assert.ok(validateProfile({kind:'birth-year',year:2001},anchor).feasible);
});
test('age-as-of inverse is a feasible birthday interval, including leap boundaries; month/year truncate at the immutable anchor',()=>{
 assert.deepEqual(validateProfile({kind:'age-as-of',age:7,asOf:'2026-03-15'},'2026-10-07').feasible,{earliest:'2018-03-16',latest:'2019-03-15'});
 assert.deepEqual(validateProfile({kind:'age-as-of',age:0,asOf:'2024-02-29'},'2024-03-01').feasible,{earliest:'2023-03-01',latest:'2024-02-29'});
 // As of 2025-02-28 a February 29, 2024 birthday may be 0 or 1, so it remains feasible for "1".
 assert.deepEqual(validateProfile({kind:'age-as-of',age:1,asOf:'2025-02-28'},'2025-03-01').feasible,{earliest:'2023-03-01',latest:'2024-02-29'});
 assert.deepEqual(validateProfile({kind:'age-as-of',age:0,asOf:'2026-10-07'},'2026-10-07').feasible,{earliest:'2025-10-08',latest:'2026-10-07'});
 assert.deepEqual(validateProfile({kind:'birth-month',year:2026,month:10},'2026-10-07').feasible,{earliest:'2026-10-01',latest:'2026-10-07'});
 assert.deepEqual(validateProfile({kind:'birth-year',year:2026},'2026-10-07').feasible,{earliest:'2026-01-01',latest:'2026-10-07'});
 assert.deepEqual(validateProfile({kind:'birth-month',year:2020,month:2},'2026-10-07').feasible,{earliest:'2020-02-01',latest:'2020-02-29'});
 // The same revision evaluated against a fixed reference never depends on the later evaluation day.
 const feasible=validateProfile({kind:'birth-month',year:2026,month:10},'2026-10-07').feasible!;
 assert.deepEqual(possibleAges(feasible,'2031-09-01'),{min:4,max:4});
});
test('rule comparison: inclusive and exclusive cutoffs on/before/after, month/year wholly in, out and overlapping',()=>{
 const exact=(b:string)=>validateProfile({kind:'birth-date',birthDate:b},'2026-10-07').feasible!;
 const at=(b:string,bounds:{min:number|null;max:number|null},ref='2026-09-01')=>compareBounds(bounds,possibleAges(exact(b),ref)!);
 assert.equal(at('2019-09-01',{min:7,max:10}),'meets');
 assert.equal(at('2019-09-02',{min:7,max:10}),'outside');
 assert.equal(at('2019-08-31',{min:7,max:10}),'meets');
 // "Under 7" is exclusive: completed years at most 6.
 assert.equal(at('2019-09-01',{min:null,max:6}),'outside');
 assert.equal(at('2019-09-02',{min:null,max:6}),'meets');
 assert.equal(at('2016-09-02',{min:7,max:9}),'meets');assert.equal(at('2016-09-01',{min:7,max:9}),'outside');
 // February 29 child at a February 28 common-year cutoff: interpretations disagree, so no confirmation.
 assert.equal(at('2020-02-29',{min:6,max:null},'2026-02-28'),'unknown');
 assert.equal(at('2020-02-29',{min:6,max:null},'2026-03-01'),'meets');
 assert.equal(at('2020-02-29',{min:null,max:5},'2026-02-28'),'unknown');
 const month=validateProfile({kind:'birth-month',year:2019,month:9},'2026-10-07').feasible!,ages=possibleAges(month,'2026-09-15')!;
 assert.deepEqual(ages,{min:6,max:7});
 assert.equal(compareBounds({min:5,max:8},ages),'meets');assert.equal(compareBounds({min:9,max:12},ages),'outside');assert.equal(compareBounds({min:7,max:null},ages),'unknown');
 // Age-at-fixed-future-cutoff does not change as today's birthday passes: there is no "today" input at all.
 const asOf=validateProfile({kind:'age-as-of',age:6,asOf:'2026-01-10'},'2026-01-10').feasible!;
 assert.deepEqual(possibleAges(asOf,'2027-09-01'),{min:7,max:8});
});
test('New York anchor dates are host-timezone independent (two timezone subprocesses)',()=>{
 const helper=fileURLToPath(new URL('./helpers/age-timezone.ts',import.meta.url));
 const run=(tz:string)=>JSON.parse(execFileSync(process.execPath,['--import','tsx',helper],{env:{...process.env,TZ:tz},encoding:'utf8'}));
 const east=run('Pacific/Kiritimati'),west=run('Pacific/Pago_Pago');
 assert.notEqual(east.hostDate,west.hostDate);
 assert.deepEqual(east.result,west.result);
 // 03:30Z on Nov 1 is still Oct 31 in New York; the DST fall-back and spring-forward hours keep their New York dates.
 assert.deepEqual(east.result.anchors,['2026-10-31','2026-11-01','2026-03-08']);
 assert.deepEqual(east.result.eventDates,['2026-10-31','2026-11-01']);
 assert.equal(east.result.status,'meets');
 assert.equal(civilDateIn(new Date('2026-11-01T03:30:00Z')),'2026-10-31');
});
