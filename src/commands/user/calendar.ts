import { Telegraf } from 'telegraf';
import { CalendarService, formatCalendarEvents } from '../../calendar';
import { botLogger, logger } from '../../logger';
import { addUser, getLastUserToken } from '../../db';
import { sendToUser } from '../../utils/send-to-user';

// Обработка команды /calendar
export function registerCalendarCommand(bot: Telegraf, calendarService: CalendarService) {
  bot.command('calendar', async ctx => {
    const chatId = ctx.chat.id;
    const userId = ctx.from?.id || 0;
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
          await sendToUser(bot, chatId, userId, `События за вчера и сегодня:\n\n${eventsList}`, {
            parse_mode: 'HTML',
          });
        } else {
          await sendToUser(bot, chatId, userId, 'Событий за вчера и сегодня нет.');
        }
        return;
      } catch (e) {
        const error = e as Error;
        botLogger.error({ error: error.message, stack: error.stack, chatId }, 'Ошибка токена календаря');
        await sendToUser(bot, chatId, userId, 'Произошла ошибка при настройке доступа к календарю. Попробуйте еще раз.');
      }
    }
    // Pass chatId in state
    const authUrl = calendarService.getAuthUrl({ state: chatId.toString() });
    await sendToUser(
      bot,
      chatId,
      userId,
      'Для доступа к календарю, пожалуйста, перейдите по ссылке и авторизуйтесь:\n' +
        authUrl +
        '\n\n' +
        'Подождите немного, пока я получу токен.'
    );
  });
}