import { Telegraf } from 'telegraf';

// Простая тестовая команда
export function registerPingCommand(bot: Telegraf) {
  bot.command('ping', async ctx => {
    await ctx.reply('🏓 Pong! Бот работает.');
  });
}