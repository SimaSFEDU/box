# Clipbox — Architecture

## 0. Анализ репозитория

Репозиторий пуст (нет коммитов, нет кода). Переиспользовать нечего, ограничений от легаси нет.
Проект создаётся с нуля по структуре ниже.

## 1. Стек — итоговые решения

| Область | Выбор | Решение по промпту |
|---|---|---|
| Runtime | React Native (New Architecture) + **Expo SDK последней стабильной версии** на момент `create-expo-app`, TypeScript `strict` | Принято |
| Сборка | **Expo Dev Client + EAS Build**, CNG (`prebuild`), Expo Go не используется вообще | Уточнено: Expo Go несовместим с нашими native-модулями |
| Навигация | Expo Router (file-based, typed routes) | Принято |
| БД | `expo-sqlite` (WAL, FTS5) + собственный слой репозиториев и миграций | Принято. ORM (Drizzle) **отклонён**: FTS5-триггеры и ручные миграции проще и прозрачнее на чистом SQL |
| Состояние | Zustand — только UI/сессионное состояние; данные — из репозиториев через лёгкий query-хук (`useQuery`-подобный, инвалидация по событиям) | Принято, с ограничением роли |
| Стилизация | **Собственные design tokens + `StyleSheet`** (тема через контекст) | **NativeWind отклонён**: лишний слой Babel/Tailwind, хрупкость при обновлениях Expo, нам нужно ~25 компонентов, а не утилитарный CSS |
| Списки | `@shopify/flash-list` | Добавлено |
| Анимации | Reanimated + Gesture Handler | Принято |
| Markdown Preview | **markdown-it** (+ `markdown-it-task-lists`, highlight.js) в **`react-native-webview`**, офлайн-бандл HTML/CSS/JS | Выбрано вместо `react-native-markdown-display` (не поддерживается, слабые таблицы, нет подсветки). WebView даёт полный GFM и будущие KaTeX/Mermaid «бесплатно» |
| Markdown Source | `TextInput` multiline + собственная панель форматирования (чистые функции над `{text, selection}`) | WYSIWYG-редакторы (TenTap/ProseMirror) отклонены: портят исходный Markdown, противоречат «оригинал в Markdown» |
| Уведомления | `expo-notifications` (локальные) | Принято, см. §7 |
| Файлы | `expo-file-system` для Standard; приватные файлы — только через native-модуль | Уточнено |
| Share Intent | **`expo-sharing` (SDK 58, «сырые» payload)** | Пересмотрено в Этапе 4: `getSharedPayloads()` / `useIncomingShare` отдают исходный `content://` URI **без копирования в кэш** (копирует только режим «resolved», который мы не используем). Поэтому один и тот же приём подходит и для клипов, и для Private Media: в Этапе 7 native-модуль будет шифровать поток прямо из этого URI |
| Биометрия + криптография | Тот же `clipbox-native` (Kotlin): `BiometricPrompt` + `CryptoObject`, Android Keystore, **Google Tink** (AEAD и Streaming AEAD), Argon2id (**Bouncy Castle**) | `expo-local-authentication` и `expo-secure-store` **недостаточны**: первая не привязывает ключ к CryptoObject, вторая не даёт раздельных ключей/политик и потоков |
| Видео | `expo-video` (ExoPlayer) с `content://` из нашего провайдера | Позволяет потоковую расшифровку без временного файла |
| Изображения | `expo-image` | GIF/WebP анимация, кэш отключается для приватных URI |
| Тесты | Jest + `@testing-library/react-native` (JS), JUnit + Robolectric (Kotlin), Maestro (e2e на устройстве/эмуляторе) | Добавлено |
| Качество | ESLint (typescript-eslint strict), Prettier, `tsc --noEmit` в CI (GitHub Actions) | Добавлено |

Версии конкретных пакетов фиксируются при инициализации (`npx expo install` подбирает совместимые);
каждая сторонняя библиотека проходит чек: последний релиз < 12 мес., поддержка New Architecture,
отсутствие открытых critical-issues.

## 2. Слои

```
┌──────────────────────────────────────────────────────────┐
│ src/app/ (Expo Router screens) — только композиция UI    │
├──────────────────────────────────────────────────────────┤
│ src/ui/  design system: tokens, theme, primitives        │
│ src/features/<feature>/components, hooks                 │
├──────────────────────────────────────────────────────────┤
│ src/domain/  сервисы и бизнес-правила (чистый TS)        │
│   notes, clips, reminders, library, search, backup,      │
│   recurrence, markdown-ops, url-classifier               │
├──────────────────────────────────────────────────────────┤
│ src/data/  db (connection, migrations), repositories,    │
│   files (standard storage), metadata fetcher             │
├──────────────────────────────────────────────────────────┤
│ src/secure/  ЕДИНСТВЕННАЯ точка входа в защищённые модули│
│   vaultService, mediaService, lockManager — тонкие       │
│   обёртки над native, без собственной криптографии в JS  │
├──────────────────────────────────────────────────────────┤
│ modules/clipbox-native/ (Kotlin, Expo Modules API)       │
│   crypto/  keystore, tink, argon2, keyhierarchy          │
│   biometric/  BiometricPrompt + CryptoObject             │
│   vault/  шифрование записей                             │
│   media/  streaming store, thumbnails, ContentProvider   │
│   share/  входящий intent, исходящий share               │
│   secure-ui/ FLAG_SECURE, clipboard                      │
└──────────────────────────────────────────────────────────┘
```

Правила (проверяются ESLint `no-restricted-imports`):
- `src/app/` и `src/ui` не импортируют `src/data/db` напрямую — только хуки/сервисы из `features`/`domain`.
- `src/domain` не импортирует React.
- Только `src/secure` импортирует `clipbox-native` crypto/vault/media API.
- Ни один JS-модуль не реализует криптографию.

## 3. Структура каталогов

Expo SDK 58 размещает маршруты в `src/app/` (не в корневом `app/`).

```
src/app/
  _layout.tsx                # providers, theme, db init, share-intent listener
  (tabs)/_layout.tsx         # bottom tabs + центральная кнопка
  (tabs)/index.tsx           # Home
  (tabs)/library.tsx
  (tabs)/reminders.tsx
  (tabs)/settings.tsx
  note/[id].tsx              # editor (source/preview)
  clip/[id].tsx
  reminder/[id].tsx
  collection/[id].tsx
  capture/share.tsx          # упрощённый экран Share Intent (modal)
  search.tsx
  private/_layout.tsx        # гейт: FLAG_SECURE + lock state
  private/vault/index.tsx, [id].tsx, generator.tsx
  private/media/index.tsx, [id].tsx, collection/[id].tsx
  private/setup.tsx          # первичная настройка + Recovery Kit
src/ ...                     # см. §2
modules/clipbox-native/
  android/src/main/java/app/clipbox/native/...
  src/ (TS-обёртки и типы)
  plugin/ (config plugin: intent-filters, provider, permissions)
assets/markdown/preview.html # офлайн-бандл markdown-it + highlight.js + CSS тем
docs/
```

## 4. Модель данных (кратко)

Supertype `library_items` (общие поля: id, kind, title, favorite, archived, inbox, timestamps) +
subtype-таблицы `notes`, `clips`. Теги, коллекции, вложения, связи ссылаются на `library_items.id`.
Защищённые модули — отдельные таблицы с BLOB-шифртекстом, **без внешних ключей на Standard-уровень**.
Подробно — DATABASE_SCHEMA.md.

ID — ULID (сортируемые по времени, генерируются на клиенте, безопасны для будущей синхронизации).
Время — `INTEGER` unix ms UTC.

## 5. Файловое хранилище

```
<filesDir>/
  attachments/<ulid>.<ext>     # вложения заметок и файлы клипов (Standard)
  previews/<ulid>.webp         # превью клипов
  private/
    media/<ulid>.bin           # Tink StreamingAead, AES256_GCM_HKDF_1MB
    thumbs/<ulid>.bin          # зашифрованная миниатюра (AEAD)
    keys/                      # обёрнутые DEK (см. SECURITY)
<cacheDir>/
  share-out/                   # только fallback для отправки, чистится (SECURITY §7)
  import/                      # временные файлы импорта, чистятся после операции
```

- `.nomedia` во всех каталогах (на всякий случай; внутреннее хранилище и так не сканируется).
- `android:allowBackup="false"` и `dataExtractionRules`, исключающие всё: ключи Keystore не
  переносятся, и облачный бэкап Google восстановил бы неработающий шифртекст + раскрыл бы
  Standard-данные третьей стороне.
- Запись файлов: write-to-temp → fsync → rename (атомарность); запись в БД после успешного rename;
  при старте — сборщик сирот (файл без строки / строка без файла → помечается `missing`).

## 6. Ключевые подсистемы

### 6.1 Инициализация
`_layout` → open DB (WAL, `foreign_keys=ON`) → run migrations в транзакции → загрузка настроек →
восстановление черновиков → подписка на Share Intent → reconcile уведомлений (§7) → рендер.
Ошибка миграции → экран восстановления (экспорт сырой БД, повтор), а не белый экран.

### 6.2 Редактор и автосохранение (реализовано в Этапе 3)
- Решение: отдельные черновики не нужны — автосохранение пишет прямо в `notes` через 600 мс
  после последнего ввода, а также немедленно при уходе приложения в фон и при закрытии экрана.
  При убийстве процесса теряется максимум ~0.6 с ввода. Сохранение без изменений не трогает
  `updated_at`. Таблица `note_drafts` оставлена в схеме v1 как резерв (например, для
  конфликтов при будущей синхронизации) и сейчас не используется.
- Заголовок — отдельное поле (как имя файла в Obsidian); при пустом заголовке для показа и
  экспорта берётся `deriveTitle(body)` (frontmatter `title:` → первый заголовок → первая строка).
- Новая заметка, которую открыли и закрыли пустой, удаляется автоматически.
- Удаление — в корзину; корзина очищается через 30 дней при старте, файлы вложений удаляются
  после коммита транзакции через `file_gc`.
- Source⇄Preview: один источник истины — строка Markdown. Рендер выполняется **внутри WebView**
  (markdown-it + highlight.js + наш рендерер собраны esbuild в строку
  `previewBundle.generated.ts`, `npm run build:preview`; `npm run check` проверяет актуальность).
  Так Hermes не исполняет markdown-it, а JS-поток приложения не блокируется на больших заметках.
  Клики по чекбоксам приходят как `{type:'toggleTask', line}` → `toggleTaskAtLine(md, line)`;
  ссылки открываются в системном браузере, WebView никуда не навигирует.
- Безопасность Preview: `html: false` (сырой HTML экранируется), только http/https/mailto/tel и
  относительные ссылки, CSP `default-src 'none'`, изображения только `file:` и `data:` —
  **внешние картинки не загружаются** (защита от трекинг-пикселей и офлайн-предсказуемость),
  показывается плашка «внешнее изображение».

### 6.2.1 Импорт/экспорт заметок
- Экспорт: ZIP `Notes/<папка>/<Заголовок>.md` + `attachments/` + `clipbox.json` (метаданные,
  теги, флаги, даты, SHA-256 каждого файла). Ссылки на вложения переписываются в относительные,
  поэтому архив открывается в Obsidian как vault.
- Импорт: `.md`, `.zip` (архив Clipbox или упакованный vault), папка через системный выбор (SAF).
  Архив Clipbox сначала полностью проверяется по контрольным суммам; при несовпадении — отказ.
  Повторный импорт не создаёт дублей (по id для архивов Clipbox, по исходному пути для vault).
  Пропускаются `.obsidian`, `.trash`, `.git`. Теги берутся из frontmatter.
- Obsidian-встраивания картинок `![[img.png|alt]]` конвертируются в стандартный
  `![alt](attachments/…)`, чтобы работали превью и любой другой Markdown-редактор. Остальные
  `[[wikilinks]]` и `![[note]]` сохраняются как есть (поддержка — после MVP).
- Логика (`src/domain/notes/archive.ts`) чистая и покрыта тестами; I/O — в `archiveService.ts`.

### 6.3 Clips pipeline (реализовано в Этапе 4)
- Share → `clipbox://expo-sharing` → `/share`. Экран быстрого сохранения: одна кнопка
  «Сохранить» кладёт всё в Inbox; комментарий и коллекции опциональны. Сеть не нужна.
- Текст с URL → клип; текст без URL → заметка в Inbox; файлы (изображения, PDF, любые) →
  копия во внутреннее `attachments/` (лимит 200 МБ) → файловый клип.
- Дубликаты: по `canonical_url` (нормализация хоста, удаление utm/fbclid/si…, формы YouTube);
  пользователь видит предупреждение, но может сохранить копию.
- Метаданные: oEmbed (YouTube, TikTok, Reddit, Spotify, SoundCloud), затем Open Graph / Twitter /
  `<title>`. Ручные редиректы с SSRF-проверкой каждого шага, таймаут 8 с, HTML ≤ 512 КБ
  (обрезается), превью ≤ 2 МБ, только image/*. Без cookies. Пользовательский заголовок никогда не
  перезаписывается. Очередь single-flight: после сохранения, при старте и при возврате в приложение;
  3 попытки, затем `failed` с кнопкой «Повторить».
- Превью сохраняется как есть (без ресайза — отдельная зависимость не окупается на MVP).

Исходный план:
`ShareIntent → classify(url/mime) → create item (inbox=1, meta_status=pending) → UI сразу закрывается
→ MetadataQueue (персистентная, по meta_status) → fetch (timeout 8s, 512KB, только http/https,
запрет приватных IP) → parse OG/oEmbed → download preview → update`. Очередь продолжается при
следующем запуске; 3 попытки с backoff.

### 6.4 Ошибки
`Result<T, AppError>` в domain/data; `AppError = {code, userMessage, cause?}` с кодами
(`DB_*`, `FS_*`, `NET_*`, `CRYPTO_*`, `AUTH_*`). UI: toast для восстанавливаемых, экран-заглушка
для фатальных. Глобальный ErrorBoundary. Логгер с уровнями, в release — только `warn+`, и
**редактор логов**, который не принимает объекты из `src/secure` (тип `Redacted`).

### 6.5 Поиск
FTS5 `search_items` (rowid = `library_items.rowid`) с триггерами на library_items/notes/clips/
item_tags/tags; reminders/collections/tags — `LIKE` (см. DATABASE_SCHEMA). Токенайзер `unicode61 remove_diacritics 2` (кириллица ок). Запрос: экранирование,
префикс `*`, `bm25` + бонус за свежесть.

## 7. Напоминания (Android-специфика)

- `expo-notifications` планирует через AlarmManager и **сам перепланирует после reboot**.
- Точность: просим `SCHEDULE_EXACT_ALARM` (Android 12+; на 14+ не выдаётся по умолчанию) — если
  нет разрешения, работаем с inexact и показываем в Settings подсказку. `USE_EXACT_ALARM` не
  используем (Play-политика только для будильников/календарей).
- `POST_NOTIFICATIONS` (13+) запрашиваем в контексте — при создании первого напоминания.
- Повторения: **не** полагаемся на системные repeating-триггеры (не умеют «31-го → последний день»,
  «каждые 3 недели»). Планируем **только ближайшее** вхождение; при срабатывании/действии/открытии
  приложения — `reconcile()` вычисляет следующее через чистую функцию `nextOccurrence(rule, after, tz)`
  и перепланирует. Дополнительно держим запас в 2 будущих вхождения на случай, если приложение
  долго не открывали.
- Часовые пояса: хранится локальная дата-время + IANA-зона. Режим по умолчанию «floating»
  (09:00 остаётся 09:00 в новой зоне); `reconcile` на смене зоны (`AppState active` + сравнение
  `Intl` зоны).
- Источник истины — таблица `reminders`; ID системного уведомления хранится в
  `reminder_schedule`. `reconcile()` идемпотентен.

## 8. Нативный модуль `clipbox-native` — публичный API (TS)

```ts
// lock / keys
getSecuritySetup(): Promise<{vault: ModuleState; media: ModuleState; biometric: BiometricAvailability}>
setupModule(m: 'vault'|'media', p: {masterPassword: string; enableBiometric: boolean}): Promise<{recoveryKey?: string}>
unlockWithBiometric(m): Promise<UnlockResult>       // BiometricPrompt + CryptoObject
unlockWithPassword(m, password): Promise<UnlockResult>
lock(m): void; lockAll(): void
// vault (данные в JS только во время показа)
vaultList(): Promise<VaultEntrySummary[]>            // расшифровка в native, лишь нужные поля
vaultGet(id), vaultPut(entry), vaultDelete(id)
generatePassword(opts): string
copySensitive(text, clearAfterMs): void
// media
mediaImport(sourceUri | shareToken, collectionId?): Promise<MediaItem>
mediaThumbnailUri(id): string                        // content://app.clipbox.secure/thumb/<id>?t=<session>
mediaContentUri(id): string
mediaShare(ids): Promise<void>                       // исходящий ACTION_SEND
// share intent
getInitialShare(): Promise<SharePayload|null>; addShareListener(cb)
// secure ui
setSecureWindow(on: boolean): void
```

## 9. Платформа
- `minSdk 29` (Android 10): scoped storage, стабильный BiometricPrompt, Keystore с StrongBox-опцией.
  Покрывает >90% активных устройств; поддержка 8/9 удваивает тестовую матрицу ради малой доли.
- `targetSdk` — требуемый Google Play на момент релиза.
- Только Android в MVP; JS-код без `Platform.OS === 'android'` ветвлений в domain-слое,
  чтобы iOS позже был добавлением native-реализации.

## 10. Решения, принятые самостоятельно (с компромиссами)

1. **Нет crash-reporting SDK в MVP.** Плюс — ноль сетевых утечек и доверие; минус — не видим
   краши у пользователей. Компромисс: локальный журнал ошибок (без данных), который пользователь
   может сам экспортировать.
2. **Standard-уровень SQLite не шифруется (нет SQLCipher).** Android FBE + песочница защищают
   от не-root атакующего; SQLCipher дал бы мало (ключ всё равно на устройстве без запроса
   пользователя) и стоил бы FTS-производительности и совместимости с `expo-sqlite`.
   Всё, что требует настоящей секретности, — в Vault/Media.
3. **WebView для Preview.** Цена — ~80–150 мс на первую инициализацию; решаем прогревом
   WebView на экране заметки и одним переиспользуемым инстансом.
4. **Собственный native-модуль вместо 3–4 сторонних.** Больше кода на Kotlin, но вся
   криптография и безопасность в одном аудируемом месте с тестами.
5. **Tink вместо ручного AES-GCM.** Tink — проверенная библиотека Google, даёт streaming AEAD с
   произвольным доступом (перемотка видео) и защиту от ошибок nonce. Ручной формат был бы
   «самописной криптографией» в смысле протокола.

## 11. Фактическое состояние (после Этапа 2)

- Expo SDK 58, React Native 0.88, React 19.3, TypeScript 6 (`strict`, `noUncheckedIndexedAccess`).
- `src/core` — `Result`, `AppError`, логгер с `Redacted`, ULID (источник случайности внедряется:
  `expo-crypto` в приложении, `crypto` Node в тестах).
- `src/data/db` — интерфейс `SqlDb`, адаптер expo-sqlite; тесты используют better-sqlite3 с тем же SQL.
- `src/data/files/storage.ts` — атомарная запись (temp → rename), `.nomedia`, очередь `file_gc`.
- `src/stores` — Zustand только для настроек и кэша Home; источник истины — SQLite.
- `modules/clipbox-native` — локальный Expo-модуль (autolinking из `modules/`), пока только
  `setSecureWindow` (FLAG_SECURE + `setRecentsScreenshotEnabled`). Крипто-API добавляются в Этапе 6.
- Тесты: проект `logic` (node + настоящий SQLite) и `ui` (jest-expo + Testing Library).
  Reanimated в UI-тестах заменён минимальным собственным моком: официальный мок этой версии
  инициализирует нативные worklets под Jest.
- Этап 3: в `expo-sharing` SDK 58 появился приём входящих Share-интентов
  (`getSharedPayloads`). В Этапе 4 он будет оценён для Standard-уровня (клипы); для Private
  Media по-прежнему нужен собственный модуль (шифрование потока до записи на диск).
- Этап 4: общие операции над элементами (флаги, теги, корзина, удаление с GC файлов) вынесены
  в `itemsRepo`; `notesRepo` и `clipsRepo` его расширяют. `useAsync` + `useDataVersion` —
  единый способ загрузки данных на экранах и обновления после фоновых изменений.
- Нельзя проверить в облачном контейнере: компиляцию Kotlin/Gradle (нет Android SDK) и запуск на
  устройстве. Проверено: `tsc`, ESLint, Jest, `expo export` (Android JS-бандл), `expo prebuild`
  (манифест, autolinking модуля, FTS-флаг).
