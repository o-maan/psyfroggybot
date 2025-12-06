import { Telegraf, Markup } from 'telegraf';
import { botLogger } from '../../logger';
import { sendToUser } from '../../utils/send-to-user';
import { saveMessage } from '../../db';

// Хранилище для отслеживания пользователей, ожидающих ввода ситуации
const waitingForSituation = new Map<number, boolean>();

/**
 * Регистрация команды /unpack - запуск логики разбора ситуации из глубокого сценария
 * Работает только в ЛС (личных сообщениях)
 */
export function registerUnpackCommand(bot: Telegraf) {
  bot.command('unpack', async ctx => {
    const chatId = ctx.chat.id;
    const userId = ctx.from?.id || 0;
    const chatType = ctx.chat.type;

    botLogger.info({ userId, chatId, chatType }, '🔍 Команда /unpack от пользователя');

    // Проверяем, что команда вызвана в ЛС (private)
    if (chatType !== 'private') {
      botLogger.warn({ userId, chatId, chatType }, '⚠️ Команда /unpack вызвана не в ЛС');
      await sendToUser(
        bot,
        chatId,
        userId,
        'Эта команда работает только в личных сообщениях 💬'
      );
      return;
    }

    try {
      // Отправляем первое сообщение с запросом ситуации
      const message = '<b>Опиши подробно 1 ситуацию, с которой хочешь поработать 📝</b>';

      await sendToUser(bot, chatId, userId, message, {
        parse_mode: 'HTML'
      });

      // Помечаем пользователя как ожидающего ввода ситуации
      waitingForSituation.set(userId, true);

      // Сохраняем сообщение бота в БД
      saveMessage(chatId, message, new Date().toISOString(), 0);

      botLogger.info({ userId, chatId }, '✅ Команда /unpack выполнена, ожидаем описание ситуации');
    } catch (error) {
      const err = error as Error;
      botLogger.error(
        {
          error: err.message,
          stack: err.stack,
          chatId,
          userId,
        },
        'Ошибка при выполнении команды /unpack'
      );
      await sendToUser(bot, chatId, userId, `❌ Ошибка: ${err.message}`);
    }
  });
}

/**
 * Проверить, ожидает ли пользователь ввод ситуации для команды /unpack
 */
export function isWaitingForUnpackSituation(userId: number): boolean {
  return waitingForSituation.get(userId) || false;
}

/**
 * Очистить статус ожидания ввода ситуации
 */
export function clearUnpackWaiting(userId: number): void {
  waitingForSituation.delete(userId);
}
