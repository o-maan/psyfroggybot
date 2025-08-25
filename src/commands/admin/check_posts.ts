import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';
import { botLogger } from '../../logger';

// Команда для проверки интерактивных постов
export function registerCheckPostsCommand(bot: Telegraf, scheduler: Scheduler) {
  bot.command('check_posts', async ctx => {
    const chatId = ctx.chat.id;
    const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

    // Проверяем, что команду выполняет админ
    if (chatId !== adminChatId) {
      await ctx.reply('❌ Эта команда доступна только администратору');
      return;
    }

    try {
      const { db } = await import('../../db');

      // Получаем все интерактивные посты за последние 7 дней
      const query = db.query(`
        SELECT ip.*, u.chat_id as user_chat_id, u.username
        FROM interactive_posts ip
        JOIN users u ON ip.user_id = u.chat_id
        WHERE ip.created_at > datetime('now', '-7 days')
        ORDER BY ip.created_at DESC
        LIMIT 10
      `);

      const posts = query.all() as any[];

      let message = `📊 <b>ИНТЕРАКТИВНЫЕ ПОСТЫ (последние 7 дней)</b>\n\n`;
      message += `Всего постов: ${posts.length}\n\n`;

      for (const post of posts) {
        const createdDate = new Date(post.created_at).toLocaleString('ru-RU', {
          timeZone: 'Europe/Moscow',
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });

        message += `📝 <b>Пост #${post.channel_message_id}</b>\n`;
        message += `👤 Пользователь: ${post.username || post.user_chat_id}\n`;
        message += `📅 Создан: ${createdDate}\n`;
        message += `📋 Статус заданий:\n`;
        message += `   1️⃣ Задание 1: ${post.task1_completed ? '✅ Выполнено' : '❌ Не выполнено'}\n`;
        message += `   2️⃣ Задание 2: ${post.task2_completed ? '✅ Выполнено' : '❌ Не выполнено'}\n`;
        message += `   3️⃣ Задание 3: ${post.task3_completed ? '✅ Выполнено' : '❌ Не выполнено'}\n`;

        // Проверяем последнее сообщение пользователя
        const msgQuery = db.query(`
          SELECT m.* FROM messages m
          JOIN users u ON m.user_id = u.id
          WHERE u.chat_id = ? AND m.author_id = ?
          ORDER BY m.sent_time DESC
          LIMIT 1
        `);
        const lastMsg = msgQuery.get(post.user_id, post.user_id) as any;

        if (lastMsg) {
          const msgDate = new Date(lastMsg.sent_time).toLocaleString('ru-RU', {
            timeZone: 'Europe/Moscow',
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          });
          message += `💬 Последнее сообщение: ${msgDate}\n`;
          message += `   "${lastMsg.message_text.substring(0, 50)}..."\n`;
        }

        message += '\n';
      }

      await ctx.reply(message, { parse_mode: 'HTML' });
    } catch (error) {
      const err = error as Error;
      botLogger.error({ error: err.message }, 'Ошибка проверки постов');
      await ctx.reply(`❌ Ошибка: ${err.message}`);
    }
  });
}