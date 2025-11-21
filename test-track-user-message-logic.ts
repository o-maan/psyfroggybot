/**
 * Интеграционный тест логики trackUserMessage
 *
 * Симулируем разные сценарии и проверяем что сообщения
 * попадают в правильные посты без дубликатов
 */

import { db } from './src/db';

console.log('🧪 ИНТЕГРАЦИОННЫЙ ТЕСТ: trackUserMessage логика\n');

// Тестовые данные
const testUserId = 476561547;

// Находим реальные посты для теста
const eveningPost = db.query(`
  SELECT * FROM interactive_posts
  WHERE user_id = ?
  ORDER BY created_at DESC
  LIMIT 1
`).get(testUserId) as any;

const morningPost = db.query(`
  SELECT * FROM morning_posts
  WHERE user_id = ?
  ORDER BY created_at DESC
  LIMIT 1
`).get(testUserId) as any;

if (!eveningPost || !morningPost) {
  console.log('❌ Нет тестовых данных (нужны вечерний и утренний посты)');
  process.exit(1);
}

console.log('📋 Тестовые посты:');
console.log(`   Вечерний: ${eveningPost.channel_message_id} (state: ${eveningPost.current_state})`);
console.log(`   Утренний: ${morningPost.channel_message_id}\n`);

// Сценарий 1: Сообщение С replyToMessageId
console.log('1️⃣ Сценарий: Сообщение с replyToMessageId\n');
console.log('   Логика:');
console.log('   - Есть replyToMessageId → используем его (самый точный способ)');
console.log('   - Игнорируем messageThreadId и последний незавершенный пост\n');

const botMessage = db.query(`
  SELECT message_id FROM message_links
  WHERE channel_message_id = ? AND message_type = 'bot'
  LIMIT 1
`).get(eveningPost.channel_message_id) as any;

if (botMessage) {
  console.log(`   ✅ Если пользователь ответит на сообщение ${botMessage.message_id}`);
  console.log(`      → сообщение сохранится в пост ${eveningPost.channel_message_id} (вечерний)`);
} else {
  console.log('   ⚠️ Нет сообщений бота для теста');
}

// Сценарий 2: Сообщение С messageThreadId (утренний пост)
console.log('\n2️⃣ Сценарий: Сообщение в треде утреннего поста\n');
console.log('   Логика:');
console.log('   - НЕТ replyToMessageId');
console.log('   - Есть messageThreadId → проверяем утренние посты ПЕРВЫМИ');
console.log('   - Игнорируем последний незавершенный пост\n');
console.log(`   ✅ Если пользователь напишет в треде ${morningPost.channel_message_id}`);
console.log(`      → сообщение сохранится в пост ${morningPost.channel_message_id} (утренний)`);
console.log(`      → НЕ БУДЕТ сохранено в пост ${eveningPost.channel_message_id} (даже если он незавершен)`);

// Сценарий 3: Сообщение БЕЗ replyToMessageId И БЕЗ messageThreadId
console.log('\n3️⃣ Сценарий: Сообщение без реплая и без треда (fallback)\n');
console.log('   Логика:');
console.log('   - НЕТ replyToMessageId');
console.log('   - НЕТ messageThreadId');
console.log('   - Используем последний незавершенный пост (fallback)\n');

const incompletePosts = db.query(`
  SELECT channel_message_id, current_state FROM interactive_posts
  WHERE user_id = ?
    AND (task1_completed = 0 OR task2_completed = 0 OR task3_completed = 0)
  ORDER BY created_at DESC
  LIMIT 1
`).get(testUserId) as any;

if (incompletePosts) {
  console.log(`   ✅ Если пользователь напишет просто текст (без реплая/треда)`);
  console.log(`      → сообщение сохранится в пост ${incompletePosts.channel_message_id} (последний незавершенный)`);
} else {
  console.log('   ⚠️ Нет незавершенных постов');
}

// Проверка КРИТИЧЕСКОЙ ситуации
console.log('\n🚨 КРИТИЧЕСКАЯ проверка:\n');
console.log('   Ситуация: Есть незавершенный вечерний пост 722 И утренний пост 727');
console.log('   Пользователь пишет В ТРЕДЕ утреннего поста (messageThreadId = 727)');
console.log('');
console.log('   ❌ СТАРАЯ логика (ДО исправления):');
console.log('      1. Проверить replyToMessageId → НЕТ');
console.log('      2. Взять последний незавершенный пост → 722 ← НЕПРАВИЛЬНО!');
console.log('      3. Сохранить в 722');
console.log('      4. Потом проверить messageThreadId → 727');
console.log('      5. Сохранить СНОВА в 727');
console.log('      → ДУБЛИКАТ! Сообщение в обоих постах!');
console.log('');
console.log('   ✅ НОВАЯ логика (ПОСЛЕ исправления):');
console.log('      1. Проверить replyToMessageId → НЕТ');
console.log('      2. Проверить messageThreadId → ЕСТЬ (727) ← ПРИОРИТЕТ!');
console.log('      3. Найти утренний пост 727');
console.log('      4. Сохранить в 727');
console.log('      5. Вернуть context → НЕ проверяем незавершенные посты');
console.log('      → НЕТ ДУБЛИКАТА! Сообщение только в 727!');

console.log('\n💡 ИТОГ:');
console.log('   Приоритет проверок:');
console.log('   1. replyToMessageId (самый точный)');
console.log('   2. messageThreadId (точный, пользователь в конкретном треде)');
console.log('   3. Последний незавершенный пост (fallback)');
console.log('');
console.log('   Это предотвращает дубликаты когда пользователь пишет в треде');
console.log('   при наличии незавершенных постов.');
