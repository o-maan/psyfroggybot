import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

// Конфигурация для pino-pretty без миллисекунд
const prettyConfig = {
  colorize: true,
  translateTime: 'yyyy-mm-dd HH:MM:ss',
  ignore: 'hostname,pid',
  messageFormat: '{levelLabel} {msg}',
  customPrettifiers: {
    level: (logLevel: string) => {
      const levels: Record<string, string> = {
        10: '🔍 TRACE',
        20: '🐛 DEBUG',
        30: '📝 INFO',
        40: '⚠️  WARN',
        50: '❌ ERROR',
        60: '💀 FATAL',
      };
      return levels[logLevel] || logLevel;
    },
  },
};

// Создаем основной логгер
export const logger = pino({
  level: isProduction ? 'info' : 'debug',
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
  formatters: {
    level: (label: string) => {
      return { level: label };
    },
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: prettyConfig,
        },
      }),
});

// Импортируем функцию сохранения в БД динамически чтобы избежать циклических зависимостей
let saveLogToDatabase: any;

// Интерцептор для сохранения логов в базу данных
class DatabaseLogInterceptor {
  private buffer: any[] = [];
  private flushTimeout: NodeJS.Timeout | null = null;
  private readonly BUFFER_SIZE = 10;
  private readonly FLUSH_INTERVAL = 5000; // 5 секунд

  constructor() {
    // Динамически импортируем функцию БД
    this.initDbFunction();

    // Перехватываем методы логгера для сохранения в БД
    this.interceptLogger(logger);

    // Graceful shutdown - сохраняем буфер при завершении
    process.on('SIGINT', () => this.flushBuffer());
    process.on('SIGTERM', () => this.flushBuffer());
  }

  private async initDbFunction() {
    try {
      const dbModule = await import('./db');
      saveLogToDatabase = dbModule.saveLogToDatabase;
    } catch (error) {
      console.error('Failed to import saveLogToDatabase:', error);
    }
  }

  private interceptLogger(loggerInstance: any) {
    const originalMethods = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

    originalMethods.forEach(method => {
      const original = loggerInstance[method].bind(loggerInstance);
      loggerInstance[method] = (...args: any[]) => {
        // Вызываем оригинальный метод
        original(...args);

        // Сохраняем в буфер для БД
        this.addToBuffer(method as any, args);
      };
    });
  }

  private addToBuffer(level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal', args: any[]) {
    const logEntry = {
      level,
      timestamp: new Date().toISOString(),
      message: this.formatMessage(args),
      data: this.extractData(args),
    };

    this.buffer.push(logEntry);

    // Если буфер заполнен, сбрасываем
    if (this.buffer.length >= this.BUFFER_SIZE) {
      this.flushBuffer();
    } else {
      // Устанавливаем таймер для принудительного сброса
      this.scheduleFlush();
    }
  }

  private formatMessage(args: any[]): string {
    if (args.length === 0) return '';

    const first = args[0];
    if (typeof first === 'string') {
      return first;
    } else if (typeof first === 'object' && first.msg) {
      return first.msg;
    } else {
      return JSON.stringify(first);
    }
  }

  private extractData(args: any[]): any {
    if (args.length <= 1) return null;

    const data = args.slice(1);
    return data.length === 1 ? data[0] : data;
  }

  private scheduleFlush() {
    if (this.flushTimeout) return;

    this.flushTimeout = setTimeout(() => {
      this.flushBuffer();
    }, this.FLUSH_INTERVAL);
  }

  private async flushBuffer() {
    if (this.buffer.length === 0) return;

    const logsToSave = [...this.buffer];
    this.buffer = [];

    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }

    try {
      if (saveLogToDatabase) {
        for (const log of logsToSave) {
          await saveLogToDatabase(log.level, log.message, log.data ? JSON.stringify(log.data) : null, log.timestamp);
        }
      }
    } catch (error) {
      // Используем console.error чтобы избежать рекурсии
      console.error('Failed to save logs to database:', error);
    }
  }
}

// Инициализируем интерцептор
new DatabaseLogInterceptor();

// Экспортируем специализированные логгеры для прямого использования
export const botLogger = logger.child({ module: 'bot' });
export const schedulerLogger = logger.child({ module: 'scheduler' });
export const calendarLogger = logger.child({ module: 'calendar' });
export const llmLogger = logger.child({ module: 'llm' });
export const databaseLogger = logger.child({ module: 'database' });

export default logger;
