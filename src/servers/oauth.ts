import express, { Request, Response } from 'express';
import { Telegraf } from 'telegraf';
import { CalendarService } from '../calendar';
import { Scheduler } from '../scheduler';
import { saveUserToken } from '../db';
import { botLogger, logger } from '../logger';

// --- Express сервер для Google OAuth2 callback и REST ---
export function createOAuthServer(bot: Telegraf, calendarService: CalendarService, scheduler: Scheduler) {
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
      logger.info(
        {
          method: req.method,
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
        'REST API: Получен запрос на ручную рассылку'
      );

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

  // Запускаем сервер
  restServ.listen(SERVER_PORT, () => {
    logger.info({ port: SERVER_PORT }, `🌐 OAuth/REST сервер запущен на порту ${SERVER_PORT}`);
  });

  return restServ;
}