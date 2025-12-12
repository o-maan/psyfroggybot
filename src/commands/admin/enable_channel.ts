import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';
import { botLogger } from '../../logger';
import { sendToUser } from '../../utils/send-to-user';
import { isAdmin } from '../../utils/admin-check';
import { db } from '../../db';

/**
 * Команда /enable_channel - включает канальную рассылку для ТЕКУЩЕГО пользователя
 *
 * ВАЖНО: У каждого пользователя СВОЙ channel_id!
 * - Алекс (основной бот): channel_id = -1002405993986
 * - Оля (тестовый бот): channel_id = -1002846400650
 *
 * Команда автоматически определяет правильный channel_id на основе бота
 */
export function registerEnableChannelCommand(bot: Telegraf, scheduler: Scheduler) {
  bot.command('enable_channel', async ctx => {
    const chatId = ctx.chat.id;
    const userId = ctx.from?.id || 0;

    try {
      // Проверка на админа
      if (!isAdmin(userId)) {
        await sendToUser(bot, chatId, userId, 'Эта команда доступна только администратору');
        return;
      }

      // Получаем channel_id на основе текущего бота
      const channelId = scheduler.CHANNEL_ID;

      botLogger.info(
        { userId, chatId, channelId, isTestBot: scheduler.isTestBot() },
        '🔧 Включение канальной рассылки для пользователя'
      );

      // Обновляем настройки пользователя в БД
      const updateQuery = db.query(`
        UPDATE users
        SET channel_enabled = 1,
            channel_id = ?,
            dm_enabled = 1
        WHERE chat_id = ?
      `);

      updateQuery.run(channelId, userId);

      botLogger.info(
        { userId, channelId },
        '✅ Канальная рассылка включена'
      );

      const message = `✅ Канальная рассылка включена!

📢 Теперь вечерние посты будут отправляться:
• В канал (ID: ${channelId})
• ТАКЖЕ в личные сообщения (дублирование)

🔧 Настройки:
• channel_enabled = 1
• channel_id = ${channelId}
• dm_enabled = 1

💡 Команда /fro теперь будет отправлять посты в канал со всей логикой в комментариях!`;

      await sendToUser(bot, chatId, userId, message);

    } catch (error) {
      const err = error as Error;
      botLogger.error(
        { error: err.message, stack: err.stack, userId },
        '❌ Ошибка включения канальной рассылки'
      );
      await sendToUser(bot, chatId, userId, `❌ Ошибка: ${err.message}`);
    }
  });
}
