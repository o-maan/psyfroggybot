import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';

// Команда для проверки времени последней рассылки
export function registerLastRunCommand(bot: Telegraf, scheduler: Scheduler) {
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
}