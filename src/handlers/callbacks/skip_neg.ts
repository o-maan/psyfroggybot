import { botLogger } from '../../logger';
import type { BotContext } from '../../types';
import type { Telegraf } from 'telegraf';
import { scenarioSendWithRetry } from '../../utils/telegram-retry';
import { sendToUser } from '../../utils/send-to-user';

// Обработчик для кнопки пропуска первого задания - новый формат
export async function handleSkipNeg(ctx: BotContext, bot: Telegraf) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const messageId = ctx.callbackQuery.message?.message_id;
    const chatId = ctx.callbackQuery.message?.chat?.id;
    const userId = ctx.from?.id;
    const threadId = 'message_thread_id' in ctx.callbackQuery.message! ? ctx.callbackQuery.message.message_thread_id : undefined;

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

    // Останавливаем таймер напоминания если он есть
    const scheduler = (bot as any).scheduler;
    if (scheduler && userId) {
      const session = scheduler.interactiveSessions?.get(userId);
      if (session?.reminderTimeout) {
        clearTimeout(session.reminderTimeout);
        session.reminderTimeout = undefined;
        botLogger.info({ userId }, '⏰ Таймер напоминания остановлен при нажатии кнопки пропуска');
      }
    }

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
          const fallbackOptions: any = {
            parse_mode: 'HTML',
          };
          if (threadId) {
            fallbackOptions.reply_to_message_id = threadId;
          }
          await scenarioSendWithRetry(
            bot,
            chatId!,
            userId!,
            () => sendToUser(bot, chatId!, userId!, fallbackText, fallbackOptions),
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
        const fallbackOptions2: any = {
          parse_mode: 'HTML',
        };
        if (threadId) {
          fallbackOptions2.reply_to_message_id = threadId;
        }
        await scenarioSendWithRetry(
          bot,
          chatId!,
          userId!,
          () => sendToUser(bot, chatId!, userId!, fallbackText, fallbackOptions2),
          'skip_neg_fallback2',
          { maxAttempts: 3, intervalMs: 2000 }
        );
        return;
      }
    }

    // Проверяем, откуда вызвана кнопка "В другой раз"
    const isFromEmotionsClarification = post?.current_state === 'waiting_emotions_clarification';
    
    // Отмечаем первое задание как выполненное, только если это не уточнение эмоций
    if (!isFromEmotionsClarification) {
      updateTaskStatus(channelMessageId, 1, true);
    }

    // Формируем текст для плюшек
    let plushkiText: string;

    if (isFromEmotionsClarification) {
      // Если нажали "В другой раз" при уточнении эмоций - добавляем слова поддержки
      const supportText = scheduler ? scheduler.getRandomSupportText() : 'Спасибо, что поделился 💚';
      plushkiText = `<i>${supportText}</i>\n\n2. <b>Плюшки для лягушки</b>\n\nВспомни и напиши все приятное за день\nТут тоже опиши эмоции, которые ты испытал 😍`;
    } else {
      // Обычный пропуск первого задания
      plushkiText = '2. <b>Плюшки для лягушки</b>\n\nВспомни и напиши все приятное за день\nТут тоже опиши эмоции, которые ты испытал 😍';
    }
    
    if (post.message_data?.positive_part?.additional_text) {
      plushkiText += `\n\n<blockquote>${escapeHTML(post.message_data.positive_part.additional_text)}</blockquote>`;
    }

    const plushkiOptions: any = {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: 'Таблица эмоций', callback_data: `emotions_table_${channelMessageId}` }]],
      },
    };

    if (threadId) {
      plushkiOptions.reply_to_message_id = threadId;
    }

    const plushkiMessage = await scenarioSendWithRetry(
      bot,
      chatId!,
      userId!,
      () => sendToUser(bot, chatId!, userId!, plushkiText, plushkiOptions),
      'skip_neg_plushki'
    );

    // Обновляем текущее состояние поста, чтобы НЕ отправлять схему после пропуска
    // Используем 'waiting_positive' для совместимости с основной логикой
    updateInteractivePostState(channelMessageId, 'waiting_positive', {
      bot_task2_message_id: plushkiMessage.message_id,
    });

    // Устанавливаем/перезапускаем таймер напоминания о незавершенной работе
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