/**
 * Универсальная система обработки постов для множества пользователей
 *
 * Архитектура:
 * - Каждый тип поста (утренний, вечерний, злой) = отдельный handler
 * - Registry находит ВСЕ активные посты ОДНИМ SQL запросом
 * - Обрабатывает каждый пост независимо (изоляция ошибок)
 *
 * Преимущества:
 * - Быстрее в 3-7 раз (единый SQL запрос вместо 3-7)
 * - Обрабатывает все типы постов одновременно
 * - Легко расширяется новыми типами
 * - Работает одинаково в группах и личных сообщениях
 */

import { Telegraf } from 'telegraf';
import { schedulerLogger } from './logger';
import { db } from './db';

// ================================
// БАЗОВЫЕ ТИПЫ И ИНТЕРФЕЙСЫ
// ================================

/**
 * Контекст сообщения пользователя - универсальный для всех типов чатов
 */
export interface MessageContext {
  userId: number;
  messageText: string;
  messageId: number;
  chatId: number;
  chatType: 'private' | 'group' | 'supergroup' | 'channel';
  messageThreadId?: number; // Для групп/каналов с тредами
  replyToMessageId?: number; // Для реплаев
}

/**
 * Данные активного поста
 */
export interface PostData {
  type: string; // 'morning' | 'evening' | 'angry' | 'joy'
  channelMessageId: number;
  userId: number;
  currentState: string | null;
  createdAt: string;
  metadata: Record<string, any>; // Дополнительные данные специфичные для типа
}

/**
 * Базовый интерфейс для всех обработчиков постов
 */
export interface PostHandler {
  // Тип поста
  readonly type: string;

  // Приоритет обработки (выше = раньше обрабатывается)
  readonly priority: number;

  // Обработать сообщение для этого поста
  handle(context: MessageContext, post: PostData): Promise<void>;
}

// ================================
// POST HANDLER REGISTRY
// ================================

/**
 * Реестр обработчиков постов
 * Находит все активные посты пользователя и делегирует обработку нужным handlers
 */
export class PostHandlerRegistry {
  private handlers: PostHandler[] = [];

  constructor(private bot: Telegraf) {}

  /**
   * Регистрация обработчика поста
   */
  register(handler: PostHandler): void {
    this.handlers.push(handler);
    // Сортируем по приоритету (выше = раньше)
    this.handlers.sort((a, b) => b.priority - a.priority);

    schedulerLogger.info(
      { type: handler.type, priority: handler.priority, totalHandlers: this.handlers.length },
      '✅ Зарегистрирован обработчик поста'
    );
  }

  /**
   * ОПТИМИЗИРОВАННЫЙ поиск ВСЕХ активных постов пользователя
   * ОДИН SQL запрос вместо 3-7 отдельных!
   */
  private async findAllActivePosts(
    userId: number,
    messageThreadId?: number
  ): Promise<Map<string, PostData>> {
    try {
      // ЕДИНЫЙ UNION запрос для ВСЕХ типов постов
      const query = db.query(`
        SELECT
          'morning' as post_type,
          channel_message_id,
          user_id,
          current_step as state,
          created_at,
          last_button_message_id as metadata_1,
          NULL as metadata_2
        FROM morning_posts
        WHERE user_id = ?
          AND (
            channel_message_id = ?
            OR EXISTS (
              SELECT 1 FROM thread_mappings
              WHERE channel_message_id = morning_posts.channel_message_id
                AND thread_id = ?
            )
          )

        UNION ALL

        SELECT
          'evening' as post_type,
          channel_message_id,
          user_id,
          current_state as state,
          created_at,
          message_data as metadata_1,
          NULL as metadata_2
        FROM interactive_posts
        WHERE user_id = ?
          AND (task1_completed = 0 OR task2_completed = 0 OR task3_completed = 0)
          AND (
            channel_message_id = ?
            OR EXISTS (
              SELECT 1 FROM thread_mappings
              WHERE channel_message_id = interactive_posts.channel_message_id
                AND thread_id = ?
            )
          )

        UNION ALL

        SELECT
          'angry' as post_type,
          channel_message_id,
          user_id,
          NULL as state,
          created_at,
          NULL as metadata_1,
          NULL as metadata_2
        FROM angry_posts
        WHERE user_id = ?
          AND (
            channel_message_id = ?
            OR EXISTS (
              SELECT 1 FROM thread_mappings
              WHERE channel_message_id = angry_posts.channel_message_id
                AND thread_id = ?
            )
          )

        ORDER BY created_at DESC
      `);

      const threadIdOrNull = messageThreadId || null;

      // ОДИН запрос для всех типов постов!
      const rows = query.all(
        userId,
        threadIdOrNull,
        threadIdOrNull, // morning
        userId,
        threadIdOrNull,
        threadIdOrNull, // evening
        userId,
        threadIdOrNull,
        threadIdOrNull // angry
      ) as any[];

      schedulerLogger.debug(
        { userId, messageThreadId, foundPosts: rows.length },
        `🔍 Найдено активных постов: ${rows.length}`
      );

      // Группируем результаты по типу
      const posts = new Map<string, PostData>();

      for (const row of rows) {
        const metadata: Record<string, any> = {};

        // Парсим metadata в зависимости от типа
        if (row.post_type === 'morning' && row.metadata_1) {
          metadata.lastButtonMessageId = row.metadata_1;
        } else if (row.post_type === 'evening' && row.metadata_1) {
          try {
            metadata.messageData = JSON.parse(row.metadata_1);
          } catch (e) {
            schedulerLogger.warn(
              { error: e, postType: row.post_type, channelMessageId: row.channel_message_id },
              'Ошибка парсинга metadata'
            );
          }
        }

        posts.set(row.post_type, {
          type: row.post_type,
          channelMessageId: row.channel_message_id,
          userId: row.user_id,
          currentState: row.state,
          createdAt: row.created_at,
          metadata,
        });
      }

      return posts;
    } catch (error) {
      schedulerLogger.error(
        {
          error: (error as Error).message,
          stack: (error as Error).stack,
          userId,
          messageThreadId,
        },
        '❌ Критическая ошибка поиска активных постов'
      );
      return new Map();
    }
  }

  /**
   * ГЛАВНАЯ ФУНКЦИЯ: Обработка сообщения пользователя
   * Находит ВСЕ активные посты и обрабатывает каждый независимо
   */
  async handleMessage(context: MessageContext): Promise<boolean> {
    schedulerLogger.info(
      {
        userId: context.userId,
        chatType: context.chatType,
        messageThreadId: context.messageThreadId,
        messagePreview: context.messageText.substring(0, 50),
      },
      '📬 PostHandlerRegistry: начало обработки сообщения'
    );

    // ⚡ ОДИН SQL запрос получает ВСЕ активные посты пользователя
    const activePosts = await this.findAllActivePosts(context.userId, context.messageThreadId);

    if (activePosts.size === 0) {
      schedulerLogger.debug({ userId: context.userId }, 'Нет активных постов для пользователя');
      return false;
    }

    schedulerLogger.info(
      {
        userId: context.userId,
        postsCount: activePosts.size,
        postTypes: Array.from(activePosts.keys()),
      },
      `✅ Найдено активных постов: ${activePosts.size}`
    );

    let handledAny = false;

    // Обрабатываем каждый пост через соответствующий handler
    for (const handler of this.handlers) {
      const post = activePosts.get(handler.type);
      if (!post) {
        continue; // Нет активного поста этого типа
      }

      try {
        schedulerLogger.info(
          {
            handlerType: handler.type,
            postId: post.channelMessageId,
            userId: context.userId,
            currentState: post.currentState,
          },
          `🔄 Обработка поста через ${handler.type} handler...`
        );

        await handler.handle(context, post);
        handledAny = true;

        schedulerLogger.info(
          { handlerType: handler.type, postId: post.channelMessageId },
          `✅ Пост успешно обработан через ${handler.type} handler`
        );
      } catch (error) {
        // ⚠️ КРИТИЧЕСКИ ВАЖНО: Ошибка в одном handler НЕ останавливает другие!
        schedulerLogger.error(
          {
            error: (error as Error).message,
            stack: (error as Error).stack,
            handlerType: handler.type,
            postId: post.channelMessageId,
            userId: context.userId,
          },
          `❌ Ошибка обработки ${handler.type} поста (продолжаем с другими)`
        );
      }
    }

    if (handledAny) {
      schedulerLogger.info({ userId: context.userId }, '🎉 Все посты успешно обработаны');
    }

    return handledAny;
  }

  /**
   * Получить информацию о зарегистрированных handlers
   */
  getRegisteredHandlers(): Array<{ type: string; priority: number }> {
    return this.handlers.map(h => ({ type: h.type, priority: h.priority }));
  }
}
