import type { BotContext } from '../../types';
import { botLogger } from '../../logger';
import { readFileSync } from 'fs';
import { callbackSendWithRetry } from '../../utils/telegram-retry';

// Обработчик кнопки "Помоги с эмоциями"
export async function handleHelpEmotions(ctx: BotContext) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const userId = ctx.from?.id;

    await ctx.answerCbQuery('💡 Показываю подсказку по эмоциям');

    botLogger.info(
      {
        action: 'help_emotions',
        channelMessageId,
        userId,
      },
      '💡 Запрошена помощь с эмоциями'
    );

    // Отправляем изображение с таблицей эмоций
    const emotionsTablePath = 'assets/images/emotions-table.png';
    const emotionsTableImage = readFileSync(emotionsTablePath);
    
    // Формируем текст для картинки
    const captionText = '<b>💡 Если пока сложно - используй основные эмоции:</b> ' +
                       '<i>радость, страх, злость, грусть, интерес, удивление, отвращение, стыд, вина</i>\n\n' +
                       'А затем, с помощью таблицы, старайся находить больше слов, которые могут описать то, что ты испытываешь\n' +
                       '<i>С каждым разом будет получаться все лучше 🙃</i>';
    
    // Получаем chatId и messageId из контекста для правильной отправки в комментарии
    const chatId = ctx.callbackQuery.message?.chat?.id!;
    const replyToMessageId = ctx.callbackQuery.message?.message_id;
    
    // Отправляем через telegram API с reply_to_message_id для работы в комментариях
    const sendOptions: any = {
      caption: captionText,
      parse_mode: 'HTML'
    };
    if (replyToMessageId) {
      sendOptions.reply_to_message_id = replyToMessageId;
    }
    
    await callbackSendWithRetry(
      ctx,
      () => ctx.telegram.sendPhoto(
        chatId,
        { source: emotionsTableImage },
        sendOptions
      ),
      'help_emotions_photo'
    );

  } catch (error) {
    botLogger.error({ error: (error as Error).message }, 'Ошибка показа помощи с эмоциями');
    
    // Фолбэк - отправляем текст с основными эмоциями
    try {
      const chatId = ctx.callbackQuery.message?.chat?.id!;
      const replyToMessageId = ctx.callbackQuery.message?.message_id;
      
      const fallbackText = '<b>💡 Если пока сложно - используй основные эмоции:</b>\n' +
                          '<i>радость, страх, злость, грусть, интерес, удивление, отвращение, стыд, вина</i>\n\n' +
                          '<i>P.S. Таблица эмоций не загрузилась, попробуй чуть позже</i>';
      
      const sendOptions: any = {
        parse_mode: 'HTML'
      };
      
      if (replyToMessageId) {
        sendOptions.reply_parameters = {
          message_id: replyToMessageId
        };
      }
      
      await callbackSendWithRetry(
        ctx,
        () => ctx.telegram.sendMessage(chatId, fallbackText, sendOptions),
        'help_emotions_fallback',
        { maxAttempts: 5, intervalMs: 3000 }
      );
      
    } catch (fallbackError) {
      botLogger.error({ fallbackError }, 'Ошибка отправки fallback сообщения для помощи с эмоциями');
    }
  }
}