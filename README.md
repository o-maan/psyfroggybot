# Telegram Bot дневник хорошего/плохого за день [![Fly Deploy](https://github.com/o-maan/psyfroggybot/actions/workflows/fly-deploy.yml/badge.svg)](https://github.com/o-maan/psyfroggybot/actions/workflows/fly-deploy.yml)

Этот бот отправляет ежедневные сообщения с картинками в 19:30 и напоминает, если пользователь не ответил.

Использует ИИ и примеры для генерации текста

## Установка

1. Установите [Bun](https://bun.sh)
2. Клонируйте репозиторий
3. Установите зависимости:

```bash
bun install
```

## Настройка

1. Создайте файл `.env` в корневой папке
2. Добавьте в него следующие переменные:

```
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
HUGGINGFACE_API_KEY=your_huggingface_api_key_here
```

3. Создайте папку `images` и добавьте в неё картинки (jpg, png, jpeg)

## Запуск

```bash
bun run dev
```

## Использование

1. Найдите бота в Telegram
2. Отправьте команду `/start`
3. Бот будет отправлять сообщения каждый день в 19:30
4. Если вы не ответите, бот напомнит через 1.5 часа
