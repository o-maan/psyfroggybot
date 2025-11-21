import { db } from './src/db';

console.log('🔍 Проверка влияния дубликатов на batch processor:\n');

// Берем сообщение которое есть в дубликатах
const messageId = 6071;

console.log(`Сообщение ${messageId}:`);

const dupes = db.query(`
  SELECT * FROM message_links
  WHERE message_id = ? AND message_type = 'user'
  ORDER BY channel_message_id, created_at
`).all(messageId);

console.log(`  Найдено записей в message_links: ${dupes.length}\n`);

for (const dupe of dupes as any[]) {
  console.log(`  - channel_message_id=${dupe.channel_message_id}, state=${dupe.state_at_time}, text="${(dupe.message_preview || '').substring(0, 40)}..."`);
}

console.log('\n📊 Симуляция batch processor:\n');

// Группируем как batch processor
const groups = new Map<number, any[]>();

for (const msg of dupes as any[]) {
  const key = msg.channel_message_id;
  if (!groups.has(key)) {
    groups.set(key, []);
  }
  groups.get(key)!.push(msg);
}

console.log(`  Групп по channel_message_id: ${groups.size}\n`);

for (const [channelId, messages] of groups.entries()) {
  console.log(`  Группа channel_message_id=${channelId}:`);
  console.log(`    Сообщений в группе: ${messages.length}`);

  // Объединяем как в batch processor
  const text = messages.map((m: any) => m.message_preview).filter(Boolean).join('\n');

  console.log(`    Объединенный текст (${text.length} символов):`);
  console.log(`    "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);

  if (messages.length > 1) {
    console.log(`\n    ⚠️ ПРОБЛЕМА: Одно и то же сообщение будет включено ${messages.length} раза!`);
  }
  console.log('');
}

console.log('\n💡 Вывод:');
console.log('   Если сообщение записано в message_links несколько раз с ОДНИМ channel_message_id,');
console.log('   то оно будет продублировано в тексте события!');
console.log('\n   Если сообщение записано в message_links с РАЗНЫМИ channel_message_id,');
console.log('   то оно будет сохранено в РАЗНЫЕ события (тоже неправильно!)');
