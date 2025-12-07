import { Telegraf } from 'telegraf';
import { sendToUser } from '../../utils/send-to-user';
import { isAdmin } from '../../utils/admin-check';

// Простая тестовая команда (только для админа)
export function registerPingCommand(bot: Telegraf) {
  bot.command('ping', async ctx => {
    const userId = ctx.from?.id || 0;
    const chatId = ctx.chat.id;

    // Проверка на админа
    if (!isAdmin(userId)) {
      await sendToUser(bot, chatId, userId, 'Эта команда доступна только администратору');
      return;
    }

    await sendToUser(bot, chatId, null, '🏓 Pong! Бот работает.');
  });
}
