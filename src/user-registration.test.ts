import { describe, expect, it, beforeEach } from 'bun:test';
import { addUser, enableDMMode, getUserByChatId } from './db';

/**
 * Тест регистрации нового пользователя через /start
 * Проверяем что dm_enabled автоматически устанавливается в 1
 */

describe('Регистрация пользователя через /start', () => {
  const testChatId = 999111222;

  beforeEach(() => {
    // Удаляем тестового пользователя перед каждым тестом
    const { db } = require('./db');
    db.query('DELETE FROM users WHERE chat_id = ?').run(testChatId);
  });

  it('новый пользователь получает dm_enabled=1 автоматически', () => {
    // Эмулируем /start команду
    addUser(testChatId, 'test_user');
    enableDMMode(testChatId);

    const user = getUserByChatId(testChatId);

    expect(user).toBeDefined();
    expect(user!.dm_enabled).toBe(1);
    expect(user!.channel_enabled).toBe(0);
  });

  it('повторный /start не ломает флаги', () => {
    // Первый /start
    addUser(testChatId, 'test_user');
    enableDMMode(testChatId);

    const userBefore = getUserByChatId(testChatId);
    expect(userBefore!.dm_enabled).toBe(1);

    // Повторный /start (INSERT OR IGNORE не перезапишет)
    addUser(testChatId, 'test_user');
    enableDMMode(testChatId);

    const userAfter = getUserByChatId(testChatId);
    expect(userAfter!.dm_enabled).toBe(1);
    expect(userAfter!.channel_enabled).toBe(0);
  });
});
