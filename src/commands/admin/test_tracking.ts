import { Telegraf } from 'telegraf';
import { botLogger } from '../../logger';

// Команда для тестирования универсального отслеживания сообщений
export function registerTestTrackingCommand(bot: Telegraf) {
  bot.command('test_tracking', async ctx => {
    const chatId = ctx.chat.id;
    const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

    // Проверяем, что команду выполняет админ
    if (chatId !== adminChatId) {
      await ctx.reply('❌ Эта команда доступна только администратору');
      return;
    }

    try {
      const { db } = await import('../../db');

      // Получаем последние записи из таблицы message_links
      const query = db.query(`
        SELECT * FROM message_links
        ORDER BY created_at DESC
        LIMIT 10
      `);

      const links = query.all() as any[];

      let message = `🔍 <b>ТЕСТ УНИВЕРСАЛЬНОГО ОТСЛЕЖИВАНИЯ</b>\n\n`;
      message += `📊 Последние 10 записей в message_links:\n\n`;

      if (links.length === 0) {
        message += `<i>Таблица пуста. Отправьте несколько сообщений для тестирования.</i>\n`;
      } else {
        links.forEach((link, i) => {
          const createdAt = new Date(link.created_at).toLocaleString('ru-RU', {
            timeZone: 'Europe/Moscow',
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          });

          message += `${i + 1}. <b>${link.message_type}</b>\n`;
          message += `   📝 ID сообщения: ${link.message_id}\n`;
          message += `   📍 ID поста: ${link.channel_message_id}\n`;
          message += `   👤 User ID: ${link.user_id || 'бот'}\n`;
          if (link.reply_to_message_id) {
            message += `   ↩️ Ответ на: ${link.reply_to_message_id}\n`;
          }
          if (link.message_thread_id) {
            message += `   🧵 Thread ID: ${link.message_thread_id}\n`;
          }
          message += `   🕐 Время: ${createdAt}\n\n`;
        });
      }

      message += `\n💡 <i>Система автоматически отслеживает все входящие и исходящие сообщения</i>`;

      await ctx.reply(message, { parse_mode: 'HTML' });
    } catch (error) {
      const err = error as Error;
      botLogger.error({ error: err.message, stack: err.stack }, 'Ошибка команды /test_tracking');
      await ctx.reply(`❌ Ошибка: ${err.message}`);
    }
  });
}