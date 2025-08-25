import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';
import { botLogger } from '../../logger';

// Обработчик для отслеживания пересланных сообщений из канала
export function registerForwardedMessageHandler(bot: Telegraf, scheduler: Scheduler) {
  bot.on('message', async (ctx, next) => {
    // Проверяем, является ли это пересланным сообщением из канала
    if (
      ctx.message &&
      'forward_from_chat' in ctx.message &&
      ctx.message.forward_from_chat &&
      typeof ctx.message.forward_from_chat === 'object' &&
      'type' in ctx.message.forward_from_chat &&
      ctx.message.forward_from_chat.type === 'channel' &&
      'id' in ctx.message.forward_from_chat &&
      ctx.message.forward_from_chat.id === scheduler.CHANNEL_ID &&
      'forward_from_message_id' in ctx.message
    ) {
      const channelMessageId = ctx.message.forward_from_message_id as number;
      const discussionMessageId = ctx.message.message_id;

      // Сохраняем соответствие ID
      scheduler.saveForwardedMessage(channelMessageId, discussionMessageId);

      const currentTime = new Date();
      botLogger.info(
        {
          channelMessageId,
          discussionMessageId,
          chatId: ctx.chat.id,
          isTopicMessage: ctx.message.is_topic_message,
          messageThreadId: (ctx.message as any).message_thread_id,
          fromChat: ctx.message.forward_from_chat,
          receivedAt: currentTime.toISOString(),
          timestamp: currentTime.getTime(),
        },
        '📎 Обнаружено пересланное сообщение из канала'
      );
    }

    // Также проверяем, если это сообщение в теме (комментарий к посту)
    if (ctx.message && 'message_thread_id' in ctx.message) {
      botLogger.debug(
        {
          messageThreadId: (ctx.message as any).message_thread_id,
          chatId: ctx.chat.id,
          messageId: ctx.message.message_id,
        },
        '💬 Сообщение в теме/треде'
      );
    }

    // Продолжаем обработку
    return next();
  });
}