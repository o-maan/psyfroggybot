import { db } from './src/db';

const today = new Date().toISOString().split('T')[0];

console.log(`🔍 Анализ СЕГОДНЯШНИХ сообщений (${today}):\n`);

// Все сообщения из message_links за сегодня
const linksToday = db.query(`
  SELECT message_id, user_id, message_preview, created_at
  FROM message_links
  WHERE message_type = 'user'
    AND DATE(created_at) = ?
  ORDER BY created_at ASC
`).all(today);

console.log(`Всего сообщений в message_links за сегодня: ${linksToday.length}\n`);

// Проверяем какие из них есть в messages
let foundCount = 0;
let missingMessages: any[] = [];

for (const link of linksToday as any[]) {
  const exists = db.query(`
    SELECT 1 FROM messages WHERE telegram_message_id = ?
  `).get(link.message_id);

  if (exists) {
    foundCount++;
  } else {
    missingMessages.push(link);
  }
}

console.log(`✅ Найдено в messages: ${foundCount}`);
console.log(`❌ Отсутствует в messages: ${missingMessages.length}\n`);

if (missingMessages.length > 0) {
  console.log('📋 Отсутствующие сообщения:\n');
  for (const msg of missingMessages) {
    console.log(`  msg_id=${msg.message_id}, user_id=${msg.user_id}, text="${(msg.message_preview || '').substring(0, 40)}...", time=${msg.created_at}`);
  }

  // Проверяем user_id отсутствующих
  const uniqueUserIds = [...new Set(missingMessages.map(m => m.user_id))];
  console.log(`\n🔍 Уникальные user_id отсутствующих сообщений: ${uniqueUserIds.join(', ')}`);

  for (const userId of uniqueUserIds) {
    const userExists = db.query('SELECT 1 FROM users WHERE chat_id = ?').get(userId);
    console.log(`  user_id=${userId}: ${userExists ? '✅ есть в users' : '❌ НЕТ в users'}`);
  }
}
