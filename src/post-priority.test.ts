import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { getUserIncompletePostsByMode, insertInteractivePost, updateInteractivePostState, clearInteractivePosts } from './db';

describe('Приоритизация постов в getUserIncompletePostsByMode', () => {
  const TEST_USER_ID = 999999;
  const TEST_DM_MODE = true;

  // Генератор уникальных ID для каждого теста
  let postIdCounter = 10000;
  const getUniquePostId = () => postIdCounter++;

  beforeEach(() => {
    // Очищаем тестовые посты перед каждым тестом
    clearInteractivePosts(TEST_USER_ID);
  });

  afterEach(() => {
    // Очищаем после теста
    clearInteractivePosts(TEST_USER_ID);
  });

  describe('Приоритет waiting_emotions_addition', () => {
    it('должен выбрать новый пост в waiting_emotions_addition вместо старого в scenario_choice', () => {
      // Создаем СТАРЫЙ пост в состоянии scenario_choice
      const oldPostId = getUniquePostId();
      insertInteractivePost(
        oldPostId,
        TEST_USER_ID,
        TEST_DM_MODE,
        { test: 'old post' },
        'scenario_choice'
      );

      // Ждем 1 секунду, чтобы created_at был разным
      const start = Date.now();
      while (Date.now() - start < 1000) {
        // wait
      }

      // Создаем НОВЫЙ пост в состоянии waiting_emotions_addition
      const newPostId = getUniquePostId();
      insertInteractivePost(
        newPostId,
        TEST_USER_ID,
        TEST_DM_MODE,
        { test: 'new post' },
        'waiting_emotions_addition'
      );

      // Получаем посты
      const posts = getUserIncompletePostsByMode(TEST_USER_ID, TEST_DM_MODE);

      // Проверяем, что первым идет НОВЫЙ пост с waiting_emotions_addition
      expect(posts.length).toBeGreaterThanOrEqual(2);
      expect(posts[0].channel_message_id).toBe(newPostId);
      expect(posts[0].current_state).toBe('waiting_emotions_addition');

      // Старый пост должен быть вторым
      expect(posts[1].channel_message_id).toBe(oldPostId);
      expect(posts[1].current_state).toBe('scenario_choice');
    });

    it('должен отдать приоритет waiting_emotions_addition над любыми не-приоритетными состояниями', () => {
      // Создаем старый пост в не-приоритетном состоянии
      const oldPostId = getUniquePostId();
      insertInteractivePost(
        oldPostId,
        TEST_USER_ID,
        TEST_DM_MODE,
        { test: 'old post' },
        'some_completed_state'
      );
      // Устанавливаем task1_completed = 0 чтобы пост считался незавершенным
      updateInteractivePostState(oldPostId, 'some_completed_state', { task1_completed: 0 });

      // Ждем
      const start = Date.now();
      while (Date.now() - start < 1000) {
        // wait
      }

      // Создаем новый пост в waiting_emotions_addition
      const newPostId = getUniquePostId();
      insertInteractivePost(
        newPostId,
        TEST_USER_ID,
        TEST_DM_MODE,
        { test: 'new post' },
        'waiting_emotions_addition'
      );

      const posts = getUserIncompletePostsByMode(TEST_USER_ID, TEST_DM_MODE);

      // waiting_emotions_addition должен быть первым (priority=0 vs priority=1)
      expect(posts[0].channel_message_id).toBe(newPostId);
      expect(posts[0].current_state).toBe('waiting_emotions_addition');
    });
  });

  describe('Сохранение приоритета других waiting состояний', () => {
    it('должен отдать приоритет waiting_negative над waiting_emotions_addition если waiting_negative новее', () => {
      // Старый пост в waiting_emotions_addition
      const oldPostId = getUniquePostId();
      insertInteractivePost(
        oldPostId,
        TEST_USER_ID,
        TEST_DM_MODE,
        { test: 'old post' },
        'waiting_emotions_addition'
      );

      // Ждем
      const start = Date.now();
      while (Date.now() - start < 1000) {
        // wait
      }

      // Новый пост в waiting_negative (тоже priority=0)
      const newPostId = getUniquePostId();
      insertInteractivePost(
        newPostId,
        TEST_USER_ID,
        TEST_DM_MODE,
        { test: 'new post' },
        'waiting_negative'
      );

      const posts = getUserIncompletePostsByMode(TEST_USER_ID, TEST_DM_MODE);

      // Оба имеют priority=0, но waiting_negative новее -> он должен быть первым
      expect(posts[0].channel_message_id).toBe(newPostId);
      expect(posts[0].current_state).toBe('waiting_negative');

      expect(posts[1].channel_message_id).toBe(oldPostId);
      expect(posts[1].current_state).toBe('waiting_emotions_addition');
    });

    it('должен правильно сортировать все приоритетные состояния по created_at', () => {
      const states = [
        'scenario_choice',
        'waiting_negative',
        'waiting_positive',
        'waiting_task3',
        'waiting_emotions_clarification',
        'waiting_positive_emotions_clarification',
        'waiting_emotions_addition'
      ];

      // Создаем посты с задержкой в 1 секунду между каждым (чтобы datetime('now') был разным)
      const postIds: number[] = [];
      for (let i = 0; i < states.length; i++) {
        const postId = getUniquePostId();
        postIds.push(postId);
        insertInteractivePost(
          postId,
          TEST_USER_ID,
          TEST_DM_MODE,
          { test: `post ${i}` },
          states[i]
        );

        // Задержка 1 секунда между постами (кроме последнего)
        if (i < states.length - 1) {
          const start = Date.now();
          while (Date.now() - start < 1000) {
            // wait
          }
        }
      }

      const posts = getUserIncompletePostsByMode(TEST_USER_ID, TEST_DM_MODE);

      // Все посты имеют priority=0, поэтому должны быть отсортированы по created_at DESC
      // Последний созданный (waiting_emotions_addition) должен быть первым
      expect(posts[0].channel_message_id).toBe(postIds[postIds.length - 1]);
      expect(posts[0].current_state).toBe('waiting_emotions_addition');

      // Проверяем, что все посты идут в обратном порядке создания
      for (let i = 0; i < posts.length; i++) {
        expect(posts[i].channel_message_id).toBe(postIds[postIds.length - 1 - i]);
      }
    });
  });

  describe('Сценарий из бага', () => {
    it('должен воспроизвести и исправить исходный баг', () => {
      // Создаем СТАРЫЙ пост в scenario_choice (как в логах 6617)
      const oldPostId = getUniquePostId();
      insertInteractivePost(
        oldPostId,
        TEST_USER_ID,
        TEST_DM_MODE,
        { scenario: 'simplified' },
        'scenario_choice'
      );

      // Ждем
      const start = Date.now();
      while (Date.now() - start < 1000) {
        // wait
      }

      // Создаем НОВЫЙ пост в waiting_emotions_addition (как в логах 6619)
      const newPostId = getUniquePostId();
      insertInteractivePost(
        newPostId,
        TEST_USER_ID,
        TEST_DM_MODE,
        { emotions_requested: true },
        'waiting_emotions_addition'
      );

      // Получаем посты через функцию, которая использовалась в баге
      const posts = getUserIncompletePostsByMode(TEST_USER_ID, TEST_DM_MODE);

      // ✅ ПОСЛЕ ИСПРАВЛЕНИЯ: должен вернуть НОВЫЙ пост первым
      expect(posts.length).toBeGreaterThanOrEqual(2);
      expect(posts[0].channel_message_id).toBe(newPostId);
      expect(posts[0].current_state).toBe('waiting_emotions_addition');

      // Старый пост должен быть вторым
      expect(posts[1].channel_message_id).toBe(oldPostId);
      expect(posts[1].current_state).toBe('scenario_choice');

      console.log('✅ БАГ ИСПРАВЛЕН: waiting_emotions_addition теперь имеет priority=0');
    });
  });
});
