import { botLogger } from '../../logger';
import type { BotContext } from '../../types';
import type { Telegraf } from 'telegraf';
import { scenarioSendWithRetry } from '../../utils/telegram-retry';

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
    const { getInteractivePost, updateTaskStatus, updateInteractivePostState, escapeHTML, saveInteractivePost } = await import('../../db');
    let post = getInteractivePost(channelMessageId);

    if (!post) {
      botLogger.warn({ channelMessageId }, 'Пост не найден в БД, используем fallback');
      
      // Fallback: создаем минимальную запись если её нет
      try {
        const defaultMessageData = {
          positive_part: { additional_text: null }, // Без дополнительного текста для плюшек
          feels_and_emotions: { additional_text: null }
        };
        
        saveInteractivePost(channelMessageId, userId!, defaultMessageData, 'breathing');
        post = getInteractivePost(channelMessageId);
        
        if (!post) {
          // Если всё равно не удалось - отправляем минимальный вариант напрямую
          const fallbackText = '2. <b>Плюшки для лягушки</b> (ситуация+эмоция)';
          await scenarioSendWithRetry(
            bot,
            chatId!,
            userId!,
            () => bot.telegram.sendMessage(chatId!, fallbackText, {
              parse_mode: 'HTML',
              reply_parameters: { message_id: messageId! },
            }),
            'skip_neg_fallback',
            { maxAttempts: 5, intervalMs: 3000 }
          );
          botLogger.error({ channelMessageId }, 'Критическая ошибка: не удалось создать пост в БД');
          return;
        }
      } catch (fallbackError) {
        botLogger.error({ error: fallbackError }, 'Ошибка создания fallback записи');
        // Отправляем хотя бы минимальный текст
        const fallbackText = '2. <b>Плюшки для лягушки</b> (ситуация+эмоция)';
        await scenarioSendWithRetry(
          bot,
          chatId!,
          userId!,
          () => bot.telegram.sendMessage(chatId!, fallbackText, {
            parse_mode: 'HTML',
            reply_parameters: { message_id: messageId! },
          }),
          'skip_neg_fallback2',
          { maxAttempts: 3, intervalMs: 2000 }
        );
        return;
      }
    }

    // Отмечаем первое задание как пропущенное
    updateTaskStatus(channelMessageId, 1, true);

    // Отправляем плюшки с новым текстом для упрощенного сценария
    let plushkiText = '2. <b>Плюшки для лягушки</b>\n\nВспомни и напиши все приятное за день\nТут тоже опиши эмоции, которые ты испытал 😍';
    if (post.message_data?.positive_part?.additional_text) {
      plushkiText += `\n\n<blockquote>${escapeHTML(post.message_data.positive_part.additional_text)}</blockquote>`;
    }

    const plushkiMessage = await scenarioSendWithRetry(
      bot,
      chatId!,
      userId!,
      () => bot.telegram.sendMessage(chatId!, plushkiText, {
        parse_mode: 'HTML',
        reply_parameters: {
          message_id: messageId!,
        },
        reply_markup: {
          inline_keyboard: [[{ text: 'Таблица эмоций', callback_data: `emotions_table_${channelMessageId}` }]],
        },
      }),
      'skip_neg_plushki'
    );

    // Обновляем текущее состояние поста, чтобы НЕ отправлять схему после пропуска
    // Используем 'waiting_positive' для совместимости с основной логикой
    updateInteractivePostState(channelMessageId, 'waiting_positive', {
      bot_task2_message_id: plushkiMessage.message_id,
    });

    // Устанавливаем/перезапускаем таймер напоминания о незавершенной работе
    const scheduler = (bot as any).scheduler;
    if (scheduler && userId) {
      scheduler.setIncompleteWorkReminder(userId, channelMessageId);
      botLogger.debug({ userId, channelMessageId }, '⏰ Таймер напоминания перезапущен после пропуска задания');
    }

    botLogger.info(
      { 
        channelMessageId,
        newState: 'waiting_positive',
        task2MessageId: plushkiMessage.message_id
      }, 
      '✅ Плюшки отправлены после пропуска, состояние обновлено'
    );
  } catch (error) {
    botLogger.error({ error: (error as Error).message }, 'Ошибка обработки кнопки пропуска');
  }
}