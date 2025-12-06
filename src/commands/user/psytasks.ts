import { Telegraf } from 'telegraf';
import { botLogger } from '../../logger';
import { sendToUser } from '../../utils/send-to-user';

// Хранилище для отслеживания последнего показанного сообщения для каждого пользователя
const lastShownMessage = new Map<number, number>();

const MESSAGE_1 = 'У тебя нет заданий от психолога 😐';
const MESSAGE_2 = 'Не, все еще ничего нет 😁';

/**
 * Регистрация команды /psytasks - чередование двух сообщений
 * При каждом нажатии показывается то первое, то второе сообщение
 */
export function registerPsytasksCommand(bot: Telegraf) {
  bot.command('psytasks', async ctx => {
    const chatId = ctx.chat.id;
    const userId = ctx.from?.id || 0;

    botLogger.info({ userId, chatId }, '📋 Команда /psytasks от пользователя');

    try {
      // Получаем последнее показанное сообщение для этого пользователя
      const lastMessage = lastShownMessage.get(userId) || 0;

      // Чередуем сообщения: 0 или 2 -> MESSAGE_1 (и сохраняем 1), 1 -> MESSAGE_2 (и сохраняем 2)
      let message: string;
      let nextMessage: number;

      if (lastMessage === 1) {
        message = MESSAGE_2;
        nextMessage = 2;
      } else {
        message = MESSAGE_1;
        nextMessage = 1;
      }

      // Сохраняем номер показанного сообщения
      lastShownMessage.set(userId, nextMessage);

      await sendToUser(bot, chatId, userId, message);

      botLogger.info({ userId, chatId, messageShown: nextMessage }, '✅ Команда /psytasks выполнена');
    } catch (error) {
      const err = error as Error;
      botLogger.error(
        {
          error: err.message,
          stack: err.stack,
          chatId,
          userId,
        },
        'Ошибка при выполнении команды /psytasks'
      );
      await sendToUser(bot, chatId, userId, `❌ Ошибка: ${err.message}`);
    }
  });
}
