import { config } from 'dotenv';
import { Telegraf } from 'telegraf';
import { CalendarService } from './calendar';
import { logger } from './logger';
import { Scheduler } from './scheduler';

// Импортируем функции отслеживания
import { wrapTelegramApi } from './message-handler';

// Импортируем функции регистрации
import { registerMiddleware } from './middleware';
import { registerUserCommands } from './commands/user';
import { registerAdminCommands } from './commands/admin';
import { registerCallbackHandlers } from './handlers/callbacks';
import { registerMessageHandlers } from './handlers/messages';
import { registerInlineHandlers } from './handlers/inline';

// Импортируем серверы
import { createOAuthServer } from './servers/oauth';
import { createWebhookServer } from './servers/webhook';

// Импортируем утилиты
import { clearPendingUpdates } from './utils/clear-updates';

// Загружаем переменные окружения
config();

// Логируем информацию о запуске
logger.info(
  {
    IS_TEST_BOT: process.env.IS_TEST_BOT,
    TOKEN_PREFIX: process.env.TELEGRAM_BOT_TOKEN?.substring(0, 10) + '...',
    NODE_ENV: process.env.NODE_ENV,
  },
  '🤖 Запуск бота'
);

// Создаем экземпляр бота
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN || '');

// Оборачиваем API для отслеживания всех сообщений
wrapTelegramApi(bot);

// Создаем планировщик
const calendarService = new CalendarService();
const scheduler = new Scheduler(bot, calendarService);

// Регистрируем middleware
registerMiddleware(bot, scheduler);

// Регистрируем команды
registerUserCommands(bot, scheduler, calendarService);
registerAdminCommands(bot, scheduler);

// Регистрируем обработчики callback
registerCallbackHandlers(bot, scheduler);

// Регистрируем обработчики сообщений
registerMessageHandlers(bot, scheduler);

// Регистрируем обработчики inline запросов
registerInlineHandlers(bot);

// Быстрая команда для показа последней картинки
bot.command('show_filter', async ctx => {
  try {
    const lastFilterId = 'AgACAgIAAxkBAAIGzmi024_oBkIH9lBHRljpiIz45X1vAAJt-DEbGZqoSTtoREDebC7PAQADAgADeQADNgQ';
    await ctx.reply('📸 Последняя картинка из массива фильтров (Преуменьшение):');
    await ctx.replyWithPhoto(lastFilterId);
  } catch (error) {
    await ctx.reply('Ошибка: ' + (error as Error).message);
  }
});

// Создаем Express серверы
createOAuthServer(bot, calendarService, scheduler);
createWebhookServer(scheduler);

// --- Telegraf polling ---
clearPendingUpdates()
  .then(() => bot.launch())
  .then(() => {
    logger.info({ pid: process.pid, ppid: process.ppid }, '🚀 Telegram бот запущен в режиме polling');

    // Логируем успешный запуск
    logger.info('✅ Polling активен и готов к получению команд');

    // Логируем зарегистрированные обработчики
    logger.info(
      {
        handlers: [
          'test_button_click',
          'logs_*',
          'skip_neg_*',
          'skip_schema_*',
          'pract_done_*',
          'pract_delay_*',
          'callback_query (общий)',
          'daily_skip_all',
          'daily_skip_negative',
          'practice_done_*',
          'practice_postpone_*',
        ],
      },
      '📋 Зарегистрированные обработчики кнопок'
    );

    // Запускаем проверку незавершенных заданий через 5 секунд после старта
    // Даем время боту полностью инициализироваться
    setTimeout(async () => {
      logger.info('🔍 Запуск проверки незавершенных заданий после старта бота...');
      try {
        await scheduler.checkUncompletedTasks();
        logger.info('✅ Проверка незавершенных заданий выполнена');
      } catch (error) {
        logger.error({ error: (error as Error).message }, '❌ Ошибка проверки незавершенных заданий после старта');
      }
    }, 5000);
  })
  .catch(error => {
    logger.error({ error: error.message, stack: error.stack }, '❌ Ошибка запуска бота');
    process.exit(1);
  });

// Отправляем уведомление админу о запуске
const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);
if (adminChatId) {
  const processInfo = `PID: ${process.pid}${process.env.pm_id ? ` | PM2 ID: ${process.env.pm_id}` : ''}`;
  bot.telegram
    .sendMessage(
      adminChatId,
      `🚀 <b>БОТ ЗАПУЩЕН</b>\n\n` + `Телеграм бот успешно запущен в режиме polling\n` + `🔧 ${processInfo}`,
      { parse_mode: 'HTML' }
    )
    .catch(error => {
      logger.error({ error: error.message, adminChatId }, 'Ошибка отправки уведомления админу о запуске');
    });
}

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));