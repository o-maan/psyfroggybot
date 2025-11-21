import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';
import { botLogger } from '../../logger';
import { updateUserResponse, saveMessage, getLastNMessages } from '../../db';
import { generateUserResponse } from '../../llm';
import { getUserTodayEvents } from '../../calendar';

// ВРЕМЕННО ОТКЛЮЧЕНО: автоматические ответы бота в комментариях
// Код сохранен для возможного восстановления функциональности в будущем
const AUTO_RESPONSES_ENABLED = false; // Переключатель для быстрого включения/отключения

// Обработка текстовых сообщений
export function registerTextMessageHandler(bot: Telegraf, scheduler: Scheduler) {
  bot.on('text', async ctx => {
    const message = ctx.message.text;
    const chatId = ctx.chat.id;
    const userId = ctx.from?.id || 0;

    // Логируем ВСЕ текстовые сообщения для отладки
    botLogger.info(
      {
        message: message.substring(0, 100),
        chatId,
        userId,
        chatType: ctx.chat.type,
        messageThreadId: (ctx.message as any).message_thread_id,
        isBot: ctx.from?.is_bot,
        timestamp: new Date().toISOString(),
      },
      '📨 Получено текстовое сообщение'
    );

    // Пропускаем команды - они обрабатываются отдельными обработчиками
    if (message.startsWith('/')) {
      return;
    }

    // Получаем ID чата и канала
    const CHAT_ID = scheduler.getChatId();
    const CHANNEL_ID = scheduler.CHANNEL_ID;

    // Логируем для отладки
    botLogger.info(
      {
        chatId,
        CHAT_ID,
        CHANNEL_ID,
        chatType: ctx.chat.type,
        messageId: ctx.message.message_id,
        fromId: ctx.from?.id,
        fromIsBot: ctx.from?.is_bot,
        fromUsername: ctx.from?.username,
        message: message.substring(0, 50),
      },
      '🔍 Проверка сообщения'
    );

    // Проверяем, что сообщение не от самого бота
    if (ctx.from?.is_bot) {
      botLogger.debug({ userId: ctx.from?.id, chatId, isBot: ctx.from?.is_bot }, 'Игнорируем сообщение от бота');
      return;
    }

    // Проверяем, что сообщение пришло либо из канала, либо из чата, либо из личного чата
    const isFromChannel = chatId === CHANNEL_ID;
    const isFromChat = CHAT_ID && chatId === CHAT_ID;
    const isPrivateChat = ctx.chat.type === 'private';

    // ВАЖНО: В Telegram, когда группа привязана к каналу, сообщения из группы
    // могут иметь другой chat_id. Нужно проверить тип чата.
    const isFromLinkedChat = ctx.chat.type === 'supergroup' && !isFromChannel && !isFromChat;

    if (!isFromChannel && !isFromChat && !isFromLinkedChat && !isPrivateChat) {
      // Игнорируем сообщения не из канала, не из связанной группы и не из личного чата
      botLogger.debug(
        { chatId, CHAT_ID, CHANNEL_ID, chatType: ctx.chat.type },
        'Сообщение не из целевого канала/чата/личного чата, игнорируем'
      );
      return;
    }

    // Всегда используем ID чата, откуда пришло сообщение
    // Это важно для корректной работы с тестовыми ботами и группами обсуждений
    const replyToChatId = chatId;

    if (!CHAT_ID && !isFromLinkedChat && !isPrivateChat) {
      botLogger.warn('⚠️ CHAT_ID не установлен в .env! Бот не сможет отвечать в чат');
      return;
    }

    botLogger.debug({ userId, chatId, messageLength: message.length }, `💬 Сообщение от пользователя в чате`);

    // Константа для целевого пользователя
    const TARGET_USER_ID = scheduler.getTargetUserId();

    // Обновляем время ответа только для целевого пользователя
    if (userId === TARGET_USER_ID) {
      const responseTime = new Date().toISOString();
      updateUserResponse(userId, responseTime);
      botLogger.info(
        {
          userId,
          responseTime,
          targetUserId: TARGET_USER_ID,
        },
        `✅ Обновлено время ответа для целевого пользователя ${TARGET_USER_ID}`
      );
    } else {
      botLogger.debug(
        {
          userId,
          targetUserId: TARGET_USER_ID,
        },
        `⏭️ Пропущено обновление времени ответа - не целевой пользователь`
      );
    }

    // Очищаем напоминание для этого пользователя
    scheduler.clearReminder(userId);

    try {
      // Сначала сохраняем сообщение пользователя в БД
      const userMessageTime = new Date().toISOString();
      const messageId = ctx.message.message_id;
      saveMessage(userId, message, userMessageTime, userId, messageId, chatId);

      // Проверяем, есть ли активная интерактивная сессия
      const messageThreadId = (ctx.message as any).message_thread_id;

      // СНАЧАЛА проверяем SHORT JOY сессии (они работают везде: личка/канал/комментарии!)
      const isJoyMessage = await scheduler.handleJoyUserMessage(
        userId,
        message,
        replyToChatId,
        ctx.message.message_id,
        messageThreadId
      );

      if (isJoyMessage) {
        // Сообщение обработано в Joy-режиме
        return;
      }

      // ПОТОМ проверяем интерактивные посты (только НЕ в личных чатах и только если не Joy)
      if (ctx.chat.type !== 'private') {
        // ⚡ НОВАЯ СИСТЕМА: handleInteractiveUserResponseV2 находит ВСЕ посты и обрабатывает параллельно
        const isInteractive = await scheduler.handleInteractiveUserResponseV2(
          userId,
          message,
          replyToChatId,
          ctx.message.message_id,
          messageThreadId,
          ctx.chat.type
        );

        if (isInteractive) {
          // Сообщение обработано в интерактивном режиме
          return;
        }
      }

      // Получаем последние 7 сообщений пользователя в хронологическом порядке
      const lastMessages = getLastNMessages(userId, 7);

      // Форматируем сообщения с датами для контекста - в правильном хронологическом порядке
      const conversationHistory = lastMessages
        .reverse() // Переворачиваем чтобы старые были вверху, новые внизу
        .map(msg => {
          const date = new Date(msg.sent_time).toLocaleString('ru-RU', {
            timeZone: 'Europe/Moscow',
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          });
          const author = msg.author_id === 0 ? 'Бот' : msg.username || 'Пользователь';
          return `[${date}] ${author}: ${msg.message_text}`;
        })
        .join('\n');

      // Получаем события календаря на сегодня для пользователя
      const calendarEvents = await getUserTodayEvents(userId);

      botLogger.info(
        {
          userId,
          chatId,
          hasConversationHistory: !!conversationHistory,
          hasCalendarEvents: !!calendarEvents,
        },
        '🤖 Генерируем ответ пользователю'
      );

      if (AUTO_RESPONSES_ENABLED) {
        // Генерируем контекстуальный ответ через LLM
        const textResponse = await generateUserResponse(message, conversationHistory, calendarEvents || undefined);

        // Отправляем текстовый ответ в правильный чат
        // Если сообщение из связанной группы - отвечаем туда же
        // Иначе - в CHAT_ID из конфига
        await bot.telegram.sendMessage(replyToChatId, textResponse, {
          reply_parameters: {
            message_id: ctx.message.message_id,
            chat_id: chatId, // указываем исходный чат для правильной ссылки на сообщение
          },
        });

        // Сохраняем ответ бота в БД (author_id = 0 для бота)
        const botResponseTime = new Date().toISOString();
        saveMessage(userId, textResponse, botResponseTime, 0);

        botLogger.info(
          { userId, chatId, responseLength: textResponse.length },
          '✅ Ответ пользователю отправлен и сохранен'
        );
      } else {
        botLogger.debug({ userId, chatId }, '⏸️ Автоматические ответы временно отключены');
      }
    } catch (error) {
      const err = error as Error;
      botLogger.error({ error: err.message, stack: err.stack, userId, chatId }, 'Ошибка генерации ответа пользователю');

      // Fallback ответ при ошибке - также проверяем флаг автоответов
      if (AUTO_RESPONSES_ENABLED) {
        const fallbackMessage = 'Спасибо, что поделился! 🤍';
        await bot.telegram.sendMessage(replyToChatId, fallbackMessage, {
          reply_parameters: {
            message_id: ctx.message.message_id,
            chat_id: chatId,
          },
        });

        // Сохраняем fallback ответ в БД
        const fallbackTime = new Date().toISOString();
        saveMessage(userId, fallbackMessage, fallbackTime, 0);
      }
    }
  });
}