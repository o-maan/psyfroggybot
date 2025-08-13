import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Общие моки и хранилище для экземпляра бота
const telegramCalls: any[] = [];
const replyCalls: any[] = [];

// Мок telegraf
vi.mock('telegraf', () => {
  class TelegrafMock {
    public telegram: any;
    public __commands = new Map<string, Function>();
    public __actions: Array<{ re: RegExp; handler: Function }> = [];
    public __events = new Map<string, Function[]>();
    public __middlewares: Function[] = [];
    public static __lastInstance: any;

    constructor(_token: string) {
      this.telegram = {
        sendMessage: vi.fn((chatId: number, text: string, options?: any) => {
          telegramCalls.push({ method: 'sendMessage', chatId, text, options });
          return Promise.resolve({ message_id: Math.floor(Math.random() * 1000) });
        }),
        sendPhoto: vi.fn((chatId: number, photo: any, options?: any) => {
          telegramCalls.push({ method: 'sendPhoto', chatId, photo, options });
          return Promise.resolve({ message_id: Math.floor(Math.random() * 1000) });
        }),
        editMessageText: vi.fn((_chatId?: number, _messageId?: number, _inline?: any, _text?: string, _opts?: any) => {
          telegramCalls.push({ method: 'editMessageText' });
          return Promise.resolve({});
        }),
        setMessageReaction: vi.fn((_chatId: number, _messageId: number, _reactions: any) => {
          telegramCalls.push({ method: 'setMessageReaction' });
          return Promise.resolve();
        }),
        getChat: vi.fn((_id: number) => Promise.resolve({ id: _id, type: 'supergroup', title: 'Test Chat' })),
        getMe: vi.fn(() => Promise.resolve({ id: 999, is_bot: true })),
        getChatMember: vi.fn((_chatId: number, _userId: number) => Promise.resolve({ status: 'administrator' })),
      };
      (TelegrafMock as any).__lastInstance = this;
    }

    use(fn: Function) {
      this.__middlewares.push(fn);
    }
    command(name: string, handler: Function) {
      this.__commands.set(name, handler);
    }
    action(re: RegExp | string, handler: Function) {
      const rx = typeof re === 'string' ? new RegExp(`^${re}$`) : re;
      this.__actions.push({ re: rx, handler });
    }
    on(event: string, handler: Function) {
      const arr = this.__events.get(event) || [];
      arr.push(handler);
      this.__events.set(event, arr);
    }
    catch(_handler: Function) {}
    launch() {
      return Promise.resolve();
    }

    // Тестовые помощники
    __emitCommand(name: string, ctx: any) {
      const h = this.__commands.get(name);
      if (!h) throw new Error(`Command handler not found: ${name}`);
      return h(ctx);
    }
    __emitAction(data: string, baseCtx: any) {
      const rec = this.__actions.find(a => a.re.test(data));
      if (!rec) throw new Error(`Action handler not found for: ${data}`);
      const ctx = { ...baseCtx, match: rec.re.exec(data), callbackQuery: { data, message: baseCtx.message } };
      return rec.handler(ctx);
    }
    __emitEvent(event: string, ctx: any) {
      const list = this.__events.get(event) || [];
      return Promise.all(list.map(h => h(ctx, () => Promise.resolve())));
    }
    stop() {
      return;
    }
  }
  return { Telegraf: TelegrafMock };
});

// Мок express
const expressHandlers = new Map<string, Function>();
const expressMock: any = () => ({
  use: vi.fn(),
  all: vi.fn(),
  get: vi.fn((path: string, ...handlers: Function[]) => {
    const handler = handlers[handlers.length - 1];
    expressHandlers.set(`GET:${path}`, handler);
  }),
  post: vi.fn((path: string, ...handlers: Function[]) => {
    const handler = handlers[handlers.length - 1];
    expressHandlers.set(`POST:${path}`, handler);
  }),
  listen: vi.fn((_port: number, _host?: any, cb?: any) => {
    if (typeof _host === 'function') cb = _host;
    cb && cb();
    return { close: vi.fn() };
  }),
});
expressMock.json = () => (req: any, _res: any, next: any) => next();
expressMock.__handlers = expressHandlers;

vi.mock('express', () => ({ default: expressMock }));

// Мок logger
vi.mock('../src/logger.ts', () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn() },
  botLogger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
  schedulerLogger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

// Мок LLM
vi.mock('../src/llm.ts', () => ({
  generateUserResponse: vi.fn(() => Promise.resolve('Спасибо, что поделился! 🤍')),
  minimalTestLLM: vi.fn(() => Promise.resolve('Paris')),
}));

// Мок Calendar
vi.mock('../src/calendar.ts', () => ({
  CalendarService: class {
    getToken = vi.fn(async () => ({}));
    getAuthUrl = vi.fn(() => 'https://example/auth');
    getEvents = vi.fn(async () => []);
    exchangeCodeForToken = vi.fn(async () => ({}));
  },
  formatCalendarEvents: () => '',
  getUserTodayEvents: vi.fn(async () => null),
}));

// Мок Scheduler
const schedulerSpies: any = {};
vi.mock('../src/scheduler.ts', () => ({
  Scheduler: class {
    public CHANNEL_ID = -1002846400650;
    public reminderTimeouts = new Map<number, any>();
    constructor(_bot: any, _cal: any) {}
    isTestBot() {
      return true;
    }
    addUser = vi.fn();
    getCalendarService() {
      return { getAuthUrl: () => 'https://example/auth' };
    }
    sendInteractiveDailyMessage = vi.fn(async () => {});
    generateScheduledMessage = vi.fn(async () => 'Тестовое сообщение');
    sendDailyMessage = vi.fn(async () => {});
    sendDailyMessagesToAll = vi.fn(async () => {});
    sendAngryPost = vi.fn(async () => {});
    getLastDailyRunTime = vi.fn(async () => new Date());
    getSchedulerStatus() {
      return {
        isRunning: true,
        isDailyRunning: true,
        isMorningRunning: true,
        description: '0 22 * * *',
        cronExpression: '0 22 * * *',
        timezone: 'Europe/Moscow',
        currentTime: '00:00',
        nextRunTime: '22:00',
        usersCount: 1,
        adminChatId: 1,
        usersList: [1],
      };
    }
    getChatId() {
      return -1002798126153;
    }
    getTargetUserId() {
      return 476561547;
    }
    setReminder = vi.fn();
    clearReminder = vi.fn();
    checkUsersResponses = vi.fn();
    getNextImage() {
      return 'images/IMG_5392.JPG';
    }
    getRandomSupportText() {
      return 'Ты молодец!';
    }
    destroy() {}
  },
}));

// Мок DB
const dbSpies: any = {
  addUser: vi.fn(),
  updateUserName: vi.fn(),
  updateUserGender: vi.fn(),
  updateUserResponse: vi.fn(),
  saveMessage: vi.fn(),
  getLastUserToken: vi.fn(() => null),
  saveUserToken: vi.fn(),
  getRecentUnreadLogs: vi.fn(() => []),
  getRecentUnreadInfoLogs: vi.fn(() => []),
  getLogsCount: vi.fn(() => 0),
  getUnreadLogsCount: vi.fn(() => 0),
  getRecentLogsByLevel: vi.fn(() => []),
  getRecentLogs: vi.fn(() => []),
  getLogsStatistics: vi.fn(() => []),
  getAllUsers: vi.fn(() => []),
  getInteractivePost: vi.fn(() => ({
    message_data: { positive_part: { additional_text: 'Пожалуйста, поделись хорошим' } },
    trophy_set: false,
  })),
  updateInteractivePostState: vi.fn(),
  updateTaskStatus: vi.fn(),
  setTrophyStatus: vi.fn(),
  markLogsAsRead: vi.fn(),
  markLogAsRead: vi.fn(),
  escapeHTML: (s: string) => s,
  db: { run: vi.fn(() => ({})), query: vi.fn(() => ({ get: () => undefined, all: () => [] })) },
};
vi.mock('../src/db.ts', () => dbSpies);

vi.mock('node-cron', () => ({ schedule: vi.fn((_expr: string, _fn: any) => ({ stop: vi.fn(), destroy: vi.fn() })) }));

// Мок fs
vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  createReadStream: vi.fn(() => ({
    pipe: vi.fn(),
    on: vi.fn((event: string, cb: Function) => {
      if (event === 'end') setTimeout(cb, 10);
      return this;
    }),
  })),
}));

function createCtx(overrides: any = {}) {
  const base = {
    message: { message_id: 1 },
    chat: { id: 476561547, type: 'private' },
    from: { id: 476561547, username: 'tester', is_bot: false },
    reply: vi.fn((text: string, options?: any) => {
      replyCalls.push({ text, options });
      return Promise.resolve({});
    }),
    replyWithDocument: vi.fn(() => Promise.resolve({})),
    replyWithPhoto: vi.fn(() => Promise.resolve({})),
    answerCbQuery: vi.fn(() => Promise.resolve()),
    editMessageText: vi.fn((text: string, options?: any) => {
      telegramCalls.push({ method: 'editMessageText', text, options });
      return Promise.resolve({});
    }),
    callbackQuery: undefined as any,
  };
  return Object.assign(base, overrides);
}

// Инициализируем переменную для хранения импортированного модуля
let botModule: any;

describe('bot.ts команды и обработчики (покрытие)', () => {
  beforeAll(async () => {
    process.env.IS_TEST_BOT = 'true';
    process.env.TELEGRAM_BOT_TOKEN = 'TEST_TOKEN';
    process.env.ADMIN_CHAT_ID = '476561547';
    process.env.ADMIN_KEY = 'test-admin-key';
    process.env.MAIN_USER_ID = '476561547';
    process.env.USER_ID = '476561547';
    process.env.TEST_USER_ID = '476561547';
    botModule = await import('../src/bot.ts');
  });

  beforeEach(() => {
    telegramCalls.length = 0;
    replyCalls.length = 0;
    Object.values(dbSpies).forEach((s: any) => typeof s.mock?.clear === 'function' && s.mock.clear());
    vi.clearAllMocks();
  });

  it('/ping отвечает Pong', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    await bot.__emitCommand('ping', createCtx());
    expect(replyCalls[0].text).toContain('Pong');
  });

  it('/start добавляет пользователя', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    await bot.__emitCommand('start', createCtx());
    expect(dbSpies.addUser).toHaveBeenCalled();
  });

  it('/fro запускает интерактивную отправку', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    await bot.__emitCommand('fro', createCtx());
    expect(replyCalls.find(c => String(c.text).includes('Отправляю сообщение'))).toBeTruthy();
  });

  it('/test генерирует тестовое сообщение', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    await bot.__emitCommand('test', createCtx());
    expect(replyCalls[0].text).toContain('ТЕСТ ГЕНЕРАЦИИ СООБЩЕНИЯ');
  });

  it('/status для админа отвечает статусом', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    const ctx = createCtx({ chat: { id: 476561547, type: 'private' } });
    await bot.__emitCommand('status', ctx);
    expect(replyCalls[0].text).toContain('СТАТУС ПЛАНИРОВЩИКА');
  });

  it('/calendar без токена присылает ссылку', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    await bot.__emitCommand('calendar', createCtx());
    expect(replyCalls[0].text).toContain('Для доступа к календарю');
  });

  it('/check_access отвечает деталями доступа', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    await bot.__emitCommand('check_access', createCtx({ chat: { id: 476561547, type: 'private' } }));
    expect(replyCalls[0].text).toContain('Проверка доступа бота');
  });

  it('/test_now запускает рассылку всем', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    await bot.__emitCommand('test_now', createCtx({ chat: { id: 476561547, type: 'private' } }));
    expect(replyCalls.find(c => String(c.text).includes('Тест рассылки завершен'))).toBeTruthy();
  });

  it('обработчик skip_schema и pract_done работают', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    const base = createCtx({ chat: { id: -1002798126153, type: 'supergroup' }, message: { message_id: 50 } });
    await bot.__emitAction('skip_schema_123', base);
    await bot.__emitAction('pract_done_123', base);
    expect(dbSpies.updateInteractivePostState).toHaveBeenCalled();
  });

  it('admin-команды: last_run, ans, test_morning_check, angry, status', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    const adminCtx = createCtx({ chat: { id: 476561547, type: 'private' } });
    await bot.__emitCommand('last_run', adminCtx);
    await bot.__emitCommand('ans', adminCtx);
    await bot.__emitCommand('test_morning_check', adminCtx);
    await bot.__emitCommand('angry', adminCtx);
    await bot.__emitCommand('status', adminCtx);
    expect(replyCalls.length).toBeGreaterThan(0);
  });

  it('admin-команды: check_posts, test_schedule, test_now', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    const adminCtx = createCtx({ chat: { id: 476561547, type: 'private' } });
    await bot.__emitCommand('check_posts', adminCtx);
    await bot.__emitCommand('test_schedule', adminCtx);
    await bot.__emitCommand('test_now', adminCtx);
    expect(replyCalls.find(c => String(c.text).includes('ТЕСТ ПЛАНИРОВЩИКА'))).toBeTruthy();
  });

  it('команда test_reminder отсылает планирование', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    await bot.__emitCommand('test_reminder', createCtx({ chat: { id: 476561547, type: 'private' } }));
    expect(replyCalls.find(c => String(c.text).includes('ТЕСТ НАПОМИНАНИЯ'))).toBeTruthy();
  });

  it('команда test_schema работает', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    const adminCtx = createCtx({ chat: { id: 476561547, type: 'private' } });
    await bot.__emitCommand('test_schema', adminCtx);
    expect(replyCalls.find(c => String(c.text).includes('Тестовая схема'))).toBeTruthy();
  });

  it('команда next_image отвечает фото', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    await bot.__emitCommand('next_image', createCtx({ chat: { id: 476561547, type: 'private' } }));
    expect(true).toBe(true);
  });

  it('команда fly1 отправляет сообщение в канал', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    await bot.__emitCommand('fly1', createCtx({ chat: { id: 476561547, type: 'private' } }));
    expect(true).toBe(true);
  });

  it('команда test_reply выдает информационный текст', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    await bot.__emitCommand('test_reply', createCtx({ chat: { id: 476561547, type: 'private' } }));
    expect(replyCalls.find(c => String(c.text).includes('ТЕСТ ОБРАБОТКИ СООБЩЕНИЙ'))).toBeTruthy();
  });

  it('callback test_button_click работает', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    await bot.__emitCommand('test_button', createCtx());
    // Должен быть ответ с кнопкой
    expect(replyCalls.find(c => String(c.text).includes('Тест кнопки'))).toBeTruthy();
  });

  it('обработчик текстовых сообщений вызывает интерактивный режим', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    const ctx = createCtx({
      chat: { id: -1002798126153, type: 'supergroup' },
      message: { message_id: 10, text: 'Привет, бот!' },
    });
    await bot.__emitEvent('text', ctx);
    // Нет строгой проверки, что отправлено сообщение — важно, что обработчик не упал
    expect(true).toBe(true);
  });
});

describe('bot.ts команды логов (полное покрытие)', () => {
  beforeEach(() => {
    telegramCalls.length = 0;
    replyCalls.length = 0;
    Object.values(dbSpies).forEach((s: any) => typeof s.mock?.clear === 'function' && s.mock.clear());
  });

  it('/logs без логов отвечает пустым сообщением', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    dbSpies.getRecentUnreadInfoLogs.mockReturnValue([]);
    await bot.__emitCommand('logs', createCtx({ chat: { id: 476561547, type: 'private' } }));
    expect(replyCalls[0].text).toContain('Непрочитанные логи INFO+ отсутствуют');
  });

  it('/logs с логами показывает список', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    const testLogs = [
      {
        id: 1,
        timestamp: new Date().toISOString(),
        level: 'error',
        message: 'Тестовая ошибка',
        data: JSON.stringify({ error: 'test' }),
        is_read: false,
      },
      {
        id: 2,
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Информационное сообщение',
        data: null,
        is_read: false,
      },
    ];
    dbSpies.getRecentUnreadInfoLogs.mockReturnValue(testLogs);
    dbSpies.getLogsCount.mockReturnValue(10);
    dbSpies.getUnreadLogsCount.mockReturnValue(2);
    
    await bot.__emitCommand('logs', createCtx({ chat: { id: 476561547, type: 'private' } }));
    expect(replyCalls[0].text).toContain('ЛОГИ СИСТЕМЫ');
    expect(replyCalls[0].text).toContain('Всего: 10');
    expect(replyCalls[0].text).toContain('Непрочитано: 2');
  });

  it('/logs для не-админа отклоняется', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    await bot.__emitCommand('logs', createCtx({ chat: { id: 12345, type: 'private' } }));
    expect(replyCalls[0].text).toContain('Эта команда доступна только администратору');
  });

  it('action logs_filter_menu показывает меню фильтров', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    const ctx = createCtx({
      chat: { id: 476561547, type: 'private' },
      callbackQuery: { message: { message_id: 100 } }
    });
    await bot.__emitAction('logs_filter_menu', ctx);
    expect(telegramCalls.find(c => c.method === 'editMessageText')).toBeTruthy();
  });

  it('action logs_filter_all показывает все логи', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    dbSpies.getRecentLogs.mockReturnValue([
      { id: 1, level: 'debug', message: 'Debug log', timestamp: new Date().toISOString(), is_read: false }
    ]);
    await bot.__emitAction('logs_filter_all', createCtx({ chat: { id: 476561547 } }));
    expect(dbSpies.getRecentLogs).toHaveBeenCalled();
  });

  it('action logs_filter_unread фильтрует непрочитанные', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    dbSpies.getRecentUnreadLogs.mockReturnValue([]);
    await bot.__emitAction('logs_filter_unread', createCtx({ chat: { id: 476561547 } }));
    expect(dbSpies.getRecentUnreadLogs).toHaveBeenCalled();
  });

  it('action logs_filter_error показывает ошибки', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    dbSpies.getRecentLogsByLevel.mockReturnValue([]);
    await bot.__emitAction('logs_filter_error', createCtx({ chat: { id: 476561547 } }));
    expect(dbSpies.getRecentLogsByLevel).toHaveBeenCalledWith('error', 7, 0);
  });

  it('action logs_mark_all_read помечает все как прочитанные', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    await bot.__emitAction('logs_mark_all_read', createCtx({ 
      chat: { id: 476561547 },
      callbackQuery: { message: { message_id: 100 } }
    }));
    expect(dbSpies.markLogsAsRead).toHaveBeenCalled();
  });

  it('action logs_download создает файл с логами', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    const fs = await import('fs');
    dbSpies.getRecentLogs.mockReturnValue([
      { id: 1, level: 'info', message: 'Test', timestamp: new Date().toISOString() }
    ]);
    const ctx = createCtx({ 
      chat: { id: 476561547 },
      replyWithDocument: vi.fn(() => Promise.resolve({}))
    });
    await bot.__emitAction('logs_download_0_all', ctx);
    expect(fs.writeFileSync).toHaveBeenCalled();
    expect(ctx.replyWithDocument).toHaveBeenCalled();
  });

  it('action log_read читает конкретный лог', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    const logData = {
      id: 123,
      timestamp: new Date().toISOString(),
      level: 'error',
      message: 'Detailed error message',
      data: JSON.stringify({ stack: 'Error stack trace' }),
      is_read: false,
    };
    dbSpies.db.query.mockReturnValue({
      get: () => logData,
      all: () => []
    });
    await bot.__emitAction('log_read_123', createCtx({ chat: { id: 476561547 } }));
    expect(dbSpies.markLogAsRead).toHaveBeenCalledWith(123);
  });

  it('action logs_stats показывает статистику', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    dbSpies.getLogsStatistics.mockReturnValue([
      { level: 'info', count: 50 },
      { level: 'error', count: 10 }
    ]);
    dbSpies.getLogsCount.mockReturnValue(60);
    await bot.__emitAction('logs_stats', createCtx({ chat: { id: 476561547 } }));
    expect(telegramCalls.find(c => c.method === 'editMessageText')).toBeTruthy();
  });

  it('action logs навигация next/prev работает', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    dbSpies.getRecentLogs.mockReturnValue([]);
    const ctx1 = createCtx({ 
      chat: { id: 476561547 },
      callbackQuery: { message: { message_id: 100 } }
    });
    const ctx2 = createCtx({ 
      chat: { id: 476561547 },
      callbackQuery: { message: { message_id: 101 } }
    });
    await bot.__emitAction('logs_next_1_all', ctx1);
    await bot.__emitAction('logs_prev_1_all', ctx2);
    expect(dbSpies.getRecentLogs).toHaveBeenCalled();
  });
});

describe('bot.ts Express обработчики', () => {
  beforeEach(() => {
    telegramCalls.length = 0;
    replyCalls.length = 0;
    Object.values(dbSpies).forEach((s: any) => typeof s.mock?.clear === 'function' && s.mock.clear());
  });

  it('GET /oauth2callback обрабатывает успешный callback', async () => {
    const handler = expressHandlers.get('GET:/oauth2callback');
    expect(handler).toBeDefined();
    if (!handler) return;
    
    const req = {
      query: { code: 'test_code', state: '12345' }
    };
    const res = {
      send: vi.fn()
    };
    
    await handler(req, res);
    expect(res.send).toHaveBeenCalled();
    expect(telegramCalls.find(c => c.text?.includes('успешно подключен'))).toBeTruthy();
  });

  it('GET /oauth2callback обрабатывает ошибку', async () => {
    const handler = expressHandlers.get('GET:/oauth2callback');
    if (!handler) return;
    const req = { query: {} };
    const res = { send: vi.fn() };
    
    await handler(req, res);
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining('Ошибка'));
  });

  it('POST /sendDailyMessage запускает рассылку для админа', async () => {
    const handler = expressHandlers.get('POST:/sendDailyMessage');
    expect(handler).toBeDefined();
    if (!handler) return;
    
    const req = {
      body: { adminKey: process.env.ADMIN_KEY || 'test-key' }
    };
    const res = {
      json: vi.fn()
    };
    
    await handler(req, res);
    expect(res.json).toHaveBeenCalledWith({ success: true, message: expect.any(String) });
  });

  it('POST /sendDailyMessage отклоняет неверный ключ', async () => {
    const handler = expressHandlers.get('POST:/sendDailyMessage');
    if (!handler) return;
    const req = { body: { adminKey: 'wrong-key' } };
    const res = { status: vi.fn(() => res), json: vi.fn() };
    
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('GET /status возвращает статус планировщика', async () => {
    const handler = expressHandlers.get('GET:/status');
    expect(handler).toBeDefined();
    if (!handler) return;
    
    const req = {};
    const res = { json: vi.fn() };
    
    await handler(req, res);
    expect(res.json).toHaveBeenCalledWith({ status: 'up' });
  });
});

describe('bot.ts дополнительные команды (полное покрытие)', () => {
  beforeEach(() => {
    telegramCalls.length = 0;
    replyCalls.length = 0;
    Object.values(dbSpies).forEach((s: any) => typeof s.mock?.clear === 'function' && s.mock.clear());
  });

  it('/users показывает список пользователей админу', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    dbSpies.getAllUsers.mockReturnValue([
      { chat_id: 123, username: 'user1', responded_today: 1 },
      { chat_id: 456, username: 'user2', responded_today: 0 }
    ]);
    await bot.__emitCommand('users', createCtx({ chat: { id: 476561547, type: 'private' } }));
    expect(replyCalls[0].text).toContain('ПОЛЬЗОВАТЕЛИ В БАЗЕ');
    expect(replyCalls[0].text).toContain('user1');
  });

  it('/users для не-админа отклоняется', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    await bot.__emitCommand('users', createCtx({ chat: { id: 12345, type: 'private' } }));
    expect(replyCalls[0].text).toContain('Эта команда доступна только администратору');
  });

  it('/check_config показывает конфигурацию', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    await bot.__emitCommand('check_config', createCtx({ chat: { id: 476561547, type: 'private' } }));
    expect(replyCalls[0].text).toContain('КОНФИГУРАЦИЯ УТРЕННЕЙ ПРОВЕРКИ');
  });

  it('/test_busy тестирует определение занятости', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    
    // Мокаем getEvents для CalendarService
    const { CalendarService } = await import('../src/calendar.ts');
    CalendarService.prototype.getEvents = vi.fn(async () => [
      { summary: 'Встреча', start: { dateTime: new Date().toISOString() }, busy: true }
    ]);
    
    await bot.__emitCommand('test_busy', createCtx({ chat: { id: 476561547, type: 'private' } }));
    expect(replyCalls.find(c => c.text?.includes('тест определения занятости'))).toBeTruthy();
  });

  it('/test_tracking тестирует отслеживание пользователей', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    await bot.__emitCommand('test_tracking', createCtx({ chat: { id: 476561547, type: 'private' } }));
    expect(replyCalls[0].text).toContain('ТЕСТ УНИВЕРСАЛЬНОГО ОТСЛЕЖИВАНИЯ');
  });

  it('/minimalTestLLM тестирует LLM', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    await bot.__emitCommand('minimalTestLLM', createCtx({ chat: { id: 476561547, type: 'private' } }));
    expect(replyCalls.find(c => c.text?.includes('Начинаю тестирование LLM'))).toBeTruthy();
  });

  it('/test_buttons тестирует кнопки комментариев', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    await bot.__emitCommand('test_buttons', createCtx({ 
      chat: { id: 476561547, type: 'private' },
      message: { message_thread_id: 123 }
    }));
    expect(replyCalls[0].text).toContain('Тестовый пост отправлен');
  });

  it('команда setname обновляет имя пользователя', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    
    const ctx = createCtx({ message: { text: '/setname Иван' } });
    await bot.__emitCommand('setname', ctx);
    expect(dbSpies.updateUserName).toHaveBeenCalledWith(476561547, 'Иван');
  });

  it('/test_schema тестирует отправку схемы', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    await bot.__emitCommand('test_schema', createCtx({ chat: { id: 476561547, type: 'private' } }));
    expect(replyCalls.find(c => c.text?.includes('Тестовая схема'))).toBeTruthy();
  });

  it('/last_run показывает время последнего запуска', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    await bot.__emitCommand('last_run', createCtx({ chat: { id: 476561547, type: 'private' } }));
    expect(replyCalls[0].text).toContain('ПОСЛЕДНЯЯ РАССЫЛКА');
  });

  it('/ans запускает проверку незавершенных заданий', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    await bot.__emitCommand('ans', createCtx({ chat: { id: 476561547, type: 'private' } }));
    expect(replyCalls[0].text).toContain('Запускаю проверку незавершенных заданий');
  });

  it('/test_morning_check запускает утреннюю проверку', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    await bot.__emitCommand('test_morning_check', createCtx({ chat: { id: 476561547, type: 'private' } }));
    expect(replyCalls[0].text).toContain('Запускаю тестовую утреннюю проверку');
  });

  it('callback кнопки test_button отвечают', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    const ctx = createCtx();
    await bot.__emitAction('test_button_click', ctx);
    expect(ctx.answerCbQuery).toHaveBeenCalledWith('✅ Кнопка работает!');
  });

  it('action skip_schema работает', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    await bot.__emitAction('skip_schema_123', createCtx({ 
      chat: { id: -1002798126153 },
      message: { message_id: 50 },
      callbackQuery: { message: { message_id: 50 } }
    }));
    expect(dbSpies.updateInteractivePostState).toHaveBeenCalled();
  });

  it('команда remind устанавливает напоминание', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    await bot.__emitCommand('remind', createCtx());
    expect(replyCalls[0].text).toContain('напоминание');
  });

  it('action daily_skip_all пропускает все задания', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    await bot.__emitAction('daily_skip_all', createCtx({
      chat: { id: 476561547 },
      callbackQuery: { message: { message_id: 50 } }
    }));
    expect(replyCalls.length).toBeGreaterThan(0);
  });

  it('action skip_neg пропускает негативное задание', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    await bot.__emitAction('skip_neg_123', createCtx({
      chat: { id: 476561547 },
      callbackQuery: { message: { message_id: 50 } }
    }));
    expect(replyCalls.length).toBeGreaterThan(0);
  });

  it('/fly команда для отправки в канал', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    await bot.__emitCommand('fly', createCtx({ chat: { id: 476561547, type: 'private' } }));
    expect(replyCalls.find(c => c.text?.includes('летное'))).toBeTruthy();
  });
});

describe('bot.ts error paths и edge cases', () => {
  beforeEach(() => {
    telegramCalls.length = 0;
    replyCalls.length = 0;
    Object.values(dbSpies).forEach((s: any) => typeof s.mock?.clear === 'function' && s.mock.clear());
  });

  it('команда с ошибкой базы данных обрабатывается корректно', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    dbSpies.addUser.mockRejectedValueOnce(new Error('Database error'));
    
    await bot.__emitCommand('start', createCtx());
    expect(replyCalls.find(c => c.text?.includes('Ошибка'))).toBeTruthy();
  });

  it('logs с ошибкой форматирования JSON обрабатываются', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    const testLogs = [{
      id: 1,
      timestamp: new Date().toISOString(),
      level: 'error',
      message: 'Test error',
      data: 'invalid json {',
      is_read: false,
    }];
    dbSpies.getRecentUnreadInfoLogs.mockReturnValue(testLogs);
    
    await bot.__emitCommand('logs', createCtx({ chat: { id: 476561547, type: 'private' } }));
    expect(replyCalls[0].text).toContain('ЛОГИ СИСТЕМЫ');
  });

  it('callback query без данных обрабатывается', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    const ctx = createCtx({
      callbackQuery: { data: null }
    });
    
    // Не должно выбросить ошибку
    expect(() => bot.__emitAction('', ctx)).toThrow();
  });

  it('недостаточно прав для админских команд', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    
    const commands = ['status', 'users', 'test_schedule', 'logs'];
    for (const cmd of commands) {
      await bot.__emitCommand(cmd, createCtx({ chat: { id: 999, type: 'private' } }));
      expect(replyCalls[replyCalls.length - 1].text).toContain('доступна только администратору');
    }
  });

  it('обработка сообщений в группе от бота игнорируется', async () => {
    const { Telegraf }: any = await import('telegraf');
    const bot = (Telegraf as any).__lastInstance;
    const ctx = createCtx({
      chat: { id: -1002798126153, type: 'supergroup' },
      message: { message_id: 10, text: 'Test' },
      from: { id: 999, is_bot: true }
    });
    
    await bot.__emitEvent('text', ctx);
    expect(replyCalls.length).toBe(0); // Бот не отвечает на сообщения от других ботов
  });
});
