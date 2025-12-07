import { Telegraf } from 'telegraf';
import { botLogger } from '../../logger';
import { disableDMMode } from '../../db';
import { sendToUser } from '../../utils/send-to-user';

/**
 * Команда /stop - отключение режима личных сообщений (ЛС)
 *
 * Останавливает автоматическую рассылку сообщений в ЛС пользователю.
 * НЕ влияет на канальный режим (если включен).
 */
export function registerStopCommand(bot: Telegraf) {
  bot.command('stop', async ctx => {
    const chatId = ctx.chat.id;
    const userId = ctx.from?.id || 0;
    botLogger.info({ userId, chatId }, `🛑 Команда /stop от пользователя ${userId}`);

    // Отключаем режим ЛС
    disableDMMode(chatId);

    await sendToUser(
      bot,
      chatId,
      userId,
      '🛑 Режим личных сообщений отключен.\n\n' +
        'Автоматическая рассылка в ЛС остановлена.\n\n' +
        'Чтобы снова включить, используй команду /start'
    );

    botLogger.info({ userId, chatId }, '✅ Режим ЛС отключен для пользователя');
  });
}
