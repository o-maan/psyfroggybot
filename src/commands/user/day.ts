import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';
import { botLogger } from '../../logger';

// Команда /day - тестовая команда для админа (аналог /test_morning)
export function registerDayCommand(bot: Telegraf, scheduler: Scheduler) {
  bot.command('day', async ctx => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat.id;

    botLogger.info({ userId, chatId }, 'Получена команда /day');

    try {
      // Проверяем что это админ
      const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);
      if (userId !== adminChatId) {
        await ctx.reply('Эта команда доступна только администратору');
        return;
      }

      await ctx.reply('Отправляю утренний пост...☀️');

      // Отправляем утренний пост (ручной вызов)
      await scheduler.sendMorningMessage(userId, true);

      await ctx.reply('✅ Тестовый утренний пост отправлен! Проверь канал.');
    } catch (error) {
      botLogger.error({ error: (error as Error).message, userId }, 'Ошибка команды /day');
      await ctx.reply(`❌ Ошибка отправки утреннего поста: ${(error as Error).message}`);
    }
  });
}
