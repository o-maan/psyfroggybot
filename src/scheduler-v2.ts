// Новая версия обработки интерактивных сообщений с полным отслеживанием ID

import { schedulerLogger } from './logger';
import { 
  updateInteractivePostState, 
  getInteractivePostByUserMessage,
  getInteractivePostByBotMessage,
  getUncompletedPostsWithState,
  saveMessage,
  updateTaskStatus
} from './db';

// Определить на какое сообщение отвечает пользователь
export async function determineUserResponse(
  userId: number,
  messageId: number,
  replyToMessageId?: number,
  messageThreadId?: number
) {
  schedulerLogger.info({
    userId,
    messageId,
    replyToMessageId,
    messageThreadId
  }, '🔍 Определяем на что отвечает пользователь');

  // 1. Если есть реплай - ищем по ID сообщения бота
  if (replyToMessageId) {
    const postByReply = getInteractivePostByBotMessage(replyToMessageId);
    if (postByReply && postByReply.user_id === userId) {
      schedulerLogger.info({
        channelMessageId: postByReply.channel_message_id,
        currentState: postByReply.current_state,
        replyTo: replyToMessageId
      }, '✅ Найден пост по реплаю');
      
      return {
        post: postByReply,
        responseType: determineResponseTypeByBotMessage(postByReply, replyToMessageId)
      };
    }
  }

  // 2. Ищем последний незавершенный пост пользователя
  const { getUserIncompletePosts } = await import('./db');
  const incompletePosts = getUserIncompletePosts(userId);
  
  if (incompletePosts.length > 0) {
    const lastPost = incompletePosts[0];
    schedulerLogger.info({
      channelMessageId: lastPost.channel_message_id,
      currentState: lastPost.current_state
    }, '✅ Найден незавершенный пост пользователя');
    
    return {
      post: lastPost,
      responseType: lastPost.current_state
    };
  }

  schedulerLogger.info({ userId }, '❌ Не найдено активных постов');
  return null;
}

// Определить тип ответа по ID сообщения бота
function determineResponseTypeByBotMessage(post: any, botMessageId: number): string {
  if (post.bot_task1_message_id === botMessageId) {
    return 'waiting_schema'; // Ответ на первое задание
  } else if (post.bot_schema_message_id === botMessageId) {
    return 'waiting_task2'; // Ответ на схему
  } else if (post.bot_task2_message_id === botMessageId) {
    return 'waiting_task3'; // Ответ на плюшки
  } else if (post.bot_task3_message_id === botMessageId) {
    return 'waiting_practice'; // Ответ на финальное задание
  }
  
  // Если не нашли - возвращаем текущее состояние
  return post.current_state || 'waiting_task1';
}

// Обработать ответ пользователя с учетом состояния
export async function processUserResponse(
  scheduler: any,
  userId: number,
  messageText: string,
  messageId: number,
  replyToChatId: number,
  replyToMessageId?: number,
  messageThreadId?: number
) {
  const responseInfo = await determineUserResponse(userId, messageId, replyToMessageId, messageThreadId);
  
  if (!responseInfo) {
    return false;
  }

  const { post, responseType } = responseInfo;
  const channelMessageId = post.channel_message_id;

  schedulerLogger.info({
    userId,
    channelMessageId,
    responseType,
    messageText: messageText.substring(0, 50)
  }, '📝 Обрабатываем ответ пользователя');

  switch (responseType) {
    case 'waiting_task1':
    case 'waiting_schema':
      // Пользователь ответил на первое задание
      await handleFirstTaskResponse(scheduler, post, userId, messageId, messageText, replyToChatId);
      break;
      
    case 'waiting_task2':
      // Пользователь ответил на схему разбора
      await handleSchemaResponse(scheduler, post, userId, messageId, messageText, replyToChatId);
      break;
      
    case 'waiting_task3':
      // Пользователь ответил на плюшки
      await handleSecondTaskResponse(scheduler, post, userId, messageId, messageText, replyToChatId);
      break;
      
    default:
      schedulerLogger.warn({ responseType }, 'Неизвестный тип ответа');
      return false;
  }

  return true;
}

// Обработка ответа на первое задание
async function handleFirstTaskResponse(
  scheduler: any,
  post: any,
  userId: number,
  userMessageId: number,
  messageText: string,
  replyToChatId: number
) {
  const channelMessageId = post.channel_message_id;
  
  // Сохраняем ID сообщения пользователя
  updateInteractivePostState(channelMessageId, 'waiting_schema', {
    user_task1_message_id: userMessageId
  });

  // Отправляем схему разбора
  const responseText = `Давай разложим самую беспокоящую ситуацию по схеме: Триггер - мысли - чувства - тело - действия`;
  
  const schemaMessage = await scheduler.bot.telegram.sendMessage(replyToChatId, responseText, {
    parse_mode: 'HTML',
    reply_parameters: {
      message_id: userMessageId
    }
  });

  // Сохраняем ID сообщения со схемой
  updateInteractivePostState(channelMessageId, 'waiting_schema', {
    bot_schema_message_id: schemaMessage.message_id
  });

  saveMessage(userId, responseText, new Date().toISOString(), 0);
  
  schedulerLogger.info({
    userId,
    channelMessageId,
    schemaMessageId: schemaMessage.message_id
  }, '✅ Отправлена схема разбора');
}

// Обработка ответа на схему
async function handleSchemaResponse(
  scheduler: any,
  post: any,
  userId: number,
  userMessageId: number,
  messageText: string,
  replyToChatId: number
) {
  const channelMessageId = post.channel_message_id;
  
  // Сохраняем ID сообщения пользователя и обновляем статус первого задания
  updateInteractivePostState(channelMessageId, 'waiting_task2', {
    user_schema_message_id: userMessageId
  });
  
  // Теперь отмечаем первое задание как выполненное
  updateTaskStatus(channelMessageId, 1, true);

  // Отправляем слова поддержки + плюшки
  const supportText = scheduler.getRandomSupportText();
  const responseText = `<i>${supportText}</i>\n\n${scheduler.buildSecondPart(post.message_data)}`;
  
  const task2Message = await scheduler.bot.telegram.sendMessage(replyToChatId, responseText, {
    parse_mode: 'HTML',
    reply_parameters: {
      message_id: userMessageId
    }
  });

  // Сохраняем ID сообщения с плюшками
  updateInteractivePostState(channelMessageId, 'waiting_task2', {
    bot_task2_message_id: task2Message.message_id
  });

  saveMessage(userId, responseText, new Date().toISOString(), 0);
  
  schedulerLogger.info({
    userId,
    channelMessageId,
    task2MessageId: task2Message.message_id
  }, '✅ Отправлены плюшки');
}

// Обработка ответа на плюшки
async function handleSecondTaskResponse(
  scheduler: any,
  post: any,
  userId: number,
  userMessageId: number,
  messageText: string,
  replyToChatId: number
) {
  const channelMessageId = post.channel_message_id;
  
  // Сохраняем ID сообщения пользователя и обновляем статус второго задания
  updateInteractivePostState(channelMessageId, 'waiting_task3', {
    user_task2_message_id: userMessageId
  });
  
  updateTaskStatus(channelMessageId, 2, true);

  // Отправляем финальное задание
  let finalMessage = 'У нас остался последний шаг\n\n';
  if (post.relaxation_type === 'body') {
    finalMessage += '3. <b>Расслабление тела</b>\nОт Ирины 👉🏻 clck.ru/3LmcNv 👈🏻 или свое';
  } else {
    finalMessage += '3. <b>Дыхательная практика</b>';
  }
  
  const practiceKeyboard = {
    inline_keyboard: [
      [{ text: '✅ Сделал', callback_data: `pract_done_${channelMessageId}` }],
      [{ text: '⏰ Отложить на 1 час', callback_data: `pract_delay_${channelMessageId}` }]
    ]
  };

  const task3Message = await scheduler.bot.telegram.sendMessage(replyToChatId, finalMessage, {
    parse_mode: 'HTML',
    reply_markup: practiceKeyboard,
    reply_parameters: {
      message_id: userMessageId
    }
  });

  // Сохраняем ID финального сообщения
  updateInteractivePostState(channelMessageId, 'waiting_task3', {
    bot_task3_message_id: task3Message.message_id
  });

  saveMessage(userId, finalMessage, new Date().toISOString(), 0);
  
  schedulerLogger.info({
    userId,
    channelMessageId,
    task3MessageId: task3Message.message_id
  }, '✅ Отправлено финальное задание');
}

// Новая версия checkUncompletedTasks
export async function checkUncompletedTasksV2(scheduler: any) {
  try {
    schedulerLogger.info('🔍 Проверка незавершенных заданий V2...');
    
    const uncompletedPosts = getUncompletedPostsWithState();
    
    schedulerLogger.info({ 
      count: uncompletedPosts.length
    }, `Найдено ${uncompletedPosts.length} незавершенных постов`);
    
    for (const post of uncompletedPosts) {
      try {
        await processUncompletedPost(scheduler, post);
        
        // Небольшая задержка между обработками
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        schedulerLogger.error({ 
          error, 
          postId: post.channel_message_id 
        }, 'Ошибка обработки незавершенного поста');
      }
    }
    
    schedulerLogger.info('✅ Проверка незавершенных заданий V2 завершена');
    
  } catch (error) {
    schedulerLogger.error({ error }, 'Ошибка проверки незавершенных заданий V2');
  }
}

// Обработать один незавершенный пост
async function processUncompletedPost(scheduler: any, post: any) {
  const userId = post.user_id;
  const channelMessageId = post.channel_message_id;
  const currentState = post.current_state || 'waiting_task1';
  const CHAT_ID = scheduler.getChatId();
  
  schedulerLogger.info({
    userId,
    channelMessageId,
    currentState,
    lastInteraction: post.last_interaction_at
  }, '📋 Обработка незавершенного поста');

  // Определяем что нужно отправить
  switch (currentState) {
    case 'waiting_task1':
      // Пользователь еще не ответил на первое задание
      // Ничего не делаем - ждем ответа
      schedulerLogger.info({ channelMessageId }, 'Ждем ответа на первое задание');
      break;
      
    case 'waiting_schema':
      // Пользователь ответил на первое задание, но бот не отправил схему
      // Отправляем схему
      await sendPendingSchema(scheduler, post, CHAT_ID);
      break;
      
    case 'waiting_task2':
      // Пользователь ответил на схему, но бот не отправил плюшки
      // Отправляем плюшки
      await sendPendingTask2(scheduler, post, CHAT_ID);
      break;
      
    case 'waiting_task3':
      // Пользователь ответил на плюшки, но бот не отправил финальное задание
      // Отправляем финальное задание
      await sendPendingTask3(scheduler, post, CHAT_ID);
      break;
  }
}

// Отправить схему разбора для незавершенного поста
async function sendPendingSchema(scheduler: any, post: any, chatId: number) {
  const channelMessageId = post.channel_message_id;
  const threadId = post.thread_id;
  
  const responseText = `Давай разложим самую беспокоящую ситуацию по схеме: Триггер - мысли - чувства - тело - действия`;
  
  const sendOptions: any = {
    parse_mode: 'HTML'
  };
  
  if (threadId) {
    sendOptions.reply_to_message_id = threadId;
  }
  
  const message = await scheduler.bot.telegram.sendMessage(chatId, responseText, sendOptions);
  
  // Сохраняем ID отправленного сообщения
  updateInteractivePostState(channelMessageId, 'waiting_schema', {
    bot_schema_message_id: message.message_id
  });
  
  schedulerLogger.info({ 
    channelMessageId,
    schemaMessageId: message.message_id
  }, '✅ Отправлена схема разбора для незавершенного задания');
}

// Отправить плюшки для незавершенного поста
async function sendPendingTask2(scheduler: any, post: any, chatId: number) {
  const channelMessageId = post.channel_message_id;
  const threadId = post.thread_id;
  
  // Отмечаем первое задание как выполненное
  updateTaskStatus(channelMessageId, 1, true);
  
  const supportText = scheduler.getRandomSupportText();
  const responseText = `<i>${supportText}</i>\n\n${scheduler.buildSecondPart(post.message_data)}`;
  
  const sendOptions: any = {
    parse_mode: 'HTML'
  };
  
  if (threadId) {
    sendOptions.reply_to_message_id = threadId;
  }
  
  const message = await scheduler.bot.telegram.sendMessage(chatId, responseText, sendOptions);
  
  updateInteractivePostState(channelMessageId, 'waiting_task2', {
    bot_task2_message_id: message.message_id
  });
  
  schedulerLogger.info({ 
    channelMessageId,
    task2MessageId: message.message_id
  }, '✅ Отправлены плюшки для незавершенного задания');
}

// Отправить финальное задание для незавершенного поста
async function sendPendingTask3(scheduler: any, post: any, chatId: number) {
  const channelMessageId = post.channel_message_id;
  const threadId = post.thread_id;
  
  // Отмечаем второе задание как выполненное
  updateTaskStatus(channelMessageId, 2, true);
  
  let finalMessage = 'У нас остался последний шаг\n\n';
  if (post.relaxation_type === 'body') {
    finalMessage += '3. <b>Расслабление тела</b>\nОт Ирины 👉🏻 clck.ru/3LmcNv 👈🏻 или свое';
  } else {
    finalMessage += '3. <b>Дыхательная практика</b>';
  }
  
  const practiceKeyboard = {
    inline_keyboard: [
      [{ text: '✅ Сделал', callback_data: `pract_done_${channelMessageId}` }],
      [{ text: '⏰ Отложить на 1 час', callback_data: `pract_delay_${channelMessageId}` }]
    ]
  };
  
  const sendOptions: any = {
    parse_mode: 'HTML',
    reply_markup: practiceKeyboard
  };
  
  if (threadId) {
    sendOptions.reply_to_message_id = threadId;
  }
  
  const message = await scheduler.bot.telegram.sendMessage(chatId, responseText, sendOptions);
  
  updateInteractivePostState(channelMessageId, 'waiting_task3', {
    bot_task3_message_id: message.message_id
  });
  
  schedulerLogger.info({ 
    channelMessageId,
    task3MessageId: message.message_id
  }, '✅ Отправлено финальное задание для незавершенного поста');
}