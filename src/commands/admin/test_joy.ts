import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';
import { botLogger } from '../../logger';

// Команда для тестирования JOY поста
export function registerTestJoyCommand(bot: Telegraf, scheduler: Scheduler) {
  bot.command('test_joy', async ctx => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat.id;
    const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

    // Проверяем, что команду выполняет админ
    if (userId !== adminChatId) {
      await ctx.reply('❌ Эта команда доступна только администратору');
      return;
    }

    // Получаем ID пользователя из аргументов или используем админа
    const args = ctx.message.text.split(' ');
    const targetUserId = args[1] ? Number(args[1]) : userId;

    botLogger.info({ userId, targetUserId }, 'Получена команда /test_joy');

    try {
      await ctx.reply(`🧪 Отправляю тестовый JOY пост для пользователя ${targetUserId}...`);

      // Отправляем JOY пост (skipInteractionCheck=true для пропуска проверки на 2 дня)
      await scheduler.sendJoyPostWithWeeklySummary(targetUserId, true);

      await ctx.reply(`✅ Тестовый JOY пост отправлен! Проверь канал/ЛС пользователя ${targetUserId}.`);
    } catch (error) {
      botLogger.error({ error: (error as Error).message, userId, targetUserId }, 'Ошибка команды /test_joy');
      await ctx.reply(`❌ Ошибка отправки JOY поста: ${(error as Error).message}`);
    }
  });
}
