import { Telegraf } from 'telegraf';
import { botLogger } from '../../logger';
import { sendToUser } from '../../utils/send-to-user';
import { HelpHandler } from '../../help-handler';

// Обработка команды /help
// Работает ТОЛЬКО в ЛС (личных сообщениях)
export function registerHelpCommand(bot: Telegraf) {
  bot.command('help', async ctx => {
    const chatId = ctx.chat.id;
    const userId = ctx.from?.id || 0;

    // Проверка, что команда вызвана в ЛС
    if (ctx.chat.type !== 'private') {
      botLogger.warn({ userId, chatId, chatType: ctx.chat.type }, '⚠️ Команда /help вызвана не в ЛС');
      await sendToUser(bot, chatId, userId, 'Эта команда работает только в личных сообщениях 🔒');
      return;
    }

    botLogger.info({ userId, chatId }, `📱 Команда /help от пользователя ${userId}`);

    try {
      const handler = new HelpHandler(bot, chatId, userId);
      await handler.sendInitialMessage();
    } catch (e) {
      const error = e as Error;
      botLogger.error(
        { error: error.message, stack: error.stack, userId, chatId },
        '❌ Ошибка выполнения команды /help'
      );
      await sendToUser(bot, chatId, userId, 'Произошла ошибка. Попробуй еще раз чуть позже.');
    }
  });
}
