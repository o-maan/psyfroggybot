import { config } from 'dotenv';
import express, { Request, Response } from 'express';
import fs, { readFileSync } from 'fs';
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
  getUserByChatId,
  markAllLogsAsRead,
  markLogAsRead,
  markLogsAsRead,
  saveMessage,
  saveUserToken,
  updateUserGender,
  updateUserName,
  updateUserResponse,
} from './db.ts';
import { generateUserResponse, minimalTestLLM } from './llm.ts';
import { botLogger, logger } from './logger.ts';
import { Scheduler } from './scheduler.ts';

// Загружаем переменные окружения
config();

// Логируем информацию о запуске
logger.info({
  IS_TEST_BOT: process.env.IS_TEST_BOT,
  TOKEN_PREFIX: process.env.TELEGRAM_BOT_TOKEN?.substring(0, 10) + '...',
  NODE_ENV: process.env.NODE_ENV
}, '🤖 Запуск бота');

// Создаем экземпляр бота
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN || '');

// Отладка всех обновлений
bot.use(async (ctx, next) => {
  const logData: any = {
    updateType: ctx.updateType,
    chatId: ctx.chat?.id,
    from: ctx.from?.id,
    callbackQuery: ctx.callbackQuery ? true : false,
    message: ctx.message ? true : false
  };
  
  // Добавляем детали для callback_query
  if (ctx.callbackQuery) {
    logData.callbackData = 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
    logData.callbackFrom = ctx.callbackQuery.from?.id;
    logData.callbackChatId = ctx.callbackQuery.message?.chat?.id;
  }
  
  botLogger.info(logData, '📥 Получено обновление от Telegram');
  return next();
});

// Обработчик ошибок
bot.catch((err: any, ctx) => {
  botLogger.error(
    { 
      error: err?.message || String(err), 
      stack: err?.stack,
      updateType: ctx.updateType,
      chatId: ctx.chat?.id,
      userId: ctx.from?.id
    }, 
    '❌ Ошибка в обработчике бота'
  );
});

// Создаем планировщик
const calendarService = new CalendarService();
const scheduler = new Scheduler(bot, calendarService);

// Middleware для разделения тестового и основного бота
bot.use(async (ctx, next) => {
  // Пропускаем проверку для обновлений без chat (например, inline_query)
  if (!ctx.chat) {
    return next();
  }
  
  const chatId = ctx.chat.id;
  const TEST_CHANNEL_ID = -1002846400650;
  const TEST_CHAT_ID = -1002798126153;
  const isTestChannel = chatId === TEST_CHANNEL_ID || chatId === TEST_CHAT_ID;
  
  // Для команд в личных сообщениях разрешаем обоим ботам
  if (ctx.chat.type === 'private') {
    return next();
  }
  
  if (scheduler.isTestBot() && !isTestChannel) {
    // Тестовый бот работает только в тестовых каналах (кроме личных сообщений)
    botLogger.debug({ chatId, isTestBot: true, chatType: ctx.chat.type }, 'Тестовый бот игнорирует обновление не из тестового канала');
    return;
  }
  
  if (!scheduler.isTestBot() && isTestChannel) {
    // Основной бот не работает в тестовых каналах
    botLogger.debug({ chatId, isTestBot: false, chatType: ctx.chat.type }, 'Основной бот игнорирует обновление из тестового канала');
    return;
  }
  
  return next();
});

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

// Простая тестовая команда
bot.command('ping', async ctx => {
  await ctx.reply('🏓 Pong! Бот работает.');
});

// Обработка команды /start
bot.command('start', async ctx => {
  const chatId = ctx.chat.id;
  const userId = ctx.from?.id || 0;
  const username = ctx.from?.username || '';
  botLogger.info({ userId, chatId }, `📱 Команда /start от пользователя ${userId}`);

  // Добавляем пользователя в планировщик для рассылки
  scheduler.addUser(chatId);
  
  // Проверяем, если это Алекс (ID: 5153477378), автоматически устанавливаем имя и пол
  if (userId === 5153477378) {
    addUser(chatId, username, 'Алекс', 'male');
    updateUserName(chatId, 'Алекс');
    updateUserGender(chatId, 'male');
    botLogger.info({ userId, name: 'Алекс', gender: 'male' }, '✅ Автоматически установлено имя и пол для Алекса');
  } else {
    addUser(chatId, username);
  }

  await ctx.reply(
    'Привет! Я бот-лягушка 🐸\n\n' +
      'Я буду отправлять сообщения в канал каждый день в 22:00.\n' +
      'Если ты не ответишь в течение 1.5 часов, я отправлю тебе напоминание в личку.\n\n' +
      'Доступные команды:\n' +
      '/fro - отправить сообщение сейчас\n' +
      '/calendar - настроить доступ к календарю\n' +
      '/setname [имя] - установить своё имя\n\n' +
      'Админские команды:\n' +
      '/status - статус планировщика\n' +
      '/users - список пользователей\n' +
      '/last_run - время последней рассылки\n' +
      '/logs - просмотр системных логов\n' +
      '/test_schedule - тест планировщика на следующую минуту\n' +
      '/test_now - немедленный тест рассылки\n' +
      '/test_reminder - тест напоминания\n' +
      '/test_reply - тест обработки сообщений\n' +
      '/chat_info - информация о чате\n' +
      '/minimalTestLLM - тест LLM подключения'
  );
});

// Команда для установки имени пользователя
bot.command('setname', async ctx => {
  const chatId = ctx.chat.id;
  const userId = ctx.from?.id || 0;
  const text = ctx.message.text;
  const name = text.split(' ').slice(1).join(' ').trim();
  
  if (!name) {
    await ctx.reply('Пожалуйста, укажите имя после команды. Например: /setname Иван');
    return;
  }
  
  updateUserName(chatId, name);
  botLogger.info({ userId, chatId, name }, '✅ Установлено имя пользователя');
  await ctx.reply(`✅ Твоё имя установлено: ${name}`);
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
  const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);
  
  try {
    // Отладочная информация
    botLogger.info({ 
      chatId, 
      adminChatId,
      isTestBot: scheduler.isTestBot(),
      channelId: scheduler.CHANNEL_ID,
      targetUserId: scheduler.getTargetUserId()
    }, 'Получена команда /fro');
    
    // Сначала отвечаем пользователю
    botLogger.info('📤 Отправляем первый ответ пользователю...');
    await ctx.reply('🐸 Отправляю сообщение...');
    botLogger.info('✅ Первый ответ отправлен');
    
    // Используем интерактивный метод с флагом ручной команды
    botLogger.info('🚀 Запускаем sendInteractiveDailyMessage...');
    await scheduler.sendInteractiveDailyMessage(chatId, true);
    botLogger.info('✅ sendInteractiveDailyMessage завершен');
    
    // Для тестового бота - отправляем уведомление о том, что проверка будет запущена
    if (scheduler.isTestBot()) {
      botLogger.info('📤 Отправляем уведомление о тестовом режиме...');
      await ctx.reply('🤖 Тестовый режим: проверка ответов запланирована через заданное время');
      botLogger.info('✅ Уведомление о тестовом режиме отправлено');
    }
    
    botLogger.info('🎉 Команда /fro полностью выполнена');
  } catch (error) {
    const err = error as Error;
    botLogger.error({ 
      error: err.message, 
      stack: err.stack,
      chatId,
      isTestBot: scheduler.isTestBot() 
    }, 'Ошибка при выполнении команды /fro');
    await ctx.reply(`❌ Ошибка: ${err.message}`);
  }
});

// Обработка команды /remind
bot.command('remind', async ctx => {
  const chatId = ctx.chat.id;
  const sentTime = new Date().toISOString();
  scheduler.setReminder(chatId, sentTime);
});

// Тестовая команда для проверки кнопок в комментариях
bot.command('test_buttons', async ctx => {
  const chatId = ctx.chat.id;
  const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);
  
  // Проверяем, что команду выполняет админ
  if (chatId !== adminChatId) {
    await ctx.reply('❌ Эта команда доступна только администратору');
    return;
  }
  
  try {
    // Отправляем тестовый пост в канал
    const CHANNEL_ID = scheduler.CHANNEL_ID;
    
    const testMessage = await bot.telegram.sendMessage(
      CHANNEL_ID,
      '🧪 <b>ТЕСТОВЫЙ ПОСТ ДЛЯ ПРОВЕРКИ КНОПОК</b>\n\n' +
      'Это тестовое сообщение для проверки работы кнопок в комментариях.\n\n' +
      '⬇️ Кнопки должны появиться в комментариях ниже',
      { parse_mode: 'HTML' }
    );
    
    const messageId = testMessage.message_id;
    
    // Ждем немного
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Отправляем кнопки в группу обсуждений
    const CHAT_ID = scheduler.getChatId();
    
    if (!CHAT_ID) {
      await ctx.reply('❌ CHAT_ID не настроен в .env');
      return;
    }
    
    // Формируем URL для перехода в комментарии
    const commentUrl = `https://t.me/c/${CHANNEL_ID.toString().slice(4)}/${messageId}?thread=${messageId}`;
    
    const keyboard = {
      inline_keyboard: [
        [{ text: '💬 Написать ответ', url: commentUrl }],
        [{ text: '✅ Все ок - пропустить', callback_data: 'daily_skip_all' }]
      ]
    };
    
    const buttonMessage = await bot.telegram.sendMessage(
      CHAT_ID,
      '🧪 Тестовые кнопки:\n\n' +
      `Channel ID: ${CHANNEL_ID}\n` +
      `Message ID: ${messageId}\n` +
      `Comment URL: ${commentUrl}`,
      {
        reply_markup: keyboard
      }
    );
    
    await ctx.reply(
      '✅ Тестовый пост отправлен!\n\n' +
      `📢 Channel ID: <code>${CHANNEL_ID}</code>\n` +
      `💬 Chat ID: <code>${CHAT_ID}</code>\n` +
      `📝 Message ID: <code>${messageId}</code>\n` +
      `🔗 URL: <code>${commentUrl}</code>`,
      { parse_mode: 'HTML' }
    );
    
  } catch (error) {
    const err = error as Error;
    botLogger.error({ error: err.message, stack: err.stack }, 'Ошибка команды /test_buttons');
    await ctx.reply(`❌ Ошибка: ${err.message}`);
  }
});

// Команда /skip удалена, теперь используются кнопки в комментариях

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

// Команда для проверки кнопок
bot.command('test_button', async ctx => {
  try {
    const keyboard = {
      inline_keyboard: [
        [{ text: '✅ Тестовая кнопка', callback_data: 'test_button_click' }]
      ]
    };
    
    await ctx.reply('🧪 Тест кнопки:', {
      reply_markup: keyboard
    });
  } catch (error) {
    await ctx.reply(`❌ Ошибка: ${(error as Error).message}`);
  }
});

// Обработчик тестовой кнопки
bot.action('test_button_click', async ctx => {
  await ctx.answerCbQuery('✅ Кнопка работает!');
  await ctx.reply('🎉 Callback получен и обработан!');
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

// Команда для проверки пользователей в базе
bot.command('users', async ctx => {
  const chatId = ctx.chat.id;
  const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

  // Проверяем, что команду выполняет админ
  if (chatId !== adminChatId) {
    await ctx.reply('❌ Эта команда доступна только администратору');
    return;
  }

  const { getAllUsers } = await import('./db.ts');
  const users = getAllUsers();
  
  let message = `👥 <b>ПОЛЬЗОВАТЕЛИ В БАЗЕ</b>\n\n`;
  message += `Всего: ${users.length}\n\n`;
  
  users.forEach((user, index) => {
    message += `${index + 1}. User ID: <code>${user.chat_id}</code>\n`;
    if (user.name) message += `   Имя: ${user.name}\n`;
    if (user.username) message += `   Username: @${user.username}\n`;
    message += `   Ответов: ${user.response_count || 0}\n`;
    if (user.last_response_time) {
      const lastResponse = new Date(user.last_response_time).toLocaleString('ru-RU', {
        timeZone: 'Europe/Moscow'
      });
      message += `   Последний ответ: ${lastResponse}\n`;
    }
    message += '\n';
  });
  
  await ctx.reply(message, { parse_mode: 'HTML' });
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

// Команда для тестирования утренней проверки
bot.command('test_morning_check', async ctx => {
  const chatId = ctx.chat.id;
  const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

  // Проверяем, что команду выполняет админ
  if (chatId !== adminChatId) {
    await ctx.reply('❌ Эта команда доступна только администратору');
    return;
  }

  await ctx.reply('🌅 Запускаю тестовую утреннюю проверку...');
  
  try {
    // Вызываем приватный метод через any cast
    await (scheduler as any).checkUsersResponses();
    await ctx.reply('✅ Тестовая утренняя проверка выполнена успешно!');
  } catch (error) {
    await ctx.reply(`❌ Ошибка при выполнении утренней проверки:\n<code>${error}</code>`, { parse_mode: 'HTML' });
  }
});

// Команда для тестирования генерации злого поста
bot.command('angry', async ctx => {
  const chatId = ctx.chat.id;
  const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

  // Проверяем, что команду выполняет админ
  if (chatId !== adminChatId) {
    await ctx.reply('❌ Эта команда доступна только администратору');
    return;
  }

  await ctx.reply('😠 Генерирую злой пост...');
  
  try {
    // Вызываем приватный метод sendAngryPost напрямую
    // Используем ID целевого пользователя
    const TARGET_USER_ID = scheduler.getTargetUserId();
    await (scheduler as any).sendAngryPost(TARGET_USER_ID);
    await ctx.reply('✅ Злой пост отправлен в канал!');
  } catch (error) {
    await ctx.reply(`❌ Ошибка при генерации злого поста:\n<code>${error}</code>`, { parse_mode: 'HTML' });
  }
});

// Команда для проверки и отправки пропущенных ответов
bot.command('ans', async ctx => {
  const chatId = ctx.chat.id;
  const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

  // Проверяем, что команду выполняет админ
  if (chatId !== adminChatId) {
    await ctx.reply('❌ Эта команда доступна только администратору');
    return;
  }

  await ctx.reply('🔍 Запускаю проверку пропущенных ответов...');
  
  try {
    // Вызываем приватный метод через any cast
    await (scheduler as any).checkUncompletedTasks();
    await ctx.reply('✅ Проверка завершена! Все пропущенные ответы отправлены.');
  } catch (error) {
    await ctx.reply(`❌ Ошибка при проверке:\n<code>${error}</code>`, { parse_mode: 'HTML' });
  }
});

// Команда для проверки конфигурации утренней проверки
bot.command('check_config', async ctx => {
  const chatId = ctx.chat.id;
  const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

  // Проверяем, что команду выполняет админ
  if (chatId !== adminChatId) {
    await ctx.reply('❌ Эта команда доступна только администратору');
    return;
  }

  const TARGET_USER_ID = scheduler.getTargetUserId();
  const status = scheduler.getSchedulerStatus();
  
  // Проверяем существование файлов промптов
  const fs = require('fs');
  const textPromptExists = fs.existsSync('assets/prompts/no-answer');
  const imagePromptExists = fs.existsSync('assets/prompts/frog-image-promt-angry');
  
  await ctx.reply(
    `🔧 <b>КОНФИГУРАЦИЯ УТРЕННЕЙ ПРОВЕРКИ</b>\n\n` +
    `👤 Целевой пользователь: <code>${TARGET_USER_ID}</code>\n` +
    `📢 Канал для постов: <code>${scheduler.CHANNEL_ID}</code>\n` +
    `⏰ Время проверки: <b>8:00 МСК</b>\n` +
    `☀️ Статус утренней проверки: ${status.isMorningRunning ? '🟢 Активна' : '🔴 Остановлена'}\n\n` +
    `📄 <b>Файлы промптов:</b>\n` +
    `├─ Текст (no-answer): ${textPromptExists ? '✅ Найден' : '❌ Не найден'}\n` +
    `└─ Изображение (frog-image-promt-angry): ${imagePromptExists ? '✅ Найден' : '❌ Не найден'}\n\n` +
    `🕐 Текущее время МСК: <code>${status.currentTime}</code>`,
    { parse_mode: 'HTML' }
  );
});

// Команда для проверки доступа к каналам
bot.command('check_access', async ctx => {
  const chatId = ctx.chat.id;
  const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);
  
  // Проверяем, что команду выполняет админ
  if (chatId !== adminChatId) {
    await ctx.reply('❌ Эта команда доступна только администратору');
    return;
  }

  const channelId = scheduler.CHANNEL_ID;
  const groupId = scheduler.getChatId();
  
  let message = `🔍 <b>Проверка доступа бота</b>\n\n`;
  message += `🤖 Тестовый режим: ${scheduler.isTestBot() ? 'ДА' : 'НЕТ'}\n`;
  message += `📢 ID канала: <code>${channelId}</code>\n`;
  message += `💬 ID группы: <code>${groupId}</code>\n\n`;
  
  // Проверяем доступ к каналу
  try {
    const channelInfo = await bot.telegram.getChat(channelId);
    message += `✅ Доступ к каналу: ЕСТЬ\n`;
    message += `   Название: ${('title' in channelInfo ? channelInfo.title : undefined) || 'Без названия'}\n`;
    message += `   Тип: ${channelInfo.type}\n`;
  } catch (error) {
    const err = error as Error;
    message += `❌ Доступ к каналу: НЕТ\n`;
    message += `   Ошибка: ${err.message}\n`;
  }
  
  // Проверяем доступ к группе
  if (groupId) {
    try {
      const groupInfo = await bot.telegram.getChat(groupId);
      message += `\n✅ Доступ к группе: ЕСТЬ\n`;
      message += `   Название: ${('title' in groupInfo ? groupInfo.title : undefined) || 'Без названия'}\n`;
      message += `   Тип: ${groupInfo.type}\n`;
    } catch (error) {
      const err = error as Error;
      message += `\n❌ Доступ к группе: НЕТ\n`;
      message += `   Ошибка: ${err.message}\n`;
    }
  } else {
    message += `\n⚠️ ID группы не настроен\n`;
  }
  
  // Проверяем права администратора в канале
  try {
    const botInfo = await bot.telegram.getMe();
    const member = await bot.telegram.getChatMember(channelId, botInfo.id);
    message += `\n📋 Статус бота в канале: ${member.status}\n`;
    if (member.status === 'administrator') {
      message += `   ✅ Права администратора\n`;
    }
  } catch (error) {
    const err = error as Error;
    message += `\n❌ Не удалось проверить права: ${err.message}\n`;
  }
  
  await ctx.reply(message, { parse_mode: 'HTML' });
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
      `⚙️ Общий статус: ${status.isRunning ? '🟢 <b>Активен</b>' : '🔴 <b>Остановлен</b>'}\n` +
      `🌙 Вечерняя рассылка: ${status.isDailyRunning ? '🟢 Активна' : '🔴 Остановлена'}\n` +
      `☀️ Утренняя проверка: ${status.isMorningRunning ? '🟢 Активна' : '🔴 Остановлена'}\n\n` +
      `📅 Расписание: <code>${status.description}</code>\n` +
      `🕐 Выражения: <code>${status.cronExpression}</code>\n` +
      `🌍 Часовой пояс: <code>${status.timezone}</code>\n\n` +
      `🕐 <b>Текущее время (МСК):</b> <code>${status.currentTime}</code>\n` +
      `⏰ <b>Следующие запуски:</b>\n<code>${status.nextRunTime}</code>\n\n` +
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

// Команда для теста обработки сообщений
bot.command('test_reply', async ctx => {
  const chatId = ctx.chat.id;
  const chatType = ctx.chat.type;
  const CHAT_ID = scheduler.getChatId();
  
  await ctx.reply(
    `🧪 <b>ТЕСТ ОБРАБОТКИ СООБЩЕНИЙ</b>\n\n` +
    `📍 Текущий чат ID: <code>${chatId}</code>\n` +
    `📝 Тип чата: <code>${chatType}</code>\n` +
    `🎯 Целевой CHAT_ID: <code>${CHAT_ID || 'НЕ УСТАНОВЛЕН'}</code>\n` +
    `✅ Бот обрабатывает сообщения: ${!CHAT_ID || chatId === CHAT_ID ? 'ДА' : 'НЕТ'}\n\n` +
    `Напишите любое сообщение для теста...`,
    { parse_mode: 'HTML' }
  );
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

// ========== ОБРАБОТЧИКИ КНОПОК ПРАКТИК ==========

// Старый обработчик удален - используется новый ниже

/*
bot.action(/practice_postpone_(\d+)/, async ctx => {
  const userId = parseInt(ctx.match![1]);
  
  try {
    // Проверяем, что кнопку нажал тот же пользователь
    if (ctx.from?.id !== userId) {
      await ctx.answerCbQuery('❌ Эта кнопка не для вас');
      return;
    }
    
    // Удаляем кнопки из исходного сообщения
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    
    // Устанавливаем напоминание через час
    const chatId = ctx.chat?.id || 0;
    const reminderTime = Date.now() + 60 * 60 * 1000; // 1 час
    
    // Сохраняем информацию о практике для напоминания
    const session = scheduler.getInteractiveSession(userId);
    if (session) {
      session.practicePostponed = true;
      session.postponedUntil = reminderTime;
    }
    
    // Устанавливаем таймер для напоминания
    setTimeout(async () => {
      try {
        const reminderMessage = '⏰ Напоминание: давай сделаем практику! Это займет всего несколько минут 💚';
        
        // Определяем куда отправлять напоминание
        const messageThreadId = (ctx.callbackQuery.message as any)?.message_thread_id;
        const replyOptions: any = {
          parse_mode: 'HTML'
        };
        
        if (messageThreadId) {
          replyOptions.reply_to_message_id = messageThreadId;
        }
        
        await scheduler.getBot().telegram.sendMessage(chatId, reminderMessage, replyOptions);
        
        // Сохраняем в историю
        saveMessage(userId, reminderMessage, new Date().toISOString(), 0);
        
      } catch (error) {
        botLogger.error({ error, userId }, 'Ошибка отправки напоминания о практике');
      }
    }, 60 * 60 * 1000); // 1 час
    
    await ctx.answerCbQuery('⏰ Напомню через час');
    
    // Сохраняем в историю
    saveMessage(userId, `[Отложил практику на час]`, new Date().toISOString(), userId);
    
  } catch (error) {
    botLogger.error({ error, userId }, 'Ошибка обработки practice_postpone');
    await ctx.answerCbQuery('❌ Произошла ошибка');
  }
});
*/

// ========== ОБРАБОТКА ТЕКСТОВЫХ СООБЩЕНИЙ ==========

// Обработчик для отслеживания пересланных сообщений из канала
bot.on('message', async (ctx, next) => {
  // Проверяем, является ли это пересланным сообщением из канала
  if (ctx.message && 
      'forward_from_chat' in ctx.message && 
      ctx.message.forward_from_chat &&
      typeof ctx.message.forward_from_chat === 'object' &&
      'type' in ctx.message.forward_from_chat &&
      ctx.message.forward_from_chat.type === 'channel' &&
      'id' in ctx.message.forward_from_chat &&
      ctx.message.forward_from_chat.id === scheduler.CHANNEL_ID &&
      'forward_from_message_id' in ctx.message) {
    
    const channelMessageId = ctx.message.forward_from_message_id as number;
    const discussionMessageId = ctx.message.message_id;
    
    // Сохраняем соответствие ID
    scheduler.saveForwardedMessage(channelMessageId, discussionMessageId);
    
    const currentTime = new Date();
    botLogger.info({
      channelMessageId,
      discussionMessageId,
      chatId: ctx.chat.id,
      isTopicMessage: ctx.message.is_topic_message,
      messageThreadId: (ctx.message as any).message_thread_id,
      fromChat: ctx.message.forward_from_chat,
      receivedAt: currentTime.toISOString(),
      timestamp: currentTime.getTime()
    }, '📎 Обнаружено пересланное сообщение из канала');
  }
  
  // Также проверяем, если это сообщение в теме (комментарий к посту)
  if (ctx.message && 'message_thread_id' in ctx.message) {
    botLogger.debug({
      messageThreadId: (ctx.message as any).message_thread_id,
      chatId: ctx.chat.id,
      messageId: ctx.message.message_id
    }, '💬 Сообщение в теме/треде');
  }
  
  // Продолжаем обработку
  return next();
});

// ВРЕМЕННО ОТКЛЮЧЕНО: автоматические ответы бота в комментариях
// Код сохранен для возможного восстановления функциональности в будущем
const AUTO_RESPONSES_ENABLED = false; // Переключатель для быстрого включения/отключения

// Обработка текстовых сообщений
bot.on('text', async ctx => {
  const message = ctx.message.text;
  const chatId = ctx.chat.id;
  const userId = ctx.from?.id || 0;
  
  // Пропускаем команды - они обрабатываются отдельными обработчиками
  if (message.startsWith('/')) {
    return;
  }
  
  // Получаем ID чата и канала
  const CHAT_ID = scheduler.getChatId();
  const CHANNEL_ID = scheduler.CHANNEL_ID;
  
  // Логируем для отладки
  botLogger.info(
    { 
      chatId, 
      CHAT_ID, 
      CHANNEL_ID,
      chatType: ctx.chat.type,
      messageId: ctx.message.message_id,
      fromId: ctx.from?.id,
      fromIsBot: ctx.from?.is_bot,
      fromUsername: ctx.from?.username,
      message: message.substring(0, 50) 
    }, 
    '🔍 Проверка сообщения'
  );
  
  // Проверяем, что сообщение не от самого бота
  if (ctx.from?.is_bot) {
    botLogger.debug({ userId: ctx.from?.id, chatId, isBot: ctx.from?.is_bot }, 'Игнорируем сообщение от бота');
    return;
  }
  
  // Проверяем, что сообщение пришло либо из канала, либо из чата
  const isFromChannel = chatId === CHANNEL_ID;
  const isFromChat = CHAT_ID && chatId === CHAT_ID;
  
  // ВАЖНО: В Telegram, когда группа привязана к каналу, сообщения из группы
  // могут иметь другой chat_id. Нужно проверить тип чата.
  const isFromLinkedChat = ctx.chat.type === 'supergroup' && !isFromChannel && !isFromChat;
  
  if (!isFromChannel && !isFromChat && !isFromLinkedChat) {
    // Игнорируем сообщения не из канала и не из связанной группы
    botLogger.debug({ chatId, CHAT_ID, CHANNEL_ID, chatType: ctx.chat.type }, 'Сообщение не из целевого канала/чата, игнорируем');
    return;
  }
  
  // Если это связанная группа, используем её ID для ответов
  const replyToChatId = isFromLinkedChat ? chatId : (CHAT_ID || chatId);
  
  if (!CHAT_ID && !isFromLinkedChat) {
    botLogger.warn('⚠️ CHAT_ID не установлен в .env! Бот не сможет отвечать в чат');
    return;
  }
  
  botLogger.debug({ userId, chatId, messageLength: message.length }, `💬 Сообщение от пользователя в чате`);
  
  // Константа для целевого пользователя
  const TARGET_USER_ID = scheduler.getTargetUserId();
  
  // Обновляем время ответа только для целевого пользователя
  if (userId === TARGET_USER_ID) {
    const responseTime = new Date().toISOString();
    updateUserResponse(userId, responseTime);
    botLogger.info({ 
      userId, 
      responseTime,
      targetUserId: TARGET_USER_ID 
    }, `✅ Обновлено время ответа для целевого пользователя ${TARGET_USER_ID}`);
  } else {
    botLogger.debug({ 
      userId, 
      targetUserId: TARGET_USER_ID
    }, `⏭️ Пропущено обновление времени ответа - не целевой пользователь`);
  }
  
  // Очищаем напоминание для этого пользователя
  scheduler.clearReminder(userId);

  try {
    // Сначала сохраняем сообщение пользователя в БД
    const userMessageTime = new Date().toISOString();
    saveMessage(userId, message, userMessageTime, userId);
    
    // Проверяем, есть ли активная интерактивная сессия
    const messageThreadId = (ctx.message as any).message_thread_id;
    const isInteractive = await scheduler.handleInteractiveUserResponse(
      userId, 
      message, 
      replyToChatId,
      ctx.message.message_id,
      messageThreadId
    );

    if (isInteractive) {
      // Сообщение обработано в интерактивном режиме
      return;
    }

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
    
    if (AUTO_RESPONSES_ENABLED) {
      // Генерируем контекстуальный ответ через LLM
      const textResponse = await generateUserResponse(message, conversationHistory, calendarEvents || undefined);

      // Отправляем текстовый ответ в правильный чат
      // Если сообщение из связанной группы - отвечаем туда же
      // Иначе - в CHAT_ID из конфига
      await bot.telegram.sendMessage(replyToChatId, textResponse, { 
        reply_parameters: { 
          message_id: ctx.message.message_id,
          chat_id: chatId // указываем исходный чат для правильной ссылки на сообщение
        } 
      });

      // Сохраняем ответ бота в БД (author_id = 0 для бота)
      const botResponseTime = new Date().toISOString();
      saveMessage(userId, textResponse, botResponseTime, 0);

      botLogger.info({ userId, chatId, responseLength: textResponse.length }, '✅ Ответ пользователю отправлен и сохранен');
    } else {
      botLogger.debug({ userId, chatId }, '⏸️ Автоматические ответы временно отключены');
    }
  } catch (error) {
    const err = error as Error;
    botLogger.error({ error: err.message, stack: err.stack, userId, chatId }, 'Ошибка генерации ответа пользователю');

    // Fallback ответ при ошибке - также проверяем флаг автоответов
    if (AUTO_RESPONSES_ENABLED) {
      const fallbackMessage = 'Спасибо, что поделился! 🤍';
      await bot.telegram.sendMessage(replyToChatId, fallbackMessage, {
        reply_parameters: {
          message_id: ctx.message.message_id,
          chat_id: chatId
        }
      });

      // Сохраняем fallback ответ в БД
      const fallbackTime = new Date().toISOString();
      saveMessage(userId, fallbackMessage, fallbackTime, 0);
    }
  }
});

// ========== ОБРАБОТЧИКИ ИНТЕРАКТИВНЫХ КНОПОК ==========

// Общий обработчик для всех callback_query (для отладки)
bot.on('callback_query', async (ctx, next) => {
  const data = 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
  const chatId = ctx.callbackQuery.message?.chat?.id;
  
  botLogger.info({
    callbackData: data,
    fromId: ctx.from?.id,
    chatId: chatId,
    messageId: ctx.callbackQuery.message?.message_id,
    isPracticeDone: data?.startsWith('practice_done_'),
    isPracticePostpone: data?.startsWith('practice_postpone_')
  }, '🔔 Получен callback_query');
  
  
  // Проверяем, что callback обрабатывается
  if (data?.startsWith('practice_')) {
    botLogger.info({ 
      callbackData: data,
      willBeHandled: true 
    }, '✅ Callback будет обработан');
  }
  
  return next();
});

// Обработчик кнопки "Все ок - пропустить" (больше не используется в новой логике)
bot.action('daily_skip_all', async ctx => {
  try {
    await ctx.answerCbQuery('Эта функция больше не используется');
  } catch (error) {
    botLogger.error({ error }, 'Ошибка обработки кнопки "Все ок - пропустить"');
    await ctx.answerCbQuery('❌ Произошла ошибка');
  }
});

// Обработчик для кнопки пропуска первого задания - новый формат
bot.action(/skip_neg_(\d+)/, async ctx => {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const messageId = ctx.callbackQuery.message?.message_id;
    const chatId = ctx.callbackQuery.message?.chat?.id;
    const userId = ctx.from?.id;
    
    await ctx.answerCbQuery('👍 Хорошо! Переходим к плюшкам');
    
    botLogger.info({
      action: 'skip_neg',
      channelMessageId,
      messageId,
      chatId,
      userId
    }, '🔘 Нажата кнопка пропуска первого задания');
    
    // Получаем данные поста из БД
    const { getInteractivePost, updateTaskStatus, escapeHTML } = await import('./db');
    const post = getInteractivePost(channelMessageId);
    
    if (!post) {
      botLogger.error({ channelMessageId }, 'Пост не найден в БД');
      return;
    }
    
    // Отмечаем первое задание как пропущенное
    updateTaskStatus(channelMessageId, 1, true);
    
    // Отправляем плюшки (второе задание)
    let plushkiText = '2. <b>Плюшки для лягушки</b> (ситуация+эмоция)';
    if (post.message_data?.positive_part?.additional_text) {
      plushkiText += `\n<blockquote>${escapeHTML(post.message_data.positive_part.additional_text)}</blockquote>`;
    }
    
    await bot.telegram.sendMessage(chatId!, plushkiText, {
      parse_mode: 'HTML',
      reply_parameters: {
        message_id: messageId!
      }
    });
    
    botLogger.info({ channelMessageId }, '✅ Плюшки отправлены после пропуска');
    
  } catch (error) {
    botLogger.error({ error: (error as Error).message }, 'Ошибка обработки кнопки пропуска');
  }
});

// Старый обработчик для обратной совместимости
bot.action('daily_skip_negative', async ctx => {
  await ctx.answerCbQuery('Эта кнопка устарела. Используйте новый пост.');
});

// Обработчик кнопки "Сделал" для практики - новый формат
bot.action(/pract_done_(\d+)/, async ctx => {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const userId = ctx.from?.id;
    
    await ctx.answerCbQuery('🎉 Отлично! Ты молодец!');
    
    botLogger.info({ 
      action: 'pract_done',
      channelMessageId,
      userId,
      chatId: ctx.chat?.id 
    }, '🎯 Обработка кнопки practice_done');
    
    // Получаем данные из БД
    const { getInteractivePost, updateTaskStatus, setTrophyStatus } = await import('./db');
    const post = getInteractivePost(channelMessageId);
    
    if (!post) {
      botLogger.error({ channelMessageId }, 'Пост не найден в БД для practice_done');
      return;
    }
    
    // Отмечаем третье задание выполненным
    updateTaskStatus(channelMessageId, 3, true);
    
    // Fallback сообщения поздравления
    const fallbacks = [
      'Ты молодец! 🌟 Сегодня мы отлично поработали вместе.',
      'Отличная работа! 💚 Ты заботишься о себе, и это прекрасно.',
      'Супер! ✨ Каждая практика делает тебя сильнее.',
      'Великолепно! 🌈 Ты сделал важный шаг для своего благополучия.',
      'Ты справился! 🎯 На сегодня все задания выполнены.',
      'Ты молодец! 🌙 Пора отдыхать.',
      'Я горжусь тобой! 💫 Ты сделал отличную работу.',
      'Отлично! 🌿 Все задания на сегодня завершены.',
      'Прекрасная работа! 🎉 Теперь можно расслабиться.'
    ];
    const congratsMessage = fallbacks[Math.floor(Math.random() * fallbacks.length)];
    
    await ctx.telegram.sendMessage(
      ctx.chat!.id, 
      congratsMessage,
      {
        parse_mode: 'HTML',
        reply_parameters: {
          message_id: ctx.callbackQuery.message!.message_id
        }
      }
    );
    
    // Добавляем реакцию трофея к посту в канале
    if (!post.trophy_set) {
      try {
        await ctx.telegram.setMessageReaction(
          scheduler.CHANNEL_ID,
          channelMessageId,
          [{ type: 'emoji', emoji: '🏆' }]
        );
        
        // Отмечаем в БД что трофей установлен
        setTrophyStatus(channelMessageId, true);
        
        botLogger.info({ 
          channelMessageId,
          channelId: scheduler.CHANNEL_ID 
        }, '🏆 Добавлена реакция трофея к посту в канале');
      } catch (error) {
        botLogger.error({ 
          error: (error as Error).message,
          channelMessageId,
          channelId: scheduler.CHANNEL_ID
        }, '❌ Ошибка добавления реакции к посту');
      }
    }
    
  } catch (error) {
    botLogger.error({ error: (error as Error).message }, 'Ошибка обработки practice_done');
  }
});

// Старый обработчик для обратной совместимости
bot.action(/practice_done_(\d+)/, async ctx => {
  await ctx.answerCbQuery('Эта кнопка устарела. Используйте новый пост.');
});

// Обработчик кнопки "Отложить на 1 час"
bot.action(/practice_postpone_(\d+)/, async ctx => {
  botLogger.info({ 
    action: 'practice_postpone',
    match: ctx.match,
    callbackData: 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : undefined,
    fromId: ctx.from?.id,
    chatId: ctx.chat?.id 
  }, '⏰ Вызван обработчик practice_postpone');
  
  try {
    const userId = parseInt(ctx.match![1]);
    const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);
    
    await ctx.answerCbQuery('⏰ Хорошо, напомню через час');
    
    // Ищем сессию по adminChatId или userId
    const session = scheduler.getInteractiveSession(adminChatId) || scheduler.getInteractiveSession(userId);
    if (!session) {
      botLogger.warn({ userId, adminChatId }, 'Сессия не найдена для practice_postpone');
      return;
    }
    
    // Константа для задержки напоминания (легко изменить)
    const PRACTICE_REMINDER_DELAY_MINUTES = 60; // 60 минут для продакшена
    const reminderDelayMs = PRACTICE_REMINDER_DELAY_MINUTES * 60 * 1000;
    
    botLogger.info({ 
      delayMinutes: PRACTICE_REMINDER_DELAY_MINUTES,
      delayMs: reminderDelayMs 
    }, '⏰ Устанавливаем напоминание о практике');
    
    // Сохраняем время откладывания
    session.practicePostponed = true;
    session.postponedUntil = Date.now() + reminderDelayMs;
    
    // Отправляем сообщение о том, что ждем через час
    try {
      const waitMessage = PRACTICE_REMINDER_DELAY_MINUTES === 60 
        ? '⏳ Жду тебя через час'
        : `⏳ Жду тебя через ${PRACTICE_REMINDER_DELAY_MINUTES} ${PRACTICE_REMINDER_DELAY_MINUTES === 1 ? 'минуту' : 'минут'}`;
        
      const waitOptions: any = {
        parse_mode: 'HTML',
        reply_to_message_id: ctx.callbackQuery.message?.message_id
      };
      
      await ctx.telegram.sendMessage(
        ctx.chat!.id,
        waitMessage,
        waitOptions
      );
      
      botLogger.info({ userId }, '⏳ Отправлено сообщение ожидания');
    } catch (error) {
      botLogger.error({ error: (error as Error).message }, 'Ошибка отправки сообщения ожидания');
    }
    
    // Устанавливаем таймер на напоминание
    setTimeout(async () => {
      try {
        botLogger.info({ 
          userId,
          chatId: ctx.chat?.id 
        }, '🔔 Отправляем напоминание о практике');
        
        const reminderMessage = '⏰ Напоминание: давай сделаем практику! Это займет всего несколько минут 💚';
        
        // В группах с комментариями используем только reply_to_message_id
        const sendOptions: any = {
          parse_mode: 'HTML',
          reply_to_message_id: ctx.callbackQuery.message?.message_id
        };
        
        await ctx.telegram.sendMessage(
          ctx.chat!.id,
          reminderMessage,
          sendOptions
        );
        
        botLogger.info({ userId }, '✅ Напоминание о практике отправлено');
      } catch (error) {
        botLogger.error({ error: (error as Error).message }, 'Ошибка отправки напоминания');
      }
    }, reminderDelayMs);
    
  } catch (error) {
    botLogger.error({ error: (error as Error).message }, 'Ошибка обработки practice_postpone');
  }
});


// Запускаем бота

// НЕ очищаем pending updates - пусть Telegraf их обработает
async function clearPendingUpdates() {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return;
    
    // Получаем информацию o webhook
    const webhookResponse = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    const webhookData = await webhookResponse.json();
    
    if (webhookData.ok && webhookData.result.pending_update_count > 0) {
      logger.info({ 
        pendingCount: webhookData.result.pending_update_count 
      }, '🔄 Найдены pending updates, Telegraf их обработает');
    } else {
      logger.info('✅ Очередь updates пуста');
    }
  } catch (error) {
    logger.warn({ error: (error as Error).message }, '⚠️ Не удалось проверить очередь updates');
  }
}

// --- Telegraf polling ---
clearPendingUpdates()
  .then(() => bot.launch())
  .then(() => {
    logger.info({ pid: process.pid, ppid: process.ppid }, '🚀 Telegram бот запущен в режиме polling');
    
    // Логируем успешный запуск
    logger.info('✅ Polling активен и готов к получению команд');
    
    // Логируем зарегистрированные обработчики
    logger.info({
      handlers: [
        'callback_query (общий)',
        'daily_skip_all',
        'daily_skip_negative', 
        'practice_done_*',
        'practice_postpone_*'
      ]
    }, '📋 Зарегистрированные обработчики кнопок');
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
