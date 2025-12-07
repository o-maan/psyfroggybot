import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';
import { botLogger } from '../../logger';
import { enableChannelMode } from '../../db';
import { sendToUser } from '../../utils/send-to-user';

/**
 * Команда /start_channel - включение режима канала
 *
 * Запускает автоматическую рассылку в канал.
 * Доступна для всех, но работает только для главных пользователей (Алекс/Ольга).
 */
export function registerStartChannelCommand(bot: Telegraf, scheduler: Scheduler) {
  bot.command('start_channel', async ctx => {
    const chatId = ctx.chat.id;
    const userId = ctx.from?.id || 0;
    botLogger.info({ userId, chatId }, `📺 Команда /start_channel от пользователя ${userId}`);

    // Проверяем что это главный пользователь
    const mainUserId = scheduler.isTestBot() ? scheduler.getTestUserId() : scheduler.getMainUserId();
    if (userId !== mainUserId) {
      await sendToUser(
        bot,
        chatId,
        userId,
        '⚠️ Эта команда доступна только для главных пользователей.\n\n' +
          'Для работы в личных сообщениях используй /start'
      );
      botLogger.warn({ userId, chatId }, '⚠️ Попытка включить режим канала не главным пользователем');
      return;
    }

    // Включаем режим канала
    enableChannelMode(chatId);

    await sendToUser(
      bot,
      chatId,
      userId,
      '📺 Режим канала включен!\n\n' +
        'Автоматическая рассылка в канал запущена.\n\n' +
        'Чтобы остановить, используй команду /stop_channel'
    );

    botLogger.info({ userId, chatId }, '✅ Режим канала включен для главного пользователя');
  });
}
