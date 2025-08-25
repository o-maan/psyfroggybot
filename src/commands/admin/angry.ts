import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';

// Команда для тестирования генерации злого поста
export function registerAngryCommand(bot: Telegraf, scheduler: Scheduler) {
  bot.command('angry', async ctx => {
    const chatId = ctx.chat.id;
    const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

    // Проверяем, что команду выполняет админ
    if (chatId !== adminChatId) {
      await ctx.reply('❌ Эта команда доступна только администратору');
      return;
    }

    await ctx.reply('😠 Генерирую злой пост...');

    try {
      // Вызываем приватный метод sendAngryPost напрямую
      // Используем ID целевого пользователя
      const TARGET_USER_ID = scheduler.getTargetUserId();
      await (scheduler as any).sendAngryPost(TARGET_USER_ID);
      await ctx.reply('✅ Злой пост отправлен в канал!');
    } catch (error) {
      await ctx.reply(`❌ Ошибка при генерации злого поста:\n<code>${error}</code>`, { parse_mode: 'HTML' });
    }
  });
}