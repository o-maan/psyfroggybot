import { Telegraf } from 'telegraf';
import { botLogger } from '../../logger';
import { sendToUser } from '../../utils/send-to-user';

// Обработка команды /help
export function registerHelpCommand(bot: Telegraf) {
  bot.command('help', async ctx => {
    const chatId = ctx.chat.id;
    const userId = ctx.from?.id || 0;
    botLogger.info({ userId, chatId }, `📱 Команда /help от пользователя ${userId}`);

    await sendToUser(bot, chatId, userId, 'Кто тут любопытная жопка?! 😁 Не готово еще');
  });
}
