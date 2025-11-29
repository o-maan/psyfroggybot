/**
 * Обработчик злых постов (когда пользователь не отвечает)
 * Делегирует обработку существующей логике в scheduler
 */

import { Telegraf } from 'telegraf';
import type { PostHandler, MessageContext, PostData } from '../../post-handler-registry';
import { schedulerLogger } from '../../logger';
import { incrementAngryPostUserResponse } from '../../db';
import { sendToUser } from '../../utils/send-to-user';

export class AngryPostHandler implements PostHandler {
  readonly type = 'angry';
  readonly priority = 95; // Между утренним и вечерним

  constructor(
    private bot: Telegraf,
    private scheduler: any // Scheduler instance
  ) {}

  async handle(context: MessageContext, post: PostData): Promise<void> {
    schedulerLogger.info(
      {
        userId: context.userId,
        messageThreadId: context.messageThreadId,
        messageText: context.messageText.substring(0, 50),
      },
      '😠 AngryPostHandler: обнаружен комментарий к злому посту'
    );

    const messageThreadId = context.messageThreadId;
    if (!messageThreadId) {
      schedulerLogger.warn({ userId: context.userId }, 'Нет messageThreadId для злого поста');
      return;
    }

    // Увеличиваем счётчик ответов пользователя
    const responseCount = incrementAngryPostUserResponse(messageThreadId, context.userId);

    // Определяем текст ответа в зависимости от количества ответов
    let responseText = '';

    if (responseCount === 1) {
      // Первый ответ
      responseText = 'Я рад тебя слышать! 🤗\nВыполни задания под вчерашним постом ✍🏻';
    } else if (responseCount === 2) {
      // Второй ответ
      responseText = 'Буду ждать тебя там 🐸';
    } else {
      // Третий и последующие - не реагируем
      schedulerLogger.info(
        { userId: context.userId, messageThreadId, responseCount },
        '🔇 Пользователь написал больше 2 раз, игнорируем'
      );
      return;
    }

    // Отправляем ответ
    const sendOptions: any = {};
    if (messageThreadId) {
      sendOptions.reply_to_message_id = messageThreadId;
    }

    await sendToUser(this.bot, context.chatId, context.userId, responseText, sendOptions);

    schedulerLogger.info({ userId: context.userId, responseCount }, '✅ Отправлен ответ на комментарий к злому посту');
  }
}
