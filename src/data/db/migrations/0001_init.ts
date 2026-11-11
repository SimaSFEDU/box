import type { Migration } from './types';

/** Initial schema. See docs/DATABASE_SCHEMA.md. */
export const m0001_init: Migration = {
  version: 1,
  name: 'init',
  async up(tx) {
    await tx.exec(`
CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE library_items (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('note','clip')),
  title       TEXT NOT NULL DEFAULT '',
  favorite    INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0,1)),
  archived    INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  inbox       INTEGER NOT NULL DEFAULT 0 CHECK (inbox IN (0,1)),
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);
CREATE INDEX ix_items_list  ON library_items(deleted_at, archived, kind, updated_at DESC);
CREATE INDEX ix_items_inbox ON library_items(inbox) WHERE inbox = 1 AND deleted_at IS NULL;
CREATE INDEX ix_items_fav   ON library_items(favorite) WHERE favorite = 1 AND deleted_at IS NULL;

CREATE TABLE notes (
  item_id     TEXT PRIMARY KEY REFERENCES library_items(id) ON DELETE CASCADE,
  format      TEXT NOT NULL CHECK (format IN ('text','markdown','checklist')),
  body        TEXT NOT NULL DEFAULT '',
  source_path TEXT
);

CREATE TABLE note_drafts (
  item_id    TEXT PRIMARY KEY REFERENCES library_items(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  sel_start  INTEGER,
  sel_end    INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE attachments (
  id            TEXT PRIMARY KEY,
  item_id       TEXT REFERENCES library_items(id) ON DELETE CASCADE,
  rel_path      TEXT NOT NULL UNIQUE,
  original_name TEXT,
  mime          TEXT NOT NULL,
  size          INTEGER NOT NULL,
  sha256        TEXT NOT NULL,
  width         INTEGER,
  height        INTEGER,
  created_at    INTEGER NOT NULL
);
CREATE INDEX ix_att_item ON attachments(item_id);

CREATE TABLE clips (
  item_id         TEXT PRIMARY KEY REFERENCES library_items(id) ON DELETE CASCADE,
  url             TEXT,
  canonical_url   TEXT,
  content_type    TEXT NOT NULL CHECK (content_type IN
    ('link','article','youtube','tiktok','reddit','music','game','ai_tool','image','pdf','file')),
  description     TEXT,
  site_name       TEXT,
  preview_path    TEXT,
  attachment_id   TEXT REFERENCES attachments(id) ON DELETE SET NULL,
  note            TEXT,
  meta_status     TEXT NOT NULL DEFAULT 'pending' CHECK (meta_status IN ('pending','ok','failed','skipped')),
  meta_attempts   INTEGER NOT NULL DEFAULT 0,
  meta_fetched_at INTEGER
);
CREATE INDEX ix_clips_url  ON clips(canonical_url);
CREATE INDEX ix_clips_meta ON clips(meta_status) WHERE meta_status = 'pending';

CREATE TABLE tags (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at INTEGER NOT NULL
);
CREATE TABLE item_tags (
  item_id TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
) WITHOUT ROWID;
CREATE INDEX ix_item_tags_tag ON item_tags(tag_id);

CREATE TABLE collections (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  icon        TEXT,
  color       TEXT,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE TABLE collection_items (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  item_id       TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
  position      REAL NOT NULL,
  added_at      INTEGER NOT NULL,
  PRIMARY KEY (collection_id, item_id)
) WITHOUT ROWID;
CREATE INDEX ix_coll_items_item ON collection_items(item_id);

CREATE TABLE item_relations (
  from_id    TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
  to_id      TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
  rel        TEXT NOT NULL CHECK (rel IN ('related','link','embed')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (from_id, to_id, rel)
) WITHOUT ROWID;

CREATE TABLE reminders (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  notes         TEXT,
  item_id       TEXT REFERENCES library_items(id) ON DELETE SET NULL,
  collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL,
  due_local     TEXT NOT NULL,
  tz            TEXT NOT NULL,
  tz_mode       TEXT NOT NULL DEFAULT 'floating' CHECK (tz_mode IN ('floating','fixed')),
  repeat_rule   TEXT,
  repeat_until  INTEGER,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','done','snoozed')),
  next_fire_at  INTEGER,
  snoozed_until INTEGER,
  completed_at  INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX ix_rem_next ON reminders(status, next_fire_at);

CREATE TABLE reminder_schedule (
  reminder_id        TEXT NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
  fire_at            INTEGER NOT NULL,
  os_notification_id TEXT NOT NULL,
  PRIMARY KEY (reminder_id, fire_at)
) WITHOUT ROWID;

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE file_gc (rel_path TEXT PRIMARY KEY, queued_at INTEGER NOT NULL) WITHOUT ROWID;

-- Protected tier: ciphertext only, no foreign keys into the standard tier.
CREATE TABLE encryption_metadata (
  module               TEXT PRIMARY KEY CHECK (module IN ('vault','media')),
  format_version       INTEGER NOT NULL,
  kdf                  TEXT NOT NULL,
  kdf_params           TEXT NOT NULL,
  wrapped_dek_pw       BLOB NOT NULL,
  wrapped_dek_bio      BLOB,
  wrapped_dek_recovery BLOB,
  dek_check            BLOB NOT NULL,
  keystore_alias       TEXT,
  auto_lock_sec        INTEGER NOT NULL DEFAULT 60,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);
CREATE TABLE vault_entries (
  id         TEXT PRIMARY KEY,
  payload    BLOB NOT NULL,
  schema_ver INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE private_collections (
  id         TEXT PRIMARY KEY,
  payload    BLOB NOT NULL,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE private_media (
  id            TEXT PRIMARY KEY,
  collection_id TEXT REFERENCES private_collections(id) ON DELETE SET NULL,
  blob_name     TEXT NOT NULL UNIQUE,
  thumb_name    TEXT,
  meta          BLOB NOT NULL,
  size_bucket   INTEGER,
  created_at    INTEGER NOT NULL
);

-- Full-text search over the standard tier only. rowid = library_items.rowid.
CREATE VIRTUAL TABLE search_items USING fts5(
  title, body, extra,
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '2 3'
);

CREATE VIEW v_search_source AS
SELECT
  li.rowid AS rid,
  li.id    AS id,
  li.title AS title,
  COALESCE(n.body, TRIM(COALESCE(c.description, '') || ' ' || COALESCE(c.note, ''))) AS body,
  TRIM(
    COALESCE(c.url, '') || ' ' || COALESCE(c.site_name, '') || ' ' ||
    COALESCE((SELECT group_concat(t.name, ' ') FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = li.id), '')
  ) AS extra
FROM library_items li
LEFT JOIN notes n ON n.item_id = li.id
LEFT JOIN clips c ON c.item_id = li.id
WHERE li.deleted_at IS NULL;
`);

    // Reindex helpers expressed as triggers so FTS cannot drift from source tables.
    const reindex = (idExpr: string) => `
  DELETE FROM search_items WHERE rowid = (SELECT rowid FROM library_items WHERE id = ${idExpr});
  INSERT INTO search_items(rowid, title, body, extra)
    SELECT rid, title, body, extra FROM v_search_source WHERE id = ${idExpr};`;

    await tx.exec(`
CREATE TRIGGER trg_items_ai AFTER INSERT ON library_items BEGIN ${reindex('NEW.id')} END;
CREATE TRIGGER trg_items_au AFTER UPDATE ON library_items BEGIN ${reindex('NEW.id')} END;
CREATE TRIGGER trg_items_ad AFTER DELETE ON library_items BEGIN
  DELETE FROM search_items WHERE rowid = OLD.rowid;
END;
CREATE TRIGGER trg_notes_ai AFTER INSERT ON notes BEGIN ${reindex('NEW.item_id')} END;
CREATE TRIGGER trg_notes_au AFTER UPDATE ON notes BEGIN ${reindex('NEW.item_id')} END;
CREATE TRIGGER trg_clips_ai AFTER INSERT ON clips BEGIN ${reindex('NEW.item_id')} END;
CREATE TRIGGER trg_clips_au AFTER UPDATE ON clips BEGIN ${reindex('NEW.item_id')} END;
CREATE TRIGGER trg_item_tags_ai AFTER INSERT ON item_tags BEGIN ${reindex('NEW.item_id')} END;
CREATE TRIGGER trg_item_tags_ad AFTER DELETE ON item_tags BEGIN ${reindex('OLD.item_id')} END;
CREATE TRIGGER trg_tags_au AFTER UPDATE OF name ON tags BEGIN
  DELETE FROM search_items WHERE rowid IN (
    SELECT li.rowid FROM library_items li JOIN item_tags it ON it.item_id = li.id WHERE it.tag_id = NEW.id);
  INSERT INTO search_items(rowid, title, body, extra)
    SELECT s.rid, s.title, s.body, s.extra FROM v_search_source s
    JOIN item_tags it ON it.item_id = s.id WHERE it.tag_id = NEW.id;
END;
`);
  },
};
