import { db } from './src/db';

console.log('🔍 Анализ дат сообщений:\n');

// Сообщения в message_links по датам
console.log('📅 message_links - сообщения по датам:');
const linksDates = db.query(`
  SELECT DATE(created_at) as date, COUNT(*) as count
  FROM message_links
  WHERE message_type = 'user' AND user_id IN (476561547, 5153477378)
  GROUP BY DATE(created_at)
  ORDER BY date DESC
  LIMIT 10
`).all();

for (const row of linksDates as any[]) {
  console.log(`  ${row.date}: ${row.count} сообщений`);
}

// Сообщения в messages по датам
console.log('\n📅 messages - сообщения по датам:');
const messagesDates = db.query(`
  SELECT DATE(sent_time) as date, COUNT(*) as count
  FROM messages
  WHERE chat_id IN (476561547, 5153477378)
  GROUP BY DATE(sent_time)
  ORDER BY date DESC
  LIMIT 10
`).all();

for (const row of messagesDates as any[]) {
  console.log(`  ${row.date}: ${row.count} сообщений`);
}

// Сегодняшние сообщения
const today = new Date().toISOString().split('T')[0];
console.log(`\n📅 Сообщения за СЕГОДНЯ (${today}):\n`);

const todayLinks = db.query(`
  SELECT COUNT(*) as count FROM message_links
  WHERE message_type = 'user'
    AND user_id IN (476561547, 5153477378)
    AND DATE(created_at) = ?
`).get(today) as { count: number };

const todayMessages = db.query(`
  SELECT COUNT(*) as count FROM messages
  WHERE chat_id IN (476561547, 5153477378)
    AND DATE(sent_time) = ?
`).get(today) as { count: number };

console.log(`  message_links: ${todayLinks.count}`);
console.log(`  messages: ${todayMessages.count}`);
console.log(`  Разница: ${todayLinks.count - todayMessages.count}`);

if (todayLinks.count === todayMessages.count) {
  console.log('\n✅ СЕГОДНЯ все сообщения сохранились корректно!');
  console.log('   Значит мой код работает, просто он добавился СЕГОДНЯ');
} else if (todayMessages.count === 0) {
  console.log('\n⚠️ Сегодня еще нет сообщений в messages (может middleware еще не сработал?)');
} else {
  console.log('\n❌ Сегодня тоже есть проблемы с сохранением');
}
