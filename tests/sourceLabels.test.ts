import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Store} from '../server/store.ts';
import {importArchives} from '../server/sourceCheck.ts';
import {CATALOG_LABEL} from '../src/sourceEvidence.ts';
import {sourceDate,sourceDay,spanText,originText,latestCheckText,historyText,comparisonText,revisionText,crossFeedText} from '../src/sourceLabels.ts';
// SYNTHETIC databases with the dated public fixtures; checks the exact text the Sources view renders.
const flat=(s:string)=>s.replace(/\s/g,' ');
const captured='2026-10-04T02:35:33.636296Z',T=Date.parse('2080-01-02T15:00:00Z');
const read=(part:string)=>readFileSync(new URL(`../fixtures/${part}.ics`,import.meta.url),'utf8');
test('Sources dates carry the year across year boundaries; all-day dates stay date-only',()=>{
 assert.equal(flat(spanText({count:20,earliest:'2026-10-10T23:30:00.000Z',latest:'2027-03-13T00:30:00.000Z'},sourceDate)),'20 (Oct 10, 2026, 7:30 PM ET to Mar 12, 2027, 7:30 PM ET)');
 assert.equal(spanText({count:2,earliest:'2026-12-31',latest:'2027-01-01'},sourceDay),'2 (Dec 31, 2026 to Jan 1, 2027)');
 assert.equal(spanText({count:0,earliest:null,latest:null},sourceDate),'0');
 assert.match(flat(comparisonText({status:'compared',added:1,notObservedInNewer:2,changedCommon:0,unchangedCommon:3,previousRecordedAt:'2026-12-31T23:00:00.000Z',previousPartial:false,currentPartial:false})),/check of Dec 31, 2026, 6:00 PM ET\. Not seen does not mean cancelled\.$/);
});
test('archive/archive overlap shows capture and import times separately and never claims a new read',()=>{
 const s=new Store(':memory:');importArchives(s,read as any,captured,T);
 const ev=s.sourceEvidence(),text=flat(crossFeedText(ev.crossPart));
 assert.match(text,/^Feed overlap: 6 listings appear in both latest successful responses; 6 agree and 0 differ\./);
 assert.match(text,/Parks, Recreation & Cultural Resources: dated archive captured Oct 3, 2026, 10:35 PM ET, imported Jan 2, 2080, 10:00 AM ET\./);
 assert.match(text,/Arts Center: dated archive captured Oct 3, 2026, 10:35 PM ET, imported Jan 2, 2080, 10:00 AM ET\./);
 assert.match(text,/Same check, read one after the other, not at the same moment; a dated archive is an earlier capture, not a new read\./);
 assert.equal(text.includes('live response'),false);
 assert.equal(flat(latestCheckText(ev.parts.arts.latestAttempt)),'Successful · dated archive captured Oct 3, 2026, 10:35 PM ET, imported Jan 2, 2080, 10:00 AM ET');
 // The fixture range spans two years and is rendered with both.
 const m=ev.parts.arts.latestSuccess.measurement;assert.match(flat(spanText(m.knownStarts,sourceDate)),/2026.* to .*2026|2026.* to .*2027/);
});
test('mixed live/archive overlap labels each side by origin; a later live failure keeps the archive side as an archive',()=>{
 const s=new Store(':memory:');importArchives(s,read as any,captured,T);
 const now=T+3_600_000,t=s.beginScan(now);
 s.completeSuccess({part:'prcr',fence:t.fence,origin:'live',body:read('prcr'),observedAt:new Date(now).toISOString(),acquisition:{method:'ordinary-get',status:200},now});
 s.completeFailure({part:'arts',fence:t.fence,acquisition:{category:'denied',status:403},now:now+1});s.endScan(t.fence);
 const ev=s.sourceEvidence(),text=flat(crossFeedText(ev.crossPart));
 assert.match(text,/Parks, Recreation & Cultural Resources: live response read Jan 2, 2080, 11:00 AM ET\./);
 assert.match(text,/Arts Center: dated archive captured Oct 3, 2026, 10:35 PM ET, imported Jan 2, 2080, 10:00 AM ET\./);
 assert.match(text,/Different checks, not at the same moment; a dated archive is an earlier capture, not a new read\./);
 assert.equal(flat(latestCheckText(ev.parts.arts.latestAttempt)),'Access denied (HTTP 403); request stopped, no bypass attempted. · Jan 2, 2080, 11:00 AM ET');
 assert.equal(flat(historyText(ev.parts.prcr.history[0])),'Successful · live response read Jan 2, 2080, 11:00 AM ET · 7 accepted of 7');
 assert.equal(flat(originText(ev.parts.prcr.latestSuccess)),'live response read Jan 2, 2080, 11:00 AM ET');
});
test('revision qualifications and unavailable overlap are rendered in plain words',()=>{
 assert.equal(comparisonText({status:'revision-changed'}),'Not compared: the earlier check was read with a different parser version, so differences are unknown.');
 assert.equal(revisionText({revisionCurrent:true}),null);
 assert.equal(revisionText({revisionCurrent:false,parserRevision:'1.0',currentParserRevision:'1.1'}),'These figures were measured when the response arrived (parser 1.0); the parser has since changed (now 1.1), so they reflect the earlier reading.');
 assert.equal(crossFeedText({status:'unavailable',reason:'The two feeds were read with different parser versions, so agreement is unknown.'}),'Feed overlap: unavailable. The two feeds were read with different parser versions, so agreement is unknown.');
});
test('catalog copy is plain parent-facing language without implementation vocabulary',()=>{
 assert.equal(CATALOG_LABEL,'Classes and camps are not connected; the complete registration listings are unavailable');
 assert.equal(/route|permitted|unproved|catalog/i.test(CATALOG_LABEL),false);
});
