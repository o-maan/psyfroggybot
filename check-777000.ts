import { db } from './src/db';

console.log('🔍 Анализ сообщений от user_id=777000:\n');

const count777000 = db.query(`
  SELECT COUNT(*) as count FROM message_links WHERE user_id = 777000 AND message_type = 'user'
`).get() as { count: number };

console.log(`Сообщений от user_id=777000: ${count777000.count}`);

const totalUser = db.query(`
  SELECT COUNT(*) as count FROM message_links WHERE message_type = 'user'
`).get() as { count: number };

console.log(`Всего сообщений от пользователей: ${totalUser.count}`);

const totalInMessages = db.query(`
  SELECT COUNT(*) as count FROM messages
`).get() as { count: number };

console.log(`Сообщений в таблице messages: ${totalInMessages.count}`);

console.log(`\nРазница: ${totalUser.count - totalInMessages.count} сообщений не попали в messages`);
console.log(`Сообщений от 777000: ${count777000.count}`);

if (count777000.count === totalUser.count - totalInMessages.count) {
  console.log('\n✅ ТОЧНО! Все недостающие сообщения - это сообщения от user_id=777000');
} else {
  console.log(`\n⚠️ Не сходится: ${totalUser.count - totalInMessages.count} недостает, но ${count777000.count} от 777000`);

  // Проверим сообщения от реальных пользователей
  const from476 = db.query(`SELECT COUNT(*) as count FROM message_links WHERE user_id = 476561547 AND message_type = 'user'`).get() as { count: number };
  const from5153 = db.query(`SELECT COUNT(*) as count FROM message_links WHERE user_id = 5153477378 AND message_type = 'user'`).get() as { count: number };

  console.log(`\nСообщений от 476561547: ${from476.count}`);
  console.log(`Сообщений от 5153477378: ${from5153.count}`);

  const inMessagesFrom476 = db.query(`SELECT COUNT(*) as count FROM messages WHERE chat_id = 476561547`).get() as { count: number };
  const inMessagesFrom5153 = db.query(`SELECT COUNT(*) as count FROM messages WHERE chat_id = 5153477378`).get() as { count: number };

  console.log(`\nВ messages от 476561547: ${inMessagesFrom476.count}`);
  console.log(`В messages от 5153477378: ${inMessagesFrom5153.count}`);
}

console.log('\n🔍 Примеры сообщений от 777000:');
const samples = db.query(`
  SELECT message_id, channel_message_id, state_at_time, message_preview, created_at
  FROM message_links
  WHERE user_id = 777000 AND message_type = 'user'
  LIMIT 5
`).all();

for (const msg of samples as any[]) {
  console.log(`  msg_id=${msg.message_id}, channel=${msg.channel_message_id}, state=${msg.state_at_time || 'NULL'}, text="${(msg.message_preview || '').substring(0, 40)}..."`);
}
