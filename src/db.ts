import { Database } from 'bun:sqlite';
import fs from 'fs';
import { databaseLogger } from './logger';

// Определяем путь к базе данных в зависимости от окружения
const isProduction = process.env.NODE_ENV === 'production';
const dbPath = isProduction ? '/var/www/databases/psy_froggy_bot/froggy.db' : './froggy.db';

try {
  databaseLogger.info({ dbPath }, '🚀 Инициализация БД');
  if (isProduction) {
    const files = fs.readdirSync('/var/www/databases/psy_froggy_bot');
    databaseLogger.debug({ files }, 'Файлы в каталоге БД');
  }
} catch (e) {
  const error = e as Error;
  databaseLogger.error({ error: error.message, stack: error.stack }, 'Ошибка инициализации БД');
}

// Создаем базу данных
export const db = new Database(dbPath, { create: true });

// Создаем таблицы при первом запуске
db.query(
  `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    chat_id INTEGER UNIQUE,
    username TEXT,
    last_response_time TEXT,
    response_count INTEGER DEFAULT 0
  )
`
).run();

db.query(
  `
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    author_id INTEGER,
    message_text TEXT,
    sent_time TEXT,
    response_time TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`
).run();

// Создаем таблицу для хранения токенов пользователя
// Таблица user_tokens: id, chat_id, token, created_at

db.query(
  `
  CREATE TABLE IF NOT EXISTS user_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER,
    token TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`
).run();

// Создаем таблицу для хранения индекса картинки пользователя
// Таблица user_image_indexes: id, chat_id, image_index, updated_at

db.query(
  `
  CREATE TABLE IF NOT EXISTS user_image_indexes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER UNIQUE,
    image_index INTEGER,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`
).run();

// Создаем таблицу для хранения логов
// Таблица logs: id, level, message, data, timestamp, is_read, created_at

db.query(
  `
  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    data TEXT,
    timestamp TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`
).run();

// Создаем индекс для быстрого поиска логов
db.query(`CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp)`).run();
db.query(`CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level)`).run();
db.query(`CREATE INDEX IF NOT EXISTS idx_logs_is_read ON logs(is_read)`).run();

// Создаем таблицу для системных настроек
db.query(
  `
  CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`
).run();

// Создаем таблицу для хранения file_id картинок лягушек для inline режима
db.query(
  `
  CREATE TABLE IF NOT EXISTS frog_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id TEXT UNIQUE NOT NULL,
    file_unique_id TEXT,
    title TEXT,
    description TEXT,
    width INTEGER,
    height INTEGER,
    file_size INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`
).run();

// Функции для работы с пользователями
export const addUser = (chatId: number, username: string, name?: string, gender?: string) => {
  const insertUser = db.query('INSERT OR IGNORE INTO users (chat_id, username, name, gender) VALUES (?, ?, ?, ?)');
  insertUser.run(chatId, username, name || null, gender || null);
};

export const updateUserResponse = (chatId: number, responseTime: string) => {
  const updateUser = db.query(`
    UPDATE users
    SET last_response_time = ?, response_count = response_count + 1
    WHERE chat_id = ?
  `);
  updateUser.run(responseTime, chatId);
};

export const updateUserName = (chatId: number, name: string) => {
  const updateUser = db.query(`
    UPDATE users
    SET name = ?
    WHERE chat_id = ?
  `);
  updateUser.run(name, chatId);
};

export const updateUserGender = (chatId: number, gender: string) => {
  const updateUser = db.query(`
    UPDATE users
    SET gender = ?
    WHERE chat_id = ?
  `);
  updateUser.run(gender, chatId);
};

export const getUserResponseStats = (chatId: number) => {
  const getStats = db.query(`
    SELECT response_count, last_response_time
    FROM users
    WHERE chat_id = ?
  `);
  return getStats.get(chatId) as { response_count: number; last_response_time: string } | undefined;
};

export const getUserByChatId = (chatId: number) => {
  const getUser = db.query(`
    SELECT id, chat_id, username, name, gender, last_response_time, response_count
    FROM users
    WHERE chat_id = ?
  `);
  return getUser.get(chatId) as { 
    id: number; 
    chat_id: number; 
    username: string | null;
    name: string | null;
    gender: string | null;
    last_response_time: string | null;
    response_count: number;
  } | undefined;
};

// Функции для работы с сообщениями
export const saveMessage = (chatId: number, messageText: string, sentTime: string, authorId: number = 0) => {
  const insertMessage = db.query(`
    INSERT INTO messages (user_id, author_id, message_text, sent_time)
    SELECT id, ?, ?, ? FROM users WHERE chat_id = ?
  `);
  insertMessage.run(authorId, messageText, sentTime, chatId);
};

export const updateMessageResponse = (chatId: number, sentTime: string, responseTime: string) => {
  const updateMessage = db.query(`
    UPDATE messages
    SET response_time = ?
    WHERE user_id = (SELECT id FROM users WHERE chat_id = ?)
    AND sent_time = ?
  `);
  updateMessage.run(responseTime, chatId, sentTime);
};

// Получить последнее сообщение, отправленное ботов пользователю
export const getLastBotMessage = (chatId: number) => {
  const getMessage = db.query(`
    SELECT m.message_text, m.sent_time
    FROM messages m
    JOIN users u ON m.user_id = u.id
    WHERE u.chat_id = ? AND m.author_id = 0
    ORDER BY m.sent_time DESC
    LIMIT 1
  `);
  return getMessage.get(chatId) as { message_text: string; sent_time: string } | undefined;
};

// Получить последнее сообщение от пользователя
export const getLastUserMessage = (chatId: number) => {
  const getMessage = db.query(`
    SELECT m.message_text, m.sent_time
    FROM messages m
    JOIN users u ON m.user_id = u.id
    WHERE u.chat_id = ? AND m.author_id = u.id
    ORDER BY m.sent_time DESC
    LIMIT 1
  `);
  return getMessage.get(chatId) as { message_text: string; sent_time: string } | undefined;
};

// Получить последние N сообщений, отправленных ботом пользователю
export const getLastNBotMessages = (chatId: number, n: number) => {
  const getMessages = db.query(`
    SELECT m.message_text, m.sent_time
    FROM messages m
    JOIN users u ON m.user_id = u.id
    WHERE u.chat_id = ? AND m.author_id = 0
    ORDER BY m.sent_time DESC
    LIMIT ?
  `);
  return getMessages.all(chatId, n) as {
    message_text: string;
    sent_time: string;
  }[];
};

// Получить последние N сообщений от пользователя
export const getLastNUserMessages = (chatId: number, n: number) => {
  const getMessages = db.query(`
    SELECT m.message_text, m.sent_time
    FROM messages m
    JOIN users u ON m.user_id = u.id
    WHERE u.chat_id = ? AND m.author_id = u.id
    ORDER BY m.sent_time DESC
    LIMIT ?
  `);
  return getMessages.all(chatId, n) as {
    message_text: string;
    sent_time: string;
  }[];
};

// Получить последние N сообщений (от бота и пользователя) в хронологическом порядке
export const getLastNMessages = (chatId: number, n: number) => {
  const getMessages = db.query(`
    SELECT m.message_text, m.sent_time, m.author_id, u.id as user_id, u.username
    FROM messages m
    JOIN users u ON m.user_id = u.id
    WHERE u.chat_id = ?
    ORDER BY m.sent_time DESC
    LIMIT ?
  `);
  return getMessages.all(chatId, n) as {
    message_text: string;
    sent_time: string;
    author_id: number;
    user_id: number;
    username: string;
  }[];
};

// Получить все сообщения пользователя за последние 24 часа
export const getUserMessagesLast24Hours = (chatId: number) => {
  const getMessages = db.query(`
    SELECT m.message_text, m.sent_time
    FROM messages m
    JOIN users u ON m.user_id = u.id
    WHERE u.chat_id = ? 
    AND m.author_id = u.id
    AND datetime(m.sent_time) > datetime('now', '-24 hours')
    ORDER BY m.sent_time ASC
  `);
  return getMessages.all(chatId) as {
    message_text: string;
    sent_time: string;
  }[];
};

// Получить новые сообщения пользователя с момента последней генерации поста
export const getUserMessagesSinceLastPost = (chatId: number) => {
  // Сначала находим время последнего поста от бота в канале
  const lastPostQuery = db.query(`
    SELECT MAX(m.sent_time) as last_post_time
    FROM messages m
    JOIN users u ON m.user_id = u.id
    WHERE u.chat_id = ? 
    AND m.author_id = 0
    AND (m.message_text LIKE '%Переходи в комментарии и продолжим%' 
         OR m.message_text LIKE '%Плюшки для лягушки%'
         OR m.message_text LIKE '%Дыхательная практика%')
  `);
  
  const lastPost = lastPostQuery.get(chatId) as { last_post_time: string | null } | undefined;
  const lastPostTime = lastPost?.last_post_time || '1970-01-01T00:00:00Z';
  
  // Теперь получаем все сообщения пользователя после этого времени
  const getMessages = db.query(`
    SELECT m.message_text, m.sent_time
    FROM messages m
    JOIN users u ON m.user_id = u.id
    WHERE u.chat_id = ? 
    AND m.author_id = u.id
    AND datetime(m.sent_time) > datetime(?)
    ORDER BY m.sent_time ASC
  `);
  
  return getMessages.all(chatId, lastPostTime) as {
    message_text: string;
    sent_time: string;
  }[];
};

// Сохранить токен для пользователя
export const saveUserToken = (chatId: number, token: string) => {
  const upsertToken = db.query(`
    INSERT INTO user_tokens (chat_id, token, created_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(chat_id) DO UPDATE SET token = excluded.token, created_at = CURRENT_TIMESTAMP
  `);
  upsertToken.run(chatId, token);
};

// Получить последний токен пользователя
export const getLastUserToken = (chatId: number) => {
  const getToken = db.query(`
    SELECT token, created_at
    FROM user_tokens
    WHERE chat_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `);
  return getToken.get(chatId) as { token: string; created_at: string } | undefined;
};

// Сохранить (обновить) индекс картинки для пользователя
export const saveUserImageIndex = (chatId: number, imageIndex: number) => {
  try {
    const upsert = db.query(`
      INSERT INTO user_image_indexes (chat_id, image_index, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(chat_id) DO UPDATE SET image_index = excluded.image_index, updated_at = excluded.updated_at
    `);
    upsert.run(chatId, imageIndex);
    // Логируем всё содержимое таблицы для дебага
    // const all = db.query('SELECT * FROM user_image_indexes').all();
    // Убираем детальное логирование
  } catch (e) {
    const error = e as Error;
    databaseLogger.error({ error: error.message, stack: error.stack, chatId }, 'Ошибка сохранения индекса картинки');
  }
};

// Получить индекс картинки пользователя
export const getUserImageIndex = (chatId: number) => {
  const getIndex = db.query(`
    SELECT image_index, updated_at
    FROM user_image_indexes
    WHERE chat_id = ?
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `);
  return getIndex.get(chatId) as { image_index: number; updated_at: string } | undefined;
};

// Удалить все токены пользователя (например, при сбросе авторизации Google Calendar)
export const clearUserTokens = (chatId: number) => {
  const del = db.query(`
    DELETE FROM user_tokens WHERE chat_id = ?
  `);
  del.run(chatId);
};

// Сохранить интерактивный пост
export const saveInteractivePost = (
  channelMessageId: number,
  userId: number,
  messageData: any,
  relaxationType: string
) => {
  const insert = db.query(`
    INSERT INTO interactive_posts (channel_message_id, user_id, message_data, relaxation_type)
    VALUES (?, ?, ?, ?)
  `);
  insert.run(channelMessageId, userId, JSON.stringify(messageData), relaxationType);
};

// Получить интерактивный пост по ID сообщения в канале
export const getInteractivePost = (channelMessageId: number) => {
  const get = db.query(`
    SELECT * FROM interactive_posts
    WHERE channel_message_id = ?
  `);
  const row = get.get(channelMessageId) as any;
  if (row && row.message_data) {
    row.message_data = JSON.parse(row.message_data);
  }
  return row;
};

// Обновить статус выполнения задания
export const updateTaskStatus = (channelMessageId: number, taskNumber: 1 | 2 | 3, completed: boolean = true) => {
  const columnName = `task${taskNumber}_completed`;
  const update = db.query(`
    UPDATE interactive_posts
    SET ${columnName} = ?
    WHERE channel_message_id = ?
  `);
  update.run(completed ? 1 : 0, channelMessageId);
};

// Установить трофей
export const setTrophyStatus = (channelMessageId: number, set: boolean = true) => {
  const update = db.query(`
    UPDATE interactive_posts
    SET trophy_set = ?
    WHERE channel_message_id = ?
  `);
  update.run(set ? 1 : 0, channelMessageId);
};

// Получить все незавершенные посты пользователя
export const getUserIncompletePosts = (userId: number) => {
  const get = db.query(`
    SELECT * FROM interactive_posts
    WHERE user_id = ?
    AND (task1_completed = 0 OR task2_completed = 0 OR task3_completed = 0)
    ORDER BY created_at DESC
  `);
  const rows = get.all(userId) as any[];
  return rows.map(row => {
    if (row.message_data) {
      row.message_data = JSON.parse(row.message_data);
    }
    return row;
  });
};


// Функция для экранирования HTML
export function escapeHTML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Сохранить маппинг треда
export const saveThreadMapping = (channelMessageId: number, threadId: number) => {
  const save = db.query(`
    INSERT OR REPLACE INTO thread_mappings (channel_message_id, thread_id)
    VALUES (?, ?)
  `);
  save.run(channelMessageId, threadId);
  databaseLogger.info({ channelMessageId, threadId }, 'Сохранен маппинг треда');
};

// Получить channel_message_id по thread_id
export const getChannelMessageIdByThreadId = (threadId: number) => {
  const get = db.query(`
    SELECT channel_message_id FROM thread_mappings
    WHERE thread_id = ?
  `);
  const row = get.get(threadId) as any;
  return row?.channel_message_id || null;
};

// Получить всех пользователей
export const getAllUsers = () => {
  const getUsers = db.query(`
    SELECT chat_id, username, name, gender, last_response_time, response_count
    FROM users
    ORDER BY chat_id
  `);
  return getUsers.all() as {
    chat_id: number;
    username: string;
    name: string | null;
    gender: string | null;
    last_response_time: string;
    response_count: number;
  }[];
};

// ========== ФУНКЦИИ ДЛЯ РАБОТЫ С ЛОГАМИ ==========

// Сохранить лог в базу данных
export const saveLogToDatabase = (
  level: string,
  message: string,
  data: string | null = null,
  timestamp: string = new Date().toISOString()
) => {
  try {
    const insertLog = db.query(`
      INSERT INTO logs (level, message, data, timestamp, is_read, created_at)
      VALUES (?, ?, ?, ?, FALSE, CURRENT_TIMESTAMP)
    `);
    insertLog.run(level, message, data, timestamp);
  } catch (error) {
    // Не можем использовать loggers здесь - циклическая зависимость
    console.error('Ошибка при сохранении лога в БД:', error);
  }
};

// Получить последние N логов с пагинацией
export const getRecentLogs = (limit: number = 7, offset: number = 0) => {
  const getLogs = db.query(`
    SELECT id, level, message, data, timestamp, is_read, created_at
    FROM logs
    ORDER BY timestamp DESC, id DESC
    LIMIT ? OFFSET ?
  `);
  return getLogs.all(limit, offset) as {
    id: number;
    level: string;
    message: string;
    data: string | null;
    timestamp: string;
    is_read: boolean;
    created_at: string;
  }[];
};

// Получить последние N непрочитанных логов с пагинацией
export const getRecentUnreadLogs = (limit: number = 7, offset: number = 0) => {
  const getLogs = db.query(`
    SELECT id, level, message, data, timestamp, is_read, created_at
    FROM logs
    WHERE is_read = FALSE
    ORDER BY timestamp DESC, id DESC
    LIMIT ? OFFSET ?
  `);
  return getLogs.all(limit, offset) as {
    id: number;
    level: string;
    message: string;
    data: string | null;
    timestamp: string;
    is_read: boolean;
    created_at: string;
  }[];
};

// Получить последние N непрочитанных логов уровня INFO и выше (info, warn, error, fatal)
export const getRecentUnreadInfoLogs = (limit: number = 7, offset: number = 0) => {
  const getLogs = db.query(`
    SELECT id, level, message, data, timestamp, is_read, created_at
    FROM logs
    WHERE is_read = FALSE AND level IN ('info', 'warn', 'error', 'fatal')
    ORDER BY timestamp DESC, id DESC
    LIMIT ? OFFSET ?
  `);
  return getLogs.all(limit, offset) as {
    id: number;
    level: string;
    message: string;
    data: string | null;
    timestamp: string;
    is_read: boolean;
    created_at: string;
  }[];
};

// Получить количество всех логов
export const getLogsCount = () => {
  const getCount = db.query(`SELECT COUNT(*) as count FROM logs`);
  const result = getCount.get() as { count: number };
  return result.count;
};

// Получить количество непрочитанных логов
export const getUnreadLogsCount = () => {
  const getCount = db.query(`SELECT COUNT(*) as count FROM logs WHERE is_read = FALSE`);
  const result = getCount.get() as { count: number };
  return result.count;
};

// Пометить лог как прочитанный
export const markLogAsRead = (logId: number) => {
  const updateLog = db.query(`
    UPDATE logs
    SET is_read = TRUE
    WHERE id = ?
  `);
  updateLog.run(logId);
};

// Пометить несколько логов как прочитанные по их ID
export const markLogsAsRead = (logIds: number[]) => {
  if (logIds.length === 0) return;

  const placeholders = logIds.map(() => '?').join(',');
  const updateLogs = db.query(`
    UPDATE logs
    SET is_read = TRUE
    WHERE id IN (${placeholders})
  `);
  updateLogs.run(...logIds);
};

// Пометить все логи как прочитанные
export const markAllLogsAsRead = () => {
  const updateLogs = db.query(`
    UPDATE logs
    SET is_read = TRUE
    WHERE is_read = FALSE
  `);
  updateLogs.run();
};

// Получить логи по уровню
export const getLogsByLevel = (level: string, limit: number = 50) => {
  const getLogs = db.query(`
    SELECT id, level, message, data, timestamp, is_read, created_at
    FROM logs
    WHERE level = ?
    ORDER BY timestamp DESC, id DESC
    LIMIT ?
  `);
  return getLogs.all(level, limit) as {
    id: number;
    level: string;
    message: string;
    data: string | null;
    timestamp: string;
    is_read: boolean;
    created_at: string;
  }[];
};

// Получить последние логи с фильтром по уровню
export const getRecentLogsByLevel = (level: string | null, limit: number = 7, offset: number = 0) => {
  const query = level
    ? `SELECT id, level, message, data, timestamp, is_read, created_at
       FROM logs
       WHERE level = ?
       ORDER BY timestamp DESC, id DESC
       LIMIT ? OFFSET ?`
    : `SELECT id, level, message, data, timestamp, is_read, created_at
       FROM logs
       ORDER BY timestamp DESC, id DESC
       LIMIT ? OFFSET ?`;

  const getLogs = db.query(query);

  return level ? getLogs.all(level, limit, offset) : getLogs.all(limit, offset);
};

// Очистить старые логи (старше N дней)
export const cleanOldLogs = (daysToKeep: number = 30) => {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

  const deleteLogs = db.query(`
    DELETE FROM logs
    WHERE timestamp < ?
  `);
  const result = deleteLogs.run(cutoffDate.toISOString());
  return result.changes;
};

// Получить статистику логов
export const getLogsStatistics = () => {
  const getStats = db.query(`
    SELECT
      level,
      COUNT(*) as count,
      SUM(CASE WHEN is_read = FALSE THEN 1 ELSE 0 END) as unread_count
    FROM logs
    GROUP BY level
    ORDER BY count DESC
  `);
  return getStats.all() as {
    level: string;
    count: number;
    unread_count: number;
  }[];
};

// ============= НОВЫЕ ФУНКЦИИ ДЛЯ ОТСЛЕЖИВАНИЯ ID СООБЩЕНИЙ =============

// Обновить состояние интерактивного поста
export const updateInteractivePostState = (
  channelMessageId: number, 
  state: string,
  messageIds?: {
    bot_task1_message_id?: number;
    bot_schema_message_id?: number;
    bot_task2_message_id?: number;
    bot_task3_message_id?: number;
    user_task1_message_id?: number;
    user_schema_message_id?: number;
    user_task2_message_id?: number;
    practice_reminder_sent?: boolean;
    user_emotions_clarification_message_id?: number;
    bot_help_message_id?: number;
    user_positive_emotions_clarification_message_id?: number;
    bot_positive_help_message_id?: number;
  }
) => {
  let setClause = 'current_state = ?, last_interaction_at = datetime("now")';
  const params: any[] = [state];
  
  // Добавляем ID сообщений если они переданы
  if (messageIds) {
    const fields: string[] = [];
    Object.entries(messageIds).forEach(([key, value]) => {
      if (value !== undefined) {
        fields.push(`${key} = ?`);
        params.push(value);
      }
    });
    if (fields.length > 0) {
      setClause += ', ' + fields.join(', ');
    }
  }
  
  params.push(channelMessageId);
  
  const update = db.query(`
    UPDATE interactive_posts
    SET ${setClause}
    WHERE channel_message_id = ?
  `);
  
  update.run(...params);
};

// Получить пост по ID сообщения пользователя
export const getInteractivePostByUserMessage = (userMessageId: number) => {
  const get = db.query(`
    SELECT * FROM interactive_posts
    WHERE user_task1_message_id = ?
       OR user_schema_message_id = ?
       OR user_task2_message_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `);
  
  const row = get.get(userMessageId, userMessageId, userMessageId) as any;
  if (row && row.message_data) {
    row.message_data = JSON.parse(row.message_data);
  }
  return row;
};

// Получить пост по ID сообщения бота
export const getInteractivePostByBotMessage = (botMessageId: number) => {
  const get = db.query(`
    SELECT * FROM interactive_posts
    WHERE bot_task1_message_id = ?
       OR bot_schema_message_id = ?
       OR bot_task2_message_id = ?
       OR bot_task3_message_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `);
  
  const row = get.get(botMessageId, botMessageId, botMessageId, botMessageId) as any;
  if (row && row.message_data) {
    row.message_data = JSON.parse(row.message_data);
  }
  return row;
};

// Получить незавершенные посты с учетом текущего состояния
export const getUncompletedPostsWithState = () => {
  const get = db.query(`
    SELECT ip.*, u.chat_id as user_chat_id
    FROM interactive_posts ip
    JOIN users u ON ip.user_id = u.chat_id
    WHERE current_state != 'completed'
    AND ip.created_at > datetime('now', '-7 days')
    ORDER BY ip.created_at DESC
  `);
  
  const rows = get.all() as any[];
  return rows.map(row => {
    if (row.message_data) {
      row.message_data = JSON.parse(row.message_data);
    }
    return row;
  });
};

// ============= ФУНКЦИИ ДЛЯ РАБОТЫ С INLINE КАРТИНКАМИ ЛЯГУШЕК =============

// Сохранить картинку лягушки
export const saveFrogImage = (
  fileId: string,
  fileUniqueId: string,
  title: string,
  description: string,
  width: number,
  height: number,
  fileSize: number
) => {
  const insert = db.query(`
    INSERT OR REPLACE INTO frog_images (file_id, file_unique_id, title, description, width, height, file_size)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run(fileId, fileUniqueId, title, description, width, height, fileSize);
};

// Получить все картинки лягушек
export const getAllFrogImages = () => {
  const get = db.query(`
    SELECT * FROM frog_images
    ORDER BY created_at DESC
  `);
  return get.all() as {
    id: number;
    file_id: string;
    file_unique_id: string;
    title: string;
    description: string;
    width: number;
    height: number;
    file_size: number;
    created_at: string;
  }[];
};

// Получить картинку по file_id
export const getFrogImageByFileId = (fileId: string) => {
  const get = db.query(`
    SELECT * FROM frog_images
    WHERE file_id = ?
  `);
  return get.get(fileId) as {
    id: number;
    file_id: string;
    file_unique_id: string;
    title: string;
    description: string;
    width: number;
    height: number;
    file_size: number;
    created_at: string;
  } | undefined;
};

// Удалить картинку лягушки
export const deleteFrogImage = (fileId: string) => {
  const del = db.query(`
    DELETE FROM frog_images
    WHERE file_id = ?
  `);
  del.run(fileId);
};

// ============= ФУНКЦИИ ДЛЯ РАБОТЫ СО ЗЛЫМИ ПОСТАМИ =============

// Сохранить злой пост
export const saveAngryPost = (channelMessageId: number, threadId: number | null, userId: number) => {
  const insert = db.query(`
    INSERT INTO angry_posts (channel_message_id, thread_id, user_id)
    VALUES (?, ?, ?)
  `);
  insert.run(channelMessageId, threadId, userId);
  databaseLogger.info({ channelMessageId, threadId, userId }, 'Сохранен злой пост');
};

// Проверить, является ли пост злым
export const isAngryPost = (channelMessageId: number) => {
  const get = db.query(`
    SELECT id FROM angry_posts
    WHERE channel_message_id = ?
  `);
  const row = get.get(channelMessageId);
  return !!row;
};

// Проверить по thread_id, является ли это комментарием к злому посту
export const isAngryPostByThreadId = (threadId: number) => {
  const get = db.query(`
    SELECT id FROM angry_posts
    WHERE thread_id = ?
  `);
  const row = get.get(threadId);
  return !!row;
};

// ============= ФУНКЦИИ ДЛЯ РАБОТЫ С ИСТОРИЕЙ ПРИМЕРОВ ЗЛЫХ ПОСТОВ =============

// Получить последние использованные примеры
export const getLastUsedAngryExamples = (limit: number = 7) => {
  const get = db.query(`
    SELECT example_index 
    FROM angry_post_examples_history
    ORDER BY used_at DESC
    LIMIT ?
  `);
  const rows = get.all(limit) as { example_index: number }[];
  return rows.map(row => row.example_index);
};

// Добавить использованный пример
export const addUsedAngryExample = (exampleIndex: number) => {
  // Сначала добавляем новый
  const insert = db.query(`
    INSERT INTO angry_post_examples_history (example_index)
    VALUES (?)
  `);
  insert.run(exampleIndex);
  
  // Затем удаляем старые, оставляя только последние 7
  const deleteOld = db.query(`
    DELETE FROM angry_post_examples_history
    WHERE id NOT IN (
      SELECT id FROM angry_post_examples_history
      ORDER BY used_at DESC
      LIMIT 7
    )
  `);
  deleteOld.run();
  
  databaseLogger.info({ exampleIndex }, 'Добавлен использованный пример злого поста');
};

// ============= ФУНКЦИИ ДЛЯ ОТСЛЕЖИВАНИЯ ИСПОЛЬЗОВАННЫХ ПРИМЕРОВ ПРОМПТОВ =============

// Получить последние использованные примеры для конкретного промпта
export const getLastUsedPromptExamples = (promptNumber: number, limit: number = 7) => {
  const get = db.query(`
    SELECT example_index 
    FROM angry_prompt_examples_history
    WHERE prompt_number = ?
    ORDER BY used_at DESC
    LIMIT ?
  `);
  const rows = get.all(promptNumber, limit) as { example_index: number }[];
  return rows.map(row => row.example_index);
};

// Добавить использованный пример промпта
export const addUsedPromptExample = (promptNumber: number, exampleIndex: number, exampleText?: string) => {
  // Сначала добавляем новый
  const insert = db.query(`
    INSERT INTO angry_prompt_examples_history (prompt_number, example_index, example_text)
    VALUES (?, ?, ?)
  `);
  insert.run(promptNumber, exampleIndex, exampleText || null);
  
  // Затем удаляем старые, оставляя только последние 7 для каждого промпта
  const deleteOld = db.query(`
    DELETE FROM angry_prompt_examples_history
    WHERE prompt_number = ? AND id NOT IN (
      SELECT id FROM angry_prompt_examples_history
      WHERE prompt_number = ?
      ORDER BY used_at DESC
      LIMIT 7
    )
  `);
  deleteOld.run(promptNumber, promptNumber);
  
  databaseLogger.info({ promptNumber, exampleIndex }, 'Добавлен использованный пример промпта');
};

// ============= ФУНКЦИИ ДЛЯ ОТСЛЕЖИВАНИЯ ПОДДЕРЖИВАЮЩИХ СООБЩЕНИЙ =============

// Получить последние использованные поддерживающие сообщения
export const getLastUsedSupportMessages = (limit: number = 5) => {
  const get = db.query(`
    SELECT message_index
    FROM support_messages_history
    ORDER BY used_at DESC
    LIMIT ?
  `);
  const rows = get.all(limit) as { message_index: number }[];
  return rows.map(row => row.message_index);
};

// Добавить использованное поддерживающее сообщение
export const addUsedSupportMessage = (messageIndex: number) => {
  // Сначала добавляем новый
  const insert = db.query(`
    INSERT INTO support_messages_history (message_index, used_at)
    VALUES (?, datetime('now'))
  `);
  insert.run(messageIndex);

  // Затем удаляем старые, оставляя только последние 5
  const deleteOld = db.query(`
    DELETE FROM support_messages_history
    WHERE id NOT IN (
      SELECT id FROM support_messages_history
      ORDER BY used_at DESC
      LIMIT 5
    )
  `);
  deleteOld.run();

  databaseLogger.info({ messageIndex }, 'Добавлено использованное поддерживающее сообщение');
};

// Получить последние использованные тексты поддержки эмоций
export const getLastUsedEmotionsSupportTexts = (limit: number = 5) => {
  const get = db.query(`
    SELECT message_index
    FROM emotions_support_texts_history
    ORDER BY used_at DESC
    LIMIT ?
  `);
  const rows = get.all(limit) as { message_index: number }[];
  return rows.map(row => row.message_index);
};

// Добавить использованный текст поддержки эмоций
export const addUsedEmotionsSupportText = (messageIndex: number) => {
  // Сначала добавляем новый
  const insert = db.query(`
    INSERT INTO emotions_support_texts_history (message_index, used_at)
    VALUES (?, datetime('now'))
  `);
  insert.run(messageIndex);

  // Затем удаляем старые, оставляя только последние 5
  const deleteOld = db.query(`
    DELETE FROM emotions_support_texts_history
    WHERE id NOT IN (
      SELECT id FROM emotions_support_texts_history
      ORDER BY used_at DESC
      LIMIT 5
    )
  `);
  deleteOld.run();

  databaseLogger.info({ messageIndex }, 'Добавлен использованный текст поддержки эмоций');
};

// ============= ФУНКЦИИ ДЛЯ ОТСЛЕЖИВАНИЯ ОТВЕТОВ НА ЗЛЫЕ ПОСТЫ =============

// Получить или создать запись о количестве ответов пользователя
export const getOrCreateAngryPostUserResponse = (threadId: number, userId: number) => {
  // Пытаемся получить существующую запись
  const get = db.query(`
    SELECT * FROM angry_post_user_responses
    WHERE thread_id = ? AND user_id = ?
  `);
  
  let row = get.get(threadId, userId) as {
    id: number;
    thread_id: number;
    user_id: number;
    response_count: number;
    created_at: string;
    updated_at: string;
  } | undefined;
  
  // Если не существует, создаём
  if (!row) {
    const insert = db.query(`
      INSERT INTO angry_post_user_responses (thread_id, user_id, response_count)
      VALUES (?, ?, 0)
    `);
    insert.run(threadId, userId);
    
    // Получаем только что созданную запись
    row = get.get(threadId, userId) as any;
  }
  
  return row!;
};

// Увеличить счётчик ответов пользователя
export const incrementAngryPostUserResponse = (threadId: number, userId: number): number => {
  // Сначала убеждаемся, что запись существует
  getOrCreateAngryPostUserResponse(threadId, userId);
  
  // Увеличиваем счётчик
  const update = db.query(`
    UPDATE angry_post_user_responses
    SET response_count = response_count + 1, updated_at = datetime('now')
    WHERE thread_id = ? AND user_id = ?
  `);
  update.run(threadId, userId);
  
  // Получаем обновлённое значение
  const get = db.query(`
    SELECT response_count FROM angry_post_user_responses
    WHERE thread_id = ? AND user_id = ?
  `);
  const row = get.get(threadId, userId) as { response_count: number };
  
  databaseLogger.info({ threadId, userId, count: row.response_count }, 'Увеличен счётчик ответов на злой пост');
  
  return row.response_count;
};

// Получить информацию о злом посте
export const getAngryPost = (channelMessageId: number) => {
  const get = db.query(`
    SELECT * FROM angry_posts
    WHERE channel_message_id = ?
  `);
  return get.get(channelMessageId) as {
    id: number;
    channel_message_id: number;
    thread_id: number | null;
    user_id: number;
    created_at: string;
  } | undefined;
};

// Сохранить утренний пост
export const saveMorningPost = (channelMessageId: number, userId: number) => {
  const insert = db.query(`
    INSERT INTO morning_posts (channel_message_id, user_id, current_step)
    VALUES (?, ?, 'waiting_user_message')
  `);
  insert.run(channelMessageId, userId);
};

// Получить утренний пост по ID сообщения в канале
export const getMorningPost = (channelMessageId: number) => {
  const get = db.query(`
    SELECT * FROM morning_posts
    WHERE channel_message_id = ?
  `);
  return get.get(channelMessageId) as {
    id: number;
    channel_message_id: number;
    user_id: number;
    created_at: string;
    current_step: string;
  } | undefined;
};

// Обновить шаг утреннего поста
export const updateMorningPostStep = (channelMessageId: number, step: string) => {
  const update = db.query(`
    UPDATE morning_posts
    SET current_step = ?
    WHERE channel_message_id = ?
  `);
  update.run(step, channelMessageId);
};

// Обновить ID последнего сообщения с кнопкой
export const updateMorningPostButtonMessage = (channelMessageId: number, buttonMessageId: number) => {
  const update = db.query(`
    UPDATE morning_posts
    SET last_button_message_id = ?
    WHERE channel_message_id = ?
  `);
  update.run(buttonMessageId, channelMessageId);
};

// Получить все утренние посты пользователя
export const getUserMorningPosts = (userId: number) => {
  const query = db.query(`
    SELECT * FROM morning_posts
    WHERE user_id = ?
    ORDER BY created_at DESC
  `);
  return query.all(userId) as Array<{
    id: number;
    channel_message_id: number;
    user_id: number;
    created_at: string;
    current_step: string;
  }>;
};
