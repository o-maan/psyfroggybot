import { Telegraf } from 'telegraf';
import { config } from 'dotenv';
import { Scheduler } from './scheduler.ts';
import { addUser, updateUserResponse } from './db.ts';
import { CalendarService } from './calendar.ts';
import { writeFileSync, readFileSync, existsSync, fstat } from 'fs';
import express, { Request, Response } from 'express';
import { generateMessage, minimalTestLLM } from './llm.ts';
import { getMessage } from './messages.ts';

// Загружаем переменные окружения
config();

// Создаем экземпляр бота
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN || '');

// Создаем планировщик
const calendarService = new CalendarService();
const scheduler = new Scheduler(bot, calendarService);

// Для хранения токена в памяти (и на диске)
const TOKEN_PATH = './.calendar_token.json';
let savedTokens: any = null;

function saveTokensToFile(tokens: any) {
  writeFileSync(TOKEN_PATH, JSON.stringify(tokens), 'utf-8');
}

function loadTokensFromFile() {
  if (existsSync(TOKEN_PATH)) {
    const data = readFileSync(TOKEN_PATH, 'utf-8');
    return JSON.parse(data);
  }
  return null;
}

savedTokens = loadTokensFromFile();
if (savedTokens) {
  calendarService.setToken(savedTokens);
}

// --- Express сервер для Google OAuth2 callback ---
const app = express();
const PORT = process.env.WEBHOOK_PORT || 3000;

app.use(express.json());

app.all('/oauth2callback', async (req: Request, res: Response) => {
  const code = req.query.code as string;
  if (!code) {
    res.status(400).send('No code provided');
    return;
  }
  try {
    const tokens = await calendarService.getToken(code);
    savedTokens = tokens;
    saveTokensToFile(tokens);
    res.send('Авторизация прошла успешно! Можете вернуться к боту.');
    // Можно отправить сообщение админу или вывести в консоль
    console.log('✅ Токен успешно получен и сохранён! ' + code);
    await bot.telegram.sendMessage(process.env.ADMIN_CHAT_ID || '', 'Авторизация прошла успешно! Можете вернуться к боту.');
  } catch (error) {
    console.error('Ошибка при получении токена через сервер:', error);
    res.status(500).send('Ошибка при получении токена.');
  }
});

app.get('/status', (req: Request, res: Response) => {
  res.json({ status: 'up' });
});

app.all('/sendDailyMessage', async (req: Request, res: Response) => {
  try {
    // Можно добавить фильтрацию по chatId из тела, если нужно
    for (const chatId of scheduler["users"]) {
      await scheduler.sendDailyMessage(chatId);
    }
    res.status(200).send(`Cообщения отправлены успешно`);
    console.log('Сообщения отправлены успешно', scheduler["users"]);
  } catch (error) {
    console.error('Ошибка при отправке сообщений:', error);
    res.status(500).send(String(error));
  }
});

// 404
app.all('/', (req: Request, res: Response) => {
  res.status(404).send('Not found');
});

app.listen(PORT, () => {
  console.log(`Express сервер запущен на http://localhost:${PORT}`);
});
// --- конец Express ---

// Обработка команды /start
bot.command('start', async (ctx) => {
  await ctx.reply(
    'Привет! Я бот-лягушка 🐸\n\n' +
    'Я буду отправлять сообщения в канал каждый день в 19:30.\n' +
    'Если ты не ответишь в течение 1.5 часов, я отправлю тебе напоминание.\n\n' +
    'Доступные команды:\n' +
    '/fro - отправить сообщение сейчас\n' +
    '/calendar - настроить доступ к календарю'
  );
});

// Обработка команды /test
bot.command('test', async (ctx) => {
  const chatId = ctx.chat.id;
  const fromId = ctx.from?.id;
  console.log('🔍 TEST COMMAND - Chat ID:', chatId, 'From ID:', fromId);
  await scheduler.sendDailyMessage(fromId);
});

// Обработка команды /sendnow
bot.command('sendnow', async (ctx) => {
  const chatId = ctx.chat.id;
  const targetTime = new Date();
  targetTime.setHours(15, 38, 0, 0);

  scheduler.scheduleOneTimeMessage(chatId, targetTime);
  await ctx.reply('Сообщение будет отправлено в 15:38!');
});

// Обработка команды /fro
bot.command('fro', async (ctx) => {
  const chatId = ctx.chat.id;
  // Генерируем сообщение по тем же правилам, что и для 19:30
  const message = await scheduler.generateScheduledMessage(chatId);
  const imagePath = scheduler.getNextImage();
  const caption = message.length > 1024 ? undefined : message;
  await bot.telegram.sendPhoto(scheduler.CHANNEL_ID, { source: imagePath }, {
    caption,
    parse_mode: 'HTML'
  });
  if (message.length > 1024) {
    await bot.telegram.sendMessage(scheduler.CHANNEL_ID, message, { parse_mode: 'HTML' });
  }
});

// Обработка команды /remind
bot.command('remind', async (ctx) => {
  const chatId = ctx.chat.id;
  const sentTime = new Date().toISOString();
  scheduler.setReminder(chatId, sentTime);
});

// Обработка команды /calendar
bot.command('calendar', async (ctx) => {
  if (savedTokens) {
    calendarService.setToken(savedTokens);
    // Получаем события за вчера и сегодня
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const start = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const events = await calendarService.getEvents(start.toISOString(), end.toISOString());
    if (events && events.length > 0) {
      const eventsList = events.map((event: any) => {
        const start = event.start.dateTime || event.start.date;
        const time = event.start.dateTime
          ? new Date(event.start.dateTime).toLocaleTimeString()
          : 'Весь день';
        return `📅 ${event.summary}\n⏰ ${time}`;
      }).join('\n\n');
      await ctx.reply(`События за вчера и сегодня:\n\n${eventsList}`);
    } else {
      await ctx.reply('Событий за вчера и сегодня нет.');
    }
    return;
  }
  const authUrl = calendarService.getAuthUrl();
  await ctx.reply(
    'Для доступа к календарю, пожалуйста, перейдите по ссылке и авторизуйтесь:\n' +
    authUrl + '\n\n' +
    'Подождите немного, пока я получу токен.'
  );
});


// Команда для минимального теста LLM
bot.command('minimalTestLLM', async (ctx) => {
  await ctx.reply('Выполняю минимальный тест LLM...');
  const result = await minimalTestLLM();
  if (result) {
    await ctx.reply('Ответ LLM:\n' + result);
  } else {
    await ctx.reply('Ошибка при выполнении минимального запроса к LLM.');
  }
});

// Обработка текстовых сообщений
bot.on('text', async (ctx) => {
  const message = ctx.message.text;
  console.log(message)

  // Проверяем, похоже ли сообщение на код авторизации
  if (/^[0-9a-zA-Z/_-]{4,}$/.test(message)) {
    console.log('🔍 CODE AUTH - Chat ID:', ctx.chat.id);
    try {
      const tokens = await calendarService.getToken(message);
      savedTokens = tokens; // сохраняем токен в памяти
      await ctx.reply('Отлично! Доступ к календарю настроен.');

      // Теперь можно получить события за вчера и сегодня
      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      const start = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const events = await calendarService.getEvents(start.toISOString(), end.toISOString());
      if (events && events.length > 0) {
        const eventsList = events.map((event: any) => {
          const start = event.start.dateTime || event.start.date;
          const time = event.start.dateTime
            ? new Date(event.start.dateTime).toLocaleTimeString()
            : 'Весь день';
          return `📅 ${event.summary}\n⏰ ${time}`;
        }).join('\n\n');
        await ctx.reply(`События за вчера и сегодня:\n\n${eventsList}`);
      } else {
        await ctx.reply('Событий за вчера и сегодня нет.');
      }
    } catch (error) {
      console.error('Ошибка при получении токена:', error);
      await ctx.reply('Произошла ошибка при настройке доступа к календарю. Попробуйте еще раз.');
    }
  } else {
    // Обычная обработка текстового сообщения
    const chatId = ctx.chat.id;
    const sentTime = new Date().toISOString();
    // scheduler.updateUserResponseTime(chatId, sentTime); // Удалено, чтобы не было ошибки
    scheduler.clearReminder(chatId);
    await ctx.reply('Интересно, но не понятно! 😊');
  }
});


// Запускаем бота
bot.launch()
console.log('\n🚀 Бот успешно запущен!\n📱 Для остановки нажмите Ctrl+C\n');

// Обработка завершения работы
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM')); 