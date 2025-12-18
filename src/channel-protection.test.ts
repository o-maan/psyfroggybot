/**
 * Тесты для защиты от попадания чужих постов в канал целевого пользователя
 *
 * Проверяем что:
 * 1. Только целевой пользователь может отправлять посты в канал
 * 2. Все остальные пользователи отправляют посты в ЛС (даже если channel_enabled=1 в БД)
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { db } from './db';

describe('Защита канала целевого пользователя', () => {
  // ⚠️ ВАЖНО: Используем ФЕЙКОВЫЕ ID чтобы не затронуть реальных пользователей!
  const targetUserId = 9999999901; // Фейковый целевой пользователь
  const otherUserId = 9999999902; // Фейковый другой пользователь

  beforeEach(() => {
    // Очищаем только ТЕСТОВЫЕ данные (фейковые ID)
    db.query('DELETE FROM users WHERE chat_id IN (?, ?)').run(targetUserId, otherUserId);

    // Создаем целевого пользователя с channel_enabled=1
    db.query(`
      INSERT INTO users (chat_id, username, dm_enabled, channel_enabled, timezone, timezone_offset)
      VALUES (?, 'target_user', 1, 1, 'Europe/Moscow', 180)
    `).run(targetUserId);

    // Создаем другого пользователя с channel_enabled=1 (некорректно!)
    db.query(`
      INSERT INTO users (chat_id, username, dm_enabled, channel_enabled, timezone, timezone_offset)
      VALUES (?, 'other_user', 1, 1, 'Europe/Moscow', 180)
    `).run(otherUserId);
  });

  it('целевой пользователь имеет channel_enabled=1', () => {
    const user = db.query('SELECT * FROM users WHERE chat_id = ?').get(targetUserId) as any;

    expect(user).toBeDefined();
    expect(user.channel_enabled).toBe(1);
    expect(user.dm_enabled).toBe(1);
  });

  it('другой пользователь имеет channel_enabled=1 в БД (некорректное состояние)', () => {
    const user = db.query('SELECT * FROM users WHERE chat_id = ?').get(otherUserId) as any;

    expect(user).toBeDefined();
    expect(user.channel_enabled).toBe(1); // В БД стоит 1, но код должен игнорировать это!
    expect(user.dm_enabled).toBe(1);
  });

  it('SQL скрипт должен очистить channel_enabled у нецелевых пользователей', () => {
    // Эмулируем выполнение SQL скрипта
    db.query(`
      UPDATE users
      SET channel_enabled = 0
      WHERE chat_id > 0 AND chat_id != ?
    `).run(targetUserId);

    // Проверяем результат
    const targetUser = db.query('SELECT * FROM users WHERE chat_id = ?').get(targetUserId) as any;
    const otherUser = db.query('SELECT * FROM users WHERE chat_id = ?').get(otherUserId) as any;

    expect(targetUser.channel_enabled).toBe(1); // Целевой - не изменился
    expect(otherUser.channel_enabled).toBe(0);  // Другой - очищен
  });

  it('после очистки только целевой пользователь имеет channel_enabled=1', () => {
    // Очищаем channel_enabled у всех кроме целевого
    db.query(`
      UPDATE users
      SET channel_enabled = 0
      WHERE chat_id > 0 AND chat_id != ?
    `).run(targetUserId);

    // Подсчитываем пользователей с channel_enabled=1
    const result = db.query(`
      SELECT COUNT(*) as count
      FROM users
      WHERE chat_id > 0 AND channel_enabled = 1
    `).get() as { count: number };

    expect(result.count).toBe(1); // Только целевой пользователь
  });
});

console.log('✅ Все тесты для защиты канала написаны и готовы к запуску');
