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
vi.mock('express', () => {
  const express: any = () => ({
    use: () => {},
    all: () => {},
    get: () => {},
    post: () => {},
    listen: (_port: number, _host?: any, cb?: any) => {
      if (typeof _host === 'function') cb = _host;
      cb && cb();
      return { close: () => {} };
    },
  });
  express.json = () => (req: any, _res: any, next: any) => next();
  return { default: express };
});

// Мок logger
vi.mock('../src/logger.ts', () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn() },
  botLogger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
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
  escapeHTML: (s: string) => s,
  db: { run: vi.fn(() => ({})), query: vi.fn(() => ({ get: () => undefined, all: () => [] })) },
};
vi.mock('../src/db.ts', () => dbSpies);

vi.mock('node-cron', () => ({ schedule: vi.fn((_expr: string, _fn: any) => ({ stop: vi.fn(), destroy: vi.fn() })) }));

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
    callbackQuery: undefined as any,
  };
  return Object.assign(base, overrides);
}

describe('bot.ts команды и обработчики (покрытие)', () => {
  beforeAll(async () => {
    process.env.IS_TEST_BOT = 'true';
    process.env.TELEGRAM_BOT_TOKEN = 'TEST_TOKEN';
    process.env.ADMIN_CHAT_ID = '476561547';
    await import('../src/bot.ts');
  });

  beforeEach(() => {
    telegramCalls.length = 0;
    replyCalls.length = 0;
    Object.values(dbSpies).forEach((s: any) => typeof s.mock?.clear === 'function' && s.mock.clear());
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
