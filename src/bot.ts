import { Telegraf } from "telegraf";
import { config } from "dotenv";
import { Scheduler } from "./scheduler.ts";
import { addUser, saveUserToken, getLastUserToken } from "./db.ts";
import { CalendarService } from "./calendar.ts";
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
const PORT = process.env.WEBHOOK_PORT || 3000;
const TELEGRAM_WEBHOOK_PORT = process.env.TELEGRAM_WEBHOOK_PORT || 8443;
const TELEGRAM_WEBHOOK_PATH =
  process.env.TELEGRAM_WEBHOOK_PATH || "/telegraf/webhook";
const TELEGRAM_WEBHOOK_URL =
  process.env.TELEGRAM_WEBHOOK_URL ||
  `https://${
    process.env.FLY_APP_NAME || "psyfroggybot-np0edq"
  }.fly.dev:${TELEGRAM_WEBHOOK_PORT}${TELEGRAM_WEBHOOK_PATH}`;

// --- Telegraf webhook ---
bot.telegram.setWebhook(TELEGRAM_WEBHOOK_URL);
restServ.use(TELEGRAM_WEBHOOK_PATH, bot.webhookCallback(TELEGRAM_WEBHOOK_PATH));

restServ.use(express.json());

restServ.all("/oauth2callback", async (req: Request, res: Response) => {
  const code = req.query.code as string;
  const state = req.query.state as string;
  const chatId = Number(state) || 0;
  console.log(
    "🔍 OAUTH2 CALLBACK - Chat ID:",
    chatId,
    "Code:",
    code,
    "State:",
    state
  );
  if (!code) {
    res.status(400).send("No code provided");
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
      "Авторизация прошла успешно! Можете вернуться к боту."
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
        `Cообщения отправлены успешно, пользователей: ${scheduler["users"].size}, админ: ${adminChatId}`
      );
    console.log(
      "🔍 SEND DAILY MESSAGE - Сообщения отправлены успешно",
      scheduler["users"]
    );
  } catch (error) {
    console.error(
      "❌ SEND DAILY MESSAGE - Ошибка при отправке сообщений:",
      error,
      `пользователей: ${scheduler["users"].size}, админ: ${adminChatId}`
    );
    res.status(500).send(String(error));
  }
});

// 404
restServ.all("/", (req: Request, res: Response) => {
  res.status(404).send("Not found");
});

// Запуск сервера на всех интерфейсах (для Fly.io)
restServ.listen(Number(PORT), "0.0.0.0", () => {
  console.log(`✅ EXPRESS сервер слушает на 0.0.0.0:${PORT}`);
});

// Обработка команды /start
bot.command("start", async (ctx) => {
  await ctx.reply(
    "Привет! Я бот-лягушка 🐸\n\n" +
      "Я буду отправлять сообщения в канал каждый день в 19:30.\n" +
      "Если ты не ответишь в течение 1.5 часов, я отправлю тебе напоминание.\n\n" +
      "Доступные команды:\n" +
      "/fro - отправить сообщение сейчас\n" +
      "/calendar - настроить доступ к календарю"
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
    }
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
  // Сохраняем пользователя, если его нет
  addUser(chatId, ctx.from?.username || "");
  const lastToken = getLastUserToken(chatId);
  if (lastToken) {
    console.log("🔍 LAST TOKEN:", lastToken);
    try {
      calendarService.setToken(JSON.parse(lastToken.token));
      // Получаем события за вчера и сегодня
      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      const start = new Date(
        yesterday.getFullYear(),
        yesterday.getMonth(),
        yesterday.getDate()
      );
      const end = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1
      );
      const events = await calendarService.getEvents(
        start.toISOString(),
        end.toISOString()
      );
      if (events && events.length > 0) {
        const eventsList = events
          .map((event: any) => {
            const start = event.start.dateTime || event.start.date;
            const time = event.start.dateTime
              ? new Date(event.start.dateTime).toLocaleTimeString()
              : "Весь день";
            return `${event.summary}\n⏰ ${time}`;
          })
          .join("\n\n");
        await ctx.reply(`События за вчера и сегодня:\n\n${eventsList}`);
      } else {
        await ctx.reply("Событий за вчера и сегодня нет.");
      }
      return;
    } catch (error) {
      console.error("Ошибка при получении токена:", error);
      await ctx.reply(
        "Произошла ошибка при настройке доступа к календарю. Попробуйте еще раз."
      );
    }
  }
  // Передаём chatId в state
  const authUrl = calendarService.getAuthUrl({ state: chatId.toString() });
  await ctx.reply(
    "Для доступа к календарю, пожалуйста, перейдите по ссылке и авторизуйтесь:\n" +
      authUrl +
      "\n\n" +
      "Подождите немного, пока я получу токен."
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
    await ctx.replyWithPhoto({ source: imagePath }, {
      caption: `Next image for chatId=${chatId}\nПуть: ${imagePath}`,
    });
  } catch (e) {
    console.error("Ошибка в /next_image:", e);
    await ctx.reply("Ошибка при получении следующей картинки: " + e);
  }
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

// Запускаем бота

// --- Telegraf polling ---
bot.launch();
console.log(
  "\n🚀 Бот успешно запущен в режиме polling!\n📱 Для остановки нажмите Ctrl+C\n"
);
// Обработка завершения работы
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
