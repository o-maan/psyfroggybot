import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';
import { botLogger } from '../../logger';

// Команда для тестирования определения занятости пользователя
export function registerTestBusyCommand(bot: Telegraf, scheduler: Scheduler) {
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
}