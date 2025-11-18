import { readFile } from 'fs/promises';
import type { BotContext } from '../../types';
import { botLogger } from '../../logger';
import { callbackSendWithRetry } from '../../utils/telegram-retry';

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
    const emotionsTablePath = 'assets/images/ТАБЛИЦА ЭМОЦИЙ.png';
    const emotionsTableImage = await readFile(emotionsTablePath);
    
    // Получаем chatId и threadId из контекста для правильной отправки в комментарии
    const chatId = ctx.callbackQuery.message?.chat?.id!;
    const threadId = 'message_thread_id' in ctx.callbackQuery.message! ? ctx.callbackQuery.message.message_thread_id : undefined;

    // Это СИСТЕМНОЕ сообщение - отправляем БЕЗ reply (просто в тред через threadId)
    const sendOptions: any = {};
    if (threadId) {
      sendOptions.reply_to_message_id = threadId;
    }
    
    await callbackSendWithRetry(
      ctx,
      () => ctx.telegram.sendPhoto(
        chatId,
        { source: emotionsTableImage },
        sendOptions
      ),
      'emotions_table_photo'
    );

  } catch (error) {
    botLogger.error({ error: (error as Error).message }, 'Ошибка показа таблицы эмоций');
    
    // Фолбэк - отправляем текст с основными эмоциями
    try {
      const chatId = ctx.callbackQuery.message?.chat?.id!;
      const threadId = 'message_thread_id' in ctx.callbackQuery.message! ? ctx.callbackQuery.message.message_thread_id : undefined;

      const fallbackText = 'Вот основные эмоции - грусть, радость, злость, страх, вина, стыд\n' +
                          'Попробуй описать ими или постарайся нащупать оттенки\n\n' +
                          '<i>P.S. Таблица эмоций не загрузилась, попробуй чуть позже</i>';

      // Это СИСТЕМНОЕ сообщение - отправляем БЕЗ reply (просто в тред через threadId)
      const sendOptions: any = {
        parse_mode: 'HTML'
      };

      if (threadId) {
        sendOptions.reply_to_message_id = threadId;
      }
      
      await callbackSendWithRetry(
        ctx,
        () => ctx.telegram.sendMessage(chatId, fallbackText, sendOptions),
        'emotions_table_fallback',
        { maxAttempts: 5, intervalMs: 3000 }
      );
      
    } catch (fallbackError) {
      botLogger.error({ fallbackError }, 'Ошибка отправки fallback сообщения для таблицы эмоций');
    }
  }
}