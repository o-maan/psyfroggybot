import { botLogger } from '../../logger';
import type { BotContext } from '../../types';
import type { Telegraf } from 'telegraf';
import { scenarioSendWithRetry } from '../../utils/telegram-retry';

// Обработчик для кнопки "Идем дальше 🚀" после поддерживающего сообщения
export async function handleContinueToPlushki(ctx: BotContext, bot: Telegraf) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const messageId = ctx.callbackQuery.message?.message_id;
    const chatId = ctx.callbackQuery.message?.chat?.id;
    const userId = ctx.from?.id;

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

    // Отправляем "Плюшки для лягушки"
    const plushkiText = '2. <b>Плюшки для лягушки</b>\n\nВспомни и напиши все приятное за день\nТут тоже опиши эмоции, которые ты испытал 😍';

    const plushkiKeyboard = {
      inline_keyboard: [[{ text: 'Таблица эмоций', callback_data: `emotions_table_${channelMessageId}` }]],
    };

    try {
      const plushkiMessage = await scenarioSendWithRetry(
        bot,
        chatId,
        userId,
        () =>
          bot.telegram.sendMessage(chatId, plushkiText, {
            parse_mode: 'HTML',
            reply_parameters: { message_id: replyToMessageId },
            reply_markup: plushkiKeyboard,
          }),
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
