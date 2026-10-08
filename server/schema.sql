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
-- Private one-child age profile. Revisions are immutable; reset to unknown appends a revision rather than deleting history.
CREATE TABLE IF NOT EXISTS age_profile_revisions (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 revision_id TEXT NOT NULL UNIQUE,
 subject_id TEXT NOT NULL,
 previous_revision_id TEXT,
 input_json TEXT NOT NULL,
 anchor_date TEXT NOT NULL,
 origin TEXT NOT NULL CHECK(origin IN ('seed','user','legacy-confirm')),
 created_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS age_profile_no_update BEFORE UPDATE ON age_profile_revisions BEGIN SELECT RAISE(ABORT,'Profile history is append-only.'); END;
CREATE TRIGGER IF NOT EXISTS age_profile_no_delete BEFORE DELETE ON age_profile_revisions BEGIN SELECT RAISE(ABORT,'Profile history is append-only.'); END;
-- Idempotency receipts for profile commands. payload_mac is keyed by a local random secret so it is not a guessable birthday hash.
CREATE TABLE IF NOT EXISTS age_profile_commands (command_key TEXT PRIMARY KEY, payload_mac TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL);
-- Raw legacy settings.birthDate held privately until explicit local confirm or discard.
CREATE TABLE IF NOT EXISTS age_legacy_birth_date (id INTEGER PRIMARY KEY CHECK(id=1), raw_json TEXT, status TEXT NOT NULL CHECK(status IN ('pending','confirmed','discarded')), captured_at TEXT NOT NULL, resolved_at TEXT, resolution_revision_id TEXT);
-- Show anyway: household/item age-placement override with its own append-only history.
CREATE TABLE IF NOT EXISTS age_overrides (
 event_id INTEGER PRIMARY KEY AUTOINCREMENT,
 override_id TEXT NOT NULL UNIQUE,
 command_key TEXT NOT NULL UNIQUE,
 payload_hash TEXT NOT NULL,
 opportunity_id TEXT NOT NULL,
 household_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('show','revert')),
 shown_version INTEGER NOT NULL,
 basis_json TEXT NOT NULL,
 target_override_id TEXT,
 result_json TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS age_overrides_by_item ON age_overrides(opportunity_id,event_id);
CREATE TRIGGER IF NOT EXISTS age_overrides_no_update BEFORE UPDATE ON age_overrides BEGIN SELECT RAISE(ABORT,'Show anyway history is append-only.'); END;
CREATE TRIGGER IF NOT EXISTS age_overrides_no_delete BEFORE DELETE ON age_overrides BEGIN SELECT RAISE(ABORT,'Show anyway history is append-only.'); END;
-- Private per-item assessment baseline: profile-independent facts plus the material outcome under the named profile revision
-- and assessment revision. Refreshed on source versions and profile revisions, so a later difference on unchanged source and
-- profile can only be an extractor/comparison-algorithm correction. Outcome columns are added by migration for earlier rows.
CREATE TABLE IF NOT EXISTS age_rule_state (id TEXT PRIMARY KEY, version INTEGER NOT NULL, extractor_revision TEXT NOT NULL, signature TEXT NOT NULL, facts_json TEXT NOT NULL, profile_revision_id TEXT, assessment_revision TEXT, outcome_signature TEXT, outcome_json TEXT);
-- Persisted Show anyway lapse boundary: once its basis materially changes, an override stays lapsed until a fresh show.
CREATE TABLE IF NOT EXISTS age_override_lapses (override_id TEXT PRIMARY KEY, opportunity_id TEXT NOT NULL, outcome_signature TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS age_override_lapses_no_update BEFORE UPDATE ON age_override_lapses BEGIN SELECT RAISE(ABORT,'Show anyway lapse history is append-only.'); END;
CREATE TRIGGER IF NOT EXISTS age_override_lapses_no_delete BEFORE DELETE ON age_override_lapses BEGIN SELECT RAISE(ABORT,'Show anyway lapse history is append-only.'); END;
-- Local assessment attention: an extractor/algorithm correction computed from unchanged stored source. Never a source version or change ID.
CREATE TABLE IF NOT EXISTS age_attention (
 attention_id INTEGER PRIMARY KEY AUTOINCREMENT,
 id TEXT NOT NULL,
 source_version INTEGER NOT NULL,
 old_revision TEXT NOT NULL,
 new_revision TEXT NOT NULL,
 old_signature TEXT NOT NULL,
 new_signature TEXT NOT NULL,
 before_json TEXT NOT NULL,
 after_json TEXT NOT NULL,
 notice_eligible INTEGER NOT NULL,
 created_at TEXT NOT NULL,
 ack_at TEXT
);
-- Interest learning (issue #5): one append-only log of learning controls, explicit scoped instructions and weak Interested
-- signals, replacements and exact Undo. The global seq orders instructions against signals. Baseline Settings are never
-- written here. A pass-linked instruction has no command key of its own; its receipt is the pass's decision receipt.
CREATE TABLE IF NOT EXISTS learning_events (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 event_id TEXT NOT NULL UNIQUE,
 command_key TEXT UNIQUE,
 payload_hash TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('control','instruction','interest','replace','undo')),
 household_id TEXT NOT NULL,
 subject_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,
 opportunity_id TEXT,
 epoch INTEGER NOT NULL,
 data_json TEXT NOT NULL,
 attribution_json TEXT,
 origin_decision_id TEXT,
 target_event_id TEXT,
 result_json TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS learning_events_by_item ON learning_events(opportunity_id,seq);
CREATE UNIQUE INDEX IF NOT EXISTS learning_instruction_per_pass ON learning_events(origin_decision_id) WHERE origin_decision_id IS NOT NULL;
CREATE TRIGGER IF NOT EXISTS learning_events_no_update BEFORE UPDATE ON learning_events BEGIN SELECT RAISE(ABORT,'Learning history is append-only.'); END;
CREATE TRIGGER IF NOT EXISTS learning_events_no_delete BEFORE DELETE ON learning_events BEGIN SELECT RAISE(ABORT,'Learning history is append-only.'); END;
-- Source acquisition evidence (issue #7): one completed acquisition per part per scan fence, immutable while retained.
-- Bounded to the latest 100 per part by deterministic oldest-first pruning (no delete trigger, so pruning stays possible).
-- Failure rows hold fixed categories/status and known transport fields only, never response bodies or exception text.
-- No backfill: earlier source_parts/receipts/observations stay as they were and count as earlier checks without evidence.
CREATE TABLE IF NOT EXISTS source_attempts (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 attempt_id TEXT NOT NULL UNIQUE,
 part TEXT NOT NULL,
 fence INTEGER NOT NULL,
 origin TEXT NOT NULL CHECK(origin IN ('live','archived')),
 scope TEXT NOT NULL,
 outcome TEXT NOT NULL CHECK(outcome IN ('ok','empty','partial','failed')),
 payload_hash TEXT NOT NULL,
 batch_id TEXT,
 observed_at TEXT,
 method TEXT NOT NULL,
 started_at TEXT,
 completed_at TEXT,
 runtime TEXT,
 http_status INTEGER,
 content_type TEXT,
 bytes INTEGER,
 advertised_bytes INTEGER,
 error_category TEXT,
 evidence_revision TEXT NOT NULL,
 parser_revision TEXT NOT NULL,
 measurement_json TEXT,
 comparison_json TEXT,
 result_json TEXT NOT NULL,
 recorded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS source_attempts_by_part ON source_attempts(part,seq);
CREATE TRIGGER IF NOT EXISTS source_attempts_no_update BEFORE UPDATE ON source_attempts BEGIN SELECT RAISE(ABORT,'Source attempts are immutable.'); END;
-- Accepted UID -> semantic hash of one successful response, kept for the latest 3 successful acquisitions per part only.
CREATE TABLE IF NOT EXISTS source_uid_maps (attempt_id TEXT PRIMARY KEY REFERENCES source_attempts(attempt_id) ON DELETE CASCADE, part TEXT NOT NULL, map_json TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS source_uid_maps_no_update BEFORE UPDATE ON source_uid_maps BEGIN SELECT RAISE(ABORT,'Response identity maps are immutable.'); END;
