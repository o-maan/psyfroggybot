import { Telegraf } from "telegraf";
import { config } from "dotenv";
import { Scheduler } from "./scheduler.ts";
import { addUser, saveUserToken, getLastUserToken } from "./db.ts";
import { CalendarService, formatCalendarEvents } from "./calendar.ts";
import express, { Request, Response } from "express";
import { minimalTestLLM } from "./llm.ts";

// Загружаем переменные окружения
config();

// Создаем экземпляр бота
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN || "");

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

restServ.all("/oauth2callback", async (req: Request, res: Response) => {
  const code = req.query.code as string;
  const state = req.query.state as string;
  const chatId = Number(state);
  console.log(
    "🔍 OAUTH2 CALLBACK - Chat ID:",
    chatId,
    "Code:",
    code,
    "State:",
    state,
  );
  if (!code) {
    res.status(400).send("No code provided");
    return;
  }
  if (!chatId || isNaN(chatId)) {
    res.status(400).send("Invalid chat ID in state parameter");
    return;
  }
  try {
    const tokens = await calendarService.getToken(code);
    saveUserToken(chatId, JSON.stringify(tokens));
    res.send("Авторизация прошла успешно! Можете вернуться к боту.");
    // Можно отправить сообщение админу или вывести в консоль
    console.log("✅ Токен успешно получен и сохранён! " + code);
    await bot.telegram.sendMessage(
      chatId,
      "Авторизация прошла успешно! Можете вернуться к боту.",
    );
  } catch (error) {
    console.error("Ошибка при получении токена через сервер:", error);
    res.status(500).send("Ошибка при получении токена.");
  }
});

restServ.get("/status", (req: Request, res: Response) => {
  res.json({ status: "up" });
  console.log("🔍 STATUS - OK");
});

restServ.all("/sendDailyMessage", async (req: Request, res: Response) => {
  const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);
  try {
    await scheduler.sendDailyMessagesToAll(adminChatId);
    res
      .status(200)
      .send(
        `Cообщения отправлены успешно, пользователей: ${scheduler["users"].size}, админ: ${adminChatId}`,
      );
    console.log(
      "🔍 SEND DAILY MESSAGE - Сообщения отправлены успешно",
      scheduler["users"],
    );
  } catch (error) {
    console.error(
      "❌ SEND DAILY MESSAGE - Ошибка при отправке сообщений:",
      error,
      `пользователей: ${scheduler["users"].size}, админ: ${adminChatId}`,
    );
    res.status(500).send(String(error));
  }
});

// 404
restServ.all("/", (req: Request, res: Response) => {
  res.status(404).send("Not found");
});

// Запуск сервера на всех интерфейсах (для Fly.io)
restServ.listen(Number(SERVER_PORT), "0.0.0.0", () => {
  console.log(`✅ EXPRESS сервер слушает на 0.0.0.0:${SERVER_PORT}`);
});

// Обработка команды /start
bot.command("start", async (ctx) => {
  const chatId = ctx.chat.id;
  // Добавляем пользователя в планировщик для рассылки
  scheduler.addUser(chatId);

  await ctx.reply(
    "Привет! Я бот-лягушка 🐸\n\n" +
      "Я буду отправлять сообщения в канал каждый день в 19:30.\n" +
      "Если ты не ответишь в течение 1.5 часов, я отправлю тебе напоминание.\n\n" +
      "Доступные команды:\n" +
      "/fro - отправить сообщение сейчас\n" +
      "/calendar - настроить доступ к календарю\n\n" +
      "Админские команды:\n" +
      "/status - статус планировщика\n" +
      "/test_schedule - тест планировщика на следующую минуту\n" +
      "/test_now - немедленный тест рассылки\n" +
      "/minimalTestLLM - тест LLM подключения",
  );
});

// Обработка команды /test
bot.command("test", async (ctx) => {
  const chatId = ctx.chat.id;
  const fromId = ctx.from?.id;
  console.log("🔍 TEST COMMAND - Chat ID:", chatId, "From ID:", fromId);
  await scheduler.sendDailyMessage(fromId);
});

// Обработка команды /sendnow
bot.command("sendnow", async (ctx) => {
  const chatId = ctx.chat.id;
  const targetTime = new Date();
  targetTime.setHours(15, 38, 0, 0);

  scheduler.scheduleOneTimeMessage(chatId, targetTime);
  await ctx.reply("Сообщение будет отправлено в 15:38!");
});

// Обработка команды /fro
bot.command("fro", async (ctx) => {
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
      parse_mode: "HTML",
    },
  );
  if (message.length > 1024) {
    await bot.telegram.sendMessage(scheduler.CHANNEL_ID, message, {
      parse_mode: "HTML",
    });
  }
});

// Обработка команды /remind
bot.command("remind", async (ctx) => {
  const chatId = ctx.chat.id;
  const sentTime = new Date().toISOString();
  scheduler.setReminder(chatId, sentTime);
});

// Обработка команды /calendar
bot.command("calendar", async (ctx) => {
  const chatId = ctx.chat.id;
  // Save user if not exists
  addUser(chatId, ctx.from?.username || "");
  const lastToken = getLastUserToken(chatId);
  if (lastToken) {
    console.log("🔍 LAST TOKEN:", lastToken);
    try {
      calendarService.setToken(JSON.parse(lastToken.token));
      // Get events for yesterday and today
      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      const start = new Date(
        yesterday.getFullYear(),
        yesterday.getMonth(),
        yesterday.getDate(),
      );
      const end = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
      );
      const events = await calendarService.getEvents(
        start.toISOString(),
        end.toISOString(),
      );
      if (events && events.length > 0) {
        const eventsList = formatCalendarEvents(events, {
          locale: "ru-RU",
          showDate: true,
          showBusy: true,
          showLocation: true,
          showDescription: true,
          showLink: true,
        });
        await ctx.reply(`События за вчера и сегодня:\n\n${eventsList}`, {
          parse_mode: "HTML",
        });
      } else {
        await ctx.reply("Событий за вчера и сегодня нет.");
      }
      return;
    } catch (error) {
      console.error("Ошибка при получении токена:", error);
      await ctx.reply(
        "Произошла ошибка при настройке доступа к календарю. Попробуйте еще раз.",
      );
    }
  }
  // Pass chatId in state
  const authUrl = calendarService.getAuthUrl({ state: chatId.toString() });
  await ctx.reply(
    "Для доступа к календарю, пожалуйста, перейдите по ссылке и авторизуйтесь:\n" +
      authUrl +
      "\n\n" +
      "Подождите немного, пока я получу токен.",
  );
});

// Команда для минимального теста LLM
bot.command("minimalTestLLM", async (ctx) => {
  await ctx.reply("Выполняю минимальный тест LLM...");
  const result = await minimalTestLLM();
  if (result) {
    await ctx.reply("Ответ LLM:\n" + result);
  } else {
    await ctx.reply("Ошибка при выполнении минимального запроса к LLM.");
  }
});

// Команда для дебага индекса картинки
bot.command("next_image", async (ctx) => {
  const chatId = ctx.chat.id;
  try {
    const imagePath = scheduler.getNextImage(chatId);
    await ctx.replyWithPhoto(
      { source: imagePath },
      {
        caption: `Next image for chatId=${chatId}\nПуть: ${imagePath}`,
      },
    );
  } catch (e) {
    console.error("Ошибка в /next_image:", e);
    await ctx.reply("Ошибка при получении следующей картинки: " + e);
  }
});

// Команда для проверки статуса планировщика
bot.command("status", async (ctx) => {
  const chatId = ctx.chat.id;
  const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

  // Проверяем, что команду выполняет админ
  if (chatId !== adminChatId) {
    await ctx.reply("❌ Эта команда доступна только администратору");
    return;
  }

  const status = scheduler.getSchedulerStatus();

  await ctx.reply(
    `📊 <b>СТАТУС ПЛАНИРОВЩИКА</b>\n\n` +
      `⚙️ Cron job: ${status.isRunning ? "🟢 <b>Активен</b>" : "🔴 <b>Остановлен</b>"}\n` +
      `📅 Расписание: <code>${status.description}</code>\n` +
      `🕐 Выражение: <code>${status.cronExpression}</code>\n` +
      `🌍 Часовой пояс: <code>${status.timezone}</code>\n\n` +
      `🕐 <b>Текущее время (МСК):</b> <code>${status.currentTime}</code>\n` +
      `⏰ <b>Следующий запуск:</b> <code>${status.nextRunTime}</code>\n\n` +
      `👥 <b>Пользователей:</b> ${status.usersCount}\n` +
      `🔑 <b>Admin ID:</b> <code>${status.adminChatId}</code>\n` +
      `📋 <b>Список пользователей:</b>\n<code>${status.usersList.length > 0 ? status.usersList.join(", ") : "Нет пользователей"}</code>`,
    { parse_mode: "HTML" },
  );
});

// Обработка текстовых сообщений
bot.on("text", async (ctx) => {
  const message = ctx.message.text;
  console.log(message);

  // Обычная обработка текстового сообщения
  const chatId = ctx.chat.id;
  const sentTime = new Date().toISOString();
  // scheduler.updateUserResponseTime(chatId, sentTime); // Удалено, чтобы не было ошибки
  scheduler.clearReminder(chatId);
  await ctx.reply("Интересно, но не понятно! 😊");
});

// Команда для тестирования автоматической отправки
bot.command("test_schedule", async (ctx) => {
  const chatId = ctx.chat.id;
  const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

  // Проверяем, что команду выполняет админ
  if (chatId !== adminChatId) {
    await ctx.reply("❌ Эта команда доступна только администратору");
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
      `🕐 Запуск в: <code>${String(nextHour).padStart(2, "0")}:${String(nextMinute).padStart(2, "0")}</code>\n` +
      `🌍 Часовой пояс: <code>Europe/Moscow</code>\n\n` +
      `⏳ Ожидайте тестовое сообщение...`,
    { parse_mode: "HTML" }
  );

  const testJob = require("node-cron").schedule(
    cronExpression,
    async () => {
      try {
        console.log("🧪 [TEST CRON] Запуск тестового cron job");
        await scheduler.sendDailyMessage(chatId);
        await ctx.reply("✅ 🧪 Тестовое сообщение отправлено успешно!");
        testJob.stop();
        testJob.destroy();
      } catch (error) {
        console.error("❌ [TEST CRON] Ошибка в тестовом cron job:", error);
        await ctx.reply(`❌ Ошибка при отправке тестового сообщения:\n<code>${error}</code>`, { parse_mode: "HTML" });
        testJob.stop();
        testJob.destroy();
      }
    },
    {
      scheduled: true,
      timezone: "Europe/Moscow",
    },
  );
});

// Команда для немедленного теста рассылки
bot.command("test_now", async (ctx) => {
  const chatId = ctx.chat.id;
  const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

  // Проверяем, что команду выполняет админ
  if (chatId !== adminChatId) {
    await ctx.reply("❌ Эта команда доступна только администратору");
    return;
  }

  await ctx.reply("🧪 <b>НЕМЕДЛЕННЫЙ ТЕСТ РАССЫЛКИ</b>\n\nЗапускаю рассылку прямо сейчас...", { parse_mode: "HTML" });

  try {
    console.log("🧪 [TEST NOW] Запуск немедленного теста рассылки");
    await scheduler.sendDailyMessagesToAll(adminChatId);
    await ctx.reply("✅ 🧪 Тест рассылки завершен успешно!");
  } catch (error) {
    console.error("❌ [TEST NOW] Ошибка в немедленном тесте:", error);
    await ctx.reply(`❌ Ошибка при тесте рассылки:\n<code>${error}</code>`, { parse_mode: "HTML" });
  }
});

// Запускаем бота

// --- Telegraf polling ---
bot.launch();
console.log(
  "\n🚀 Бот успешно запущен в режиме polling!\n📱 Для остановки нажмите Ctrl+C\n",
);
// Обработка завершения работы
process.once("SIGINT", () => {
  console.log("🛑 Получен сигнал SIGINT - завершение работы...");
  scheduler.destroy();
  bot.stop("SIGINT");
});
process.once("SIGTERM", () => {
  console.log("🛑 Получен сигнал SIGTERM - завершение работы...");
  scheduler.destroy();
  bot.stop("SIGTERM");
});
