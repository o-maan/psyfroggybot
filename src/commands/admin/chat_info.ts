import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';

// Команда для проверки ID чата
export function registerChatInfoCommand(bot: Telegraf, scheduler: Scheduler) {
  bot.command('chat_info', async ctx => {
    const chatId = ctx.chat.id;
    const chatType = ctx.chat.type;
    const userId = ctx.from?.id || 0;
    const username = ctx.from?.username || 'unknown';

    await ctx.reply(
      `📊 <b>ИНФОРМАЦИЯ О ЧАТЕ</b>\n\n` +
        `🆔 Chat ID: <code>${chatId}</code>\n` +
        `📝 Тип: <code>${chatType}</code>\n` +
        `👤 User ID: <code>${userId}</code>\n` +
        `👤 Username: @${username}\n\n` +
        `💡 Добавьте CHAT_ID=${chatId} в файл .env`,
      { parse_mode: 'HTML' }
    );
  });
}