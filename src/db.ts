import { Database } from 'bun:sqlite';
import fs from 'fs';
import { databaseLogger } from './logger';

// Определяем путь к базе данных в зависимости от окружения
// ВСЕГДА используем одну общую БД для разделения по CHANNEL_ID/CHAT_ID
const isProduction = process.env.NODE_ENV === 'production';
const dbPath = isProduction
  ? '/var/www/databases/psy_froggy_bot/froggy.db'
  : './froggy.db';

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

export const updateUserRequest = (chatId: number, request: string | null) => {
  const updateUser = db.query(`
    UPDATE users
    SET user_request = ?
    WHERE chat_id = ?
  `);
  updateUser.run(request, chatId);
};

/**
 * Обновляет timezone и город пользователя
 */
export const updateUserTimezone = (chatId: number, timezone: string, offset: number, city?: string) => {
  const updateUser = db.query(`
    UPDATE users
    SET timezone = ?, timezone_offset = ?, city = ?
    WHERE chat_id = ?
  `);
  updateUser.run(timezone, offset, city || null, chatId);
  databaseLogger.info({ chatId, timezone, offset, city }, '✅ Timezone пользователя обновлен');
};

/**
 * Получает timezone пользователя
 */
export const getUserTimezone = (chatId: number): { timezone: string; timezone_offset: number } | null => {
  const getTimezone = db.query(`
    SELECT timezone, timezone_offset
    FROM users
    WHERE chat_id = ?
  `);
  const result = getTimezone.get(chatId) as { timezone: string; timezone_offset: number } | undefined;
  return result || null;
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
    SELECT id, chat_id, username, name, gender, last_response_time, response_count, onboarding_state, user_request, timezone, timezone_offset, city, dm_enabled, channel_enabled, channel_id
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
    onboarding_state: string | null;
    user_request: string | null;
    timezone: string;
    timezone_offset: number;
    city: string | null;
    dm_enabled: number; // 🆕 Режим ЛС (0 или 1)
    channel_enabled: number; // 🆕 Режим канала (0 или 1)
    channel_id: number | null; // 🆕 ID канала пользователя (NULL = нет канала)
  } | undefined;
};

// 🆕 Функции для управления режимами работы бота (ЛС и канал)

/**
 * Включить режим личных сообщений для пользователя
 */
export const enableDMMode = (chatId: number) => {
  const update = db.query('UPDATE users SET dm_enabled = 1 WHERE chat_id = ?');
  update.run(chatId);
  databaseLogger.info({ chatId }, '✅ Режим ЛС включен для пользователя');
};

/**
 * Отключить режим личных сообщений для пользователя
 */
export const disableDMMode = (chatId: number) => {
  const update = db.query('UPDATE users SET dm_enabled = 0 WHERE chat_id = ?');
  update.run(chatId);
  databaseLogger.info({ chatId }, '🚫 Режим ЛС отключен для пользователя');
};

/**
 * Включить режим канала для пользователя (только для главных)
 */
export const enableChannelMode = (chatId: number) => {
  const update = db.query('UPDATE users SET channel_enabled = 1 WHERE chat_id = ?');
  update.run(chatId);
  databaseLogger.info({ chatId }, '✅ Режим канала включен для пользователя');
};

/**
 * Отключить режим канала для пользователя
 */
export const disableChannelMode = (chatId: number) => {
  const update = db.query('UPDATE users SET channel_enabled = 0 WHERE chat_id = ?');
  update.run(chatId);
  databaseLogger.info({ chatId }, '🚫 Режим канала отключен для пользователя');
};

/**
 * Получить статус режимов для пользователя
 */
export const getUserModes = (chatId: number): { dm_enabled: boolean; channel_enabled: boolean } | null => {
  const query = db.query('SELECT dm_enabled, channel_enabled FROM users WHERE chat_id = ?');
  const result = query.get(chatId) as { dm_enabled: number; channel_enabled: number } | undefined;
  if (!result) return null;
  return {
    dm_enabled: Boolean(result.dm_enabled),
    channel_enabled: Boolean(result.channel_enabled),
  };
};

// Функции для работы с сообщениями
export const saveMessage = (
  chatId: number,
  messageText: string,
  sentTime: string,
  authorId: number = 0,
  telegramMessageId?: number,
  messageChatId?: number
) => {
  const insertMessage = db.query(`
    INSERT INTO messages (user_id, author_id, message_text, sent_time, telegram_message_id, chat_id)
    SELECT id, ?, ?, ?, ?, ? FROM users WHERE chat_id = ?
  `);
  insertMessage.run(authorId, messageText, sentTime, telegramMessageId || null, messageChatId || null, chatId);
};

/**
 * Обновить существующее сообщение по telegram_message_id
 * Используется для обработки отредактированных сообщений
 */
export const updateMessage = (
  chatId: number,
  telegramMessageId: number,
  messageChatId: number,
  newText: string,
  editTime: string
) => {
  try {
    const updateStmt = db.query(`
      UPDATE messages
      SET message_text = ?, sent_time = ?
      WHERE telegram_message_id = ? AND chat_id = ?
    `);
    const result = updateStmt.run(newText, editTime, telegramMessageId, messageChatId);

    // Если не нашли сообщение - сохраняем как новое
    if (result.changes === 0) {
      databaseLogger.info(
        { chatId, telegramMessageId, messageChatId },
        'Сообщение не найдено для обновления, сохраняем как новое'
      );
      saveMessage(chatId, newText, editTime, chatId, telegramMessageId, messageChatId);
    } else {
      databaseLogger.info(
        { chatId, telegramMessageId, messageChatId },
        'Сообщение обновлено'
      );
    }
  } catch (e) {
    const error = e as Error;
    databaseLogger.error(
      { error: error.message, stack: error.stack, chatId, telegramMessageId },
      'Ошибка обновления сообщения'
    );
  }
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
// isDmMode = true означает что пост в ЛС (диалог там же), false = пост в канале (диалог в комментариях)
// currentState = начальное состояние поста (по умолчанию 'scenario_choice' - ждём выбора сценария)
export const saveInteractivePost = (
  channelMessageId: number,
  userId: number,
  messageData: any,
  relaxationType: string,
  isDmMode: boolean = false,
  currentState: string = 'scenario_choice'
) => {
  const insert = db.query(`
    INSERT INTO interactive_posts (channel_message_id, user_id, message_data, relaxation_type, is_dm_mode, current_state)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insert.run(channelMessageId, userId, JSON.stringify(messageData), relaxationType, isDmMode ? 1 : 0, currentState);
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
// ⚠️ ВАЖНО: Фильтруем channel_message_id < 10000000000 чтобы исключить
// некорректные записи с timestamp вместо реального message_id
export const getUserIncompletePosts = (userId: number) => {
  const get = db.query(`
    SELECT * FROM interactive_posts
    WHERE user_id = ?
    AND (task1_completed = 0 OR task2_completed = 0 OR task3_completed = 0)
    AND channel_message_id < 10000000000
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

// Получить незавершенные посты пользователя с фильтрацией по режиму DM
// ⚠️ ВАЖНО: Фильтруем channel_message_id < 10000000000 чтобы исключить
// некорректные записи с timestamp вместо реального message_id
// (timestamp > 1.7 триллиона, реальные Telegram ID обычно < 1 миллиарда)
// ⚠️ ВАЖНО: Сортируем по приоритету состояния:
// 1. Посты в активном состоянии (scenario_choice, waiting_negative, waiting_positive и т.д.) - первые
// 2. Потом по created_at DESC (новые посты первыми!)
// 3. Потом по last_interaction_at DESC
// Это гарантирует, что НОВЫЙ пост будет найден первым при равном приоритете состояния
export const getUserIncompletePostsByMode = (userId: number, isDmMode: boolean) => {
  const get = db.query(`
    SELECT *,
      CASE
        WHEN current_state IN ('scenario_choice', 'waiting_negative', 'waiting_positive', 'waiting_task3', 'waiting_emotions_clarification', 'waiting_positive_emotions_clarification', 'waiting_emotions_addition') THEN 0
        ELSE 1
      END as state_priority
    FROM interactive_posts
    WHERE user_id = ?
    AND (task1_completed = 0 OR task2_completed = 0 OR task3_completed = 0)
    AND is_dm_mode = ?
    AND channel_message_id < 10000000000
    ORDER BY state_priority ASC, created_at DESC, last_interaction_at DESC
  `);
  const rows = get.all(userId, isDmMode ? 1 : 0) as any[];
  return rows.map(row => {
    if (row.message_data) {
      row.message_data = JSON.parse(row.message_data);
    }
    // Удаляем служебное поле state_priority
    delete row.state_priority;
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
    SELECT chat_id, username, name, gender, last_response_time, response_count, timezone, timezone_offset, dm_enabled, channel_enabled
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
    timezone: string;
    timezone_offset: number;
    dm_enabled: number;
    channel_enabled: number;
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
// isDmMode = true означает что пост в ЛС (диалог там же), false = пост в канале (диалог в комментариях)
export const saveAngryPost = (channelMessageId: number, threadId: number | null, userId: number, isDmMode: boolean = false) => {
  const insert = db.query(`
    INSERT INTO angry_posts (channel_message_id, thread_id, user_id, is_dm_mode)
    VALUES (?, ?, ?, ?)
  `);
  insert.run(channelMessageId, threadId, userId, isDmMode ? 1 : 0);
  databaseLogger.info({ channelMessageId, threadId, userId, isDmMode }, 'Сохранен злой пост');
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

// ============= ФУНКЦИИ ДЛЯ РАБОТЫ С ИСТОРИЕЙ КАРТИНОК ЗЛЫХ ПОСТОВ =============

export const getLastUsedAngryImages = (limit: number = 15) => {
  const get = db.query(`
    SELECT image_index
    FROM angry_post_images_history
    ORDER BY used_at DESC
    LIMIT ?
  `);
  const rows = get.all(limit) as { image_index: number }[];
  return rows.map(row => row.image_index);
};

// Добавить использованное изображение злого поста
export const addUsedAngryImage = (imageIndex: number) => {
  // Сначала добавляем новый
  const insert = db.query(`
    INSERT INTO angry_post_images_history (image_index)
    VALUES (?)
  `);
  insert.run(imageIndex);

  // Затем удаляем старые, оставляя только последние 15
  const deleteOld = db.query(`
    DELETE FROM angry_post_images_history
    WHERE id NOT IN (
      SELECT id FROM angry_post_images_history
      ORDER BY used_at DESC
      LIMIT 15
    )
  `);
  deleteOld.run();

  databaseLogger.info({ imageIndex }, 'Добавлено использованное изображение злого поста');
};

// ============= ФУНКЦИИ ДЛЯ РАБОТЫ С ВЕЧЕРНИМИ ПОСТАМИ =============

export const getLastUsedEveningImages = (limit: number = 15) => {
  const get = db.query(`
    SELECT image_index
    FROM evening_images_history
    ORDER BY used_at DESC
    LIMIT ?
  `);
  const rows = get.all(limit) as { image_index: number }[];
  return rows.map(row => row.image_index);
};

export const addUsedEveningImage = (imageIndex: number) => {
  const insert = db.query(`
    INSERT INTO evening_images_history (image_index)
    VALUES (?)
  `);
  insert.run(imageIndex);

  // Удаляем старые, оставляя только последние 15
  const deleteOld = db.query(`
    DELETE FROM evening_images_history
    WHERE id NOT IN (
      SELECT id FROM evening_images_history
      ORDER BY used_at DESC
      LIMIT 15
    )
  `);
  deleteOld.run();

  databaseLogger.info({ imageIndex }, 'Добавлено использованное изображение вечернего поста');
};

// ============= ФУНКЦИИ ДЛЯ РАБОТЫ С УТРЕННИМИ ПОСТАМИ =============

// Получить текущую категорию для утренних постов
export const getMorningImageCategory = (): number => {
  const get = db.query(`
    SELECT current_category FROM morning_image_category LIMIT 1
  `);
  const row = get.get() as { current_category: number } | undefined;
  return row?.current_category || 1;
};

// Переключить категорию на следующую (1→2→3→1)
export const switchMorningImageCategory = (): number => {
  const currentCategory = getMorningImageCategory();
  const nextCategory = (currentCategory % 3) + 1; // 1→2, 2→3, 3→1

  const update = db.query(`
    UPDATE morning_image_category
    SET current_category = ?, updated_at = CURRENT_TIMESTAMP
  `);
  update.run(nextCategory);

  databaseLogger.info({ currentCategory, nextCategory }, 'Переключена категория утренних постов');
  return nextCategory;
};

// Получить последние использованные картинки утренних постов
export const getLastUsedMorningImages = (limit: number = 15) => {
  const get = db.query(`
    SELECT category, image_index
    FROM morning_images_history
    ORDER BY used_at DESC
    LIMIT ?
  `);
  const rows = get.all(limit) as { category: number; image_index: number }[];
  return rows.map(row => ({ category: row.category, imageIndex: row.image_index }));
};

// Добавить использованную картинку утреннего поста
export const addUsedMorningImage = (category: number, imageIndex: number) => {
  const insert = db.query(`
    INSERT INTO morning_images_history (category, image_index)
    VALUES (?, ?)
  `);
  insert.run(category, imageIndex);

  // Удаляем старые, оставляя только последние 15
  const deleteOld = db.query(`
    DELETE FROM morning_images_history
    WHERE id NOT IN (
      SELECT id FROM morning_images_history
      ORDER BY used_at DESC
      LIMIT 15
    )
  `);
  deleteOld.run();

  databaseLogger.info({ category, imageIndex }, 'Добавлена использованная картинка утреннего поста');
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
// isDmMode = true означает что пост в ЛС (диалог там же), false = пост в канале (диалог в комментариях)
export const saveMorningPost = (channelMessageId: number, userId: number, isDmMode: boolean = false) => {
  const insert = db.query(`
    INSERT INTO morning_posts (channel_message_id, user_id, current_step, is_dm_mode)
    VALUES (?, ?, 'waiting_user_message', ?)
  `);
  insert.run(channelMessageId, userId, isDmMode ? 1 : 0);
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
    is_dm_mode?: boolean;
  } | undefined;
};

// Получить утренний пост по thread ID (для сохранения в message_links)
export const getMorningPostByThreadId = async (threadId: number) => {
  // Сначала пробуем найти напрямую по channel_message_id
  const directGet = db.query(`
    SELECT * FROM morning_posts
    WHERE channel_message_id = ?
  `);
  let result = directGet.get(threadId);

  if (result) {
    return result as {
      id: number;
      channel_message_id: number;
      user_id: number;
      created_at: string;
      current_step: string;
      is_dm_mode?: boolean;
    };
  }

  // Если не нашли, пробуем через маппинг пересланных сообщений
  const mappedChannelId = getChannelMessageIdByThreadId(threadId);
  if (mappedChannelId) {
    result = directGet.get(mappedChannelId);
    if (result) {
      return result as {
        id: number;
        channel_message_id: number;
        user_id: number;
        created_at: string;
        current_step: string;
        is_dm_mode?: boolean;
      };
    }
  }

  return undefined;
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

// Обновить время последнего финального сообщения (для определения начала нового цикла)
export const updateMorningPostFinalMessageTime = (channelMessageId: number, timestamp: string) => {
  const update = db.query(`
    UPDATE morning_posts
    SET last_final_message_time = ?
    WHERE channel_message_id = ?
  `);
  update.run(timestamp, channelMessageId);
  databaseLogger.info({ channelMessageId, timestamp }, 'Обновлено время финального сообщения');
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

// ============= ФУНКЦИИ ДЛЯ РАБОТЫ С ИСТОЧНИКАМИ РАДОСТИ =============

// Добавить источник радости
export const addJoySource = (chatId: number, text: string, sourceType: 'manual' | 'auto' = 'manual') => {
  const insert = db.query(`
    INSERT INTO joy_sources (chat_id, text, source_type, created_at)
    VALUES (?, ?, ?, datetime('now'))
  `);
  insert.run(chatId, text, sourceType);
  databaseLogger.info({ chatId, sourceType }, 'Добавлен источник радости');
};

// Получить все источники радости пользователя
export const getAllJoySources = (chatId: number) => {
  const get = db.query(`
    SELECT * FROM joy_sources
    WHERE chat_id = ?
    ORDER BY created_at DESC
  `);
  return get.all(chatId) as Array<{
    id: number;
    chat_id: number;
    text: string;
    source_type: string;
    created_at: string;
  }>;
};

// Удалить источники радости по ID
export const deleteJoySourcesByIds = (chatId: number, ids: number[]) => {
  if (ids.length === 0) return;

  const placeholders = ids.map(() => '?').join(',');
  const deleteQuery = db.query(`
    DELETE FROM joy_sources
    WHERE chat_id = ? AND id IN (${placeholders})
  `);
  deleteQuery.run(chatId, ...ids);
  databaseLogger.info({ chatId, idsCount: ids.length }, 'Удалены источники радости по ID');
};

// Очистить весь список источников радости
export const clearAllJoySources = (chatId: number) => {
  const deleteQuery = db.query(`
    DELETE FROM joy_sources
    WHERE chat_id = ?
  `);
  deleteQuery.run(chatId);
  databaseLogger.info({ chatId }, 'Очищен весь список источников радости');
};

// Сохранить эмоцию радости/любви для последующего анализа
export const saveJoyEmotion = (
  chatId: number,
  text: string,
  emotionType: 'joy' | 'love',
  sourceContext: 'morning_post' | 'main_post' | 'plushki'
) => {
  const insert = db.query(`
    INSERT INTO joy_emotions (chat_id, text, emotion_type, source_context, created_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `);
  insert.run(chatId, text, emotionType, sourceContext);
  databaseLogger.info({ chatId, emotionType, sourceContext }, 'Сохранена эмоция радости/любви');
};

// Получить эмоции радости/любви пользователя за последнюю неделю
export const getJoyEmotionsLastWeek = (chatId: number) => {
  const get = db.query(`
    SELECT * FROM joy_emotions
    WHERE chat_id = ?
    AND datetime(created_at) > datetime('now', '-7 days')
    ORDER BY created_at DESC
  `);
  return get.all(chatId) as Array<{
    id: number;
    chat_id: number;
    text: string;
    emotion_type: string;
    source_context: string;
    created_at: string;
  }>;
};

// Получить сообщения пользователя только для текущего цикла утренней лягушки
// (с момента создания утреннего поста до текущего момента)
// ВАЖНО: Используется для получения ВСЕГО контекста дня (для связности)
export const getMorningPostUserMessages = (chatId: number, channelMessageId: number) => {
  // Получаем время создания утреннего поста
  const morningPost = getMorningPost(channelMessageId);
  if (!morningPost) {
    databaseLogger.warn({ chatId, channelMessageId }, 'Утренний пост не найден для получения сообщений');
    return [];
  }

  const postCreatedAt = morningPost.created_at;

  // Получаем все сообщения пользователя после создания утреннего поста
  const getMessages = db.query(`
    SELECT m.message_text, m.sent_time, m.author_id, u.id as user_id
    FROM messages m
    JOIN users u ON m.user_id = u.id
    WHERE u.chat_id = ?
    AND m.author_id = u.chat_id
    AND datetime(m.sent_time) > datetime(?)
    ORDER BY m.sent_time ASC
  `);

  const messages = getMessages.all(chatId, postCreatedAt) as Array<{
    message_text: string;
    sent_time: string;
    author_id: number;
    user_id: number;
  }>;

  databaseLogger.info(
    {
      chatId,
      channelMessageId,
      postCreatedAt,
      messagesCount: messages.length,
      timeRange: `> ${postCreatedAt}`
    },
    '📋 Получены ВСЕ сообщения утреннего дня'
  );

  return messages;
};

// Получить сообщения пользователя ПОСЛЕ последнего финального ответа бота
// (для анализа НОВОЙ ситуации в текущем цикле)
export const getMorningPostMessagesAfterLastFinal = (chatId: number, channelMessageId: number) => {
  // Получаем утренний пост
  const morningPost = getMorningPost(channelMessageId) as {
    id: number;
    channel_message_id: number;
    user_id: number;
    created_at: string;
    current_step: string;
    last_final_message_time?: string | null;
  } | undefined;

  if (!morningPost) {
    databaseLogger.warn({ chatId, channelMessageId }, 'Утренний пост не найден');
    return [];
  }

  // Используем время последнего финального сообщения из поля last_final_message_time
  // Если его нет - берем created_at (это первый цикл)
  const afterTime = morningPost.last_final_message_time || morningPost.created_at;

  // Получаем все сообщения пользователя после последнего финального ответа
  const getMessages = db.query(`
    SELECT m.message_text, m.sent_time, m.author_id, u.id as user_id
    FROM messages m
    JOIN users u ON m.user_id = u.id
    WHERE u.chat_id = ?
    AND m.author_id = u.chat_id
    AND datetime(m.sent_time) > datetime(?)
    ORDER BY m.sent_time ASC
  `);

  const messages = getMessages.all(chatId, afterTime) as Array<{
    message_text: string;
    sent_time: string;
    author_id: number;
    user_id: number;
  }>;

  databaseLogger.info(
    {
      chatId,
      channelMessageId,
      afterTime,
      hasLastFinal: !!morningPost.last_final_message_time,
      messagesCount: messages.length,
      timeRange: `> ${afterTime}`
    },
    '📋 Получены сообщения НОВОГО цикла (после последнего финального ответа)'
  );

  return messages;
};

// ============================================
// Функции для работы с индексами утренних сообщений
// ============================================

// Получить индексы утренних сообщений пользователя
export const getMorningMessageIndexes = (userId: number) => {
  const query = db.query(`
    SELECT weekday_index, weekend_index, greeting_index, evening_index, joy_main_index,
           used_mon, used_wed, used_thu, used_sun,
           morning_intro_shown, evening_intro_shown, updated_at
    FROM morning_message_indexes
    WHERE user_id = ?
    LIMIT 1
  `);
  const result = query.get(userId) as {
    weekday_index: number;
    weekend_index: number;
    greeting_index: number;
    evening_index: number;
    joy_main_index?: number; // Опционально для совместимости со старыми записями
    used_mon: number;
    used_wed: number;
    used_thu: number;
    used_sun: number;
    morning_intro_shown: number;
    evening_intro_shown: number;
    updated_at: string;
  } | undefined;

  // Если записи нет или joy_main_index отсутствует, добавляем дефолт
  if (result && result.joy_main_index === undefined) {
    result.joy_main_index = 0;
  }

  return result as {
    weekday_index: number;
    weekend_index: number;
    greeting_index: number;
    evening_index: number;
    joy_main_index: number; // Теперь всегда определён
    used_mon: number;
    used_wed: number;
    used_thu: number;
    used_sun: number;
    morning_intro_shown: number;
    evening_intro_shown: number;
    updated_at: string;
  } | undefined;
};

// Сохранить индексы утренних сообщений пользователя
export const saveMorningMessageIndexes = (
  userId: number,
  weekdayIndex: number,
  weekendIndex: number,
  greetingIndex: number,
  usedMon: boolean,
  usedWed: boolean,
  usedThu: boolean,
  usedSun: boolean,
  eveningIndex: number = 0,
  morningIntroShown: boolean = false,
  eveningIntroShown: boolean = false,
  joyMainIndex: number = 0
) => {
  try {
    const upsert = db.query(`
      INSERT INTO morning_message_indexes
        (user_id, weekday_index, weekend_index, greeting_index, evening_index, joy_main_index,
         used_mon, used_wed, used_thu, used_sun,
         morning_intro_shown, evening_intro_shown, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET
        weekday_index = excluded.weekday_index,
        weekend_index = excluded.weekend_index,
        greeting_index = excluded.greeting_index,
        evening_index = excluded.evening_index,
        joy_main_index = excluded.joy_main_index,
        used_mon = excluded.used_mon,
        used_wed = excluded.used_wed,
        used_thu = excluded.used_thu,
        used_sun = excluded.used_sun,
        morning_intro_shown = excluded.morning_intro_shown,
        evening_intro_shown = excluded.evening_intro_shown,
        updated_at = excluded.updated_at
    `);
    upsert.run(
      userId,
      weekdayIndex,
      weekendIndex,
      greetingIndex,
      eveningIndex,
      joyMainIndex,
      usedMon ? 1 : 0,
      usedWed ? 1 : 0,
      usedThu ? 1 : 0,
      usedSun ? 1 : 0,
      morningIntroShown ? 1 : 0,
      eveningIntroShown ? 1 : 0
    );
    databaseLogger.debug({ userId, weekdayIndex, weekendIndex, greetingIndex, eveningIndex, joyMainIndex }, 'Индексы сообщений сохранены');
  } catch (e) {
    const error = e as Error;
    databaseLogger.error({ error: error.message, stack: error.stack, userId }, 'Ошибка сохранения индексов сообщений');
  }
};

// Установить флаг morning_intro_shown для пользователя (упрощенная версия)
export const setMorningIntroShown = (userId: number, shown: boolean) => {
  try {
    // Получаем текущие индексы
    const current = getMorningMessageIndexes(userId);

    if (!current) {
      // Если записи нет - создаем с дефолтными значениями
      saveMorningMessageIndexes(
        userId,
        0, // weekdayIndex
        0, // weekendIndex
        0, // greetingIndex
        false, // usedMon
        false, // usedWed
        false, // usedThu
        false, // usedSun
        0, // eveningIndex
        shown, // morningIntroShown
        false, // eveningIntroShown
        0 // joyMainIndex
      );
    } else {
      // Обновляем только флаг morning_intro_shown
      const update = db.query(`
        UPDATE morning_message_indexes
        SET morning_intro_shown = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
      `);
      update.run(shown ? 1 : 0, userId);
    }

    databaseLogger.debug({ userId, shown }, 'Флаг morning_intro_shown обновлен');
  } catch (e) {
    const error = e as Error;
    databaseLogger.error({ error: error.message, userId }, 'Ошибка установки morning_intro_shown');
  }
};

// ========================================
// ФУНКЦИИ ДЛЯ РАБОТЫ С ПОЗИТИВНЫМИ СОБЫТИЯМИ (СПИСОК РАДОСТИ)
// ========================================

/**
 * Сохранить позитивное событие
 * @param userId - ID пользователя
 * @param eventText - Текст события
 * @param emotionsText - Текст эмоций (может быть пустым)
 * @param cycleIdentifier - ID цикла (channel_message_id)
 */
export const savePositiveEvent = (
  userId: number,
  eventText: string,
  emotionsText: string,
  cycleIdentifier?: string
) => {
  try {
    const stmt = db.query(`
      INSERT INTO positive_events (user_id, event_text, emotions_text, created_at, cycle_identifier)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(userId, eventText, emotionsText || '', new Date().toISOString(), cycleIdentifier || null);
    databaseLogger.info({ userId, cycleIdentifier }, 'Позитивное событие сохранено');
  } catch (e) {
    const error = e as Error;
    databaseLogger.error({ error: error.message, stack: error.stack, userId }, 'Ошибка сохранения позитивного события');
  }
};

/**
 * Сохранить негативное событие
 * @param userId - ID пользователя
 * @param eventText - Текст события
 * @param emotionsText - Текст эмоций (может быть пустым)
 * @param cycleIdentifier - ID цикла (channel_message_id)
 */
export const saveNegativeEvent = (
  userId: number,
  eventText: string,
  emotionsText: string,
  cycleIdentifier?: string
) => {
  try {
    const stmt = db.query(`
      INSERT INTO negative_events (user_id, event_text, emotions_text, created_at, cycle_identifier)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(userId, eventText, emotionsText || '', new Date().toISOString(), cycleIdentifier || null);
    databaseLogger.info({ userId, cycleIdentifier }, 'Негативное событие сохранено');
  } catch (e) {
    const error = e as Error;
    databaseLogger.error({ error: error.message, stack: error.stack, userId }, 'Ошибка сохранения негативного события');
  }
};

/**
 * Получить позитивные события с последнего checkpoint
 * @param userId - ID пользователя
 * @param checkpointTime - ISO timestamp последнего checkpoint
 * @returns Массив позитивных событий
 */
export const getPositiveEventsSinceCheckpoint = (userId: number, checkpointTime: string) => {
  try {
    const stmt = db.query(`
      SELECT * FROM positive_events
      WHERE user_id = ? AND created_at > ?
      ORDER BY created_at ASC
    `);

    return stmt.all(userId, checkpointTime) as Array<{
      id: number;
      user_id: number;
      event_text: string;
      emotions_text: string;
      created_at: string;
      post_type: string;
      cycle_identifier: string | null;
    }>;
  } catch (e) {
    const error = e as Error;
    databaseLogger.error({ error: error.message, stack: error.stack, userId }, 'Ошибка получения позитивных событий');
    return [];
  }
};

/**
 * Получить checkpoint пользователя (время последнего изменения списка радости)
 * @param userId - ID пользователя
 * @returns Объект с checkpoint_time или null
 */
export const getJoyCheckpoint = (userId: number) => {
  try {
    const stmt = db.query(`
      SELECT * FROM joy_list_checkpoints WHERE user_id = ?
    `);

    return stmt.get(userId) as { id: number; user_id: number; checkpoint_time: string } | null;
  } catch (e) {
    const error = e as Error;
    databaseLogger.error({ error: error.message, stack: error.stack, userId }, 'Ошибка получения checkpoint');
    return null;
  }
};

/**
 * Обновить checkpoint пользователя (время последнего изменения списка радости)
 * @param userId - ID пользователя
 * @param checkpointTime - ISO timestamp
 */
export const updateJoyCheckpoint = (userId: number, checkpointTime: string) => {
  try {
    const stmt = db.query(`
      INSERT INTO joy_list_checkpoints (user_id, checkpoint_time)
      VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET checkpoint_time = ?
    `);

    stmt.run(userId, checkpointTime, checkpointTime);
    databaseLogger.info({ userId, checkpointTime }, 'Checkpoint списка радости обновлен');
  } catch (e) {
    const error = e as Error;
    databaseLogger.error({ error: error.message, stack: error.stack, userId }, 'Ошибка обновления checkpoint');
  }
};

/**
 * Проверить пустой ли список радости (для выбора вводный/основной сценарий)
 * @param userId - ID пользователя
 * @returns true если список пустой, false если содержит хотя бы один пункт
 */
export const isJoyListEmpty = (userId: number): boolean => {
  try {
    const sources = getAllJoySources(userId);
    return sources.length === 0;
  } catch (e) {
    const error = e as Error;
    databaseLogger.error({ error: error.message, stack: error.stack, userId }, 'Ошибка проверки пустоты списка радости');
    return true; // По умолчанию считаем пустым в случае ошибки
  }
};

/**
 * Проверка, достаточно ли взаимодействий пользователя в вечерних постах для показа Joy
 * @param userId - ID пользователя (НЕ chat_id!)
 * @param minInteractions - минимальное количество взаимодействий (по умолчанию 2)
 * @returns true если пользователь взаимодействовал достаточно раз, false если нет
 */
export const hasEnoughEveningInteractions = (userId: number, minInteractions: number = 2): boolean => {
  try {
    // Подсчитываем количество уникальных дней, когда пользователь писал сообщения
    // (author_id = userId означает что сообщение от пользователя, а не от бота)
    const stmt = db.query(`
      SELECT COUNT(DISTINCT DATE(sent_time)) as interaction_days
      FROM messages
      WHERE user_id = ?
      AND author_id = ?
      AND sent_time IS NOT NULL
    `);

    const result = stmt.get(userId, userId) as { interaction_days: number } | undefined;

    if (!result) {
      databaseLogger.warn({ userId }, 'Нет данных о взаимодействиях пользователя, не показываем Joy');
      return false;
    }

    const interactionDays = result.interaction_days || 0;

    databaseLogger.info(
      { userId, interactionDays, minInteractions },
      'Проверка активности пользователя в вечерних постах'
    );

    return interactionDays >= minInteractions;
  } catch (e) {
    const error = e as Error;
    databaseLogger.error(
      { error: error.message, stack: error.stack, userId },
      'Ошибка проверки активности пользователя'
    );
    return false; // По умолчанию не показываем Joy в случае ошибки
  }
};

/**
 * Проверить прошло ли достаточно дней с первого вечернего поста для показа Joy
 * @param userId - ID пользователя
 * @param minDays - минимальное количество дней (по умолчанию 2)
 * @returns true если прошло достаточно дней, false если нет (или ошибка - fallback к показу Joy)
 */
export const hasPassedDaysSinceFirstEveningPost = (userId: number, minDays: number = 2): boolean => {
  try {
    const stmt = db.query(`
      SELECT first_evening_post_date
      FROM users
      WHERE id = ?
    `);

    const result = stmt.get(userId) as { first_evening_post_date: string | null } | undefined;

    // Если нет записи о первом посте - это первый раз, устанавливаем дату
    if (!result || !result.first_evening_post_date) {
      databaseLogger.info({ userId }, 'Первый вечерний пост - устанавливаем дату');
      const now = new Date().toISOString();
      const updateStmt = db.query(`
        UPDATE users
        SET first_evening_post_date = ?
        WHERE id = ?
      `);
      updateStmt.run(now, userId);
      return false; // Первый раз - не показываем Joy
    }

    // Проверяем сколько дней прошло
    const firstPostDate = new Date(result.first_evening_post_date);
    const now = new Date();
    const daysPassed = Math.floor((now.getTime() - firstPostDate.getTime()) / (1000 * 60 * 60 * 24));

    databaseLogger.info(
      { userId, firstPostDate: result.first_evening_post_date, daysPassed, minDays },
      'Проверка дней с первого вечернего поста'
    );

    return daysPassed >= minDays;
  } catch (e) {
    const error = e as Error;
    databaseLogger.error(
      { error: error.message, stack: error.stack, userId },
      'Ошибка проверки дней с первого поста - FALLBACK: показываем Joy'
    );
    return true; // Fallback: при ошибке показываем Joy
  }
};

/**
 * Получить количество отправленных вечерних постов для пользователя
 * @param chatId - Chat ID пользователя (не внутренний id!)
 * @returns Количество отправленных вечерних постов
 */
export const getEveningPostsCount = (chatId: number): number => {
  try {
    const stmt = db.query(`
      SELECT evening_posts_count
      FROM users
      WHERE chat_id = ?
    `);
    const result = stmt.get(chatId) as { evening_posts_count: number | null } | undefined;
    return result?.evening_posts_count ?? 0;
  } catch (e) {
    const error = e as Error;
    databaseLogger.error(
      { error: error.message, stack: error.stack, chatId },
      'Ошибка получения счетчика вечерних постов'
    );
    return 0;
  }
};

/**
 * Увеличить счетчик отправленных вечерних постов для пользователя
 * @param chatId - Chat ID пользователя (не внутренний id!)
 */
export const incrementEveningPostsCount = (chatId: number): void => {
  try {
    const stmt = db.query(`
      UPDATE users
      SET evening_posts_count = evening_posts_count + 1
      WHERE chat_id = ?
    `);
    stmt.run(chatId);

    const newCount = getEveningPostsCount(chatId);
    databaseLogger.info({ chatId, newCount }, '✅ Увеличен счетчик вечерних постов');
  } catch (e) {
    const error = e as Error;
    databaseLogger.error(
      { error: error.message, stack: error.stack, chatId },
      '❌ Ошибка увеличения счетчика вечерних постов'
    );
  }
};

/**
 * Проверить, достаточно ли вечерних постов для показа Joy поста
 * @param chatId - Chat ID пользователя (не внутренний id!)
 * @param minPosts - Минимальное количество постов (по умолчанию 3)
 * @returns true если постов >= minPosts
 */
export const hasEnoughEveningPosts = (chatId: number, minPosts: number = 3): boolean => {
  const count = getEveningPostsCount(chatId);
  databaseLogger.info(
    { chatId, count, minPosts, hasEnough: count >= minPosts },
    'Проверка количества вечерних постов для Joy'
  );
  return count >= minPosts;
};

/**
 * Получить всех пользователей, у которых последнее сообщение от пользователя
 * и после него НЕТ ответа от бота
 * Возвращает: chat_id, последнее сообщение пользователя, время
 */
export const getUsersWithUnansweredMessages = () => {
  try {
    const query = db.query(`
      SELECT
        u.chat_id,
        u.username,
        last_user.message_text as last_message,
        last_user.sent_time as last_message_time,
        last_user.telegram_message_id,
        last_user.chat_id as message_chat_id
      FROM users u
      INNER JOIN (
        -- Получаем последнее сообщение для каждого пользователя (от пользователя или бота)
        SELECT
          user_id,
          message_text,
          sent_time,
          author_id,
          telegram_message_id,
          chat_id,
          ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY sent_time DESC) as rn
        FROM messages
      ) last_user ON u.id = last_user.user_id AND last_user.rn = 1
      WHERE last_user.author_id = u.id  -- Последнее сообщение от пользователя, не от бота
      ORDER BY last_user.sent_time DESC
    `);

    const results = query.all() as Array<{
      chat_id: number;
      username: string;
      last_message: string;
      last_message_time: string;
      telegram_message_id: number | null;
      message_chat_id: number | null;
    }>;

    databaseLogger.info(
      { count: results.length },
      'Найдено пользователей с необработанными сообщениями'
    );

    return results;
  } catch (e) {
    const error = e as Error;
    databaseLogger.error(
      { error: error.message, stack: error.stack },
      'Ошибка поиска пользователей с необработанными сообщениями'
    );
    return [];
  }
};

/**
 * Помечает сообщения пользователя как обработанные по channel_message_id
 * Используется после СИНХРОННОГО сохранения плюшек/негативных событий
 * чтобы batch processor не обработал их повторно
 */
export function markMessagesAsProcessedByChannel(channelMessageId: number, userId: number): void {
  try {
    const update = db.query(`
      UPDATE message_links
      SET processed_at = datetime('now')
      WHERE channel_message_id = ?
        AND user_id = ?
        AND message_type = 'user'
        AND processed_at IS NULL
    `);

    const result = update.run(channelMessageId, userId);

    databaseLogger.debug(
      { channelMessageId, userId, affectedRows: result.changes },
      '✅ Сообщения помечены как обработанные (синхронное сохранение событий)'
    );
  } catch (e) {
    const error = e as Error;
    databaseLogger.error(
      { error: error.message, stack: error.stack, channelMessageId, userId },
      'Ошибка пометки сообщений как обработанных'
    );
  }
}

// ============= ФУНКЦИИ ДЛЯ РАБОТЫ С ОНБОРДИНГОМ =============

/**
 * Обновить состояние онбординга пользователя
 * @param chatId - Chat ID пользователя
 * @param state - Состояние: 'waiting_start' | 'waiting_name' | null (завершен)
 */
export const updateOnboardingState = (chatId: number, state: string | null): void => {
  try {
    const stmt = db.query(`
      UPDATE users
      SET onboarding_state = ?
      WHERE chat_id = ?
    `);
    stmt.run(state, chatId);
    databaseLogger.info({ chatId, state }, '✅ Обновлено состояние онбординга');
  } catch (e) {
    const error = e as Error;
    databaseLogger.error(
      { error: error.message, stack: error.stack, chatId, state },
      '❌ Ошибка обновления состояния онбординга'
    );
  }
};

// ============= ФУНКЦИИ ДЛЯ СИСТЕМЫ ПРИОРИТЕТА КОМАНД =============

/**
 * Найти активные DM посты пользователя
 * Возвращает массив постов с типом и состоянием, отсортированный по дате (самые свежие первыми)
 * @param userId - User ID пользователя
 */
export function findUserActiveDmPosts(userId: number): Array<{
  type: 'morning' | 'evening';
  channel_message_id: number;
  current_state: string;
  created_at: string;
}> {
  try {
    const query = db.query(`
      SELECT
        'morning' as type,
        channel_message_id,
        current_step as current_state,
        created_at
      FROM morning_posts
      WHERE user_id = ?
        AND is_dm_mode = 1
        AND current_step NOT IN ('completed')

      UNION ALL

      SELECT
        'evening' as type,
        channel_message_id,
        current_state,
        created_at
      FROM interactive_posts
      WHERE user_id = ?
        AND is_dm_mode = 1
        AND (current_state IS NULL OR current_state NOT IN ('finished'))

      ORDER BY created_at DESC
    `);

    return query.all(userId, userId) as any[];
  } catch (e) {
    const error = e as Error;
    databaseLogger.error(
      { error: error.message, stack: error.stack, userId },
      '❌ Ошибка поиска активных DM постов'
    );
    return [];
  }
}

// === Вспомогательные функции для тестов ===

// Вставить интерактивный пост напрямую (для тестов)
export const insertInteractivePost = (
  channelMessageId: number,
  userId: number,
  isDmMode: boolean,
  messageData: any,
  currentState: string
) => {
  const insert = db.query(`
    INSERT INTO interactive_posts (
      channel_message_id, user_id, message_data, relaxation_type,
      is_dm_mode, current_state, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  insert.run(
    channelMessageId,
    userId,
    JSON.stringify(messageData),
    'breathing',
    isDmMode ? 1 : 0,
    currentState
  );
};

// Очистить интерактивные посты для пользователя (для тестов)
export const clearInteractivePosts = (userId: number) => {
  const del = db.query(`
    DELETE FROM interactive_posts WHERE user_id = ?
  `);
  del.run(userId);
};

// ============= ФУНКЦИИ ДЛЯ РАБОТЫ СО СТАТИСТИКОЙ /HELP =============

/**
 * Сохранить факт использования команды /help с выбором типа тревоги
 * @param userId - ID пользователя
 * @param anxietyType - Тип тревоги: 'acute', 'thoughts', 'background', 'people_places'
 */
export const saveHelpStatistics = (userId: number, anxietyType: string): void => {
  try {
    const stmt = db.query(`
      INSERT INTO help_statistics (user_id, anxiety_type, created_at)
      VALUES (?, ?, datetime('now'))
    `);
    stmt.run(userId, anxietyType);
    databaseLogger.info({ userId, anxietyType }, '✅ Сохранена статистика /help');
  } catch (e) {
    const error = e as Error;
    databaseLogger.error(
      { error: error.message, stack: error.stack, userId, anxietyType },
      '❌ Ошибка сохранения статистики /help'
    );
  }
};

/**
 * Получить общую статистику использования команды /help
 * @param userId - ID пользователя (опционально, если не указан - общая статистика)
 * @returns Объект со статистикой: общее количество и по типам тревоги
 */
export const getHelpStatistics = (userId?: number) => {
  try {
    const query = userId
      ? db.query(`
          SELECT
            COUNT(*) as total,
            SUM(CASE WHEN anxiety_type = 'acute' THEN 1 ELSE 0 END) as acute_count,
            SUM(CASE WHEN anxiety_type = 'thoughts' THEN 1 ELSE 0 END) as thoughts_count,
            SUM(CASE WHEN anxiety_type = 'background' THEN 1 ELSE 0 END) as background_count,
            SUM(CASE WHEN anxiety_type = 'people_places' THEN 1 ELSE 0 END) as people_places_count
          FROM help_statistics
          WHERE user_id = ?
        `)
      : db.query(`
          SELECT
            COUNT(*) as total,
            SUM(CASE WHEN anxiety_type = 'acute' THEN 1 ELSE 0 END) as acute_count,
            SUM(CASE WHEN anxiety_type = 'thoughts' THEN 1 ELSE 0 END) as thoughts_count,
            SUM(CASE WHEN anxiety_type = 'background' THEN 1 ELSE 0 END) as background_count,
            SUM(CASE WHEN anxiety_type = 'people_places' THEN 1 ELSE 0 END) as people_places_count
          FROM help_statistics
        `);

    const result = userId
      ? query.get(userId)
      : query.get();

    return result as {
      total: number;
      acute_count: number;
      thoughts_count: number;
      background_count: number;
      people_places_count: number;
    };
  } catch (e) {
    const error = e as Error;
    databaseLogger.error(
      { error: error.message, stack: error.stack, userId },
      '❌ Ошибка получения статистики /help'
    );
    return {
      total: 0,
      acute_count: 0,
      thoughts_count: 0,
      background_count: 0,
      people_places_count: 0,
    };
  }
};
