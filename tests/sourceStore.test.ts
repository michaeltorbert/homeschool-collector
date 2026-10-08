import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,ConflictError,AcquisitionGuardError,hash} from '../server/store.ts';
import {measureResponse} from '../src/sourceEvidence.ts';
// SYNTHETIC calendars and in-memory databases only.
const T0=Date.parse('2080-01-01T00:00:00Z');let clock=T0;const tick=(ms=60_000)=>(clock+=ms);
const ev=(uid:string,title=`Synthetic ${uid}`,start='20801205T150000Z')=>`BEGIN:VEVENT\nUID:${uid}\nSUMMARY:${title}\nDTSTART:${start}\nEND:VEVENT`;
const cal=(...events:string[])=>`BEGIN:VCALENDAR\nVERSION:2.0\n${events.join('\n')}\nEND:VCALENDAR`;
const meta=(now:number,extra:any={})=>({method:'ordinary-get',startedAt:new Date(now-50).toISOString(),completedAt:new Date(now).toISOString(),runtime:'v25.9.0',status:200,contentType:'text/calendar',bytes:100,advertisedBytes:null,...extra});
const args=(part:'prcr'|'arts',fence:number,body:string,now:number)=>({part,fence,origin:'live' as const,body,observedAt:new Date(now).toISOString(),acquisition:meta(now),now});
function live(s:Store,part:'prcr'|'arts',body:string,now=tick()){const t=s.beginScan(now);try{return s.completeSuccess(args(part,t.fence,body,now));}finally{s.endScan(t.fence);}}
function fail(s:Store,part:'prcr'|'arts',now=tick(),extra:any={status:403,category:'denied'}){const t=s.beginScan(now);try{return s.completeFailure({part,fence:t.fence,acquisition:meta(now,extra),now});}finally{s.endScan(t.fence);}}
const count=(s:Store,table:string,where='1')=>Number(s.db.prepare(`SELECT count(*) n FROM ${table} WHERE ${where}`).get()!.n);
const tables=['source_attempts','source_uid_maps','receipts','observations','opportunities','versions','changes'];
const counts=(s:Store)=>Object.fromEntries(tables.map(t=>[t,count(s,t)]));
const part=(s:Store,id:string)=>s.db.prepare('SELECT * FROM source_parts WHERE id=?').get(id)!;
test('success evidence, raw observation, receipt, normalization and health commit atomically; injected failure leaves nothing',()=>{
 const s=new Store(':memory:');s.db.exec("CREATE TRIGGER injected BEFORE INSERT ON source_uid_maps BEGIN SELECT RAISE(ABORT,'injected map failure'); END;");
 assert.throws(()=>live(s,'prcr',cal(ev('a'))),/injected map failure/);
 assert.deepEqual(counts(s),Object.fromEntries(tables.map(t=>[t,0])));assert.equal(part(s,'prcr').health,'never checked');
 s.db.exec('DROP TRIGGER injected');const r=live(s,'prcr',cal(ev('a')));
 assert.deepEqual(counts(s),{source_attempts:1,source_uid_maps:1,receipts:1,observations:1,opportunities:1,versions:1,changes:0});
 assert.equal(part(s,'prcr').attempted_at,r.recordedAt);assert.equal(part(s,'prcr').health,'ok');assert.equal(r.attemptId,`scan-${s.db.prepare('SELECT fence FROM source_attempts').get()!.fence}-prcr`);
});
test('R1 replay: exact retained completion returns the identical result; changed metadata or body conflicts with no writes; legacy receipt replays',()=>{
 const s=new Store(':memory:');const now=tick(),t=s.beginScan(now),input=args('prcr',t.fence,cal(ev('a')),now);
 const first=s.completeSuccess(input);s.endScan(t.fence);const before=counts(s);
 const again=s.completeSuccess({...input,now:tick()});
 assert.deepEqual(again,first);assert.equal(JSON.stringify(again),JSON.stringify(first));
 assert.throws(()=>s.completeSuccess({...input,acquisition:meta(now,{bytes:999})}),(e:any)=>e instanceof ConflictError);
 assert.throws(()=>s.completeSuccess({...input,body:cal(ev('b'))}),(e:any)=>e instanceof ConflictError);
 assert.throws(()=>s.completeFailure({part:'prcr',fence:t.fence,acquisition:meta(now,{category:'timeout'}),now}),(e:any)=>e instanceof ConflictError);
 assert.deepEqual(counts(s),before);
 const receipt=JSON.parse(String(s.db.prepare('SELECT receipt_json FROM receipts').get()!.receipt_json));
 assert.deepEqual(s.ingest('prcr',input.body,`acquisition-${first.attemptId}`,input.observedAt,'live',999),receipt);assert.deepEqual(counts(s),before);
});
test('shared guard rejects expired, superseded, stale-sequence and older acquisitions for success and failure before any write',()=>{
 const s=new Store(':memory:');live(s,'prcr',cal(ev('a')));const before=counts(s),health={...part(s,'prcr')};
 const guard=(reason:string)=>(e:any)=>e instanceof AcquisitionGuardError&&e.reason===reason;
 let now=tick(),t=s.beginScan(now);
 assert.throws(()=>s.completeSuccess(args('prcr',t.fence,cal(ev('b')),now+61_000)),guard('expired'));
 assert.throws(()=>s.completeFailure({part:'prcr',fence:t.fence,acquisition:meta(now),now:now+61_000}),guard('expired'));
 s.db.prepare("UPDATE meta SET value='0' WHERE key='lease'").run();const newer=s.beginScan(now+1);
 assert.throws(()=>s.completeSuccess(args('prcr',t.fence,cal(ev('b')),now+2)),guard('superseded'));
 assert.throws(()=>s.failure('prcr','synthetic',t.fence,now+2),guard('superseded'));
 // Earlier than the last completed acquisition, or an observation older than the last successful one.
 assert.throws(()=>s.completeFailure({part:'prcr',fence:newer.fence,acquisition:meta(T0),now:T0}),guard('older-acquisition'));
 assert.throws(()=>s.completeSuccess({...args('prcr',newer.fence,cal(ev('b')),now+3),observedAt:new Date(T0).toISOString()}),guard('older-acquisition'));
 s.db.prepare('UPDATE source_parts SET sequence=? WHERE id=?').run(newer.fence+5,'prcr');
 assert.throws(()=>s.completeSuccess(args('prcr',newer.fence,cal(ev('b')),now+4)),guard('stale-sequence'));
 s.db.prepare('UPDATE source_parts SET sequence=? WHERE id=?').run(health.sequence,'prcr');s.endScan(newer.fence);
 assert.deepEqual(counts(s),before);assert.deepEqual({...part(s,'prcr')},health);
});
test('an existing receipt under the acquisition batch blocks completion instead of appending evidence over an early return',()=>{
 const s=new Store(':memory:');const now=tick(),t=s.beginScan(now),input=args('prcr',t.fence,cal(ev('a')),now);
 s.ingest('prcr',input.body,`acquisition-scan-${t.fence}-prcr`,input.observedAt,'live',t.fence,now);const before=counts(s);
 assert.throws(()=>s.completeSuccess({...input,now:now+1}),(e:any)=>e instanceof ConflictError);assert.deepEqual(counts(s),before);s.endScan(t.fence);
});
test('failures keep last successful data and times, store only fixed categories, and never persist a failed body',()=>{
 const s=new Store(':memory:');const ok=live(s,'prcr',cal(ev('a')));const observed=part(s,'prcr').observed_at;
 const r=fail(s,'prcr');
 assert.deepEqual(r,{attemptId:r.attemptId,part:'prcr',origin:'live',outcome:'failed',category:'denied',status:403,recordedAt:r.recordedAt});
 assert.equal(part(s,'prcr').observed_at,observed);assert.equal(part(s,'prcr').health,'failed');assert.equal(part(s,'prcr').error,'Access denied (HTTP 403); request stopped, no bypass attempted.');
 assert.equal(count(s,'observations'),1);assert.equal(s.snapshot().items.length,1);
 const ev7=s.sourceEvidence().parts.prcr;assert.equal(ev7.latestAttempt.outcome,'failed');assert.equal(ev7.latestSuccess.attemptId,ok.attemptId);assert.equal(ev7.successEvidence,'available');
 // Unknown categories and arbitrary metadata strings are bounded, not stored.
 const odd=fail(s,'prcr',tick(),{category:'synthetic private text',status:'403',contentType:'<script>',runtime:'evil'});
 assert.equal(odd.category,'unclassified');assert.equal(odd.status,null);
 const row=s.db.prepare('SELECT * FROM source_attempts WHERE attempt_id=?').get(odd.attemptId)!;assert.equal(row.content_type,null);assert.equal(row.runtime,null);
});
test('legacy failure signature ignores caller text, binds the same fence+part identity, and conflicts on a differing second completion',()=>{
 const s=new Store(':memory:');live(s,'prcr',cal(ev('a')));const now=tick(),t=s.beginScan(now);
 const r=s.failure('prcr','synthetic private caller text <b>secret</b>',t.fence,now);
 assert.equal(r.attemptId,`scan-${t.fence}-prcr`);assert.equal(r.category,'unclassified');
 assert.deepEqual(s.failure('prcr','different caller text',t.fence,now),r);
 assert.throws(()=>s.failure('prcr','synthetic',t.fence,now+1),(e:any)=>e instanceof ConflictError);
 assert.throws(()=>s.completeSuccess(args('prcr',t.fence,cal(ev('a')),now+2)),(e:any)=>e instanceof ConflictError);
 s.endScan(t.fence);
 assert.equal(JSON.stringify(s.db.prepare('SELECT * FROM source_attempts').all()).includes('secret'),false);assert.equal(String(part(s,'prcr').error).includes('secret'),false);
});
test('retention: 100 attempts and 3 identity maps per part, 40 raw responses; >100 failures prune the success without treating it as empty; pruned replays fail closed',()=>{
 const s=new Store(':memory:');let lastSuccess:any,lastInput:any;
 for(let i=0;i<45;i++){const now=tick(),t=s.beginScan(now);lastInput=args('prcr',t.fence,cal(ev('a'),ev(`n${i}`)),now);lastSuccess=s.completeSuccess(lastInput);s.endScan(t.fence);}
 live(s,'arts',cal(ev('a')));
 assert.equal(count(s,'source_attempts',"part='prcr'"),45);assert.equal(count(s,'source_uid_maps',"part='prcr'"),3);assert.equal(count(s,'observations',"part='prcr'"),40);
 let ev45=s.sourceEvidence();assert.equal(ev45.parts.prcr.latestSuccess.comparison.status,'compared');assert.equal(ev45.crossPart.status,'available');
 let lastFailure:any,failInput:any;
 for(let i=0;i<101;i++){const now=tick(),t=s.beginScan(now);failInput={part:'prcr' as const,fence:t.fence,acquisition:meta(now,{status:429,category:'rate-limited'}),now};lastFailure=s.completeFailure(failInput);s.endScan(t.fence);}
 assert.equal(count(s,'source_attempts',"part='prcr'"),100);assert.equal(count(s,'source_attempts',"part='prcr' AND outcome<>'failed'"),0);assert.equal(count(s,'source_uid_maps',"part='prcr'"),0);
 const view=s.sourceEvidence().parts.prcr;
 assert.equal(view.successEvidence,'no-longer-retained');assert.equal(view.latestSuccess,null);assert.equal(view.currentResponseCount,null);
 assert.equal(view.retainedCount,s.db.prepare("SELECT count(*) n FROM representations WHERE part='prcr'").get()!.n);assert.ok(part(s,'prcr').observed_at);
 assert.equal(s.sourceEvidence().crossPart.status,'unavailable');assert.equal(view.history.length,10);
 const before=counts(s),health={...part(s,'prcr')};
 // The pruned success identity is no longer replayable: its old fence is rejected before any write, exact or changed.
 assert.throws(()=>s.completeSuccess({...lastInput,now:tick()}),(e:any)=>e instanceof AcquisitionGuardError);
 assert.throws(()=>s.completeSuccess({...lastInput,body:cal(ev('z')),now:tick()}),(e:any)=>e instanceof AcquisitionGuardError);
 assert.deepEqual(counts(s),before);assert.deepEqual({...part(s,'prcr')},health);
 // A retained attempt still replays byte-identically; the legacy receipt of the pruned success still replays unchanged.
 assert.equal(JSON.stringify(s.completeFailure({...failInput,now:tick()})),JSON.stringify(lastFailure));
 assert.deepEqual(s.ingest('prcr',lastInput.body,`acquisition-${lastSuccess.attemptId}`,lastInput.observedAt,'live',0),JSON.parse(String(s.db.prepare('SELECT receipt_json FROM receipts WHERE batch_id=?').get(`acquisition-${lastSuccess.attemptId}`)!.receipt_json)));
 assert.deepEqual(counts(s),before);
 assert.throws(()=>s.db.prepare('UPDATE source_attempts SET outcome=? WHERE part=?').run('ok','prcr'),/immutable/);
});
test('per-part comparison: same origin/scope/revision only, partial baseline lowers comparability, absence changes no item, membership or notice',()=>{
 const s=new Store(':memory:');
 const archived=(()=>{const now=tick(),t=s.beginScan(now);try{return s.recordArchived({part:'prcr',body:cal(ev('a'),ev('b')),observedAt:new Date(now-1000).toISOString(),batchId:'synthetic-archive',fence:t.fence,now});}finally{s.endScan(t.fence);}})();
 assert.equal(archived.status,'recorded');
 const id=s.snapshot().items.find(i=>i.uid==='a')!.id;s.action(id,'surface');s.action(id,'interested',true);
 const first=live(s,'prcr',cal(ev('a'),ev('b'),'BEGIN:VEVENT\nSUMMARY:no uid\nEND:VEVENT'));
 assert.equal(first.outcome,'partial');assert.equal(s.sourceEvidence().parts.prcr.latestSuccess.comparison.status,'no-previous');
 const changes=count(s,'changes');
 live(s,'prcr',cal(ev('b','Synthetic b renamed'),ev('c')));
 const c=s.sourceEvidence().parts.prcr.latestSuccess.comparison;
 assert.deepEqual([c.status,c.added,c.notObservedInNewer,c.changedCommon,c.unchangedCommon,c.previousPartial,c.comparability],['compared',1,1,1,0,true,'lowered: partial response']);
 assert.equal(c.previousAttemptId,first.attemptId);
 const a=s.snapshot().items.find(i=>i.uid==='a')!;
 assert.equal(a.status,'unknown');assert.deepEqual(a.memberships,['prcr']);assert.equal(a.notices.length,0);assert.equal(a.changes.length,0);
 assert.equal(count(s,'changes'),changes+1);
 const ev2=s.sourceEvidence().parts.prcr;assert.equal(ev2.retainedCount,3);assert.equal(ev2.currentResponseCount,2);
 // An empty successful response is a valid baseline: everything after it is newly observed.
 live(s,'prcr',cal());live(s,'prcr',cal(ev('a')));
 const e=s.sourceEvidence().parts.prcr;assert.equal(e.history[1].outcome,'empty');assert.deepEqual([e.latestSuccess.comparison.added,e.latestSuccess.comparison.notObservedInNewer],[1,0]);
 assert.equal(s.snapshot().items.length,3);
});
test('cross-feed overlap uses the exact latest successful maps, labels different checks as not simultaneous, and never substitutes older maps',()=>{
 const s=new Store(':memory:');
 const p=live(s,'prcr',cal(ev('shared'),ev('differs','Parks title'),ev('only-p')));const a=live(s,'arts',cal(ev('shared'),ev('differs','Arts title')));
 let x=s.sourceEvidence().crossPart;
 assert.deepEqual([x.status,x.common,x.agree,x.conflict,x.sameScan,x.simultaneous],['available',2,1,1,false,false]);
 assert.equal(x.prcr.attemptId,p.attemptId);assert.equal(x.arts.attemptId,a.attemptId);assert.notEqual(x.prcr.recordedAt,x.arts.recordedAt);
 const now=tick(),t=s.beginScan(now);s.completeSuccess(args('prcr',t.fence,cal(ev('shared')),now));s.completeSuccess(args('arts',t.fence,cal(ev('shared')),now+10));s.endScan(t.fence);
 x=s.sourceEvidence().crossPart;assert.deepEqual([x.common,x.agree,x.sameScan],[1,1,true]);
 // A latest success whose map is gone makes overlap unavailable rather than falling back to an older retained map.
 s.db.prepare('DELETE FROM source_uid_maps WHERE attempt_id=?').run(`scan-${t.fence}-arts`);
 assert.equal(s.sourceEvidence().crossPart.status,'unavailable');
});
test('parser corrections append no attempt and change no acquisition times, health or frozen measurements',()=>{
 const s=new Store(':memory:');live(s,'prcr',cal(ev('a')));fail(s,'arts');
 // Frozen evidence without the read-time parser qualification, which is the only part allowed to change.
 const frozen=()=>JSON.stringify(s.sourceEvidence(),(k,v)=>k==='currentParserRevision'||k==='revisionCurrent'?undefined:v);
 const rows=()=>JSON.stringify(s.db.prepare('SELECT * FROM source_attempts ORDER BY seq').all());
 const before=frozen(),beforeRows=rows(),parts=JSON.stringify(s.db.prepare('SELECT id,health,observed_at,attempted_at,error,kind FROM source_parts').all()),attempts=count(s,'source_attempts');
 assert.equal(s.sourceEvidence().parts.prcr.latestSuccess.revisionCurrent,true);
 s.reparseLatest('synthetic-revision');
 assert.equal(count(s,'source_attempts'),attempts);assert.equal(frozen(),before);assert.equal(rows(),beforeRows);
 assert.equal(JSON.stringify(s.db.prepare('SELECT id,health,observed_at,attempted_at,error,kind FROM source_parts').all()),parts);
 const latest=s.sourceEvidence().parts.prcr;
 assert.deepEqual([latest.latestSuccess.revisionCurrent,latest.latestSuccess.parserRevision,latest.latestSuccess.currentParserRevision],[false,'initial','synthetic-revision']);
 // The correction's parser-cause receipt does not unlink the genuine acquisition.
 assert.equal(latest.successEvidence,'available');assert.equal(latest.latestAttempt.outcome,'ok');
 assert.equal(s.sourceEvidence().parts.arts.latestAttempt.outcome,'failed');
});
test('source errors are sanitized on read: partial pattern regenerated, legacy raw text redacted, stored rows unchanged',()=>{
 const s=new Store(':memory:');live(s,'prcr',cal(ev('a'),'BEGIN:VEVENT\nSUMMARY:no uid\nEND:VEVENT'));
 const partial=s.snapshot().sources.find(p=>p.id==='prcr')!;assert.equal(partial.health,'partial');assert.equal(partial.error,'1 rejected observations; last-known data retained.');
 s.db.prepare("UPDATE source_parts SET health='failed',error=? WHERE id='arts'").run('SENTINEL-raw remote detail');
 s.db.prepare("UPDATE source_parts SET error=? WHERE id='prcr'").run('SENTINEL-other text');
 const snap=s.snapshot();
 assert.equal(snap.sources.find(p=>p.id==='arts')!.error,'Failed (legacy detail not shown)');assert.equal(snap.sources.find(p=>p.id==='prcr')!.error,'Detail not shown');
 assert.equal(JSON.stringify(snap).includes('SENTINEL'),false);
 assert.equal(part(s,'arts').error,'SENTINEL-raw remote detail');
 fail(s,'arts',tick(),{category:'timeout'});assert.equal(s.snapshot().sources.find(p=>p.id==='arts')!.error,'Timed out; request stopped.');
});
test('polling payload is bounded: no response bodies or identity maps, at most 10 history rows per part',()=>{
 const s=new Store(':memory:');const body=cal(ev('a'),ev('b'));for(let i=0;i<12;i++)live(s,'prcr',body);
 const json=JSON.stringify(s.snapshot());const map=measureResponse(body,hash).uidMap;
 assert.equal(json.includes('BEGIN:VCALENDAR'),false);for(const h of Object.values(map))assert.equal(json.includes(h),false);
 assert.equal(s.snapshot().sourceEvidence.parts.prcr.history.length,10);assert.equal(s.snapshot().coverage,'unknown');
 assert.deepEqual(s.snapshot().sourceEvidence.limits,{publisherHorizon:'unknown',truncation:'unknown',pagination:'unknown',catalogCompleteness:'unknown'});
});
test('COVER-CODE-001: a same-time direct legacy ingest unlinks earlier acquisition evidence; exact replay and parser correction keep it',()=>{
 const s=new Store(':memory:');live(s,'arts',cal(ev('a')));
 const now=tick(),first=live(s,'prcr',cal(ev('a')),now);
 const linked=s.sourceEvidence().parts.prcr;assert.equal(linked.latestSuccess.attemptId,first.attemptId);assert.equal(linked.latestAttempt.attemptId,first.attemptId);
 // Exact replay of the acquisition's own receipt and a parser correction add no provider intake: linkage is unchanged.
 const replayFence=s.beginScan(tick()).fence;s.ingest('prcr',cal(ev('a')),`acquisition-${first.attemptId}`,new Date(now).toISOString(),'live',replayFence);s.endScan(replayFence);
 s.reparseLatest('synthetic-correction');
 assert.equal(s.sourceEvidence().parts.prcr.latestSuccess.attemptId,first.attemptId);
 // A genuine new provider intake via the unchanged legacy API: same observation time, same millisecond, same origin.
 const t=s.beginScan(now);s.ingest('prcr',cal(ev('b')),'synthetic-legacy-batch',new Date(now).toISOString(),'live',t.fence,now);s.endScan(t.fence);
 assert.equal(part(s,'prcr').attempted_at,first.recordedAt);assert.equal(part(s,'prcr').observed_at,new Date(now).toISOString());
 const after=s.sourceEvidence();
 assert.deepEqual([after.parts.prcr.latestSuccess,after.parts.prcr.latestAttempt,after.parts.prcr.currentResponseCount,after.parts.prcr.successEvidence],[null,null,null,'unrecorded-intake']);
 assert.equal(after.crossPart.status,'unavailable');assert.equal(after.parts.prcr.history[0].attemptId,first.attemptId);
 // The legacy receipt still replays exactly, and the next measured check relinks.
 const r=JSON.parse(String(s.db.prepare("SELECT receipt_json FROM receipts WHERE batch_id='synthetic-legacy-batch'").get()!.receipt_json));
 assert.deepEqual(s.ingest('prcr',cal(ev('b')),'synthetic-legacy-batch',new Date(now).toISOString(),'live',0),r);
 const next=live(s,'prcr',cal(ev('b')));assert.equal(s.sourceEvidence().parts.prcr.latestSuccess.attemptId,next.attemptId);
});
test('COVER-CODE-002: comparisons and overlap never cross parser revisions; the nearest incompatible success is not skipped; frozen rows unchanged',()=>{
 const s=new Store(':memory:');const s1=live(s,'prcr',cal(ev('a'),ev('b')));live(s,'arts',cal(ev('a')));
 assert.equal(s.sourceEvidence().crossPart.status,'available');
 const frozen=JSON.stringify(s.db.prepare('SELECT * FROM source_attempts ORDER BY seq').all());
 s.reparseLatest('synthetic-new');
 // One feed measured under the new parser, the other still under the old one: overlap is unknown, not ordinary disagreement.
 live(s,'prcr',cal(ev('a'),ev('c')));
 const view=s.sourceEvidence();
 assert.equal(JSON.stringify(s.db.prepare('SELECT * FROM source_attempts WHERE seq<=2 ORDER BY seq').all()),frozen);
 const c=view.parts.prcr.latestSuccess.comparison;
 assert.deepEqual([c.status,c.previousAttemptId,c.previousParserRevision,c.currentParserRevision,'added' in c],['revision-changed',s1.attemptId,'initial','synthetic-new',false]);
 assert.equal(view.crossPart.status,'unavailable');assert.match(view.crossPart.reason,/different parser versions/);
 assert.equal(view.parts.arts.latestSuccess.revisionCurrent,false);assert.equal(view.parts.prcr.latestSuccess.revisionCurrent,true);
 live(s,'arts',cal(ev('a')));assert.equal(s.sourceEvidence().crossPart.status,'available');
 // Back to the original parser: the nearest previous success (synthetic-new) decides; the older 'initial' one is not used.
 s.reparseLatest('initial');live(s,'prcr',cal(ev('a'),ev('b')));
 assert.equal(s.sourceEvidence().parts.prcr.latestSuccess.comparison.status,'revision-changed');
 live(s,'prcr',cal(ev('a')));const same=s.sourceEvidence().parts.prcr.latestSuccess.comparison;
 assert.deepEqual([same.status,same.notObservedInNewer,same.unchangedCommon],['compared',1,1]);
});
