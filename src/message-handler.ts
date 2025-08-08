// Универсальный обработчик всех сообщений
// Работает поверх любой логики бота

import { Context } from 'telegraf';
import { trackUserMessage, trackBotMessage } from './interactive-tracker';
import { schedulerLogger } from './logger';

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
  if (ctx.message && 'text' in ctx.message && ctx.from && !ctx.from.is_bot) {
    const messageId = ctx.message.message_id;
    const userId = ctx.from.id;
    const messageText = ctx.message.text;
    const replyToMessageId = ctx.message.reply_to_message?.message_id;
    const messageThreadId = (ctx.message as any).message_thread_id;
    
    try {
      // Отслеживаем сообщение
      const context = await trackUserMessage(
        userId,
        messageId,
        messageText,
        replyToMessageId,
        messageThreadId
      );
      
      // Сохраняем контекст для использования в следующих обработчиках
      (ctx as any).dialogContext = context;
      
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
  const originalEditMessageText = bot.telegram.editMessageText.bind(bot.telegram);
  
  // Функция-обертка для отслеживания сообщений
  const trackSendMessage = async function(chatId: number, text: string, options?: any) {
    const result = await originalSendMessage(chatId, text, options);
    
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
  
  // Оборачиваем sendPhoto
  bot.telegram.sendPhoto = async function(chatId: number, photo: any, options?: any) {
    const result = await originalSendPhoto(chatId, photo, options);
    
    try {
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