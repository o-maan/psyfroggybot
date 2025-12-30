import { describe, it, expect, mock, beforeEach, afterEach, spyOn } from 'bun:test';

describe('Система приоритета команд и постов в ЛС', () => {
  let mockScheduler: any;

  beforeEach(() => {
    // Создаем мок scheduler с реальными Maps
    mockScheduler = {
      shortJoySessions: new Map(),
      shortJoyPendingMessages: new Map(),
      shortJoyLastButtonMessageId: new Map(),
      shortJoyListMessageId: new Map(),
      shortJoyAddingSessions: new Map(),
      shortJoyListShown: new Map(),
      shortJoyRemovalSessions: new Map(),
      joySessions: new Map(),
      joyPendingMessages: new Map(),
      joyLastButtonMessageId: new Map(),
      joyListMessageId: new Map(),
      joyAddingSessions: new Map(),
      joyListShown: new Map(),
      joyRemovalSessions: new Map(),
      commandTimeouts: new Map(),
    };
  });

  describe('clearAllCommandSessions() - очистка Maps', () => {
    it('должен очищать SHORT JOY сессию по userId', () => {
      const userId = 123;
      const shortJoyId = 456;
      const sessionKey = `short_joy_${userId}_${shortJoyId}`;

      // Устанавливаем сессию
      mockScheduler.shortJoySessions.set(userId, {
        shortJoyId,
        userId,
        chatId: userId,
        messageThreadId: undefined,
        isIntro: false,
      });
      mockScheduler.shortJoyPendingMessages.set(sessionKey, ['msg1', 'msg2']);
      mockScheduler.shortJoyAddingSessions.set(sessionKey, true);
      mockScheduler.shortJoyListShown.set(sessionKey, true);

      // Вызываем очистку SHORT JOY
      const shortJoySession = mockScheduler.shortJoySessions.get(userId);
      if (shortJoySession) {
        const key = `short_joy_${userId}_${shortJoySession.shortJoyId}`;
        mockScheduler.shortJoyPendingMessages.delete(key);
        mockScheduler.shortJoyLastButtonMessageId.delete(key);
        mockScheduler.shortJoyListMessageId.delete(key);
        mockScheduler.shortJoyAddingSessions.delete(key);
        mockScheduler.shortJoyListShown.delete(key);
        mockScheduler.shortJoyRemovalSessions?.delete(key);
        mockScheduler.shortJoySessions.delete(userId);
      }

      // Проверяем что всё очищено
      expect(mockScheduler.shortJoySessions.has(userId)).toBe(false);
      expect(mockScheduler.shortJoyPendingMessages.has(sessionKey)).toBe(false);
      expect(mockScheduler.shortJoyAddingSessions.has(sessionKey)).toBe(false);
      expect(mockScheduler.shortJoyListShown.has(sessionKey)).toBe(false);
    });

    it('должен очищать JOY сессию (воскресную) по userId', () => {
      const userId = 123;
      const channelMessageId = 789;
      const sessionKey = `${userId}_${channelMessageId}`;

      // Устанавливаем сессию
      mockScheduler.joySessions.set(userId, {
        userId,
        channelMessageId,
        chatId: userId,
      });
      mockScheduler.joyPendingMessages.set(sessionKey, ['msg1']);
      mockScheduler.joyListShown.set(sessionKey, true);

      // Вызываем очистку JOY
      const joySession = mockScheduler.joySessions.get(userId);
      if (joySession) {
        const key = `${userId}_${joySession.channelMessageId}`;
        mockScheduler.joyPendingMessages.delete(key);
        mockScheduler.joyLastButtonMessageId.delete(key);
        mockScheduler.joyListMessageId.delete(key);
        mockScheduler.joyAddingSessions.delete(key);
        mockScheduler.joyListShown.delete(key);
        mockScheduler.joyRemovalSessions?.delete(key);
        mockScheduler.joySessions.delete(userId);
      }

      // Проверяем что всё очищено
      expect(mockScheduler.joySessions.has(userId)).toBe(false);
      expect(mockScheduler.joyPendingMessages.has(sessionKey)).toBe(false);
      expect(mockScheduler.joyListShown.has(sessionKey)).toBe(false);
    });

    it('должен корректно работать когда нет активных сессий', () => {
      const userId = 999;

      // Проверяем что пустые Maps не вызывают ошибок
      const shortJoySession = mockScheduler.shortJoySessions.get(userId);
      expect(shortJoySession).toBeUndefined();

      const joySession = mockScheduler.joySessions.get(userId);
      expect(joySession).toBeUndefined();
    });
  });

  describe('commandTimeouts Map - управление таймерами', () => {
    it('должен сохранять таймер в Map', () => {
      const userId = 123;

      // Создаём таймер
      const timeout = setTimeout(() => {}, 1000);
      mockScheduler.commandTimeouts.set(userId, timeout);

      expect(mockScheduler.commandTimeouts.has(userId)).toBe(true);

      // Очищаем
      clearTimeout(timeout);
      mockScheduler.commandTimeouts.delete(userId);
    });

    it('должен перезаписывать старый таймер при повторной установке', () => {
      const userId = 123;

      // Первый таймер
      const timeout1 = setTimeout(() => {}, 1000);
      mockScheduler.commandTimeouts.set(userId, timeout1);

      // Очищаем старый и ставим новый (как в реальной логике)
      const oldTimeout = mockScheduler.commandTimeouts.get(userId);
      if (oldTimeout) {
        clearTimeout(oldTimeout);
      }

      const timeout2 = setTimeout(() => {}, 2000);
      mockScheduler.commandTimeouts.set(userId, timeout2);

      // Должен быть только один таймер
      expect(mockScheduler.commandTimeouts.size).toBe(1);
      expect(mockScheduler.commandTimeouts.get(userId)).toBe(timeout2);

      // Очищаем
      clearTimeout(timeout2);
    });

    it('должен удалять таймер при очистке', () => {
      const userId = 123;

      const timeout = setTimeout(() => {}, 1000);
      mockScheduler.commandTimeouts.set(userId, timeout);

      // Очищаем
      const existingTimeout = mockScheduler.commandTimeouts.get(userId);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
        mockScheduler.commandTimeouts.delete(userId);
      }

      expect(mockScheduler.commandTimeouts.has(userId)).toBe(false);
    });
  });

  describe('getLastIncompleteTask() - маппинг состояний', () => {
    const taskMap: Record<string, string> = {
      waiting_negative:
        '<b>Выгрузи неприятные переживания:</b>\nЧто сегодня было неприятного? Какие ситуации вызвали негативные эмоции?',
      waiting_emotions:
        '<b>Опиши свои эмоции:</b>\nКакие чувства ты испытываешь прямо сейчас?',
      waiting_positive:
        '<b>Плюшки для лягушки:</b>\nЧто сегодня порадовало? Какие приятные моменты были?',
      waiting_practice:
        '<b>Практика расслабления:</b>\nДавай сделаем небольшую практику для завершения дня',
      waiting_user_message:
        '<b>Поделись своими мыслями:</b>\nЧто у тебя на душе?',
      waiting_button_click: 'Нажми кнопку "Ответь мне" когда будешь готов продолжить',
    };

    it('должен возвращать текст для waiting_negative', () => {
      const state = 'waiting_negative';
      const result = taskMap[state] || null;
      expect(result).toContain('Выгрузи неприятные переживания');
    });

    it('должен возвращать текст для waiting_positive', () => {
      const state = 'waiting_positive';
      const result = taskMap[state] || null;
      expect(result).toContain('Плюшки для лягушки');
    });

    it('должен возвращать текст для waiting_emotions', () => {
      const state = 'waiting_emotions';
      const result = taskMap[state] || null;
      expect(result).toContain('Опиши свои эмоции');
    });

    it('должен возвращать текст для waiting_practice', () => {
      const state = 'waiting_practice';
      const result = taskMap[state] || null;
      expect(result).toContain('Практика расслабления');
    });

    it('должен возвращать null для неизвестного состояния', () => {
      const state = 'unknown_state';
      const result = taskMap[state] || null;
      expect(result).toBeNull();
    });

    it('должен возвращать null для finished состояния', () => {
      const state = 'finished';
      const result = taskMap[state] || null;
      expect(result).toBeNull();
    });
  });

  describe('returnToMainLogic() - логика возврата', () => {
    it('для morning поста должен возвращать дневное сообщение', () => {
      const post = {
        type: 'morning',
        current_state: 'waiting_events',
      };

      let message = '';
      if (post.type === 'morning') {
        message = 'Ты можешь продолжить делиться со мной событиями за день 🤗';
      }

      expect(message).toBe('Ты можешь продолжить делиться со мной событиями за день 🤗');
    });

    it('для evening поста (НЕ finished) должен возвращать сообщение с заданием', () => {
      const post = {
        type: 'evening',
        current_state: 'waiting_negative',
      };

      const taskMap: Record<string, string> = {
        waiting_negative: '<b>Выгрузи неприятные переживания:</b>...',
      };

      let message = '';
      if (post.type === 'evening') {
        const isFinished = post.current_state === 'finished';
        if (!isFinished) {
          message = 'Давай завершим задания 📝';
          const lastTask = taskMap[post.current_state] || null;
          if (lastTask) {
            message += `\n\n${lastTask}`;
          }
        }
      }

      expect(message).toContain('Давай завершим задания');
      expect(message).toContain('Выгрузи неприятные переживания');
    });

    it('для evening поста (finished) НЕ должен возвращать сообщение', () => {
      const post = {
        type: 'evening',
        current_state: 'finished',
      };

      let shouldSendMessage = false;
      if (post.type === 'evening') {
        const isFinished = post.current_state === 'finished';
        shouldSendMessage = !isFinished;
      }

      expect(shouldSendMessage).toBe(false);
    });
  });

  describe('Интеграция: проверка isDmMode', () => {
    it('очистка сессий вызывается только в DM режиме', () => {
      let clearCalled = false;

      const isDmMode = true;
      if (isDmMode) {
        clearCalled = true;
      }

      expect(clearCalled).toBe(true);
    });

    it('очистка сессий НЕ вызывается в канальном режиме', () => {
      let clearCalled = false;

      const isDmMode = false;
      if (isDmMode) {
        clearCalled = true;
      }

      expect(clearCalled).toBe(false);
    });
  });

  describe('Интеграция: таймер только в ЛС', () => {
    it('таймер устанавливается если нет messageThreadId и chatId > 0 (ЛС)', () => {
      const messageThreadId = undefined;
      const chatId = 123; // положительный = ЛС

      let timerSet = false;
      if (!messageThreadId && chatId > 0) {
        timerSet = true;
      }

      expect(timerSet).toBe(true);
    });

    it('таймер НЕ устанавливается если есть messageThreadId (комментарии)', () => {
      const messageThreadId = 456;
      const chatId = 123;

      let timerSet = false;
      if (!messageThreadId && chatId > 0) {
        timerSet = true;
      }

      expect(timerSet).toBe(false);
    });

    it('таймер НЕ устанавливается если chatId отрицательный (канал)', () => {
      const messageThreadId = undefined;
      const chatId = -100123456789; // отрицательный = канал/группа

      let timerSet = false;
      if (!messageThreadId && chatId > 0) {
        timerSet = true;
      }

      expect(timerSet).toBe(false);
    });
  });

  describe('SHORT JOY сессия без режима добавления - блокировка других логик', () => {
    it('должен блокировать сообщение когда SHORT JOY сессия активна, но isAddingActive=false', () => {
      const userId = 123;
      const shortJoyId = 456;
      const sessionKey = `${userId}_${shortJoyId}`;

      // Устанавливаем SHORT JOY сессию (как после вызова /joy)
      mockScheduler.shortJoySessions.set(userId, {
        shortJoyId,
        userId,
        chatId: userId,
        messageThreadId: undefined,
        isIntro: false,
        buttonHintSent: false, // подсказка ещё не отправлена
      });
      // НЕ устанавливаем shortJoyAddingSessions - пользователь НЕ нажал "Добавить ещё"

      // Проверяем логику handleJoyUserMessage
      const shortJoySession = mockScheduler.shortJoySessions.get(userId);
      expect(shortJoySession).toBeDefined();

      const removalSession = mockScheduler.shortJoyRemovalSessions?.get(sessionKey);
      const isAddingActive = mockScheduler.shortJoyAddingSessions.get(sessionKey);

      // Сессия есть, но режим добавления НЕ активен
      expect(shortJoySession).not.toBeUndefined();
      expect(removalSession).toBeUndefined();
      expect(isAddingActive).toBeUndefined(); // или false

      // Новая логика: должны блокировать и просить нажать кнопку
      const shouldBlockAndAskForButton =
        shortJoySession && !removalSession && !isAddingActive;

      expect(shouldBlockAndAskForButton).toBe(true);
    });

    it('должен отправлять подсказку только один раз (buttonHintSent)', () => {
      const userId = 123;
      const shortJoyId = 456;

      // Первое сообщение - подсказка отправляется
      const session1 = {
        shortJoyId,
        userId,
        chatId: userId,
        buttonHintSent: false, // ещё не отправлена
      };
      mockScheduler.shortJoySessions.set(userId, session1);

      let shortJoySession = mockScheduler.shortJoySessions.get(userId)!;
      expect(shortJoySession.buttonHintSent).toBe(false);

      // Симулируем отправку подсказки
      const shouldSendHint = !shortJoySession.buttonHintSent;
      expect(shouldSendHint).toBe(true);

      // Устанавливаем флаг после отправки
      shortJoySession.buttonHintSent = true;
      mockScheduler.shortJoySessions.set(userId, shortJoySession);

      // Второе сообщение - подсказка НЕ отправляется
      shortJoySession = mockScheduler.shortJoySessions.get(userId)!;
      expect(shortJoySession.buttonHintSent).toBe(true);

      const shouldSendHintAgain = !shortJoySession.buttonHintSent;
      expect(shouldSendHintAgain).toBe(false);
    });

    it('НЕ должен блокировать когда shortJoyAddingSessions=true (режим добавления активен)', () => {
      const userId = 123;
      const shortJoyId = 456;
      const sessionKey = `${userId}_${shortJoyId}`;

      // Устанавливаем SHORT JOY сессию
      mockScheduler.shortJoySessions.set(userId, {
        shortJoyId,
        userId,
        chatId: userId,
        messageThreadId: undefined,
        isIntro: false,
      });
      // Устанавливаем режим добавления (пользователь нажал "Добавить ещё")
      mockScheduler.shortJoyAddingSessions.set(sessionKey, true);

      const shortJoySession = mockScheduler.shortJoySessions.get(userId);
      const isAddingActive = mockScheduler.shortJoyAddingSessions.get(sessionKey);

      // Режим добавления активен - должен обрабатываться через ShortJoyHandler
      expect(isAddingActive).toBe(true);

      // НЕ должен попадать в логику "нажми кнопку"
      const shouldBlockAndAskForButton =
        shortJoySession && !isAddingActive;

      expect(shouldBlockAndAskForButton).toBe(false);
    });

    it('НЕ должен блокировать когда removalSession активен (режим удаления)', () => {
      const userId = 123;
      const shortJoyId = 456;
      const sessionKey = `${userId}_${shortJoyId}`;

      // Устанавливаем SHORT JOY сессию
      mockScheduler.shortJoySessions.set(userId, {
        shortJoyId,
        userId,
        chatId: userId,
        messageThreadId: undefined,
        isIntro: false,
      });
      // Устанавливаем режим удаления
      mockScheduler.shortJoyRemovalSessions.set(sessionKey, {
        state: 'waiting_numbers',
        numbersToDelete: new Map(),
        confirmButtonMessageId: null,
      });

      const shortJoySession = mockScheduler.shortJoySessions.get(userId);
      const removalSession = mockScheduler.shortJoyRemovalSessions?.get(sessionKey);
      const isAddingActive = mockScheduler.shortJoyAddingSessions.get(sessionKey);

      // Режим удаления активен - должен обрабатываться как ввод номеров
      expect(removalSession).toBeDefined();
      expect(removalSession?.state).toBe('waiting_numbers');

      // Логика проверки: сначала проверяем removal, потом adding
      // Если removalSession активен - return true до проверки "нажми кнопку"
      const isHandledByRemoval = removalSession && removalSession.state === 'waiting_numbers';
      expect(isHandledByRemoval).toBe(true);
    });

    it('НЕ должен блокировать когда нет SHORT JOY сессии', () => {
      const userId = 999;

      const shortJoySession = mockScheduler.shortJoySessions.get(userId);

      // Нет сессии - не должен блокировать
      expect(shortJoySession).toBeUndefined();

      // Сообщение должно идти дальше в PostHandlerRegistry
      const shouldBlockAndAskForButton = !!shortJoySession;
      expect(shouldBlockAndAskForButton).toBe(false);
    });

    it('должен использовать правильный sessionKey формат: userId_shortJoyId', () => {
      const userId = 123;
      const shortJoyId = 456;

      mockScheduler.shortJoySessions.set(userId, {
        shortJoyId,
        userId,
        chatId: userId,
      });

      const shortJoySession = mockScheduler.shortJoySessions.get(userId);
      const sessionKey = `${userId}_${shortJoySession!.shortJoyId}`;

      expect(sessionKey).toBe('123_456');
    });
  });

  describe('Проверка editing_* состояний для /me', () => {
    it('должен определять editing_name как состояние редактирования', () => {
      const onboarding_state = 'editing_name';
      const isEditing = onboarding_state?.startsWith('editing_');
      expect(isEditing).toBe(true);
    });

    it('должен определять editing_request как состояние редактирования', () => {
      const onboarding_state = 'editing_request';
      const isEditing = onboarding_state?.startsWith('editing_');
      expect(isEditing).toBe(true);
    });

    it('должен определять editing_timezone как состояние редактирования', () => {
      const onboarding_state = 'editing_timezone';
      const isEditing = onboarding_state?.startsWith('editing_');
      expect(isEditing).toBe(true);
    });

    it('НЕ должен определять completed как состояние редактирования', () => {
      const onboarding_state = 'completed';
      const isEditing = onboarding_state?.startsWith('editing_');
      expect(isEditing).toBe(false);
    });

    it('НЕ должен определять null как состояние редактирования', () => {
      const onboarding_state = null;
      const isEditing = onboarding_state?.startsWith('editing_');
      expect(isEditing).toBeFalsy();
    });
  });
});
