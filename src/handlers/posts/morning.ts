/**
 * Обработчик утренних постов
 * Делегирует обработку существующей логике в scheduler.handleMorningPostResponse
 */

import { Telegraf } from 'telegraf';
import type { PostHandler, MessageContext, PostData } from '../../post-handler-registry';
import { schedulerLogger } from '../../logger';

export class MorningPostHandler implements PostHandler {
  readonly type = 'morning';
  readonly priority = 100; // Высший приоритет

  constructor(
    private bot: Telegraf,
    private scheduler: any // Scheduler instance
  ) {}

  async handle(context: MessageContext, post: PostData): Promise<void> {
    schedulerLogger.debug(
      {
        userId: context.userId,
        postId: post.channelMessageId,
        currentState: post.currentState,
      },
      '🌅 MorningPostHandler: делегируем обработку scheduler.handleMorningPostResponse'
    );

    // Восстанавливаем формат данных для существующей функции
    const morningPost = {
      id: 0, // Не используется в handleMorningPostResponse
      channel_message_id: post.channelMessageId,
      user_id: post.userId,
      created_at: post.createdAt,
      current_step: post.currentState || 'waiting_user_message',
      last_button_message_id: post.metadata.lastButtonMessageId,
    };

    // Делегируем существующей логике - НЕ меняем её!
    await this.scheduler.handleMorningPostResponse(
      context.userId,
      context.messageText,
      context.chatId,
      context.messageId,
      morningPost,
      context.messageThreadId
    );
  }
}
