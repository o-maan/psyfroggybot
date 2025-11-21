import { db } from './src/db';

const today = new Date().toISOString().split('T')[0];

console.log(`🎯 Проверка СЕГОДНЯШНИХ сообщений от РЕАЛЬНЫХ пользователей (${today}):\n`);

// Сообщения от реальных пользователей за сегодня в message_links
const todayLinksReal = db.query(`
  SELECT COUNT(*) as count FROM message_links
  WHERE message_type = 'user'
    AND user_id IN (476561547, 5153477378)
    AND DATE(created_at) = ?
`).get(today) as { count: number };

console.log(`📊 message_links (сегодня, реальные пользователи): ${todayLinksReal.count}`);

// Сообщения от реальных пользователей за сегодня в messages
const todayMessagesReal = db.query(`
  SELECT COUNT(*) as count FROM messages
  WHERE chat_id IN (476561547, 5153477378)
    AND DATE(sent_time) = ?
`).get(today) as { count: number };

console.log(`💾 messages (сегодня, реальные пользователи): ${todayMessagesReal.count}`);

const diff = todayLinksReal.count - todayMessagesReal.count;
console.log(`📉 Разница: ${diff}`);

if (diff === 0) {
  console.log('\n✅ ОТЛИЧНО! Сегодня все сообщения от реальных пользователей сохранились!');
  console.log('   Значит мой код в interactive-tracker.ts:39 РАБОТАЕТ ПРАВИЛЬНО!');
  console.log('   Проблема была ТОЛЬКО в старых сообщениях (до сегодня).');
} else {
  console.log(`\n❌ Сегодня не хватает ${diff} сообщений`);
  console.log('   Нужно проверять почему middleware не срабатывает');
}

// Проверим сообщения за вчера
const yesterday = new Date();
yesterday.setDate(yesterday.getDate() - 1);
const yesterdayStr = yesterday.toISOString().split('T')[0];

console.log(`\n🔍 Для сравнения - ВЧЕРАШНИЕ сообщения (${yesterdayStr}):\n`);

const yesterdayLinksReal = db.query(`
  SELECT COUNT(*) as count FROM message_links
  WHERE message_type = 'user'
    AND user_id IN (476561547, 5153477378)
    AND DATE(created_at) = ?
`).get(yesterdayStr) as { count: number };

const yesterdayMessagesReal = db.query(`
  SELECT COUNT(*) as count FROM messages
  WHERE chat_id IN (476561547, 5153477378)
    AND DATE(sent_time) = ?
`).get(yesterdayStr) as { count: number };

console.log(`📊 message_links (вчера, реальные): ${yesterdayLinksReal.count}`);
console.log(`💾 messages (вчера, реальные): ${yesterdayMessagesReal.count}`);
console.log(`📉 Разница: ${yesterdayLinksReal.count - yesterdayMessagesReal.count}`);
