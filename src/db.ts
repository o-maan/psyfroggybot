import { Database } from "bun:sqlite";
import fs from "fs";

try {
  console.log('🔍 DB - fs.readdirSync("/data")', fs.readdirSync("/data"));
} catch (e) {
  console.log(e);
}

// Создаем базу данных
export const db = new Database("/data/froggy.db", { create: true });

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

// Функции для работы с пользователями
export const addUser = (chatId: number, username: string) => {
  const insertUser = db.query(
    "INSERT OR IGNORE INTO users (chat_id, username) VALUES (?, ?)"
  );
  insertUser.run(chatId, username);
};

export const updateUserResponse = (chatId: number, responseTime: string) => {
  const updateUser = db.query(`
    UPDATE users 
    SET last_response_time = ?, response_count = response_count + 1 
    WHERE chat_id = ?
  `);
  updateUser.run(responseTime, chatId);
};

export const getUserResponseStats = (chatId: number) => {
  const getStats = db.query(`
    SELECT response_count, last_response_time 
    FROM users 
    WHERE chat_id = ?
  `);
  return getStats.get(chatId) as
    | { response_count: number; last_response_time: string }
    | undefined;
};

// Функции для работы с сообщениями
export const saveMessage = (
  chatId: number,
  messageText: string,
  sentTime: string
) => {
  const insertMessage = db.query(`
    INSERT INTO messages (user_id, message_text, sent_time)
    SELECT id, ?, ? FROM users WHERE chat_id = ?
  `);
  insertMessage.run(messageText, sentTime, chatId);
};

export const updateMessageResponse = (
  chatId: number,
  sentTime: string,
  responseTime: string
) => {
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
    WHERE u.chat_id = ?
    ORDER BY m.sent_time DESC
    LIMIT 1
  `);
  return getMessage.get(chatId) as
    | { message_text: string; sent_time: string }
    | undefined;
};

// Получить последние N сообщений, отправленных ботом пользователю
export const getLastNBotMessages = (chatId: number, n: number) => {
  const getMessages = db.query(`
    SELECT m.message_text, m.sent_time
    FROM messages m
    JOIN users u ON m.user_id = u.id
    WHERE u.chat_id = ?
    ORDER BY m.sent_time DESC
    LIMIT ?
  `);
  return getMessages.all(chatId, n) as {
    message_text: string;
    sent_time: string;
  }[];
};

// Сохранить токен для пользователя
export const saveUserToken = (chatId: number, token: string) => {
  const insertToken = db.query(`
    INSERT INTO user_tokens (chat_id, token) VALUES (?, ?)
  `);
  insertToken.run(chatId, token);
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
  return getToken.get(chatId) as
    | { token: string; created_at: string }
    | undefined;
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
  } catch (e) {
    console.error("❌ Ошибка при сохранении индекса картинки пользователя:", e);
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
  return getIndex.get(chatId) as
    | { image_index: number; updated_at: string }
    | undefined;
};

// Удалить все токены пользователя (например, при сбросе авторизации Google Calendar)
export const clearUserTokens = (chatId: number) => {
  const del = db.query(`
    DELETE FROM user_tokens WHERE chat_id = ?
  `);
  del.run(chatId);
};
