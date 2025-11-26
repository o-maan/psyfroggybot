import { Telegraf, Markup } from 'telegraf';
import { botLogger } from './logger';
import { addJoySource, getAllJoySources } from './db';
import { sendWithRetry } from './utils/telegram-retry';
import { generateMessage } from './llm';

/**
 * ShortJoyHandler - обработчик SHORT JOY логики интерактивной логики "Источники радости и энергии"
 *
 * Логика работы:
 * 1. Пользователь вызывает /joy
 * 2. Бот публикует пост в канал с приглашением
 * 3. В комментариях к посту бот просит перечислить источники радости
 * 4. Пользователь пишет текст
 * 5. Бот показывает скользящее сообщение "Когда перечислишь все - нажми кнопку ниже" + кнопка "Добавить 🔥"
 * 6. При нажатии - сохраняем все сообщения пользователя и показываем список
 * 7. Показываем кнопки "Добавить еще ⚡️" и "Посмотреть"
 */
export class ShortJoyHandler {
  private bot: Telegraf;
  private chatId: number; // ID чата для отправки сообщений (комментарии к посту)
  private userId: number; // ID пользователя для БД
  private channelMessageId: number; // ID сообщения в канале (для отслеживания контекста)
  private threadId?: number; // ID треда комментариев (forwardedMessageId)

  // Хранилище для накопленных сообщений пользователя (перед сохранением)
  // ВАЖНО: Теперь передаются из Scheduler, чтобы сохранять между вызовами
  // Формат: Map<sessionKey, Map<messageId, text>> для поддержки редактирования
  private pendingMessages: Map<string, Map<number, string>>;
  // ID последнего скользящего сообщения с кнопкой "Добавить 🔥"
  // ВАЖНО: Теперь передаются из Scheduler, чтобы сохранять между вызовами
  private lastButtonMessageId: Map<string, number>;
  // ID сообщения со списком радости (НЕ скользящее, постоянное)
  // ВАЖНО: Теперь передаются из Scheduler, чтобы сохранять между вызовами
  private listMessageId: Map<string, number>;
  // Флаг активной сессии добавления источников радости
  // ВАЖНО: Теперь передаются из Scheduler, чтобы сохранять между вызовами
  private addingSessions: Map<string, boolean>;
  // Флаг показа списка радости (для отслеживания момента после показа списка)
  // ВАЖНО: Теперь передаются из Scheduler, чтобы сохранять между вызовами
  private listShown: Map<string, boolean>;

  constructor(
    bot: Telegraf,
    chatId: number,
    userId: number,
    channelMessageId: number,
    pendingMessages: Map<string, Map<number, string>>,
    lastButtonMessageId: Map<string, number>,
    listMessageId: Map<string, number>,
    addingSessions: Map<string, boolean>,
    listShown: Map<string, boolean>,
    threadId?: number
  ) {
    this.bot = bot;
    this.chatId = chatId;
    this.userId = userId;
    this.channelMessageId = channelMessageId;
    this.threadId = threadId;
    this.pendingMessages = pendingMessages;
    this.lastButtonMessageId = lastButtonMessageId;
    this.listMessageId = listMessageId;
    this.addingSessions = addingSessions;
    this.listShown = listShown;
  }

  /**
   * Универсальный метод отправки сообщений с retry
   * ВСЕГДА отправка БЕЗ reply (через reply_to_message_id на первое сообщение треда)
   * replyToMessageId больше НЕ используется - параметр оставлен для совместимости
   */
  private async sendMessage(
    text: string,
    replyToMessageId?: number,
    extra?: any
  ) {
    try {
      return await sendWithRetry(
        async () => {
          const sendOptions: any = { ...extra };

          // ВСЕГДА отправляем БЕЗ визуального reply, используя threadId
          if (this.threadId) {
            sendOptions.reply_to_message_id = this.threadId;
          }

          return await this.bot.telegram.sendMessage(this.chatId, text, sendOptions);
        },
        {
          chatId: this.chatId,
          messageType: 'joy_message',
          userId: this.userId
        },
        {
          maxAttempts: 5,
          intervalMs: 3000
        }
      );
    } catch (error) {
      botLogger.error(
        { error, chatId: this.chatId, replyToMessageId, threadId: this.threadId },
        'Ошибка отправки сообщения в JoyHandler'
      );
      throw error;
    }
  }

  /**
   * Запуск интерактивной сессии - отправка первого сообщения в комментарии
   */
  async startInteractiveSession() {
    try {
      const text = 'Теперь подумай и напиши:\n\n<b>Что тебя радует и дает энергию? ❤️‍🔥</b>';

      const result = await this.sendMessage(text, undefined, {
        parse_mode: 'HTML'
      });

      // Устанавливаем флаг активной сессии добавления
      const sessionKey = `${this.userId}_${this.channelMessageId}`;
      this.addingSessions.set(sessionKey, true);

      botLogger.info(
        { chatId: this.chatId, channelMessageId: this.channelMessageId },
        'Запущена интерактивная сессия списка радости'
      );

      return result;
    } catch (error) {
      botLogger.error(
        { error, chatId: this.chatId },
        'Ошибка запуска интерактивной сессии списка радости'
      );
      throw error;
    }
  }

  /**
   * Обработка сообщения от пользователя
   * Накапливаем сообщения и показываем скользящую кнопку
   */
  async handleUserMessage(userMessage: string, userMessageId: number) {
    try {
      // СНАЧАЛА проверяем на спам/грубость
      const { checkRudeMessage, resetKeyboardSpamCounter } = await import('./utils/rude-filter');
      const rudeCheck = await checkRudeMessage(userMessage, this.userId);

      if (rudeCheck.isRude && rudeCheck.response) {
        // Отправляем предупреждение о спаме
        await this.sendMessage(rudeCheck.response, userMessageId);

        // Сбрасываем счетчик если это был просто спам
        if (!rudeCheck.needsCounter) {
          resetKeyboardSpamCounter(this.userId);
        }

        return; // Прекращаем обработку
      }

      // Сбрасываем счетчик спама при нормальном сообщении
      resetKeyboardSpamCounter(this.userId);

      // СОХРАНЯЕМ сообщение пользователя в БД
      const { saveMessage } = await import('./db');
      saveMessage(this.chatId, userMessage, new Date().toISOString(), this.userId, userMessageId, this.chatId);

      // Получаем ключ для хранения сообщений этой сессии
      const sessionKey = `${this.userId}_${this.channelMessageId}`;

      // Проверяем, есть ли активная сессия добавления
      const isAddingSession = this.addingSessions.get(sessionKey) || false;
      // Проверяем, был ли показан список
      const wasListShown = this.listShown.get(sessionKey) || false;

      if (isAddingSession) {
        // АКТИВНАЯ СЕССИЯ ДОБАВЛЕНИЯ

        // Ставим реакцию 👀 на сообщение пользователя
        try {
          await this.bot.telegram.setMessageReaction(
            this.chatId,
            userMessageId,
            [{ type: 'emoji', emoji: '👀' }]
          );
        } catch (error) {
          botLogger.warn(
            { error, messageId: userMessageId },
            'Не удалось поставить реакцию на сообщение'
          );
        }

        // Удаляем предыдущее скользящее сообщение если оно есть
        const lastButtonId = this.lastButtonMessageId.get(sessionKey);
        if (lastButtonId) {
          try {
            await this.bot.telegram.deleteMessage(this.chatId, lastButtonId);
          } catch (error) {
            botLogger.warn(
              { error, messageId: lastButtonId },
              'Не удалось удалить предыдущее скользящее сообщение'
            );
          }
        }

        // Добавляем/обновляем сообщение к накопленным (Map поддерживает редактирование)
        const messages = this.pendingMessages.get(sessionKey) || new Map<number, string>();
        messages.set(userMessageId, userMessage);
        this.pendingMessages.set(sessionKey, messages);

        botLogger.info(
          { userId: this.userId, messagesCount: messages.size },
          'Добавлено сообщение в накопитель'
        );

        // Отправляем новое скользящее сообщение с кнопкой "Добавить 🔥"
        // Это системное сообщение - отправляем БЕЗ reply (просто в тред)
        const buttonText = 'Когда перечислишь все - нажми кнопку ниже';
        const result = await this.sendMessage(
          buttonText,
          undefined, // БЕЗ reply - просто продолжение диалога
          Markup.inlineKeyboard([
            [Markup.button.callback('Добавить 🔥', `short_joy_add_${this.channelMessageId}`)]
          ])
        );

        // Сохраняем ID скользящего сообщения
        if (result && result.message_id) {
          this.lastButtonMessageId.set(sessionKey, result.message_id);
        }

        return result;
      } else if (wasListShown) {
        // ПОСЛЕ ПОКАЗА СПИСКА - пользователь написал сообщение
        // Удаляем кнопки под списком (список с кнопками - это одно сообщение)
        const lastButtonId = this.lastButtonMessageId.get(sessionKey);
        if (lastButtonId) {
          try {
            await this.bot.telegram.deleteMessage(this.chatId, lastButtonId);
          } catch (error) {
            botLogger.warn(
              { error, messageId: lastButtonId },
              'Не удалось удалить список с кнопками'
            );
          }
        }

        // Показываем меню с опциями
        // Это системное сообщение - отправляем БЕЗ reply (просто в тред)
        const menuText = 'Что хочешь сделать?';
        const result = await this.sendMessage(
          menuText,
          undefined, // БЕЗ reply - просто продолжение диалога
          Markup.inlineKeyboard([
            [Markup.button.callback('Добавить еще ⚡️', `short_joy_add_more_${this.channelMessageId}`)],
            [Markup.button.callback('Посмотреть список 📝', `short_joy_view_${this.channelMessageId}`)],
            [Markup.button.callback('Завершить', `short_joy_finish_${this.channelMessageId}`)]
          ])
        );

        // Сохраняем ID скользящего сообщения
        if (result && result.message_id) {
          this.lastButtonMessageId.set(sessionKey, result.message_id);
        }

        // Сбрасываем флаг показа списка
        this.listShown.delete(sessionKey);

        return result;
      } else {
        // ВО ВСЕХ ОСТАЛЬНЫХ СЛУЧАЯХ - работаем как обычно (накапливаем + показываем "Добавить 🔥")
        // Удаляем предыдущее скользящее сообщение если оно есть
        const lastButtonId = this.lastButtonMessageId.get(sessionKey);
        if (lastButtonId) {
          try {
            await this.bot.telegram.deleteMessage(this.chatId, lastButtonId);
          } catch (error) {
            botLogger.warn(
              { error, messageId: lastButtonId },
              'Не удалось удалить предыдущее скользящее сообщение'
            );
          }
        }

        // Добавляем/обновляем сообщение к накопленным (Map поддерживает редактирование)
        const messages = this.pendingMessages.get(sessionKey) || new Map<number, string>();
        messages.set(userMessageId, userMessage);
        this.pendingMessages.set(sessionKey, messages);

        botLogger.info(
          { userId: this.userId, messagesCount: messages.size },
          'Добавлено сообщение в накопитель (обычный режим)'
        );

        // Отправляем новое скользящее сообщение с кнопкой "Добавить 🔥"
        // Это системное сообщение - отправляем БЕЗ reply (просто в тред)
        const buttonText = 'Когда перечислишь все - нажми кнопку ниже';
        const result = await this.sendMessage(
          buttonText,
          undefined, // БЕЗ reply - просто продолжение диалога
          Markup.inlineKeyboard([
            [Markup.button.callback('Добавить 🔥', `short_joy_add_${this.channelMessageId}`)]
          ])
        );

        // Сохраняем ID скользящего сообщения
        if (result && result.message_id) {
          this.lastButtonMessageId.set(sessionKey, result.message_id);
        }

        return result;
      }
    } catch (error) {
      botLogger.error(
        { error, userId: this.userId },
        'Ошибка обработки сообщения пользователя в JoyHandler'
      );
      throw error;
    }
  }

  /**
   * Сохранение накопленных источников радости в БД
   */
  async saveJoySources() {
    try {
      const sessionKey = `${this.userId}_${this.channelMessageId}`;
      const messagesMap = this.pendingMessages.get(sessionKey) || new Map<number, string>();
      const messages = Array.from(messagesMap.values());

      if (messages.length === 0) {
        await this.sendMessage(
          'Ты еще ничего не написал 🤔\nНапиши, что тебя радует!',
          undefined
        );
        return;
      }

      // Показываем пользователю, что начали обработку
      await this.sendMessage(
        'Froggy собирает твои ответы...',
        undefined
      );

      // Получаем существующие источники радости
      const existingSources = getAllJoySources(this.userId);
      const existingTexts = existingSources.map(s => s.text.toLowerCase());

      // Отправляем в LLM для исправления ошибок и фильтрации дубликатов
      const prompt = `Задача: обработать новые источники радости пользователя.

СУЩЕСТВУЮЩИЙ СПИСОК (уже сохранен):
${existingSources.length > 0 ? existingSources.map((s, i) => `${i + 1}. ${s.text}`).join('\n') : 'Список пуст'}

НОВЫЕ ИСТОЧНИКИ (от пользователя):
${messages.map((m, i) => `${i + 1}. ${m}`).join('\n')}

ИНСТРУКЦИИ:
1. НЕ МЕНЯЙ формулировки пользователя! Сохраняй авторский стиль и слова как есть.
2. Исправляй ТОЛЬКО орфографические ошибки и опечатки в словах (например: "котикок" → "котиков")
3. НЕ заменяй слова синонимами (например: "мимишить" НЕ заменять на "тискать")
4. ВСЕ пункты списка должны начинаться с МАЛЕНЬКОЙ буквы (например: "печеньки", а не "Печеньки")
5. Разделяй перечисления через запятую на отдельные пункты, ЕСЛИ это разные независимые активности:
   ✅ "играть на пианино, петь, рисовать и танцевать" → ["играть на пианино", "петь", "рисовать", "танцевать"]
   ✅ "котики, собачки, хомячки" → ["котики", "собачки", "хомячки"]
   ❌ НО если активности связаны и образуют единое действие - оставь одним пунктом:
   "играть на пианино и петь" → ["играть на пианино и петь"] (это одно совместное действие)
   "читать книгу с чаем" → ["читать книгу с чаем"] (чай дополняет чтение)
6. Убери дубликаты:
   - Если новый источник по смыслу совпадает с уже существующим - НЕ добавляй его
   - Если новый источник повторяется несколько раз - оставь только один

ФОРМАТ ОТВЕТА - строго JSON массив:
["исправленный источник 1", "исправленный источник 2"]

Если все новые источники - дубликаты существующих, верни: []

ВЕРНИ ТОЛЬКО JSON, без объяснений.`;

      let uniqueSources: string[] = [];
      try {
        // Увеличиваем таймаут до 3 минут для LLM (DeepSeek может быть медленным)
        const llmPromise = generateMessage(prompt);
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('LLM timeout после 180 секунд')), 180000)
        );
        const llmResponse = await Promise.race([llmPromise, timeoutPromise]) as string;

        // Парсим JSON ответ
        const jsonMatch = llmResponse.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          uniqueSources = JSON.parse(jsonMatch[0]);
        } else {
          botLogger.warn({ llmResponse }, 'LLM не вернул JSON, сохраняем как есть');
          // Фильтруем дубликаты вручную
          uniqueSources = messages.filter(msg =>
            !existingTexts.includes(msg.toLowerCase())
          );
        }
      } catch (error) {
        botLogger.error({ error }, 'Ошибка обработки через LLM, сохраняем как есть');
        // Фильтруем дубликаты вручную
        uniqueSources = messages.filter(msg =>
          !existingTexts.includes(msg.toLowerCase())
        );
      }

      // Сохраняем только уникальные источники
      for (const source of uniqueSources) {
        addJoySource(this.userId, source, 'manual');
      }

      // Обновляем checkpoint (время последнего изменения списка радости)
      if (uniqueSources.length > 0) {
        const { updateJoyCheckpoint } = await import('./db');
        updateJoyCheckpoint(this.userId, new Date().toISOString());
        botLogger.info({ userId: this.userId }, '🔄 Checkpoint списка радости обновлен');
      }

      botLogger.info(
        { userId: this.userId, newCount: messages.length, savedCount: uniqueSources.length },
        'Сохранены источники радости (после фильтрации дубликатов)'
      );

      // Очищаем накопленные сообщения
      this.pendingMessages.delete(sessionKey);

      // НЕ удаляем скользящее сообщение при нажатии "Добавить" - оно должно остаться!
      // Просто очищаем ссылку на него
      this.lastButtonMessageId.delete(sessionKey);

      // Сбрасываем флаг активной сессии добавления
      this.addingSessions.delete(sessionKey);

      // Показываем только меню (список показывается по кнопке "Посмотреть")
      await this.showMenu();

    } catch (error) {
      botLogger.error(
        { error, userId: this.userId },
        'Ошибка сохранения источников радости'
      );
      throw error;
    }
  }

  /**
   * Показать список всех источников радости 📋
   */
  async showJoyList() {
    try {
      const sources = getAllJoySources(this.userId);

      if (sources.length === 0) {
        const emptyText = `Твой список пуст 🙀
Давай это исправим!

Напиши, что вызывает у тебя приятные эмоции? И что наполняет?`;

        await this.sendMessage(emptyText, undefined, {
          ...Markup.inlineKeyboard([
            [Markup.button.callback('Завершить', `short_joy_finish_${this.channelMessageId}`)]
          ])
        });
        return;
      }

      // Формируем список с нумерацией и интервалами для читаемости
      let listText = '<b>Мои источники радости и энергии 🤩</b>\n\n';

      // Добавляем пустые строки каждые 3 пункта (если ≥ 5 пунктов)
      if (sources.length >= 5) {
        for (let i = 0; i < sources.length; i++) {
          listText += `${i + 1} ⚡️ ${sources[i].text}\n`;

          // Добавляем пробел после каждого 3-го, но только если осталось минимум 2 пункта
          if ((i + 1) % 3 === 0 && sources.length - (i + 1) >= 2) {
            listText += '\n';
          }
        }
      } else {
        // Для коротких списков - без интервалов
        sources.forEach((source, index) => {
          listText += `${index + 1} ⚡️ ${source.text}\n`;
        });
      }

      // Отправляем список с кнопками
      const sessionKey = `${this.userId}_${this.channelMessageId}`;
      const result = await this.sendMessage(
        listText,
        undefined,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('Добавить еще ⚡️', `short_joy_add_more_${this.channelMessageId}`)],
            [Markup.button.callback('Убрать лишнее 🙅🏻', `short_joy_remove_${this.channelMessageId}`)],
            [Markup.button.callback('Завершить', `short_joy_finish_${this.channelMessageId}`)]
          ])
        }
      );

      // Сохраняем ID сообщения со списком в отдельную Map (НЕ скользящее - постоянное)
      if (result && result.message_id) {
        this.listMessageId.set(sessionKey, result.message_id);
      }

      // Устанавливаем флаг показа списка
      this.listShown.set(sessionKey, true);

      botLogger.info(
        { userId: this.userId, count: sources.length },
        'Показан список источников радости'
      );
    } catch (error) {
      botLogger.error(
        { error, userId: this.userId },
        'Ошибка показа списка источников радости'
      );
      throw error;
    }
  }

  /**
   * Показать меню с кнопками "Добавить еще" и "Посмотреть"
   */
  async showMenu() {
    try {
      // Это системное сообщение - отправляем БЕЗ reply (просто в тред)
      const menuText = 'Ты можешь просматривать и пополнять свой список ⚡ из меню или написав команду /joy';

      await this.sendMessage(
        menuText,
        undefined, // БЕЗ reply - просто продолжение диалога
        Markup.inlineKeyboard([
          [Markup.button.callback('Добавить еще ⚡️', `short_joy_add_more_${this.channelMessageId}`)],
          [Markup.button.callback('Посмотреть список 📝', `short_joy_view_${this.channelMessageId}`)],
          [Markup.button.callback('Завершить', `short_joy_finish_${this.channelMessageId}`)]
        ])
      );
    } catch (error) {
      botLogger.error(
        { error, userId: this.userId },
        'Ошибка показа меню источников радости'
      );
      throw error;
    }
  }

  /**
   * Начать новую сессию добавления (при нажатии "Добавить еще")
   */
  async startAddMoreSession() {
    try {
      // Это системное сообщение - отправляем БЕЗ reply (просто в тред)
      const text = 'Напиши, что еще хочешь добавить ❤️‍🔥';

      await this.sendMessage(text, undefined); // БЕЗ reply - просто продолжение диалога

      // Устанавливаем флаг активной сессии добавления
      const sessionKey = `${this.userId}_${this.channelMessageId}`;
      this.addingSessions.set(sessionKey, true);
      // Сбрасываем флаг показа списка
      this.listShown.delete(sessionKey);

      botLogger.info(
        { userId: this.userId },
        'Начата новая сессия добавления источников радости'
      );
    } catch (error) {
      botLogger.error(
        { error, userId: this.userId },
        'Ошибка начала новой сессии добавления'
      );
      throw error;
    }
  }

  /**
   * Получить ID пользователя
   */
  getUserId(): number {
    return this.userId;
  }

  /**
   * Получить ID канального сообщения
   */
  getChannelMessageId(): number {
    return this.channelMessageId;
  }

  /**
   * Проверить, есть ли накопленные сообщения в текущей сессии
   */
  hasPendingMessages(): boolean {
    const sessionKey = `${this.userId}_${this.channelMessageId}`;
    const messages = this.pendingMessages.get(sessionKey);
    return messages ? messages.size > 0 : false;
  }
}
