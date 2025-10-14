// Универсальная система отслеживания интерактивных диалогов
// Работает независимо от конкретной логики бота

import { schedulerLogger } from './logger';
import { 
  getInteractivePostByUserMessage,
  getInteractivePostByBotMessage,
  getUncompletedPostsWithState,
  updateInteractivePostState,
  db
} from './db';

export interface DialogContext {
  post: any;
  lastBotMessage?: any;
  lastUserMessage?: any;
  currentState: string;
  userId: number;
}

// Универсальный трекер для ЛЮБОГО сообщения от пользователя
export async function trackUserMessage(
  userId: number,
  messageId: number,
  messageText: string,
  replyToMessageId?: number,
  messageThreadId?: number
): Promise<DialogContext | null> {
  schedulerLogger.info({
    userId,
    messageId,
    replyToMessageId,
    messageThreadId,
    messagePreview: messageText.substring(0, 30)
  }, '🔍 Отслеживаем сообщение пользователя');

  let context: DialogContext | null = null;

  // 1. Если есть реплай - это самый точный способ
  if (replyToMessageId) {
    const post = getInteractivePostByBotMessage(replyToMessageId);
    if (post && post.user_id === userId) {
      context = {
        post,
        currentState: post.current_state || 'unknown',
        userId,
        lastBotMessage: { id: replyToMessageId }
      };
      
      // Сохраняем связь с сообщением пользователя
      await saveUserMessageLink(post.channel_message_id, messageId, replyToMessageId, userId, messageText);
    }
  }

  // 2. Если нет реплая - ищем по последнему активному посту
  if (!context) {
    const { getUserIncompletePosts } = await import('./db');
    const incompletePosts = getUserIncompletePosts(userId);
    
    if (incompletePosts.length > 0) {
      const lastPost = incompletePosts[0];
      context = {
        post: lastPost,
        currentState: lastPost.current_state || determineStateFromPost(lastPost),
        userId
      };
      
      // Сохраняем связь без конкретного бот-сообщения
      await saveUserMessageLink(lastPost.channel_message_id, messageId, undefined, userId, messageText);
    }
  }

  // 3. Проверяем по messageThreadId если есть
  if (!context && messageThreadId) {
    const post = await findPostByThreadId(messageThreadId);
    if (post && post.user_id === userId) {
      context = {
        post,
        currentState: post.current_state || 'unknown',
        userId
      };
      
      await saveUserMessageLink(post.channel_message_id, messageId, undefined, userId, messageText);
    }
  }

  if (context) {
    schedulerLogger.info({
      channelMessageId: context.post.channel_message_id,
      currentState: context.currentState,
      method: replyToMessageId ? 'reply' : messageThreadId ? 'thread' : 'active_post'
    }, '✅ Найден контекст диалога');
  } else {
    schedulerLogger.debug({ userId }, '❌ Контекст диалога не найден');
    
    // Даже если контекст не найден, сохраняем сообщение для истории
    // Используем 0 как псевдо channelMessageId для общих сообщений
    await saveUserMessageLink(0, messageId, undefined, userId, messageText);
  }

  return context;
}

// Универсальный трекер для ЛЮБОГО сообщения от бота
export async function trackBotMessage(
  botMessageId: number,
  chatId: number,
  messageType: string,
  replyToUserId?: number,
  channelMessageId?: number
): Promise<void> {
  schedulerLogger.info({
    botMessageId,
    chatId,
    messageType,
    replyToUserId,
    channelMessageId
  }, '🤖 Отслеживаем сообщение бота');

  // Если есть channelMessageId - сохраняем связь
  if (channelMessageId) {
    await saveBotMessageLink(channelMessageId, botMessageId, messageType);
  }
  
  // Если это ответ на сообщение пользователя - тоже сохраняем
  if (replyToUserId) {
    const post = getInteractivePostByUserMessage(replyToUserId);
    if (post) {
      await saveBotMessageLink(post.channel_message_id, botMessageId, messageType);
    }
  }
  
  // Если нет channelMessageId и нет реплая - сохраняем как общее сообщение
  if (!channelMessageId && !replyToUserId) {
    // Для общих сообщений используем 0 как псевдо channelMessageId
    // Это позволит отслеживать все сообщения, даже не связанные с постами
    await saveBotMessageLink(0, botMessageId, messageType);
  }
}

// Сохранить связь с сообщением пользователя
async function saveUserMessageLink(
  channelMessageId: number,
  userMessageId: number,
  replyToBotMessageId?: number,
  userId?: number,
  messageText?: string
) {
  try {
    // Если channelMessageId = 0, это общее сообщение без поста
    if (channelMessageId === 0) {
      // Используем переданный userId или 0
      const finalUserId = userId || 0;
      
      // Сохраняем только в таблицу message_links
      const messagePreview = messageText ? messageText.substring(0, 500) : null;
      const save = db.query(`
        INSERT INTO message_links (
          channel_message_id,
          message_id,
          message_type,
          user_id,
          reply_to_message_id,
          message_preview,
          created_at
        ) VALUES (?, ?, 'user', ?, ?, ?, datetime('now'))
      `);

      save.run(0, userMessageId, finalUserId, replyToBotMessageId || null, messagePreview);
      return;
    }
    
    // Определяем какое поле обновлять на основе текущего состояния
    const post = await getPostById(channelMessageId);
    if (!post) return;

    const updateData: any = {};
    
    // Универсальная логика - сохраняем в соответствующее поле
    if (!post.user_task1_message_id && post.current_state?.includes('task1')) {
      updateData.user_task1_message_id = userMessageId;
    } else if (!post.user_schema_message_id && post.current_state?.includes('schema')) {
      updateData.user_schema_message_id = userMessageId;
    } else if (!post.user_task2_message_id && post.current_state?.includes('task2')) {
      updateData.user_task2_message_id = userMessageId;
    }
    
    // Также сохраняем в отдельную таблицу для полной истории
    const messagePreview = messageText ? messageText.substring(0, 500) : null;
    const save = db.query(`
      INSERT INTO message_links (
        channel_message_id,
        message_id,
        message_type,
        user_id,
        reply_to_message_id,
        message_preview,
        created_at
      ) VALUES (?, ?, 'user', ?, ?, ?, datetime('now'))
    `);

    save.run(channelMessageId, userMessageId, post.user_id, replyToBotMessageId, messagePreview);
    
    // Обновляем основную таблицу если есть что обновлять
    if (Object.keys(updateData).length > 0) {
      updateData.last_interaction_at = new Date().toISOString();
      updateInteractivePostState(channelMessageId, post.current_state, updateData);
    }
    
  } catch (error) {
    schedulerLogger.error({ error, channelMessageId, userMessageId }, 'Ошибка сохранения связи с сообщением пользователя');
  }
}

// Сохранить связь с сообщением бота
async function saveBotMessageLink(
  channelMessageId: number,
  botMessageId: number,
  messageType: string
) {
  try {
    // Сохраняем в таблицу связей
    const save = db.query(`
      INSERT INTO message_links (
        channel_message_id,
        message_id,
        message_type,
        user_id,
        created_at
      ) VALUES (?, ?, ?, 0, datetime('now'))
    `);
    
    save.run(channelMessageId, botMessageId, `bot_${messageType}`);
    
    // Обновляем основную таблицу в зависимости от типа
    const updateData: any = {};
    
    switch (messageType) {
      case 'task1':
        updateData.bot_task1_message_id = botMessageId;
        break;
      case 'schema':
        updateData.bot_schema_message_id = botMessageId;
        break;
      case 'task2':
        updateData.bot_task2_message_id = botMessageId;
        break;
      case 'task3':
        updateData.bot_task3_message_id = botMessageId;
        break;
    }
    
    if (Object.keys(updateData).length > 0) {
      const post = await getPostById(channelMessageId);
      if (post) {
        updateInteractivePostState(channelMessageId, post.current_state, updateData);
      }
    }
    
  } catch (error) {
    schedulerLogger.error({ error, channelMessageId, botMessageId }, 'Ошибка сохранения связи с сообщением бота');
  }
}

// Вспомогательные функции
async function getPostById(channelMessageId: number) {
  const get = db.query('SELECT * FROM interactive_posts WHERE channel_message_id = ?');
  const row = get.get(channelMessageId) as any;
  if (row && row.message_data) {
    row.message_data = JSON.parse(row.message_data);
  }
  return row;
}

async function findPostByThreadId(threadId: number) {
  // Проверяем и по thread_mappings и по прямому поиску
  const { getChannelMessageIdByThreadId } = await import('./db');
  const channelMessageId = getChannelMessageIdByThreadId(threadId);
  
  if (channelMessageId) {
    return getPostById(channelMessageId);
  }
  
  // Также пробуем найти по ID пересланного сообщения
  const get = db.query(`
    SELECT * FROM interactive_posts 
    WHERE bot_task1_message_id = ? 
       OR bot_schema_message_id = ?
       OR bot_task2_message_id = ?
       OR bot_task3_message_id = ?
    LIMIT 1
  `);
  
  const row = get.get(threadId, threadId, threadId, threadId) as any;
  if (row && row.message_data) {
    row.message_data = JSON.parse(row.message_data);
  }
  return row;
}

function determineStateFromPost(post: any): string {
  // Определяем состояние на основе выполненных заданий
  if (!post.task1_completed) {
    return 'waiting_task1';
  } else if (!post.task2_completed) {
    return 'waiting_positive';
  } else if (!post.task3_completed) {
    return 'waiting_task3';
  }
  return 'completed';
}

// Универсальная функция восстановления диалогов
export async function restoreUncompletedDialogs(bot: any) {
  schedulerLogger.info('🔄 Восстановление незавершенных диалогов...');
  
  const uncompletedPosts = getUncompletedPostsWithState();
  
  for (const post of uncompletedPosts) {
    try {
      // Получаем полную историю сообщений для поста
      const history = await getMessageHistory(post.channel_message_id);
      
      schedulerLogger.info({
        channelMessageId: post.channel_message_id,
        userId: post.user_id,
        currentState: post.current_state,
        messageCount: history.length,
        lastInteraction: post.last_interaction_at
      }, '📋 Анализируем незавершенный диалог');
      
      // Определяем что нужно сделать
      const action = determineNextAction(post, history);
      
      if (action) {
        schedulerLogger.info({
          action: action.type,
          channelMessageId: post.channel_message_id
        }, '➡️ Определено следующее действие');
        
        // Действие будет выполнено через основную логику бота
        // Здесь мы только подготавливаем данные
      }
      
    } catch (error) {
      schedulerLogger.error({ 
        error, 
        postId: post.channel_message_id 
      }, 'Ошибка восстановления диалога');
    }
  }
}

// Получить полную историю сообщений для поста
async function getMessageHistory(channelMessageId: number) {
  const get = db.query(`
    SELECT * FROM message_links
    WHERE channel_message_id = ?
    ORDER BY created_at ASC
  `);
  
  return get.all(channelMessageId) as any[];
}

// Определить следующее действие на основе истории
function determineNextAction(post: any, history: any[]) {
  const lastUserMessage = history.filter(m => m.message_type === 'user').pop();
  const lastBotMessage = history.filter(m => m.message_type.startsWith('bot_')).pop();
  
  if (!lastUserMessage || !lastBotMessage) {
    return null;
  }
  
  // Логика определения действия
  const timeSinceLastMessage = Date.now() - new Date(lastUserMessage.created_at).getTime();
  const timeSinceLastBot = Date.now() - new Date(lastBotMessage.created_at).getTime();
  
  // Если пользователь ответил после бота - нужно обработать ответ
  if (new Date(lastUserMessage.created_at) > new Date(lastBotMessage.created_at)) {
    return { type: 'process_user_response', userMessageId: lastUserMessage.message_id };
  }
  
  // Если бот ответил последним и прошло время - возможно нужно напоминание
  if (timeSinceLastBot > 2 * 60 * 60 * 1000) { // 2 часа
    return { type: 'send_reminder' };
  }
  
  return null;
}