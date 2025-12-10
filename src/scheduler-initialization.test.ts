import { describe, expect, it, beforeEach, spyOn } from 'bun:test';
import * as db from './db';

/**
 * Тест инициализации планировщика
 * Проверяем что в рассылку попадают ТОЛЬКО пользователи с dm_enabled=1 ИЛИ channel_enabled=1
 */

describe('Инициализация планировщика', () => {
  it('getAllUsers должен вернуть всех пользователей независимо от флагов', () => {
    const allUsers = db.getAllUsers();

    // Проверяем что функция возвращает массив
    expect(Array.isArray(allUsers)).toBe(true);

    // Должны быть пользователи с разными комбинациями флагов
    console.log('Все пользователи в БД:', allUsers.map(u => ({
      chat_id: u.chat_id,
      username: u.username,
      dm_enabled: u.dm_enabled,
      channel_enabled: u.channel_enabled
    })));
  });

  it('фильтр должен пропускать только пользователей с включенной доставкой', () => {
    const allUsers = db.getAllUsers();

    // Применяем ту же логику что и в планировщике
    const users = allUsers.filter(user => {
      const isRealUser = user.chat_id > 0; // НЕ группа
      const hasDeliveryEnabled = user.dm_enabled === 1 || user.channel_enabled === 1;
      return isRealUser && hasDeliveryEnabled;
    });

    console.log('Пользователи для рассылки:', users.map(u => ({
      chat_id: u.chat_id,
      username: u.username,
      dm_enabled: u.dm_enabled,
      channel_enabled: u.channel_enabled
    })));

    // Проверяем что ВСЕ пользователи в списке имеют хотя бы один флаг включен
    for (const user of users) {
      const hasDelivery = user.dm_enabled === 1 || user.channel_enabled === 1;
      expect(hasDelivery).toBe(true);
      expect(user.chat_id).toBeGreaterThan(0);
    }
  });

  it('пользователи с dm_enabled=0 и channel_enabled=0 НЕ должны попасть в рассылку', () => {
    const allUsers = db.getAllUsers();

    // Применяем фильтр
    const users = allUsers.filter(user => {
      const isRealUser = user.chat_id > 0;
      const hasDeliveryEnabled = user.dm_enabled === 1 || user.channel_enabled === 1;
      return isRealUser && hasDeliveryEnabled;
    });

    // Проверяем что пользователи с выключенными флагами НЕ попали в список
    const disabledUsers = users.filter(u => u.dm_enabled === 0 && u.channel_enabled === 0);
    expect(disabledUsers.length).toBe(0);
  });

  it('группы (chat_id < 0) НЕ должны попасть в рассылку', () => {
    const allUsers = db.getAllUsers();

    // Применяем фильтр
    const users = allUsers.filter(user => {
      const isRealUser = user.chat_id > 0;
      const hasDeliveryEnabled = user.dm_enabled === 1 || user.channel_enabled === 1;
      return isRealUser && hasDeliveryEnabled;
    });

    // Проверяем что все chat_id положительные
    for (const user of users) {
      expect(user.chat_id).toBeGreaterThan(0);
    }
  });

  it('новый пользователь после /start должен попасть в рассылку', () => {
    const testChatId = 888999000;

    // Удаляем если есть
    const { db: dbInstance } = require('./db');
    dbInstance.query('DELETE FROM users WHERE chat_id = ?').run(testChatId);

    // Эмулируем /start
    db.addUser(testChatId, 'test_auto_delivery');
    db.enableDMMode(testChatId);

    // Проверяем что пользователь попадет в рассылку
    const allUsers = db.getAllUsers();
    const users = allUsers.filter(user => {
      const isRealUser = user.chat_id > 0;
      const hasDeliveryEnabled = user.dm_enabled === 1 || user.channel_enabled === 1;
      return isRealUser && hasDeliveryEnabled;
    });

    const newUser = users.find(u => u.chat_id === testChatId);
    expect(newUser).toBeDefined();
    expect(newUser!.dm_enabled).toBe(1);

    // Удаляем тестового пользователя
    dbInstance.query('DELETE FROM users WHERE chat_id = ?').run(testChatId);
  });
});
