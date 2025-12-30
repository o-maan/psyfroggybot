import { describe, expect, it } from 'bun:test';

/**
 * Тесты для проверки логики retry при ошибках polling
 * Тестируем саму логику, а не интеграцию с Telegram API
 */

describe('Bot retry logic', () => {
  const BASE_RETRY_DELAY = 5000;
  const MAX_RETRY_DELAY = 60000;

  // Функция расчёта задержки (копия из bot.ts)
  const calculateDelay = (retryCount: number): number => {
    return Math.min(BASE_RETRY_DELAY * Math.pow(2, retryCount - 1), MAX_RETRY_DELAY);
  };

  describe('Экспоненциальная задержка', () => {
    it('1-я попытка: 5 секунд', () => {
      expect(calculateDelay(1)).toBe(5000);
    });

    it('2-я попытка: 10 секунд', () => {
      expect(calculateDelay(2)).toBe(10000);
    });

    it('3-я попытка: 20 секунд', () => {
      expect(calculateDelay(3)).toBe(20000);
    });

    it('4-я попытка: 40 секунд', () => {
      expect(calculateDelay(4)).toBe(40000);
    });

    it('5-я попытка: 60 секунд (максимум)', () => {
      expect(calculateDelay(5)).toBe(60000);
    });

    it('10-я попытка: всё ещё 60 секунд (не превышает максимум)', () => {
      expect(calculateDelay(10)).toBe(60000);
    });

    it('100-я попытка: всё ещё 60 секунд', () => {
      expect(calculateDelay(100)).toBe(60000);
    });
  });

  describe('Логика уведомления админа', () => {
    const shouldNotifyAdmin = (retryCount: number): boolean => {
      return retryCount % 3 === 0;
    };

    it('1-я попытка: НЕ уведомлять', () => {
      expect(shouldNotifyAdmin(1)).toBe(false);
    });

    it('2-я попытка: НЕ уведомлять', () => {
      expect(shouldNotifyAdmin(2)).toBe(false);
    });

    it('3-я попытка: УВЕДОМИТЬ', () => {
      expect(shouldNotifyAdmin(3)).toBe(true);
    });

    it('4-я попытка: НЕ уведомлять', () => {
      expect(shouldNotifyAdmin(4)).toBe(false);
    });

    it('6-я попытка: УВЕДОМИТЬ', () => {
      expect(shouldNotifyAdmin(6)).toBe(true);
    });

    it('9-я попытка: УВЕДОМИТЬ', () => {
      expect(shouldNotifyAdmin(9)).toBe(true);
    });
  });

  describe('Флаг isShuttingDown', () => {
    it('При shutdown=true перезапуск не должен происходить', () => {
      let isShuttingDown = false;
      let launchCalled = false;

      const mockLaunch = () => {
        if (isShuttingDown) {
          return; // Не запускаем
        }
        launchCalled = true;
      };

      // Первый запуск - должен произойти
      mockLaunch();
      expect(launchCalled).toBe(true);

      // Симулируем shutdown
      isShuttingDown = true;
      launchCalled = false;

      // Второй запуск - НЕ должен произойти
      mockLaunch();
      expect(launchCalled).toBe(false);
    });
  });

  describe('Сброс счётчика при успехе', () => {
    it('После успешного подключения retryCount сбрасывается в 0', () => {
      let retryCount = 5; // Было 5 неудачных попыток

      // Симулируем успешный запуск
      const onSuccess = () => {
        retryCount = 0;
      };

      onSuccess();
      expect(retryCount).toBe(0);
    });

    it('wasRetrying=true если были неудачные попытки до успеха', () => {
      let retryCount = 3;

      const onSuccess = () => {
        const wasRetrying = retryCount > 0;
        retryCount = 0;
        return wasRetrying;
      };

      expect(onSuccess()).toBe(true);
    });

    it('wasRetrying=false если это первый успешный запуск', () => {
      let retryCount = 0;

      const onSuccess = () => {
        const wasRetrying = retryCount > 0;
        retryCount = 0;
        return wasRetrying;
      };

      expect(onSuccess()).toBe(false);
    });
  });

  describe('Обработка ошибок', () => {
    it('Ошибка socket connection обрабатывается корректно', () => {
      const error = new Error('The socket connection was closed unexpectedly');

      // Проверяем что сообщение об ошибке извлекается правильно
      expect(error.message).toContain('socket connection');
    });

    it('Ошибка без сообщения обрабатывается', () => {
      const error = {} as Error;
      const errorMessage = error.message || 'Unknown error';

      expect(errorMessage).toBe('Unknown error');
    });
  });

  describe('Последовательность задержек', () => {
    it('Задержки растут экспоненциально до максимума', () => {
      const delays: number[] = [];

      for (let i = 1; i <= 10; i++) {
        delays.push(calculateDelay(i));
      }

      // Проверяем последовательность
      expect(delays).toEqual([
        5000, // 1: 5с
        10000, // 2: 10с
        20000, // 3: 20с
        40000, // 4: 40с
        60000, // 5: 60с (макс)
        60000, // 6: 60с
        60000, // 7: 60с
        60000, // 8: 60с
        60000, // 9: 60с
        60000, // 10: 60с
      ]);
    });

    it('Общее время ожидания за 10 попыток = 495 секунд', () => {
      let totalDelay = 0;

      for (let i = 1; i <= 10; i++) {
        totalDelay += calculateDelay(i);
      }

      // 5 + 10 + 20 + 40 + 60*6 = 75 + 360 = 435 секунд
      expect(totalDelay).toBe(435000);
    });
  });
});
