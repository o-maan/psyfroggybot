import { Telegraf } from 'telegraf';
import { botLogger } from '../logger';

// Отладка всех обновлений
export function registerDebugMiddleware(bot: Telegraf) {
  bot.use(async (ctx, next) => {
    const isDebug = process.env.NODE_ENV !== 'production';
    
    const logData: any = {
      updateType: ctx.updateType,
      chatId: ctx.chat?.id,
      from: ctx.from?.id,
      callbackQuery: ctx.callbackQuery ? true : false,
      message: ctx.message ? true : false,
    };

    // Добавляем детали для callback_query
    if (ctx.callbackQuery) {
      logData.callbackData = 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
      logData.callbackFrom = ctx.callbackQuery.from?.id;
      logData.callbackChatId = ctx.callbackQuery.message?.chat?.id;
    }

    // В режиме отладки добавляем подробную информацию о сообщении
    if (isDebug && ctx.message) {
      const msg = ctx.message as any;
      
      // Базовая информация о сообщении
      logData.messageDetails = {
        messageId: msg.message_id,
        date: msg.date,
        chatType: msg.chat?.type,
        chatTitle: msg.chat?.title,
        username: msg.from?.username,
        messageThreadId: msg.message_thread_id,
        replyToMessageId: msg.reply_to_message?.message_id,
      };

      // Проверяем тип контента
      if ('text' in msg) {
        logData.messageDetails.contentType = 'text';
        logData.messageDetails.textLength = msg.text.length;
        logData.messageDetails.textPreview = msg.text.substring(0, 100);
      } else if ('photo' in msg) {
        logData.messageDetails.contentType = 'photo';
        logData.messageDetails.photoCount = msg.photo.length;
        logData.messageDetails.photos = msg.photo.map((p: any) => ({
          file_id: p.file_id,
          file_unique_id: p.file_unique_id,
          width: p.width,
          height: p.height,
          file_size: p.file_size
        }));
        // Самое большое фото (последнее в массиве)
        const largestPhoto = msg.photo[msg.photo.length - 1];
        logData.messageDetails.largestPhotoFileId = largestPhoto?.file_id;
        logData.messageDetails.caption = msg.caption;
      } else if ('document' in msg) {
        logData.messageDetails.contentType = 'document';
        logData.messageDetails.document = {
          file_id: msg.document.file_id,
          file_unique_id: msg.document.file_unique_id,
          file_name: msg.document.file_name,
          mime_type: msg.document.mime_type,
          file_size: msg.document.file_size
        };
      } else if ('video' in msg) {
        logData.messageDetails.contentType = 'video';
        logData.messageDetails.video = {
          file_id: msg.video.file_id,
          file_unique_id: msg.video.file_unique_id,
          width: msg.video.width,
          height: msg.video.height,
          duration: msg.video.duration,
          file_size: msg.video.file_size
        };
      } else if ('voice' in msg) {
        logData.messageDetails.contentType = 'voice';
        logData.messageDetails.voice = {
          file_id: msg.voice.file_id,
          file_unique_id: msg.voice.file_unique_id,
          duration: msg.voice.duration,
          file_size: msg.voice.file_size
        };
      } else if ('sticker' in msg) {
        logData.messageDetails.contentType = 'sticker';
        logData.messageDetails.sticker = {
          file_id: msg.sticker.file_id,
          file_unique_id: msg.sticker.file_unique_id,
          width: msg.sticker.width,
          height: msg.sticker.height,
          emoji: msg.sticker.emoji,
          set_name: msg.sticker.set_name
        };
      } else {
        logData.messageDetails.contentType = 'other';
        logData.messageDetails.keys = Object.keys(msg).filter(k => !['chat', 'from', 'date', 'message_id'].includes(k));
      }
    }

    // Логируем с соответствующим уровнем
    if (isDebug) {
      botLogger.debug(logData, '📥 Получено обновление от Telegram (подробная информация)');
    } else {
      botLogger.info(logData, '📥 Получено обновление от Telegram');
    }
    
    return next();
  });
}