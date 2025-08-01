import fs, { readFileSync } from 'fs';
import * as cron from 'node-cron';
import path from 'path';
import { Telegraf } from 'telegraf';
import { CalendarService, formatCalendarEvents, getUserTodayEvents } from './calendar';
import {
  addUser,
  clearUserTokens,
  getAllUsers,
  getLastBotMessage,
  getLastNBotMessages,
  getLastUserMessage,
  getUserByChatId,
  getUserImageIndex,
  getUserResponseStats,
  saveMessage,
  saveUserImageIndex,
} from './db';
import { generateFrogImage, generateFrogPrompt, generateMessage } from './llm';
import { botLogger, calendarLogger, databaseLogger, logger, schedulerLogger } from './logger';

// Функция экранирования для HTML (Telegram)
function escapeHTML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Функция удаления тегов <think>...</think> из ответа LLM
function removeThinkTags(text: string): string {
  // Ищем от начала строки до последнего вхождения </think>
  const lastThinkClose = text.lastIndexOf('</think>');
  if (lastThinkClose !== -1) {
    // Проверяем, есть ли открывающий тег <think> в начале
    if (text.trim().startsWith('<think>')) {
      // Удаляем всё от начала до конца последнего </think>
      return text.substring(lastThinkClose + 8).trim();
    }
  }
  return text;
}

export class Scheduler {
  private bot: Telegraf;
  private reminderTimeouts: Map<number, NodeJS.Timeout> = new Map();
  private users: Set<number> = new Set();
  private imageFiles: string[] = [];
  public readonly CHANNEL_ID = this.getChannelId();
  // private readonly REMINDER_USER_ID = 5153477378; // больше не используется, теперь динамически используем chatId
  private calendarService: CalendarService;
  private dailyCronJob: cron.ScheduledTask | null = null;
  private morningCheckCronJob: cron.ScheduledTask | null = null;
  private testModeCheckTimeout: NodeJS.Timeout | null = null;
  // Для хранения состояния интерактивных сессий
  private interactiveSessions: Map<number, {
    messageData: any;
    relaxationType: 'body' | 'breathing';
    currentStep: 'waiting_negative' | 'waiting_schema' | 'waiting_positive' | 'waiting_practice' | 'finished';
    startTime: string;
    messageId?: number;
    channelMessageId?: number; // ID поста в канале для использования как thread_id
    clarificationSent?: boolean;
    schemaRequested?: boolean;
    practiceCompleted?: boolean;
    practicePostponed?: boolean;
    postponedUntil?: number;
  }> = new Map();
  
  // Для хранения ID пересланных сообщений
  private forwardedMessages: Map<number, number> = new Map(); // channelMessageId -> discussionMessageId

  constructor(bot: Telegraf, calendarService: CalendarService) {
    this.bot = bot;
    this.calendarService = calendarService;
    this.loadImages();
    this.loadUsers();
    
    // Инициализируем расписание только для основного бота
    if (!this.isTestBot()) {
      this.initializeDailySchedule();
    } else {
      logger.info('🤖 Тестовый бот - автоматическое расписание отключено');
    }
  }

  // Геттер для получения сервиса календаря (для тестирования)
  getCalendarService(): CalendarService {
    return this.calendarService;
  }
  
  // Получить интерактивную сессию пользователя
  public getInteractiveSession(userId: number) {
    return this.interactiveSessions.get(userId);
  }
  
  // Удалить интерактивную сессию
  public deleteInteractiveSession(userId: number) {
    this.interactiveSessions.delete(userId);
  }
  
  // Получить экземпляр бота
  public getBot() {
    return this.bot;
  }
  
  // Генерация простого сообщения через LLM
  public async generateSimpleMessage(promptName: string, context: any): Promise<string> {
    try {
      const promptPath = path.join(__dirname, '..', 'assets', 'prompts', `${promptName}.md`);
      let prompt = readFileSync(promptPath, 'utf-8');
      
      // Заменяем плейсхолдеры в промпте
      if (context.userName) {
        prompt = prompt.replace(/\{\{userName\}\}/g, context.userName);
      }
      if (context.gender) {
        prompt = prompt.replace(/\{\{gender\}\}/g, context.gender);
      }
      
      // Добавляем явную инструкцию для модели
      prompt = `ВАЖНО: Ответь ТОЛЬКО текстом поздравления на русском языке, без дополнительных комментариев. Текст должен быть КОРОТКИМ - максимум 2 предложения, как в примерах!\n\n${prompt}\n\nНапиши КОРОТКОЕ поздравление (не более 15 слов):`;
      
      schedulerLogger.info({ promptName, promptLength: prompt.length }, 'Генерация простого сообщения');
      
      const response = await generateMessage(prompt);
      
      // Удаляем теги <think>...</think> из ответа
      const cleanedResponse = removeThinkTags(response);
      
      schedulerLogger.info({ 
        promptName, 
        responseLength: response.length,
        cleanedLength: cleanedResponse.length,
        response: cleanedResponse.substring(0, 100) 
      }, 'Ответ от LLM получен');
      
      // Если ответ слишком короткий, слишком длинный или это просто "Отлично", используем fallback
      if (cleanedResponse.length < 20 || cleanedResponse.length > 150 || cleanedResponse.toLowerCase() === 'отлично' || cleanedResponse === 'HF_JSON_ERROR') {
        throw new Error(`Неподходящий ответ от LLM: ${cleanedResponse.length} символов`);
      }
      
      return cleanedResponse;
    } catch (error) {
      schedulerLogger.error({ error, promptName }, 'Ошибка генерации простого сообщения');
      // Fallback сообщения
      if (promptName === 'practice-completed') {
        const fallbacks = [
          'Ты молодец! 🌟 Сегодня мы отлично поработали вместе.',
          'Отличная работа! 💚 Ты заботишься о себе, и это прекрасно.',
          'Супер! ✨ Каждая практика делает тебя сильнее.',
          'Великолепно! 🌈 Ты сделал важный шаг для своего благополучия.',
          'Ты справился! 🎯 На сегодня все задания выполнены.',
          'Ты молодец! 🌙 Пора отдыхать.',
          'Я горжусь тобой! 💫 Ты сделал отличную работу.',
          'Прекрасная работа! 🎉 Теперь можно расслабиться.',
          'Браво! 🌿 Все задания на сегодня завершены.',
          'Замечательно! ⭐ Ты проявил заботу о себе.'
        ];
        return fallbacks[Math.floor(Math.random() * fallbacks.length)];
      }
      return 'Отлично! 👍';
    }
  }
  
  // Сохранить ID пересланного сообщения
  saveForwardedMessage(channelMessageId: number, discussionMessageId: number) {
    this.forwardedMessages.set(channelMessageId, discussionMessageId);
    schedulerLogger.debug({ 
      channelMessageId, 
      discussionMessageId 
    }, 'Сохранен ID пересланного сообщения');
  }

  // Определяем ID канала в зависимости от окружения
  private getChannelId(): number {
    if (this.isTestBot()) {
      // Для тестового бота используем тестовый канал
      return -1002846400650;
    }
    return Number(process.env.CHANNEL_ID || -1002405993986);
  }

  // Проверяем, является ли текущий бот тестовым
  public isTestBot(): boolean {
    // Проверяем по переменной окружения NODE_ENV или по специальному флагу
    return process.env.NODE_ENV === 'test' || process.env.IS_TEST_BOT === 'true' || false;
  }
  
  // Получить ID группы обсуждений для текущего бота
  public getChatId(): number | null {
    if (this.isTestBot()) {
      // Для тестового бота используем тестовую группу
      return -1002798126153;
    }
    return process.env.CHAT_ID ? Number(process.env.CHAT_ID) : null;
  }
  
  // Получить ID целевого пользователя для проверки ответов
  public getTargetUserId(): number {
    if (this.isTestBot()) {
      // Для тестового бота используем тестового пользователя
      return 476561547; // Это должен быть ID пользователя, а не группы
    }
    return 5153477378; // Основной пользователь
  }

  // Загрузить список картинок при старте
  private loadImages() {
    const imagesDir = path.join(process.cwd(), 'images');
    const files = fs.readdirSync(imagesDir);
    this.imageFiles = files
      .filter(
        file =>
          file.toLowerCase().endsWith('.jpg') ||
          file.toLowerCase().endsWith('.jpeg') ||
          file.toLowerCase().endsWith('.png')
      )
      .map(file => path.join(imagesDir, file));

    logger.info({ imageCount: this.imageFiles.length }, `🖼️ Загружено ${this.imageFiles.length} картинок`);
  }

  // Загрузить пользователей из базы данных
  private loadUsers() {
    try {
      const users = getAllUsers();
      this.users.clear();
      for (const user of users) {
        this.users.add(user.chat_id);
      }
      logger.info({ usersCount: this.users.size }, `🚀 Загружено ${this.users.size} пользователей из базы`);
    } catch (e) {
      const error = e as Error;
      schedulerLogger.error({ error: error.message, stack: error.stack }, 'Ошибка загрузки пользователей');
    }
  }

  // Получить следующую картинку по кругу
  public getNextImage(chatId: number): string {
    const userImage = getUserImageIndex(chatId);
    let currentImageIndex = userImage ? userImage.image_index : 0;
    const image = this.imageFiles[currentImageIndex];
    // Убираем детальные логи картинок
    currentImageIndex = (currentImageIndex + 1) % this.imageFiles.length;
    saveUserImageIndex(chatId, currentImageIndex);
    return image;
  }

  // Добавить пользователя в список рассылки
  addUser(chatId: number) {
    this.users.add(chatId);
    // Также добавляем в базу данных (если ещё не добавлен)
    addUser(chatId, '');
    schedulerLogger.debug({ chatId }, 'Пользователь добавлен в планировщик');
  }

  // Определяем занятость пользователя через LLM анализ календаря
  private async detectUserBusy(events: any[]): Promise<{ probably_busy: boolean; busy_reason: string | null }> {
    try {
      const detectPrompt = readFileSync('assets/prompts/detect-busy.md', 'utf-8');

      // Формируем подробное описание событий
      let eventsDescription = '';
      if (events.length > 0) {
        eventsDescription = 'События в календаре сегодня:\n';
        events.forEach((event, index) => {
          eventsDescription += `${index + 1}. ${event.summary || 'Без названия'}\n`;

          // Добавляем время
          if (event.start) {
            const startDate = new Date(event.start.dateTime || event.start.date);
            const endDate = event.end ? new Date(event.end.dateTime || event.end.date) : null;

            if (event.start.date && !event.start.dateTime) {
              eventsDescription += `   - Весь день\n`;
            } else {
              eventsDescription += `   - Время: ${startDate.toLocaleTimeString('ru-RU', {
                hour: '2-digit',
                minute: '2-digit',
              })}`;
              if (endDate) {
                eventsDescription += ` - ${endDate.toLocaleTimeString('ru-RU', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}`;
              }
              eventsDescription += '\n';
            }
          }

          // Статус занятости
          if (event.transparency) {
            eventsDescription += `   - Статус: ${event.transparency === 'transparent' ? 'Свободен' : 'Занят'}\n`;
          }

          // Место
          if (event.location) {
            eventsDescription += `   - Место: ${event.location}\n`;
          }

          eventsDescription += '\n';
        });
      } else {
        eventsDescription = 'Нет событий в календаре';
      }

      const fullPrompt = detectPrompt + '\n\n' + eventsDescription;

      let response = await generateMessage(fullPrompt);

      if (response === 'HF_JSON_ERROR') {
        // По умолчанию считаем, что не занят
        return { probably_busy: false, busy_reason: null };
      }

      // Удаляем теги <think>...</think> из ответа
      response = removeThinkTags(response);

      try {
        const result = JSON.parse(response.replace(/```json|```/gi, '').trim());
        return {
          probably_busy: result.probably_busy || false,
          busy_reason: result.busy_reason || null,
        };
      } catch {
        // Если не удалось распарсить, считаем что не занят
        return { probably_busy: false, busy_reason: null };
      }
    } catch (error) {
      schedulerLogger.error({ error }, 'Ошибка определения занятости пользователя');
      return { probably_busy: false, busy_reason: null };
    }
  }

  // Вспомогательная функция для формирования сообщения по правилам
  private buildScheduledMessageFromHF(json: any): string {
    let n = 1;
    const parts: string[] = [];
    // Вдохновляющий текст
    parts.push(`<i>${escapeHTML(json.encouragement.text)}</i>`);

    // 1. Выгрузка неприятных переживаний (рандомно)
    const showNegative = Math.random() < 0.5;
    if (showNegative) {
      let block = `${n++}. <b>Выгрузка неприятных переживаний</b> (ситуация+эмоция)`;
      if (json.negative_part?.additional_text) {
        block += `\n<blockquote>${escapeHTML(json.negative_part.additional_text)}</blockquote>`;
      }
      parts.push(block);
    }

    // 2. Плюшки для лягушки (без пустой строки перед этим пунктом)
    let plushki = `${n++}. <b>Плюшки для лягушки</b> (ситуация+эмоция)`;
    if (json.positive_part?.additional_text) {
      plushki += `\n<blockquote>${escapeHTML(json.positive_part.additional_text)}</blockquote>`;
    }
    parts.push(plushki);

    // 3. Чувства и эмоции
    // let feels = `${n++}. Какие <b>чувства</b> и <b>эмоции</b> сегодня испытывал?`;
    // if (json.feels_and_emotions?.additional_text) {
    //   feels += `\n<blockquote>${escapeHTML(json.feels_and_emotions.additional_text)}</blockquote>`;
    // }
    // parts.push(feels);

    // 4. Рейтинг дня
    // parts.push(`${n++}. <b>Рейтинг дня</b>: от 1 до 10`);

    // 3. Расслабление тела или Дыхательная практика (рандомно)
    if (Math.random() < 0.5) {
      parts.push(`${n++}. <b>Расслабление тела</b>\nОт Ирины 👉🏻 clck.ru/3LmcNv 👈🏻 или свое`);
    } else {
      parts.push(`${n++}. <b>Дыхательная практика</b>`);
    }

    return parts.filter(Boolean).join('\n\n').trim();
  }

  // Новый метод для интерактивной генерации сообщения
  private buildInteractiveMessage(json: any): { 
    firstPart: string; 
    messageData: any;
    relaxationType: 'body' | 'breathing';
  } {
    // Удаляем теги <think>...</think>
    if (json.encouragement?.text) {
      json.encouragement.text = removeThinkTags(json.encouragement.text);
    }
    if (json.negative_part?.additional_text) {
      json.negative_part.additional_text = removeThinkTags(json.negative_part.additional_text);
    }
    if (json.positive_part?.additional_text) {
      json.positive_part.additional_text = removeThinkTags(json.positive_part.additional_text);
    }

    // Определяем что показывать
    const relaxationType = Math.random() < 0.5 ? 'body' : 'breathing';

    // Основной пост содержит только вдохновляющий текст
    const firstPart = `<i>${escapeHTML(json.encouragement.text)}</i>`;

    return {
      firstPart,
      messageData: json,
      relaxationType
    };
  }

  // Основная функция генерации сообщения для запланированной отправки
  public async generateScheduledMessage(chatId: number): Promise<string> {
    // Получаем данные пользователя, включая имя и пол
    const user = getUserByChatId(chatId);
    const userName = user?.name || null;
    const userGender = user?.gender || null;

    const userExists = await this.checkUserExists(chatId);
    if (!userExists) {
      databaseLogger.info({ chatId }, 'Пользователь не найден в базе, добавляем');
      addUser(chatId, '');
    }

    // Get events for the evening
    const now = new Date();
    const evening = new Date(now);
    evening.setHours(18, 0, 0, 0);
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);

    let events: any[] = [];
    let eventsStr = '';
    try {
      events = await this.calendarService.getEvents(evening.toISOString(), tomorrow.toISOString());
      if (events && events.length > 0) {
        eventsStr =
          '\n🗓️ События календаря:\n' +
          formatCalendarEvents(events, {
            locale: 'ru-RU',
            showDate: true,
            showBusy: true,
            showLocation: true,
            showDescription: true,
            showLink: true,
          });
        // Убираем детальное логирование
      }
    } catch (e) {
      const error = e as Error;
      calendarLogger.error({ error: error.message, stack: error.stack }, 'Ошибка получения событий календаря');
      events = [];
      eventsStr = '';
      clearUserTokens(chatId); // Очищаем токены пользователя
    }
    const dateTimeStr = now.toLocaleDateString('ru-RU', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    let previousMessagesBlock = '';

    const lastMsgs = getLastNBotMessages(chatId, 3);
    if (lastMsgs && lastMsgs.length > 0) {
      // Сообщения идут от новых к старым, надо развернуть для хронологии
      const ordered = lastMsgs.slice().reverse();
      previousMessagesBlock =
        '\n\nПоследние сообщения пользователю:' + ordered.map((m, i) => `\n${i + 1}. ${m.message_text}`).join('');
      // Убираем детальное логирование
    } else {
      // Не логируем, это не критично
    }

    // Определяем занятость пользователя через анализ календаря
    const busyStatus = await this.detectUserBusy(events || []);
    const promptPath = busyStatus.probably_busy
      ? 'assets/prompts/scheduled-message-flight.md'
      : 'assets/prompts/scheduled-message.md';

    // Добавляем логирование для отладки
    schedulerLogger.info(
      {
        chatId,
        probably_busy: busyStatus.probably_busy,
        busy_reason: busyStatus.busy_reason,
        promptPath,
        eventsCount: events?.length || 0,
      },
      `🔍 Выбор промпта: ${busyStatus.probably_busy ? 'BUSY' : 'NORMAL'}`
    );

    let promptBase = readFileSync(promptPath, 'utf-8');

    // Добавляем имя пользователя в промпт
    // Если имя не установлено, используем дефолтное значение
    const userNameToUse = userName || 'друг';
    promptBase = promptBase.replace(/\{userName\}/g, userNameToUse);

    // Добавляем пол пользователя в промпт
    const userGenderToUse = userGender || 'unknown';
    promptBase = promptBase.replace(/\{userGender\}/g, userGenderToUse);

    let prompt = promptBase + `\n\nСегодня: ${dateTimeStr}.` + eventsStr + previousMessagesBlock;
    if (busyStatus.probably_busy) {
      // Если пользователь занят — полностью генерируем текст через HF, ограничиваем 555 символами
      schedulerLogger.info(
        { chatId, busy_reason: busyStatus.busy_reason },
        '✈️ Пользователь занят, используем упрощенный промпт'
      );
      let text = await generateMessage(prompt);
      schedulerLogger.info({ chatId, textLength: text?.length || 0 }, `📝 LLM ответ получен: ${text}`);

      // Удаляем теги <think>...</think>
      text = removeThinkTags(text);

      if (text.length > 555) text = text.slice(0, 552) + '...';
      // --- Новая логика: пробуем парсить JSON и собираем только encouragement + flight ---
      let jsonText = text.replace(/```json|```/gi, '').trim();
      if (jsonText.startsWith('"') && jsonText.endsWith('"')) {
        jsonText = jsonText.slice(1, -1);
      }
      jsonText = jsonText.replace(/\\"/g, '"').replace(/\"/g, '"');
      let json: any;
      try {
        json = JSON.parse(jsonText);
        if (typeof json === 'string') {
          json = JSON.parse(json); // второй парс, если строка
        }
        if (json && typeof json === 'object' && json.encouragement && json.flight && json.flight.additional_task) {
          // Только encouragement и flight
          const encouragement = `<i>${escapeHTML(json.encouragement.text)}</i>`;
          const flight = escapeHTML(json.flight.additional_task);
          const message = `${encouragement}\n\n${flight}`;
          saveMessage(chatId, message, new Date().toISOString());
          return message;
        }
      } catch {}
      // Если не удалось — возвращаем только encouragement, если есть, иначе текст как есть
      try {
        json = JSON.parse(jsonText);
        if (json && json.encouragement && json.encouragement.text) {
          const encouragement = `<i>${escapeHTML(json.encouragement.text)}</i>`;
          saveMessage(chatId, encouragement, new Date().toISOString());
          return encouragement;
        }
      } catch {}
      // Fallback для занятого пользователя
      const fallbackBusy =
        'Кажется чатик не хочет работать - негодяй!\n\nКайфового дня :) Давай когда будет свободная минутка подумаешь о приятном, просто перечисляй все, что тебя радует, приносит удовольствие... можно нафантазировать)\n\nГлавное пострайся при этом почувствовать что-то хорошее ♥';
      saveMessage(chatId, fallbackBusy, new Date().toISOString());
      return fallbackBusy;
    } else {
      // Обычный день — используем структуру с пунктами
      schedulerLogger.info({ chatId }, '📅 Пользователь не занят, используем обычный промпт');
      let jsonText = await generateMessage(prompt);
      schedulerLogger.info({ chatId, jsonLength: jsonText?.length || 0 }, `📝 LLM ответ получен: ${jsonText}`);

      if (jsonText === 'HF_JSON_ERROR') {
        schedulerLogger.warn({ chatId }, '❌ LLM вернул HF_JSON_ERROR');
        const fallback = readFileSync('assets/fallback_text', 'utf-8');
        return fallback;
      }

      // Удаляем теги <think>...</think>
      jsonText = removeThinkTags(jsonText);

      // Пост-обработка: убираем markdown-блоки и экранирование
      jsonText = jsonText.replace(/```json|```/gi, '').trim();
      // Если строка начинается и заканчивается кавычками, убираем их
      if (jsonText.startsWith('"') && jsonText.endsWith('"')) {
        jsonText = jsonText.slice(1, -1);
      }
      // Заменяем экранированные кавычки
      jsonText = jsonText.replace(/\\"/g, '"').replace(/\"/g, '"');
      let json: any;
      try {
        json = JSON.parse(jsonText);
        if (typeof json === 'string') {
          json = JSON.parse(json); // второй парс, если строка
        }
        // Проверяем, что структура валидная
        if (
          !json ||
          typeof json !== 'object' ||
          !json.encouragement ||
          !json.negative_part ||
          !json.positive_part ||
          !('feels_and_emotions' in json)
        ) {
          throw new Error('Invalid structure');
        }
      } catch {
        // fallback всегда
        schedulerLogger.warn({ chatId }, '❌ JSON парсинг не удался, используем fallback');
        const fallback = readFileSync('assets/fallback_text', 'utf-8');
        return fallback;
      }
      let message = this.buildScheduledMessageFromHF(json);

      // Проверяем длину сообщения и логируем предупреждение если оно слишком длинное
      if (message.length > 1024) {
        schedulerLogger.warn(
          {
            chatId,
            messageLength: message.length,
            overflow: message.length - 1024,
          },
          `⚠️ Сгенерированное сообщение превышает лимит Telegram на ${message.length - 1024} символов!`
        );
      }

      return message;
    }
  }

  // Новый метод для генерации интерактивного сообщения
  public async generateInteractiveScheduledMessage(chatId: number): Promise<{
    json: any;
    firstPart: string;
    relaxationType: 'body' | 'breathing';
  }> {
    // Получаем данные пользователя, включая имя и пол
    const user = getUserByChatId(chatId);
    const userName = user?.name || null;
    const userGender = user?.gender || null;

    const userExists = await this.checkUserExists(chatId);
    if (!userExists) {
      databaseLogger.info({ chatId }, 'Пользователь не найден в базе, добавляем');
      addUser(chatId, '');
    }

    // Get events for the evening
    const now = new Date();
    const evening = new Date(now);
    evening.setHours(18, 0, 0, 0);
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);

    let events: any[] = [];
    let eventsStr = '';
    try {
      events = await this.calendarService.getEvents(evening.toISOString(), tomorrow.toISOString());
      if (events && events.length > 0) {
        eventsStr =
          '\n🗓️ События календаря:\n' +
          formatCalendarEvents(events, {
            locale: 'ru-RU',
            showDate: true,
            showBusy: true,
            showLocation: true,
            showDescription: true,
            showLink: true,
          });
      }
    } catch (e) {
      const error = e as Error;
      // В тестовом режиме просто игнорируем ошибки календаря
      if (this.isTestBot()) {
        schedulerLogger.debug({ chatId }, 'Календарь недоступен в тестовом режиме, продолжаем без него');
      } else {
        calendarLogger.error({ error: error.message, stack: error.stack }, 'Ошибка получения событий календаря');
        clearUserTokens(chatId); // Очищаем токены пользователя
      }
      events = [];
      eventsStr = '';
    }
    const dateTimeStr = now.toLocaleDateString('ru-RU', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    let previousMessagesBlock = '';

    const lastMsgs = getLastNBotMessages(chatId, 3);
    if (lastMsgs && lastMsgs.length > 0) {
      const ordered = lastMsgs.slice().reverse();
      previousMessagesBlock =
        '\n\nПоследние сообщения пользователю:' + ordered.map((m, i) => `\n${i + 1}. ${m.message_text}`).join('');
    }

    // Определяем занятость пользователя через анализ календаря
    const busyStatus = await this.detectUserBusy(events || []);
    
    // Для интерактивного режима всегда используем обычный промпт
    const promptPath = 'assets/prompts/scheduled-message.md';

    schedulerLogger.info(
      {
        chatId,
        probably_busy: busyStatus.probably_busy,
        promptPath,
        mode: 'interactive',
      },
      `🔍 Интерактивный режим: используем обычный промпт`
    );

    let promptBase = readFileSync(promptPath, 'utf-8');

    // Добавляем имя пользователя в промпт
    const userNameToUse = userName || 'друг';
    promptBase = promptBase.replace(/\{userName\}/g, userNameToUse);

    // Добавляем пол пользователя в промпт
    const userGenderToUse = userGender || 'unknown';
    promptBase = promptBase.replace(/\{userGender\}/g, userGenderToUse);

    let prompt = promptBase + `\n\nСегодня: ${dateTimeStr}.` + eventsStr + previousMessagesBlock;
    
    // Генерируем сообщение
    let jsonText = await generateMessage(prompt);
    schedulerLogger.info({ chatId, jsonLength: jsonText?.length || 0 }, `📝 LLM ответ получен для интерактивного режима`);

    if (jsonText === 'HF_JSON_ERROR') {
      schedulerLogger.warn({ chatId }, '❌ LLM вернул HF_JSON_ERROR в интерактивном режиме');
      const fallback = readFileSync('assets/fallback_text', 'utf-8');
      // Возвращаем fallback как JSON
      return {
        json: {
          encouragement: { text: fallback },
          negative_part: { additional_text: '' },
          positive_part: { additional_text: '' }
        },
        firstPart: fallback,
        relaxationType: 'breathing'
      };
    }

    // Удаляем теги <think>...</think>
    jsonText = removeThinkTags(jsonText);

    // Пост-обработка: убираем markdown-блоки и экранирование
    jsonText = jsonText.replace(/```json|```/gi, '').trim();
    if (jsonText.startsWith('"') && jsonText.endsWith('"')) {
      jsonText = jsonText.slice(1, -1);
    }
    jsonText = jsonText.replace(/\\"/g, '"').replace(/\"/g, '"');
    
    let json: any;
    try {
      json = JSON.parse(jsonText);
      if (typeof json === 'string') {
        json = JSON.parse(json); // второй парс, если строка
      }
      // Проверяем, что структура валидная
      if (
        !json ||
        typeof json !== 'object' ||
        !json.encouragement ||
        !json.negative_part ||
        !json.positive_part ||
        !('feels_and_emotions' in json)
      ) {
        throw new Error('Invalid structure');
      }
    } catch {
      // fallback всегда
      schedulerLogger.warn({ chatId }, '❌ JSON парсинг не удался в интерактивном режиме, используем fallback');
      const fallback = readFileSync('assets/fallback_text', 'utf-8');
      return {
        json: {
          encouragement: { text: fallback },
          negative_part: { additional_text: '' },
          positive_part: { additional_text: '' }
        },
        firstPart: fallback,
        relaxationType: 'breathing'
      };
    }

    // Используем интерактивный билдер
    const interactiveData = this.buildInteractiveMessage(json);

    return {
      json,
      firstPart: interactiveData.firstPart,
      relaxationType: interactiveData.relaxationType
    };
  }

  // Отправить сообщение в канал
  async sendDailyMessage(chatId: number) {
    // Блокируем автоматическую отправку для тестового бота
    if (this.isTestBot()) {
      schedulerLogger.warn('⚠️ Автоматическая рассылка отключена для тестового бота');
      return;
    }

    try {
      schedulerLogger.debug({ chatId }, 'Начало отправки сообщения');

      // Показываем, что бот "пишет" (реакция)
      await this.bot.telegram.sendChatAction(this.CHANNEL_ID, 'upload_photo');
      const message = await this.generateScheduledMessage(chatId);

      // Получаем события календаря для генерации изображения
      let calendarEvents = null;
      try {
        calendarEvents = await getUserTodayEvents(chatId);
      } catch (calendarError) {
        schedulerLogger.debug({ chatId, error: (calendarError as Error).message }, 'Календарь недоступен, продолжаем без него');
        calendarEvents = null;
      }

      // Генерируем промпт и изображение лягушки
      let imageBuffer: Buffer | null = null;
      try {
        // Получаем последнее сообщения
        const lastUserMessage = getLastUserMessage(chatId);
        const userMessageText = lastUserMessage?.message_text || 'Пользователь еще не отвечал';
        const lastBotMessage = getLastBotMessage(chatId);
        const botMessageText = lastBotMessage?.message_text || 'Бот еще не отвечал';

        // Используем последнее сообщение пользователя для промпта изображения
        const imagePrompt = await generateFrogPrompt(userMessageText, calendarEvents || undefined, botMessageText);

        schedulerLogger.info({ chatId, imagePrompt }, `🎨 Промпт для планируемого изображения: "${imagePrompt}"`);
        imageBuffer = await generateFrogImage(imagePrompt);
      } catch (imageError) {
        const imgErr = imageError as Error;
        schedulerLogger.error(
          {
            error: imgErr.message,
            stack: imgErr.stack,
            chatId,
          },
          'Ошибка генерации изображения для планируемого сообщения'
        );
      }

      // Логируем длину сообщения для отладки
      if (message.length > 1024) {
        schedulerLogger.error(
          {
            chatId,
            messageLength: message.length,
            overflow: message.length - 1024,
            message: message.substring(0, 200) + '...',
          },
          `❌ КРИТИЧЕСКАЯ ОШИБКА: Сообщение превышает лимит на ${message.length - 1024} символов!`
        );
      }

      const caption = message.length > 1024 ? message.slice(0, 1020) + '...' : message;

      if (imageBuffer) {
        // Отправляем сгенерированное изображение
        await this.bot.telegram.sendPhoto(
          this.CHANNEL_ID,
          { source: imageBuffer },
          {
            caption,
            parse_mode: 'HTML',
          }
        );
        schedulerLogger.info(
          {
            chatId,
            messageLength: message.length,
            imageSize: imageBuffer.length,
          },
          'Сообщение с сгенерированным изображением отправлено'
        );
      } else {
        // Fallback: используем старую систему ротации
        const imagePath = this.getNextImage(chatId);
        await this.bot.telegram.sendPhoto(
          this.CHANNEL_ID,
          { source: imagePath },
          {
            caption,
            parse_mode: 'HTML',
          }
        );
        schedulerLogger.info(
          {
            chatId,
            messageLength: message.length,
            imagePath,
          },
          'Сообщение с изображением из ротации отправлено (fallback)'
        );
      }

      // Если текст был обрезан — отправляем полный текст отдельным сообщением
      if (message.length > 1024) {
        await this.bot.telegram.sendMessage(this.CHANNEL_ID, message, {
          parse_mode: 'HTML',
        });
      }

      // Запускаем проверку ответов через заданное время (по умолчанию 2 минуты)
      const checkDelayMinutes = Number(process.env.ANGRY_POST_DELAY_MINUTES || 600); // 10 часов по умолчанию

      // Отменяем предыдущий таймаут если есть
      if (this.testModeCheckTimeout) {
        clearTimeout(this.testModeCheckTimeout);
      }

      schedulerLogger.info(`⏰ Проверка ответов будет через ${checkDelayMinutes} минут(ы)`);

      // Не сохраняем время для тестовых отправок через /fro

      // Запускаем проверку через заданное время
      this.testModeCheckTimeout = setTimeout(async () => {
        schedulerLogger.info('🔍 Запуск проверки ответов пользователя');
        await this.checkUsersResponses();
      }, checkDelayMinutes * 60 * 1000);

      // Убираем сохранение и напоминание - это теперь делается в sendDailyMessagesToAll
      // const sentTime = new Date().toISOString();
      // saveMessage(chatId, message, sentTime);
      // this.setReminder(chatId, sentTime);
    } catch (e) {
      const error = e as Error;
      schedulerLogger.error({ error: error.message, stack: error.stack, chatId }, 'Ошибка отправки сообщения');
    }
  }

  // Список случайных текстов для кнопки пропуска
  private getRandomSkipButtonText(): string {
    const skipButtons = [
      '✅ Все ок - пропустить',
      '👌 Все хорошо - пропустить',
      '🌟 Все отлично - пропустить',
      '💚 Все в порядке - пропустить',
      '🌈 Все супер - пропустить',
      '✨ Все замечательно - пропустить',
      '🍀 Все чудесно - пропустить',
      '🌺 Все прекрасно - пропустить',
      '🎯 Все на месте - пропустить',
      '🌸 Все классно - пропустить'
    ];
    return skipButtons[Math.floor(Math.random() * skipButtons.length)];
  }

  // Новый метод для интерактивной отправки сообщений
  async sendInteractiveDailyMessage(chatId: number, isManualCommand: boolean = false) {
    // Блокируем автоматическую отправку для тестового бота, но разрешаем команды
    if (this.isTestBot() && !isManualCommand) {
      schedulerLogger.warn('⚠️ Автоматическая интерактивная рассылка отключена для тестового бота');
      return;
    }

    try {
      schedulerLogger.debug({ 
        chatId,
        isTestBot: this.isTestBot(),
        channelId: this.CHANNEL_ID,
        chatGroupId: this.getChatId(),
        isManualCommand
      }, 'Начало отправки интерактивного сообщения');

      // Показываем, что бот "пишет" (реакция)
      await this.bot.telegram.sendChatAction(this.CHANNEL_ID, 'upload_photo');
      
      // Генерируем интерактивное сообщение
      const { json, firstPart, relaxationType } = await this.generateInteractiveScheduledMessage(chatId);

      // Получаем события календаря для генерации изображения
      let calendarEvents = null;
      try {
        calendarEvents = await getUserTodayEvents(chatId);
      } catch (calendarError) {
        schedulerLogger.debug({ chatId, error: (calendarError as Error).message }, 'Календарь недоступен, продолжаем без него');
        calendarEvents = null;
      }

      // Генерируем промпт и изображение лягушки
      let imageBuffer: Buffer | null = null;
      try {
        // Получаем последнее сообщения
        const lastUserMessage = getLastUserMessage(chatId);
        const userMessageText = lastUserMessage?.message_text || 'Пользователь еще не отвечал';
        const lastBotMessage = getLastBotMessage(chatId);
        const botMessageText = lastBotMessage?.message_text || 'Бот еще не отвечал';

        // Используем последнее сообщение пользователя для промпта изображения
        const imagePrompt = await generateFrogPrompt(userMessageText, calendarEvents || undefined, botMessageText);

        schedulerLogger.info({ chatId, imagePrompt }, `🎨 Промпт для интерактивного изображения: "${imagePrompt}"`);
        imageBuffer = await generateFrogImage(imagePrompt);
      } catch (imageError) {
        const imgErr = imageError as Error;
        schedulerLogger.error(
          {
            error: imgErr.message,
            stack: imgErr.stack,
            chatId,
          },
          'Ошибка генерации изображения для интерактивного сообщения'
        );
      }

      // Добавляем текст "Переходи в комментарии и продолжим 😉"
      const captionWithComment = firstPart + '\n\nПереходи в комментарии и продолжим 😉';

      // Отправляем основной пост БЕЗ кнопок
      let sentMessage;
      if (imageBuffer) {
        // Отправляем сгенерированное изображение
        sentMessage = await this.bot.telegram.sendPhoto(
          this.CHANNEL_ID,
          { source: imageBuffer },
          {
            caption: captionWithComment,
            parse_mode: 'HTML'
          }
        );
        const postSentTime = new Date();
        schedulerLogger.info(
          {
            chatId,
            messageLength: captionWithComment.length,
            imageSize: imageBuffer.length,
            messageId: sentMessage.message_id,
            sentAt: postSentTime.toISOString(),
            timestamp: postSentTime.getTime()
          },
          'Основной пост с изображением отправлен в канал'
        );
      } else {
        // Fallback: используем старую систему ротации
        const imagePath = this.getNextImage(chatId);
        sentMessage = await this.bot.telegram.sendPhoto(
          this.CHANNEL_ID,
          { source: imagePath },
          {
            caption: captionWithComment,
            parse_mode: 'HTML'
          }
        );
        schedulerLogger.info(
          {
            chatId,
            messageLength: captionWithComment.length,
            imagePath,
          },
          'Основной пост с изображением из ротации отправлен в канал (fallback)'
        );
      }

      const messageId = sentMessage.message_id;
      
      // Сразу отправляем первое задание как комментарий с кнопкой пропуска
      const skipButtonText = this.getRandomSkipButtonText();
      const firstTaskText = '1. <b>Выгрузка неприятных переживаний</b> (ситуация+эмоция)';
      let firstTaskFullText = firstTaskText;
      if (json.negative_part?.additional_text) {
        firstTaskFullText += `\n<blockquote>${escapeHTML(json.negative_part.additional_text)}</blockquote>`;
      }
      
      const firstTaskKeyboard = {
        inline_keyboard: [
          [{ text: skipButtonText, callback_data: 'daily_skip_negative' }]
        ]
      };

      // Получаем ID группы обсуждений
      const CHAT_ID = this.getChatId();
      
      if (!CHAT_ID) {
        schedulerLogger.error('❌ CHAT_ID не настроен в .env - не можем отправить первое задание в группу обсуждений');
        return;
      }
      
      // Отправляем первое задание асинхронно после появления пересланного сообщения
      this.sendFirstTaskAsync(messageId, firstTaskFullText, firstTaskKeyboard, skipButtonText, chatId, CHAT_ID);
      
      schedulerLogger.info(
        { 
          channelMessageId: messageId,
          channelId: this.CHANNEL_ID,
          chatId: CHAT_ID,
          skipButton: skipButtonText
        }, 
        '✅ Процесс отправки первого задания запущен асинхронно'
      );
      

      // Сохраняем состояние сессии
      const startTime = new Date().toISOString();
      const targetUserId = this.getTargetUserId();
      
      // Сохраняем сессию как для chatId, так и для targetUserId
      const sessionData = {
        messageData: json,
        relaxationType,
        currentStep: 'waiting_negative' as const,
        startTime,
        messageId: sentMessage.message_id,
        channelMessageId: messageId // Сохраняем ID поста в канале
      };
      
      this.interactiveSessions.set(chatId, sessionData);
      if (targetUserId !== chatId) {
        this.interactiveSessions.set(targetUserId, sessionData);
      }
      
      schedulerLogger.info({ 
        chatId,
        targetUserId,
        sessionSaved: true,
        sessionsCount: this.interactiveSessions.size 
      }, 'Интерактивная сессия сохранена');

      // Больше не нужно очищать, так как асинхронный метод использует его позже

      // Сохраняем сообщение в БД
      saveMessage(chatId, captionWithComment, startTime);

      // Запускаем проверку ответов через заданное время (по умолчанию 10 часов)
      const checkDelayMinutes = Number(process.env.ANGRY_POST_DELAY_MINUTES || 600);

      // Отменяем предыдущий таймаут если есть
      if (this.testModeCheckTimeout) {
        clearTimeout(this.testModeCheckTimeout);
      }

      // Запускаем проверку только для основного бота ИЛИ если это ручная команда для тестового
      if (!this.isTestBot() || isManualCommand) {
        schedulerLogger.info(`⏰ Проверка ответов будет через ${checkDelayMinutes} минут(ы)`);

        // Запускаем проверку через заданное время
        this.testModeCheckTimeout = setTimeout(async () => {
          schedulerLogger.info('🔍 Запуск проверки ответов пользователя');
          await this.checkUsersResponses();
        }, checkDelayMinutes * 60 * 1000);
      } else {
        schedulerLogger.info('🤖 Тестовый бот - автоматическая проверка ответов отключена');
      }

    } catch (e) {
      const error = e as Error;
      schedulerLogger.error({ error: error.message, stack: error.stack, chatId }, 'Ошибка отправки интерактивного сообщения');
    }
  }

  // Асинхронная отправка первого задания как комментария к посту
  private async sendFirstTaskAsync(
    channelMessageId: number, 
    firstTaskFullText: string, 
    firstTaskKeyboard: any, 
    skipButtonText: string,
    originalChatId: number,
    CHAT_ID: number
  ) {
    try {
      // Периодически проверяем наличие пересланного сообщения
      let forwardedMessageId: number | null = null;
      let attempts = 0;
      const maxAttempts = 60; // Максимум 60 попыток (5 минут)
      const checkInterval = 5000; // Проверяем каждые 5 секунд
      
      schedulerLogger.info({ 
        channelMessageId,
        CHAT_ID,
        checkInterval: `${checkInterval/1000}s`
      }, '🔍 Начинаем периодическую проверку пересланного сообщения');
      
      while (!forwardedMessageId && attempts < maxAttempts) {
        attempts++;
        
        // Проверяем сразу, потом ждем
        forwardedMessageId = this.forwardedMessages.get(channelMessageId) || null;
        
        if (forwardedMessageId) {
          schedulerLogger.info({ 
            forwardedMessageId,
            channelMessageId,
            attempts,
            waitedSeconds: attempts * checkInterval / 1000
          }, '✅ Найден ID пересланного сообщения в группе');
          break;
        }
        
        // Логируем прогресс
        if (attempts % 3 === 0) { // Каждые 15 секунд
          schedulerLogger.debug({ 
            attempts,
            channelMessageId,
            waitedMinutes: (attempts * checkInterval / 1000 / 60).toFixed(1),
            forwardedMessagesCount: this.forwardedMessages.size
          }, '⏳ Продолжаем ждать пересланное сообщение...');
        }
        
        // Ждем до следующей проверки
        await new Promise(resolve => setTimeout(resolve, checkInterval));
      }
      
      // Отправляем первое задание
      const messageOptions: any = {
        parse_mode: 'HTML',
        reply_markup: firstTaskKeyboard,
        disable_notification: true
      };
      
      if (forwardedMessageId) {
        // Отправляем как комментарий к посту
        messageOptions.reply_to_message_id = forwardedMessageId;
        
        const firstTaskMessage = await this.bot.telegram.sendMessage(
          CHAT_ID,
          firstTaskFullText,
          messageOptions
        );
        
        schedulerLogger.info({ 
          success: true,
          firstTaskId: firstTaskMessage.message_id,
          channelMessageId,
          forwardedMessageId,
          chat_id: CHAT_ID,
          waitedSeconds: attempts * checkInterval / 1000
        }, '✅ Первое задание отправлено как комментарий к посту');
        
      } else {
        // Таймаут - отправляем в группу с пометкой
        schedulerLogger.warn({ 
          channelMessageId,
          attempts,
          maxAttempts,
          waitedMinutes: (maxAttempts * checkInterval / 1000 / 60).toFixed(1)
        }, '⚠️ Таймаут ожидания пересланного сообщения, отправляем в группу с пометкой');
        
        const firstTaskMessage = await this.bot.telegram.sendMessage(
          CHAT_ID,
          firstTaskFullText,
          messageOptions
        );
        
        schedulerLogger.info({ 
          success: true,
          firstTaskId: firstTaskMessage.message_id,
          channelMessageId,
          chat_id: CHAT_ID,
          used_note: true
        }, '✅ Первое задание отправлено в группу с пометкой');
      }
      
    } catch (error) {
      schedulerLogger.error({ 
        error: (error as Error).message,
        stack: (error as Error).stack,
        channelMessageId,
        CHAT_ID
      }, '❌ Ошибка асинхронной отправки первого задания');
    }
  }

  // Массовая рассылка по всем пользователям
  async sendDailyMessagesToAll(adminChatId: number) {
    // Блокируем автоматическую рассылку для тестового бота
    if (this.isTestBot()) {
      schedulerLogger.warn('⚠️ Массовая рассылка отключена для тестового бота');
      return;
    }

    // Сохраняем время начала рассылки для корректной проверки ответов
    const now = new Date();
    await this.saveLastDailyRunTime(now);

    schedulerLogger.info(
      { usersCount: this.users.size },
      `🚀 Автоматическая рассылка запущена для ${this.users.size} пользователей`
    );

    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];
    const checkDelayMinutes = Number(process.env.ANGRY_POST_DELAY_MINUTES || 600); // 10 часов по умолчанию

    if (!this.users || this.users.size === 0) {
      await this.bot.telegram.sendMessage(adminChatId, '❗️Нет пользователей для рассылки. Отправляю сообщение себе.');
      await this.sendDailyMessage(adminChatId);
      schedulerLogger.warn('Нет пользователей для рассылки, отправляем админу');
      return;
    }

    // Отправляем ОДИН пост в канал (используем ID админа для генерации)
    try {
      await this.sendInteractiveDailyMessage(adminChatId);
      successCount = 1;
      schedulerLogger.info('messageGenerated', adminChatId, 0, 0); // Логируем успешную отправку

      // Устанавливаем напоминание только для целевого пользователя
      const TARGET_USER_ID = this.getTargetUserId();
      const sentTime = new Date().toISOString();

      // Проверяем, есть ли целевой пользователь в списке
      if (this.users.has(TARGET_USER_ID)) {
        this.setReminder(TARGET_USER_ID, sentTime);
        schedulerLogger.info({ userId: TARGET_USER_ID }, 'Напоминание установлено для целевого пользователя');
      } else {
        schedulerLogger.warn({ userId: TARGET_USER_ID }, 'Целевой пользователь не найден в списке пользователей');
      }

      // Запускаем проверку ответов через заданное время
      // Отменяем предыдущий таймаут если есть
      if (this.testModeCheckTimeout) {
        clearTimeout(this.testModeCheckTimeout);
      }

      schedulerLogger.info(
        `⏰ Проверка ответов пользователя ${TARGET_USER_ID} будет через ${checkDelayMinutes} минут(ы)`
      );

      // Запускаем проверку через заданное время
      this.testModeCheckTimeout = setTimeout(async () => {
        schedulerLogger.info('🔍 Запуск проверки ответов после ежедневной рассылки');
        await this.checkUsersResponses();
      }, checkDelayMinutes * 60 * 1000);
    } catch (error) {
      errorCount = 1;
      const errorMsg = `Ошибка отправки поста: ${error}`;
      errors.push(errorMsg);
      logger.error('Ошибка отправки ежедневного поста', error as Error);
    }

    // Отправляем отчет админу
    const TARGET_USER_ID = 5153477378;
    const reportMessage = `📊 Отчет о ежедневной отправке:
✅ Пост отправлен: ${successCount === 1 ? 'Да' : 'Нет'}
❌ Ошибок: ${errorCount}
👤 Целевой пользователь: ${TARGET_USER_ID}
📨 Напоминание установлено: ${this.users.has(TARGET_USER_ID) ? 'Да' : 'Нет (пользователь не найден)'}
⏰ Проверка ответов через: ${checkDelayMinutes} мин

${errorCount > 0 ? `\n🚨 Ошибки:\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? '\n...' : ''}` : ''}`;

    try {
      await this.bot.telegram.sendMessage(adminChatId, reportMessage);
    } catch (adminError) {
      botLogger.error(adminError as Error, 'Отчет админу');
    }

    schedulerLogger.info('cronComplete', 0, successCount, errorCount);
  }

  // Проверка наличия пользователя в базе
  private async checkUserExists(chatId: number): Promise<boolean> {
    const { db } = await import('./db');
    const row = db.query('SELECT 1 FROM users WHERE chat_id = ?').get(chatId);
    return !!row;
  }

  // Установить напоминание с учётом календаря и генерацией креативного текста
  async setReminder(chatId: number, sentBotMsgTime: string) {
    // Не устанавливаем напоминания для тестового бота
    if (this.isTestBot()) {
      schedulerLogger.info('🤖 Тестовый бот - напоминания отключены');
      return;
    }

    // Проверяем, что chatId положительный (личный чат пользователя)
    // Отрицательные ID - это группы и каналы
    if (chatId <= 0) {
      schedulerLogger.debug({ chatId }, 'Пропускаем напоминание для группы/канала');
      return;
    }

    const timeout = setTimeout(async () => {
      const stats = getUserResponseStats(chatId);
      if (!stats || !stats.last_response_time || new Date(stats.last_response_time) < new Date(sentBotMsgTime)) {
        // Получаем события за неделю назад и день вперёд
        const now = new Date();
        const weekAgo = new Date(now);
        weekAgo.setDate(now.getDate() - 7);
        const tomorrow = new Date(now);
        tomorrow.setDate(now.getDate() + 1);
        const events = await this.calendarService.getEvents(weekAgo.toISOString(), tomorrow.toISOString());
        // Фильтруем только эмоционально заряженные события (например, по ключевым словам)
        const importantEvents = (events || []).filter((event: any) => {
          const summary = (event.summary || '').toLowerCase();
          // Пример фильтрации: пропускаем события без описания или с нейтральными словами
          const neutralWords = ['напоминание', 'дело', 'встреча', 'meeting', 'call', 'appointment'];
          if (!summary) return false;
          return !neutralWords.some(word => summary.includes(word));
        });
        // Получаем имя и пол пользователя
        const user = getUserByChatId(chatId);
        const userName = user?.name || null;
        const userGender = user?.gender || null;

        // Простое напоминание без генерации через LLM
        let reminderText = '🐸 Привет';
        if (userName) {
          reminderText += `, ${userName}`;
        }
        reminderText += '! Не забудь ответить на сегодняшнее задание, если еще не ';

        // Учитываем пол пользователя
        if (userGender === 'male') {
          reminderText += 'успел';
        } else if (userGender === 'female') {
          reminderText += 'успела';
        } else {
          reminderText += 'успел(а)';
        }

        // Отправляем напоминание в личку пользователю
        await this.bot.telegram.sendMessage(chatId, reminderText);

        schedulerLogger.info({ chatId }, '📨 Напоминание отправлено пользователю');
      }
    }, 1.5 * 60 * 60 * 1000); // 1.5 часа

    this.reminderTimeouts.set(chatId, timeout);
  }

  // Очистить напоминание
  clearReminder(chatId: number) {
    const timeout = this.reminderTimeouts.get(chatId);
    if (timeout) {
      clearTimeout(timeout);
      this.reminderTimeouts.delete(chatId);
    }
  }

  // Добавить разовую отправку сообщения
  scheduleOneTimeMessage(chatId: number, targetTime: Date) {
    const now = new Date();
    const delay = targetTime.getTime() - now.getTime();

    if (delay > 0) {
      setTimeout(() => {
        this.sendDailyMessage(chatId);
      }, delay);
    }
  }

  // Инициализация автоматического ежедневного расписания
  private initializeDailySchedule() {
    logger.info('Инициализация автоматического ежедневного расписания');
    this.startDailyCronJob();
    // Утренняя проверка отключена - теперь проверка запускается через ANGRY_POST_DELAY_MINUTES после каждого поста
    // this.startMorningCheckCronJob();
  }

  // Запуск cron job для ежедневной отправки в 22:00
  private startDailyCronJob() {
    // Останавливаем предыдущий job, если он есть
    if (this.dailyCronJob) {
      schedulerLogger.info('Перезапуск cron job');
      this.dailyCronJob.stop();
      this.dailyCronJob.destroy();
      this.dailyCronJob = null;
    }

    // Добавляем уникальный идентификатор процесса для отладки
    const processId = `${process.pid}_${Date.now()}`;

    // Показываем текущее время для диагностики
    const now = new Date();
    const moscowTime = new Date().toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    schedulerLogger.info({ processId }, 'cronStart'); // Создание cron job

    // Создаем новый cron job: каждый день в 22:00
    // Формат: "минуты часы * * *" (0 22 * * * = 22:00 каждый день)
    this.dailyCronJob = cron.schedule(
      '0 22 * * *',
      async () => {
        const startTime = new Date();
        const startTimeMoscow = startTime.toLocaleString('ru-RU', {
          timeZone: 'Europe/Moscow',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });

        schedulerLogger.info({ processId, usersCount: this.users.size }, 'cronTrigger');

        try {
          const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);
          // Убираем, уже логируется в cronTrigger

          if (!adminChatId) {
            throw new Error('ADMIN_CHAT_ID не установлен в переменных окружения');
          }

          // Убираем, уже логируется в cronTrigger
          await this.sendDailyMessagesToAll(adminChatId);

          const endTime = new Date();
          const duration = endTime.getTime() - startTime.getTime();
          schedulerLogger.info('cronComplete', duration, this.users.size, 0);
        } catch (error) {
          const endTime = new Date();
          const duration = endTime.getTime() - startTime.getTime();
          schedulerLogger.error(error as Error, 'Автоматическая рассылка');

          // Попытаемся уведомить админа об ошибке
          try {
            const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);
            if (adminChatId) {
              await this.bot.telegram.sendMessage(
                adminChatId,
                `🚨 КРИТИЧЕСКАЯ ОШИБКА в автоматической рассылке!\n\n` +
                  `⏰ Время: ${startTimeMoscow}\n` +
                  `❌ Ошибка: ${error}\n` +
                  `⏱️ Длительность: ${duration}ms\n\n` +
                  `Проверьте логи сервера для подробностей.`
              );
            }
          } catch (notifyError) {
            logger.error('Уведомление админа об ошибке cron', notifyError as Error);
          }
        }
      },
      {
        timezone: 'Europe/Moscow', // Устанавливаем московское время
      }
    );

    // Проверяем, что cron job действительно создался
    if (this.dailyCronJob) {
      schedulerLogger.info({ processId, expression: '0 22 * * *' }, 'Cron job успешно создан');
    } else {
      logger.error('Планировщик', new Error('Cron job не был создан'));
    }
  }

  // Запуск cron job для утренней проверки в 8:00
  private startMorningCheckCronJob() {
    // Останавливаем предыдущий job, если он есть
    if (this.morningCheckCronJob) {
      schedulerLogger.info('Перезапуск morning check cron job');
      this.morningCheckCronJob.stop();
      this.morningCheckCronJob.destroy();
      this.morningCheckCronJob = null;
    }

    schedulerLogger.info('Создание morning check cron job (8:00 МСК)');

    // Создаем новый cron job: каждый день в 8:00
    this.morningCheckCronJob = cron.schedule(
      '0 8 * * *',
      async () => {
        schedulerLogger.info('🌅 Запуск утренней проверки ответов пользователей');
        try {
          await this.checkUsersResponses();
        } catch (error) {
          schedulerLogger.error(error as Error, 'Ошибка утренней проверки');
          // Уведомляем админа об ошибке
          try {
            const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);
            if (adminChatId) {
              await this.bot.telegram.sendMessage(adminChatId, `🚨 ОШИБКА в утренней проверке!\n\n❌ Ошибка: ${error}`);
            }
          } catch (notifyError) {
            logger.error('Уведомление админа об ошибке morning check', notifyError as Error);
          }
        }
      },
      {
        timezone: 'Europe/Moscow',
      }
    );

    if (this.morningCheckCronJob) {
      schedulerLogger.info('Morning check cron job успешно создан');
    } else {
      logger.error('Morning check планировщик', new Error('Morning check cron job не был создан'));
    }
  }

  // Получить статус планировщика
  public getSchedulerStatus() {
    const isDailyRunning = this.dailyCronJob ? true : false;
    const isMorningRunning = this.morningCheckCronJob ? true : false;
    const usersCount = this.users.size;
    const usersList = Array.from(this.users);

    // Получаем текущее время в Москве
    const now = new Date();
    const moscowTime = now.toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    // Вычисляем время до следующего запуска вечерней рассылки
    const nextDailyRun = new Date();
    nextDailyRun.setHours(22, 0, 0, 0);
    if (nextDailyRun <= now) {
      nextDailyRun.setDate(nextDailyRun.getDate() + 1);
    }

    // Вычисляем время до следующей утренней проверки
    const nextMorningRun = new Date();
    nextMorningRun.setHours(8, 0, 0, 0);
    if (nextMorningRun <= now) {
      nextMorningRun.setDate(nextMorningRun.getDate() + 1);
    }

    const nextDailyRunMoscow = nextDailyRun.toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

    const nextMorningRunMoscow = nextMorningRun.toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

    return {
      isRunning: isDailyRunning && isMorningRunning,
      isDailyRunning,
      isMorningRunning,
      usersCount,
      usersList,
      cronExpression: '0 22 * * * (вечер), 0 8 * * * (утро)',
      timezone: 'Europe/Moscow',
      description: 'Ежедневно в 22:00 МСК (рассылка) и 8:00 МСК (проверка)',
      currentTime: moscowTime,
      nextRunTime: `Вечер: ${nextDailyRunMoscow}, Утро: ${nextMorningRunMoscow}`,
      adminChatId: Number(process.env.ADMIN_CHAT_ID || 0),
    };
  }

  // Получить время последней ежедневной рассылки
  private async getLastDailyRunTime(): Promise<Date | null> {
    try {
      const { db } = await import('./db');
      const row = db
        .query(
          `
        SELECT value FROM system_settings WHERE key = 'last_daily_run'
      `
        )
        .get() as { value: string } | undefined;

      if (row && row.value) {
        return new Date(row.value);
      }
      return null;
    } catch (error) {
      schedulerLogger.error(error as Error, 'Ошибка получения времени последней рассылки');
      return null;
    }
  }

  // Сохранить время последней ежедневной рассылки
  private async saveLastDailyRunTime(time: Date): Promise<void> {
    try {
      const { db } = await import('./db');
      db.query(
        `
        INSERT OR REPLACE INTO system_settings (key, value)
        VALUES ('last_daily_run', ?)
      `
      ).run(time.toISOString());
    } catch (error) {
      schedulerLogger.error(error as Error, 'Ошибка сохранения времени последней рассылки');
    }
  }

  // Проверка ответа конкретного пользователя и отправка "злого" поста
  // ВАЖНО: Проверяется только один пользователь с ID 5153477378
  // Если он не ответил на задание после заданной задержки (по умолчанию 10 часов) - отправляется ОДИН злой пост в канал
  // Эта проверка запускается после каждой отправки поста через sendDailyMessage с задержкой ANGRY_POST_DELAY_MINUTES
  private async checkUsersResponses() {
    // Всегда проверяем целевого пользователя
    const TARGET_USER_ID = 5153477378;

    schedulerLogger.info(
      {
        targetUserId: TARGET_USER_ID,
      },
      `🔍 Проверка ответов пользователя ${TARGET_USER_ID}`
    );

    const now = new Date();

    // Получаем время последней рассылки для проверки
    const lastDailyRun = await this.getLastDailyRunTime();

    let hasResponded = false;
    let sentPost = false;
    let error: string | null = null;

    // Проверяем только целевого пользователя
    try {
      const stats = getUserResponseStats(TARGET_USER_ID);

      schedulerLogger.info(
        {
          userId: TARGET_USER_ID,
          stats,
          lastDailyRun: lastDailyRun?.toISOString(),
          lastResponseTime: stats?.last_response_time,
        },
        '📊 Данные для проверки ответа'
      );

      // Проверяем, ответил ли пользователь после вчерашней рассылки
      hasResponded = !!(
        stats &&
        stats.last_response_time &&
        lastDailyRun &&
        new Date(stats.last_response_time) > lastDailyRun
      );

      if (!hasResponded) {
        schedulerLogger.info(
          { userId: TARGET_USER_ID },
          `Пользователь ${TARGET_USER_ID} не ответил на вчерашнее задание`
        );

        // Отправляем "злой" пост
        try {
          await this.sendAngryPost(TARGET_USER_ID);
          sentPost = true;
        } catch (err) {
          error = `Ошибка отправки злого поста: ${err}`;
          schedulerLogger.error({ error: err, userId: TARGET_USER_ID }, 'Ошибка отправки злого поста');
        }
      } else {
        schedulerLogger.info({ userId: TARGET_USER_ID }, `Пользователь ${TARGET_USER_ID} ответил на вчерашнее задание`);
      }
    } catch (err) {
      error = `Ошибка проверки пользователя: ${err}`;
      schedulerLogger.error({ error: err, userId: TARGET_USER_ID }, 'Ошибка проверки ответа пользователя');
    }

    // Отправляем отчет админу
    const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);
    if (adminChatId) {
      const reportMessage =
        `📊 <b>Отчет утренней проверки:</b>\n\n` +
        `👤 Проверен пользователь: <code>${TARGET_USER_ID}</code>\n` +
        `${hasResponded ? '✅ Ответил на вчерашнее задание' : '😴 НЕ ответил на вчерашнее задание'}\n` +
        `${sentPost ? '😠 Злой пост отправлен в канал' : ''}\n` +
        `${error ? `\n❌ Ошибка: ${error}` : ''}`;

      try {
        await this.bot.telegram.sendMessage(adminChatId, reportMessage, { parse_mode: 'HTML' });
      } catch (adminError) {
        schedulerLogger.error(adminError as Error, 'Ошибка отправки отчета админу');
      }
    }
  }

  // Отправка "злого" поста для пользователя, который не ответил
  private async sendAngryPost(userId: number) {
    // Блокируем автоматическую отправку для тестового бота
    if (this.isTestBot()) {
      schedulerLogger.warn('⚠️ Отправка злого поста отключена для тестового бота');
      return;
    }

    try {
      // Генерируем злой текст
      const angryPrompt = readFileSync('assets/prompts/no-answer', 'utf-8');
      const angryText = await generateMessage(angryPrompt);

      // Удаляем теги <think>...</think>
      const cleanedText = removeThinkTags(angryText);

      // Ограничиваем длину текста
      const finalText = cleanedText.length > 500 ? cleanedText.slice(0, 497) + '...' : cleanedText;

      // Генерируем злое изображение лягушки
      const angryImagePrompt = readFileSync('assets/prompts/frog-image-promt-angry', 'utf-8');
      let imageBuffer: Buffer | null = null;

      try {
        imageBuffer = await generateFrogImage(angryImagePrompt);
        schedulerLogger.info({ userId }, '🎨 Злое изображение лягушки сгенерировано');
      } catch (imageError) {
        schedulerLogger.error({ error: imageError, userId }, 'Ошибка генерации злого изображения');
      }

      // Отправляем в канал
      if (imageBuffer) {
        await this.bot.telegram.sendPhoto(
          this.CHANNEL_ID,
          { source: imageBuffer },
          {
            caption: finalText,
            parse_mode: 'HTML',
          }
        );
      } else {
        // Fallback: используем обычное изображение из ротации
        const imagePath = this.getNextImage(userId);
        await this.bot.telegram.sendPhoto(
          this.CHANNEL_ID,
          { source: imagePath },
          {
            caption: finalText,
            parse_mode: 'HTML',
          }
        );
      }

      schedulerLogger.info({ userId }, '😠 Злой пост отправлен в канал');

      // Сохраняем сообщение в историю
      saveMessage(userId, finalText, new Date().toISOString());
    } catch (error) {
      throw error;
    }
  }

  // Обработчик кнопки пропуска для первого задания
  public async handleSkipNegative(adminChatId: number, messageId: number, chatId: number, messageThreadId?: number) {
    const targetUserId = this.getTargetUserId();
    
    schedulerLogger.info({ 
      adminChatId, 
      targetUserId,
      messageId, 
      chatId, 
      messageThreadId,
      sessionsCount: this.interactiveSessions.size,
      hasAdminSession: this.interactiveSessions.has(adminChatId),
      hasTargetSession: this.interactiveSessions.has(targetUserId)
    }, 'handleSkipNegative вызван');
    
    // Ищем сессию по adminChatId или targetUserId
    const session = this.interactiveSessions.get(adminChatId) || this.interactiveSessions.get(targetUserId);
    if (!session) {
      schedulerLogger.warn({ 
        adminChatId,
        targetUserId,
        availableKeys: Array.from(this.interactiveSessions.keys())
      }, 'Сессия не найдена для обработки кнопки пропуска');
      return;
    }

    try {
      // НЕ удаляем сообщение с кнопкой
      
      // Сразу отправляем плюшки (второе задание)
      const plushkiMessage = this.buildSecondPart(session.messageData);
      
      const sendOptions: any = {
        parse_mode: 'HTML'
      };
      
      // ВАЖНО: Всегда используем reply_to_message_id для ответа в комментариях
      const forwardedId = session.channelMessageId;
      
      // Для групповых чатов с обсуждениями используем reply_to_message_id
      if (forwardedId) {
        sendOptions.reply_to_message_id = messageId; // Отвечаем на сообщение с кнопкой
        schedulerLogger.info({ 
          replyToMessageId: messageId,
          forwardedId,
          chatId 
        }, 'Используем reply_to_message_id для отправки плюшек в комментарии');
      }
      
      await this.bot.telegram.sendMessage(chatId, plushkiMessage, sendOptions);

      // Сохраняем сообщение
      saveMessage(adminChatId, plushkiMessage, new Date().toISOString());
      
      // Обновляем состояние сессии - переходим сразу к ожиданию ответа на плюшки
      session.currentStep = 'waiting_positive';
      
      schedulerLogger.info({ 
        adminChatId, 
        chatId, 
        threadId: forwardedId
      }, 'Пользователь пропустил первое задание, отправлены плюшки');
    } catch (error) {
      schedulerLogger.error({ error }, 'Ошибка обработки кнопки пропуска');
    }
  }


  // Построение второй части сообщения
  private buildSecondPart(json: any): string {
    let message = '2. <b>Плюшки для лягушки</b> (ситуация+эмоция)';
    if (json.positive_part?.additional_text) {
      message += `\n<blockquote>${escapeHTML(json.positive_part.additional_text)}</blockquote>`;
    }
    return message;
  }

  // Анализ ответа пользователя
  private async analyzeUserResponse(response: string): Promise<{
    detailed: boolean;
    needsClarification: boolean;
    significant: boolean;
    supportText?: string;
  }> {
    const words = response.split(' ').length;
    const hasEmotions = /радост|груст|злость|страх|тревог|спокой|счаст|обид|разочаров|восторг|удивл|стыд|вин|гнев|ярост|паник|беспокой|умиротвор|блажен|восхищ|отвращ|презр|ненавист|любовь|нежн|тепл|холод|пуст|тоск|печаль|горе|отчаян|безнадежн|апат|равнодуш|скук|интерес|азарт|воодушевл|энтузиа|надежд|вер|довер|сомнен|подозрен|насторож|уверен|решительн|смел|робост|застенчив|смущен|неловк|гордост|высокомер|униж|оскорбл|благодарн|признательн|зависть|ревность|жалость|сочувств|сострадан|эмпат|одиночеств|покинут|нужн|важн|значим|беспомощн|бессил|сил|мощ|энерг|устал|истощ|вымотан|опустошен/i.test(response);
    const hasFeelWords = /чувств|ощущ|эмоц|настроен|состоян/i.test(response);
    const significantWords = /важн|серьезн|сложн|проблем|тяжел|невыносим|катастроф|кризис|критич|опасн|угроз|беспокоит|волнует|тревожит|мучает|терзает|гложет|довод|изматывает|подавляет|давит|душит/i.test(response);
    
    // Проверяем, описал ли пользователь эмоции
    const emotionsDescribed = hasEmotions || hasFeelWords;
    
    if (words > 15 && emotionsDescribed) {
      // Вариант 1: Пользователь подробно описал эмоции
      return {
        detailed: true,
        needsClarification: false,
        significant: false,
        supportText: this.getRandomSupportText()
      };
    } else if (words < 10 && !emotionsDescribed) {
      // Вариант 2: Пользователь не описал эмоции И мало написал
      return {
        detailed: false,
        needsClarification: true,
        significant: false
      };
    } else if (significantWords) {
      // Вариант 3: Было значимое/важное событие
      return {
        detailed: false,
        needsClarification: false,
        significant: true
      };
    } else {
      // По умолчанию переходим к плюшкам с базовой поддержкой
      return {
        detailed: true,
        needsClarification: false,
        significant: false,
        supportText: this.getRandomSupportText()
      };
    }
  }

  // Получить случайный текст поддержки
  private getRandomSupportText(): string {
    const supportTexts = [
      'Спасибо, что поделился 💚',
      'Понимаю тебя 🤗',
      'Это действительно непросто 💛',
      'Ты молодец, что проговариваешь это 🌱',
      'Твои чувства важны 💙',
      'Слышу тебя 🤍',
      'Благодарю за доверие 🌿'
    ];
    return supportTexts[Math.floor(Math.random() * supportTexts.length)];
  }


  // Обработка ответа пользователя в интерактивной сессии
  public async handleInteractiveUserResponse(userId: number, messageText: string, replyToChatId: number, messageId: number, messageThreadId?: number) {
    // Интерактивные ответы ВКЛЮЧЕНЫ - это нужно для работы логики заданий
    const INTERACTIVE_RESPONSES_ENABLED = true; // Это НУЖНО для работы заданий!
    
    // Проверяем сессию по adminChatId (используется для генерации)
    const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);
    
    schedulerLogger.info({ 
      userId, 
      adminChatId,
      hasAdminSession: this.interactiveSessions.has(adminChatId),
      hasUserSession: this.interactiveSessions.has(userId),
      sessionsCount: this.interactiveSessions.size 
    }, 'Проверка интерактивных сессий');
    
    const session = this.interactiveSessions.get(adminChatId) || this.interactiveSessions.get(userId);
    
    if (!session) {
      // Нет активной сессии, обычная обработка
      schedulerLogger.debug({ userId }, 'Нет активной интерактивной сессии');
      return false;
    }

    schedulerLogger.info({ 
      userId, 
      step: session.currentStep,
      messageText: messageText.substring(0, 50) 
    }, 'Обработка интерактивного ответа пользователя');

    try {
      if (session.currentStep === 'waiting_negative') {
        // ВСЕГДА отправляем схему после первого ответа
        const responseText = 'Давай <b>разложим</b> минимум одну ситуацию <b>по схеме</b>:\n🗓 Триггер - Мысли - Эмоции - Ощущения в теле - Поведение или импульс к действию';
        
        // Переходим в новое состояние ожидания схемы
        session.currentStep = 'waiting_schema';
        session.schemaRequested = true;

        // Отправляем ответ в чат
        const sendOptions: any = {
          parse_mode: 'HTML',
          reply_parameters: {
            message_id: messageId
          }
        };
        
        // ВАЖНО: Используем ту же логику, что и для первого задания
        const forwardedMessageId = this.forwardedMessages.get(session.channelMessageId || 0);
        if (forwardedMessageId) {
          sendOptions.reply_to_message_id = forwardedMessageId;
          schedulerLogger.info({ 
            forwardedMessageId,
            channelMessageId: session.channelMessageId,
            replyToChatId 
          }, 'Используем reply_to_message_id для ответа в комментариях');
        } else {
          schedulerLogger.warn('⚠️ Не нашли пересланное сообщение, отправляем как обычное');
        }
        
        await this.bot.telegram.sendMessage(replyToChatId, responseText, sendOptions);

        // Сохраняем сообщение
        saveMessage(userId, responseText, new Date().toISOString(), 0);

      } else if (session.currentStep === 'waiting_schema') {
        // Получен ответ на схему - отправляем слова поддержки + плюшки
        const supportText = this.getRandomSupportText();
        const responseText = `<i>${supportText}</i>\n\n${this.buildSecondPart(session.messageData)}`;
        
        session.currentStep = 'waiting_positive';
        
        // Отправляем ответ в чат
        const sendOptions: any = {
          parse_mode: 'HTML',
          reply_parameters: {
            message_id: messageId
          }
        };
        
        const forwardedMessageId = this.forwardedMessages.get(session.channelMessageId || 0);
        if (forwardedMessageId) {
          sendOptions.reply_to_message_id = forwardedMessageId;
        }
        
        await this.bot.telegram.sendMessage(replyToChatId, responseText, sendOptions);
        saveMessage(userId, responseText, new Date().toISOString(), 0);
        
      } else if (session.currentStep === 'waiting_positive') {
        // Ответ на плюшки - отправляем финальную часть
        schedulerLogger.info({ 
          userId,
          currentStep: session.currentStep,
          messageText: messageText.substring(0, 50)
        }, '📝 Получен ответ на плюшки, отправляем задание 3');
        
        let finalMessage = 'У нас остался последний шаг\n\n';
        if (session.relaxationType === 'body') {
          finalMessage += '3. <b>Расслабление тела</b>\nОт Ирины 👉🏻 clck.ru/3LmcNv 👈🏻 или свое';
        } else {
          finalMessage += '3. <b>Дыхательная практика</b>';
        }

        // Добавляем кнопки к заданию 3
        // Используем adminChatId для callback_data, так как сессия создается с ним
        const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);
        const callbackUserId = adminChatId || userId;
        
        const practiceKeyboard = {
          inline_keyboard: [
            [{ text: '✅ Сделал', callback_data: `practice_done_${callbackUserId}` }],
            [{ text: '⏰ Отложить на 1 час', callback_data: `practice_postpone_${callbackUserId}` }]
          ]
        };

        const finalOptions: any = {
          parse_mode: 'HTML',
          reply_parameters: {
            message_id: messageId
          },
          reply_markup: practiceKeyboard
        };
        
        // ВАЖНО: Используем ту же логику, что и для первого задания
        const forwardedMessageId = this.forwardedMessages.get(session.channelMessageId || 0);
        if (forwardedMessageId) {
          finalOptions.reply_to_message_id = forwardedMessageId;
          schedulerLogger.info({ 
            forwardedMessageId,
            channelMessageId: session.channelMessageId,
            replyToChatId 
          }, 'Используем reply_to_message_id для финального сообщения в комментариях');
        } else {
          schedulerLogger.warn('⚠️ Не нашли пересланное сообщение для финального сообщения');
        }
        
        await this.bot.telegram.sendMessage(replyToChatId, finalMessage, finalOptions);

        // Сохраняем сообщение и обновляем состояние
        saveMessage(userId, finalMessage, new Date().toISOString(), 0);
        session.currentStep = 'waiting_practice'; // Ждем выполнения практики
        
        // Удаляем сессию через некоторое время
        setTimeout(() => {
          this.interactiveSessions.delete(userId);
        }, 300000); // 5 минут
        
      } else if (session.currentStep === 'waiting_practice') {
        // Пользователь написал что-то после получения задания с кнопками
        // Просто игнорируем это сообщение, пусть нажимает кнопки
        schedulerLogger.debug({ userId }, 'Игнорируем сообщение - ждем нажатия кнопки');
        return true; // Но все равно возвращаем true, чтобы не обрабатывать как обычное сообщение
      }

      return true; // Обработано в интерактивном режиме
    } catch (error) {
      schedulerLogger.error({ error, userId }, 'Ошибка обработки интерактивного ответа');
      return false;
    }
  }

  // Очистка всех таймеров при завершении работы
  destroy() {
    logger.info('Stop scheduler...');

    // Останавливаем cron jobs
    if (this.dailyCronJob) {
      this.dailyCronJob.stop();
      this.dailyCronJob = null;
      logger.info('Daily cron job stopped');
    }

    if (this.morningCheckCronJob) {
      this.morningCheckCronJob.stop();
      this.morningCheckCronJob = null;
      logger.info('Morning check cron job stopped');
    }

    // Очищаем все напоминания
    for (const [, timeout] of this.reminderTimeouts.entries()) {
      clearTimeout(timeout);
    }
    this.reminderTimeouts.clear();

    logger.info('Scheduler stopped');
  }
}
