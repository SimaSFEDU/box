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
| Share Intent | **Собственный Expo Module `clipbox-native`** + Config Plugin | Сторонний `expo-share-intent` отклонён: нам нужно шифровать входящий поток **до** записи на диск (Private Media), а библиотека копирует файл в кэш открытым |
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
│ app/ (Expo Router screens)  — только композиция UI       │
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
- `app/` и `src/ui` не импортируют `src/data` напрямую — только хуки/сервисы из `features`/`domain`.
- `src/domain` не импортирует React.
- Только `src/secure` импортирует `clipbox-native` crypto/vault/media API.
- Ни один JS-модуль не реализует криптографию.

## 3. Структура каталогов

```
app/
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

### 6.2 Редактор и черновики
- Состояние редактора локально в компоненте; каждые 800 мс и на `AppState=background` → запись в
  `note_drafts` (id, body, selection, updated_at). При явном сохранении/выходе — транзакция:
  `notes.body = draft.body`, удалить draft.
- На старте: если есть draft новее заметки → баннер «Восстановлен несохранённый текст».
- Source⇄Preview: один источник истины — строка Markdown; Preview получает её через
  `postMessage`, клики по чекбоксам возвращают номер строки → чистая функция `toggleTask(md, line)`.

### 6.3 Clips pipeline
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
FTS5 `search_index(item_id, kind, title, body, tags)` с триггерами на notes/clips/reminders/
collections/tags. Токенайзер `unicode61 remove_diacritics 2` (кириллица ок). Запрос: экранирование,
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
