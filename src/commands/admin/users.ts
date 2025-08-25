import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';

// Команда для проверки пользователей в базе
export function registerUsersCommand(bot: Telegraf, scheduler: Scheduler) {
  bot.command('users', async ctx => {
    const chatId = ctx.chat.id;
    const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

    // Проверяем, что команду выполняет админ
    if (chatId !== adminChatId) {
      await ctx.reply('❌ Эта команда доступна только администратору');
      return;
    }

    const { getAllUsers } = await import('../../db.ts');
    const users = getAllUsers();

    let message = `👥 <b>ПОЛЬЗОВАТЕЛИ В БАЗЕ</b>\n\n`;
    message += `Всего: ${users.length}\n\n`;

    users.forEach((user, index) => {
      message += `${index + 1}. User ID: <code>${user.chat_id}</code>\n`;
      if (user.name) message += `   Имя: ${user.name}\n`;
      if (user.username) message += `   Username: @${user.username}\n`;
      message += `   Ответов: ${user.response_count || 0}\n`;
      if (user.last_response_time) {
        const lastResponse = new Date(user.last_response_time).toLocaleString('ru-RU', {
          timeZone: 'Europe/Moscow',
        });
        message += `   Последний ответ: ${lastResponse}\n`;
      }
      message += '\n';
    });

    await ctx.reply(message, { parse_mode: 'HTML' });
  });
}