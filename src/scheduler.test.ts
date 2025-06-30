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
  });
});
