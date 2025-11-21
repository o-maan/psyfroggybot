import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';
import { botLogger } from '../../logger';
import { updateUserResponse, updateMessage } from '../../db';

/**
 * Обработчик редактированных сообщений
 * Применяется везде, где важен контент сообщений пользователя
 */
export function registerEditedMessageHandler(bot: Telegraf, scheduler: Scheduler) {
  bot.on('edited_message', async ctx => {
    // Проверяем, что это текстовое сообщение
    if (!('text' in ctx.editedMessage)) {
      return;
    }

    const message = ctx.editedMessage.text;
    const chatId = ctx.chat.id;
    const userId = ctx.from?.id || 0;
    const messageId = ctx.editedMessage.message_id;
    const messageThreadId = (ctx.editedMessage as any).message_thread_id;

    botLogger.info(
      {
        message: message.substring(0, 100),
        chatId,
        userId,
        messageId,
        messageThreadId,
        chatType: ctx.chat.type,
        isBot: ctx.from?.is_bot,
        timestamp: new Date().toISOString(),
      },
      '✏️ Получено редактированное сообщение'
    );

    // Пропускаем команды
    if (message.startsWith('/')) {
      return;
    }

    // Проверяем, что сообщение не от самого бота
    if (ctx.from?.is_bot) {
      botLogger.debug({ userId, chatId, isBot: ctx.from?.is_bot }, 'Игнорируем редактированное сообщение от бота');
      return;
    }

    // Получаем ID чата и канала
    const CHAT_ID = scheduler.getChatId();
    const CHANNEL_ID = scheduler.CHANNEL_ID;

    // Для личных чатов ВСЕГДА обрабатываем (SHORT JOY работает в личке!)
    const isPrivateChat = ctx.chat.type === 'private';

    if (!isPrivateChat) {
      // Для НЕ-личных чатов проверяем, что сообщение из релевантного чата
      const isFromChannel = chatId === CHANNEL_ID;
      const isFromChat = CHAT_ID && chatId === CHAT_ID;
      const isFromLinkedChat = ctx.chat.type === 'supergroup' && !isFromChannel && !isFromChat;

      if (!isFromChannel && !isFromChat && !isFromLinkedChat) {
        botLogger.debug(
          { chatId, CHAT_ID, CHANNEL_ID, chatType: ctx.chat.type },
          'Редактированное сообщение не из целевого канала/чата, игнорируем'
        );
        return;
      }
    }

    // Константа для целевого пользователя
    const TARGET_USER_ID = scheduler.getTargetUserId();

    // Обновляем время ответа для целевого пользователя
    if (userId === TARGET_USER_ID) {
      const responseTime = new Date().toISOString();
      updateUserResponse(userId, responseTime);
      botLogger.info(
        { userId, responseTime, messageId, edited: true },
        `✅ Обновлено время ответа для целевого пользователя (редактированное сообщение)`
      );
    }

    // Очищаем напоминание
    scheduler.clearReminder(userId);

    try {
      // Обновляем сообщение в БД (используем updateMessage для обновления существующего)
      const editTime = new Date().toISOString();
      updateMessage(userId, messageId, chatId, message, editTime);

      // Обновляем также в message_links (для новой системы)
      const { updateEditedUserMessage } = await import('../../interactive-tracker');
      await updateEditedUserMessage(messageId, message);

      // ✅ JOY-логика обрабатывает редактирование (пользователь может исправлять список)
      const isJoyMessage = await scheduler.handleJoyUserMessage(
        userId,
        message,
        chatId,
        messageId,
        messageThreadId
      );

      if (isJoyMessage) {
        botLogger.info({ userId, messageId }, '✅ Редактированное сообщение обработано в Joy-режиме');
        return;
      }

      // ✅ Интерактивная вечерняя логика ТОЖЕ обрабатывает редактирование
      // Внутри handleInteractiveUserResponse есть проверка: если messageId уже был обработан -
      // просто обновляет данные, НЕ переходя на следующий шаг
      // ⚡ НОВАЯ СИСТЕМА: handleInteractiveUserResponseV2 находит ВСЕ посты и обрабатывает параллельно
      const isInteractive = await scheduler.handleInteractiveUserResponseV2(
        userId,
        message,
        chatId,
        messageId,
        messageThreadId,
        ctx.chat?.type
      );

      if (isInteractive) {
        botLogger.info({ userId, messageId }, '✅ Редактированное сообщение обработано в интерактивном режиме (НОВАЯ СИСТЕМА)');
        return;
      }

      // Для остальных случаев - просто логируем, без автоответов
      botLogger.info(
        { userId, chatId, messageId, messageLength: message.length, edited: true },
        '📝 Редактированное сообщение сохранено'
      );
    } catch (error) {
      const err = error as Error;
      botLogger.error(
        { error: err.message, stack: err.stack, userId, chatId, messageId },
        'Ошибка обработки редактированного сообщения'
      );
    }
  });
}
