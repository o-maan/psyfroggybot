import { botLogger } from '../../logger';
import type { BotContext } from '../../types';
import type { Scheduler } from '../../scheduler';

// Обработчик кнопки "Пропустить" для схемы разбора ситуации
export async function handleSkipSchema(ctx: BotContext, scheduler: Scheduler) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    await ctx.answerCbQuery('Переходим к плюшкам! 🌱', { show_alert: false });

    botLogger.info(
      {
        action: 'skip_schema',
        channelMessageId,
        userId: ctx.from?.id,
      },
      'Пользователь пропустил схему разбора'
    );

    // Получаем данные о посте
    const { getInteractivePost, updateInteractivePostState, updateTaskStatus } = await import('../../db');
    const post = getInteractivePost(channelMessageId);

    if (!post) {
      botLogger.warn({ channelMessageId }, 'Пост не найден для skip_schema');
      return;
    }

    // Обновляем состояние - пропускаем схему и переходим к плюшкам
    updateInteractivePostState(channelMessageId, 'waiting_task2', {
      user_schema_message_id: ctx.callbackQuery.message?.message_id,
    });

    // Отмечаем первое задание как выполненное (схема пропущена)
    updateTaskStatus(channelMessageId, 1, true);

    // Получаем данные сообщения для генерации плюшек
    const messageData = post.message_data;

    botLogger.debug(
      {
        channelMessageId,
        hasMessageData: !!messageData,
        messageDataKeys: messageData ? Object.keys(messageData) : [],
        positivePartText: messageData?.positive_part?.additional_text,
      },
      'Данные для плюшек'
    );

    // Отправляем слова поддержки + плюшки
    const supportText = scheduler.getRandomSupportText();
    const responseText = `<i>${supportText}</i>\n\n${scheduler.buildSecondPart(messageData)}`;

    const task2Message = await ctx.telegram.sendMessage(ctx.chat!.id, responseText, {
      parse_mode: 'HTML',
      reply_parameters: {
        message_id: ctx.callbackQuery.message!.message_id,
      },
    });

    // Сохраняем ID сообщения с плюшками
    updateInteractivePostState(channelMessageId, 'waiting_task2', {
      bot_task2_message_id: task2Message.message_id,
    });

    // Сохраняем сообщение в историю
    const { saveMessage } = await import('../../db');
    saveMessage(ctx.from!.id, responseText, new Date().toISOString(), 0);

    // Обновляем сессию, если она существует
    const session = scheduler.getInteractiveSession(ctx.from!.id) || scheduler.getInteractiveSession(channelMessageId);
    if (session) {
      session.currentStep = 'waiting_positive';
    }

    botLogger.info({ channelMessageId, userId: ctx.from?.id }, 'Схема пропущена, отправлены плюшки');
  } catch (error) {
    botLogger.error({ error: (error as Error).message }, 'Ошибка обработки skip_schema');
    await ctx.answerCbQuery('Произошла ошибка. Попробуйте еще раз.');
  }
}