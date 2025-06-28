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

**Scheduler (`src/scheduler.ts`)**

- Cron-based daily message scheduling (19:30 MSK)
- Image rotation system with user-specific indexing
- Reminder system (1.5 hours after message)
- Message generation with calendar integration
- Mass messaging with error handling and admin reporting

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

- Uses node-cron for reliable daily execution at 19:30 MSK
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
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: OAuth credentials
- `NODE_ENV`: Environment mode (affects database path)

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
