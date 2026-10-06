PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS source_parts (id TEXT PRIMARY KEY, health TEXT NOT NULL, observed_at TEXT, attempted_at TEXT, error TEXT, sequence INTEGER NOT NULL DEFAULT 0, kind TEXT);
CREATE TABLE IF NOT EXISTS observations (id INTEGER PRIMARY KEY AUTOINCREMENT, part TEXT NOT NULL, batch_id TEXT NOT NULL, body_hash TEXT NOT NULL, body TEXT NOT NULL, observed_at TEXT NOT NULL, receipt_at TEXT NOT NULL, rejected_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS receipts (batch_id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, receipt_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS representations (part TEXT NOT NULL, id TEXT NOT NULL, data_json TEXT NOT NULL, observed_at TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (part,id));
CREATE TABLE IF NOT EXISTS opportunities (id TEXT PRIMARY KEY, data_json TEXT NOT NULL, version INTEGER NOT NULL, first_seen TEXT NOT NULL, observed_at TEXT NOT NULL, kind TEXT NOT NULL, conflict INTEGER NOT NULL, memberships_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS versions (id TEXT NOT NULL, version INTEGER NOT NULL, data_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(id,version));
CREATE TABLE IF NOT EXISTS changes (change_id INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, version INTEGER NOT NULL, fields_json TEXT NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL, critical INTEGER NOT NULL, created_at TEXT NOT NULL, ack_at TEXT, cause TEXT NOT NULL DEFAULT 'provider', notice_eligible INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS family_state (id TEXT PRIMARY KEY, interested INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0, reviewed_version INTEGER NOT NULL DEFAULT 0, surfaced INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS acknowledgements (id INTEGER PRIMARY KEY AUTOINCREMENT, opportunity_id TEXT NOT NULL, version INTEGER NOT NULL, change_ids_json TEXT NOT NULL, acknowledged_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, opportunity_id TEXT NOT NULL, direction TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS decision_events (
 event_id INTEGER PRIMARY KEY AUTOINCREMENT,
 decision_id TEXT NOT NULL UNIQUE,
 command_key TEXT NOT NULL UNIQUE,
 payload_hash TEXT NOT NULL,
 opportunity_id TEXT NOT NULL,
 household_id TEXT NOT NULL,
 subject_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('pass','undo','reconsider_review')),
 shown_version INTEGER NOT NULL,
 payload_json TEXT NOT NULL,
 snapshot_json TEXT NOT NULL,
 supersedes_id TEXT,
 reverses_id TEXT,
 target_decision_id TEXT,
 result_json TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS decisions_by_item ON decision_events(opportunity_id,event_id);
CREATE TRIGGER IF NOT EXISTS decision_events_no_update BEFORE UPDATE ON decision_events BEGIN SELECT RAISE(ABORT,'Decision history is append-only.'); END;
CREATE TRIGGER IF NOT EXISTS decision_events_no_delete BEFORE DELETE ON decision_events BEGIN SELECT RAISE(ABORT,'Decision history is append-only.'); END;
