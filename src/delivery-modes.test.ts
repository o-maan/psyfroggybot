import { beforeEach, describe, expect, it, spyOn, mock } from 'bun:test';
import * as fs from 'fs';
import type { Telegraf } from 'telegraf';
import type { CalendarService } from './calendar';
import { Scheduler } from './scheduler';
import * as db from './db';

/**
 * Тесты для проверки корректности доставки сообщений
 * в зависимости от флагов dm_enabled и channel_enabled
 */

describe('Режимы доставки (dm_enabled/channel_enabled)', () => {
  let scheduler: Scheduler;
  let mockBot: any;
  let sendPhotoSpy: any;
  let sendMessageSpy: any;

  beforeEach(() => {
    // Мокаем логгеры
    const { logger, schedulerLogger, botLogger, calendarLogger, databaseLogger } = require('./logger');
    spyOn(logger, 'info').mockImplementation(() => {});
    spyOn(logger, 'error').mockImplementation(() => {});
    spyOn(schedulerLogger, 'info').mockImplementation(() => {});
    spyOn(schedulerLogger, 'error').mockImplementation(() => {});
    spyOn(schedulerLogger, 'debug').mockImplementation(() => {});
    spyOn(schedulerLogger, 'warn').mockImplementation(() => {});
    spyOn(botLogger, 'info').mockImplementation(() => {});
    spyOn(botLogger, 'error').mockImplementation(() => {});
    spyOn(calendarLogger, 'error').mockImplementation(() => {});
    spyOn(databaseLogger, 'info').mockImplementation(() => {});

    // Мокаем файловую систему
    spyOn(fs, 'readFileSync').mockReturnValue('Mock prompt');
    spyOn(fs, 'readdirSync').mockReturnValue(['test.jpg'] as any);

    // Мокаем DB функции
    spyOn(db, 'getAllUsers').mockReturnValue([]);
    spyOn(db, 'getUserImageIndex').mockReturnValue(0);
    spyOn(db, 'saveUserImageIndex').mockImplementation(() => {});
    spyOn(db, 'addUser').mockImplementation(() => {});
    spyOn(db, 'saveMessage').mockImplementation(() => {});
    spyOn(db, 'updateUserResponseStats').mockImplementation(() => {});
    spyOn(db, 'getUserResponseStats').mockReturnValue(null);
    spyOn(db, 'hasEnoughEveningPosts').mockReturnValue(false);
    spyOn(db, 'saveAngryPost').mockImplementation(() => {});
    spyOn(db, 'getAngryPost').mockReturnValue(null);
    spyOn(db, 'saveMorningPost').mockImplementation(() => {});
    spyOn(db, 'getMorningPost').mockReturnValue(null);

    // Создаем мок бота с шпионами
    sendPhotoSpy = mock(() => Promise.resolve({ message_id: 123 }));
    sendMessageSpy = mock(() => Promise.resolve({ message_id: 124 }));
    const sendChatActionSpy = mock(() => Promise.resolve());

    mockBot = {
      telegram: {
        sendPhoto: sendPhotoSpy,
        sendMessage: sendMessageSpy,
        sendChatAction: sendChatActionSpy,
      },
    } as any;

    const mockCalendarService = {} as CalendarService;
    scheduler = new Scheduler(mockBot, mockCalendarService);
  });

  describe('Вечерний пост (sendInteractiveDailyMessage)', () => {
    it('dm_enabled=1, channel_enabled=1 → канал + копия в ЛС', async () => {
      const userId = 476561547;
      const CHANNEL_ID = scheduler.CHANNEL_ID;

      // Мокаем getUserByChatId для возврата пользователя с обоими флагами
      spyOn(db, 'getUserByChatId').mockReturnValue({
        chat_id: userId,
        dm_enabled: 1,
        channel_enabled: 1,
        timezone: 'Europe/Moscow',
      });

      // Мокаем LLM
      const llm = require('./llm');
      spyOn(llm, 'generateMessage').mockResolvedValue(
        JSON.stringify({
          encouragement: 'Тест',
          unload_negative: 'Тест',
          plushki: 'Тест',
          emotions: 'Тест',
          rating: 'Тест',
          relax_or_breathing: 'relax',
          relax: 'Тест',
        })
      );

      // Мокаем генерацию изображения
      spyOn(llm, 'generateImageFromPrompt').mockResolvedValue(Buffer.from('test'));

      // Вызываем метод
      await scheduler.sendInteractiveDailyMessage(userId, false, false);

      // Проверяем количество вызовов sendPhoto
      expect(sendPhotoSpy.mock.calls.length).toBeGreaterThanOrEqual(2);

      // Проверяем что первый вызов - в канал
      const firstCall = sendPhotoSpy.mock.calls[0];
      expect(firstCall[0]).toBe(CHANNEL_ID);

      // Проверяем что есть вызов в ЛС (userId)
      const dmCall = sendPhotoSpy.mock.calls.find((call: any) => call[0] === userId);
      expect(dmCall).toBeDefined();
    });

    it('dm_enabled=1, channel_enabled=0 → только ЛС', async () => {
      const userId = 999888777;

      // Мокаем getUserByChatId для возврата пользователя только с dm_enabled
      spyOn(db, 'getUserByChatId').mockReturnValue({
        chat_id: userId,
        dm_enabled: 1,
        channel_enabled: 0,
        timezone: 'Europe/Moscow',
      });

      // Мокаем LLM
      const llm = require('./llm');
      spyOn(llm, 'generateMessage').mockResolvedValue(
        JSON.stringify({
          encouragement: 'Тест',
          unload_negative: 'Тест',
          plushki: 'Тест',
          emotions: 'Тест',
          rating: 'Тест',
          relax_or_breathing: 'relax',
          relax: 'Тест',
        })
      );

      spyOn(llm, 'generateImageFromPrompt').mockResolvedValue(Buffer.from('test'));

      // Вызываем метод
      await scheduler.sendInteractiveDailyMessage(userId, false, false);

      // Проверяем что sendPhoto вызывается
      expect(sendPhotoSpy.mock.calls.length).toBeGreaterThanOrEqual(1);

      // Проверяем что ВСЕ вызовы sendPhoto идут в ЛС (userId)
      const allCallsToUserId = sendPhotoSpy.mock.calls.every((call: any) => call[0] === userId);
      expect(allCallsToUserId).toBe(true);
    });

    it('dm_enabled=0, channel_enabled=0 → ничего не отправляется', async () => {
      const userId = 111222333;

      // Мокаем getUserByChatId для возврата пользователя с выключенными флагами
      spyOn(db, 'getUserByChatId').mockReturnValue({
        chat_id: userId,
        dm_enabled: 0,
        channel_enabled: 0,
        timezone: 'Europe/Moscow',
      });

      // Вызываем метод
      await scheduler.sendInteractiveDailyMessage(userId, false, false);

      // Проверяем что sendPhoto НЕ вызывался
      expect(sendPhotoSpy.mock.calls.length).toBe(0);
    });
  });

  describe('Утренний пост (sendMorningMessage)', () => {
    it('dm_enabled=1, channel_enabled=1 → канал + копия в ЛС', async () => {
      const userId = 476561547;
      const CHANNEL_ID = scheduler.CHANNEL_ID;

      spyOn(db, 'getUserByChatId').mockReturnValue({
        chat_id: userId,
        dm_enabled: 1,
        channel_enabled: 1,
        timezone: 'Europe/Moscow',
      });

      const llm = require('./llm');
      spyOn(llm, 'generateMessage').mockResolvedValue(
        JSON.stringify({
          greeting: 'Доброе утро!',
          tasks: 'Задания на сегодня',
        })
      );
      spyOn(llm, 'generateImageFromPrompt').mockResolvedValue(Buffer.from('test'));

      await scheduler.sendMorningMessage(userId, true);

      // Проверяем что есть вызов в канал И в ЛС
      expect(sendPhotoSpy.mock.calls.length).toBeGreaterThanOrEqual(2);

      const channelCall = sendPhotoSpy.mock.calls.find((call: any) => call[0] === CHANNEL_ID);
      const dmCall = sendPhotoSpy.mock.calls.find((call: any) => call[0] === userId);

      expect(channelCall).toBeDefined();
      expect(dmCall).toBeDefined();
    });

    it('dm_enabled=1, channel_enabled=0 → только ЛС', async () => {
      const userId = 999888777;

      spyOn(db, 'getUserByChatId').mockReturnValue({
        chat_id: userId,
        dm_enabled: 1,
        channel_enabled: 0,
        timezone: 'Europe/Moscow',
      });

      const llm = require('./llm');
      spyOn(llm, 'generateMessage').mockResolvedValue(
        JSON.stringify({
          greeting: 'Доброе утро!',
          tasks: 'Задания на сегодня',
        })
      );
      spyOn(llm, 'generateImageFromPrompt').mockResolvedValue(Buffer.from('test'));

      await scheduler.sendMorningMessage(userId, true);

      // Все вызовы должны быть в ЛС
      const allCallsToUserId = sendPhotoSpy.mock.calls.every((call: any) => call[0] === userId);
      expect(allCallsToUserId).toBe(true);
    });
  });

  describe('Злой пост (sendAngryPost)', () => {
    it('dm_enabled=1, channel_enabled=1 → канал + копия в ЛС', async () => {
      const userId = 5153477378;
      const CHANNEL_ID = scheduler.CHANNEL_ID;

      spyOn(db, 'getUserByChatId').mockReturnValue({
        chat_id: userId,
        dm_enabled: 1,
        channel_enabled: 1,
        timezone: 'Europe/Belgrade',
      });

      const llm = require('./llm');
      spyOn(llm, 'generateMessage').mockResolvedValue('Злой текст от лягушки');
      spyOn(llm, 'generateImageFromPrompt').mockResolvedValue(Buffer.from('angry-frog'));

      // Вызываем приватный метод через any
      await (scheduler as any).sendAngryPost(userId);

      // Проверяем вызовы
      expect(sendPhotoSpy.mock.calls.length).toBe(2);

      const channelCall = sendPhotoSpy.mock.calls[0];
      const dmCall = sendPhotoSpy.mock.calls[1];

      expect(channelCall[0]).toBe(CHANNEL_ID);
      expect(dmCall[0]).toBe(userId);
    });

    it('dm_enabled=1, channel_enabled=0 → только ЛС', async () => {
      const userId = 999888777;

      spyOn(db, 'getUserByChatId').mockReturnValue({
        chat_id: userId,
        dm_enabled: 1,
        channel_enabled: 0,
        timezone: 'Europe/Moscow',
      });

      const llm = require('./llm');
      spyOn(llm, 'generateMessage').mockResolvedValue('Злой текст от лягушки');
      spyOn(llm, 'generateImageFromPrompt').mockResolvedValue(Buffer.from('angry-frog'));

      await (scheduler as any).sendAngryPost(userId);

      // Только один вызов - в ЛС
      expect(sendPhotoSpy.mock.calls.length).toBe(1);
      expect(sendPhotoSpy.mock.calls[0][0]).toBe(userId);
    });
  });

  describe('JOY пост (sendJoyPostWithWeeklySummary)', () => {
    it('dm_enabled=1, channel_enabled=1 → канал + копия в ЛС', async () => {
      const userId = 476561547;
      const CHANNEL_ID = scheduler.CHANNEL_ID;

      spyOn(db, 'getUserByChatId').mockReturnValue({
        chat_id: userId,
        dm_enabled: 1,
        channel_enabled: 1,
        timezone: 'Europe/Moscow',
      });

      spyOn(db, 'isJoyListEmpty').mockReturnValue(true);
      spyOn(db, 'getPositiveEventsSinceCheckpoint').mockReturnValue([]);

      const llm = require('./llm');
      spyOn(llm, 'generateImageFromPrompt').mockResolvedValue(Buffer.from('joy-frog'));

      await scheduler.sendJoyPostWithWeeklySummary(userId, true);

      // Проверяем что есть вызов в канал И в ЛС
      expect(sendPhotoSpy.mock.calls.length).toBe(2);

      const channelCall = sendPhotoSpy.mock.calls[0];
      const dmCall = sendPhotoSpy.mock.calls[1];

      expect(channelCall[0]).toBe(CHANNEL_ID);
      expect(dmCall[0]).toBe(userId);
    });

    it('dm_enabled=1, channel_enabled=0 → только ЛС', async () => {
      const userId = 999888777;

      spyOn(db, 'getUserByChatId').mockReturnValue({
        chat_id: userId,
        dm_enabled: 1,
        channel_enabled: 0,
        timezone: 'Europe/Moscow',
      });

      spyOn(db, 'isJoyListEmpty').mockReturnValue(true);
      spyOn(db, 'getPositiveEventsSinceCheckpoint').mockReturnValue([]);

      const llm = require('./llm');
      spyOn(llm, 'generateImageFromPrompt').mockResolvedValue(Buffer.from('joy-frog'));

      await scheduler.sendJoyPostWithWeeklySummary(userId, true);

      // Только один вызов - в ЛС
      expect(sendPhotoSpy.mock.calls.length).toBe(1);
      expect(sendPhotoSpy.mock.calls[0][0]).toBe(userId);
    });

    it('dm_enabled=0, channel_enabled=0 → ничего не отправляется', async () => {
      const userId = 111222333;

      spyOn(db, 'getUserByChatId').mockReturnValue({
        chat_id: userId,
        dm_enabled: 0,
        channel_enabled: 0,
        timezone: 'Europe/Moscow',
      });

      await scheduler.sendJoyPostWithWeeklySummary(userId, true);

      // Ничего не отправлено
      expect(sendPhotoSpy.mock.calls.length).toBe(0);
    });
  });
});
