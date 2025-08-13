import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Scheduler } from '../src/scheduler';

describe('Интеграционные тесты интерактивных ответов', () => {
  let scheduler: any;
  let mockBot: any;
  let sentMessages: any[] = [];

  beforeEach(() => {
    // Очищаем сообщения
    sentMessages = [];

    // Создаем мок для Telegram API
    mockBot = {
      telegram: {
        sendMessage: async (chatId: number, text: string, options: any) => {
          const message = { chatId, text, options, type: 'text' };
          sentMessages.push(message);
          return { message_id: Math.floor(Math.random() * 10000) };
        },
        sendPhoto: async (chatId: number, photo: any, options: any) => {
          const message = { chatId, photo, options, type: 'photo' };
          sentMessages.push(message);
          return { message_id: Math.floor(Math.random() * 10000) };
        },
      },
    };

    // Создаем экземпляр scheduler
    scheduler = new Scheduler();
    scheduler.bot = mockBot;
    scheduler.CHANNEL_ID = -1002405993986;
    scheduler.CHAT_ID = -1002496122257;
    scheduler.users = new Set([5153477378]);
  });

  afterEach(() => {
    sentMessages = [];
  });

  describe('determineCurrentStep', () => {
    it('должен правильно определять текущий шаг', () => {
      // Ничего не выполнено
      expect(
        scheduler.determineCurrentStep({
          task1_completed: false,
          task2_completed: false,
          task3_completed: false,
        })
      ).toBe('waiting_negative');

      // Первое выполнено
      expect(
        scheduler.determineCurrentStep({
          task1_completed: true,
          task2_completed: false,
          task3_completed: false,
        })
      ).toBe('waiting_positive');

      // Два выполнено
      expect(
        scheduler.determineCurrentStep({
          task1_completed: true,
          task2_completed: true,
          task3_completed: false,
        })
      ).toBe('waiting_practice');

      // Все выполнено
      expect(
        scheduler.determineCurrentStep({
          task1_completed: true,
          task2_completed: true,
          task3_completed: true,
        })
      ).toBe('finished');
    });
  });

  describe('sendPendingResponse', () => {
    it('должен отправить схему разбора для waiting_negative', async () => {
      const mockPost = {
        message_data: {
          negative_part: { additional_text: 'Тест негатив' },
          positive_part: { additional_text: 'Тест позитив' },
        },
        relaxation_type: 'breathing',
      };

      await scheduler.sendPendingResponse(5153477378, mockPost, 'waiting_negative', -1002496122257, 1000);

      // Проверяем, что было отправлено сообщение
      expect(sentMessages.length).toBe(1);

      const message = sentMessages[0];
      expect(message.type).toBe('text');
      expect(message.text).toBe(
        'Давай <b>разложим</b> минимум одну ситуацию <b>по схеме</b>:\n🗓 Триггер - Мысли - Эмоции - Ощущения в теле - Поведение или импульс к действию'
      );
      expect(message.options.parse_mode).toBe('HTML');
    });

    it('должен отправить финальное задание для waiting_positive', async () => {
      const mockPost = {
        relaxation_type: 'breathing',
      };

      await scheduler.sendPendingResponse(5153477378, mockPost, 'waiting_positive', -1002496122257, 1000);

      // Проверяем, что было отправлено сообщение
      expect(sentMessages.length).toBe(1);

      const message = sentMessages[0];
      expect(message.type).toBe('text');
      expect(message.text).toContain('У нас остался последний шаг');
      expect(message.text).toContain('3. <b>Дыхательная практика</b>');
      expect(message.options.reply_markup.inline_keyboard).toBeDefined();
      expect(message.options.reply_markup.inline_keyboard.length).toBe(2);
    });

    it('должен использовать расслабление тела если указано', async () => {
      const mockPost = {
        relaxation_type: 'body',
      };

      await scheduler.sendPendingResponse(5153477378, mockPost, 'waiting_positive', -1002496122257, 1000);

      const message = sentMessages[0];
      expect(message.text).toContain('3. <b>Расслабление тела</b>');
      expect(message.text).toContain('clck.ru/3LmcNv');
    });
  });

  describe('buildSecondPart', () => {
    it('должен построить текст второго задания', () => {
      const messageData = {
        positive_part: {
          title: 'Плюшки для лягушки',
          additional_text: 'Расскажи о чем-то хорошем',
        },
      };

      const result = scheduler.buildSecondPart(messageData);

      expect(result).toContain('2. <b>Плюшки для лягушки</b>');
      expect(result).toContain('Расскажи о чем-то хорошем');
    });
  });

  describe('getRandomSupportText', () => {
    it('должен возвращать случайный текст поддержки', () => {
      const supportTexts = [
        'Спасибо, что поделился 💚',
        'Понимаю тебя 🤗',
        'Это действительно непросто 💛',
        'Ты молодец, что проговариваешь это 🌱',
        'Твои чувства важны 💙',
        'Слышу тебя 🤍',
        'Благодарю за доверие 🌿',
      ];

      const result = scheduler.getRandomSupportText();
      expect(supportTexts).toContain(result);
    });
  });

  describe('Полный сценарий интерактивной сессии', () => {
    it('должен правильно обработать полный цикл от первого задания до финала', async () => {
      const mockPost = {
        channel_message_id: 1000,
        user_id: 5153477378,
        task1_completed: false,
        task2_completed: false,
        task3_completed: false,
        message_data: {
          negative_part: {
            title: 'Выгрузка неприятных переживаний',
            additional_text: 'Расскажи о том, что тебя беспокоит',
          },
          positive_part: {
            title: 'Плюшки для лягушки',
            additional_text: 'Поделись чем-то хорошим',
          },
        },
        relaxation_type: 'breathing',
      };

      // Шаг 1: Пользователь еще не ответил
      const step1 = scheduler.determineCurrentStep(mockPost);
      expect(step1).toBe('waiting_negative');

      // Отправляем схему разбора для незавершенного задания
      await scheduler.sendPendingResponse(
        mockPost.user_id,
        mockPost,
        step1,
        -1002496122257,
        mockPost.channel_message_id
      );

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].text).toBe(
        'Давай <b>разложим</b> минимум одну ситуацию <b>по схеме</b>:\n🗓 Триггер - Мысли - Эмоции - Ощущения в теле - Поведение или импульс к действию'
      );

      // Шаг 2: Пользователь ответил на схему (симулируем обновление)
      mockPost.task1_completed = true;
      const step2 = scheduler.determineCurrentStep(mockPost);
      expect(step2).toBe('waiting_positive');

      // Очищаем предыдущие сообщения
      sentMessages = [];

      // Шаг 3: Пользователь ответил на плюшки (симулируем)
      mockPost.task2_completed = true;
      const step3 = scheduler.determineCurrentStep(mockPost);
      expect(step3).toBe('waiting_practice');

      // Отправляем финальное задание
      await scheduler.sendPendingResponse(
        mockPost.user_id,
        mockPost,
        'waiting_positive', // Используем предыдущий шаг для sendPendingResponse
        -1002496122257,
        mockPost.channel_message_id
      );

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].text).toContain('У нас остался последний шаг');
      expect(sentMessages[0].text).toContain('Дыхательная практика');

      // Шаг 4: Все выполнено
      mockPost.task3_completed = true;
      const step4 = scheduler.determineCurrentStep(mockPost);
      expect(step4).toBe('finished');
    });
  });
});
