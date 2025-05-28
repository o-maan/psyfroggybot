import { Database } from "bun:sqlite";
import fs from 'fs';

// pwd
console.log(process.cwd())
try {
  console.log(fs.readdirSync('/'))
} catch (e) {
  console.log(e)
}

console.log(fs.readdirSync('.'))

// Создаем базу данных
export const db = new Database("/data/froggy.db", { create: true });

// Создаем таблицы при первом запуске
db.query(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    chat_id INTEGER UNIQUE,
    username TEXT,
    last_response_time TEXT,
    response_count INTEGER DEFAULT 0
  )
`).run();

db.query(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    message_text TEXT,
    sent_time TEXT,
    response_time TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`).run();

// Функции для работы с пользователями
export const addUser = (chatId: number, username: string) => {
  const insertUser = db.query('INSERT OR IGNORE INTO users (chat_id, username) VALUES (?, ?)');
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
  return getStats.get(chatId) as { response_count: number; last_response_time: string } | undefined;
};

// Функции для работы с сообщениями
export const saveMessage = (chatId: number, messageText: string, sentTime: string) => {
  const insertMessage = db.query(`
    INSERT INTO messages (user_id, message_text, sent_time)
    SELECT id, ?, ? FROM users WHERE chat_id = ?
  `);
  insertMessage.run(messageText, sentTime, chatId);
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
    WHERE u.chat_id = ?
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
    WHERE u.chat_id = ?
    ORDER BY m.sent_time DESC
    LIMIT ?
  `);
  return getMessages.all(chatId, n) as { message_text: string; sent_time: string }[];
}; 