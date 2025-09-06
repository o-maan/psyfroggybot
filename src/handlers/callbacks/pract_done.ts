import { botLogger } from '../../logger';
import type { BotContext } from '../../types';
import type { Scheduler } from '../../scheduler';

// Обработчик кнопки "Сделал" для практики - новый формат
export async function handlePractDone(ctx: BotContext, scheduler: Scheduler) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const userId = ctx.from?.id;

    await ctx.answerCbQuery('🎉 Отлично! Ты молодец!');

    botLogger.info(
      {
        action: 'pract_done',
        channelMessageId,
        userId,
        chatId: ctx.chat?.id,
      },
      '🎯 Обработка кнопки practice_done'
    );

    // Получаем данные из БД
    const { getInteractivePost, updateTaskStatus, setTrophyStatus } = await import('../../db');
    const post = getInteractivePost(channelMessageId);

    if (!post) {
      botLogger.error({ channelMessageId }, 'Пост не найден в БД для practice_done, используем fallback');
      
      // Fallback: отправляем минимальное поздравление и оценку дня
      try {
        const fallbackText = 'Отлично! 🌟\n\n<b>Оцени свой день</b>';
        
        const ratingKeyboard = {
          inline_keyboard: [[
            { text: '😭', callback_data: `day_rating_${channelMessageId}_1` },
            { text: '😩', callback_data: `day_rating_${channelMessageId}_2` },
            { text: '🫤', callback_data: `day_rating_${channelMessageId}_3` },
            { text: '😊', callback_data: `day_rating_${channelMessageId}_4` },
            { text: '🤩', callback_data: `day_rating_${channelMessageId}_5` }
          ]]
        };
        
        await ctx.telegram.sendMessage(ctx.chat!.id, fallbackText, {
          parse_mode: 'HTML',
          reply_parameters: {
            message_id: ctx.callbackQuery.message!.message_id,
          },
          reply_markup: ratingKeyboard
        });
        
        botLogger.info({ channelMessageId }, 'Отправлен fallback для practice_done');
      } catch (fallbackError) {
        botLogger.error({ error: fallbackError }, 'Ошибка отправки fallback для practice_done');
      }
      return;
    }

    // Отмечаем третье задание выполненным
    updateTaskStatus(channelMessageId, 3, true);

    // Fallback сообщения поздравления
    const fallbacks = [
      'Ты молодец! 🌟 Сегодня мы отлично поработали вместе.',
      'Отличная работа! 💚 Ты заботишься о себе, и это прекрасно.',
      'Супер! ✨ Каждая практика делает тебя сильнее.',
      'Великолепно! 🌈 Ты сделал важный шаг для своего благополучия.',
      'Ты справился! 🎯 На сегодня все задания выполнены.',
      'Ты молодец! 🌙 Пора отдыхать.',
      'Я горжусь тобой! 💫 Ты сделал отличную работу.',
      'Отлично! 🌿 Все задания на сегодня завершены.',
      'Прекрасная работа! 🎉 Теперь можно расслабиться.',
    ];
    const congratsMessage = fallbacks[Math.floor(Math.random() * fallbacks.length)];

    // Слова поддержки уже сгенерированы при создании поста
    
    // Добавляем вопрос об оценке дня с кнопками
    const ratingMessage = congratsMessage + '\n\n<b>Оцени свой день</b>';
    
    const ratingKeyboard = {
      inline_keyboard: [[
        { text: '😭', callback_data: `day_rating_${channelMessageId}_1` },
        { text: '😩', callback_data: `day_rating_${channelMessageId}_2` },
        { text: '🫤', callback_data: `day_rating_${channelMessageId}_3` },
        { text: '😊', callback_data: `day_rating_${channelMessageId}_4` },
        { text: '🤩', callback_data: `day_rating_${channelMessageId}_5` }
      ]]
    };
    
    await ctx.telegram.sendMessage(ctx.chat!.id, ratingMessage, {
      parse_mode: 'HTML',
      reply_parameters: {
        message_id: ctx.callbackQuery.message!.message_id,
      },
      reply_markup: ratingKeyboard
    });

    // Добавляем реакцию трофея к посту в канале
    if (!post.trophy_set) {
      try {
        await ctx.telegram.setMessageReaction(scheduler.CHANNEL_ID, channelMessageId, [{ type: 'emoji', emoji: '🏆' }]);

        // Отмечаем в БД что трофей установлен
        setTrophyStatus(channelMessageId, true);

        botLogger.info(
          {
            channelMessageId,
            channelId: scheduler.CHANNEL_ID,
          },
          '🏆 Добавлена реакция трофея к посту в канале'
        );
      } catch (error) {
        botLogger.error(
          {
            error: (error as Error).message,
            channelMessageId,
            channelId: scheduler.CHANNEL_ID,
          },
          '❌ Ошибка добавления реакции к посту'
        );
      }
    }
  } catch (error) {
    botLogger.error({ error: (error as Error).message }, 'Ошибка обработки practice_done');
  }
}