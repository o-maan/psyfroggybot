import { Telegraf } from 'telegraf';
import { CalendarService, formatCalendarEvents } from '../../calendar';
import { botLogger, logger } from '../../logger';
import { addUser, getLastUserToken } from '../../db';

// Обработка команды /calendar
export function registerCalendarCommand(bot: Telegraf, calendarService: CalendarService) {
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
}