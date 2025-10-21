import { Telegraf, Markup } from 'telegraf';
import { botLogger } from './logger';
import { addJoySource, getAllJoySources } from './db';
import { sendWithRetry } from './utils/telegram-retry';
import { generateMessage } from './llm';

/**
 * JoyHandler - обработчик интерактивной логики "Источники радости и энергии"
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
export class JoyHandler {
  private bot: Telegraf;
  private chatId: number; // ID чата для отправки сообщений (комментарии к посту)
  private userId: number; // ID пользователя для БД
  private channelMessageId: number; // ID сообщения в канале (для отслеживания контекста)

  // Хранилище для накопленных сообщений пользователя (перед сохранением)
  // ВАЖНО: Теперь передаются из Scheduler, чтобы сохранять между вызовами
  private pendingMessages: Map<string, string[]>;
  // ID последнего скользящего сообщения с кнопкой "Добавить 🔥"
  // ВАЖНО: Теперь передаются из Scheduler, чтобы сохранять между вызовами
  private lastButtonMessageId: Map<string, number>;

  constructor(
    bot: Telegraf,
    chatId: number,
    userId: number,
    channelMessageId: number,
    pendingMessages: Map<string, string[]>,
    lastButtonMessageId: Map<string, number>
  ) {
    this.bot = bot;
    this.chatId = chatId;
    this.userId = userId;
    this.channelMessageId = channelMessageId;
    this.pendingMessages = pendingMessages;
    this.lastButtonMessageId = lastButtonMessageId;
  }

  /**
   * Универсальный метод отправки сообщений с retry
   * Использует reply_parameters для автоматического определения треда
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

          // Используем reply_parameters - Telegram сам определит правильный тред
          if (replyToMessageId) {
            sendOptions.reply_parameters = { message_id: replyToMessageId };
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
        { error, chatId: this.chatId, replyToMessageId },
        'Ошибка отправки сообщения в JoyHandler'
      );
      throw error;
    }
  }

  /**
   * Запуск интерактивной сессии - отправка первого сообщения в комментарии
   */
  async startInteractiveSession(replyToMessageId: number) {
    try {
      const text = 'Теперь подумай и напиши:\n\n<b>Что тебя радует и дает энергию? ❤️‍🔥</b>';

      const result = await this.sendMessage(text, replyToMessageId, {
        parse_mode: 'HTML'
      });

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
      // Получаем ключ для хранения сообщений этой сессии
      const sessionKey = `${this.userId}_${this.channelMessageId}`;

      // Добавляем сообщение к накопленным
      const messages = this.pendingMessages.get(sessionKey) || [];
      messages.push(userMessage);
      this.pendingMessages.set(sessionKey, messages);

      botLogger.info(
        { userId: this.userId, messagesCount: messages.length },
        'Добавлено сообщение в накопитель'
      );

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

      // Отправляем новое скользящее сообщение с кнопкой
      const buttonText = 'Когда перечислишь все - нажми кнопку ниже';
      const result = await this.sendMessage(
        buttonText,
        userMessageId,
        Markup.inlineKeyboard([
          [Markup.button.callback('Добавить 🔥', `joy_add_${this.channelMessageId}`)]
        ])
      );

      // Сохраняем ID скользящего сообщения
      if (result && result.message_id) {
        this.lastButtonMessageId.set(sessionKey, result.message_id);
      }

      return result;
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
  async saveJoySources(replyToMessageId?: number) {
    try {
      const sessionKey = `${this.userId}_${this.channelMessageId}`;
      const messages = this.pendingMessages.get(sessionKey) || [];

      if (messages.length === 0) {
        await this.sendMessage(
          'Ты еще ничего не написал 🤔\nНапиши, что тебя радует!',
          replyToMessageId
        );
        return;
      }

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
1. Исправь грамматические и орфографические ошибки в новых источниках
2. Убери дубликаты:
   - Если новый источник по смыслу совпадает с уже существующим - НЕ добавляй его
   - Если новый источник повторяется несколько раз - оставь только один
3. Сохрани краткость и естественность формулировок

ФОРМАТ ОТВЕТА - строго JSON массив:
["исправленный источник 1", "исправленный источник 2"]

Если все новые источники - дубликаты существующих, верни: []

ВЕРНИ ТОЛЬКО JSON, без объяснений.`;

      let uniqueSources: string[] = [];
      try {
        const llmResponse = await generateMessage(prompt);

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

      botLogger.info(
        { userId: this.userId, newCount: messages.length, savedCount: uniqueSources.length },
        'Сохранены источники радости (после фильтрации дубликатов)'
      );

      // Очищаем накопленные сообщения
      this.pendingMessages.delete(sessionKey);

      // НЕ удаляем скользящее сообщение при нажатии "Добавить" - оно должно остаться!
      // Просто очищаем ссылку на него
      this.lastButtonMessageId.delete(sessionKey);

      // Показываем только меню (список показывается по кнопке "Посмотреть")
      await this.showMenu(replyToMessageId);

    } catch (error) {
      botLogger.error(
        { error, userId: this.userId },
        'Ошибка сохранения источников радости'
      );
      throw error;
    }
  }

  /**
   * Показа��ь список всех источников радости
   */
  async showJoyList(replyToMessageId?: number) {
    try {
      const sources = getAllJoySources(this.userId);

      if (sources.length === 0) {
        await this.sendMessage(
          'Твой список пока пуст 🤷\nНапиши, что тебя радует!',
          replyToMessageId
        );
        return;
      }

      // Формируем список
      let listText = '<b>Мои источники радости и энергии 🤩</b>\n\n';
      sources.forEach((source) => {
        listText += `⚡️ ${source.text}\n`;
      });

      await this.sendMessage(listText, replyToMessageId, {
        parse_mode: 'HTML'
      });

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
  async showMenu(replyToMessageId?: number) {
    try {
      const menuText = 'Ты можешь пополнять и просматривать свой список из меню или написав команду /joy';

      await this.sendMessage(
        menuText,
        replyToMessageId,
        Markup.inlineKeyboard([
          [Markup.button.callback('Добавить еще ⚡️', `joy_add_more_${this.channelMessageId}`)],
          [Markup.button.callback('Посмотреть', `joy_view_${this.channelMessageId}`)]
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
  async startAddMoreSession(replyToMessageId?: number) {
    try {
      const text = 'Напиши, что еще хочешь добавить';

      await this.sendMessage(text, replyToMessageId);

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
    const messages = this.pendingMessages.get(sessionKey) || [];
    return messages.length > 0;
  }
}
