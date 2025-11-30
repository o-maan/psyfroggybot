import { Telegraf } from 'telegraf';
import { sendToUser } from '../../utils/send-to-user';

// Простая тестовая команда
export function registerPingCommand(bot: Telegraf) {
  bot.command('ping', async ctx => {
    await sendToUser(bot, ctx.chat.id, ctx.from?.id, '🏓 Pong! Бот работает.');
  });
}