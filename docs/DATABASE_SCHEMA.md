# Clipbox — Database Schema (SQLite, v1)

Одна БД `clipbox.db` (`expo-sqlite`). PRAGMA при открытии:
`journal_mode=WAL; foreign_keys=ON; synchronous=NORMAL; busy_timeout=5000`.
Все id — ULID `TEXT`. Время — `INTEGER` unix ms UTC. Булевы — `INTEGER 0/1` с `CHECK`.

## 1. Standard-уровень

```sql
CREATE TABLE library_items (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('note','clip')),
  title        TEXT NOT NULL DEFAULT '',
  favorite     INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0,1)),
  archived     INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  inbox        INTEGER NOT NULL DEFAULT 0 CHECK (inbox IN (0,1)),
  category_id  TEXT REFERENCES categories(id) ON DELETE SET NULL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  deleted_at   INTEGER            -- корзина (30 дней), затем hard delete
);
CREATE INDEX ix_items_list   ON library_items(deleted_at, archived, kind, updated_at DESC);
CREATE INDEX ix_items_inbox  ON library_items(inbox) WHERE inbox = 1 AND deleted_at IS NULL;
CREATE INDEX ix_items_fav    ON library_items(favorite) WHERE favorite = 1 AND deleted_at IS NULL;

CREATE TABLE notes (
  item_id    TEXT PRIMARY KEY REFERENCES library_items(id) ON DELETE CASCADE,
  format     TEXT NOT NULL CHECK (format IN ('text','markdown','checklist')),
  body       TEXT NOT NULL DEFAULT '',   -- оригинальный Markdown, включая frontmatter
  source_path TEXT                        -- относительный путь при импорте из Obsidian
);

CREATE TABLE note_drafts (
  item_id     TEXT PRIMARY KEY REFERENCES library_items(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  sel_start   INTEGER, sel_end INTEGER,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE clips (
  item_id       TEXT PRIMARY KEY REFERENCES library_items(id) ON DELETE CASCADE,
  url           TEXT,                     -- NULL для чистых файлов
  canonical_url TEXT,
  content_type  TEXT NOT NULL CHECK (content_type IN
     ('link','article','youtube','tiktok','reddit','music','game','ai_tool','image','pdf','file')),
  description   TEXT,
  site_name     TEXT,
  preview_path  TEXT,                     -- относительный путь в previews/
  attachment_id TEXT REFERENCES attachments(id) ON DELETE SET NULL,
  note          TEXT,                     -- комментарий пользователя
  meta_status   TEXT NOT NULL DEFAULT 'pending' CHECK (meta_status IN ('pending','ok','failed','skipped')),
  meta_attempts INTEGER NOT NULL DEFAULT 0,
  meta_fetched_at INTEGER
);
CREATE INDEX ix_clips_url  ON clips(canonical_url);           -- поиск дубликатов при сохранении
CREATE INDEX ix_clips_meta ON clips(meta_status) WHERE meta_status = 'pending';

CREATE TABLE categories (            -- плоский справочник (Clips: «Статьи», «Музыка»…)
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color TEXT, sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE tags (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, created_at INTEGER NOT NULL
);
CREATE TABLE item_tags (
  item_id TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
) WITHOUT ROWID;
CREATE INDEX ix_item_tags_tag ON item_tags(tag_id);

CREATE TABLE collections (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, icon TEXT, color TEXT,
  sort INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE collection_items (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  item_id       TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
  position      REAL NOT NULL,          -- дробная позиция для drag&drop без перенумерации
  added_at      INTEGER NOT NULL,
  PRIMARY KEY (collection_id, item_id)
) WITHOUT ROWID;
CREATE INDEX ix_coll_items_item ON collection_items(item_id);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  item_id TEXT REFERENCES library_items(id) ON DELETE CASCADE,
  rel_path TEXT NOT NULL UNIQUE,         -- attachments/<ulid>.<ext>
  original_name TEXT, mime TEXT NOT NULL, size INTEGER NOT NULL,
  sha256 TEXT NOT NULL, width INTEGER, height INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_att_item ON attachments(item_id);
-- Удаление файла с диска делает сервис после COMMIT (журнал file_gc), а не триггер.

CREATE TABLE item_relations (       -- заметка ↔ клип, будущие wikilinks
  from_id TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
  to_id   TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
  rel     TEXT NOT NULL CHECK (rel IN ('related','link','embed')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (from_id, to_id, rel)
) WITHOUT ROWID;

CREATE TABLE reminders (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL, notes TEXT,
  item_id TEXT REFERENCES library_items(id) ON DELETE SET NULL,
  collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL,
  due_local TEXT NOT NULL,            -- 'YYYY-MM-DDTHH:mm' (wall clock)
  tz TEXT NOT NULL,                   -- IANA, напр. 'Europe/Moscow'
  tz_mode TEXT NOT NULL DEFAULT 'floating' CHECK (tz_mode IN ('floating','fixed')),
  repeat_rule TEXT,                   -- JSON: {freq:'daily'|'weekly'|'monthly'|'yearly'|'interval', every:n, unit?, byWeekday?:[1..7], byMonthDay?}
  repeat_until INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','done','snoozed')),
  next_fire_at INTEGER,               -- вычисленный UTC момент ближайшего срабатывания
  snoozed_until INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX ix_rem_next ON reminders(status, next_fire_at);

CREATE TABLE reminder_schedule (     -- что фактически запланировано в ОС
  reminder_id TEXT NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
  fire_at INTEGER NOT NULL,
  os_notification_id TEXT NOT NULL,
  PRIMARY KEY (reminder_id, fire_at)
) WITHOUT ROWID;

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID; -- JSON values
CREATE TABLE file_gc (rel_path TEXT PRIMARY KEY, queued_at INTEGER NOT NULL) WITHOUT ROWID;
```

### FTS (только Standard)

```sql
CREATE VIRTUAL TABLE search_items USING fts5(
  title, body, extra,                      -- extra: url, site_name, имена тегов
  tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3'
);
-- rowid = library_items.rowid → удаление/обновление по rowid без сканирования.
CREATE VIEW v_search_source AS ...;        -- собирает title/body/extra для элемента
```
Триггеры на `library_items`, `notes`, `clips`, `item_tags`, `tags(name)` делают
`DELETE ... WHERE rowid = X; INSERT ... SELECT FROM v_search_source WHERE id = X`, поэтому индекс
не может разойтись с данными, а элементы с `deleted_at` выпадают из поиска автоматически.

Решение (отклонение от v0 документа): Reminders, Collections и Tags — маленькие таблицы, они ищутся
через `LIKE` в том же поисковом сервисе; отдельный FTS для них не окупается.
Пользовательский ввод экранируется (`toFtsQuery`: каждый токен в кавычках + префикс `*`),
поэтому синтаксис FTS5 из запроса не интерпретируется (покрыто тестом).

## 2. Защищённый уровень

Никаких FK на Standard-таблицы (иначе структура связей раскрывает содержимое и смешивает уровни).
Все пользовательские поля — внутри шифртекста. Открыто хранится только то, что нужно для
сортировки и не несёт смысла.

```sql
CREATE TABLE encryption_metadata (
  module        TEXT PRIMARY KEY CHECK (module IN ('vault','media')),
  format_version INTEGER NOT NULL,
  kdf           TEXT NOT NULL,          -- 'argon2id'
  kdf_params    TEXT NOT NULL,          -- JSON {m_kib,t,p,salt_b64}
  wrapped_dek_pw    BLOB NOT NULL,      -- DEK, обёрнутый KEK(мастер-пароль)
  wrapped_dek_bio   BLOB,               -- DEK, обёрнутый Keystore-ключом с биометрией
  wrapped_dek_recovery BLOB,            -- DEK, обёрнутый KEK(recovery key), опционально
  dek_check     BLOB NOT NULL,          -- AEAD(DEK, "clipbox-check:"||module) — проверка правильности
  keystore_alias TEXT,
  auto_lock_sec INTEGER NOT NULL DEFAULT 60,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);

CREATE TABLE vault_entries (
  id TEXT PRIMARY KEY,
  payload BLOB NOT NULL,      -- Tink AEAD(DEK_vault, JSON{type,title,fields[],url,notes,favorite}, AD = id||schema_ver)
  schema_ver INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);

CREATE TABLE private_collections (
  id TEXT PRIMARY KEY,
  payload BLOB NOT NULL,      -- AEAD(DEK_media, {name,color}, AD=id)
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE private_media (
  id TEXT PRIMARY KEY,
  collection_id TEXT REFERENCES private_collections(id) ON DELETE SET NULL,
  blob_name TEXT NOT NULL UNIQUE,      -- случайное имя в private/media/, не связано с оригиналом
  thumb_name TEXT,
  meta BLOB NOT NULL,                  -- AEAD(DEK_media, {originalName,mime,size,w,h,durationMs,favorite,note,sha256}, AD=id)
  size_bucket INTEGER,                 -- округлённый размер для сортировки без раскрытия точного
  created_at INTEGER NOT NULL
);
```

Поиск/сортировка по имени, избранному внутри Vault/Media — в памяти после расшифровки `meta`.
Объём (тысячи записей) это позволяет.

## 3. Миграции

- Таблица `schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER)`.
- Миграции — массив `{version, up(db)}` в `src/data/db/migrations/NNNN_name.ts`, только вперёд.
- Каждая миграция — в одной транзакции; перед миграцией с потерей данных — копия
  `clipbox.db` → `clipbox.db.bak-v<N>` (удаляется после успешного старта следующей версии).
- Тест: каждая миграция прогоняется на снапшотах БД всех предыдущих версий (Jest + better-sqlite3
  в node с той же SQL).

## 4. Транзакции и целостность
- Создание клипа с файлом: копирование файла (temp → rename) → транзакция (item + clip + attachment)
  → при ошибке файл в `file_gc`.
- Удаление: soft delete → корзина → hard delete в транзакции → `file_gc` → удаление файлов после COMMIT.
- На старте: `PRAGMA quick_check` (дёшево); при ошибке — экран восстановления из `.bak`/бэкапа.
