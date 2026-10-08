import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {hash} from '../server/store.ts';
import {measureResponse,documentOrder,outcomeOf,compareMaps,overlap,EVIDENCE_REVISION} from '../src/sourceEvidence.ts';
// SYNTHETIC calendars plus the dated public fixtures already in the repository; no network.
const cal=(...events:string[])=>`BEGIN:VCALENDAR\nVERSION:2.0\n${events.join('\n')}\nEND:VCALENDAR`;
const ev=(uid:string,start:string,extra='')=>`BEGIN:VEVENT\nUID:${uid}\nSUMMARY:Event ${uid}\nDTSTART${start}\n${extra}END:VEVENT`;
const fixture=(name:string)=>readFileSync(new URL(`../fixtures/${name}.ics`,import.meta.url),'utf8');
test('counts balance: returned = accepted + parser rejects + duplicates; same title with different UID stays distinct',()=>{
 const body=cal(ev('a',':20261205T150000Z'),ev('a',':20261206T150000Z'),ev('b',':20261207T150000Z').replace('Event b','Event a'),'BEGIN:VEVENT\nSUMMARY:No uid\nDTSTART:20261205T150000Z\nEND:VEVENT',ev('r',':20261208T150000Z','RECURRENCE-ID:20261208T150000Z\n'));
 const {measurement:m,uidMap}=measureResponse(body,hash);
 assert.equal(m.revision,EVIDENCE_REVISION);
 assert.deepEqual([m.returned,m.accepted,m.parserRejects,m.duplicates],[5,2,2,1]);
 assert.equal(m.returned,m.accepted+m.parserRejects+m.duplicates);
 assert.deepEqual(Object.keys(uidMap),['town:fuquay-varina:a','town:fuquay-varina:b']);
 assert.equal(outcomeOf(m),'partial');
 // The first representation is the accepted one, matching ingestion.
 assert.equal(m.knownStarts.earliest,'2026-12-05T15:00:00.000Z');assert.equal(m.knownStarts.latest,'2026-12-07T15:00:00.000Z');
});
test('known instants, all-day dates, unknown times and recurring masters are measured separately; DST zones resolve to instants',()=>{
 const tz='BEGIN:VTIMEZONE\nTZID:America/New_York\nBEGIN:DAYLIGHT\nTZOFFSETFROM:-0500\nTZOFFSETTO:-0400\nDTSTART:19700308T020000\nRRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU\nEND:DAYLIGHT\nBEGIN:STANDARD\nTZOFFSETFROM:-0400\nTZOFFSETTO:-0500\nDTSTART:19701101T020000\nRRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU\nEND:STANDARD\nEND:VTIMEZONE';
 const body=`BEGIN:VCALENDAR\nVERSION:2.0\n${tz}\n${[ev('summer',';TZID=America/New_York:20261031T100000'),ev('winter',';TZID=America/New_York:20261102T100000'),ev('day',';VALUE=DATE:20261225','DTEND;VALUE=DATE:20261226\n'),ev('day2',';VALUE=DATE:20261224'),ev('floating',':20261205T100000'),ev('repeat',':20261210T150000Z','RRULE:FREQ=WEEKLY;COUNT=3\n')].join('\n')}\nEND:VCALENDAR`;
 const {measurement:m}=measureResponse(body,hash);
 assert.deepEqual(m.knownStarts,{count:3,earliest:'2026-10-31T14:00:00.000Z',latest:'2026-12-10T15:00:00.000Z'});
 assert.deepEqual(m.allDayStarts,{count:2,earliest:'2026-12-24',latest:'2026-12-25'});
 assert.equal(m.unknownTime,1);assert.equal(m.recurringMasters,1);
 // Only the known-start subsequence is ordered; all-day and unknown entries are excluded.
 assert.equal(m.order,'ascending');
 assert.equal(m.returned,m.accepted+m.parserRejects+m.duplicates);
});
test('document order: n/a for zero, one or equal starts; ascending/descending need one unequal pair; otherwise unsorted',()=>{
 assert.equal(documentOrder([]),'n/a');assert.equal(documentOrder([5]),'n/a');assert.equal(documentOrder([5,5,5]),'n/a');
 assert.equal(documentOrder([1,1,2]),'ascending');assert.equal(documentOrder([3,3,1]),'descending');assert.equal(documentOrder([1,3,2]),'unsorted');
});
test('empty, all-rejected and malformed responses: empty is a successful empty outcome, all-rejected is partial, malformed throws',()=>{
 const empty=measureResponse(cal(),hash).measurement;
 assert.deepEqual([empty.returned,empty.accepted,empty.order,outcomeOf(empty)],[0,0,'n/a','empty']);
 const rejected=measureResponse(cal('BEGIN:VEVENT\nSUMMARY:x\nEND:VEVENT'),hash).measurement;
 assert.deepEqual([rejected.returned,rejected.accepted,rejected.parserRejects,outcomeOf(rejected)],[1,0,1,'partial']);
 assert.throws(()=>measureResponse('<html>Access denied</html>',hash),/not a complete calendar/);
});
test('semantic hashes follow the existing canonicalizer; comparisons count presence/changes without disappearance claims',()=>{
 const a=measureResponse(cal(ev('1',':20261205T150000Z'),ev('2',':20261206T150000Z')),hash).uidMap;
 const reordered=measureResponse(cal(ev('2',':20261206T150000Z'),ev('1',':20261205T150000Z')),hash).uidMap;
 assert.deepEqual(a,reordered);
 const b=measureResponse(cal(ev('2',':20261207T150000Z'),ev('3',':20261208T150000Z')),hash).uidMap;
 assert.deepEqual(compareMaps(a,b),{added:1,notObservedInNewer:1,changedCommon:1,unchangedCommon:0});
 assert.deepEqual(overlap(a,b),{common:1,agree:0,conflict:1});
});
test('dated public fixtures: 7 and 20 accepted, zero rejects, latest-first listing order; observed dates are not a horizon',()=>{
 const prcr=measureResponse(fixture('prcr'),hash).measurement,arts=measureResponse(fixture('arts'),hash).measurement;
 assert.deepEqual([prcr.returned,prcr.accepted,prcr.parserRejects,prcr.duplicates],[7,7,0,0]);
 assert.deepEqual([arts.returned,arts.accepted,arts.parserRejects,arts.duplicates],[20,20,0,0]);
 assert.equal(prcr.order,'descending');assert.equal(arts.order,'descending');
 const overlapCount=overlap(measureResponse(fixture('prcr'),hash).uidMap,measureResponse(fixture('arts'),hash).uidMap).common;
 assert.equal(7+20-overlapCount,21);
});
