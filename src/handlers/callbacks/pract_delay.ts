import { botLogger } from '../../logger';
import type { BotContext } from '../../types';

// Обработчик кнопки "Отложить на 1 час" - новый формат
export async function handlePractDelay(ctx: BotContext) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const threadId = 'message_thread_id' in ctx.callbackQuery.message! ? ctx.callbackQuery.message.message_thread_id : undefined;
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

    // ✅ Определяем режим: ЛС или комментарии
    const { getInteractivePost } = await import('../../db');
    const post = getInteractivePost(channelMessageId);
    const isDmMode = post?.is_dm_mode ?? false;

    // Отправляем сообщение о том, что ждем
    const waitMessage = isTestBot ? '⏳ Жду тебя через 1 минуту (тестовый режим)' : '⏳ Жду тебя через час';

    const sendOptions: any = {
      parse_mode: 'HTML'
    };

    // В режиме канала используем reply_to_message_id, в ЛС - нет
    if (!isDmMode && threadId) {
      sendOptions.reply_to_message_id = threadId;
    }

    await ctx.telegram.sendMessage(ctx.chat!.id, waitMessage, sendOptions);

    // Устанавливаем таймер на напоминание
    setTimeout(async () => {
      try {
        const reminderMessage = '⏰ Напоминание: пора сделать дыхательную практику! Это займет всего пару минут 💚';

        // Добавляем кнопку "Сделал" к напоминанию
        const { getUserByChatId } = require('../../db');
        const { getFixedText } = require('../../utils/send-to-user');
        const user = getUserByChatId(ctx.chat!.id);
        const userGender = (user?.gender || 'male') as 'male' | 'female' | 'unknown';
        const buttonText = getFixedText('button_practice_done', userGender) || '✅ Сделал';

        const practiceKeyboard = {
          inline_keyboard: [[{ text: buttonText, callback_data: `pract_done_${channelMessageId}` }]],
        };

        const reminderSendOptions: any = {
          parse_mode: 'HTML',
          reply_markup: practiceKeyboard,
        };

        // В режиме канала используем reply_to_message_id, в ЛС - нет
        if (!isDmMode && threadId) {
          reminderSendOptions.reply_to_message_id = threadId;
        }

        await ctx.telegram.sendMessage(ctx.chat!.id, reminderMessage, reminderSendOptions);

        botLogger.info({ channelMessageId }, '✅ Напоминание о практике отправлено');
      } catch (error) {
        botLogger.error({ error: (error as Error).message }, 'Ошибка отправки напоминания');
      }
    }, reminderDelayMs);
  } catch (error) {
    botLogger.error({ error: (error as Error).message }, 'Ошибка обработки pract_delay');
  }
}