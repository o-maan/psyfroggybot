import { config } from 'dotenv';
import { Telegraf } from 'telegraf';
import { CalendarService } from './calendar';
import { logger } from './logger';
import { Scheduler } from './scheduler';

// Импортируем функции отслеживания
import { wrapTelegramApi } from './message-handler';

// Импортируем функции регистрации
import { registerAdminCommands } from './commands/admin';
import { registerUserCommands } from './commands/user';
import { registerCallbackHandlers } from './handlers/callbacks';
import { registerInlineHandlers } from './handlers/inline';
import { registerMessageHandlers } from './handlers/messages';
import { registerMiddleware } from './middleware';

// Импортируем серверы
import { createOAuthServer } from './servers/oauth';
import { createWebhookServer } from './servers/webhook';

// Импортируем утилиты
import { clearPendingUpdates } from './utils/clear-updates';
import { recoverUnansweredMessages } from './utils/recovery';

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

// Экспортируем scheduler для использования в других модулях (например, interactive-tracker)
export { scheduler };

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

// --- Telegraf polling с автоматическим перезапуском ---
const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);
let retryCount = 0;
const MAX_RETRY_DELAY = 60000; // Максимальная задержка 60 секунд
const BASE_RETRY_DELAY = 5000; // Начальная задержка 5 секунд
let isShuttingDown = false; // Флаг для graceful shutdown

// Функция для отправки уведомления админу
const notifyAdmin = async (message: string) => {
  if (adminChatId) {
    try {
      await bot.telegram.sendMessage(adminChatId, message, { parse_mode: 'HTML' });
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Ошибка отправки уведомления админу');
    }
  }
};

// Функция запуска бота с retry logic
const launchBot = async (): Promise<void> => {
  if (isShuttingDown) {
    logger.info('🛑 Бот останавливается, отмена перезапуска');
    return;
  }

  try {
    await clearPendingUpdates();
    await bot.launch();

    // Успешный запуск - сбрасываем счётчик
    const wasRetrying = retryCount > 0;
    retryCount = 0;

    logger.info({ pid: process.pid, ppid: process.ppid }, '🚀 Telegram бот запущен в режиме polling');
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

    // Уведомляем админа о запуске
    const processInfo = `PID: ${process.pid}${process.env.pm_id ? ` | PM2 ID: ${process.env.pm_id}` : ''}`;
    if (wasRetrying) {
      await notifyAdmin(`🔄 <b>БОТ ВОССТАНОВЛЕН</b>\n\nPolling успешно перезапущен после ошибки\n🔧 ${processInfo}`);
    } else {
      await notifyAdmin(`🚀 <b>БОТ ЗАПУЩЕН</b>\n\nТелеграм бот успешно запущен в режиме polling\n🔧 ${processInfo}`);
    }

    // Запускаем восстановление и проверку незавершенных заданий через 5 секунд после старта
    setTimeout(async () => {
      // Сначала восстанавливаем необработанные сообщения
      logger.info('🔄 Запуск восстановления необработанных сообщений...');
      try {
        await recoverUnansweredMessages(bot);
        logger.info('✅ Восстановление необработанных сообщений выполнено');
      } catch (error) {
        logger.error({ error: (error as Error).message }, '❌ Ошибка восстановления необработанных сообщений');
      }

      // Потом проверяем незавершенные задания
      logger.info('🔍 Запуск проверки незавершенных заданий после старта бота...');
      try {
        await scheduler.checkUncompletedTasks();
        logger.info('✅ Проверка незавершенных заданий выполнена');
      } catch (error) {
        logger.error({ error: (error as Error).message }, '❌ Ошибка проверки незавершенных заданий после старта');
      }
    }, 5000);
  } catch (error) {
    const errorMessage = (error as Error).message || 'Unknown error';
    retryCount++;

    // Экспоненциальная задержка: 5с, 10с, 20с, 40с, 60с (макс)
    const delay = Math.min(BASE_RETRY_DELAY * Math.pow(2, retryCount - 1), MAX_RETRY_DELAY);

    logger.error(
      {
        error: errorMessage,
        retryCount,
        nextRetryIn: `${delay / 1000}s`,
      },
      '❌ Ошибка polling, перезапуск...'
    );

    // Уведомляем админа каждые 3 попытки
    if (retryCount % 3 === 0) {
      await notifyAdmin(
        `⚠️ <b>ПРОБЛЕМА С POLLING</b>\n\n` +
          `Ошибка: ${errorMessage}\n` +
          `Попытка: ${retryCount}\n` +
          `Следующая попытка через: ${delay / 1000}с`
      );
    }

    // Планируем перезапуск
    setTimeout(launchBot, delay);
  }
};

// Запускаем бота
launchBot();

// Graceful stop
process.once('SIGINT', () => {
  isShuttingDown = true;
  bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
  isShuttingDown = true;
  bot.stop('SIGTERM');
});
