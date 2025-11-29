import { botLogger } from '../../logger';
import type { BotContext } from '../../types';
import type { Telegraf } from 'telegraf';
import { scenarioSendWithRetry } from '../../utils/telegram-retry';
import { sendToUser } from '../../utils/send-to-user';

// Обработчик для кнопки "Идем дальше 🚀" после поддерживающего сообщения
export async function handleContinueToPlushki(ctx: BotContext, bot: Telegraf) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const messageId = ctx.callbackQuery.message?.message_id;
    const chatId = ctx.callbackQuery.message?.chat?.id;
    const userId = ctx.from?.id;
    const threadId = 'message_thread_id' in ctx.callbackQuery.message! ? ctx.callbackQuery.message.message_thread_id : undefined;

    await ctx.answerCbQuery('🚀 Отлично! Продолжаем');

    botLogger.info(
      {
        action: 'continue_to_plushki',
        channelMessageId,
        messageId,
        chatId,
        userId,
      },
      '🔘 Нажата кнопка "Идем дальше 🚀"'
    );

    // Получаем данные поста из БД и последнее сообщение пользователя
    const { getInteractivePost, updateTaskStatus, updateInteractivePostState, db } = await import('../../db');
    const post = getInteractivePost(channelMessageId);

    // Получаем последнее сообщение пользователя для reply
    const lastUserMessageQuery = db.query(`
      SELECT message_id FROM message_links
      WHERE channel_message_id = ? AND message_type = 'user'
      ORDER BY created_at DESC
      LIMIT 1
    `);
    const lastUserMessage = lastUserMessageQuery.get(channelMessageId) as { message_id: number } | null;
    const replyToMessageId = lastUserMessage?.message_id || messageId;

    if (!post) {
      botLogger.error({ channelMessageId }, 'Критическая ошибка: пост не найден в БД');
      await ctx.answerCbQuery('❌ Ошибка: пост не найден');
      return;
    }

    // Отмечаем первое задание как выполненное
    updateTaskStatus(channelMessageId, 1, true);

    if (!chatId || !userId || !messageId) {
      botLogger.error({ channelMessageId }, 'Отсутствует chatId, userId или messageId');
      return;
    }

    // АСИНХРОННО сохраняем негативное событие
    (async () => {
      try {
        // Получаем все сообщения пользователя для этого поста
        const userMessagesQuery = db.query(`
          SELECT message_preview FROM message_links
          WHERE channel_message_id = ? AND message_type = 'user'
          ORDER BY created_at ASC
        `);
        const userMessages = userMessagesQuery.all(channelMessageId) as any[];

        if (userMessages && userMessages.length > 0) {
          const { saveNegativeEvent } = await import('../../db');
          const allText = userMessages.map(m => m.message_preview || '').filter(Boolean).join('\n');

          if (allText) {
            saveNegativeEvent(
              userId,
              allText,
              '',
              channelMessageId.toString()
            );
            botLogger.info({ userId, channelMessageId, messagesCount: userMessages.length }, '💔 Негативное событие сохранено асинхронно (вечер, после поддержки)');
          }
        }
      } catch (error) {
        botLogger.error({ error, userId, channelMessageId }, 'Ошибка асинхронного сохранения негативного события (после поддержки)');
      }
    })();

    // Отправляем "Плюшки для лягушки"
    const plushkiText = '2. <b>Плюшки для лягушки</b>\n\nВспомни и напиши все приятное за день\nТут тоже опиши эмоции, которые ты испытал 😍';

    const plushkiKeyboard = {
      inline_keyboard: [[{ text: 'Таблица эмоций', callback_data: `emotions_table_${channelMessageId}` }]],
    };

    try {
      const sendOptions: any = {
        parse_mode: 'HTML',
        reply_markup: plushkiKeyboard,
      };

      if (threadId) {
        sendOptions.reply_to_message_id = threadId;
      }

      const plushkiMessage = await scenarioSendWithRetry(
        bot,
        chatId,
        userId,
        () =>
          sendToUser(bot, chatId, userId, plushkiText, sendOptions),
        'continue_to_plushki_message',
        { maxAttempts: 5, intervalMs: 3000 }
      );

      // Обновляем состояние в БД
      updateInteractivePostState(channelMessageId, 'waiting_positive', {
        bot_task2_message_id: plushkiMessage.message_id,
      });

      botLogger.info({ channelMessageId }, '✅ Отправлены "Плюшки для лягушки"');
    } catch (sendError) {
      botLogger.error({ error: sendError }, 'Критическая ошибка: не удалось отправить плюшки');
    }
  } catch (error) {
    botLogger.error(
      { error: (error as Error).message, stack: (error as Error).stack },
      'Ошибка обработки кнопки "Идем дальше 🚀"'
    );
    try {
      await ctx.answerCbQuery('❌ Произошла ошибка, попробуй еще раз');
    } catch (answerError) {
      botLogger.error({ answerError }, 'Не удалось отправить answerCbQuery после ошибки');
    }
  }
}
