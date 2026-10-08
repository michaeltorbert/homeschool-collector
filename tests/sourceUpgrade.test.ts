import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../server/store.ts';
import {importArchives} from '../server/sourceCheck.ts';
import {LOCAL_SCOPE} from '../src/decisions.ts';
// SYNTHETIC: file-backed temporary databases. Pre-feature state is reproduced by removing the source evidence tables, which
// did not exist before, after writing through the unchanged legacy ingestion/failure-era API.
const captured='2026-10-04T02:35:33.636296Z';const clock=()=>new Date('2080-01-02T00:00:00Z');
const T=Date.parse('2080-01-02T00:00:00Z');
const ev=(uid:string,start='20801205T150000Z')=>`BEGIN:VEVENT\nUID:${uid}\nSUMMARY:Synthetic ${uid}\nDTSTART:${start}\nDTEND:20801205T160000Z\nEND:VEVENT`;
const cal=(...events:string[])=>`BEGIN:VCALENDAR\nVERSION:2.0\n${events.join('\n')}\nEND:VCALENDAR`;
const dropEvidence=(path:string)=>{const db=new DatabaseSync(path);db.exec('DROP TRIGGER source_uid_maps_no_update; DROP TABLE source_uid_maps; DROP TRIGGER source_attempts_no_update; DROP INDEX source_attempts_by_part; DROP TABLE source_attempts;');db.close();};
function withDirectory(label:string,run:(path:string)=>void){const directory=mkdtempSync(join(tmpdir(),`town-source-${label}-`));try{run(join(directory,'state.sqlite'));}finally{rmSync(directory,{recursive:true,force:true});}}
function legacyIngest(s:Store,part:'prcr'|'arts',body:string,batch:string,observedAt:string,kind:'archived'|'live',now:number){const t=s.beginScan(now);try{return s.ingest(part,body,batch,observedAt,kind,t.fence,now);}finally{s.endScan(t.fence);}}
const exists=(db:DatabaseSync,name:string)=>Boolean(db.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(name));
test('pre-feature database upgrades with no backfill; private state, receipts and restart survive; legacy raw error is redacted on read only',()=>withDirectory('upgrade',path=>{
 let s=new Store(path,clock);
 const archived=legacyIngest(s,'prcr',cal(ev('a'),ev('b'),ev('c')),'initial-fixture-prcr',captured,'archived',T);
 const live=legacyIngest(s,'prcr',cal(ev('a'),ev('b'),ev('c')),'legacy-live',new Date(T+1000).toISOString(),'live',T+1000);
 const item=(uid:string)=>s.snapshot().items.find((i:any)=>i.uid===uid)!;
 s.action(item('a').id,'surface');s.action(item('a').id,'interested',true);s.action(item('a').id,'hidden',true);
 s.action(item('c').id,'review',{version:1,changeIds:[]});
 const pass=s.decision({id:item('b').id,action:'pass',shownVersion:1,commandKey:'synthetic-upgrade-pass',expectedActiveDecisionId:null,reasons:['timing'],...LOCAL_SCOPE});
 s.updateProfile({commandKey:'synthetic-upgrade-age',expectedRevisionId:s.profileBasis().revisionId,profile:{kind:'age-as-of',age:7,asOf:'2079-06-01'}});
 s.learning.control({commandKey:'synthetic-upgrade-learning',action:'on',expectedControlRevision:s.snapshot().learning.revision});
 legacyIngest(s,'prcr',cal(ev('a','20801206T150000Z'),ev('b'),ev('c')),'legacy-change',new Date(T+2000).toISOString(),'live',T+2000);
 s.db.prepare("UPDATE source_parts SET health='failed',attempted_at=?,error=? WHERE id='arts'").run(new Date(T+3000).toISOString(),'HTTP 403 SENTINEL-private remote detail');
 const project=(t:Store)=>JSON.stringify({items:t.snapshot().items.map((i:any)=>[i.uid,i.interested,i.hidden,i.passed,i.reviewedVersion,i.notices.map((n:any)=>n.change_id),i.version]),profile:t.profileBasis().revisionId,learning:t.snapshot().learning.status,settings:t.settings()});
 const before=project(s),parts=JSON.stringify(s.db.prepare('SELECT * FROM source_parts ORDER BY id').all());
 assert.equal(item('a').notices.length,1);
 s.db.close();dropEvidence(path);
 s=new Store(path,clock);
 assert.equal(s.db.prepare('SELECT count(*) n FROM source_attempts').get()!.n,0);assert.equal(s.db.prepare('SELECT count(*) n FROM source_uid_maps').get()!.n,0);
 assert.equal(project(s),before);assert.equal(JSON.stringify(s.db.prepare('SELECT * FROM source_parts ORDER BY id').all()),parts);
 const evidence=s.sourceEvidence();
 assert.equal(evidence.parts.prcr.successEvidence,'earlier-check');assert.equal(evidence.parts.prcr.latestAttempt,null);assert.equal(evidence.parts.prcr.latestSuccess,null);
 assert.equal(evidence.parts.prcr.retainedCount,3);assert.equal(evidence.crossPart.status,'unavailable');
 const snap=JSON.stringify(s.snapshot());assert.equal(snap.includes('SENTINEL'),false);assert.equal(s.snapshot().sources.find((p:any)=>p.id==='arts')!.error,'Failed (legacy detail not shown)');
 // Earlier receipts and decision receipts replay exactly.
 const t=s.beginScan(T+4000);
 assert.deepEqual(s.ingest('prcr',cal(ev('a'),ev('b'),ev('c')),'initial-fixture-prcr',captured,'archived',t.fence),archived);
 assert.deepEqual(s.ingest('prcr',cal(ev('a'),ev('b'),ev('c')),'legacy-live',new Date(T+1000).toISOString(),'live',t.fence),live);
 assert.deepEqual(s.decision({id:item('b').id,action:'pass',shownVersion:1,commandKey:'synthetic-upgrade-pass',expectedActiveDecisionId:null,reasons:['timing'],...LOCAL_SCOPE}),pass);
 // The next ordinary completion is the first measured evidence.
 s.completeSuccess({part:'prcr',fence:t.fence,origin:'live',body:cal(ev('a','20801206T150000Z'),ev('b'),ev('c')),observedAt:new Date(T+5000).toISOString(),acquisition:{method:'ordinary-get'},now:T+5000});
 s.completeFailure({part:'arts',fence:t.fence,acquisition:{category:'denied',status:403},now:T+5001});s.endScan(t.fence);
 assert.equal(project(s),before);
 const after=JSON.stringify(s.sourceEvidence());assert.equal(s.sourceEvidence().parts.prcr.successEvidence,'available');
 s.db.close();s=new Store(path,clock);
 assert.equal(JSON.stringify(s.sourceEvidence()),after);assert.equal(project(s),before);
 assert.equal(String(s.db.prepare("SELECT error FROM source_parts WHERE id='arts'").get()!.error),'Access denied (HTTP 403); request stopped, no bypass attempted.');
 s.db.close();
}));
test('early migration failure (conflicting evidence table) and late seed failure roll back the whole migration; replay succeeds',()=>withDirectory('rollback',path=>{
 let s=new Store(path);legacyIngest(s,'prcr',cal(ev('a')),'synthetic',captured,'archived',Date.now());s.action(s.snapshot().items[0].id,'interested',true);s.db.close();dropEvidence(path);
 let db=new DatabaseSync(path);db.exec("CREATE TABLE source_attempts(x TEXT); INSERT INTO source_attempts VALUES ('keep');");db.close();
 assert.throws(()=>new Store(path),/no such column/);
 db=new DatabaseSync(path);assert.equal(exists(db,'source_uid_maps'),false);assert.deepEqual(db.prepare('SELECT x FROM source_attempts').all().map(r=>r.x),['keep']);
 db.exec("DROP TABLE source_attempts; DELETE FROM meta WHERE key='lease'; CREATE TRIGGER fail_seed BEFORE INSERT ON meta WHEN NEW.key='lease' BEGIN SELECT RAISE(ABORT,'injected late seed failure'); END;");db.close();
 assert.throws(()=>new Store(path),/late seed failure/);
 db=new DatabaseSync(path);assert.equal(exists(db,'source_attempts'),false);assert.equal(exists(db,'source_uid_maps'),false);assert.equal(db.prepare("SELECT value FROM meta WHERE key='lease'").get(),undefined);
 db.exec('DROP TRIGGER fail_seed');db.close();
 s=new Store(path);assert.equal(exists(s.db,'source_attempts'),true);assert.equal(s.snapshot().items[0].interested,true);assert.equal(s.sourceEvidence().parts.prcr.successEvidence,'earlier-check');s.db.close();
}));
test('archive import: fresh import keeps capture time separate from import time; matching fixed receipt is non-acquisition; mismatch is a safe conflict',()=>{
 const read=(part:string)=>readFileSync(new URL(`../fixtures/${part}.ics`,import.meta.url),'utf8');
 const fresh=new Store(':memory:');const report=importArchives(fresh,read as any,captured,T);
 assert.deepEqual(report.map(r=>r.status),['recorded','recorded']);assert.deepEqual(fresh.snapshot().counts,{identities:21,memberships:27,closures:4});
 const row=fresh.db.prepare("SELECT * FROM source_attempts WHERE part='arts'").get()!;
 assert.deepEqual([row.origin,row.observed_at,row.recorded_at,row.completed_at,row.method,row.runtime,row.http_status,row.bytes,row.started_at],['archived',captured,new Date(T).toISOString(),new Date(T).toISOString(),'archive-import',process.version,null,null,null]);
 const arts=fresh.db.prepare("SELECT * FROM source_parts WHERE id='arts'").get()!;assert.deepEqual([arts.kind,arts.observed_at,arts.attempted_at],['archived',captured,new Date(T).toISOString()]);
 assert.equal(fresh.sourceEvidence().parts.arts.latestSuccess.measurement.accepted,20);assert.equal(fresh.sourceEvidence().crossPart.common,6);
 // A database whose earlier import produced no items: startup re-import replays the exact fixed receipts with no writes.
 const empty=cal();const legacy=new Store(':memory:');
 for(const part of ['prcr','arts'] as const)legacyIngest(legacy,part,empty,`initial-fixture-${part}`,captured,'archived',T);
 const state=(s:Store)=>JSON.stringify(['source_attempts','source_uid_maps','receipts','observations','source_parts'].map(t=>s.db.prepare(`SELECT * FROM ${t}`).all()));
 const before=state(legacy);
 assert.deepEqual(importArchives(legacy,()=>empty,captured,T+1000).map(r=>r.status),['existing-receipt','existing-receipt']);assert.equal(state(legacy),before);
 // A mismatched fixed-batch payload is rejected with no acquisition and reported; startup continues.
 assert.deepEqual(importArchives(legacy,(part:string)=>part==='prcr'?cal(ev('changed')):empty,captured,T+2000).map(r=>r.status),['archive-import-conflict','existing-receipt']);
 assert.equal(state(legacy),before);assert.equal(legacy.db.prepare("SELECT value FROM meta WHERE key='lease'").get()!.value,'0');
 // Unrelated failures stay real errors (and still release the lease).
 assert.throws(()=>importArchives(new Store(':memory:'),()=>{throw Error('synthetic read failure');},captured,T),/synthetic read failure/);
});
