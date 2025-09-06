import { botLogger } from '../../logger';
import type { BotContext } from '../../types';
import { getDayRatingSupportWord } from '../../utils/support-words';

// Обработчик кнопок оценки дня
export async function handleDayRating(ctx: BotContext) {
  try {
    const match = ctx.match![0].split('_');
    const channelMessageId = parseInt(match[2]);
    const rating = parseInt(match[3]);
    const userId = ctx.from?.id;

    // Эмодзи для callback ответа
    const emojis = {
      1: '😭',
      2: '😩', 
      3: '🫤',
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

    // Отправляем слова поддержки
    await ctx.telegram.sendMessage(ctx.chat!.id, fullText, {
      parse_mode: 'HTML',
      reply_parameters: {
        message_id: ctx.callbackQuery.message!.message_id,
      },
    });

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