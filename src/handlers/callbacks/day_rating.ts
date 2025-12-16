import { botLogger } from '../../logger';
import type { BotContext } from '../../types';
import { getDayRatingSupportWord } from '../../utils/support-words';
import { callbackSendWithRetry } from '../../utils/telegram-retry';
import { sendToUser } from '../../utils/send-to-user';
import type { Telegraf } from 'telegraf';

// Обработчик кнопок оценки дня
export async function handleDayRating(ctx: BotContext, bot: Telegraf) {
  try {
    const match = ctx.match![0].split('_');
    const channelMessageId = parseInt(match[2]);
    const rating = parseInt(match[3]);
    const userId = ctx.from?.id;
    const threadId = 'message_thread_id' in ctx.callbackQuery.message! ? ctx.callbackQuery.message.message_thread_id : undefined;

    // Эмодзи для callback ответа
    const emojis = {
      1: '😩',
      2: '😔', 
      3: '😐',
      4: '😊',
      5: '🤩'
    };
    
    await ctx.answerCbQuery(`${emojis[rating as keyof typeof emojis]} Спасибо за оценку!`);

    botLogger.info(
      {
        action: 'day_rating',
        channelMessageId,
        rating,
        userId,
      },
      '📊 Получена оценка дня от пользователя'
    );

    // Получаем слова поддержки для этой оценки
    const supportText = await getDayRatingSupportWord(channelMessageId, rating);
    
    // Добавляем "Жду тебя завтра" к словам поддержки
    const fullText = supportText + '\nЖду тебя завтра';

    // ✅ Определяем режим: ЛС или комментарии
    const { getInteractivePost } = await import('../../db');
    const post = getInteractivePost(channelMessageId);
    const isDmMode = post?.is_dm_mode ?? false;

    // Отправляем слова поддержки
    const sendOptions: any = {
      parse_mode: 'HTML'
    };

    // В режиме канала используем reply_to_message_id, в ЛС - нет
    if (!isDmMode && threadId) {
      sendOptions.reply_to_message_id = threadId;
    }

    await callbackSendWithRetry(
      ctx,
      () => sendToUser(bot, ctx.chat!.id, userId!, fullText, sendOptions),
      'day_rating_support',
      { maxAttempts: 5, intervalMs: 3000 }
    );

    // Сохраняем оценку в БД
    const { db } = await import('../../db');
    try {
      const query = db.query(`
        SELECT * FROM interactive_posts WHERE channel_message_id = ?
      `);
      const post = query.get(channelMessageId) as any;
      
      if (post) {
        const messageData = post.message_data ? JSON.parse(post.message_data) : {};
        messageData.day_rating = rating;
        messageData.day_rating_time = new Date().toISOString();
        
        const update = db.query(`
          UPDATE interactive_posts
          SET message_data = ?
          WHERE channel_message_id = ?
        `);
        update.run(JSON.stringify(messageData), channelMessageId);
        
        botLogger.info({ channelMessageId, rating }, 'Оценка дня сохранена в БД');
      }
    } catch (error) {
      botLogger.error({ error, channelMessageId }, 'Ошибка сохранения оценки дня');
    }

  } catch (error) {
    botLogger.error({ error: (error as Error).message }, 'Ошибка обработки оценки дня');
  }
}