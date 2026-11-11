# Clipbox — Roadmap

Каждый этап заканчивается: зелёный `tsc`, ESLint, Jest (+ JUnit для native), сборка Dev Build через
EAS, отчёт «реализовано / протестировано / осталось».

| Этап | Содержание | Критерий приёмки |
|---|---|---|
| **1. Проектирование** ✅ | 5 документов, решения по стеку | Документы в репозитории |
| **2. Инфраструктура** ✅ | `create-expo-app` (TS strict), Expo Router, табы + Quick Capture sheet, design tokens + темы (system/light/dark), ~15 UI-примитивов, SQLite + миграции v1 + репозитории, Zustand (UI-стор), `Result/AppError`, логгер с redaction, файловое хранилище с атомарной записью и GC, скелет `clipbox-native` + config plugin, CI (GitHub Actions: typecheck, lint, test) | Приложение запускается на устройстве, переключает темы, миграции покрыты тестами |
| **3. Notes & Markdown** | Редактор Source + toolbar, Preview (WebView markdown-it, highlight.js, task lists, таблицы), черновики, вложения-картинки, FTS-поиск, теги/коллекции/избранное/архив/корзина, импорт `.md`/ZIP/Obsidian (SAF), экспорт `.md`/ZIP, JSON backup | Round-trip импорт→экспорт Obsidian vault без потерь (тест на фикстуре) |
| **4. Clips & Share** | Native Share Intent (text, image, video, pdf, multiple), share-экран, классификатор URL, MetadataQueue (OG/oEmbed, SSRF-фильтр), превью, Inbox, категории, дедуп по canonical URL | Ручной прогон из Chrome, YouTube, TikTok, Reddit, Telegram, галереи; офлайн сохранение работает |
| **5. Reminders** | Модель + `nextOccurrence` (100% unit-покрытие: DST, 31-е, високосный), планирование, reconcile, действия в уведомлении, разрешения, привязка к элементам | Срабатывание после перезагрузки, смены зоны, в Doze (ручной тест) |
| **6. Vault** | 6a: native crypto core (Tink, Keystore, Argon2id, обёртки, LockManager) + JUnit; 6b: setup/unlock/recovery UX; 6c: записи, генератор, буфер, поиск | Пункты 1,2,4–12,14 тест-плана SECURITY §12 |
| **7. Private Media** | Streaming store, импорт из Share без открытых копий, миниатюры, SecureMediaProvider, галерея/просмотрщик/видео/GIF, коллекции, мультивыбор, отправка, `.cbvault` бэкап | Пункты 2,3,5,11,13 тест-плана; видео 2 ГБ без OOM |
| **8. Полировка** | UX-аудит, анимации, empty/error states, accessibility (TalkBack), профилирование (старт, списки 10k), офлайн-прогон, Maestro e2e, release build (R8, подпись, AAB) | Все критерии готовности из промпта |

## Риски

| Риск | Вероятность | Влияние | Митигация |
|---|---|---|---|
| Kotlin-модуль (крипто + провайдеры) — основной объём сложности | Высокая | Высокое | Этап 6a изолирован, сначала тесты, потом UI; Tink снимает протокольные риски |
| Отправка через `ProxyFileDescriptorCallback` не принимается частью приложений | Средняя | Среднее | Fallback во временный файл с гарантированной очисткой (SECURITY §7) |
| Точные будильники недоступны на Android 14+ без разрешения | Высокая | Низкое | Inexact + объяснение в Settings; напоминания всё равно срабатывают (± минуты) |
| Производительность Argon2id на слабых устройствах | Средняя | Низкое | Калибровка с нижней границей; индикатор при разблокировке паролем |
| JS-слой видит расшифрованные поля Vault во время показа | Определённая | Среднее | Минимальные выборки, нет persist, lock очищает сторы; задокументировано (T10) |
| Обновления Expo SDK ломают native-модуль | Средняя | Среднее | Expo Modules API (стабильный), CNG, без ручных правок `android/` |
| WebView-preview тормозит на огромных заметках (>1 MB) | Низкая | Низкое | Рендер по требованию, лимит + сообщение, Source всегда работает |
| Тестировать Share/биометрию в облачном CI нельзя | Определённая | Среднее | JUnit/Robolectric для логики, обязательный ручной прогон на устройстве по чек-листу перед релизом этапа |

## Будущее (после MVP, архитектура готова)
Wikilinks/embeds/callouts/KaTeX/Mermaid (плагины markdown-it), Autofill Service (тот же Vault DEK,
новый native-сервис), настраиваемый Home, iOS (native-реализация того же TS-API), опциональная
E2E-синхронизация (ULID + updated_at уже заложены).
