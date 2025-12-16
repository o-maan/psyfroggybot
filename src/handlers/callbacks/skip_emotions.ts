import { botLogger } from '../../logger';
import type { BotContext } from '../../types';
import type { Scheduler } from '../../scheduler';
import { callbackSendWithRetry } from '../../utils/telegram-retry';
import { sendToUser } from '../../utils/send-to-user';

// Обработчик кнопки "Уже описал" для пропуска дополнительного вопроса про эмоции
export async function handleSkipEmotions(ctx: BotContext, scheduler: Scheduler) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const threadId = 'message_thread_id' in ctx.callbackQuery.message! ? ctx.callbackQuery.message.message_thread_id : undefined;
    await ctx.answerCbQuery('Отлично! Переходим к плюшкам 🌱');

    botLogger.info(
      {
        action: 'skip_emotions',
        channelMessageId,
        userId: ctx.from?.id,
      },
      'Пользователь пропустил дополнительный вопрос про эмоции'
    );

    // Получаем данные о посте
    const { getInteractivePost, updateInteractivePostState, updateTaskStatus, saveMessage } = await import('../../db');
    const post = getInteractivePost(channelMessageId);

    if (!post) {
      botLogger.warn({ channelMessageId }, 'Пост не найден для skip_emotions');
      return;
    }

    // Отмечаем первое задание как выполненное
    updateTaskStatus(channelMessageId, 1, true);

    // Обновляем состояние
    updateInteractivePostState(channelMessageId, 'waiting_positive', {
      user_schema_message_id: ctx.callbackQuery.message?.message_id,
    });

    // Получаем данные сообщения для генерации плюшек
    const messageData = post.message_data;

    // Отправляем слова поддержки + плюшки с новым текстом
    const supportText = scheduler.getRandomSupportText();
    const plushkiText = `<i>${supportText}</i>\n\n2. <b>Плюшки для лягушки</b>\n\nВспомни и напиши все приятное за день\nТут тоже опиши эмоции, которые ты испытал${'${:а}'} 😍`;

    // ✅ Определяем режим: ЛС или комментарии
    const isDmMode = post?.is_dm_mode ?? false;

    const sendOptions: any = {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: 'Таблица эмоций', callback_data: `emotions_table_${channelMessageId}` }]],
      },
    };

    // В режиме канала используем reply_to_message_id, в ЛС - нет
    if (!isDmMode && threadId) {
      sendOptions.reply_to_message_id = threadId;
    }

    const userId = ctx.from!.id;
    const task2Message = await callbackSendWithRetry(
      ctx,
      () => sendToUser({ telegram: ctx.telegram } as any, ctx.chat!.id, userId, plushkiText, sendOptions),
      'skip_emotions_plushki'
    );

    // Сохраняем ID сообщения с плюшками
    updateInteractivePostState(channelMessageId, 'waiting_positive', {
      bot_task2_message_id: task2Message.message_id,
    });

    // Сохраняем сообщение в историю
    saveMessage(ctx.from!.id, plushkiText, new Date().toISOString(), 0);

    botLogger.info({ channelMessageId, userId: ctx.from?.id }, 'Вопрос про эмоции пропущен, отправлены плюшки');
  } catch (error) {
    botLogger.error({ error: (error as Error).message }, 'Ошибка обработки skip_emotions');
    await ctx.answerCbQuery('Произошла ошибка. Попробуйте еще раз.');
  }
}