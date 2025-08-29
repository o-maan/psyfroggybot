# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Installation and Setup

```bash
bun install                    # Install dependencies
cp example.env .env            # Copy environment variables template
bun run migrate                # Run database migrations
```

### Development

```bash
bun run dev                    # Development mode with auto-restart
bun run start                  # Production start with migrations
bun src/bot.ts                 # Direct execution
```

### Database

```bash
bun run migrate                # Run latest migrations using Knex
```

### Build and Deployment

```bash
bun run build                  # Build for production
bun run pm2:start              # Start with PM2 process manager
bun run lint                   # TypeScript type checking
```

## Architecture Overview

### Core Components

**Bot Service (`src/bot.ts`)**

- Main Telegram bot using Telegraf framework
- Express server for OAuth callbacks and REST endpoints
- Handles all bot commands and message processing
- Manages user interactions and admin commands

**Scheduler (`src/scheduler.ts`)** - Основной модуль планировщика

Класс `Scheduler` управляет автоматической рассылкой психологических сообщений:

**Основные компоненты:**

- `bot: Telegraf` - экземпляр Telegram бота
- `reminderTimeouts: Map<number, NodeJS.Timeout>` - таймеры напоминаний для пользователей
- `users: Set<number>` - набор ID активных пользователей
- `imageFiles: string[]` - массив путей к изображениям лягушки
- `CHANNEL_ID = -1002405993986` - ID канала для публикации
- `CHAT_ID = -1002496122257` - ID группы обсуждений для комментариев
- `calendarService: CalendarService` - сервис интеграции с Google Calendar
- `dailyCronJob: cron.ScheduledTask` - задача ежедневной рассылки
- `interactiveSessions: Map` - состояния интерактивных сессий
- `forwardedMessages: Map` - соответствие ID пересланных сообщений

**Ключевые методы:**

1. **Инициализация:**

   - `constructor()` - загружает изображения, пользователей, запускает cron
   - `loadImages()` - сканирует папку `/images` для jpg/png файлов
   - `loadUsers()` - загружает пользователей из SQLite базы
   - `initializeDailySchedule()` - настраивает cron job на 22:00 MSK

2. **Определение занятости пользователя:**

   - `detectUserBusy(events)` - анализирует календарь через LLM
   - Передает в промпт: название события, время, статус (busy/free), место
   - Возвращает `{probably_busy: boolean, busy_reason: string|null}`

3. **Генерация сообщений:**

   - `generateScheduledMessage(chatId)` - основная логика генерации
   - Получает события календаря с 18:00 до завтра
   - Анализирует занятость через `detectUserBusy()`
   - Выбирает промпт: `scheduled-message-flight.md` (занят) или `scheduled-message.md`
   - Для занятых: упрощенное сообщение (encouragement + задание)
   - Для свободных: полное структурированное сообщение

   **Интерактивная логика (упрощенная версия):**

   - В канал: только картинка + вдохновляющий текст + "Переходи в комментарии и продолжим 😉"
   - В комментарии к посту автоматически: первое задание с кнопкой пропуска
   - Использует `message_thread_id` для отправки в правильный thread комментариев
   - `handleInteractiveUserResponse()` - обрабатывает ответы пользователей в комментариях
   - Анализирует ответы через `analyzeUserResponse()`:
     - Вариант 1: Подробно описал эмоции → слова поддержки + плюшки
     - Вариант 2: Не описал эмоции → уточняющие вопросы
     - Вариант 3: Значимое событие → схема разбора ситуации
   - После плюшек → финальная часть (расслабление/дыхание)
   - Бот игнорирует свои собственные сообщения
   - Обработчик отслеживает пересланные сообщения из канала для fallback логики

4. **Структура обычного сообщения** (`buildScheduledMessageFromHF`):

   - Вдохновляющий текст (всегда)
   - Выгрузка неприятных переживаний (50% вероятность)
   - Плюшки для лягушки (всегда)
   - Чувства и эмоции (всегда)
   - Рейтинг дня (всегда)
   - Расслабление/Дыхание (50/50 выбор)

5. **Отправка сообщений:**

   - `sendDailyMessage(chatId)` - отправка одному пользователю
   - Генерирует текст и AI-изображение лягушки
   - Отправляет в канал с изображением
   - Устанавливает напоминание через 1.5 часа
   - Сохраняет в историю сообщений

6. **Массовая рассылка:**

   - `sendDailyMessagesToAll(adminChatId)` - рассылка всем пользователям
   - Последовательная обработка с `setImmediate()` для неблокирующей работы
   - Сбор статистики успешных/неудачных отправок
   - Отчет администратору после завершения

7. **Система напоминаний:**

   - `setReminder(chatId, sentTime)` - таймер на 1.5 часа
   - Проверяет, ответил ли пользователь
   - Анализирует календарь за последнюю неделю
   - Генерирует персонализированное напоминание

8. **Проверка ответов и злые посты:**

   - `checkUsersResponses()` - проверяет только пользователя 5153477378
   - Запускается через ANGRY_POST_DELAY_MINUTES минут после каждого поста (по умолчанию 600 минут = 10 часов)
   - Если пользователь не ответил - генерирует и отправляет "злой" пост
   - Использует промпты: `no-answer` для текста и `frog-image-promt-angry` для изображения

9. **Управление изображениями:**

   - `getNextImage(chatId)` - циклическая ротация per-user
   - Сохраняет индекс текущего изображения в БД

10. **Служебные методы:**

- `getSchedulerStatus()` - информация о состоянии планировщика
- `destroy()` - корректное завершение работы

**Особенности реализации:**

- Робастная обработка ошибок с fallback механизмами
- Интеграция с Google Calendar для контекстной генерации
- AI-генерация изображений на основе состояния пользователя
- Детальное логирование всех этапов работы
- Уведомления админу о критических ошибках

**Calendar Integration (`src/calendar.ts`)**

- Google Calendar OAuth2 authentication
- Event fetching and formatting for Russian locale
- Flight/airport detection for simplified messaging
- Calendar-aware message generation

**LLM Service (`src/llm.ts`)**

- Hugging Face Inference API integration
- Message generation with structured JSON responses
- Fallback mechanisms for API failures
- Specialized handling for flight scenarios

**Database (`src/db.ts`)**

- SQLite with Bun's native driver
- User management and message history
- Token storage for Google OAuth
- Image index tracking per user

### Key Features

#### Automated Scheduling

- Uses node-cron for reliable daily execution at 22:00 MSK
- Timezone-aware with proper error handling
- Graceful degradation with admin notifications

#### Message Generation

- Context-aware prompts including calendar events
- Structured messaging format with numbered sections
- Random elements (negative feelings, relaxation techniques)
- Flight-specific simplified messages

#### User Management

- Automatic user registration on `/start`
- Response tracking and reminder system
- Admin-only commands with permission checks

#### Image System

- Circular image rotation per user
- SQLite-based index persistence
- Automatic image loading from `/images` directory

### Database Schema

- `users`: chat_id, username, response stats
- `messages`: message history with timestamps
- `user_tokens`: Google OAuth tokens per user
- `user_image_indexes`: per-user image rotation state

### Environment Variables

Required variables in `.env`:

- `TELEGRAM_BOT_TOKEN`: Bot authentication
- `HF_TOKEN`: Hugging Face API key
- `ADMIN_CHAT_ID`: Admin user ID for notifications
- `CHANNEL_ID`: Telegram channel ID for posts
- `CHAT_ID`: Discussion group ID for comments
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: OAuth credentials
- `NODE_ENV`: Environment mode (affects database path)
- `ANGRY_POST_DELAY_MINUTES`: Delay before checking user responses (default: 600)
- `PORT`: Express server port (default: 3000)

### Deployment

The app is designed for production deployment with:

- PM2 process management
- Caddy web server proxy
- Database migrations via Knex
- Automated GitHub Actions deployment
- Telegram notifications for deployment status

### Bot Commands

**User Commands:**

- `/start`: Register and join daily messaging
- `/fro`: Request immediate message
- `/calendar`: Setup Google Calendar integration
- `/test`: Send test message
- `/remind`: Set manual reminder

**Admin Commands:**

- `/status`: Show scheduler status and user count
- `/test_schedule`: Create test cron job for next minute
- `/next_image`: Debug image rotation
- `/minimalTestLLM`: Test LLM connection
- `/test_busy`: Test user busy detection via calendar analysis
- `/test_buttons`: Test comment buttons functionality
- `/test_scenario`: Test scenario selection (simplified/deep work)

### Interactive Messaging Pattern

⚠️ **ОБЯЗАТЕЛЬНО К ПРОЧТЕНИЮ**: [docs/CRITICAL-RULES-DO-NOT-BREAK.md](docs/CRITICAL-RULES-DO-NOT-BREAK.md)

После публикации поста в канале ВСЯ работа с пользователем переходит в комментарии. См. [docs/interactive-messaging-pattern.md](docs/interactive-messaging-pattern.md) для подробного описания правильного паттерна взаимодействия.

Ключевые моменты:
- Всегда используйте `replyToChatId` из контекста сообщения
- Для текстовых сообщений используйте `reply_parameters`
- **Для фото используйте `reply_to_message_id` (НЕ reply_parameters!)**
- НЕ используйте `message_thread_id` при ответах (вызовет ошибку)
- Все обработчики должны создавать классы с `chatId` из контекста

**КРИТИЧЕСКИ ВАЖНО**: sendPhoto с reply_parameters отправит фото в основную группу, а не в комментарии!

## LLM inferring post processing

- Всегда вырезай `<think>...</think>`

## User settings

### Important rules to follow

- Я начинашечка, объясняй понятно и доступно, не используй сложные слова и термины, если не знаешь, спроси у меня
  Когда я прошу тебя объяснить код ты можешь использовать термины, но в скобочках или отдельно объясняй их
- Always respond in Russian. Always write code comments and strings in russian. If you find code/comments/ui texts in english, translate it to russian
- Отвечай программисту в чате по русски, и код/комменты/UI-тексты/коммиты пиши тоже по русски
- Тесты:
  - Технологии: vitest, memfs
  - Пиши тесты в BDD виде, см примеры в файле app/utils/companies.test.ts, разделяй бизнес-логику и детали реализации
- Use playwright mcp, base url: <http://localhost:4000>
  Use it to check your changes and collect additional info about ui layout.
- Никогда не предлагай перезапустить проект (kill, killall, ..., npm run dev) кроме случаев когда изменяются модели базы данных, тогда настаивай на перезапуске но предлагай это сделать мне самостоятельно
- Пиши код и изменения в проекте только на английском, в чат - на русском,
- После выполнения задачи критически оценивай ее результат (не процесс работы над ней) по 10-и бальной шкале когда это уместно и предлагай улучшения,
- Пиши и запускай тесты
- Изучай документацию и проект
- Следуй принципу бритвы Оккама, используй существующие компоненты, утилиты
- По возможности используй dom api, когда это уместно, например input accept
- Не усложняй без необходимости
- Если пользователь сообщает о том что твой подход не работает, добавь логов
- По окончанию проверяй можно ли упростить реализацию и убрать часть изменений

Никогда не делать новые файлы типа v2 одновременно со старыми, у нас и так есть git
При изменении таблиц надо добавлять knex миграции
