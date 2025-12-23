import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';
import { botLogger } from '../../logger';
import { updateUserResponse, saveMessage, getLastNMessages } from '../../db';
import { generateUserResponse } from '../../llm';
import { getUserTodayEvents } from '../../calendar';
import { handleOnboardingMessage } from './onboarding';
import { handleMeEditingMessage } from './me-editing';
import { sendToUser } from '../../utils/send-to-user';
import {
  isWaitingForUnpackSituation,
  clearUnpackWaiting,
  getUnpackState,
  setUnpackState,
  clearUnpackState,
  isInUnpackSession
} from '../../commands/user/unpack';

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

    // Проверяем, не находится ли пользователь в процессе онбординга
    const isOnboarding = await handleOnboardingMessage(ctx);
    if (isOnboarding) {
      // Сообщение обработано в рамках онбординга
      return;
    }

    // Проверяем, не редактирует ли пользователь свои данные через /me
    const isMeEditing = await handleMeEditingMessage(ctx);
    if (isMeEditing) {
      // Сообщение обработано в рамках редактирования данных
      return;
    }

    // Проверяем, не ожидает ли пользователь ввода ситуации для /unpack (ПЕРВЫЙ ШАГ)
    if (isWaitingForUnpackSituation(userId)) {
      try {
        // Импортируем UnpackWrapper динамически
        const { UnpackWrapper } = await import('../unpack-wrapper');

        // Сохраняем сообщение пользователя
        saveMessage(chatId, message, new Date().toISOString(), userId);

        // Создаем wrapper для обработки ситуации (автоматически установит состояние)
        const handler = new UnpackWrapper(bot, chatId, userId);

        // Запускаем логику разбора ситуации (вызываем analyzeUserResponse)
        // Используем chatId как channelMessageId для совместимости
        await handler.analyzeUserResponse(chatId, message, userId);

        // Очищаем статус ожидания
        clearUnpackWaiting(userId);

        botLogger.info({ userId, chatId }, '✅ Обработана ситуация для /unpack, LLM выбрал технику');
        return;
      } catch (error) {
        const err = error as Error;
        botLogger.error(
          {
            error: err.message,
            stack: err.stack,
            chatId,
            userId,
          },
          'Ошибка при обработке ситуации /unpack'
        );
        await sendToUser(bot, chatId, userId, `❌ Ошибка: ${err.message}`);
        clearUnpackWaiting(userId);
        clearUnpackState(userId);
        return;
      }
    }

    // Проверяем, находится ли пользователь в активной сессии /unpack (ПОСЛЕДУЮЩИЕ ШАГИ)
    if (isInUnpackSession(userId)) {
      try {
        // Импортируем DeepWorkHandler динамически
        const { DeepWorkHandler } = await import('../../deep-work-handler');

        const currentState = getUnpackState(userId);

        botLogger.info(
          {
            userId,
            chatId,
            currentState,
            textLength: message.length
          },
          '📨 Обработка сообщения в активной сессии /unpack'
        );

        // Сохраняем сообщение пользователя
        const userMessageId = ctx.message.message_id;
        saveMessage(chatId, message, new Date().toISOString(), userId, userMessageId, chatId);

        // Создаем handler для обработки
        const handler = new DeepWorkHandler(bot, chatId, userId);

        // Обрабатываем в зависимости от состояния
        switch (currentState) {
          // ===== СХЕМА РАЗБОРА =====
          case 'schema_waiting_trigger':
            await handler.handleTriggerResponse(chatId, message, userId, userMessageId);
            setUnpackState(userId, 'schema_waiting_thoughts');
            break;

          case 'schema_waiting_thoughts':
            await handler.handleSchemaThoughtsResponse(chatId, message, userId, userMessageId);
            setUnpackState(userId, 'schema_waiting_emotions');
            break;

          case 'schema_waiting_emotions':
            // Метод сам обновит состояние на schema_waiting_emotions_clarification если нужно
            await handler.handleSchemaEmotionsResponse(chatId, message, userId, userMessageId);
            const newState = getUnpackState(userId);
            if (newState === 'schema_waiting_emotions') {
              // Если состояние не изменилось - значит эмоций достаточно, переходим к поведению
              setUnpackState(userId, 'schema_waiting_behavior');
            }
            break;

          case 'schema_waiting_emotions_clarification':
            await handler.handleSchemaEmotionsClarificationResponse(chatId, message, userId, userMessageId, userMessageId);
            setUnpackState(userId, 'schema_waiting_behavior');
            break;

          case 'schema_waiting_behavior':
            await handler.handleSchemaBehaviorResponse(chatId, message, userId, userMessageId);
            setUnpackState(userId, 'schema_waiting_correction');
            break;

          case 'schema_waiting_correction':
            // ПОСЛЕДНИЙ ШАГ СХЕМЫ - НЕ вызываем handleSchemaCorrectionResponse
            // (он отправит "Ты проделал огромную работу" с кнопкой)
            // Просто отправляем финальное сообщение
            const finalMessage = 'Я с тобой! Надеюсь, тебе стало чуть яснее 💚';
            await sendToUser(bot, chatId, userId, finalMessage, { parse_mode: 'HTML' });
            saveMessage(chatId, finalMessage, new Date().toISOString(), 0);
            // Очищаем состояние - сессия завершена
            clearUnpackState(userId);
            // ⏰ Очищаем таймер команды
            scheduler.clearCommandTimeout(userId);
            // 🔄 Возвращаем к основной логике (только в ЛС)
            if (ctx.chat?.type === 'private') {
              await scheduler.returnToMainLogic(userId, chatId);
            }
            botLogger.info({ userId, chatId }, '✅ Команда /unpack завершена (схема)');
            break;

          // ===== ФИЛЬТРЫ ВОСПРИЯТИЯ =====
          case 'deep_waiting_thoughts':
            await handler.handleThoughtsResponse(chatId, message, userId, userMessageId);
            setUnpackState(userId, 'deep_waiting_distortions');
            break;

          case 'deep_waiting_distortions':
            await handler.handleDistortionsResponse(chatId, message, userId, userMessageId);
            setUnpackState(userId, 'deep_waiting_harm');
            break;

          case 'deep_waiting_harm':
            await handler.handleHarmResponse(chatId, message, userId, userMessageId);
            setUnpackState(userId, 'deep_waiting_rational');
            break;

          case 'deep_waiting_rational':
            // ПОСЛЕДНИЙ ШАГ ФИЛЬТРОВ - отправляем финальное сообщение
            // НЕ вызываем handler.handleRationalResponse, т.к. этот метод не существует
            // Просто отправляем финальное сообщение
            const finalMessageFilters = 'Я с тобой! Надеюсь, тебе стало чуть яснее 💚';
            await sendToUser(bot, chatId, userId, finalMessageFilters, { parse_mode: 'HTML' });
            saveMessage(chatId, finalMessageFilters, new Date().toISOString(), 0);
            // Очищаем состояние - сессия завершена
            clearUnpackState(userId);
            // ⏰ Очищаем таймер команды
            scheduler.clearCommandTimeout(userId);
            // 🔄 Возвращаем к основной логике (только в ЛС)
            if (ctx.chat?.type === 'private') {
              await scheduler.returnToMainLogic(userId, chatId);
            }
            botLogger.info({ userId, chatId }, '✅ Команда /unpack завершена (фильтры)');
            break;

          default:
            botLogger.warn({ userId, currentState }, '⚠️ Неизвестное состояние /unpack');
            break;
        }

        return;
      } catch (error) {
        const err = error as Error;
        botLogger.error(
          {
            error: err.message,
            stack: err.stack,
            chatId,
            userId,
          },
          'Ошибка при обработке активной сессии /unpack'
        );
        await sendToUser(bot, chatId, userId, `❌ Ошибка: ${err.message}`);
        clearUnpackState(userId);
        return;
      }
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

      // ПОТОМ проверяем интерактивные посты (работает и в ЛС, и в комментариях)
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
        const textResponse = await generateUserResponse(message, conversationHistory, calendarEvents || undefined, chatId);

        // Отправляем текстовый ответ в правильный чат
        // Если сообщение из связанной группы - отвечаем туда же
        // Иначе - в CHAT_ID из конфига
        await sendToUser(bot, replyToChatId, userId, textResponse, {
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
        await sendToUser(bot, replyToChatId, userId, fallbackMessage, {
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