import { botLogger } from '../../logger';
import type { BotContext } from '../../types';
import type { Scheduler } from '../../scheduler';

// Обработчик кнопки "Отложить на 1 час" - старый формат
export async function handlePracticePostpone(ctx: BotContext, scheduler: Scheduler) {
  botLogger.info(
    {
      action: 'practice_postpone',
      match: ctx.match,
      callbackData: 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : undefined,
      fromId: ctx.from?.id,
      chatId: ctx.chat?.id,
    },
    '⏰ Вызван обработчик practice_postpone'
  );

  try {
    const userId = parseInt(ctx.match![1]);
    const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

    await ctx.answerCbQuery('⏰ Хорошо, напомню через час');

    // Ищем сессию по adminChatId или userId
    const session = scheduler.getInteractiveSession(adminChatId) || scheduler.getInteractiveSession(userId);
    if (!session) {
      botLogger.warn({ userId, adminChatId }, 'Сессия не найдена для practice_postpone');
      return;
    }

    // Константа для задержки напоминания (легко изменить)
    const PRACTICE_REMINDER_DELAY_MINUTES = 60; // 60 минут для продакшена
    const reminderDelayMs = PRACTICE_REMINDER_DELAY_MINUTES * 60 * 1000;

    botLogger.info(
      {
        delayMinutes: PRACTICE_REMINDER_DELAY_MINUTES,
        delayMs: reminderDelayMs,
      },
      '⏰ Устанавливаем напоминание о практике'
    );

    // Сохраняем время откладывания
    session.practicePostponed = true;
    session.postponedUntil = Date.now() + reminderDelayMs;

    // Отправляем сообщение о том, что ждем через час
    try {
      const waitMessage =
        PRACTICE_REMINDER_DELAY_MINUTES === 60
          ? '⏳ Жду тебя через час'
          : `⏳ Жду тебя через ${PRACTICE_REMINDER_DELAY_MINUTES} ${
              PRACTICE_REMINDER_DELAY_MINUTES === 1 ? 'минуту' : 'минут'
            }`;

      // Получаем threadId для отправки БЕЗ видимого reply
      const threadId = 'message_thread_id' in ctx.callbackQuery.message! ? ctx.callbackQuery.message.message_thread_id : undefined;

      const waitOptions: any = {
        parse_mode: 'HTML',
      };

      if (threadId) {
        waitOptions.reply_to_message_id = threadId;
      }

      await ctx.telegram.sendMessage(ctx.chat!.id, waitMessage, waitOptions);

      botLogger.info({ userId }, '⏳ Отправлено сообщение ожидания');
    } catch (error) {
      botLogger.error({ error: (error as Error).message }, 'Ошибка отправки сообщения ожидания');
    }

    // Устанавливаем таймер на напоминание
    setTimeout(async () => {
      try {
        botLogger.info(
          {
            userId,
            chatId: ctx.chat?.id,
          },
          '🔔 Отправляем напоминание о практике'
        );

        const reminderMessage = '⏰ Напоминание: давай сделаем практику! Это займет всего несколько минут 💚';

        // Получаем threadId для отправки БЕЗ видимого reply
        const threadId = 'message_thread_id' in ctx.callbackQuery.message! ? ctx.callbackQuery.message.message_thread_id : undefined;

        const sendOptions: any = {
          parse_mode: 'HTML',
        };

        if (threadId) {
          sendOptions.reply_to_message_id = threadId;
        }

        await ctx.telegram.sendMessage(ctx.chat!.id, reminderMessage, sendOptions);

        botLogger.info({ userId }, '✅ Напоминание о практике отправлено');
      } catch (error) {
        botLogger.error({ error: (error as Error).message }, 'Ошибка отправки напоминания');
      }
    }, reminderDelayMs);
  } catch (error) {
    botLogger.error({ error: (error as Error).message }, 'Ошибка обработки practice_postpone');
  }
}