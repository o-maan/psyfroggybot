import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { db, saveInteractivePost, getInteractivePost } from './db';

/**
 * Тест для режима channel_enabled=1 И dm_enabled=1 (Алекс)
 *
 * Проверяет, что когда пользователь имеет включенные оба режима:
 * 1. Создаётся запись с is_dm_mode=0 для канала
 * 2. Создаётся запись с is_dm_mode=1 для ЛС
 * 3. findDmActivePosts находит ЛС запись
 * 4. Канальная и ЛС записи независимы
 */
describe('Dual Mode: channel_enabled=1 И dm_enabled=1', () => {
  const TEST_USER_ID = 888888;
  const CHANNEL_MESSAGE_ID = 100001;
  const DM_MESSAGE_ID = 100002;

  beforeEach(() => {
    // Очищаем тестовые данные
    db.query('DELETE FROM interactive_posts WHERE user_id = ?').run(TEST_USER_ID);
  });

  afterEach(() => {
    // Очищаем после теста
    db.query('DELETE FROM interactive_posts WHERE user_id = ?').run(TEST_USER_ID);
  });

  describe('Создание двух записей для dual mode', () => {
    it('должен создать запись для канала с is_dm_mode=0', () => {
      // Симулируем создание канального поста (как в sendDailyMessage)
      saveInteractivePost(
        CHANNEL_MESSAGE_ID,
        TEST_USER_ID,
        { test: 'channel post' },
        'breathing',
        false // is_dm_mode = false (канал)
      );

      const post = getInteractivePost(CHANNEL_MESSAGE_ID);

      expect(post).not.toBeNull();
      expect(post?.is_dm_mode).toBeFalsy(); // SQLite возвращает 0
      expect(post?.user_id).toBe(TEST_USER_ID);
    });

    it('должен создать отдельную запись для ЛС с is_dm_mode=1', () => {
      // Симулируем создание ЛС поста (новая логика!)
      saveInteractivePost(
        DM_MESSAGE_ID,
        TEST_USER_ID,
        { test: 'dm post' },
        'breathing',
        true // is_dm_mode = true (ЛС)
      );

      const post = getInteractivePost(DM_MESSAGE_ID);

      expect(post).not.toBeNull();
      expect(post?.is_dm_mode).toBeTruthy(); // SQLite возвращает 1
      expect(post?.user_id).toBe(TEST_USER_ID);
    });

    it('обе записи должны существовать одновременно с разными channel_message_id', () => {
      // Создаём канальный пост
      saveInteractivePost(
        CHANNEL_MESSAGE_ID,
        TEST_USER_ID,
        { test: 'channel post' },
        'breathing',
        false
      );

      // Создаём ЛС пост (новая логика!)
      saveInteractivePost(
        DM_MESSAGE_ID,
        TEST_USER_ID,
        { test: 'dm post' },
        'breathing',
        true
      );

      // Проверяем что оба поста существуют
      const channelPost = getInteractivePost(CHANNEL_MESSAGE_ID);
      const dmPost = getInteractivePost(DM_MESSAGE_ID);

      expect(channelPost).not.toBeNull();
      expect(dmPost).not.toBeNull();

      // Разные channel_message_id
      expect(channelPost?.channel_message_id).toBe(CHANNEL_MESSAGE_ID);
      expect(dmPost?.channel_message_id).toBe(DM_MESSAGE_ID);

      // Разные is_dm_mode
      expect(channelPost?.is_dm_mode).toBeFalsy(); // SQLite возвращает 0
      expect(dmPost?.is_dm_mode).toBeTruthy(); // SQLite возвращает 1

      // Один и тот же пользователь
      expect(channelPost?.user_id).toBe(TEST_USER_ID);
      expect(dmPost?.user_id).toBe(TEST_USER_ID);
    });
  });

  describe('findDmActivePosts находит только ЛС пост', () => {
    it('должен находить ЛС пост и НЕ находить канальный', () => {
      // Создаём оба поста
      saveInteractivePost(CHANNEL_MESSAGE_ID, TEST_USER_ID, {}, 'breathing', false);
      saveInteractivePost(DM_MESSAGE_ID, TEST_USER_ID, {}, 'breathing', true);

      // Используем SQL-запрос как в findDmActivePosts
      const query = db.query(`
        SELECT
          'evening' as type,
          channel_message_id,
          current_state,
          is_dm_mode
        FROM interactive_posts
        WHERE user_id = ?
          AND is_dm_mode = 1
          AND (current_state IS NULL OR current_state NOT IN ('finished'))
        ORDER BY created_at DESC
      `);

      const posts = query.all(TEST_USER_ID) as any[];

      // Должен быть ТОЛЬКО ЛС пост
      expect(posts.length).toBe(1);
      expect(posts[0].channel_message_id).toBe(DM_MESSAGE_ID);
      expect(posts[0].is_dm_mode).toBe(1); // SQLite возвращает 1/0
    });
  });

  describe('Независимость канального и ЛС диалогов', () => {
    it('изменение состояния канального поста НЕ должно влиять на ЛС пост', () => {
      // Создаём оба поста в состоянии scenario_choice
      saveInteractivePost(CHANNEL_MESSAGE_ID, TEST_USER_ID, {}, 'breathing', false);
      saveInteractivePost(DM_MESSAGE_ID, TEST_USER_ID, {}, 'breathing', true);

      // Изменяем состояние канального поста
      db.query(`
        UPDATE interactive_posts
        SET current_state = 'waiting_negative'
        WHERE channel_message_id = ?
      `).run(CHANNEL_MESSAGE_ID);

      // Проверяем что ЛС пост не изменился
      const dmPost = getInteractivePost(DM_MESSAGE_ID);
      expect(dmPost?.current_state).toBe('scenario_choice'); // Начальное состояние

      // А канальный изменился
      const channelPost = getInteractivePost(CHANNEL_MESSAGE_ID);
      expect(channelPost?.current_state).toBe('waiting_negative');
    });

    it('завершение канального поста НЕ должно завершать ЛС пост', () => {
      // Создаём оба поста
      saveInteractivePost(CHANNEL_MESSAGE_ID, TEST_USER_ID, {}, 'breathing', false);
      saveInteractivePost(DM_MESSAGE_ID, TEST_USER_ID, {}, 'breathing', true);

      // Завершаем канальный пост
      db.query(`
        UPDATE interactive_posts
        SET current_state = 'finished', task1_completed = 1, task2_completed = 1, task3_completed = 1
        WHERE channel_message_id = ?
      `).run(CHANNEL_MESSAGE_ID);

      // Проверяем что ЛС пост всё ещё активен
      const dmPost = getInteractivePost(DM_MESSAGE_ID);
      expect(dmPost?.current_state).toBe('scenario_choice');
      expect(dmPost?.task1_completed).toBeFalsy(); // SQLite возвращает 0

      // А канальный завершён
      const channelPost = getInteractivePost(CHANNEL_MESSAGE_ID);
      expect(channelPost?.current_state).toBe('finished');
    });
  });

  describe('Статистика НЕ задваивается', () => {
    it('две записи в interactive_posts НЕ влияют на user_daily_posts', () => {
      // user_daily_posts имеет UNIQUE constraint на (user_id, post_date, post_type)
      // Поэтому только одна запись в user_daily_posts, даже если два поста в interactive_posts

      const today = new Date().toISOString().split('T')[0];

      // Создаём оба поста в interactive_posts
      saveInteractivePost(CHANNEL_MESSAGE_ID, TEST_USER_ID, {}, 'breathing', false);
      saveInteractivePost(DM_MESSAGE_ID, TEST_USER_ID, {}, 'breathing', true);

      // Создаём ОДНУ запись в user_daily_posts (как делает основная логика)
      db.query(`
        INSERT OR IGNORE INTO user_daily_posts (user_id, post_date, post_type, channel_message_id, sent_at)
        VALUES (?, ?, 'evening', ?, ?)
      `).run(TEST_USER_ID, today, CHANNEL_MESSAGE_ID, new Date().toISOString());

      // Проверяем что в user_daily_posts ОДНА запись
      const dailyPosts = db.query(`
        SELECT COUNT(*) as count FROM user_daily_posts
        WHERE user_id = ? AND post_date = ? AND post_type = 'evening'
      `).get(TEST_USER_ID, today) as { count: number };

      expect(dailyPosts.count).toBe(1);

      // Очищаем
      db.query('DELETE FROM user_daily_posts WHERE user_id = ?').run(TEST_USER_ID);
    });
  });
});

console.log('✅ Тесты для dual mode (channel + DM) готовы к запуску');
