import { db } from './src/db';
import { processBatchMessages } from './src/batch-processor';

/**
 * Тестовый скрипт для проверки batch processor
 */
async function testBatchProcessor() {
  console.log('🧪 ТЕСТ: Проверка batch processor\n');

  // 1. Проверяем необработанные сообщения
  console.log('1️⃣ Проверка необработанных сообщений:');
  const unprocessedQuery = db.query(`
    SELECT channel_message_id, message_id, user_id, message_preview, state_at_time, created_at
    FROM message_links
    WHERE message_type = 'user'
      AND processed_at IS NULL
      AND message_preview IS NOT NULL
      AND message_preview != ''
      AND channel_message_id != 0
    ORDER BY channel_message_id, created_at ASC
  `);
  const unprocessed = unprocessedQuery.all();

  console.log(`   Всего необработанных: ${unprocessed.length}`);

  if (unprocessed.length === 0) {
    console.log('   ⚠️ Нет необработанных сообщений для теста');
    return;
  }

  // Группируем по channel_message_id
  const byChannel = new Map<number, any[]>();
  for (const msg of unprocessed as any[]) {
    const key = msg.channel_message_id;
    if (!byChannel.has(key)) {
      byChannel.set(key, []);
    }
    byChannel.get(key)!.push(msg);
  }

  console.log(`   Групп сообщений: ${byChannel.size}\n`);

  byChannel.forEach((messages, channelId) => {
    console.log(`   📬 channel_message_id=${channelId} (${messages.length} сообщений):`);
    messages.forEach((msg, i) => {
      console.log(`      ${i + 1}. state=${msg.state_at_time || 'NULL (утреннее)'}, text="${(msg.message_preview || '').substring(0, 40)}..."`);
    });
  });

  // 2. Состояние до обработки
  console.log('\n2️⃣ Состояние БД ДО обработки:');
  const positiveCountBefore = db.query('SELECT COUNT(*) as count FROM positive_events').get() as { count: number };
  const negativeCountBefore = db.query('SELECT COUNT(*) as count FROM negative_events').get() as { count: number };
  console.log(`   Позитивных событий: ${positiveCountBefore.count}`);
  console.log(`   Негативных событий: ${negativeCountBefore.count}`);

  // 3. Запускаем batch processor
  console.log('\n3️⃣ Запуск batch processor...');
  try {
    await processBatchMessages();
    console.log('   ✅ Batch processor завершил работу');
  } catch (error) {
    console.error('   ❌ Ошибка:', error);
    return;
  }

  // 4. Состояние после обработки
  console.log('\n4️⃣ Состояние БД ПОСЛЕ обработки:');
  const positiveCountAfter = db.query('SELECT COUNT(*) as count FROM positive_events').get() as { count: number };
  const negativeCountAfter = db.query('SELECT COUNT(*) as count FROM negative_events').get() as { count: number };
  console.log(`   Позитивных событий: ${positiveCountAfter.count} (+${positiveCountAfter.count - positiveCountBefore.count})`);
  console.log(`   Негативных событий: ${negativeCountAfter.count} (+${negativeCountAfter.count - negativeCountBefore.count})`);

  // 5. Проверяем что сообщения помечены как обработанные
  const stillUnprocessed = unprocessedQuery.all();
  console.log(`\n5️⃣ Необработанных сообщений после: ${stillUnprocessed.length}`);

  if (stillUnprocessed.length === 0) {
    console.log('   ✅ Все сообщения обработаны!');
  } else {
    console.log('   ⚠️ Остались необработанные сообщения:');
    (stillUnprocessed as any[]).forEach((msg, i) => {
      console.log(`   ${i + 1}. channel_id=${msg.channel_message_id}, state=${msg.state_at_time || 'NULL'}, text="${(msg.message_preview || '').substring(0, 40)}..."`);
    });
  }

  // 6. Последние добавленные события
  console.log('\n6️⃣ Последние добавленные события:');
  const recentPositive = db.query(`
    SELECT user_id, event_text, created_at
    FROM positive_events
    ORDER BY created_at DESC
    LIMIT 3
  `).all();

  if (recentPositive.length > 0) {
    console.log('   Позитивные:');
    (recentPositive as any[]).forEach((e, i) => {
      console.log(`   ${i + 1}. user_id=${e.user_id}, text="${(e.event_text || '').substring(0, 50)}..."`);
    });
  }

  const recentNegative = db.query(`
    SELECT user_id, event_text, created_at
    FROM negative_events
    ORDER BY created_at DESC
    LIMIT 3
  `).all();

  if (recentNegative.length > 0) {
    console.log('   Негативные:');
    (recentNegative as any[]).forEach((e, i) => {
      console.log(`   ${i + 1}. user_id=${e.user_id}, text="${(e.event_text || '').substring(0, 50)}..."`);
    });
  }

  console.log('\n✅ Тест завершен!\n');
}

testBatchProcessor().catch(console.error);
