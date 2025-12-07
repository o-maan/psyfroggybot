import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';
import { botLogger } from '../../logger';
import { sendToUser } from '../../utils/send-to-user';
import { isAdmin } from '../../utils/admin-check';

// Команда /day - тестовая команда для админа (аналог /test_morning)
export function registerDayCommand(bot: Telegraf, scheduler: Scheduler) {
  bot.command('day', async ctx => {
    const userId = ctx.from?.id || 0;
    const chatId = ctx.chat.id;

    botLogger.info({ userId, chatId }, 'Получена команда /day');

    try {
      // Проверяем что это админ
      if (!isAdmin(userId)) {
        // Для не-админов передаем userId для адаптации пола
        await sendToUser(bot, chatId, userId, 'Эта команда доступна только администратору');
        return;
      }

      await sendToUser(bot, chatId, userId, 'Отправляю утренний пост...☀️');

      // Отправляем утренний пост (ручной вызов)
      await scheduler.sendMorningMessage(userId, true);

      await sendToUser(bot, chatId, userId, '✅ Тестовый утренний пост отправлен! Проверь канал.');
    } catch (error) {
      botLogger.error({ error: (error as Error).message, userId }, 'Ошибка команды /day');
      await sendToUser(bot, chatId, userId, `❌ Ошибка отправки утреннего поста: ${(error as Error).message}`);
    }
  });
}
