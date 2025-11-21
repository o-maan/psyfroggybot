import { db } from './src/db';

/**
 * Тест приоритетов определения контекста в trackUserMessage
 *
 * Проверяем что messageThreadId имеет приоритет над "последний незавершенный пост"
 */

console.log('🧪 ТЕСТ: Приоритеты определения контекста\n');

// Ищем пользователя с незавершенным вечерним постом И утренним постом
const userWithBothPosts = db.query(`
  SELECT
    ip.user_id,
    ip.channel_message_id as evening_post,
    ip.current_state as evening_state,
    mp.channel_message_id as morning_post,
    mp.current_step as morning_step
  FROM interactive_posts ip
  INNER JOIN morning_posts mp ON ip.user_id = mp.user_id
  WHERE (ip.task1_completed = 0 OR ip.task2_completed = 0 OR ip.task3_completed = 0)
  ORDER BY mp.created_at DESC
  LIMIT 1
`).get() as any;

if (!userWithBothPosts) {
  console.log('⚠️ Нет пользователя с одновременно незавершенным вечерним И утренним постом');
  console.log('   Создам тестовую ситуацию...\n');

  // Создаем тестовую ситуацию
  const testUserId = 476561547;

  // Проверяем есть ли незавершенный вечерний пост
  const eveningPost = db.query(`
    SELECT * FROM interactive_posts
    WHERE user_id = ?
      AND (task1_completed = 0 OR task2_completed = 0 OR task3_completed = 0)
    ORDER BY created_at DESC
    LIMIT 1
  `).get(testUserId) as any;

  // Проверяем есть ли утренний пост
  const morningPost = db.query(`
    SELECT * FROM morning_posts
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(testUserId) as any;

  if (eveningPost && morningPost) {
    console.log(`✅ Найдена тестовая ситуация:`);
    console.log(`   User: ${testUserId}`);
    console.log(`   Вечерний пост: ${eveningPost.channel_message_id} (state: ${eveningPost.current_state})`);
    console.log(`   Утренний пост: ${morningPost.channel_message_id}\n`);

    // Проверяем дубликаты для этих постов
    const duplicates = db.query(`
      SELECT
        message_id,
        COUNT(DISTINCT channel_message_id) as post_count,
        GROUP_CONCAT(DISTINCT channel_message_id) as posts
      FROM message_links
      WHERE user_id = ?
        AND message_type = 'user'
        AND channel_message_id IN (?, ?)
      GROUP BY message_id
      HAVING post_count > 1
      ORDER BY created_at DESC
      LIMIT 10
    `).all(testUserId, eveningPost.channel_message_id, morningPost.channel_message_id);

    console.log(`📊 Сообщения записанные В ОБА поста (дубликаты):\n`);

    if (duplicates.length === 0) {
      console.log('   ✅ НЕТ дубликатов между вечерним и утренним постом!');
      console.log('   Это значит что логика работает правильно.\n');
    } else {
      console.log(`   ❌ Найдено ${duplicates.length} сообщений с дубликатами:\n`);

      for (const dup of duplicates as any[]) {
        console.log(`   Сообщение ${dup.message_id}:`);
        console.log(`     Записано в посты: ${dup.posts}`);

        // Детали каждой записи
        const details = db.query(`
          SELECT channel_message_id, state_at_time, message_preview, created_at
          FROM message_links
          WHERE message_id = ? AND user_id = ?
          ORDER BY created_at
        `).all(dup.message_id, testUserId);

        for (const detail of details as any[]) {
          console.log(`       - post ${detail.channel_message_id}: state=${detail.state_at_time || 'NULL'}, time=${detail.created_at}`);
        }
        console.log('');
      }
    }

  } else {
    console.log('❌ Не могу создать тестовую ситуацию - нет нужных данных');
  }

  process.exit(0);
}

console.log(`✅ Найден пользователь с обоими типами постов:`);
console.log(`   User: ${userWithBothPosts.user_id}`);
console.log(`   Вечерний пост: ${userWithBothPosts.evening_post} (state: ${userWithBothPosts.evening_state})`);
console.log(`   Утренний пост: ${userWithBothPosts.morning_post}\n`);

// Проверяем дубликаты
console.log('📊 Проверка дубликатов между постами:\n');

const duplicates = db.query(`
  SELECT
    message_id,
    COUNT(DISTINCT channel_message_id) as post_count,
    GROUP_CONCAT(DISTINCT channel_message_id) as posts
  FROM message_links
  WHERE user_id = ?
    AND message_type = 'user'
    AND channel_message_id IN (?, ?)
  GROUP BY message_id
  HAVING post_count > 1
  ORDER BY created_at DESC
  LIMIT 10
`).all(
  userWithBothPosts.user_id,
  userWithBothPosts.evening_post,
  userWithBothPosts.morning_post
);

if (duplicates.length === 0) {
  console.log('✅ НЕТ дубликатов! Логика работает правильно.');
} else {
  console.log(`❌ Найдено ${duplicates.length} дубликатов:\n`);

  for (const dup of duplicates as any[]) {
    const details = db.query(`
      SELECT channel_message_id, state_at_time, message_preview, created_at
      FROM message_links
      WHERE message_id = ? AND user_id = ?
      ORDER BY created_at
    `).all(dup.message_id, userWithBothPosts.user_id);

    console.log(`Сообщение ${dup.message_id}:`);
    for (const detail of details as any[]) {
      console.log(`  post ${detail.channel_message_id}: state=${detail.state_at_time || 'NULL'}, "${(detail.message_preview || '').substring(0, 40)}..."`);
    }
    console.log('');
  }
}

console.log('\n💡 Вывод:');
console.log('   После исправления логики новые сообщения НЕ должны создавать дубликаты.');
console.log('   Старые дубликаты (до исправления) могут остаться в БД.');
