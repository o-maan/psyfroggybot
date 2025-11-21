import { db } from './src/db';

/**
 * Тест полной цепочки: утренние посты → batch processor → positive/negative events → JOY
 */
async function testMorningToJoyFlow() {
  console.log('🧪 ТЕСТ: Полная цепочка утренних постов → events → JOY\n');

  // 1. Проверяем утренние посты и их сообщения в message_links
  console.log('1️⃣ Утренние посты и их сообщения:');
  const morningPosts = db.query(`
    SELECT channel_message_id, user_id, current_step, created_at
    FROM morning_posts
    ORDER BY created_at DESC
    LIMIT 5
  `).all();

  console.log(`   Всего утренних постов: ${morningPosts.length}`);

  for (const post of morningPosts as any[]) {
    console.log(`\n   📬 Пост ${post.channel_message_id} (user_id=${post.user_id}, step=${post.current_step}):`);

    // Сообщения в message_links для этого поста
    const messages = db.query(`
      SELECT message_id, message_type, state_at_time, processed_at, message_preview
      FROM message_links
      WHERE channel_message_id = ?
      ORDER BY created_at ASC
    `).all(post.channel_message_id);

    console.log(`      Сообщений в message_links: ${messages.length}`);

    const userMessages = (messages as any[]).filter(m => m.message_type === 'user');
    console.log(`      Из них от пользователя: ${userMessages.length}`);

    if (userMessages.length > 0) {
      userMessages.forEach((msg, i) => {
        const processedStatus = msg.processed_at ? '✅ обработано' : '⏳ не обработано';
        console.log(`         ${i + 1}. state=${msg.state_at_time || 'NULL'}, ${processedStatus}, text="${(msg.message_preview || '').substring(0, 40)}..."`);
      });
    }
  }

  // 2. Проверяем positive_events и negative_events для пользователей
  console.log('\n2️⃣ События в positive_events и negative_events:');

  const userIds = [...new Set((morningPosts as any[]).map(p => p.user_id))];
  console.log(`   Проверяем пользователей: ${userIds.join(', ')}\n`);

  for (const userId of userIds) {
    console.log(`   👤 User ${userId}:`);

    // Позитивные события
    const positiveEvents = db.query(`
      SELECT id, event_text, created_at, cycle_identifier
      FROM positive_events
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 3
    `).all(userId);

    console.log(`      Позитивных событий: ${positiveEvents.length}`);
    if (positiveEvents.length > 0) {
      (positiveEvents as any[]).forEach((e, i) => {
        console.log(`         ${i + 1}. cycle=${e.cycle_identifier || 'N/A'}, text="${(e.event_text || '').substring(0, 50)}..." (${e.created_at})`);
      });
    }

    // Негативные события
    const negativeEvents = db.query(`
      SELECT id, event_text, created_at, cycle_identifier
      FROM negative_events
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 3
    `).all(userId);

    console.log(`      Негативных событий: ${negativeEvents.length}`);
    if (negativeEvents.length > 0) {
      (negativeEvents as any[]).forEach((e, i) => {
        console.log(`         ${i + 1}. cycle=${e.cycle_identifier || 'N/A'}, text="${(e.event_text || '').substring(0, 50)}..." (${e.created_at})`);
      });
    }
    console.log('');
  }

  // 3. Проверяем логику JOY - как она получает позитивные события
  console.log('3️⃣ Проверка логики JOY (getPositiveEventsSinceCheckpoint):');

  // Смотрим что есть в коде (это функция которая используется в sendJoyPostWithWeeklySummary)
  const { getPositiveEventsSinceCheckpoint } = await import('./src/db');

  for (const userId of userIds) {
    // Берем события за последние 7 дней (как в реальном коде)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const timeFrom = sevenDaysAgo.toISOString();

    const events = getPositiveEventsSinceCheckpoint(userId, timeFrom);
    console.log(`   👤 User ${userId}: найдено ${events.length} позитивных событий за последние 7 дней`);

    if (events.length > 0) {
      events.forEach((e: any, i) => {
        console.log(`      ${i + 1}. cycle=${e.cycle_identifier || 'N/A'}, "${(e.event_text || '').substring(0, 60)}..."`);
      });
    }
  }

  // 4. Проверяем структуру таблиц positive_events и negative_events
  console.log('\n4️⃣ Структура таблиц events:');

  const positiveSchema = db.query('PRAGMA table_info(positive_events)').all();
  console.log('   positive_events поля:', (positiveSchema as any[]).map(c => c.name).join(', '));

  const negativeSchema = db.query('PRAGMA table_info(negative_events)').all();
  console.log('   negative_events поля:', (negativeSchema as any[]).map(c => c.name).join(', '));

  // 5. Проверяем связь: есть ли cycle_identifier для отслеживания откуда пришло событие
  console.log('\n5️⃣ Проверка поля cycle_identifier (откуда пришло событие):');

  const positiveWithCycle = db.query(`
    SELECT COUNT(*) as count
    FROM positive_events
    WHERE cycle_identifier IS NOT NULL AND cycle_identifier != ''
  `).get() as { count: number };

  const negativeWithCycle = db.query(`
    SELECT COUNT(*) as count
    FROM negative_events
    WHERE cycle_identifier IS NOT NULL AND cycle_identifier != ''
  `).get() as { count: number };

  console.log(`   Позитивных событий с cycle_identifier: ${positiveWithCycle.count}`);
  console.log(`   Негативных событий с cycle_identifier: ${negativeWithCycle.count}`);

  // Примеры cycle_identifier
  const cycleSamples = db.query(`
    SELECT DISTINCT cycle_identifier FROM positive_events WHERE cycle_identifier IS NOT NULL
    UNION
    SELECT DISTINCT cycle_identifier FROM negative_events WHERE cycle_identifier IS NOT NULL
    LIMIT 10
  `).all();

  if (cycleSamples.length > 0) {
    console.log('   Примеры cycle_identifier:', (cycleSamples as any[]).map(s => s.cycle_identifier).join(', '));
  }

  console.log('\n✅ Тест завершен!\n');
}

testMorningToJoyFlow().catch(console.error);
