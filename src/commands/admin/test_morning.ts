import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';
import { botLogger } from '../../logger';

// Команда для тестирования утреннего поста
export function registerTestMorningCommand(bot: Telegraf, scheduler: Scheduler) {
  bot.command('test_morning', async ctx => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat.id;

    botLogger.info({ userId, chatId }, 'Получена команда /test_morning');

    try {
      // Проверяем что это админ
      const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);
      if (userId !== adminChatId) {
        await ctx.reply('Эта команда доступна только администратору');
        return;
      }

      await ctx.reply('Отправляю тестовый утренний пост...');

      // Отправляем утренний пост
      await scheduler.sendMorningMessage(userId);

      await ctx.reply('✅ Тестовый утренний пост отправлен! Проверь канал.');
    } catch (error) {
      botLogger.error({ error: (error as Error).message, userId }, 'Ошибка команды /test_morning');
      await ctx.reply(`❌ Ошибка отправки утреннего поста: ${(error as Error).message}`);
    }
  });
}
