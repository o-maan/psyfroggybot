import { db } from './src/db';

const today = new Date().toISOString().split('T')[0];

console.log(`🔍 ДЕТАЛЬНАЯ проверка сегодняшних сообщений (${today}):\n`);

// Для каждого реального пользователя
for (const userId of [476561547, 5153477378]) {
  console.log(`👤 User ${userId}:`);

  const linksCount = db.query(`
    SELECT COUNT(*) as count FROM message_links
    WHERE user_id = ? AND message_type = 'user' AND DATE(created_at) = ?
  `).get(userId, today) as { count: number };

  const messagesCount = db.query(`
    SELECT COUNT(*) as count FROM messages
    WHERE chat_id = ? AND DATE(sent_time) = ?
  `).get(userId, today) as { count: number };

  console.log(`  message_links: ${linksCount.count}`);
  console.log(`  messages: ${messagesCount.count}`);
  console.log(`  разница: ${linksCount.count - messagesCount.count} ${linksCount.count === messagesCount.count ? '✅' : '❌'}`);

  if (linksCount.count !== messagesCount.count) {
    // Найдем какие именно сообщения отсутствуют
    const linksMessages = db.query(`
      SELECT message_id FROM message_links
      WHERE user_id = ? AND message_type = 'user' AND DATE(created_at) = ?
      ORDER BY created_at ASC
    `).all(userId, today) as { message_id: number }[];

    console.log(`\n  📋 Проверяем каждое сообщение:\n`);

    for (const { message_id } of linksMessages) {
      const existsInMessages = db.query(`
        SELECT 1 FROM messages WHERE telegram_message_id = ?
      `).get(message_id);

      if (!existsInMessages) {
        const linkInfo = db.query(`
          SELECT message_preview, created_at, state_at_time FROM message_links
          WHERE message_id = ?
        `).get(message_id) as any;

        console.log(`    ❌ msg_id=${message_id} НЕТ в messages`);
        console.log(`       state=${linkInfo?.state_at_time || 'NULL'}`);
        console.log(`       time=${linkInfo?.created_at}`);
        console.log(`       text="${(linkInfo?.message_preview || '').substring(0, 40)}..."`);
      }
    }
  }

  console.log('');
}

console.log('\n💡 Если есть отсутствующие сообщения - значит middleware НЕ сработал для них');
console.log('   Нужно проверить КОГДА и ПРИ КАКИХ условиях был запущен бот с новым кодом');
