import type { BotContext } from '../../types';
import { Telegraf } from 'telegraf';
import { botLogger } from '../../logger';

// Функция экранирования для HTML (Telegram)
function escapeHTML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Обработчик кнопки "Упрощенный сценарий"
export async function handleScenarioSimplified(ctx: BotContext, bot: Telegraf) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const messageId = ctx.callbackQuery.message?.message_id;
    const chatId = ctx.callbackQuery.message?.chat?.id;
    const userId = ctx.from?.id;

    await ctx.answerCbQuery('🧩 Отлично! Начинаем упрощенный сценарий');

    botLogger.info(
      {
        action: 'scenario_simplified',
        channelMessageId,
        messageId,
        chatId,
        userId,
      },
      '🔘 Выбран упрощенный сценарий'
    );

    // Получаем данные поста из БД
    const { getInteractivePost } = await import('../../db');
    const post = getInteractivePost(channelMessageId);
    if (!post) {
      botLogger.error({ channelMessageId }, 'Пост не найден в БД');
      return;
    }

    // Генерируем текст первого задания (как было в scheduler.ts)
    const firstTaskText = '1. <b>Выгрузка неприятных переживаний</b> (ситуация+эмоция)';
    let firstTaskFullText = firstTaskText;
    if (post.message_data?.negative_part?.additional_text) {
      firstTaskFullText += `\n<blockquote>${escapeHTML(post.message_data.negative_part.additional_text)}</blockquote>`;
    }

    // Кнопка пропуска
    const skipButtonTexts = [
      '😌 все ок - пропустить',
      '😊 у меня все хорошо - пропустить',
      '🌈 сегодня все отлично - пропустить',
      '✨ все супер - пропустить',
      '🌸 все в порядке - пропустить',
    ];
    const skipButtonText = skipButtonTexts[Math.floor(Math.random() * skipButtonTexts.length)];
    
    const firstTaskKeyboard = {
      inline_keyboard: [[{ text: skipButtonText, callback_data: `skip_neg_${channelMessageId}` }]],
    };

    // Отправляем первое задание
    const firstTaskMessage = await bot.telegram.sendMessage(chatId!, firstTaskFullText, {
      parse_mode: 'HTML',
      reply_markup: firstTaskKeyboard,
      reply_parameters: {
        message_id: messageId!,
      },
    });

    // Обновляем состояние поста
    const { updateInteractivePostState } = await import('../../db');
    updateInteractivePostState(channelMessageId, 'waiting_negative', {
      bot_task1_message_id: firstTaskMessage.message_id,
    });

    botLogger.info({ channelMessageId }, '✅ Первое задание упрощенного сценария отправлено');
  } catch (error) {
    botLogger.error({ error: (error as Error).message }, 'Ошибка обработки выбора упрощенного сценария');
  }
}