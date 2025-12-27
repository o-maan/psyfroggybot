// Универсальный обработчик всех сообщений
// Работает поверх любой логики бота

import { Context } from 'telegraf';
import { trackUserMessage, trackBotMessage } from './interactive-tracker';
import { schedulerLogger } from './logger';
import { sendWithRetry } from './utils/telegram-retry';
import { getUserByChatId } from './db';
import { parseGenderTemplate } from './utils/gender-template-parser';

// Автоматическая адаптация caption под пол пользователя
function adaptCaptionForGender(caption: string | undefined, chatId: number): string | undefined {
  if (!caption || !caption.includes('${')) return caption;

  const user = getUserByChatId(chatId);
  const gender = (user?.gender === 'male' || user?.gender === 'female') ? user.gender : 'unknown';
  return parseGenderTemplate(caption, gender).text;
}

// Определить тип сообщения по содержимому
function detectMessageType(text: string, options?: any): string {
  // Анализируем текст
  if (text.includes('Давай разложим самую беспокоящую ситуацию по схеме')) {
    return 'schema';
  }
  
  if (text.includes('У нас остался последний шаг')) {
    return 'task3';
  }
  
  if (text.includes('Выгрузка неприятных переживаний') || text.includes('Расскажи о ситуации')) {
    return 'task1';
  }
  
  if (text.includes('Плюшки для лягушки')) {
    return 'task2';
  }
  
  // Проверяем кнопки
  if (options?.reply_markup?.inline_keyboard) {
    const buttons = options.reply_markup.inline_keyboard.flat();
    if (buttons.some((b: any) => b.callback_data?.includes('pract_'))) {
      return 'task3';
    }
    if (buttons.some((b: any) => b.callback_data?.includes('skip_task'))) {
      return 'task1';
    }
    if (buttons.some((b: any) => b.callback_data?.includes('skip_schema'))) {
      return 'schema';
    }
  }
  
  return 'other';
}

// Middleware для отслеживания ВСЕХ входящих сообщений от пользователей
export async function trackIncomingMessage(ctx: Context, next: () => Promise<void>) {
  // Оборачиваем ctx.reply для отслеживания ответов
  if (ctx.reply && !(ctx.reply as any)._wrapped) {
    const originalReply = ctx.reply.bind(ctx);
    ctx.reply = async function(text: string, options?: any) {
      const result = await originalReply(text, options);
      
      try {
        const messageType = detectMessageType(text, options);
        const chatId = ctx.chat?.id || ctx.from?.id || 0;
        
        await trackBotMessage(
          result.message_id,
          chatId,
          messageType,
          options?.reply_to_message_id || ctx.message?.message_id
        );
        
        schedulerLogger.debug({
          messageId: result.message_id,
          chatId,
          messageType,
          method: 'ctx.reply'
        }, '📤 Отслежено исходящее сообщение (ctx.reply)');
        
      } catch (error) {
        schedulerLogger.error({ error }, 'Ошибка отслеживания ctx.reply');
      }
      
      return result;
    };
    (ctx.reply as any)._wrapped = true;
  }
  
  // Отслеживаем входящие сообщения
  if (ctx.message && ctx.from && !ctx.from.is_bot) {
    const messageId = ctx.message.message_id;
    const userId = ctx.from.id;
    const replyToMessageId = ctx.message.reply_to_message?.message_id;
    const messageThreadId = (ctx.message as any).message_thread_id;
    
    // Определяем тип сообщения и контент
    let messageContent = '';
    let messageType = 'unknown';
    
    if ('text' in ctx.message) {
      messageContent = ctx.message.text;
      messageType = 'text';
    } else if ('photo' in ctx.message) {
      const largestPhoto = ctx.message.photo[ctx.message.photo.length - 1];
      messageContent = `[Фото: ${largestPhoto.file_id}]`;
      if (ctx.message.caption) {
        messageContent += ` ${ctx.message.caption}`;
      }
      messageType = 'photo';
      
      // Логируем подробности фото в debug режиме
      if (process.env.NODE_ENV !== 'production') {
        schedulerLogger.debug({
          userId,
          messageId,
          photoCount: ctx.message.photo.length,
          photos: ctx.message.photo.map(p => ({
            file_id: p.file_id,
            file_unique_id: p.file_unique_id,
            width: p.width,
            height: p.height,
            file_size: p.file_size
          })),
          caption: ctx.message.caption,
          largestPhotoFileId: largestPhoto.file_id
        }, '📸 Получено фото от пользователя');
      }
    } else if ('document' in ctx.message) {
      messageContent = `[Документ: ${ctx.message.document.file_name || ctx.message.document.file_id}]`;
      messageType = 'document';
    } else if ('video' in ctx.message) {
      messageContent = `[Видео: ${ctx.message.video.file_id}]`;
      messageType = 'video';
    } else if ('voice' in ctx.message) {
      messageContent = `[Голосовое: ${ctx.message.voice.duration}с]`;
      messageType = 'voice';
    } else if ('sticker' in ctx.message) {
      messageContent = `[Стикер: ${ctx.message.sticker.emoji || ctx.message.sticker.file_id}]`;
      messageType = 'sticker';
    }
    
    try {
      // Отслеживаем сообщение только если есть контент
      if (messageContent) {
        const context = await trackUserMessage(
          userId,
          messageId,
          messageContent,
          replyToMessageId,
          messageThreadId,
          ctx.chat?.type
        );

        // Сохраняем контекст для использования в следующих обработчиках
        (ctx as any).dialogContext = context;
        (ctx as any).messageContentType = messageType;
      }
      
    } catch (error) {
      schedulerLogger.error({ error, messageId, userId }, 'Ошибка отслеживания входящего сообщения');
    }
  }
  
  return next();
}

// Обертка для sendMessage чтобы отслеживать ВСЕ исходящие сообщения
export function wrapTelegramApi(bot: any) {
  const originalSendMessage = bot.telegram.sendMessage.bind(bot.telegram);
  const originalSendPhoto = bot.telegram.sendPhoto.bind(bot.telegram);
  const originalSendVideo = bot.telegram.sendVideo.bind(bot.telegram);
  const originalSendDocument = bot.telegram.sendDocument.bind(bot.telegram);
  const originalSendMediaGroup = bot.telegram.sendMediaGroup.bind(bot.telegram);
  const originalSendChatAction = bot.telegram.sendChatAction.bind(bot.telegram);
  const originalEditMessageText = bot.telegram.editMessageText.bind(bot.telegram);
  
  // Функция-обертка для отслеживания сообщений с retry защитой
  const trackSendMessage = async function(chatId: number, text: string, options?: any) {
    // Показываем индикатор набора текста
    try {
      await originalSendChatAction(chatId, 'typing');
    } catch (error) {
      // Не критично
    }

    // 🛡️ Оборачиваем в sendWithRetry для автоматических повторов при сетевых ошибках
    const result = await sendWithRetry(
      async () => await originalSendMessage(chatId, text, options),
      {
        chatId,
        messageType: 'text_message',
      },
      { maxAttempts: 3, intervalMs: 5000 }
    );

    try {
      // Определяем тип сообщения по тексту и контексту
      const messageType = detectMessageType(text, options);
      const replyToMessageId = options?.reply_parameters?.message_id;

      // Отслеживаем сообщение бота
      await trackBotMessage(
        result.message_id,
        chatId,
        messageType,
        replyToMessageId
      );

      schedulerLogger.debug({
        messageId: result.message_id,
        chatId,
        messageType,
        textPreview: text.substring(0, 30)
      }, '📤 Отслежено исходящее сообщение');

    } catch (error) {
      schedulerLogger.error({ error, messageId: result.message_id }, 'Ошибка отслеживания исходящего сообщения');
    }

    return result;
  };
  
  // Оборачиваем sendMessage
  bot.telegram.sendMessage = trackSendMessage;
  
  // Оборачиваем sendPhoto с retry и IMAGE_INVALID защитой
  bot.telegram.sendPhoto = async function(chatId: number, photo: any, options?: any) {
    // Логируем отправку фото в debug режиме
    if (process.env.NODE_ENV !== 'production') {
      schedulerLogger.debug({
        chatId,
        photoType: typeof photo,
        photoId: typeof photo === 'string' ? photo : 'Buffer/Stream',
        caption: options?.caption,
        reply_to_message_id: options?.reply_to_message_id,
        reply_parameters: options?.reply_parameters,
        message_thread_id: options?.message_thread_id
      }, '📤 Отправка фото');
    }

    // Показываем индикатор загрузки фото
    try {
      await originalSendChatAction(chatId, 'upload_photo');
    } catch (error) {
      // Не критично
    }

    // ✅ Автоматическая gender-адаптация caption
    if (options?.caption) {
      options = { ...options, caption: adaptCaptionForGender(options.caption, chatId) };
    }

    // 🛡️ Оборачиваем в sendWithRetry с IMAGE_INVALID detection
    const result = await sendWithRetry(
      async () => {
        try {
          return await originalSendPhoto(chatId, photo, options);
        } catch (sendError: any) {
          // Детектируем ошибки валидации изображения и конвертируем их в ETELEGRAM для retry
          if (
            sendError.message?.includes('IMAGE_PROCESS_FAILED') ||
            sendError.message?.includes('PHOTO_INVALID') ||
            sendError.message?.includes('PHOTO_SAVE_FILE_INVALID') ||
            sendError.message?.includes('Bad Request: wrong file')
          ) {
            throw new Error(`ETELEGRAM: IMAGE_INVALID - ${sendError.message}`);
          }
          throw sendError;
        }
      },
      {
        chatId,
        messageType: 'photo',
      },
      { maxAttempts: 3, intervalMs: 5000 }
    );

    try {
      // Логируем результат отправки
      if (process.env.NODE_ENV !== 'production') {
        schedulerLogger.debug({
          messageId: result.message_id,
          chatId: result.chat.id,
          photoFileId: result.photo?.[result.photo.length - 1]?.file_id,
          caption: result.caption
        }, '✅ Фото успешно отправлено');
      }

      // Фото обычно отправляется как основной пост
      await trackBotMessage(
        result.message_id,
        chatId,
        'channel_post',
        undefined,
        result.message_id // используем как channelMessageId
      );

    } catch (error) {
      schedulerLogger.error({ error, messageId: result.message_id }, 'Ошибка отслеживания фото');
    }

    return result;
  };
  
  // Оборачиваем sendVideo с retry и VIDEO_INVALID защитой
  bot.telegram.sendVideo = async function(chatId: number, video: any, options?: any) {
    // Показываем индикатор загрузки видео
    try {
      await originalSendChatAction(chatId, 'upload_video');
    } catch (error) {
      // Не критично
    }

    // ✅ Автоматическая gender-адаптация caption
    if (options?.caption) {
      options = { ...options, caption: adaptCaptionForGender(options.caption, chatId) };
    }

    // 🛡️ Оборачиваем в sendWithRetry с VIDEO_INVALID detection
    return await sendWithRetry(
      async () => {
        try {
          return await originalSendVideo(chatId, video, options);
        } catch (sendError: any) {
          // Детектируем ошибки валидации видео и конвертируем их в ETELEGRAM для retry
          if (
            sendError.message?.includes('VIDEO_PROCESS_FAILED') ||
            sendError.message?.includes('VIDEO_INVALID') ||
            sendError.message?.includes('VIDEO_FILE_INVALID') ||
            sendError.message?.includes('Bad Request: wrong file')
          ) {
            throw new Error(`ETELEGRAM: VIDEO_INVALID - ${sendError.message}`);
          }
          throw sendError;
        }
      },
      {
        chatId,
        messageType: 'video',
      },
      { maxAttempts: 3, intervalMs: 5000 }
    );
  };
  
  // Оборачиваем sendDocument с retry защитой
  bot.telegram.sendDocument = async function(chatId: number, document: any, options?: any) {
    // Показываем индикатор загрузки документа
    try {
      await originalSendChatAction(chatId, 'upload_document');
    } catch (error) {
      // Не критично
    }

    // 🛡️ Оборачиваем в sendWithRetry
    return await sendWithRetry(
      async () => await originalSendDocument(chatId, document, options),
      {
        chatId,
        messageType: 'document',
      },
      { maxAttempts: 3, intervalMs: 5000 }
    );
  };
  
  // Оборачиваем sendMediaGroup с retry защитой
  bot.telegram.sendMediaGroup = async function(chatId: number, media: any, options?: any) {
    // Показываем индикатор загрузки фото
    try {
      await originalSendChatAction(chatId, 'upload_photo');
    } catch (error) {
      // Не критично
    }

    // ✅ Автоматическая gender-адаптация caption в каждом элементе media
    if (Array.isArray(media)) {
      media = media.map(item => {
        if (item.caption) {
          return { ...item, caption: adaptCaptionForGender(item.caption, chatId) };
        }
        return item;
      });
    }

    // 🛡️ Оборачиваем в sendWithRetry с MEDIA_INVALID detection
    return await sendWithRetry(
      async () => {
        try {
          return await originalSendMediaGroup(chatId, media, options);
        } catch (sendError: any) {
          // Детектируем ошибки валидации медиа и конвертируем их в ETELEGRAM для retry
          if (
            sendError.message?.includes('IMAGE_PROCESS_FAILED') ||
            sendError.message?.includes('VIDEO_PROCESS_FAILED') ||
            sendError.message?.includes('PHOTO_INVALID') ||
            sendError.message?.includes('VIDEO_INVALID') ||
            sendError.message?.includes('MEDIA_INVALID') ||
            sendError.message?.includes('Bad Request: wrong file')
          ) {
            throw new Error(`ETELEGRAM: MEDIA_INVALID - ${sendError.message}`);
          }
          throw sendError;
        }
      },
      {
        chatId,
        messageType: 'media_group',
      },
      { maxAttempts: 3, intervalMs: 5000 }
    );
  };
  
  // Оборачиваем editMessageText
  bot.telegram.editMessageText = async function(chatId: any, messageId: any, inlineMessageId: any, text: string, options?: any) {
    // Если параметры сдвинуты (Telegraf иногда так делает)
    if (typeof chatId === 'string' && !messageId && !inlineMessageId) {
      return originalEditMessageText(chatId, messageId, inlineMessageId, text, options);
    }
    
    const result = await originalEditMessageText(chatId, messageId, inlineMessageId, text, options);
    
    // Редактирование тоже можно отслеживать при необходимости
    
    return result;
  };
  
  return bot;
}

// Функция для восстановления контекста по сообщению
export async function getMessageContext(messageId: number, userId: number) {
  // Пытаемся найти контекст разными способами
  const { db } = await import('./db');
  
  // 1. Проверяем в message_links
  const linkQuery = db.query(`
    SELECT ml.*, ip.*
    FROM message_links ml
    JOIN interactive_posts ip ON ml.channel_message_id = ip.channel_message_id
    WHERE ml.message_id = ? AND (ml.user_id = ? OR ml.user_id = 0)
    ORDER BY ml.created_at DESC
    LIMIT 1
  `);
  
  const link = linkQuery.get(messageId, userId) as any;
  if (link) {
    return {
      post: link,
      messageType: link.message_type,
      channelMessageId: link.channel_message_id
    };
  }
  
  // 2. Проверяем в основной таблице
  const { getInteractivePostByUserMessage, getInteractivePostByBotMessage } = await import('./db');
  
  const postByUser = getInteractivePostByUserMessage(messageId);
  if (postByUser && postByUser.user_id === userId) {
    return {
      post: postByUser,
      messageType: 'user',
      channelMessageId: postByUser.channel_message_id
    };
  }
  
  const postByBot = getInteractivePostByBotMessage(messageId);
  if (postByBot) {
    return {
      post: postByBot,
      messageType: 'bot',
      channelMessageId: postByBot.channel_message_id
    };
  }
  
  return null;
}