import { db } from './src/db';

console.log('🔍 Тест SQL запроса из saveMessage:\n');

const chatId = 5153477378;

console.log(`Попытка найти user_id для chat_id=${chatId}:`);

const result = db.query(`SELECT id FROM users WHERE chat_id = ?`).get(chatId);

if (result) {
  console.log(`✅ Найден! user_id=${(result as any).id}`);
} else {
  console.log(`❌ НЕ найден!`);
}

console.log('\n🔍 Полный SQL запрос из saveMessage:');
console.log(`INSERT INTO messages (user_id, author_id, message_text, sent_time, telegram_message_id, chat_id)`);
console.log(`SELECT id, ?, ?, ?, ?, ? FROM users WHERE chat_id = ?`);

console.log('\n🔍 Проверяем что вернет SELECT:');
const selectResult = db.query(`SELECT id FROM users WHERE chat_id = ?`).get(chatId);
console.log('Результат SELECT:', selectResult);

console.log('\n🔍 Попробуем выполнить сам INSERT:');

try {
  const insertMessage = db.query(`
    INSERT INTO messages (user_id, author_id, message_text, sent_time, telegram_message_id, chat_id)
    SELECT id, ?, ?, ?, ?, ? FROM users WHERE chat_id = ?
  `);

  const testParams = [
    5153477378, // authorId
    'Тестовое сообщение', // messageText
    new Date().toISOString(), // sentTime
    99999, // telegramMessageId
    5153477378, // messageChatId
    5153477378  // chatId (последний параметр для WHERE)
  ];

  console.log('Параметры:', testParams);

  insertMessage.run(...testParams);

  console.log('✅ INSERT выполнен успешно!');

  // Проверим что сообщение добавилось
  const check = db.query(`SELECT * FROM messages WHERE telegram_message_id = 99999`).get();
  console.log('Добавленное сообщение:', check);

  // Удалим тестовое
  db.query(`DELETE FROM messages WHERE telegram_message_id = 99999`).run();
  console.log('✅ Тестовое сообщение удалено');

} catch (error) {
  console.log('❌ Ошибка при INSERT:', (error as Error).message);
}
