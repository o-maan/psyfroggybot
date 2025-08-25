import { botLogger } from '../../logger';
import type { BotContext } from '../../types';

// Обработчик кнопки "Отложить на 1 час" - новый формат
export async function handlePractDelay(ctx: BotContext) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const isTestBot = process.env.IS_TEST_BOT === 'true';

    await ctx.answerCbQuery('⏰ Хорошо, напомню через ' + (isTestBot ? '1 минуту' : 'час'));

    // Задержка: 1 минута для тестового бота, 60 минут для основного
    const PRACTICE_REMINDER_DELAY_MINUTES = isTestBot ? 1 : 60;
    const reminderDelayMs = PRACTICE_REMINDER_DELAY_MINUTES * 60 * 1000;

    botLogger.info(
      {
        action: 'pract_delay',
        channelMessageId,
        isTestBot,
        delayMinutes: PRACTICE_REMINDER_DELAY_MINUTES,
      },
      '⏰ Устанавливаем напоминание о практике'
    );

    // Отправляем сообщение о том, что ждем
    const waitMessage = isTestBot ? '⏳ Жду тебя через 1 минуту (тестовый режим)' : '⏳ Жду тебя через час';

    await ctx.telegram.sendMessage(ctx.chat!.id, waitMessage, {
      parse_mode: 'HTML',
      reply_parameters: {
        message_id: ctx.callbackQuery.message!.message_id,
      },
    });

    // Устанавливаем таймер на напоминание
    setTimeout(async () => {
      try {
        const reminderMessage = '⏰ Напоминание: пора сделать дыхательную практику! Это займет всего пару минут 💚';

        // Добавляем кнопку "Сделал" к напоминанию
        const practiceKeyboard = {
          inline_keyboard: [[{ text: '✅ Сделал', callback_data: `pract_done_${channelMessageId}` }]],
        };

        await ctx.telegram.sendMessage(ctx.chat!.id, reminderMessage, {
          parse_mode: 'HTML',
          reply_parameters: {
            message_id: ctx.callbackQuery.message!.message_id,
          },
          reply_markup: practiceKeyboard,
        });

        botLogger.info({ channelMessageId }, '✅ Напоминание о практике отправлено');
      } catch (error) {
        botLogger.error({ error: (error as Error).message }, 'Ошибка отправки напоминания');
      }
    }, reminderDelayMs);
  } catch (error) {
    botLogger.error({ error: (error as Error).message }, 'Ошибка обработки pract_delay');
  }
}