import { describe, it, expect, beforeEach, mock, afterEach } from 'bun:test';

// Создаем моки функций
const mockGetUserIncompletePosts = mock(() => []);
const mockGetInteractivePost = mock(() => null);
const mockUpdateTaskStatus = mock(() => {});
const mockSaveMessage = mock(() => {});
const mockGetChannelMessageIdByThreadId = mock(() => null);

// Подготавливаем мок-модуль
const mockDb = {
  getUserIncompletePosts: mockGetUserIncompletePosts,
  getInteractivePost: mockGetInteractivePost,
  updateTaskStatus: mockUpdateTaskStatus,
  saveMessage: mockSaveMessage,
  getChannelMessageIdByThreadId: mockGetChannelMessageIdByThreadId,
  db: {
    query: mock(() => ({
      all: mock(() => []),
      get: mock(() => null),
    })),
  }
};

// Импортируем Scheduler после настройки моков
import { Scheduler } from '../src/scheduler';

describe('Интерактивные ответы пользователей', () => {
  let scheduler: Scheduler;
  let mockBot: any;
  let mockTelegram: any;

  beforeEach(() => {
    // Создаем моки для Telegram API
    mockTelegram = {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 123 }),
      sendPhoto: vi.fn().mockResolvedValue({ message_id: 456 }),
    };

    mockBot = {
      telegram: mockTelegram,
    };

    // Создаем экземпляр Scheduler с моками
    scheduler = new Scheduler();
    (scheduler as any).bot = mockBot;
    (scheduler as any).CHANNEL_ID = -1002405993986;
    (scheduler as any).CHAT_ID = -1002496122257;
    (scheduler as any).users = new Set([5153477378]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('handleInteractiveUserResponse', () => {
    const userId = 5153477378;
    const replyToChatId = -1002496122257;
    const messageId = 789;
    const messageThreadId = 1572;
    const channelMessageId = 1000;

    it('должен обработать первый ответ пользователя и отправить схему разбора', async () => {
      // Настраиваем моки
      const mockPost = {
        channel_message_id: channelMessageId,
        user_id: userId,
        task1_completed: false,
        task2_completed: false,
        task3_completed: false,
        message_data: {
          negative_part: { additional_text: 'Тест негатив' },
          positive_part: { additional_text: 'Тест позитив' },
        },
        relaxation_type: 'breathing',
      };

      vi.mocked(db.getInteractivePost).mockReturnValue(mockPost);
      vi.mocked(db.getUserIncompletePosts).mockReturnValue([mockPost]);

      // Вызываем метод
      const result = await scheduler.handleInteractiveUserResponse(
        userId,
        'У меня был сложный день на работе',
        replyToChatId,
        messageId,
        messageThreadId
      );

      // Проверяем результат
      expect(result).toBe(true);

      // Проверяем, что НЕ обновлен статус задания (новая логика)
      expect(db.updateTaskStatus).not.toHaveBeenCalled();

      // Проверяем, что отправлена схема разбора
      expect(mockTelegram.sendMessage).toHaveBeenCalledWith(
        replyToChatId,
        'Давай разложим самую беспокоящую ситуацию по схеме: Триггер - мысли - чувства - тело - действия',
        expect.objectContaining({
          parse_mode: 'HTML',
          reply_parameters: { message_id: messageId },
        })
      );

      // Проверяем, что сообщение сохранено
      expect(db.saveMessage).toHaveBeenCalledTimes(2); // Сообщение пользователя + ответ бота
    });

    it('должен обработать ответ на схему разбора и отправить плюшки', async () => {
      // Настраиваем пост где пользователь уже ответил на первое задание
      const mockPost = {
        channel_message_id: channelMessageId,
        user_id: userId,
        task1_completed: false, // Еще false, так как ждем ответа на схему
        task2_completed: false,
        task3_completed: false,
        message_data: {
          negative_part: { additional_text: 'Тест негатив' },
          positive_part: { additional_text: 'Тест позитив' },
        },
        relaxation_type: 'breathing',
      };

      vi.mocked(db.getInteractivePost).mockReturnValue(mockPost);

      // Симулируем, что это второй вызов (после схемы)
      // Для этого нужно сначала вызвать первый раз
      await scheduler.handleInteractiveUserResponse(
        userId,
        'У меня был сложный день',
        replyToChatId,
        messageId,
        messageThreadId
      );

      // Очищаем вызовы
      vi.clearAllMocks();

      // Теперь пользователь отвечает на схему
      const result = await scheduler.handleInteractiveUserResponse(
        userId,
        'Триггер: критика коллеги. Мысли: я некомпетентен. Чувства: обида, злость. Тело: напряжение в плечах. Действия: ушел раньше с работы.',
        replyToChatId,
        messageId + 1,
        messageThreadId
      );

      // Проверяем результат
      expect(result).toBe(true);

      // Теперь должен обновиться статус первого задания
      expect(db.updateTaskStatus).toHaveBeenCalledWith(channelMessageId, 1, true);

      // Проверяем, что отправлены плюшки
      expect(mockTelegram.sendMessage).toHaveBeenCalledWith(
        replyToChatId,
        expect.stringContaining('Тест позитив'),
        expect.objectContaining({
          parse_mode: 'HTML',
        })
      );
    });

    it('должен обработать ответ на плюшки и отправить финальное задание', async () => {
      // Настраиваем пост где выполнено первое задание
      const mockPost = {
        channel_message_id: channelMessageId,
        user_id: userId,
        task1_completed: true,
        task2_completed: false,
        task3_completed: false,
        message_data: {
          positive_part: { additional_text: 'Тест позитив' },
        },
        relaxation_type: 'breathing',
      };

      vi.mocked(db.getInteractivePost).mockReturnValue(mockPost);
      vi.mocked(db.getUserIncompletePosts).mockReturnValue([mockPost]);

      // Вызываем метод
      const result = await scheduler.handleInteractiveUserResponse(
        userId,
        'Сегодня я помог коллеге с задачей и получил благодарность',
        replyToChatId,
        messageId,
        messageThreadId
      );

      // Проверяем результат
      expect(result).toBe(true);

      // Проверяем обновление статуса второго задания
      expect(db.updateTaskStatus).toHaveBeenCalledWith(channelMessageId, 2, true);

      // Проверяем отправку финального задания
      expect(mockTelegram.sendMessage).toHaveBeenCalledWith(
        replyToChatId,
        expect.stringContaining('У нас остался последний шаг'),
        expect.objectContaining({
          parse_mode: 'HTML',
          reply_markup: expect.objectContaining({
            inline_keyboard: expect.arrayContaining([
              expect.arrayContaining([
                expect.objectContaining({ text: '✅ Сделал' }),
              ]),
              expect.arrayContaining([
                expect.objectContaining({ text: '⏰ Отложить на 1 час' }),
              ]),
            ]),
          }),
        })
      );
    });

    it('должен корректно определить текущий шаг для незавершенного поста', () => {
      const scheduler = new Scheduler();
      
      // Тест 1: Ничего не выполнено
      expect((scheduler as any).determineCurrentStep({
        task1_completed: false,
        task2_completed: false,
        task3_completed: false,
      })).toBe('waiting_negative');

      // Тест 2: Первое выполнено
      expect((scheduler as any).determineCurrentStep({
        task1_completed: true,
        task2_completed: false,
        task3_completed: false,
      })).toBe('waiting_positive');

      // Тест 3: Два выполнено
      expect((scheduler as any).determineCurrentStep({
        task1_completed: true,
        task2_completed: true,
        task3_completed: false,
      })).toBe('waiting_practice');

      // Тест 4: Все выполнено
      expect((scheduler as any).determineCurrentStep({
        task1_completed: true,
        task2_completed: true,
        task3_completed: true,
      })).toBe('finished');
    });
  });

  describe('checkUncompletedTasks', () => {
    it('должен найти незавершенные задания и отправить правильные ответы', async () => {
      // Мокаем запрос к БД
      const mockDb = {
        query: vi.fn().mockReturnValue({
          all: vi.fn().mockReturnValue([
            {
              channel_message_id: 1000,
              user_id: 5153477378,
              task1_completed: false,
              task2_completed: false,
              task3_completed: false,
              created_at: new Date().toISOString(),
              message_data: JSON.stringify({
                negative_part: { additional_text: 'Тест негатив' },
                positive_part: { additional_text: 'Тест позитив' },
              }),
              relaxation_type: 'breathing',
            },
          ]),
          get: vi.fn().mockReturnValue({
            message_text: 'Ответ пользователя на первое задание',
            sent_time: new Date().toISOString(),
          }),
        }),
      };

      // Подменяем импорт db
      vi.doMock('../src/db', () => ({ db: mockDb }));

      await scheduler.checkUncompletedTasks();

      // Проверяем, что был выполнен запрос к БД
      expect(mockDb.query).toHaveBeenCalled();

      // Проверяем, что была отправлена схема разбора (согласно новой логике)
      expect(mockTelegram.sendMessage).toHaveBeenCalledWith(
        expect.any(Number),
        'Давай разложим самую беспокоящую ситуацию по схеме: Триггер - мысли - чувства - тело - действия',
        expect.any(Object)
      );
    });

    it('должен пропустить посты без ответов пользователя', async () => {
      const mockDb = {
        query: vi.fn().mockReturnValue({
          all: vi.fn().mockReturnValue([
            {
              channel_message_id: 1000,
              user_id: 5153477378,
              task1_completed: false,
              task2_completed: false,
              task3_completed: false,
              created_at: new Date().toISOString(),
              message_data: '{}',
            },
          ]),
          get: vi.fn().mockReturnValue(null), // Нет сообщений от пользователя
        }),
      };

      vi.doMock('../src/db', () => ({ db: mockDb }));

      await scheduler.checkUncompletedTasks();

      // Проверяем, что сообщение НЕ было отправлено
      expect(mockTelegram.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('sendPendingResponse', () => {
    it('должен отправить схему разбора для waiting_negative', async () => {
      const mockPost = {
        message_data: {
          negative_part: { additional_text: 'Тест' },
          positive_part: { additional_text: 'Тест' },
        },
        relaxation_type: 'breathing',
      };

      await (scheduler as any).sendPendingResponse(
        5153477378,
        mockPost,
        'waiting_negative',
        -1002496122257,
        1000
      );

      // Проверяем отправку схемы разбора
      expect(mockTelegram.sendMessage).toHaveBeenCalledWith(
        -1002496122257,
        'Давай разложим самую беспокоящую ситуацию по схеме: Триггер - мысли - чувства - тело - действия',
        expect.objectContaining({
          parse_mode: 'HTML',
        })
      );

      // Проверяем, что статус НЕ обновлен
      expect(db.updateTaskStatus).not.toHaveBeenCalled();
    });

    it('должен отправить финальное задание для waiting_positive', async () => {
      const mockPost = {
        relaxation_type: 'breathing',
      };

      await (scheduler as any).sendPendingResponse(
        5153477378,
        mockPost,
        'waiting_positive',
        -1002496122257,
        1000
      );

      // Проверяем отправку финального задания
      expect(mockTelegram.sendMessage).toHaveBeenCalledWith(
        -1002496122257,
        expect.stringContaining('3. <b>Дыхательная практика</b>'),
        expect.objectContaining({
          parse_mode: 'HTML',
          reply_markup: expect.objectContaining({
            inline_keyboard: expect.any(Array),
          }),
        })
      );

      // Проверяем обновление статуса
      expect(db.updateTaskStatus).toHaveBeenCalledWith(1000, 2, true);
    });
  });
});