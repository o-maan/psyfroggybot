import { db } from './src/db';

/**
 * Простой тест для проверки что сообщения сохраняются правильно
 */
async function testSimple() {
  console.log('🧪 ПРОСТОЙ ТЕСТ: Проверка сохранения сообщений\n');

  // 1. Утренние сообщения - проверяем что они в message_links с state_at_time = NULL
  console.log('1️⃣ Утренние сообщения (state_at_time = NULL):');
  const morningMessages = db.query(`
    SELECT ml.channel_message_id, ml.message_type, ml.state_at_time, ml.message_preview, mp.current_step
    FROM message_links ml
    INNER JOIN morning_posts mp ON ml.channel_message_id = mp.channel_message_id
    WHERE ml.message_type = 'user'
    LIMIT 10
  `).all();

  if (morningMessages.length > 0) {
    console.log(`   ✅ Найдено ${morningMessages.length} утренних сообщений в message_links:`);
    (morningMessages as any[]).forEach((msg, i) => {
      console.log(`   ${i + 1}. channel_id=${msg.channel_message_id}, state=${msg.state_at_time || 'NULL ✓'}, step=${msg.current_step}, text="${(msg.message_preview || '').substring(0, 40)}..."`);
    });

    // Проверяем что хотя бы одно сообщение имеет state_at_time = null
    const hasNull = morningMessages.some((m: any) => m.state_at_time === null);
    if (hasNull) {
      console.log('   ✅ Есть сообщения с state_at_time = NULL (для batch processor)');
    } else {
      console.log('   ❌ НЕТ сообщений с state_at_time = NULL!');
    }
  } else {
    console.log('   ⚠️ Нет утренних сообщений в message_links');
  }

  // 2. Вечерние сообщения - проверяем что у них правильный state_at_time
  console.log('\n2️⃣ Вечерние сообщения (state_at_time заполнен):');
  const eveningMessages = db.query(`
    SELECT ml.channel_message_id, ml.message_type, ml.state_at_time, ml.message_preview, ip.current_state
    FROM message_links ml
    INNER JOIN interactive_posts ip ON ml.channel_message_id = ip.channel_message_id
    WHERE ml.message_type = 'user' AND ml.state_at_time IS NOT NULL
    LIMIT 10
  `).all();

  if (eveningMessages.length > 0) {
    console.log(`   ✅ Найдено ${eveningMessages.length} вечерних сообщений в message_links:`);
    (eveningMessages as any[]).forEach((msg, i) => {
      console.log(`   ${i + 1}. channel_id=${msg.channel_message_id}, state=${msg.state_at_time}, current=${msg.current_state}, text="${(msg.message_preview || '').substring(0, 30)}..."`);
    });
  } else {
    console.log('   ⚠️ Нет вечерних сообщений в message_links');
  }

  // 3. Проверяем что ВСЕ сообщения из message_links есть в messages
  console.log('\n3️⃣ Проверка что message_links синхронизирована с messages:');
  const linkMessageIds = db.query('SELECT DISTINCT message_id FROM message_links WHERE message_type = \"user\"').all() as { message_id: number }[];
  console.log(`   Уникальных message_id в message_links: ${linkMessageIds.length}`);

  // Проверяем что они все есть в messages
  let foundCount = 0;
  for (const { message_id } of linkMessageIds) {
    const exists = db.query('SELECT 1 FROM messages WHERE telegram_message_id = ?').get(message_id);
    if (exists) foundCount++;
  }

  console.log(`   Найдено в messages: ${foundCount}/${linkMessageIds.length}`);
  if (foundCount === linkMessageIds.length) {
    console.log('   ✅ ВСЕ сообщения из message_links есть в messages');
  } else {
    console.log(`   ⚠️ НЕ все сообщения найдены (отсутствует ${linkMessageIds.length - foundCount})`);
  }

  // 4. Необработанные сообщения для batch processor
  console.log('\n4️⃣ Необработанные сообщения (для batch processor):');
  const unprocessed = db.query(`
    SELECT COUNT(*) as count
    FROM message_links
    WHERE message_type = 'user'
      AND processed_at IS NULL
      AND message_preview IS NOT NULL
      AND message_preview != ''
      AND channel_message_id != 0
  `).get() as { count: number };

  console.log(`   Необработанных сообщений: ${unprocessed.count}`);

  // Из них с state_at_time = NULL (утренние)
  const unprocessedMorning = db.query(`
    SELECT COUNT(*) as count
    FROM message_links
    WHERE message_type = 'user'
      AND processed_at IS NULL
      AND state_at_time IS NULL
      AND message_preview IS NOT NULL
      AND message_preview != ''
      AND channel_message_id != 0
  `).get() as { count: number };

  console.log(`   Из них утренних (state=NULL): ${unprocessedMorning.count}`);

  // Из них с state_at_time != NULL (вечерние)
  const unprocessedEvening = db.query(`
    SELECT COUNT(*) as count
    FROM message_links
    WHERE message_type = 'user'
      AND processed_at IS NULL
      AND state_at_time IS NOT NULL
      AND message_preview IS NOT NULL
      AND message_preview != ''
      AND channel_message_id != 0
  `).get() as { count: number };

  console.log(`   Из них вечерних (state!=NULL): ${unprocessedEvening.count}`);

  console.log('\n✅ Тест завершен!\n');
}

testSimple().catch(console.error);
