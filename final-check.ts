import { db } from './src/db';

console.log('🎯 ФИНАЛЬНАЯ ПРОВЕРКА:\n');

// Сообщения от РЕАЛЬНЫХ пользователей в message_links
const realUsersLinks = db.query(`
  SELECT COUNT(*) as count FROM message_links
  WHERE message_type = 'user'
    AND user_id IN (476561547, 5153477378)
`).get() as { count: number };

console.log(`📊 Сообщений от РЕАЛЬНЫХ пользователей в message_links: ${realUsersLinks.count}`);

// Сообщения от служебного аккаунта
const serviceAccount = db.query(`
  SELECT COUNT(*) as count FROM message_links
  WHERE message_type = 'user'
    AND user_id = 777000
`).get() as { count: number };

console.log(`🤖 Сообщений от служебного 777000: ${serviceAccount.count}`);

// Всего в message_links
const totalLinks = db.query(`
  SELECT COUNT(*) as count FROM message_links WHERE message_type = 'user'
`).get() as { count: number };

console.log(`📋 Всего в message_links: ${totalLinks.count}`);
console.log(`   Проверка: ${realUsersLinks.count} + ${serviceAccount.count} = ${realUsersLinks.count + serviceAccount.count} ${realUsersLinks.count + serviceAccount.count === totalLinks.count ? '✅' : '❌'}\n`);

// Сообщения в messages
const totalMessages = db.query(`
  SELECT COUNT(*) as count FROM messages
`).get() as { count: number };

console.log(`💾 Сообщений в таблице messages: ${totalMessages.count}`);

// Сообщения от реальных пользователей в messages
const realUsersMessages = db.query(`
  SELECT COUNT(*) as count FROM messages
  WHERE chat_id IN (476561547, 5153477378)
`).get() as { count: number };

console.log(`📊 Из них от реальных пользователей: ${realUsersMessages.count}\n`);

// Разница
const diff = realUsersLinks.count - realUsersMessages.count;
console.log(`📉 Разница (должны быть сохранены, но нет): ${diff}`);

if (diff === 0) {
  console.log('\n✅ ОТЛИЧНО! Все сообщения от реальных пользователей сохранены!');
  console.log('   Отсутствующие сообщения - это только от служебного 777000, что нормально.');
} else {
  console.log(`\n⚠️ Не хватает ${diff} сообщений от реальных пользователей`);

  // Проверим по отдельности каждого пользователя
  console.log('\n🔍 Детализация по пользователям:\n');

  for (const userId of [476561547, 5153477378]) {
    const linksCount = db.query(`
      SELECT COUNT(*) as count FROM message_links WHERE user_id = ? AND message_type = 'user'
    `).get(userId) as { count: number };

    const messagesCount = db.query(`
      SELECT COUNT(*) as count FROM messages WHERE chat_id = ?
    `).get(userId) as { count: number };

    console.log(`  user_id=${userId}:`);
    console.log(`    message_links: ${linksCount.count}`);
    console.log(`    messages: ${messagesCount.count}`);
    console.log(`    разница: ${linksCount.count - messagesCount.count} ${linksCount.count === messagesCount.count ? '✅' : '❌'}`);
  }
}
