import { config } from 'dotenv';
import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { Telegraf } from 'telegraf';
import { CalendarService, formatCalendarEvents, getUserTodayEvents } from './calendar.ts';
import {
  addUser,
  getLastNMessages,
  getLastUserToken,
  getLogsCount,
  getLogsStatistics,
  getRecentLogs,
  getRecentLogsByLevel,
  getRecentUnreadInfoLogs,
  getRecentUnreadLogs,
  getUnreadLogsCount,
  markAllLogsAsRead,
  markLogAsRead,
  markLogsAsRead,
  saveMessage,
  saveUserToken,
  updateUserResponse,
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
    logger.info({ 
      method: req.method, 
      ip: req.ip,
      userAgent: req.headers['user-agent'] 
    }, 'REST API: Получен запрос на ручную рассылку');
    
    await scheduler.sendDailyMessagesToAll(adminChatId);
    
    // Если рассылка была заблокирована из-за дублирования, метод вернется без ошибки
    // но сообщений не отправит
    res
      .status(200)
      .send(`Запрос на рассылку обработан. Пользователей: ${scheduler['users'].size}, админ: ${adminChatId}`);
    logger.info({ usersCount: scheduler['users'].size }, 'REST API: Запрос на рассылку обработан');
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, 'Ошибка ручной рассылки через REST API');
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
      'Я буду отправлять сообщения в канал каждый день в 22:00.\n' +
      'Если ты не ответишь в течение 1.5 часов, я отправлю тебе напоминание в личку.\n\n' +
      'Доступные команды:\n' +
      '/fro - отправить сообщение сейчас\n' +
      '/calendar - настроить доступ к календарю\n\n' +
      'Админские команды:\n' +
      '/status - статус планировщика\n' +
      '/last_run - время последней рассылки\n' +
      '/logs - просмотр системных логов\n' +
      '/test_schedule - тест планировщика на следующую минуту\n' +
      '/test_now - немедленный тест рассылки\n' +
      '/test_reminder - тест напоминания\n' +
      '/minimalTestLLM - тест LLM подключения'
  );
});

// Обработка команды /test
bot.command('test', async ctx => {
  const chatId = ctx.chat.id;
  const fromId = ctx.from?.id;
  botLogger.info({ userId: fromId || 0, chatId }, `📱 Команда /test от пользователя ${fromId}`);
  
  // Генерируем сообщение и проверяем его длину
  const message = await scheduler.generateScheduledMessage(fromId);
  await ctx.reply(
    `📊 <b>ТЕСТ ГЕНЕРАЦИИ СООБЩЕНИЯ</b>\n\n` +
    `📏 Длина: ${message.length} символов\n` +
    `${message.length > 1024 ? `❌ ПРЕВЫШЕН ЛИМИТ на ${message.length - 1024} символов!` : '✅ В пределах лимита'}\n\n` +
    `<b>Сообщение:</b>\n${message}`,
    { parse_mode: 'HTML' }
  );
  
  // Отправляем в канал только если не превышен лимит
  if (message.length <= 1024) {
    await scheduler.sendDailyMessage(fromId);
  }
});

// Команда для тестирования определения занятости пользователя
bot.command('test_busy', async ctx => {
  const chatId = ctx.chat.id;
  const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

  // Проверяем, что команду выполняет админ
  if (chatId !== adminChatId) {
    await ctx.reply('❌ Эта команда доступна только администратору');
    return;
  }

  try {
    // Получаем события календаря для сегодня
    const now = new Date();
    const evening = new Date(now);
    evening.setHours(18, 0, 0, 0);
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);

    const calendarService = scheduler.getCalendarService();
    const events = await calendarService.getEvents(evening.toISOString(), tomorrow.toISOString());

    // Тестируем функцию определения занятости
    const busyStatus = await (scheduler as any).detectUserBusy(events || []);

    let message = '🔍 <b>ТЕСТ ОПРЕДЕЛЕНИЯ ЗАНЯТОСТИ</b>\n\n';

    if (events && events.length > 0) {
      message += '📅 <b>События в календаре:</b>\n';
      events.forEach((event: any, i: number) => {
        message += `${i + 1}. ${event.summary || 'Без названия'}\n`;

        // Время события
        if (event.start) {
          const startDate = new Date(event.start.dateTime || event.start.date);
          const endDate = event.end ? new Date(event.end.dateTime || event.end.date) : null;

          if (event.start.date && !event.start.dateTime) {
            message += `   • Весь день\n`;
          } else {
            message += `   • Время: ${startDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
            if (endDate) {
              message += ` - ${endDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
            }
            message += '\n';
          }
        }

        // Статус занятости
        if (event.transparency) {
          message += `   • Статус: ${event.transparency === 'transparent' ? '✅ Свободен' : '🔴 Занят'}\n`;
        }

        // Место
        if (event.location) {
          message += `   • Место: ${event.location}\n`;
        }
      });
      message += '\n';
    } else {
      message += '📅 <i>Нет событий в календаре</i>\n\n';
    }

    message += `🤖 <b>Результат анализа:</b>\n`;
    message += `• Занят: ${busyStatus.probably_busy ? '✅ Да' : '❌ Нет'}\n`;
    if (busyStatus.busy_reason) {
      message += `• Причина: ${busyStatus.busy_reason}\n`;
    }
    message += `\n📄 Будет использован промпт: <code>${
      busyStatus.probably_busy ? 'scheduled-message-flight.md' : 'scheduled-message.md'
    }</code>`;

    await ctx.reply(message, { parse_mode: 'HTML' });
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, 'Ошибка команды /test_busy');
    await ctx.reply(`❌ Ошибка при тестировании:\n<code>${error.message}</code>`, {
      parse_mode: 'HTML',
    });
  }
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
  // Генерируем сообщение по тем же правилам, что и для 22:00
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

// Команда для проверки ID чата
bot.command('chat_info', async ctx => {
  const chatId = ctx.chat.id;
  const chatType = ctx.chat.type;
  const userId = ctx.from?.id || 0;
  const username = ctx.from?.username || 'unknown';
  
  await ctx.reply(
    `📊 <b>ИНФОРМАЦИЯ О ЧАТЕ</b>\n\n` +
    `🆔 Chat ID: <code>${chatId}</code>\n` +
    `📝 Тип: <code>${chatType}</code>\n` +
    `👤 User ID: <code>${userId}</code>\n` +
    `👤 Username: @${username}\n\n` +
    `💡 Добавьте CHAT_ID=${chatId} в файл .env`,
    { parse_mode: 'HTML' }
  );
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
    await ctx.reply(`Ошибка при получении картинки: ${error.message}`);
  }
});

// Временная команда для проверки текста
bot.command('fly1', async ctx => {
  const text =
    'Кажется чатик не хочет работать - негодяй!\n\nКайфового полета :) Давай пока ты будешь лететь ты подумаешь о приятном, просто перечисляй все, что тебя радует, приносит удовольствие... можно нафантазировать)\n\nГлавное пострайся при этом почувствовать что-то хорошее ♥';

  try {
    await bot.telegram.sendMessage(scheduler.CHANNEL_ID, text);
    await ctx.reply('✅ Тестовое сообщение отправлено в канал!');
  } catch (error) {
    await ctx.reply(`❌ Ошибка отправки: ${error}`);
  }
});

// Команда для проверки времени последней рассылки
bot.command('last_run', async ctx => {
  const chatId = ctx.chat.id;
  const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

  // Проверяем, что команду выполняет админ
  if (chatId !== adminChatId) {
    await ctx.reply('❌ Эта команда доступна только администратору');
    return;
  }

  try {
    // Получаем время последней рассылки через приватный метод
    const lastRun = await (scheduler as any).getLastDailyRunTime();
    
    if (lastRun) {
      const moscowTime = lastRun.toLocaleString('ru-RU', {
        timeZone: 'Europe/Moscow',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      
      const now = new Date();
      const timeDiff = now.getTime() - lastRun.getTime();
      const hoursDiff = Math.floor(timeDiff / (1000 * 60 * 60));
      const minutesDiff = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
      
      await ctx.reply(
        `📅 <b>ПОСЛЕДНЯЯ РАССЫЛКА</b>\n\n` +
        `🕐 Время: <code>${moscowTime}</code>\n` +
        `⏱️ Прошло: ${hoursDiff} ч. ${minutesDiff} мин.\n\n` +
        `${hoursDiff < 20 ? '✅ Сегодняшняя рассылка уже выполнена' : '⏳ Ожидается сегодняшняя рассылка в 22:00'}`,
        { parse_mode: 'HTML' }
      );
    } else {
      await ctx.reply('📭 Информация о последней рассылке отсутствует');
    }
  } catch (error) {
    await ctx.reply(`❌ Ошибка получения информации: ${error}`);
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

// Команда для теста напоминания
bot.command('test_reminder', async ctx => {
  const chatId = ctx.chat.id;
  const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

  // Проверяем, что команду выполняет админ
  if (chatId !== adminChatId) {
    await ctx.reply('❌ Эта команда доступна только администратору');
    return;
  }

  await ctx.reply(
    '🧪 <b>ТЕСТ НАПОМИНАНИЯ</b>\n\n' +
    'Устанавливаю напоминание на 10 секунд...\n' +
    'Оно придет вам в личку',
    { parse_mode: 'HTML' }
  );

  // Создаем временное напоминание через 10 секунд
  const timeout = setTimeout(async () => {
    const reminderText = '🐸 Привет! Не забудь ответить на сегодняшнее задание, если еще не успел(а)';
    await bot.telegram.sendMessage(chatId, reminderText);
    await ctx.reply('✅ Напоминание отправлено!');
  }, 10 * 1000); // 10 секунд

  // Сохраняем timeout для возможности отмены
  scheduler['reminderTimeouts'].set(chatId, timeout);
});

// ========== КОМАНДЫ ДЛЯ ПРОСМОТРА ЛОГОВ ==========

// Функция для создания временного файла с логами
function createTempLogFile(logs: any[], filename: string): string {
  try {
    const tempDir = path.join(process.cwd(), 'temp');

    botLogger.debug({ tempDir, filename, logsCount: logs.length }, 'Создаю временный файл логов');

    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
      botLogger.debug({ tempDir }, 'Создана директория temp');
    }

    const filePath = path.join(tempDir, filename);
    let content = '=== СИСТЕМНЫЕ ЛОГИ ===\n\n';

    logs.forEach((log, index) => {
      const timestamp = new Date(log.timestamp).toLocaleString('ru-RU', {
        timeZone: 'Europe/Moscow',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      content += `[${timestamp}] ${log.level.toUpperCase()} #${log.id}\n`;
      content += `Сообщение: ${log.message}\n`;

      if (log.data) {
        try {
          const data = JSON.parse(log.data);
          content += `Данные: ${JSON.stringify(data, null, 2)}\n`;
        } catch {
          content += `Данные: ${log.data}\n`;
        }
      }

      content += `Прочитано: ${log.is_read ? 'Да' : 'Нет'}\n`;
      content += '---\n\n';
    });

    fs.writeFileSync(filePath, content, 'utf8');
    botLogger.debug({ filePath, contentLength: content.length }, 'Файл логов создан');
    return filePath;
  } catch (error) {
    const err = error as Error;
    botLogger.error({ error: err.message, stack: err.stack, filename }, 'Ошибка создания файла логов');
    throw err;
  }
}

// Функция для очистки временных файлов
function cleanupTempFile(filePath: string) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    const err = error as Error;
    botLogger.warn({ error: err.message }, 'Не удалось удалить временный файл');
  }
}

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
    // По умолчанию показываем только непрочитанные логи уровня INFO и выше
    const logs = getRecentUnreadInfoLogs(7, 0);
    const totalCount = getLogsCount();
    const unreadCount = getUnreadLogsCount();

    if (logs.length === 0) {
      await ctx.reply(
        '📝 <b>ЛОГИ СИСТЕМЫ</b>\n\n📭 Непрочитанные логи INFO+ отсутствуют\n\n💡 Используйте кнопку "🔍 Фильтр" для других уровней логов',
        {
          parse_mode: 'HTML',
        }
      );
      return;
    }

    let message = `📝 <b>ЛОГИ СИСТЕМЫ</b>\n\n`;
    message += `📊 Всего: ${totalCount} | 🆕 Непрочитано: ${unreadCount}\n`;
    message += `📄 Показано: ${logs.length} непрочитанных | 🔍 Фильтр: INFO и выше\n\n`;

    // Проверяем, не слишком ли большое сообщение получается
    let testMessage = message;
    logs.forEach((log, index) => {
      testMessage += formatLogEntry(log, index) + '\n\n';
    });

    const keyboard = {
      inline_keyboard: [
        [
          { text: '⬅️ Предыдущие', callback_data: 'logs_prev_0_info+' },
          { text: '📊 Статистика', callback_data: 'logs_stats' },
          { text: 'Следующие ➡️', callback_data: 'logs_next_7_info+' },
        ],
        [
          { text: '🔍 Фильтр', callback_data: 'logs_filter_menu' },
          { text: '✅ Прочитано', callback_data: 'logs_mark_visible_read' },
          { text: '🔄 Обновить', callback_data: 'logs_refresh_0_info+' },
        ],
        [{ text: '📁 Скачать как файл', callback_data: 'logs_download_0_info+' }],
      ],
    };

    // Если сообщение слишком длинное (> 3500 символов), отправляем файлом
    if (testMessage.length > 3500) {
      const timestamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '-');
      const filename = `logs_${timestamp}.txt`;
      const filePath = createTempLogFile(logs, filename);

      try {
        await ctx.replyWithDocument(
          { source: filePath, filename },
          {
            caption: `📝 <b>ЛОГИ СИСТЕМЫ</b>\n\n📊 Всего: ${totalCount} | 🆕 Непрочитано: ${unreadCount}\n📄 В файле: ${logs.length} записей | 🔍 Фильтр: Все`,
            parse_mode: 'HTML',
            reply_markup: keyboard,
          }
        );
      } finally {
        cleanupTempFile(filePath);
      }
    } else {
      logs.forEach((log, index) => {
        message += formatLogEntry(log, index) + '\n\n';
      });

      await ctx.reply(message, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    }
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, 'Ошибка команды /logs');
    await ctx.reply(`❌ Ошибка при получении логов:\n<code>${error}</code>`, {
      parse_mode: 'HTML',
    });
  }
});

// Обработчики callback для пагинации логов
bot.action(/logs_(.+)_(\d+)_(.+)/, async ctx => {
  const chatId = ctx.chat?.id;
  const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

  if (chatId !== adminChatId) {
    await ctx.answerCbQuery('❌ Доступ запрещен');
    return;
  }

  const action = ctx.match![1];
  const offset = parseInt(ctx.match![2]);
  const levelFilter = ctx.match![3] === 'all' ? null : ctx.match![3];

  try {
    let newOffset = offset;

    switch (action) {
      case 'prev':
        newOffset = Math.max(0, offset - 7);
        break;
      case 'next':
        newOffset = offset + 7;
        break;
      case 'refresh':
        newOffset = offset;
        break;
      default:
        await ctx.answerCbQuery('❌ Неизвестное действие');
        return;
    }

    let logs;
    if (levelFilter === 'unread') {
      logs = getRecentUnreadLogs(7, newOffset);
    } else if (levelFilter === 'info+') {
      logs = getRecentUnreadInfoLogs(7, newOffset);
    } else if (levelFilter && levelFilter !== 'all') {
      logs = getRecentLogsByLevel(levelFilter, 7, newOffset);
    } else {
      logs = getRecentLogs(7, newOffset);
    }
    const totalCount = getLogsCount();
    const unreadCount = getUnreadLogsCount();
    const filterSuffix = levelFilter || 'all';
    let filterName: string;
    if (!levelFilter || levelFilter === 'all') {
      filterName = 'Все';
    } else if (levelFilter === 'unread') {
      filterName = 'Непрочитанные';
    } else if (levelFilter === 'info+') {
      filterName = 'INFO и выше';
    } else {
      filterName = levelFilter.toUpperCase();
    }

    if (logs.length === 0) {
      await ctx.answerCbQuery('📭 Логов больше нет');
      return;
    }

    let message = `📝 <b>ЛОГИ СИСТЕМЫ</b>\n\n`;
    message += `📊 Всего: ${totalCount} | 🆕 Непрочитано: ${unreadCount}\n`;
    message += `📄 Показано: ${logs.length} (позиция ${newOffset + 1}-${
      newOffset + logs.length
    }) | 🔍 Фильтр: ${filterName}\n\n`;

    logs.forEach((log, index) => {
      message += formatLogEntry(log, index) + '\n\n';
    });

    const keyboard = {
      inline_keyboard: [
        [
          { text: '⬅️ Предыдущие', callback_data: `logs_prev_${newOffset}_${filterSuffix}` },
          { text: '📊 Статистика', callback_data: 'logs_stats' },
          { text: 'Следующие ➡️', callback_data: `logs_next_${newOffset}_${filterSuffix}` },
        ],
        [
          { text: '🔍 Фильтр', callback_data: 'logs_filter_menu' },
          { text: '✅ Все прочитано', callback_data: 'logs_mark_all_read' },
          { text: '🔄 Обновить', callback_data: `logs_refresh_${newOffset}_${filterSuffix}` },
        ],
        [{ text: '📁 Скачать как файл', callback_data: `logs_download_${newOffset}_${filterSuffix}` }],
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

// Обработчик для меню фильтров логов
bot.action('logs_filter_menu', async ctx => {
  const chatId = ctx.chat?.id;
  const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

  if (chatId !== adminChatId) {
    await ctx.answerCbQuery('❌ Доступ запрещен');
    return;
  }

  const keyboard = {
    inline_keyboard: [
      [
        { text: '📄 Все', callback_data: 'logs_filter_all' },
        { text: '🆕 Непрочитанные', callback_data: 'logs_filter_unread' },
        { text: '📝 INFO+', callback_data: 'logs_filter_info+' },
      ],
      [
        { text: '🐛 DEBUG', callback_data: 'logs_filter_debug' },
        { text: '📝 INFO', callback_data: 'logs_filter_info' },
      ],
      [
        { text: '⚠️ WARN', callback_data: 'logs_filter_warn' },
        { text: '❌ ERROR', callback_data: 'logs_filter_error' },
        { text: '💀 FATAL', callback_data: 'logs_filter_fatal' },
      ],
      [{ text: '◀️ Назад к логам', callback_data: 'logs_refresh_0_info+' }],
    ],
  };

  await ctx.editMessageText('🔍 <b>ВЫБЕРИТЕ УРОВЕНЬ ЛОГОВ</b>', {
    parse_mode: 'HTML',
    reply_markup: keyboard,
  });

  await ctx.answerCbQuery();
});

// Обработчик для фильтрации логов по уровню
bot.action(/logs_filter_(.+)/, async ctx => {
  const chatId = ctx.chat?.id;
  const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

  if (chatId !== adminChatId) {
    await ctx.answerCbQuery('❌ Доступ запрещен');
    return;
  }

  const level = ctx.match![1];
  const levelFilter = level === 'all' ? null : level;
  const filterSuffix = level;
  let filterName: string;

  if (level === 'all') {
    filterName = 'Все';
  } else if (level === 'unread') {
    filterName = 'Непрочитанные';
  } else if (level === 'info+') {
    filterName = 'INFO и выше';
  } else {
    filterName = level.toUpperCase();
  }

  try {
    let logs;
    if (level === 'unread') {
      logs = getRecentUnreadLogs(7, 0);
    } else if (level === 'info+') {
      logs = getRecentUnreadInfoLogs(7, 0);
    } else if (levelFilter && level !== 'all') {
      logs = getRecentLogsByLevel(levelFilter, 7, 0);
    } else {
      logs = getRecentLogs(7, 0);
    }

    const totalCount = getLogsCount();
    const unreadCount = getUnreadLogsCount();

    if (logs.length === 0) {
      await ctx.answerCbQuery('📭 Логов с таким фильтром нет');
      return;
    }

    let message = `📝 <b>ЛОГИ СИСТЕМЫ</b>\n\n`;
    message += `📊 Всего: ${totalCount} | 🆕 Непрочитано: ${unreadCount}\n`;

    const displayCount = level === 'unread' ? unreadCount : totalCount;
    message += `📄 Показано: ${logs.length} из ${displayCount} | 🔍 Фильтр: ${filterName}\n\n`;

    logs.forEach((log, index) => {
      message += formatLogEntry(log, index) + '\n\n';
    });

    const keyboard = {
      inline_keyboard: [
        [
          { text: '⬅️ Предыдущие', callback_data: `logs_prev_0_${filterSuffix}` },
          { text: '📊 Статистика', callback_data: 'logs_stats' },
          { text: 'Следующие ➡️', callback_data: `logs_next_7_${filterSuffix}` },
        ],
        [
          { text: '🔍 Фильтр', callback_data: 'logs_filter_menu' },
          { text: '✅ Прочитано', callback_data: 'logs_mark_visible_read' },
          { text: '🔄 Обновить', callback_data: `logs_refresh_0_${filterSuffix}` },
        ],
        [{ text: '📁 Скачать как файл', callback_data: `logs_download_0_${filterSuffix}` }],
      ],
    };

    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });

    await ctx.answerCbQuery(`🔍 Фильтр: ${filterName}`);
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, 'Ошибка фильтрации логов');
    await ctx.answerCbQuery('❌ Ошибка при фильтрации логов');
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
      inline_keyboard: [[{ text: '◀️ Назад к логам', callback_data: 'logs_refresh_0_all' }]],
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
    message += `📄 Показано: ${logs.length} из ${totalCount} | 🔍 Фильтр: Все\n\n`;

    logs.forEach((log, index) => {
      // Принудительно устанавливаем is_read = true для отображения
      log.is_read = true;
      message += formatLogEntry(log, index) + '\n\n';
    });

    const keyboard = {
      inline_keyboard: [
        [
          { text: '⬅️ Предыдущие', callback_data: 'logs_prev_0_all' },
          { text: '📊 Статистика', callback_data: 'logs_stats' },
          { text: 'Следующие ➡️', callback_data: 'logs_next_7_all' },
        ],
        [
          { text: '🔍 Фильтр', callback_data: 'logs_filter_menu' },
          { text: '✅ Все прочитано', callback_data: 'logs_mark_all_read' },
          { text: '🔄 Обновить', callback_data: 'logs_refresh_0_all' },
        ],
        [{ text: '📁 Скачать как файл', callback_data: 'logs_download_0_all' }],
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

// Обработчик для отметки видимых логов как прочитанных
bot.action('logs_mark_visible_read', async ctx => {
  const chatId = ctx.chat?.id;
  const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

  if (chatId !== adminChatId) {
    await ctx.answerCbQuery('❌ Доступ запрещен');
    return;
  }

  try {
    // Нужно получить информацию о текущем состоянии логов из сообщения
    // Это сложно сделать из callback, поэтому пока сделаем simple approach

    // Получаем последние 7 непрочитанных INFO+ логов (текущие видимые по умолчанию)
    const logs = getRecentUnreadInfoLogs(7, 0);

    if (logs.length === 0) {
      await ctx.answerCbQuery('📭 Нет видимых логов для пометки');
      return;
    }

    // Помечаем все видимые логи как прочитанные
    const logIds = logs.map(log => log.id);
    markLogsAsRead(logIds);

    await ctx.answerCbQuery(`✅ Помечено ${logs.length} логов как прочитанные`);

    // Обновляем сообщение, показывая те же логи но уже как прочитанные
    const totalCount = getLogsCount();
    const unreadCount = getUnreadLogsCount();

    let message = `📝 <b>ЛОГИ СИСТЕМЫ</b>\n\n`;
    message += `📊 Всего: ${totalCount} | 🆕 Непрочитано: ${unreadCount}\n`;
    message += `📄 Показано: ${logs.length} логов (помечены как прочитанные) | 🔍 Фильтр: Просмотренные\n\n`;

    // Принудительно показываем логи как прочитанные
    logs.forEach((log, index) => {
      log.is_read = true;
      message += formatLogEntry(log, index) + '\n\n';
    });

    const keyboard = {
      inline_keyboard: [
        [
          { text: '⬅️ Предыдущие', callback_data: 'logs_prev_0_info+' },
          { text: '📊 Статистика', callback_data: 'logs_stats' },
          { text: 'Следующие ➡️', callback_data: 'logs_next_7_info+' },
        ],
        [
          { text: '🔍 Фильтр', callback_data: 'logs_filter_menu' },
          { text: '✅ Уже прочитано', callback_data: 'logs_mark_visible_read' },
          { text: '🔄 Обновить', callback_data: 'logs_refresh_0_info+' },
        ],
        [{ text: '📁 Скачать как файл', callback_data: 'logs_download_0_info+' }],
      ],
    };

    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, 'Ошибка отметки видимых логов');
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

// Обработчик для скачивания логов файлом
bot.action(/logs_download_(\d+)_(.+)/, async ctx => {
  const chatId = ctx.chat?.id;
  const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

  if (chatId !== adminChatId) {
    await ctx.answerCbQuery('❌ Доступ запрещен');
    return;
  }

  const offset = parseInt(ctx.match![1]);
  const levelFilter = ctx.match![2] === 'all' ? null : ctx.match![2];

  try {
    await ctx.answerCbQuery('📥 Подготавливаю файл...');

    // Получаем больше логов для файла (например, последние 100)
    let logs;
    if (levelFilter === 'unread') {
      logs = getRecentUnreadLogs(100, offset);
    } else if (levelFilter === 'info+') {
      logs = getRecentUnreadInfoLogs(100, offset);
    } else if (levelFilter && levelFilter !== 'all') {
      logs = getRecentLogsByLevel(levelFilter, 100, offset);
    } else {
      logs = getRecentLogs(100, offset);
    }

    if (logs.length === 0) {
      await ctx.reply('📭 Логи для скачивания отсутствуют');
      return;
    }

    const timestamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '-');
    const filterSuffix = levelFilter ? `_${levelFilter}` : '';
    const filename = `logs${filterSuffix}_${timestamp}.txt`;
    const filePath = createTempLogFile(logs, filename);

    try {
      await ctx.replyWithDocument(
        { source: filePath, filename },
        {
          caption: `📁 <b>Экспорт логов</b>\n\n📄 Записей в файле: ${logs.length}\n🔍 Фильтр: ${
            levelFilter ? levelFilter.toUpperCase() : 'Все'
          }\n📅 Создан: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`,
          parse_mode: 'HTML',
        }
      );
    } finally {
      cleanupTempFile(filePath);
    }
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, 'Ошибка скачивания логов');
    await ctx.reply(`❌ Ошибка при создании файла логов:\n<code>${error.message}</code>`, {
      parse_mode: 'HTML',
    });
  }
});

// ========== ОБРАБОТКА ТЕКСТОВЫХ СООБЩЕНИЙ ==========

// Обработка текстовых сообщений
bot.on('text', async ctx => {
  const message = ctx.message.text;
  const chatId = ctx.chat.id;
  const userId = ctx.from?.id || 0;
  
  // Проверяем, что сообщение пришло из чата (группы), привязанного к каналу
  // TODO: Нужно добавить CHAT_ID в конфигурацию
  const CHAT_ID = Number(process.env.CHAT_ID || scheduler.CHANNEL_ID); // Временно используем ID канала
  
  if (chatId !== CHAT_ID) {
    // Игнорируем сообщения не из нужного чата
    return;
  }
  
  botLogger.debug({ userId, chatId, messageLength: message.length }, `💬 Сообщение от пользователя в чате`);
  
  // Обновляем время ответа пользователя
  const responseTime = new Date().toISOString();
  updateUserResponse(userId, responseTime);
  
  // Очищаем напоминание для этого пользователя
  scheduler.clearReminder(userId);

  try {
    // Сохраняем сообщение пользователя в БД
    const userMessageTime = new Date().toISOString();
    saveMessage(userId, message, userMessageTime, userId);

    // Получаем последние 7 сообщений пользователя в хронологическом порядке
    const lastMessages = getLastNMessages(userId, 7);

    // Форматируем сообщения с датами для контекста - в правильном хронологическом порядке
    const conversationHistory = lastMessages
      .reverse() // Переворачиваем чтобы старые были вверху, новые внизу
      .map(msg => {
        const date = new Date(msg.sent_time).toLocaleString('ru-RU', {
          timeZone: 'Europe/Moscow',
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });
        const author = msg.author_id === 0 ? 'Бот' : msg.username || 'Пользователь';
        return `[${date}] ${author}: ${msg.message_text}`;
      })
      .join('\n');

    // Получаем события календаря на сегодня для пользователя
    const calendarEvents = await getUserTodayEvents(userId);

    botLogger.info(
      {
        userId,
        chatId,
        hasConversationHistory: !!conversationHistory,
        hasCalendarEvents: !!calendarEvents,
      },
      '🤖 Генерируем ответ пользователю'
    );

    // Генерируем контекстуальный ответ через LLM
    const textResponse = await generateUserResponse(message, conversationHistory, calendarEvents || undefined);

    // Отправляем текстовый ответ как reply на сообщение пользователя
    await ctx.reply(textResponse, { reply_parameters: { message_id: ctx.message.message_id } });

    // Сохраняем ответ бота в БД (author_id = 0 для бота)
    const botResponseTime = new Date().toISOString();
    saveMessage(userId, textResponse, botResponseTime, 0);

    botLogger.info({ userId, chatId, responseLength: textResponse.length }, '✅ Ответ пользователю отправлен и сохранен');
  } catch (error) {
    const err = error as Error;
    botLogger.error({ error: err.message, stack: err.stack, userId, chatId }, 'Ошибка генерации ответа пользователю');

    // Fallback ответ при ошибке
    const fallbackMessage = 'Спасибо, что поделился! 🤍';
    await ctx.reply(fallbackMessage);

    // Сохраняем fallback ответ в БД
    const fallbackTime = new Date().toISOString();
    saveMessage(userId, fallbackMessage, fallbackTime, 0);
  }
});

// Запускаем бота

// --- Telegraf polling ---
bot.launch();
logger.info({ pid: process.pid, ppid: process.ppid }, '🚀 Telegram бот запущен в режиме polling');

// Отправляем уведомление админу о запуске
const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);
if (adminChatId) {
  const processInfo = `PID: ${process.pid}${process.env.pm_id ? ` | PM2 ID: ${process.env.pm_id}` : ''}`;
  bot.telegram
    .sendMessage(
      adminChatId, 
      `🚀 <b>БОТ ЗАПУЩЕН</b>\n\n` +
      `Телеграм бот успешно запущен в режиме polling\n` +
      `🔧 ${processInfo}`, 
      { parse_mode: 'HTML' }
    )
    .catch(error => {
      logger.error({ error: error.message, adminChatId }, 'Ошибка отправки уведомления админу о запуске');
    });
}
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
