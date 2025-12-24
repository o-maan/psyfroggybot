import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';

describe('findUserActiveDmPosts() - поиск активных DM постов', () => {
  let db: Database;

  beforeAll(() => {
    // Создаём in-memory базу для тестов
    db = new Database(':memory:');

    // Создаём таблицы
    db.exec(`
      CREATE TABLE morning_posts (
        id INTEGER PRIMARY KEY,
        channel_message_id INTEGER,
        user_id INTEGER,
        created_at TEXT,
        current_step TEXT,
        is_dm_mode INTEGER DEFAULT 0
      );

      CREATE TABLE interactive_posts (
        id INTEGER PRIMARY KEY,
        channel_message_id INTEGER,
        user_id INTEGER,
        created_at TEXT,
        current_state TEXT,
        is_dm_mode INTEGER DEFAULT 0
      );
    `);
  });

  afterAll(() => {
    db.close();
  });

  function findUserActiveDmPosts(userId: number) {
    const query = db.query(`
      SELECT
        'morning' as type,
        channel_message_id,
        current_step as current_state,
        created_at
      FROM morning_posts
      WHERE user_id = ?
        AND is_dm_mode = 1
        AND current_step NOT IN ('completed')

      UNION ALL

      SELECT
        'evening' as type,
        channel_message_id,
        current_state,
        created_at
      FROM interactive_posts
      WHERE user_id = ?
        AND is_dm_mode = 1
        AND (current_state IS NULL OR current_state NOT IN ('finished'))

      ORDER BY created_at DESC
    `);

    return query.all(userId, userId) as any[];
  }

  it('должен находить активный утренний пост в DM режиме', () => {
    const userId = 100;

    // Вставляем утренний пост в DM режиме
    db.exec(`
      INSERT INTO morning_posts (channel_message_id, user_id, created_at, current_step, is_dm_mode)
      VALUES (1001, ${userId}, '2024-01-15 10:00:00', 'waiting_events', 1)
    `);

    const posts = findUserActiveDmPosts(userId);

    expect(posts.length).toBe(1);
    expect(posts[0].type).toBe('morning');
    expect(posts[0].current_state).toBe('waiting_events');
  });

  it('должен находить активный вечерний пост в DM режиме', () => {
    const userId = 101;

    // Вставляем вечерний пост в DM режиме
    db.exec(`
      INSERT INTO interactive_posts (channel_message_id, user_id, created_at, current_state, is_dm_mode)
      VALUES (2001, ${userId}, '2024-01-15 22:00:00', 'waiting_negative', 1)
    `);

    const posts = findUserActiveDmPosts(userId);

    expect(posts.length).toBe(1);
    expect(posts[0].type).toBe('evening');
    expect(posts[0].current_state).toBe('waiting_negative');
  });

  it('НЕ должен находить завершённый вечерний пост (finished)', () => {
    const userId = 102;

    // Вставляем завершённый вечерний пост
    db.exec(`
      INSERT INTO interactive_posts (channel_message_id, user_id, created_at, current_state, is_dm_mode)
      VALUES (2002, ${userId}, '2024-01-15 22:00:00', 'finished', 1)
    `);

    const posts = findUserActiveDmPosts(userId);

    expect(posts.length).toBe(0);
  });

  it('НЕ должен находить завершённый утренний пост (completed)', () => {
    const userId = 103;

    // Вставляем завершённый утренний пост
    db.exec(`
      INSERT INTO morning_posts (channel_message_id, user_id, created_at, current_step, is_dm_mode)
      VALUES (1003, ${userId}, '2024-01-15 10:00:00', 'completed', 1)
    `);

    const posts = findUserActiveDmPosts(userId);

    expect(posts.length).toBe(0);
  });

  it('НЕ должен находить пост НЕ в DM режиме (канальный)', () => {
    const userId = 104;

    // Вставляем пост в канальном режиме (is_dm_mode = 0)
    db.exec(`
      INSERT INTO interactive_posts (channel_message_id, user_id, created_at, current_state, is_dm_mode)
      VALUES (2004, ${userId}, '2024-01-15 22:00:00', 'waiting_negative', 0)
    `);

    const posts = findUserActiveDmPosts(userId);

    expect(posts.length).toBe(0);
  });

  it('должен возвращать посты отсортированные по дате (новые первыми)', () => {
    const userId = 105;

    // Вставляем несколько постов с разными датами
    db.exec(`
      INSERT INTO morning_posts (channel_message_id, user_id, created_at, current_step, is_dm_mode)
      VALUES (1005, ${userId}, '2024-01-15 08:00:00', 'waiting_events', 1)
    `);

    db.exec(`
      INSERT INTO interactive_posts (channel_message_id, user_id, created_at, current_state, is_dm_mode)
      VALUES (2005, ${userId}, '2024-01-15 22:00:00', 'waiting_positive', 1)
    `);

    const posts = findUserActiveDmPosts(userId);

    expect(posts.length).toBe(2);
    // Первым должен быть более новый (вечерний)
    expect(posts[0].type).toBe('evening');
    expect(posts[1].type).toBe('morning');
  });

  it('должен находить посты только для указанного пользователя', () => {
    const userId1 = 106;
    const userId2 = 107;

    // Вставляем посты для разных пользователей
    db.exec(`
      INSERT INTO interactive_posts (channel_message_id, user_id, created_at, current_state, is_dm_mode)
      VALUES (2006, ${userId1}, '2024-01-15 22:00:00', 'waiting_negative', 1)
    `);

    db.exec(`
      INSERT INTO interactive_posts (channel_message_id, user_id, created_at, current_state, is_dm_mode)
      VALUES (2007, ${userId2}, '2024-01-15 22:00:00', 'waiting_positive', 1)
    `);

    const posts1 = findUserActiveDmPosts(userId1);
    const posts2 = findUserActiveDmPosts(userId2);

    expect(posts1.length).toBe(1);
    expect(posts1[0].current_state).toBe('waiting_negative');

    expect(posts2.length).toBe(1);
    expect(posts2[0].current_state).toBe('waiting_positive');
  });

  it('должен возвращать пустой массив для несуществующего пользователя', () => {
    const userId = 999999;

    const posts = findUserActiveDmPosts(userId);

    expect(posts).toEqual([]);
  });

  it('КРИТИЧНО: вечерний scenario_choice пост должен быть первым когда он новее утреннего', () => {
    const userId = 200;

    // Утренний пост (старый, 08:00)
    db.exec(`
      INSERT INTO morning_posts (channel_message_id, user_id, created_at, current_step, is_dm_mode)
      VALUES (3001, ${userId}, '2024-01-15 08:00:00', 'waiting_events', 1)
    `);

    // Вечерний пост (новый, 22:00) со статусом scenario_choice
    db.exec(`
      INSERT INTO interactive_posts (channel_message_id, user_id, created_at, current_state, is_dm_mode)
      VALUES (3002, ${userId}, '2024-01-15 22:00:00', 'scenario_choice', 1)
    `);

    const posts = findUserActiveDmPosts(userId);

    // Должно быть 2 поста
    expect(posts.length).toBe(2);

    // ПЕРВЫМ должен быть вечерний (он новее!)
    expect(posts[0].type).toBe('evening');
    expect(posts[0].current_state).toBe('scenario_choice');

    // Вторым - утренний
    expect(posts[1].type).toBe('morning');
  });

  it('КРИТИЧНО: НЕ должен возвращать завершённый утренний пост (completed)', () => {
    const userId = 201;

    // Утренний пост ЗАВЕРШЁН
    db.exec(`
      INSERT INTO morning_posts (channel_message_id, user_id, created_at, current_step, is_dm_mode)
      VALUES (3003, ${userId}, '2024-01-15 08:00:00', 'completed', 1)
    `);

    // Вечерний пост scenario_choice
    db.exec(`
      INSERT INTO interactive_posts (channel_message_id, user_id, created_at, current_state, is_dm_mode)
      VALUES (3004, ${userId}, '2024-01-15 22:00:00', 'scenario_choice', 1)
    `);

    const posts = findUserActiveDmPosts(userId);

    // Должен быть ТОЛЬКО вечерний (утренний completed - исключён)
    expect(posts.length).toBe(1);
    expect(posts[0].type).toBe('evening');
    expect(posts[0].current_state).toBe('scenario_choice');
  });

  it('КРИТИЧНО: должен находить вечерний пост с current_state = NULL (новый пост)', () => {
    const userId = 202;

    // Вставляем вечерний пост БЕЗ current_state (NULL) - как старые посты до фикса
    db.exec(`
      INSERT INTO interactive_posts (channel_message_id, user_id, created_at, is_dm_mode)
      VALUES (3005, ${userId}, '2024-01-15 22:00:00', 1)
    `);

    const posts = findUserActiveDmPosts(userId);

    // Пост с NULL current_state ДОЛЖЕН находиться!
    expect(posts.length).toBe(1);
    expect(posts[0].type).toBe('evening');
    expect(posts[0].current_state).toBe(null);
  });
});
