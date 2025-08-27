import type { BotContext } from '../../types';
import { botLogger } from '../../logger';
import { readFileSync } from 'fs';

// Обработчик кнопки "Таблица эмоций"
export async function handleEmotionsTable(ctx: BotContext) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const userId = ctx.from?.id;

    await ctx.answerCbQuery('📊 Показываю таблицу эмоций');

    botLogger.info(
      {
        action: 'emotions_table',
        channelMessageId,
        userId,
      },
      '📊 Запрошена таблица эмоций'
    );

    // Отправляем изображение с таблицей эмоций
    try {
      const emotionsTablePath = 'assets/images/emotions-table.jpg';
      const emotionsTableImage = readFileSync(emotionsTablePath);
      
      await ctx.replyWithPhoto(
        { source: emotionsTableImage },
        { 
          caption: '📊 <b>Таблица эмоций</b>\n\nИспользуй эту таблицу, чтобы точнее определить свои эмоции',
          parse_mode: 'HTML'
        }
      );
    } catch (imageError) {
      // Если изображения нет, отправляем текстовое описание
      await ctx.reply(
        `📊 <b>Основные эмоции:</b>\n\n` +
        `<b>Радость:</b> счастье, восторг, удовольствие, веселье\n` +
        `<b>Грусть:</b> печаль, тоска, уныние, разочарование\n` +
        `<b>Гнев:</b> злость, раздражение, ярость, возмущение\n` +
        `<b>Страх:</b> тревога, беспокойство, паника, ужас\n` +
        `<b>Удивление:</b> изумление, потрясение, шок\n` +
        `<b>Отвращение:</b> брезгливость, неприязнь, презрение\n\n` +
        `Опиши, что из этого ты чувствуешь`,
        { parse_mode: 'HTML' }
      );
    }

  } catch (error) {
    botLogger.error({ error: (error as Error).message }, 'Ошибка показа таблицы эмоций');
  }
}