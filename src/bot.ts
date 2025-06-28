import { config } from 'dotenv';
import express, { Request, Response } from 'express';
import { Telegraf } from 'telegraf';
import { CalendarService, formatCalendarEvents, getUserTodayEvents } from './calendar.ts';
import {
  addUser,
  getLastBotMessage,
  getLastUserToken,
  getLogsCount,
  getLogsStatistics,
  getRecentLogs,
  getUnreadLogsCount,
  markAllLogsAsRead,
  markLogAsRead,
  saveMessage,
  saveUserToken,
} from './db.ts';
import { generateUserResponse, minimalTestLLM } from './llm.ts';
import { botLogger, logger } from './logger.ts';
import { Scheduler } from './scheduler.ts';

// Загружаем переменные окружения
config();

// Создаем экземпляр бота
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN || '');

// Создаем планировщик
const calendarService = new CalendarService();
const scheduler = new Scheduler(bot, calendarService);

// --- Express сервер для Google OAuth2 callback и REST ---
const restServ = express();
const SERVER_PORT = process.env.SERVER_PORT || process.env.PORT || 3456;
// const TELEGRAM_WEBHOOK_PORT = process.env.TELEGRAM_WEBHOOK_PORT || 8443;
// const TELEGRAM_WEBHOOK_PATH =
//   process.env.TELEGRAM_WEBHOOK_PATH || "/telegraf/webhook";
// const TELEGRAM_WEBHOOK_URL =
//   process.env.TELEGRAM_WEBHOOK_URL ||
//   `https://${
//     process.env.FLY_APP_NAME || "psyfroggybot-np0edq"
//   }.fly.dev:${TELEGRAM_WEBHOOK_PORT}${TELEGRAM_WEBHOOK_PATH}`;

// --- Telegraf webhook ---
// bot.telegram.setWebhook(TELEGRAM_WEBHOOK_URL);
// restServ.use(TELEGRAM_WEBHOOK_PATH, bot.webhookCallback(TELEGRAM_WEBHOOK_PATH));

restServ.use(express.json());

restServ.all('/oauth2callback', async (req: Request, res: Response) => {
  const code = req.query.code as string;
  const state = req.query.state as string;
  const chatId = Number(state);
  botLogger.debug({ chatId, codeLength: code?.length || 0 }, `OAuth callback для пользователя ${chatId}`);
  if (!code) {
    res.status(400).send('No code provided');
    return;
  }
  if (!chatId || isNaN(chatId)) {
    res.status(400).send('Invalid chat ID in state parameter');
    return;
  }
  try {
    const tokens = await calendarService.getToken(code);
    saveUserToken(chatId, JSON.stringify(tokens));
    res.send('Авторизация прошла успешно! Можете вернуться к боту.');
    // Можно отправить сообщение админу или вывести в консоль
    logger.info({ chatId, code: code.substring(0, 10) + '...' }, 'OAuth токен успешно получен');
    await bot.telegram.sendMessage(chatId, 'Авторизация прошла успешно! Можете вернуться к боту.');
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack, chatId }, 'Ошибка OAuth токена');
    res.status(500).send('Ошибка при получении токена.');
  }
});

restServ.get('/status', (req: Request, res: Response) => {
  res.json({ status: 'up' });
});

restServ.all('/sendDailyMessage', async (req: Request, res: Response) => {
  const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);
  try {
    await scheduler.sendDailyMessagesToAll(adminChatId);
    res
      .status(200)
      .send(`Cообщения отправлены успешно, пользователей: ${scheduler['users'].size}, админ: ${adminChatId}`);
    logger.info({ usersCount: scheduler['users'].size }, 'Ручная рассылка завершена успешно');
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, 'Ошибка ручной рассылки');
    res.status(500).send(String(error));
  }
});

// 404
restServ.all('/', (req: Request, res: Response) => {
  res.status(404).send('Not found');
});

// Запуск сервера на всех интерфейсах (для Fly.io)
restServ.listen(Number(SERVER_PORT), '0.0.0.0', () => {
  logger.info({ port: SERVER_PORT }, `🚀 Express сервер запущен на порту ${SERVER_PORT}`);
});

// Обработка команды /start
bot.command('start', async ctx => {
  const chatId = ctx.chat.id;
  const userId = ctx.from?.id || 0;
  botLogger.info({ userId, chatId }, `📱 Команда /start от пользователя ${userId}`);

  // Добавляем пользователя в планировщик для рассылки
  scheduler.addUser(chatId);

  await ctx.reply(
    'Привет! Я бот-лягушка 🐸\n\n' +
      'Я буду отправлять сообщения в канал каждый день в 19:30.\n' +
      'Если ты не ответишь в течение 1.5 часов, я отправлю тебе напоминание.\n\n' +
      'Доступные команды:\n' +
      '/fro - отправить сообщение сейчас\n' +
      '/calendar - настроить доступ к календарю\n\n' +
      'Админские команды:\n' +
      '/status - статус планировщика\n' +
      '/logs - просмотр системных логов\n' +
      '/test_schedule - тест планировщика на следующую минуту\n' +
      '/test_now - немедленный тест рассылки\n' +
      '/minimalTestLLM - тест LLM подключения'
  );
});

// Обработка команды /test
bot.command('test', async ctx => {
  const chatId = ctx.chat.id;
  const fromId = ctx.from?.id;
  botLogger.info({ userId: fromId || 0, chatId }, `📱 Команда /test от пользователя ${fromId}`);
  await scheduler.sendDailyMessage(fromId);
});

// Обработка команды /sendnow
bot.command('sendnow', async ctx => {
  const chatId = ctx.chat.id;
  const targetTime = new Date();
  targetTime.setHours(15, 38, 0, 0);

  scheduler.scheduleOneTimeMessage(chatId, targetTime);
  await ctx.reply('Сообщение будет отправлено в 15:38!');
});

// Обработка команды /fro
bot.command('fro', async ctx => {
  const chatId = ctx.chat.id;
  // Генерируем сообщение по тем же правилам, что и для 19:30
  const message = await scheduler.generateScheduledMessage(chatId);
  const imagePath = scheduler.getNextImage(chatId);
  const caption = message.length > 1024 ? undefined : message;
  await bot.telegram.sendPhoto(
    scheduler.CHANNEL_ID,
    { source: imagePath },
    {
      caption,
      parse_mode: 'HTML',
    }
  );
  if (message.length > 1024) {
    await bot.telegram.sendMessage(scheduler.CHANNEL_ID, message, {
      parse_mode: 'HTML',
    });
  }
});

// Обработка команды /remind
bot.command('remind', async ctx => {
  const chatId = ctx.chat.id;
  const sentTime = new Date().toISOString();
  scheduler.setReminder(chatId, sentTime);
});

// Обработка команды /calendar
bot.command('calendar', async ctx => {
  const chatId = ctx.chat.id;
  // Save user if not exists
  addUser(chatId, ctx.from?.username || '');
  const lastToken = getLastUserToken(chatId);
  if (lastToken) {
    logger.debug({ chatId, hasToken: !!lastToken }, 'Проверка существующего токена календаря');
    try {
      calendarService.setToken(JSON.parse(lastToken.token));
      // Get events for yesterday and today
      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      const start = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const events = await calendarService.getEvents(start.toISOString(), end.toISOString());
      if (events && events.length > 0) {
        const eventsList = formatCalendarEvents(events, {
          locale: 'ru-RU',
          showDate: true,
          showBusy: true,
          showLocation: true,
          showDescription: true,
          showLink: true,
        });
        await ctx.reply(`События за вчера и сегодня:\n\n${eventsList}`, {
          parse_mode: 'HTML',
        });
      } else {
        await ctx.reply('Событий за вчера и сегодня нет.');
      }
      return;
    } catch (e) {
      const error = e as Error;
      botLogger.error({ error: error.message, stack: error.stack, chatId }, 'Ошибка токена календаря');
      await ctx.reply('Произошла ошибка при настройке доступа к календарю. Попробуйте еще раз.');
    }
  }
  // Pass chatId in state
  const authUrl = calendarService.getAuthUrl({ state: chatId.toString() });
  await ctx.reply(
    'Для доступа к календарю, пожалуйста, перейдите по ссылке и авторизуйтесь:\n' +
      authUrl +
      '\n\n' +
      'Подождите немного, пока я получу токен.'
  );
});

// Команда для минимального теста LLM
bot.command('minimalTestLLM', async ctx => {
  await ctx.reply('Выполняю минимальный тест LLM...');
  const result = await minimalTestLLM();
  if (result) {
    await ctx.reply('Ответ LLM:\n' + result);
  } else {
    await ctx.reply('Ошибка при выполнении минимального запроса к LLM.');
  }
});

// Команда для дебага индекса картинки
bot.command('next_image', async ctx => {
  const chatId = ctx.chat.id;
  try {
    const imagePath = scheduler.getNextImage(chatId);
    await ctx.replyWithPhoto(
      { source: imagePath },
      {
        caption: `Next image for chatId=${chatId}\nПуть: ${imagePath}`,
      }
    );
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack, chatId }, 'Ошибка команды next_image');
    await ctx.reply('Ошибка при получении следующей картинки: ' + error);
  }
});

// Команда для проверки статуса планировщика
bot.command('status', async ctx => {
  const chatId = ctx.chat.id;
  const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

  // Проверяем, что команду выполняет админ
  if (chatId !== adminChatId) {
    await ctx.reply('❌ Эта команда доступна только администратору');
    return;
  }

  const status = scheduler.getSchedulerStatus();

  await ctx.reply(
    `📊 <b>СТАТУС ПЛАНИРОВЩИКА</b>\n\n` +
      `⚙️ Cron job: ${status.isRunning ? '🟢 <b>Активен</b>' : '🔴 <b>Остановлен</b>'}\n` +
      `📅 Расписание: <code>${status.description}</code>\n` +
      `🕐 Выражение: <code>${status.cronExpression}</code>\n` +
      `🌍 Часовой пояс: <code>${status.timezone}</code>\n\n` +
      `🕐 <b>Текущее время (МСК):</b> <code>${status.currentTime}</code>\n` +
      `⏰ <b>Следующий запуск:</b> <code>${status.nextRunTime}</code>\n\n` +
      `👥 <b>Пользователей:</b> ${status.usersCount}\n` +
      `🔑 <b>Admin ID:</b> <code>${status.adminChatId}</code>\n` +
      `📋 <b>Список пользователей:</b>\n<code>${
        status.usersList.length > 0 ? status.usersList.join(', ') : 'Нет пользователей'
      }</code>`,
    { parse_mode: 'HTML' }
  );
});

// Команда для тестирования автоматической отправки
bot.command('test_schedule', async ctx => {
  const chatId = ctx.chat.id;
  const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

  // Проверяем, что команду выполняет админ
  if (chatId !== adminChatId) {
    await ctx.reply('❌ Эта команда доступна только администратору');
    return;
  }

  // Создаем тестовый cron job на следующую минуту
  const now = new Date();
  const nextMinute = (now.getMinutes() + 1) % 60;
  const nextHour = nextMinute === 0 ? now.getHours() + 1 : now.getHours();
  const cronExpression = `${nextMinute} ${nextHour} * * *`;

  await ctx.reply(
    `🧪 <b>ТЕСТ ПЛАНИРОВЩИКА</b>\n\n` +
      `⏱️ Cron выражение: <code>${cronExpression}</code>\n` +
      `🕐 Запуск в: <code>${String(nextHour).padStart(2, '0')}:${String(nextMinute).padStart(2, '0')}</code>\n` +
      `🌍 Часовой пояс: <code>Europe/Moscow</code>\n\n` +
      `⏳ Ожидайте тестовое сообщение...`,
    { parse_mode: 'HTML' }
  );

  const testJob = require('node-cron').schedule(
    cronExpression,
    async () => {
      try {
        logger.info('Запуск тестового cron job');
        await scheduler.sendDailyMessage(chatId);
        await ctx.reply('✅ 🧪 Тестовое сообщение отправлено успешно!');
        testJob.stop();
        testJob.destroy();
      } catch (e) {
        const error = e as Error;
        botLogger.error({ error: error.message, stack: error.stack }, 'Ошибка тестового cron job');
        await ctx.reply(`❌ Ошибка при отправке тестового сообщения:\n<code>${error}</code>`, { parse_mode: 'HTML' });
        testJob.stop();
        testJob.destroy();
      }
    },
    {
      scheduled: true,
      timezone: 'Europe/Moscow',
    }
  );
});

// Команда для немедленного теста рассылки
bot.command('test_now', async ctx => {
  const chatId = ctx.chat.id;
  const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

  // Проверяем, что команду выполняет админ
  if (chatId !== adminChatId) {
    await ctx.reply('❌ Эта команда доступна только администратору');
    return;
  }

  await ctx.reply('🧪 <b>НЕМЕДЛЕННЫЙ ТЕСТ РАССЫЛКИ</b>\n\nЗапускаю рассылку прямо сейчас...', { parse_mode: 'HTML' });

  try {
    logger.info('Запуск немедленного теста рассылки');
    await scheduler.sendDailyMessagesToAll(adminChatId);
    await ctx.reply('✅ 🧪 Тест рассылки завершен успешно!');
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, 'Ошибка немедленного теста рассылки');
    await ctx.reply(`❌ Ошибка при тесте рассылки:\n<code>${error}</code>`, {
      parse_mode: 'HTML',
    });
  }
});

// ========== КОМАНДЫ ДЛЯ ПРОСМОТРА ЛОГОВ ==========

// Функция для форматирования логов
function formatLogEntry(log: any, index: number): string {
  const levelEmojis: Record<string, string> = {
    trace: '🔍',
    debug: '🐛',
    info: '📝',
    warn: '⚠️',
    error: '❌',
    fatal: '💀',
  };

  const emoji = levelEmojis[log.level] || '📄';
  const timestamp = new Date(log.timestamp).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const readStatus = log.is_read ? '✅' : '🆕';

  let message = log.message;
  if (message.length > 100) {
    message = message.substring(0, 97) + '...';
  }

  let result = `${readStatus} ${emoji} <b>#${log.id}</b> [${timestamp}]\n<code>${message}</code>`;

  if (log.data) {
    try {
      const data = JSON.parse(log.data);
      const dataStr = JSON.stringify(data, null, 2);
      if (dataStr.length <= 200) {
        result += `\n<pre>${dataStr}</pre>`;
      } else {
        result += `\n<i>📎 Данные: ${dataStr.length} символов</i>`;
      }
    } catch {
      result += `\n<i>📎 Данные: ${log.data.length} символов</i>`;
    }
  }

  return result;
}

// Команда для просмотра логов
bot.command('logs', async ctx => {
  const chatId = ctx.chat.id;
  const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

  if (chatId !== adminChatId) {
    await ctx.reply('❌ Эта команда доступна только администратору');
    return;
  }

  try {
    const logs = getRecentLogs(7, 0);
    const totalCount = getLogsCount();
    const unreadCount = getUnreadLogsCount();

    if (logs.length === 0) {
      await ctx.reply('📝 <b>ЛОГИ СИСТЕМЫ</b>\n\n📭 Логи отсутствуют', {
        parse_mode: 'HTML',
      });
      return;
    }

    let message = `📝 <b>ЛОГИ СИСТЕМЫ</b>\n\n`;
    message += `📊 Всего: ${totalCount} | 🆕 Непрочитано: ${unreadCount}\n`;
    message += `📄 Показано: ${logs.length} из ${totalCount}\n\n`;

    logs.forEach((log, index) => {
      message += formatLogEntry(log, index) + '\n\n';
    });

    const keyboard = {
      inline_keyboard: [
        [
          { text: '⬅️ Предыдущие', callback_data: 'logs_prev_0' },
          { text: '📊 Статистика', callback_data: 'logs_stats' },
          { text: 'Следующие ➡️', callback_data: 'logs_next_7' },
        ],
        [
          { text: '✅ Все прочитано', callback_data: 'logs_mark_all_read' },
          { text: '🔄 Обновить', callback_data: 'logs_refresh_0' },
        ],
      ],
    };

    await ctx.reply(message, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, 'Ошибка команды /logs');
    await ctx.reply(`❌ Ошибка при получении логов:\n<code>${error}</code>`, {
      parse_mode: 'HTML',
    });
  }
});

// Обработчики callback для пагинации логов
bot.action(/logs_(.+)_(\d+)/, async ctx => {
  const chatId = ctx.chat?.id;
  const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

  if (chatId !== adminChatId) {
    await ctx.answerCbQuery('❌ Доступ запрещен');
    return;
  }

  const action = ctx.match![1];
  const offset = parseInt(ctx.match![2]);

  try {
    let newOffset = offset;

    switch (action) {
      case 'prev':
        newOffset = Math.max(0, offset - 7);
        break;
      case 'next':
        const totalCount = getLogsCount();
        newOffset = Math.min(totalCount - 1, offset + 7);
        break;
      case 'refresh':
        newOffset = offset;
        break;
      default:
        await ctx.answerCbQuery('❌ Неизвестное действие');
        return;
    }

    const logs = getRecentLogs(7, newOffset);
    const totalCount = getLogsCount();
    const unreadCount = getUnreadLogsCount();

    if (logs.length === 0) {
      await ctx.answerCbQuery('📭 Логов больше нет');
      return;
    }

    let message = `📝 <b>ЛОГИ СИСТЕМЫ</b>\n\n`;
    message += `📊 Всего: ${totalCount} | 🆕 Непрочитано: ${unreadCount}\n`;
    message += `📄 Показано: ${logs.length} (позиция ${newOffset + 1}-${newOffset + logs.length})\n\n`;

    logs.forEach((log, index) => {
      message += formatLogEntry(log, index) + '\n\n';
    });

    const keyboard = {
      inline_keyboard: [
        [
          { text: '⬅️ Предыдущие', callback_data: `logs_prev_${newOffset}` },
          { text: '📊 Статистика', callback_data: 'logs_stats' },
          { text: 'Следующие ➡️', callback_data: `logs_next_${newOffset}` },
        ],
        [
          { text: '✅ Все прочитано', callback_data: 'logs_mark_all_read' },
          { text: '🔄 Обновить', callback_data: `logs_refresh_${newOffset}` },
        ],
      ],
    };

    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });

    await ctx.answerCbQuery();
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, 'Ошибка навигации по логам');
    await ctx.answerCbQuery('❌ Ошибка при загрузке логов');
  }
});

// Обработчик для статистики логов
bot.action('logs_stats', async ctx => {
  const chatId = ctx.chat?.id;
  const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

  if (chatId !== adminChatId) {
    await ctx.answerCbQuery('❌ Доступ запрещен');
    return;
  }

  try {
    const stats = getLogsStatistics();
    const totalCount = getLogsCount();
    const unreadCount = getUnreadLogsCount();

    let message = `📊 <b>СТАТИСТИКА ЛОГОВ</b>\n\n`;
    message += `📄 Всего логов: ${totalCount}\n`;
    message += `🆕 Непрочитано: ${unreadCount}\n\n`;
    message += `<b>По уровням:</b>\n`;

    stats.forEach(stat => {
      const levelEmojis: Record<string, string> = {
        trace: '🔍',
        debug: '🐛',
        info: '📝',
        warn: '⚠️',
        error: '❌',
        fatal: '💀',
      };

      const emoji = levelEmojis[stat.level] || '📄';
      const percentage = ((stat.count / totalCount) * 100).toFixed(1);
      message += `${emoji} ${stat.level.toUpperCase()}: ${stat.count} (${percentage}%)`;
      if (stat.unread_count > 0) {
        message += ` | 🆕 ${stat.unread_count}`;
      }
      message += '\n';
    });

    const keyboard = {
      inline_keyboard: [[{ text: '◀️ Назад к логам', callback_data: 'logs_refresh_0' }]],
    };

    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });

    await ctx.answerCbQuery();
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, 'Ошибка статистики логов');
    await ctx.answerCbQuery('❌ Ошибка при загрузке статистики');
  }
});

// Обработчик для отметки всех логов как прочитанных
bot.action('logs_mark_all_read', async ctx => {
  const chatId = ctx.chat?.id;
  const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

  if (chatId !== adminChatId) {
    await ctx.answerCbQuery('❌ Доступ запрещен');
    return;
  }

  try {
    markAllLogsAsRead();
    await ctx.answerCbQuery('✅ Все логи помечены как прочитанные');

    // Обновляем сообщение
    const logs = getRecentLogs(7, 0);
    const totalCount = getLogsCount();
    const unreadCount = getUnreadLogsCount();

    let message = `📝 <b>ЛОГИ СИСТЕМЫ</b>\n\n`;
    message += `📊 Всего: ${totalCount} | 🆕 Непрочитано: ${unreadCount}\n`;
    message += `📄 Показано: ${logs.length} из ${totalCount}\n\n`;

    logs.forEach((log, index) => {
      // Принудительно устанавливаем is_read = true для отображения
      log.is_read = true;
      message += formatLogEntry(log, index) + '\n\n';
    });

    const keyboard = {
      inline_keyboard: [
        [
          { text: '⬅️ Предыдущие', callback_data: 'logs_prev_0' },
          { text: '📊 Статистика', callback_data: 'logs_stats' },
          { text: 'Следующие ➡️', callback_data: 'logs_next_7' },
        ],
        [
          { text: '✅ Все прочитано', callback_data: 'logs_mark_all_read' },
          { text: '🔄 Обновить', callback_data: 'logs_refresh_0' },
        ],
      ],
    };

    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, 'Ошибка отметки всех логов');
    await ctx.answerCbQuery('❌ Ошибка при отметке логов');
  }
});

// Обработчик для отметки отдельного лога как прочитанного
bot.action(/log_read_(\d+)/, async ctx => {
  const chatId = ctx.chat?.id;
  const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

  if (chatId !== adminChatId) {
    await ctx.answerCbQuery('❌ Доступ запрещен');
    return;
  }

  const logId = parseInt(ctx.match![1]);

  try {
    markLogAsRead(logId);
    await ctx.answerCbQuery(`✅ Лог #${logId} помечен как прочитанный`);
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, 'Ошибка отметки одного лога');
    await ctx.answerCbQuery('❌ Ошибка при отметке лога');
  }
});

// ========== ОБРАБОТКА ТЕКСТОВЫХ СООБЩЕНИЙ ==========

// Обработка текстовых сообщений
bot.on('text', async ctx => {
  const message = ctx.message.text;
  const chatId = ctx.chat.id;
  botLogger.debug({ userId: ctx.from?.id || 0, chatId, messageLength: message.length }, `💬 Сообщение от пользователя`);
  // scheduler.updateUserResponseTime(chatId, sentTime); // Удалено, чтобы не было ошибки
  scheduler.clearReminder(chatId);

  try {
    // Сохраняем сообщение пользователя в БД (author_id = userId пользователя)
    const userId = ctx.from?.id || 0;
    const userMessageTime = new Date().toISOString();
    saveMessage(chatId, message, userMessageTime, userId);

    // Получаем последнее сообщение бота для контекста
    const lastMessage = getLastBotMessage(chatId);
    const lastBotMessageText = lastMessage?.message_text;

    // Получаем события календаря на сегодня
    const calendarEvents = await getUserTodayEvents(chatId);

    botLogger.info(
      {
        chatId,
        hasLastMessage: !!lastBotMessageText,
        hasCalendarEvents: !!calendarEvents,
      },
      '🤖 Генерируем ответ пользователю'
    );

    // Генерируем контекстуальный ответ через LLM
    const textResponse = await generateUserResponse(message, lastBotMessageText, calendarEvents || undefined);

    // Отправляем текстовый ответ
    await ctx.reply(textResponse);

    // Сохраняем ответ бота в БД (author_id = 0 для бота)
    const botResponseTime = new Date().toISOString();
    saveMessage(chatId, textResponse, botResponseTime, 0);

    botLogger.info({ chatId, responseLength: textResponse.length }, '✅ Ответ пользователю отправлен и сохранен');
  } catch (error) {
    const err = error as Error;
    botLogger.error({ error: err.message, stack: err.stack, chatId }, 'Ошибка генерации ответа пользователю');

    // Fallback ответ при ошибке
    const fallbackMessage = 'Спасибо, что поделился! 🤍';
    await ctx.reply(fallbackMessage);

    // Сохраняем fallback ответ в БД
    const fallbackTime = new Date().toISOString();
    saveMessage(chatId, fallbackMessage, fallbackTime, 0);
  }
});

// Запускаем бота

// --- Telegraf polling ---
bot.launch();
logger.info('🚀 Telegram бот запущен в режиме polling');
// Обработка завершения работы
process.once('SIGINT', () => {
  logger.info('🛑 Telegram бот остановлен (SIGINT)');
  scheduler.destroy();
  bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
  logger.info('🛑 Telegram бот остановлен (SIGTERM)');
  scheduler.destroy();
  bot.stop('SIGTERM');
});
