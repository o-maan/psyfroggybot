import { botLogger } from '../../logger';
import type { BotContext } from '../../types';
import type { Telegraf } from 'telegraf';
import { scenarioSendWithRetry } from '../../utils/telegram-retry';
import { sendToUser } from '../../utils/send-to-user';

// Обработчик для кнопки "На сегодня хватит - пропустить 😮‍💨"
export async function handleSkipEmotionsClarification(ctx: BotContext, bot: Telegraf) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const messageId = ctx.callbackQuery.message?.message_id;
    const chatId = ctx.callbackQuery.message?.chat?.id;
    const userId = ctx.from?.id;
    const threadId = 'message_thread_id' in ctx.callbackQuery.message! ? ctx.callbackQuery.message.message_thread_id : undefined;

    await ctx.answerCbQuery('👍 Хорошо! Переходим дальше');

    botLogger.info(
      { channelMessageId, messageId, chatId, userId },
      '🔘 Нажата кнопка пропуска уточнения эмоций'
    );

    const { getInteractivePost, updateInteractivePostState, updateTaskStatus } = await import('../../db');
    const post = getInteractivePost(channelMessageId);

    if (!post) {
      botLogger.error({ channelMessageId }, 'Пост не найден в БД');
      await ctx.answerCbQuery('❌ Ошибка: пост не найден');
      return;
    }

    // Отмечаем первое задание как выполненное
    updateTaskStatus(channelMessageId, 1, true);

    // АСИНХРОННО сохраняем негативное событие
    (async () => {
      try {
        const { db } = await import('../../db');
        // Получаем все сообщения пользователя для этого поста
        const userMessagesQuery = db.query(`
          SELECT message_preview FROM message_links
          WHERE channel_message_id = ? AND message_type = 'user'
          ORDER BY created_at ASC
        `);
        const userMessages = userMessagesQuery.all(channelMessageId) as any[];

        if (userMessages && userMessages.length > 0 && userId) {
          const { saveNegativeEvent } = await import('../../db');
          const allText = userMessages.map(m => m.message_preview || '').filter(Boolean).join('\n');

          if (allText) {
            saveNegativeEvent(
              userId,
              allText,
              '',
              channelMessageId.toString()
            );
            botLogger.info({ userId, channelMessageId, messagesCount: userMessages.length }, '💔 Негативное событие сохранено асинхронно (вечер, после пропуска уточнения)');
          }
        }
      } catch (error) {
        botLogger.error({ error, userId, channelMessageId }, 'Ошибка асинхронного сохранения негативного события (после пропуска уточнения)');
      }
    })();

    // Отправляем "Плюшки для лягушки"
    const plushkiText = `2. <b>Плюшки для лягушки</b>\n\nВспомни и напиши все приятное за день\nТут тоже опиши эмоции, которые ты испытал${'${:а}'} 😍`;

    const plushkiKeyboard = {
      inline_keyboard: [[{ text: 'Таблица эмоций', callback_data: `emotions_table_${channelMessageId}` }]],
    };

    if (!chatId || !userId || !messageId) {
      botLogger.error({ channelMessageId }, 'Отсутствует chatId, userId или messageId');
      await ctx.answerCbQuery('❌ Ошибка: недостаточно данных');
      return;
    }

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
        'skip_emotions_clarification_plushki',
        { maxAttempts: 5, intervalMs: 3000 }
      );

      // Обновляем состояние в БД
      updateInteractivePostState(channelMessageId, 'waiting_positive', {
        bot_task2_message_id: plushkiMessage.message_id,
      });

      botLogger.info({ channelMessageId }, '✅ Отправлены "Плюшки для лягушки" после пропуска уточнения эмоций');
    } catch (sendError) {
      botLogger.error({ error: sendError }, 'Критическая ошибка: не удалось отправить плюшки');
      await ctx.answerCbQuery('❌ Произошла ошибка при отправке следующего задания');
    }
  } catch (error) {
    botLogger.error(
      { error: (error as Error).message, stack: (error as Error).stack },
      'Ошибка обработки кнопки пропуска уточнения эмоций'
    );
    try {
      await ctx.answerCbQuery('❌ Произошла ошибка, попробуй еще раз');
    } catch (answerError) {
      botLogger.error({ answerError }, 'Не удалось отправить answerCbQuery после ошибки');
    }
  }
}
