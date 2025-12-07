import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';
import { botLogger } from '../../logger';
import { disableChannelMode } from '../../db';
import { sendToUser } from '../../utils/send-to-user';

/**
 * Команда /stop_channel - отключение режима канала
 *
 * Останавливает автоматическую рассылку в канал.
 * Доступна для всех, но работает только для главных пользователей (Алекс/Ольга).
 * НЕ влияет на режим ЛС (если включен).
 */
export function registerStopChannelCommand(bot: Telegraf, scheduler: Scheduler) {
  bot.command('stop_channel', async ctx => {
    const chatId = ctx.chat.id;
    const userId = ctx.from?.id || 0;
    botLogger.info({ userId, chatId }, `🛑 Команда /stop_channel от пользователя ${userId}`);

    // Проверяем что это главный пользователь
    const mainUserId = scheduler.isTestBot() ? scheduler.getTestUserId() : scheduler.getMainUserId();
    if (userId !== mainUserId) {
      await sendToUser(
        bot,
        chatId,
        userId,
        '⚠️ Эта команда доступна только для главных пользователей.'
      );
      botLogger.warn({ userId, chatId }, '⚠️ Попытка отключить режим канала не главным пользователем');
      return;
    }

    // Отключаем режим канала
    disableChannelMode(chatId);

    await sendToUser(
      bot,
      chatId,
      userId,
      '🛑 Режим канала отключен.\n\n' +
        'Автоматическая рассылка в канал остановлена.\n\n' +
        'Чтобы снова включить, используй команду /start_channel'
    );

    botLogger.info({ userId, chatId }, '✅ Режим канала отключен для главного пользователя');
  });
}
