# Clipbox

**Your mind, organized.** Notes, knowledge, ideas and everything worth remembering.

Clipbox — local-first Android-приложение: заметки и Markdown, библиотека клипов, напоминания,
зашифрованный Vault и зашифрованное хранилище Private Media. Без аккаунта, без сервера, без рекламы.

## Документация (Этап 1 — проектирование)

| Документ | Содержание |
|---|---|
| [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md) | Продукт, сценарии, границы MVP |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Стек, слои, модули, нативная часть, решения по спорным пунктам |
| [docs/DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md) | SQLite-схема, индексы, FTS, миграции |
| [docs/SECURITY_DESIGN.md](docs/SECURITY_DESIGN.md) | Модель угроз, иерархия ключей, восстановление, тест-план |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Этапы, критерии приёмки, риски |

Статус: Этапы 2–5 (инфраструктура, заметки и Markdown, клипы и Android Share, напоминания) завершены.

## Разработка

Нужен Android Development Build — Expo Go не поддерживается (свой нативный модуль).

```bash
npm install
npx expo run:android            # локально, нужен Android SDK
# или: npx eas-cli@latest build --profile development --platform android
npm start                       # Metro для dev client
npm run check                   # preview bundle up-to-date + typecheck + lint + tests
npm run build:preview           # пересобрать офлайн-бандл Markdown-превью
```

Структура: `src/app` — экраны (Expo Router), `src/ui` — дизайн-система, `src/features` — хуки и
сценарии, `src/stores` — Zustand, `src/data` — SQLite, миграции, репозитории, файлы,
`src/core` — ошибки, логгер, ULID, `modules/clipbox-native` — Kotlin-модуль, `tests/` — Jest.
