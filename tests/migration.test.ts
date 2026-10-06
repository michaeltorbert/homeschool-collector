import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../server/store.ts';
test('failed legacy schema migration rolls back new tables, preserves known intent, closes locks and safely replays',()=>{
 const directory=mkdtempSync(join(tmpdir(),'town-migration-'));
 try{
  const path=join(directory,'legacy.sqlite');let inspect=new DatabaseSync(path);
  inspect.exec("CREATE TABLE family_state(id TEXT PRIMARY KEY,interested INTEGER NOT NULL DEFAULT 0,hidden INTEGER NOT NULL DEFAULT 0,reviewed_version INTEGER NOT NULL DEFAULT 0,surfaced INTEGER NOT NULL DEFAULT 0); INSERT INTO family_state VALUES ('synthetic-existing',1,1,7,1); CREATE TABLE decision_events(event_id INTEGER PRIMARY KEY);");inspect.close();
  assert.throws(()=>new Store(path),/opportunity_id/);
  inspect=new DatabaseSync(path);
  assert.equal(inspect.prepare("SELECT name FROM sqlite_master WHERE name='opportunities'").get(),undefined);
  assert.equal(inspect.prepare("SELECT name FROM sqlite_master WHERE name='meta'").get(),undefined);
  assert.deepEqual({...inspect.prepare('SELECT * FROM family_state').get()!},{id:'synthetic-existing',interested:1,hidden:1,reviewed_version:7,surfaced:1});
  inspect.exec('BEGIN IMMEDIATE; DROP TABLE decision_events; COMMIT;');inspect.close();
  let migrated=new Store(path);assert.equal(migrated.db.prepare('PRAGMA foreign_keys').get()!.foreign_keys,1);assert.equal(migrated.db.prepare('SELECT count(*) n FROM decision_events').get()!.n,0);assert.equal(migrated.db.prepare('SELECT reviewed_version FROM family_state').get()!.reviewed_version,7);migrated.db.close();
  migrated=new Store(path);assert.equal(migrated.db.prepare('SELECT count(*) n FROM source_parts').get()!.n,2);assert.equal(migrated.db.prepare('SELECT interested FROM family_state').get()!.interested,1);migrated.db.close();
 }finally{rmSync(directory,{recursive:true,force:true});}
});
test('late seed failure rolls back ALTERs, decision DDL and partial seed writes as one migration',()=>{
 const directory=mkdtempSync(join(tmpdir(),'town-migration-seed-'));
 try{
  const path=join(directory,'legacy.sqlite');let inspect=new DatabaseSync(path);
  inspect.exec("CREATE TABLE changes(change_id INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL,version INTEGER NOT NULL,fields_json TEXT NOT NULL,before_json TEXT NOT NULL,after_json TEXT NOT NULL,critical INTEGER NOT NULL,created_at TEXT NOT NULL,ack_at TEXT); CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO meta VALUES ('old-custom','preserve'); CREATE TRIGGER fail_seed BEFORE INSERT ON meta WHEN NEW.key='lease' BEGIN SELECT RAISE(ABORT,'injected late seed failure'); END;");inspect.close();
  assert.throws(()=>new Store(path),/late seed failure/);inspect=new DatabaseSync(path);
  assert.deepEqual(inspect.prepare('SELECT key,value FROM meta').all().map(r=>({...r})),[{key:'old-custom',value:'preserve'}]);
  const columns=inspect.prepare('PRAGMA table_info(changes)').all().map(r=>r.name);assert.equal(columns.includes('cause'),false);assert.equal(columns.includes('notice_eligible'),false);
  assert.equal(inspect.prepare("SELECT name FROM sqlite_master WHERE name='decision_events'").get(),undefined);
  inspect.exec('DROP TRIGGER fail_seed');inspect.close();
  const migrated=new Store(path);assert.equal(migrated.db.prepare('SELECT value FROM meta WHERE key=?').get('old-custom')!.value,'preserve');assert.equal(migrated.db.prepare('SELECT count(*) n FROM source_parts').get()!.n,2);migrated.db.close();
 }finally{rmSync(directory,{recursive:true,force:true});}
});
