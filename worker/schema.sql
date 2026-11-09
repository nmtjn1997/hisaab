-- Anonymous usage metrics only. Never names, amounts, bill text or group keys.
CREATE TABLE IF NOT EXISTS events (ts INTEGER NOT NULL, day TEXT NOT NULL, uid TEXT NOT NULL, type TEXT NOT NULL, route TEXT, platform TEXT, version TEXT, ref TEXT, n INTEGER DEFAULT 1);
CREATE INDEX IF NOT EXISTS ev_day ON events(day);
CREATE INDEX IF NOT EXISTS ev_type_day ON events(type, day);
CREATE TABLE IF NOT EXISTS errors (ts INTEGER NOT NULL, day TEXT NOT NULL, uid TEXT, msg TEXT, stack TEXT, route TEXT, version TEXT, ua TEXT);
CREATE INDEX IF NOT EXISTS er_day ON errors(day);
CREATE TABLE IF NOT EXISTS syncs (ts INTEGER NOT NULL, day TEXT NOT NULL, gid TEXT NOT NULL, status INTEGER, ms INTEGER, bytes INTEGER, expenses INTEGER, members INTEGER, write INTEGER);
CREATE INDEX IF NOT EXISTS sy_day ON syncs(day);
CREATE INDEX IF NOT EXISTS sy_gid ON syncs(gid);
-- Web Push: one row per phone subscription. id = hash of the endpoint (the phone's own secret).
CREATE TABLE IF NOT EXISTS push_subs (id TEXT PRIMARY KEY, endpoint TEXT NOT NULL, nudge_at INTEGER, nudge_text TEXT, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS push_subs_due ON push_subs (nudge_at);
-- Messages waiting for a phone to fetch after it is woken by an empty push.
CREATE TABLE IF NOT EXISTS push_inbox (sub TEXT NOT NULL, ts INTEGER NOT NULL, tag TEXT, title TEXT, body TEXT, url TEXT);
CREATE INDEX IF NOT EXISTS push_inbox_sub ON push_inbox (sub);
