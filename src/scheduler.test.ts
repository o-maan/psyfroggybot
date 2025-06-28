import { beforeEach, describe, expect, it } from 'bun:test';
import type { Telegraf } from 'telegraf';
import type { CalendarService } from './calendar';
import { Scheduler } from './scheduler';

// Моки для зависимостей
const mockBot = {} as Telegraf;
const mockCalendarService = {} as CalendarService;

describe('Scheduler', () => {
  let scheduler: Scheduler;
  let hasFlightEvent: (events: any[]) => boolean;

  beforeEach(() => {
    scheduler = new Scheduler(mockBot, mockCalendarService);
    // Получаем доступ к приватному методу для тестирования
    hasFlightEvent = (scheduler as any).hasFlightEvent.bind(scheduler);
  });

  describe('hasFlightEvent', () => {
    it('should return true for "перелет"', () => {
      const events = [{ summary: 'У меня завтра перелет' }];
      expect(hasFlightEvent(events)).toBe(true);
    });

    it('should return true for "аэропорт"', () => {
      const events = [{ summary: 'Встреча в аэропорту' }];
      expect(hasFlightEvent(events)).toBe(true);
    });

    it('should return true for "рейс"', () => {
      const events = [{ summary: 'Мой рейс задерживается' }];
      expect(hasFlightEvent(events)).toBe(true);
    });

    it('should return true for "поезд"', () => {
      const events = [{ summary: 'Еду на поезде' }];
      expect(hasFlightEvent(events)).toBe(true);
    });

    it('should return true for "flight"', () => {
      const events = [{ summary: 'My flight is delayed' }];
      expect(hasFlightEvent(events)).toBe(true);
    });

    it('should return true for "airport"', () => {
      const events = [{ summary: 'Meeting at the airport' }];
      expect(hasFlightEvent(events)).toBe(true);
    });

    it('should return true for "train"', () => {
      const events = [{ summary: 'I am on a train' }];
      expect(hasFlightEvent(events)).toBe(true);
    });

    it('should be case-insensitive', () => {
      const events = [{ summary: 'Большой АЭРОПОРТ' }];
      expect(hasFlightEvent(events)).toBe(true);
    });

    it('should return false if no keywords are present', () => {
      const events = [{ summary: 'Обычная встреча в кафе' }];
      expect(hasFlightEvent(events)).toBe(false);
    });

    it('should return false for an empty event list', () => {
      const events: any[] = [];
      expect(hasFlightEvent(events)).toBe(false);
    });

    it('should return false if summary is null or undefined', () => {
      const events = [{ summary: null }, { summary: undefined }];
      expect(hasFlightEvent(events)).toBe(false);
    });
  });
});
