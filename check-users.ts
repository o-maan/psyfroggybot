import { db } from './src/db';

console.log('🔍 Проверка пользователей в таблице users:\n');

const users = db.query('SELECT chat_id, username, id FROM users').all();
console.log(`Найдено пользователей: ${users.length}\n`);

for (const user of users as any[]) {
  console.log(`  id=${user.id}, chat_id=${user.chat_id}, username=${user.username || 'N/A'}`);
}

console.log('\n🔍 Проверка уникальных user_id в message_links:\n');

const uniqueUserIds = db.query(`
  SELECT DISTINCT user_id FROM message_links WHERE message_type = 'user'
`).all() as { user_id: number }[];

console.log(`Уникальных user_id в message_links: ${uniqueUserIds.length}\n`);

for (const { user_id } of uniqueUserIds) {
  const userExists = db.query('SELECT 1 FROM users WHERE chat_id = ?').get(user_id);
  console.log(`  user_id=${user_id}, exists in users: ${userExists ? '✅' : '❌'}`);
}

console.log('\n🔍 Проверка параметров в saveMessage:\n');
console.log('saveMessage вызывается так:');
console.log('  saveMessage(userId, messageText, timestamp, userId, messageId, userId)');
console.log('\nSQL запрос в saveMessage:');
console.log('  INSERT INTO messages (...) SELECT id, ?, ?, ?, ?, ? FROM users WHERE chat_id = ?');
console.log('\nПоследний параметр (chatId) = userId = значение из user_id в message_links');
console.log('Этот параметр должен совпадать с chat_id в таблице users\n');
