import { beforeEach, describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'fs';
import type { Telegraf } from 'telegraf';
import type { CalendarService } from './calendar';
import * as llm from './llm';
import { Scheduler } from './scheduler';

// Моки для зависимостей
const mockBot = {} as Telegraf;
const mockCalendarService = {} as CalendarService;

describe('Scheduler', () => {
  let scheduler: Scheduler;
  let detectUserBusy: (events: any[]) => Promise<{ probably_busy: boolean; busy_reason: string | null }>;

  // Создаем моки
  const mockReadFileSync = spyOn(fs, 'readFileSync');
  const mockReaddirSync = spyOn(fs, 'readdirSync');
  const mockGenerateMessage = spyOn(llm, 'generateMessage');

  beforeEach(() => {
    // Настраиваем моки
    mockReadFileSync.mockReset();
    mockReaddirSync.mockReset();
    mockGenerateMessage.mockReset();

    // Дефолтные возвращаемые значения
    mockReadFileSync.mockReturnValue('Тестовый промпт для detect-busy');
    mockReaddirSync.mockReturnValue([]);
    mockGenerateMessage.mockResolvedValue(
      JSON.stringify({
        probably_busy: false,
        busy_reason: null,
      })
    );

    // Мокаем функции из db модуля
    const db = require('./db');
    spyOn(db, 'getAllUsers').mockReturnValue([]);
    spyOn(db, 'getUserImageIndex').mockReturnValue(null);
    spyOn(db, 'saveUserImageIndex').mockImplementation(() => {});
    spyOn(db, 'addUser').mockImplementation(() => {});

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

    scheduler = new Scheduler(mockBot, mockCalendarService);
    // Получаем доступ к приватному методу для тестирования
    detectUserBusy = (scheduler as any).detectUserBusy.bind(scheduler);
  });

  describe('detectUserBusy', () => {
    it('должен определить занятость при наличии перелета', async () => {
      mockGenerateMessage.mockResolvedValueOnce(
        JSON.stringify({
          probably_busy: true,
          busy_reason: 'flight',
        })
      );

      const events = [
        {
          summary: 'Перелет в Москву',
          start: { dateTime: '2024-01-01T15:00:00' },
          end: { dateTime: '2024-01-01T18:00:00' },
          location: 'Аэропорт Домодедово',
        },
      ];

      const result = await detectUserBusy(events);
      expect(result.probably_busy).toBe(true);
      expect(result.busy_reason).toBe('flight');

      // Проверяем что промпт содержит информацию о событии
      expect(mockGenerateMessage).toHaveBeenCalled();
      const callArg = mockGenerateMessage.mock.calls[0][0];
      expect(callArg).toContain('Перелет в Москву');
      expect(callArg).toContain('15:00');
      expect(callArg).toContain('Аэропорт Домодедово');
    });

    it('должен определить занятость при наличии поезда', async () => {
      mockGenerateMessage.mockResolvedValueOnce(
        JSON.stringify({
          probably_busy: true,
          busy_reason: 'flight',
        })
      );

      const events = [
        {
          summary: 'Поездка на поезде',
          start: { dateTime: '2024-01-01T10:00:00' },
          end: { dateTime: '2024-01-01T16:00:00' },
          transparency: 'opaque',
        },
      ];

      const result = await detectUserBusy(events);
      expect(result.probably_busy).toBe(true);

      // Проверяем что промпт содержит статус "Занят"
      const callArg = mockGenerateMessage.mock.calls[0][0];
      expect(callArg).toContain('Занят');
    });

    it('должен вернуть false если нет событий', async () => {
      mockGenerateMessage.mockResolvedValueOnce(
        JSON.stringify({
          probably_busy: false,
          busy_reason: null,
        })
      );

      const events: any[] = [];
      const result = await detectUserBusy(events);
      expect(result.probably_busy).toBe(false);
      expect(result.busy_reason).toBe(null);

      // Проверяем что промпт содержит "Нет событий"
      const callArg = mockGenerateMessage.mock.calls[0][0];
      expect(callArg).toContain('Нет событий в календаре');
    });

    it('должен обработать событие на весь день', async () => {
      mockGenerateMessage.mockResolvedValueOnce(
        JSON.stringify({
          probably_busy: false,
          busy_reason: null,
        })
      );

      const events = [
        {
          summary: 'Конференция',
          start: { date: '2024-01-01' }, // Событие на весь день
          location: 'Онлайн',
        },
      ];

      await detectUserBusy(events);

      // Проверяем что промпт содержит "Весь день"
      const callArg = mockGenerateMessage.mock.calls[0][0];
      expect(callArg).toContain('Весь день');
    });

    it('должен обработать ошибку LLM', async () => {
      mockGenerateMessage.mockResolvedValueOnce('HF_JSON_ERROR');

      const events = [{ summary: 'Встреча' }];
      const result = await detectUserBusy(events);

      expect(result.probably_busy).toBe(false);
      expect(result.busy_reason).toBe(null);
    });

    it('должен обработать невалидный JSON от LLM', async () => {
      mockGenerateMessage.mockResolvedValueOnce('Это не JSON');

      const events = [{ summary: 'Встреча' }];
      const result = await detectUserBusy(events);

      expect(result.probably_busy).toBe(false);
      expect(result.busy_reason).toBe(null);
    });

    it('должен правильно обработать статус занятости (свободен)', async () => {
      mockGenerateMessage.mockResolvedValueOnce(
        JSON.stringify({
          probably_busy: false,
          busy_reason: null,
        })
      );

      const events = [
        {
          summary: 'Встреча',
          transparency: 'transparent', // Свободен
        },
      ];

      await detectUserBusy(events);

      // Проверяем что промпт содержит "Свободен"
      const callArg = mockGenerateMessage.mock.calls[0][0];
      expect(callArg).toContain('Свободен');
    });

    it('должен обработать исключение при чтении файла', async () => {
      mockReadFileSync.mockImplementationOnce(() => {
        throw new Error('File not found');
      });

      const events = [{ summary: 'Встреча' }];
      const result = await detectUserBusy(events);

      expect(result.probably_busy).toBe(false);
      expect(result.busy_reason).toBe(null);
    });

    it('должен обработать несколько событий', async () => {
      mockGenerateMessage.mockResolvedValueOnce(
        JSON.stringify({
          probably_busy: true,
          busy_reason: 'flight',
        })
      );

      const events = [
        {
          summary: 'Утренняя встреча',
          start: { dateTime: '2024-01-01T09:00:00' },
          end: { dateTime: '2024-01-01T10:00:00' },
        },
        {
          summary: 'Перелет',
          start: { dateTime: '2024-01-01T15:00:00' },
          end: { dateTime: '2024-01-01T18:00:00' },
          location: 'Шереметьево',
        },
      ];

      const result = await detectUserBusy(events);
      expect(result.probably_busy).toBe(true);

      // Проверяем что промпт содержит оба события
      const callArg = mockGenerateMessage.mock.calls[0][0];
      expect(callArg).toContain('Утренняя встреча');
      expect(callArg).toContain('Перелет');
      expect(callArg).toContain('Шереметьево');
    });

    it('должен удалять теги <think> из ответа LLM', async () => {
      mockGenerateMessage.mockResolvedValueOnce(
        '<think>Размышляю о календаре...</think>' +
        JSON.stringify({
          probably_busy: true,
          busy_reason: 'flight',
        })
      );

      const events = [{ summary: 'Перелет' }];
      const result = await detectUserBusy(events);
      
      expect(result.probably_busy).toBe(true);
      expect(result.busy_reason).toBe('flight');
    });

    it('должен удалять теги <think> с HTML внутри', async () => {
      mockGenerateMessage.mockResolvedValueOnce(
        '<think>Анализирую события...<br>Вижу перелет<b>важно!</b></think>' +
        JSON.stringify({
          probably_busy: true,
          busy_reason: 'flight',
        })
      );

      const events = [{ summary: 'Перелет в Москву' }];
      const result = await detectUserBusy(events);
      
      expect(result.probably_busy).toBe(true);
      expect(result.busy_reason).toBe('flight');
    });

    it('должен удалять вложенные теги <think>', async () => {
      mockGenerateMessage.mockResolvedValueOnce(
        '<think>Первая мысль <think>вложенная мысль</think> продолжение</think>' +
        JSON.stringify({
          probably_busy: false,
          busy_reason: null,
        })
      );

      const events = [{ summary: 'Встреча' }];
      const result = await detectUserBusy(events);
      
      expect(result.probably_busy).toBe(false);
      expect(result.busy_reason).toBe(null);
    });
  });

  describe('checkUsersResponses', () => {
    let checkUsersResponses: () => Promise<void>;
    let sendAngryPost: (userId: number) => Promise<void>;
    
    beforeEach(() => {
      // Получаем доступ к приватным методам
      checkUsersResponses = (scheduler as any).checkUsersResponses.bind(scheduler);
      sendAngryPost = (scheduler as any).sendAngryPost.bind(scheduler);
      
      // Мокаем методы бота
      mockBot.telegram = {
        sendMessage: spyOn({} as any, 'sendMessage').mockResolvedValue({}),
        sendPhoto: spyOn({} as any, 'sendPhoto').mockResolvedValue({}),
      } as any;
      
      // Мокаем getLastDailyRunTime
      spyOn(scheduler as any, 'getLastDailyRunTime').mockResolvedValue(new Date());
    });

    it('должен проверить только целевого пользователя и отправить злой пост если он не ответил', async () => {
      const db = require('./db');
      const TARGET_USER_ID = 5153477378;
      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(22, 0, 0, 0); // Вчера в 22:00
      
      // Мокаем getMainUserId
      spyOn(scheduler, 'getMainUserId').mockReturnValue(TARGET_USER_ID);
      
      // Мокаем время последней рассылки - вчера в 22:00
      const getLastDailyRunTimeSpy = spyOn(scheduler as any, 'getLastDailyRunTime');
      getLastDailyRunTimeSpy.mockResolvedValue(yesterday);
      
      // Мокаем ответ целевого пользователя - он НЕ ответил
      const getUserResponseStatsSpy = spyOn(db, 'getUserResponseStats');
      getUserResponseStatsSpy.mockImplementation((userId: number) => {
        if (userId === TARGET_USER_ID) {
          // Пользователь не ответил (последний ответ до вчерашней рассылки)
          const twoHoursBeforeYesterday = new Date(yesterday);
          twoHoursBeforeYesterday.setHours(twoHoursBeforeYesterday.getHours() - 2);
          return { 
            response_count: 3, 
            last_response_time: twoHoursBeforeYesterday.toISOString() 
          };
        }
        return null;
      });
      
      // Мокаем отправку злого поста
      const sendAngryPostSpy = spyOn(scheduler as any, 'sendAngryPost').mockResolvedValue(undefined);
      
      // Мокаем админа
      process.env.ADMIN_CHAT_ID = '999';
      
      await checkUsersResponses();
      
      // Проверяем что злой пост отправлен только один раз для целевого пользователя
      expect(sendAngryPostSpy).toHaveBeenCalledTimes(1);
      expect(sendAngryPostSpy).toHaveBeenCalledWith(TARGET_USER_ID);
      
      // Проверяем отчет админу
      expect(mockBot.telegram.sendMessage).toHaveBeenCalledWith(
        999,
        expect.stringContaining(`Проверен пользователь: <code>${TARGET_USER_ID}</code>`),
        expect.any(Object)
      );
      expect(mockBot.telegram.sendMessage).toHaveBeenCalledWith(
        999,
        expect.stringContaining('НЕ ответил на вчерашнее задание'),
        expect.any(Object)
      );
      expect(mockBot.telegram.sendMessage).toHaveBeenCalledWith(
        999,
        expect.stringContaining('Злой пост отправлен в канал'),
        expect.any(Object)
      );
    });

    it('не должен отправлять злой пост если целевой пользователь ответил', async () => {
      const db = require('./db');
      const TARGET_USER_ID = 5153477378;
      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(22, 0, 0, 0); // Вчера в 22:00
      
      // Мокаем getMainUserId
      spyOn(scheduler, 'getMainUserId').mockReturnValue(TARGET_USER_ID);
      
      // Мокаем время последней рассылки - вчера в 22:00
      const getLastDailyRunTimeSpy = spyOn(scheduler as any, 'getLastDailyRunTime');
      getLastDailyRunTimeSpy.mockResolvedValue(yesterday);
      
      // Мокаем ответ целевого пользователя - он ОТВЕТИЛ
      const getUserResponseStatsSpy = spyOn(db, 'getUserResponseStats');
      getUserResponseStatsSpy.mockImplementation((userId: number) => {
        if (userId === TARGET_USER_ID) {
          // Пользователь ответил после вчерашней рассылки
          return { 
            response_count: 5, 
            last_response_time: new Date().toISOString() // Сегодня
          };
        }
        return null;
      });
      
      // Мокаем отправку злого поста
      const sendAngryPostSpy = spyOn(scheduler as any, 'sendAngryPost').mockResolvedValue(undefined);
      
      // Мокаем админа
      process.env.ADMIN_CHAT_ID = '999';
      
      await checkUsersResponses();
      
      // Проверяем что злой пост НЕ отправлен
      expect(sendAngryPostSpy).not.toHaveBeenCalled();
      
      // Проверяем отчет админу
      expect(mockBot.telegram.sendMessage).toHaveBeenCalledWith(
        999,
        expect.stringContaining('Ответил на вчерашнее задание'),
        expect.any(Object)
      );
    });

    it('должен отправить злой пост если нет времени последней рассылки', async () => {
      const db = require('./db');
      
      // Мокаем getMainUserId
      spyOn(scheduler, 'getMainUserId').mockReturnValue(5153477378);
      
      // Мокаем что рассылка не была выполнена
      const getLastDailyRunTimeSpy = spyOn(scheduler as any, 'getLastDailyRunTime');
      getLastDailyRunTimeSpy.mockResolvedValue(null);
      
      // Мокаем что пользователь НЕ ответил
      const getUserResponseStatsSpy = spyOn(db, 'getUserResponseStats');
      getUserResponseStatsSpy.mockReturnValue({
        last_response_time: null,
        response_count: 0
      });
      
      const sendAngryPostSpy = spyOn(scheduler as any, 'sendAngryPost');
      sendAngryPostSpy.mockResolvedValue(undefined);
      
      // Мокаем админа
      process.env.ADMIN_CHAT_ID = '999';
      
      await checkUsersResponses();
      
      // Теперь проверка времени убрана, поэтому злой пост должен быть отправлен
      expect(sendAngryPostSpy).toHaveBeenCalledWith(5153477378);
    });
  });

  describe('sendAngryPost', () => {
    let sendAngryPost: (userId: number) => Promise<void>;
    
    beforeEach(() => {
      sendAngryPost = (scheduler as any).sendAngryPost.bind(scheduler);
      
      // Мокаем методы бота
      mockBot.telegram = {
        sendPhoto: spyOn({} as any, 'sendPhoto').mockResolvedValue({}),
      } as any;
      
      // Мокаем файловую систему
      mockReadFileSync.mockImplementation((path: any): any => {
        const pathStr = String(path);
        if (pathStr.includes('no-answer')) {
          return 'Промпт для злого текста';
        } else if (pathStr.includes('frog-image-promt-angry')) {
          return 'Промпт для злого изображения';
        }
        return '';
      });
      
      // Мокаем функции LLM
      spyOn(llm, 'generateFrogImage').mockResolvedValue(Buffer.from('fake-image'));
    });

    it('должен отправить злой пост с сгенерированным изображением', async () => {
      const db = require('./db');
      const saveMessageSpy = spyOn(db, 'saveMessage').mockImplementation(() => {});
      spyOn(db, 'saveAngryPost').mockImplementation(() => {});
      
      // Мокаем isTestBot чтобы вернул false
      spyOn(scheduler, 'isTestBot').mockReturnValue(false);

      // Мокаем extractPromptSection для возврата валидного промпта с примерами
      const validPrompt = `## ПРОМТ №1 - злюсь
Ты - лягушка-психолог.

### Примеры хороших ответов

- Пример 1: Что за безобразие! 😠
- Пример 2: Ты где пропадаешь? 🐸
- Пример 3: Давай исправим это! 💪`;
      spyOn(scheduler as any, 'extractPromptSection').mockReturnValue(validPrompt);
      
      // Мокаем генерацию текста
      mockGenerateMessage.mockResolvedValue('Кто-то не сделал задание! Нехорошо!');
      
      // Мокаем результат sendPhoto
      mockBot.telegram.sendPhoto.mockResolvedValue({ message_id: 1234 });
      
      await sendAngryPost(123);
      
      // Проверяем отправку фото с текстом
      expect(mockBot.telegram.sendPhoto).toHaveBeenCalledWith(
        scheduler.CHANNEL_ID,
        { source: expect.any(Buffer) },
        {
          caption: 'Кто-то не сделал задание! Нехорошо!',
          parse_mode: 'HTML',
        }
      );
      
      // Проверяем сохранение в БД
      expect(saveMessageSpy).toHaveBeenCalledWith(
        123,
        'Кто-то не сделал задание! Нехорошо!',
        expect.any(String)
      );
    });

    it('должен использовать fallback изображение при ошибке генерации', async () => {
      const db = require('./db');
      spyOn(db, 'saveMessage').mockImplementation(() => {});
      spyOn(db, 'saveAngryPost').mockImplementation(() => {});
      
      // Мокаем isTestBot чтобы вернул false
      spyOn(scheduler, 'isTestBot').mockReturnValue(false);

      // Мокаем extractPromptSection для возврата валидного промпта с примерами
      const validPrompt = `## ПРОМТ №1 - злюсь
Ты - лягушка-психолог.

### Примеры хороших ответов

- Пример 1: Что за безобразие! 😠
- Пример 2: Ты где пропадаешь? 🐸
- Пример 3: Давай исправим это! 💪`;
      spyOn(scheduler as any, 'extractPromptSection').mockReturnValue(validPrompt);
      
      // Мокаем ошибку генерации изображения
      spyOn(llm, 'generateFrogImage').mockRejectedValue(new Error('API error'));
      
      // Мокаем getNextImage
      spyOn(scheduler, 'getNextImage').mockReturnValue('/path/to/image.jpg');
      
      mockGenerateMessage.mockResolvedValue('Злой текст');
      
      // Мокаем результат sendPhoto
      mockBot.telegram.sendPhoto.mockResolvedValue({ message_id: 1235 });
      
      await sendAngryPost(123);
      
      // Проверяем что использовано изображение из ротации
      expect(mockBot.telegram.sendPhoto).toHaveBeenCalledWith(
        scheduler.CHANNEL_ID,
        { source: '/path/to/image.jpg' },
        expect.any(Object)
      );
    });

    it('должен обрезать длинный текст', async () => {
      const db = require('./db');
      spyOn(db, 'saveMessage').mockImplementation(() => {});
      spyOn(db, 'saveAngryPost').mockImplementation(() => {});
      
      // Мокаем isTestBot чтобы вернул false
      spyOn(scheduler, 'isTestBot').mockReturnValue(false);

      // Мокаем extractPromptSection для возврата валидного промпта с примерами
      const validPrompt = `## ПРОМТ №1 - злюсь
Ты - лягушка-психолог.

### Примеры хороших ответов

- Пример 1: Что за безобразие! 😠
- Пример 2: Ты где пропадаешь? 🐸
- Пример 3: Давай исправим это! 💪`;
      spyOn(scheduler as any, 'extractPromptSection').mockReturnValue(validPrompt);
      
      // Генерируем очень длинный текст
      const longText = 'А'.repeat(600);
      mockGenerateMessage.mockResolvedValue(longText);
      
      // Форсируем выбор варианта 1, 2 или 3 (не 4)
      spyOn(Math, 'random').mockReturnValue(0.1); // Это даст promptNumber = 1
      
      // Мокаем результат sendPhoto
      mockBot.telegram.sendPhoto.mockResolvedValue({ message_id: 1236 });
      
      await sendAngryPost(123);
      
      // Проверяем что текст обрезан
      const sentText = (mockBot.telegram.sendPhoto as any).mock.calls[0][2].caption;
      expect(sentText.length).toBeLessThanOrEqual(500);
      expect(sentText).toEndWith('...');
    });
  });
});
