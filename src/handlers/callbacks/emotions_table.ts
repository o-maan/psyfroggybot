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
    const emotionsTablePath = 'assets/images/emotions-table.png';
    const emotionsTableImage = readFileSync(emotionsTablePath);
    
    // Получаем chatId и messageId из контекста для правильной отправки в комментарии
    const chatId = ctx.callbackQuery.message?.chat?.id!;
    const replyToMessageId = ctx.callbackQuery.message?.message_id;
    
    // Формируем текст для картинки
    const captionText = '<b>💡 Если пока сложно - используй основные эмоции:</b> ' +
                       '<i>радость, страх, злость, грусть, интерес, удивление, отвращение, стыд, вина</i>\n\n' +
                       'А затем, с помощью таблицы, старайся находить больше слов, которые могут описать то, что ты испытываешь\n' +
                       '<i>С каждым разом будет получаться все лучше 🙃</i>';
    
    // Отправляем через telegram API с reply_to_message_id для работы в комментариях
    const sendOptions: any = {
      caption: captionText,
      parse_mode: 'HTML'
    };
    if (replyToMessageId) {
      sendOptions.reply_to_message_id = replyToMessageId;
    }
    
    await ctx.telegram.sendPhoto(
      chatId,
      { source: emotionsTableImage },
      sendOptions
    );

  } catch (error) {
    botLogger.error({ error: (error as Error).message }, 'Ошибка показа таблицы эмоций');
    
    // Фолбэк - отправляем текст с основными эмоциями
    try {
      const chatId = ctx.callbackQuery.message?.chat?.id!;
      const replyToMessageId = ctx.callbackQuery.message?.message_id;
      
      const fallbackText = 'Вот основные эмоции - грусть, радость, злость, страх, вина, стыд\n' +
                          'Попробуй описать ими или постарайся нащупать оттенки\n\n' +
                          '<i>P.S. Таблица эмоций не загрузилась, попробуй чуть позже</i>';
      
      const sendOptions: any = {
        parse_mode: 'HTML'
      };
      
      if (replyToMessageId) {
        sendOptions.reply_parameters = {
          message_id: replyToMessageId
        };
      }
      
      await ctx.telegram.sendMessage(chatId, fallbackText, sendOptions);
      
    } catch (fallbackError) {
      botLogger.error({ fallbackError }, 'Ошибка отправки fallback сообщения для таблицы эмоций');
    }
  }
}