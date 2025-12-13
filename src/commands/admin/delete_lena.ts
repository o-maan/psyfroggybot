import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';
import { db } from '../../db';

/**
 * Команда /delete_lena - ПОЛНОЕ удаление Лены из БД
 *
 * ВРЕМЕННАЯ команда для тестирования.
 * Удаляет пользователя с ID 716928723 полностью из базы данных.
 */
export function registerDeleteLenaCommand(bot: Telegraf, scheduler: Scheduler) {
  bot.command('delete_lena', async ctx => {
    const chatId = ctx.chat.id;
    const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

    // ⚠️ ВРЕМЕННО: команда доступна ВСЕМ (для быстрого тестирования)
    // if (chatId !== adminChatId) {
    //   await ctx.reply('❌ Эта команда доступна только администратору');
    //   return;
    // }

    try {
      // Проверяем есть ли пользователь
      const user = db.query(`
        SELECT chat_id, username, name
        FROM users
        WHERE chat_id = 716928723
      `).get() as { chat_id: number; username: string; name: string } | undefined;

      if (!user) {
        await ctx.reply('✅ Пользователь с ID 716928723 уже удален из БД');
        return;
      }

      // Удаляем пользователя
      const result = db.query(`
        DELETE FROM users WHERE chat_id = 716928723
      `).run();

      await ctx.reply(
        `✅ Пользователь удален из БД!\n\n` +
        `ID: ${user.chat_id}\n` +
        `Имя: ${user.name || 'не указано'}\n` +
        `Username: ${user.username || 'не указан'}\n\n` +
        `Теперь при /start создастся заново как новый пользователь.`
      );
    } catch (error) {
      await ctx.reply(`❌ Ошибка удаления:\n\n${(error as Error).message}`);
    }
  });
}
