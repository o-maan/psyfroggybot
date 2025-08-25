import { Telegraf } from 'telegraf';
import { botLogger } from '../../logger';
import { updateUserName } from '../../db';

// Команда для установки имени пользователя
export function registerSetnameCommand(bot: Telegraf) {
  bot.command('setname', async ctx => {
    const chatId = ctx.chat.id;
    const userId = ctx.from?.id || 0;
    const text = ctx.message.text;
    const name = text.split(' ').slice(1).join(' ').trim();

    if (!name) {
      await ctx.reply('Пожалуйста, укажите имя после команды. Например: /setname Иван');
      return;
    }

    updateUserName(chatId, name);
    botLogger.info({ userId, chatId, name }, '✅ Установлено имя пользователя');
    await ctx.reply(`✅ Твоё имя установлено: ${name}`);
  });
}