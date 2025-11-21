import { db, saveMessage, saveUserMessageLink, getMorningPostByThreadId, getInteractivePost } from './src/db';

// Тестовый скрипт для проверки сохранения сообщений

async function testMessageSaving() {
  console.log('🧪 ТЕСТ: Проверка сохранения сообщений\n');

  // 1. Проверка таблицы messages
  console.log('1️⃣ Проверка таблицы messages:');
  const messagesQuery = db.query('SELECT COUNT(*) as count FROM messages');
  const messagesCount = messagesQuery.get() as { count: number };
  console.log(`   Всего сообщений в messages: ${messagesCount.count}`);

  // Последние 3 сообщения
  const recentMessages = db.query('SELECT author_id, message_text, sent_time FROM messages ORDER BY id DESC LIMIT 3').all();
  console.log('   Последние 3 сообщения:');
  recentMessages.forEach((msg: any, i) => {
    console.log(`   ${i + 1}. author_id=${msg.author_id}, text="${msg.message_text?.substring(0, 50)}...", time=${msg.sent_time}`);
  });

  // 2. Проверка таблицы message_links
  console.log('\n2️⃣ Проверка таблицы message_links:');
  const linksQuery = db.query('SELECT COUNT(*) as count FROM message_links');
  const linksCount = linksQuery.get() as { count: number };
  console.log(`   Всего записей в message_links: ${linksCount.count}`);

  // Последние 5 записей
  const recentLinks = db.query(`
    SELECT channel_message_id, message_type, state_at_time, processed_at, created_at
    FROM message_links
    ORDER BY created_at DESC
    LIMIT 5
  `).all();
  console.log('   Последние 5 записей:');
  recentLinks.forEach((link: any, i) => {
    console.log(`   ${i + 1}. channel_msg_id=${link.channel_message_id}, type=${link.message_type}, state=${link.state_at_time || 'NULL'}, processed=${link.processed_at || 'не обработано'}`);
  });

  // 3. Проверка утренних постов
  console.log('\n3️⃣ Проверка утренних постов:');
  const morningPostsQuery = db.query('SELECT channel_message_id, user_id, current_step, created_at FROM morning_posts ORDER BY created_at DESC LIMIT 3');
  const morningPosts = morningPostsQuery.all();
  console.log(`   Всего утренних постов: ${morningPosts.length}`);
  morningPosts.forEach((post: any, i) => {
    console.log(`   ${i + 1}. channel_msg_id=${post.channel_message_id}, user_id=${post.user_id}, step=${post.current_step}`);

    // Проверяем есть ли для него записи в message_links
    const linksForPost = db.query('SELECT COUNT(*) as count FROM message_links WHERE channel_message_id = ?').get(post.channel_message_id) as { count: number };
    console.log(`      → message_links для этого поста: ${linksForPost.count} записей`);
  });

  // 4. Проверка вечерних постов
  console.log('\n4️⃣ Проверка вечерних постов (interactive_posts):');
  const interactivePostsQuery = db.query('SELECT channel_message_id, user_id, current_state, created_at FROM interactive_posts ORDER BY created_at DESC LIMIT 3');
  const interactivePosts = interactivePostsQuery.all();
  console.log(`   Всего вечерних постов: ${interactivePosts.length}`);
  interactivePosts.forEach((post: any, i) => {
    console.log(`   ${i + 1}. channel_msg_id=${post.channel_message_id}, user_id=${post.user_id}, state=${post.current_state}`);

    // Проверяем есть ли для него записи в message_links
    const linksForPost = db.query('SELECT COUNT(*) as count FROM message_links WHERE channel_message_id = ?').get(post.channel_message_id) as { count: number };
    console.log(`      → message_links для этого поста: ${linksForPost.count} записей`);
  });

  // 5. Проверка необработанных сообщений для batch processor
  console.log('\n5️⃣ Проверка необработанных сообщений (для batch processor):');
  const unprocessedQuery = db.query(`
    SELECT channel_message_id, message_type, state_at_time, created_at
    FROM message_links
    WHERE processed_at IS NULL
    ORDER BY created_at DESC
    LIMIT 5
  `);
  const unprocessed = unprocessedQuery.all();
  console.log(`   Необработанных сообщений: ${unprocessed.length}`);
  unprocessed.forEach((msg: any, i) => {
    console.log(`   ${i + 1}. channel_msg_id=${msg.channel_message_id}, type=${msg.message_type}, state=${msg.state_at_time || 'NULL (утреннее)'}`);
  });

  // 6. Проверка функции getMorningPostByThreadId
  console.log('\n6️⃣ Проверка функции getMorningPostByThreadId:');
  if (morningPosts.length > 0) {
    const testThreadId = morningPosts[0].channel_message_id;
    const foundPost = await getMorningPostByThreadId(testThreadId);
    console.log(`   Тест с threadId=${testThreadId}: ${foundPost ? '✅ НАЙДЕН' : '❌ НЕ НАЙДЕН'}`);
    if (foundPost) {
      console.log(`   Данные: user_id=${foundPost.user_id}, step=${foundPost.current_step}`);
    }
  } else {
    console.log('   ⚠️ Нет утренних постов для теста');
  }

  console.log('\n✅ Тест завершен!\n');
}

testMessageSaving().catch(console.error);
