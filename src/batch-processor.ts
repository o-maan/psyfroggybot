/**
 * Батчевая обработка сообщений пользователя через LLM
 *
 * СТРАТЕГИЯ ОБРАБОТКИ:
 * 1. АСИНХРОННО (processMessageAsync) - сразу после сохранения утреннего сообщения
 *    - Fire-and-forget паттерн, не блокирует бота
 *    - Обрабатывает сообщения по мере поступления
 *
 * 2. BATCH (processBatchMessages) - в 21:30 МСК перед вечерним постом
 *    - Перепроверяет все необработанные сообщения
 *    - Доделывает то, что не успело обработаться асинхронно
 *    - Гарантирует что ничего не потеряется
 *
 * Задачи:
 * 1. Найти все необработанные сообщения (processed_at IS NULL)
 * 2. Сгруппировать по channel_message_id
 * 3. Определить тональность на основе state_at_time
 * 4. Использовать LLM для анализа если нужно
 * 5. Сохранить в positive_events/negative_events
 * 6. Пометить как обработанные
 */

import { db, savePositiveEvent, saveNegativeEvent } from './db';
import { schedulerLogger } from './logger';
import { analyzeSentiment } from './llm';

interface UnprocessedMessage {
  id: number;
  channel_message_id: number;
  message_id: number;
  user_id: number;
  message_preview: string | null;
  state_at_time: string | null;
  created_at: string;
}

interface GroupedMessages {
  channelMessageId: number;
  userId: number;
  messages: UnprocessedMessage[];
  positiveMessages: UnprocessedMessage[];
  negativeMessages: UnprocessedMessage[];
  unclearMessages: UnprocessedMessage[];
}

/**
 * Получить все необработанные сообщения пользователя
 */
function getUnprocessedUserMessages(): UnprocessedMessage[] {
  const query = db.query(`
    SELECT * FROM message_links
    WHERE message_type = 'user'
      AND processed_at IS NULL
      AND message_preview IS NOT NULL
      AND message_preview != ''
      AND channel_message_id != 0
    ORDER BY channel_message_id, created_at ASC
  `);

  return query.all() as UnprocessedMessage[];
}

/**
 * Сгруппировать сообщения по channel_message_id и классифицировать по тональности
 */
function groupAndClassifyMessages(messages: UnprocessedMessage[]): GroupedMessages[] {
  const grouped = new Map<number, GroupedMessages>();

  for (const msg of messages) {
    const key = msg.channel_message_id;

    if (!grouped.has(key)) {
      grouped.set(key, {
        channelMessageId: key,
        userId: msg.user_id,
        messages: [],
        positiveMessages: [],
        negativeMessages: [],
        unclearMessages: [],
      });
    }

    const group = grouped.get(key)!;
    group.messages.push(msg);

    // Классифицируем на основе state_at_time
    const state = msg.state_at_time;

    if (!state) {
      // Нет состояния - неясно
      group.unclearMessages.push(msg);
    } else if (
      state.includes('waiting_negative') ||
      state.includes('waiting_emotions_addition') ||
      state.includes('deep_waiting') ||
      state.includes('simplified_waiting_task1')
    ) {
      // Негативные состояния
      group.negativeMessages.push(msg);
    } else if (
      state.includes('waiting_positive') ||
      state.includes('plushki')
    ) {
      // Позитивные состояния
      group.positiveMessages.push(msg);
    } else if (state.includes('joy_session')) {
      // JOY сессия - НЕ обрабатываем вообще, пропускаем
      schedulerLogger.debug(
        { messageId: msg.id, channelMessageId: msg.channel_message_id, userId: msg.user_id },
        '🤩 JOY сообщение пропущено - не попадёт в positive_events'
      );
      // НЕ добавляем ни в какую группу - просто пропускаем
    } else {
      // Неясное состояние
      group.unclearMessages.push(msg);
    }
  }

  return Array.from(grouped.values());
}

/**
 * Обработать группу сообщений с помощью LLM если есть неясные
 */
async function processGroupWithLLM(group: GroupedMessages): Promise<void> {
  try {
    // Если есть неясные сообщения - используем LLM
    if (group.unclearMessages.length > 0) {
      const unclearText = group.unclearMessages
        .map(m => m.message_preview)
        .filter(Boolean)
        .join('\n');

      schedulerLogger.info(
        {
          channelMessageId: group.channelMessageId,
          userId: group.userId,
          unclearCount: group.unclearMessages.length,
        },
        '🤔 Анализируем неясные сообщения через LLM'
      );

      // Анализируем через LLM
      const sentiment = await analyzeSentiment(unclearText);

      if (sentiment && sentiment.sentiment) {
        if (sentiment.sentiment === 'positive') {
          group.positiveMessages.push(...group.unclearMessages);
          schedulerLogger.info(
            { channelMessageId: group.channelMessageId, userId: group.userId, count: group.unclearMessages.length },
            '💚 Позитивные события распределены через LLM'
          );
        } else if (sentiment.sentiment === 'negative') {
          group.negativeMessages.push(...group.unclearMessages);
          schedulerLogger.info(
            { channelMessageId: group.channelMessageId, userId: group.userId, count: group.unclearMessages.length },
            '💔 Негативные события распределены через LLM'
          );
        } else if (sentiment.sentiment === 'mixed') {
          // Mixed - ТОЛЬКО в негативные (не портим список радости)
          group.negativeMessages.push(...group.unclearMessages);
          schedulerLogger.info(
            { channelMessageId: group.channelMessageId, userId: group.userId, count: group.unclearMessages.length },
            '🔀 Mixed события сохранены ТОЛЬКО в негативные (не портим список радости)'
          );
        } else if (sentiment.sentiment === 'neutral') {
          // Neutral - НЕ сохраняем (это чистые факты без эмоциональной окраски)
          schedulerLogger.info(
            { channelMessageId: group.channelMessageId, userId: group.userId, count: group.unclearMessages.length },
            '😐 Neutral события пропущены (чистые факты без эмоций)'
          );
        }
      } else {
        // Если LLM не смог определить тональность - сохраняем как позитивные
        schedulerLogger.warn(
          { channelMessageId: group.channelMessageId, userId: group.userId },
          '⚠️ LLM не определил тональность, сохраняем как позитивные'
        );
        group.positiveMessages.push(...group.unclearMessages);
      }

      group.unclearMessages = [];
    }

    // Сохраняем позитивные события
    if (group.positiveMessages.length > 0) {
      const positiveText = group.positiveMessages
        .map(m => m.message_preview)
        .filter(Boolean)
        .join('\n');

      if (positiveText) {
        savePositiveEvent(
          group.userId,
          positiveText,
          '',
          group.channelMessageId.toString()
        );

        schedulerLogger.info(
          {
            userId: group.userId,
            channelMessageId: group.channelMessageId,
            messagesCount: group.positiveMessages.length,
          },
          '💚 Позитивное событие сохранено (batch processing)'
        );

        // Отмечаем как обработанные
        markMessagesAsProcessed(group.positiveMessages.map(m => m.id));
      }
    }

    // Сохраняем негативные события
    if (group.negativeMessages.length > 0) {
      const negativeText = group.negativeMessages
        .map(m => m.message_preview)
        .filter(Boolean)
        .join('\n');

      if (negativeText) {
        saveNegativeEvent(
          group.userId,
          negativeText,
          '',
          group.channelMessageId.toString()
        );

        schedulerLogger.info(
          {
            userId: group.userId,
            channelMessageId: group.channelMessageId,
            messagesCount: group.negativeMessages.length,
          },
          '💔 Негативное событие сохранено (batch processing)'
        );

        // Отмечаем как обработанные
        markMessagesAsProcessed(group.negativeMessages.map(m => m.id));
      }
    }
  } catch (error) {
    schedulerLogger.error(
      { error, channelMessageId: group.channelMessageId, userId: group.userId },
      'Ошибка обработки группы сообщений через LLM'
    );
  }
}

/**
 * Пометить сообщения как обработанные
 */
function markMessagesAsProcessed(messageIds: number[]): void {
  if (messageIds.length === 0) return;

  const placeholders = messageIds.map(() => '?').join(',');
  const update = db.query(`
    UPDATE message_links
    SET processed_at = datetime('now')
    WHERE id IN (${placeholders})
  `);

  update.run(...messageIds);

  schedulerLogger.debug(
    { count: messageIds.length },
    '✅ Сообщения помечены как обработанные'
  );
}

/**
 * Главная функция батчевой обработки
 */
export async function processBatchMessages(): Promise<void> {
  schedulerLogger.info('🔄 Запуск батчевой обработки сообщений...');

  try {
    // 1. Получаем необработанные сообщения
    const unprocessed = getUnprocessedUserMessages();

    if (unprocessed.length === 0) {
      schedulerLogger.info('✅ Нет необработанных сообщений');
      return;
    }

    schedulerLogger.info(
      { count: unprocessed.length },
      '📋 Найдено необработанных сообщений'
    );

    // 2. Группируем и классифицируем
    const groups = groupAndClassifyMessages(unprocessed);

    schedulerLogger.info(
      { groupsCount: groups.length },
      '📊 Сообщения сгруппированы по постам'
    );

    // 3. Обрабатываем каждую группу
    for (const group of groups) {
      await processGroupWithLLM(group);

      // Небольшая задержка между группами чтобы не перегружать LLM API
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    schedulerLogger.info('✅ Батчевая обработка завершена');
  } catch (error) {
    schedulerLogger.error(
      { error: (error as Error).message, stack: (error as Error).stack },
      'Критическая ошибка батчевой обработки'
    );
  }
}

/**
 * АСИНХРОННАЯ обработка сообщений одного поста сразу после сохранения
 * Не блокирует работу бота! Fire-and-forget паттерн
 *
 * Вызывается из interactive-tracker.ts после сохранения утреннего сообщения в message_links
 *
 * @param channelMessageId - ID поста канала
 * @param userId - ID пользователя
 */
export function processMessageAsync(channelMessageId: number, userId: number): void {
  // Fire-and-forget: запускаем асинхронно, не ждем результата
  (async () => {
    try {
      schedulerLogger.debug(
        { channelMessageId, userId },
        '🔄 Запуск асинхронной обработки сообщений поста'
      );

      // Получаем все необработанные сообщения для этого поста
      const query = db.query(`
        SELECT * FROM message_links
        WHERE channel_message_id = ?
          AND message_type = 'user'
          AND processed_at IS NULL
          AND message_preview IS NOT NULL
          AND message_preview != ''
        ORDER BY created_at ASC
      `);

      const messages = query.all(channelMessageId) as UnprocessedMessage[];

      if (messages.length === 0) {
        schedulerLogger.debug({ channelMessageId }, 'Нет необработанных сообщений для асинхронной обработки');
        return;
      }

      schedulerLogger.info(
        { channelMessageId, userId, messagesCount: messages.length },
        '📝 Найдено необработанных сообщений для асинхронной обработки'
      );

      // Группируем и классифицируем
      const groups = groupAndClassifyMessages(messages);

      if (groups.length === 0) {
        return;
      }

      // Обрабатываем первую (и единственную) группу
      const group = groups[0];
      await processGroupWithLLM(group);

      schedulerLogger.info(
        { channelMessageId, userId },
        '✅ Асинхронная обработка завершена успешно'
      );
    } catch (error) {
      schedulerLogger.error(
        {
          error: (error as Error).message,
          stack: (error as Error).stack,
          channelMessageId,
          userId
        },
        '❌ Ошибка асинхронной обработки сообщения (не критично, batch processor доделает)'
      );
    }
  })();
}
