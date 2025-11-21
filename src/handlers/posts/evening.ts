/**
 * Обработчик вечерних постов (интерактивные задания)
 * Пока что просто помечает что вечерний пост найден
 * Обработка будет через существующую логику в scheduler.handleInteractiveUserResponse
 *
 * TODO: После тестирования новой системы - вынести вечернюю логику в отдельный метод
 */

import { Telegraf } from 'telegraf';
import type { PostHandler, MessageContext, PostData } from '../../post-handler-registry';
import { schedulerLogger } from '../../logger';

export class EveningPostHandler implements PostHandler {
  readonly type = 'evening';
  readonly priority = 90; // Чуть ниже утреннего

  constructor(
    private bot: Telegraf,
    private scheduler: any // Scheduler instance
  ) {}

  async handle(context: MessageContext, post: PostData): Promise<void> {
    schedulerLogger.info(
      {
        userId: context.userId,
        postId: post.channelMessageId,
        currentState: post.currentState,
      },
      '🌙 EveningPostHandler: вечерний пост найден, вызываем СТАРУЮ логику для обработки'
    );

    // ⚠️ ВРЕМЕННОЕ РЕШЕНИЕ: Вызываем старую логику handleInteractiveUserResponse
    // Она содержит всю вечернюю обработку (строки 5290+ в scheduler.ts)
    // После тестирования новой системы - выделим вечернюю логику в отдельный метод
    await this.scheduler.handleInteractiveUserResponse(
      context.userId,
      context.messageText,
      context.chatId,
      context.messageId,
      context.messageThreadId
    );
  }
}
