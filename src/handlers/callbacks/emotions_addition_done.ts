import { Context } from 'telegraf';
import { botLogger } from '../../logger';
import { Telegraf } from 'telegraf';

/**
 * Обработчик кнопки "Описал ☑️" после добавления эмоций (B1/B4)
 * Пользователь закончил добавлять эмоции → отправляем Плюшки с поддержкой
 */
export async function handleEmotionsAdditionDone(ctx: Context, bot: Telegraf) {
  const callbackQuery = ctx.callbackQuery;
  if (!callbackQuery || !('data' in callbackQuery)) return;

  const match = callbackQuery.data.match(/emotions_addition_done_(\d+)/);
  if (!match) return;

  const channelMessageId = parseInt(match[1], 10);
  const chatId = ctx.chat?.id;
  const messageId = ctx.callbackQuery?.message?.message_id;
  const userId = ctx.from?.id;
  const threadId = 'message_thread_id' in ctx.callbackQuery.message! ? ctx.callbackQuery.message.message_thread_id : undefined;

  botLogger.info({ channelMessageId, chatId, userId }, '✅ Кнопка "Описал" нажата');

  await ctx.answerCbQuery();

  if (!chatId || !userId) {
    botLogger.error({ channelMessageId }, 'Отсутствует chatId или userId');
    return;
  }

  try {
    // Удаляем сообщение с кнопкой "Описал"
    if (messageId) {
      try {
        await bot.telegram.deleteMessage(chatId, messageId);
        botLogger.info({ channelMessageId, messageId }, '🗑 Удалено сообщение "Когда опишешь..."');
      } catch (deleteError) {
        botLogger.warn({ error: deleteError }, 'Не удалось удалить сообщение с кнопкой');
      }
    }

    // Получаем последнее сообщение пользователя для reply
    const { db } = await import('../../db');
    const lastUserMessageQuery = db.query(`
      SELECT message_id FROM message_links
      WHERE channel_message_id = ? AND message_type = 'user'
      ORDER BY created_at DESC
      LIMIT 1
    `);
    const lastUserMessage = lastUserMessageQuery.get(channelMessageId) as { message_id: number } | null;
    const replyToMessageId = lastUserMessage?.message_id || messageId || 0;

    // Отправляем Плюшки с текстом поддержки (из 24 вариантов)
    const { EMOTIONS_SUPPORT_TEXTS } = await import('../../constants/emotions-support-texts');
    const { getLastUsedEmotionsSupportTexts, addUsedEmotionsSupportText } = await import('../../db');

    // Получаем последние 5 использованных текстов
    const lastUsed = getLastUsedEmotionsSupportTexts(5);

    // Выбираем случайный текст, исключая последние 5
    let availableTexts = EMOTIONS_SUPPORT_TEXTS.map((_, idx) => idx).filter(idx => !lastUsed.includes(idx));

    // Если все использованы - используем все
    if (availableTexts.length === 0) {
      availableTexts = EMOTIONS_SUPPORT_TEXTS.map((_, idx) => idx);
    }

    const randomIndex = availableTexts[Math.floor(Math.random() * availableTexts.length)];
    const randomSupportText = EMOTIONS_SUPPORT_TEXTS[randomIndex];

    // Сохраняем использованный текст
    addUsedEmotionsSupportText(randomIndex);
    const plushkiText = `<i>${randomSupportText}</i>\n\n2. <b>Плюшки для лягушки</b>\n\nВспомни и напиши все приятное за день\nТут тоже опиши эмоции, которые ты испытал 😍`;

    const { scenarioSendWithRetry } = await import('../../utils/telegram-retry');

    const sendOptions: any = {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: 'Таблица эмоций', callback_data: `emotions_table_${channelMessageId}` }]],
      },
    };

    if (threadId) {
      sendOptions.reply_to_message_id = threadId;
    }

    const plushkiMessage = await scenarioSendWithRetry(
      bot,
      chatId,
      userId,
      () =>
        bot.telegram.sendMessage(chatId, plushkiText, sendOptions),
      'emotions_addition_done_plushki',
      { maxAttempts: 5, intervalMs: 3000 }
    );

    // Обновляем состояние - теперь ждем Плюшки
    const { updateInteractivePostState, updateTaskStatus, saveMessage } = await import('../../db');

    // Отмечаем первое задание как выполненное
    updateTaskStatus(channelMessageId, 1, true);

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
            botLogger.info({ userId, channelMessageId, messagesCount: userMessages.length }, '💔 Негативное событие сохранено асинхронно (вечер, после добавления эмоций)');
          }
        }
      } catch (error) {
        botLogger.error({ error, userId, channelMessageId }, 'Ошибка асинхронного сохранения негативного события (после добавления эмоций)');
      }
    })();

    // Сохраняем сообщение бота
    saveMessage(userId, plushkiText, new Date().toISOString(), 0);

    // Обновляем состояние
    updateInteractivePostState(channelMessageId, 'waiting_positive', {
      bot_task2_message_id: plushkiMessage.message_id,
    });

    botLogger.info({ channelMessageId, plushkiMessageId: plushkiMessage.message_id }, '✅ Плюшки отправлены после добавления эмоций');
  } catch (error) {
    botLogger.error({ error, channelMessageId }, 'Ошибка обработки кнопки "Описал"');
  }
}
