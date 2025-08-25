import { botLogger } from '../../logger';
import type { BotContext } from '../../types';
import type { Telegraf } from 'telegraf';

// Обработчик для кнопки пропуска первого задания - новый формат
export async function handleSkipNeg(ctx: BotContext, bot: Telegraf) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const messageId = ctx.callbackQuery.message?.message_id;
    const chatId = ctx.callbackQuery.message?.chat?.id;
    const userId = ctx.from?.id;

    await ctx.answerCbQuery('👍 Хорошо! Переходим к плюшкам');

    botLogger.info(
      {
        action: 'skip_neg',
        channelMessageId,
        messageId,
        chatId,
        userId,
      },
      '🔘 Нажата кнопка пропуска первого задания'
    );

    // Получаем данные поста из БД
    const { getInteractivePost, updateTaskStatus, updateInteractivePostState, escapeHTML } = await import('../../db');
    const post = getInteractivePost(channelMessageId);

    if (!post) {
      botLogger.error({ channelMessageId }, 'Пост не найден в БД');
      return;
    }

    // Отмечаем первое задание как пропущенное
    updateTaskStatus(channelMessageId, 1, true);

    // Отправляем плюшки (второе задание)
    let plushkiText = '2. <b>Плюшки для лягушки</b> (ситуация+эмоция)';
    if (post.message_data?.positive_part?.additional_text) {
      plushkiText += `\n<blockquote>${escapeHTML(post.message_data.positive_part.additional_text)}</blockquote>`;
    }

    const plushkiMessage = await bot.telegram.sendMessage(chatId!, plushkiText, {
      parse_mode: 'HTML',
      reply_parameters: {
        message_id: messageId!,
      },
    });

    // Обновляем текущее состояние поста, чтобы НЕ отправлять схему после пропуска
    updateInteractivePostState(channelMessageId, 'waiting_task2', {
      bot_task2_message_id: plushkiMessage.message_id,
    });

    botLogger.info({ channelMessageId }, '✅ Плюшки отправлены после пропуска');
  } catch (error) {
    botLogger.error({ error: (error as Error).message }, 'Ошибка обработки кнопки пропуска');
  }
}