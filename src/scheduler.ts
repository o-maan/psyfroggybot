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
  // ID видео с дыхательной практикой
  private readonly PRACTICE_VIDEO_ID = 'BQACAgIAAxkBAAIHiWi7gI54mWxy173IbTomY9MQTU7QAAIdgAACqU_YSajypMDh_PIUNgQ';
  // private readonly REMINDER_USER_ID = 5153477378; // больше не используется, теперь динамически используем chatId
  private calendarService: CalendarService;
  private dailyCronJob: cron.ScheduledTask | null = null;
  private morningCheckCronJob: cron.ScheduledTask | null = null;
  private testModeCheckTimeout: NodeJS.Timeout | null = null;
  // Для хранения состояния интерактивных сессий
  private interactiveSessions: Map<
    number,
    {
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
    }
  > = new Map();

  // Для хранения ID пересланных сообщений
  private forwardedMessages: Map<number, number> = new Map(); // channelMessageId -> discussionMessageId

  constructor(bot: Telegraf, calendarService: CalendarService) {
    this.bot = bot;
    this.calendarService = calendarService;
    this.loadImages();
    this.loadUsers();

    // Инициализируем расписание для всех ботов
    this.initializeDailySchedule();
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

      schedulerLogger.info(
        {
          promptName,
          responseLength: response.length,
          cleanedLength: cleanedResponse.length,
          response: cleanedResponse.substring(0, 100),
        },
        'Ответ от LLM получен'
      );

      // Если ответ слишком короткий, слишком длинный или это просто "Отлично", используем fallback
      if (
        cleanedResponse.length < 20 ||
        cleanedResponse.length > 150 ||
        cleanedResponse.toLowerCase() === 'отлично' ||
        cleanedResponse === 'HF_JSON_ERROR'
      ) {
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
          'Замечательно! ⭐ Ты проявил заботу о себе.',
        ];
        return fallbacks[Math.floor(Math.random() * fallbacks.length)];
      }
      return 'Отлично! 👍';
    }
  }

  // Сохранить ID пересланного сообщения
  saveForwardedMessage(channelMessageId: number, discussionMessageId: number) {
    this.forwardedMessages.set(channelMessageId, discussionMessageId);

    // Сохраняем маппинг в БД
    const { saveThreadMapping } = require('./db');
    saveThreadMapping(channelMessageId, discussionMessageId);

    schedulerLogger.debug(
      {
        channelMessageId,
        discussionMessageId,
      },
      'Сохранен ID пересланного сообщения'
    );
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

  // Получить ID основного пользователя из env (fallback: USER_ID или дефолт)
  public getMainUserId(): number {
    return Number(process.env.MAIN_USER_ID || process.env.USER_ID || 5153477378);
  }

  // Получить ID тестового пользователя из env (fallback: дефолт)
  public getTestUserId(): number {
    return Number(process.env.TEST_USER_ID || 476561547);
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
      // Для тестового бота используем тестового пользователя из env
      return this.getTestUserId();
    }
    // Для основного бота используем MAIN_USER_ID/USER_ID
    return this.getMainUserId();
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

  // Проверяем, является ли текущий день выходным (суббота или воскресенье)
  private isWeekend(date: Date = new Date()): boolean {
    const dayOfWeek = date.getDay();
    return dayOfWeek === 0 || dayOfWeek === 6; // 0 - воскресенье, 6 - суббота
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
    // TODO: Временно отключаем расслабление тела, оставляем только дыхательную практику
    // if (Math.random() < 0.5) {
    //   parts.push(`${n++}. <b>Расслабление тела</b>\nОт Ирины 👉🏻 clck.ru/3LmcNv 👈🏻 или свое`);
    // } else {
    parts.push(`${n++}. <b>Дыхательная практика</b>`);
    // }

    return parts.filter(Boolean).join('\n\n').trim();
  }

  // Новый метод для интерактивной генерации сообщения
  private async buildInteractiveMessage(json: any): Promise<{
    firstPart: string;
    messageData: any;
    relaxationType: 'body' | 'breathing';
  }> {
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
    // TODO: Временно отключаем расслабление тела, оставляем только дыхательную практику
    const relaxationType: 'body' | 'breathing' = 'breathing'; // Math.random() < 0.5 ? 'body' : 'breathing';

    // Проверяем, выходной ли сегодня день
    const isWeekendToday = this.isWeekend();
    
    let firstPart: string;
    
    if (isWeekendToday) {
      // В выходные генерируем специальный текст поддержки
      try {
        const weekendPrompt = readFileSync('assets/prompts/weekend-encouragement.md', 'utf-8');
        const weekendResponse = await generateMessage(weekendPrompt);
        
        if (weekendResponse && weekendResponse !== 'HF_JSON_ERROR') {
          const cleanedResponse = removeThinkTags(weekendResponse);
          try {
            const weekendJson = JSON.parse(cleanedResponse.replace(/```json|```/gi, '').trim());
            firstPart = `<i>${escapeHTML(weekendJson.encouragement.text)}</i>`;
          } catch {
            // Fallback на обычный текст
            firstPart = `<i>${escapeHTML(json.encouragement.text)}</i>`;
          }
        } else {
          // Fallback на обычный текст
          firstPart = `<i>${escapeHTML(json.encouragement.text)}</i>`;
        }
      } catch (error) {
        schedulerLogger.warn({ error }, 'Ошибка генерации текста для выходных, используем обычный');
        firstPart = `<i>${escapeHTML(json.encouragement.text)}</i>`;
      }
    } else {
      // В будни используем обычный вдохновляющий текст
      firstPart = `<i>${escapeHTML(json.encouragement.text)}</i>`;
    }

    return {
      firstPart,
      messageData: json,
      relaxationType,
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
    schedulerLogger.info(
      { chatId, jsonLength: jsonText?.length || 0 },
      `📝 LLM ответ получен для интерактивного режима`
    );

    if (jsonText === 'HF_JSON_ERROR') {
      schedulerLogger.warn({ chatId }, '❌ LLM вернул HF_JSON_ERROR в интерактивном режиме');
      const fallback = readFileSync('assets/fallback_text', 'utf-8');
      // Для поста используем простое сообщение
      const postFallback = 'Надеюсь, у тебя был хороший день!';
      // Возвращаем fallback как JSON
      return {
        json: {
          encouragement: { text: fallback },
          negative_part: { additional_text: '' },
          positive_part: { additional_text: '' },
        },
        firstPart: postFallback,
        relaxationType: 'breathing',
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
      // Для поста используем простое сообщение
      const postFallback = 'Надеюсь, у тебя был хороший день!';
      return {
        json: {
          encouragement: { text: fallback },
          negative_part: { additional_text: '' },
          positive_part: { additional_text: '' },
        },
        firstPart: postFallback,
        relaxationType: 'breathing',
      };
    }

    // Используем интерактивный билдер
    const interactiveData = await this.buildInteractiveMessage(json);

    return {
      json,
      firstPart: interactiveData.firstPart,
      relaxationType: interactiveData.relaxationType,
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
        schedulerLogger.debug(
          { chatId, error: (calendarError as Error).message },
          'Календарь недоступен, продолжаем без него'
        );
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
      '🌸 Все классно - пропустить',
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
      schedulerLogger.debug(
        {
          chatId,
          isTestBot: this.isTestBot(),
          channelId: this.CHANNEL_ID,
          chatGroupId: this.getChatId(),
          isManualCommand,
        },
        'Начало отправки интерактивного сообщения'
      );

      // Показываем, что бот "пишет" (реакция)
      await this.bot.telegram.sendChatAction(this.CHANNEL_ID, 'upload_photo');

      // Генерируем интерактивное сообщение
      const { json, firstPart, relaxationType } = await this.generateInteractiveScheduledMessage(chatId);

      // Получаем события календаря для генерации изображения
      let calendarEvents = null;
      try {
        calendarEvents = await getUserTodayEvents(chatId);
      } catch (calendarError) {
        schedulerLogger.debug(
          { chatId, error: (calendarError as Error).message },
          'Календарь недоступен, продолжаем без него'
        );
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
      
      // Генерируем слова поддержки для оценок дня ДО отправки
      schedulerLogger.info({ chatId }, '🎯 Генерируем слова поддержки для оценок дня');
      const { generateDayRatingSupportWords, getDefaultSupportWords } = await import('./utils/support-words');
      
      let supportWords;
      try {
        supportWords = await generateDayRatingSupportWords();
      } catch (error) {
        schedulerLogger.error({ error }, 'Ошибка генерации слов поддержки, используем дефолтные');
        supportWords = getDefaultSupportWords();
      }
      
      // Определяем пользователя для поста из env, с учетом режима бота
      const postUserId = this.isTestBot() ? this.getTestUserId() : this.getMainUserId();
      
      // Добавляем слова поддержки в message_data
      const messageDataWithSupport = {
        ...json,
        day_rating_support: supportWords
      };
      
      // СНАЧАЛА сохраняем в БД (используем временный ID)
      const tempMessageId = Date.now(); // Временный ID на основе timestamp
      
      const { saveInteractivePost } = await import('./db');
      try {
        saveInteractivePost(tempMessageId, postUserId, messageDataWithSupport, relaxationType);
        schedulerLogger.info({ tempMessageId, chatId }, '💾 Пост предварительно сохранен в БД с временным ID');
      } catch (dbError) {
        schedulerLogger.error({ error: dbError, chatId }, '❌ Критическая ошибка: не удалось сохранить пост в БД');
        // Если не удалось сохранить в БД - НЕ отправляем в Telegram
        // Уведомляем админа о критической ошибке
        const adminChatId = this.getAdminChatId();
        if (adminChatId) {
          await this.bot.telegram.sendMessage(adminChatId, `❌ Критическая ошибка при отправке поста пользователю ${chatId}: не удалось сохранить в БД\n\nОшибка: ${(dbError as Error).message}`)
            .catch(err => schedulerLogger.error({ error: err }, 'Не удалось отправить уведомление админу'));
        }
        return;
      }

      // Отправляем основной пост БЕЗ кнопок
      let sentMessage;
      if (imageBuffer) {
        // Отправляем сгенерированное изображение
        sentMessage = await this.bot.telegram.sendPhoto(
          this.CHANNEL_ID,
          { source: imageBuffer },
          {
            caption: captionWithComment,
            parse_mode: 'HTML',
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
            timestamp: postSentTime.getTime(),
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
            parse_mode: 'HTML',
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
      
      // Обновляем временный ID на реальный после успешной отправки
      try {
        const db = await import('./db');
        const updateQuery = db.db.query(`
          UPDATE interactive_posts 
          SET channel_message_id = ? 
          WHERE channel_message_id = ?
        `);
        updateQuery.run(messageId, tempMessageId);
        schedulerLogger.info({ tempMessageId, messageId, chatId }, '✅ ID поста обновлен на реальный после отправки');
      } catch (updateError) {
        schedulerLogger.error({ error: updateError, tempMessageId, messageId }, '❌ Ошибка обновления ID поста');
        // Создаем fallback запись с правильным ID
        try {
          const { saveInteractivePost } = await import('./db');
          saveInteractivePost(messageId, postUserId, messageDataWithSupport, relaxationType);
          // Удаляем временную запись
          const deleteQuery = db.db.query('DELETE FROM interactive_posts WHERE channel_message_id = ?');
          deleteQuery.run(tempMessageId);
          schedulerLogger.info({ messageId }, '✅ Создана fallback запись с правильным ID');
        } catch (fallbackError) {
          schedulerLogger.error({ error: fallbackError }, '❌ Критическая ошибка: не удалось создать fallback запись');
        }
      }

      // Готовим выбор сценария для отправки в комментарии
      const scenarioChoiceText = '<b>Как сегодня хочешь поработать?</b>';
      
      const scenarioChoiceKeyboard = {
        inline_keyboard: [
          [{ text: 'Упрощенный сценарий 🧩', callback_data: `scenario_simplified_${messageId}` }],
          [{ text: 'Глубокая работа 🧘🏻', callback_data: `scenario_deep_${messageId}` }]
        ],
      };

      // Получаем ID группы обсуждений
      const CHAT_ID = this.getChatId();

      if (!CHAT_ID) {
        schedulerLogger.error('❌ CHAT_ID не настроен в .env - не можем отправить первое задание в группу обсуждений');
        return;
      }

      // Отправляем выбор сценария асинхронно после появления пересланного сообщения
      this.sendFirstTaskAsync(messageId, scenarioChoiceText, scenarioChoiceKeyboard, 'scenario_choice', chatId, CHAT_ID);

      schedulerLogger.info(
        {
          channelMessageId: messageId,
          channelId: this.CHANNEL_ID,
          chatId: CHAT_ID,
          type: 'scenario_choice',
        },
        '✅ Процесс отправки выбора сценария запущен асинхронно'
      );

      // Сохраняем сообщение в истории
      const startTime = new Date().toISOString();
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
      schedulerLogger.error(
        { error: error.message, stack: error.stack, chatId },
        'Ошибка отправки интерактивного сообщения'
      );
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

      schedulerLogger.info(
        {
          channelMessageId,
          CHAT_ID,
          checkInterval: `${checkInterval / 1000}s`,
        },
        '🔍 Начинаем периодическую проверку пересланного сообщения'
      );

      while (!forwardedMessageId && attempts < maxAttempts) {
        attempts++;

        // Проверяем сразу, потом ждем
        forwardedMessageId = this.forwardedMessages.get(channelMessageId) || null;

        if (forwardedMessageId) {
          schedulerLogger.info(
            {
              forwardedMessageId,
              channelMessageId,
              attempts,
              waitedSeconds: (attempts * checkInterval) / 1000,
            },
            '✅ Найден ID пересланного сообщения в группе'
          );
          break;
        }

        // Логируем прогресс
        if (attempts % 3 === 0) {
          // Каждые 15 секунд
          schedulerLogger.debug(
            {
              attempts,
              channelMessageId,
              waitedMinutes: ((attempts * checkInterval) / 1000 / 60).toFixed(1),
              forwardedMessagesCount: this.forwardedMessages.size,
            },
            '⏳ Продолжаем ждать пересланное сообщение...'
          );
        }

        // Ждем до следующей проверки
        await new Promise(resolve => setTimeout(resolve, checkInterval));
      }

      // Отправляем первое задание
      const messageOptions: any = {
        parse_mode: 'HTML',
        reply_markup: firstTaskKeyboard,
        disable_notification: true,
      };

      if (forwardedMessageId) {
        // Отправляем как комментарий к посту
        // В Telegram для комментариев используется reply_to_message_id
        messageOptions.reply_to_message_id = forwardedMessageId;

        const firstTaskMessage = await this.bot.telegram.sendMessage(CHAT_ID, firstTaskFullText, messageOptions);

        schedulerLogger.info(
          {
            success: true,
            firstTaskId: firstTaskMessage.message_id,
            channelMessageId,
            forwardedMessageId,
            chat_id: CHAT_ID,
            waitedSeconds: (attempts * checkInterval) / 1000,
          },
          '✅ Сообщение отправлено как комментарий к посту'
        );

        // Для выбора сценария не обновляем состояние в БД - это сделает обработчик кнопки
      } else {
        // Таймаут - отправляем в группу с пометкой
        schedulerLogger.warn(
          {
            channelMessageId,
            attempts,
            maxAttempts,
            waitedMinutes: ((maxAttempts * checkInterval) / 1000 / 60).toFixed(1),
          },
          '⚠️ Таймаут ожидания пересланного сообщения, отправляем в группу с пометкой'
        );

        const firstTaskMessage = await this.bot.telegram.sendMessage(CHAT_ID, firstTaskFullText, messageOptions);

        schedulerLogger.info(
          {
            success: true,
            firstTaskId: firstTaskMessage.message_id,
            channelMessageId,
            chat_id: CHAT_ID,
            used_note: true,
          },
          '✅ Сообщение отправлено в группу с пометкой'
        );

        // Для выбора сценария не обновляем состояние в БД - это сделает обработчик кнопки
      }
    } catch (error) {
      schedulerLogger.error(
        {
          error: (error as Error).message,
          stack: (error as Error).stack,
          channelMessageId,
          CHAT_ID,
        },
        '❌ Ошибка асинхронной отправки сообщения'
      );
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
    const TARGET_USER_ID = this.getMainUserId();
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
    // Всегда проверяем целевого пользователя из конфигурации
    const TARGET_USER_ID = this.getMainUserId();

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

  // Построение второй части сообщения
  public buildSecondPart(json: any): string {
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
    const hasEmotions =
      /радост|груст|злость|страх|тревог|спокой|счаст|обид|разочаров|восторг|удивл|стыд|вин|гнев|ярост|паник|беспокой|умиротвор|блажен|восхищ|отвращ|презр|ненавист|любовь|нежн|тепл|холод|пуст|тоск|печаль|горе|отчаян|безнадежн|апат|равнодуш|скук|интерес|азарт|воодушевл|энтузиа|надежд|вер|довер|сомнен|подозрен|насторож|уверен|решительн|смел|робост|застенчив|смущен|неловк|гордост|высокомер|униж|оскорбл|благодарн|признательн|зависть|ревность|жалость|сочувств|сострадан|эмпат|одиночеств|покинут|нужн|важн|значим|беспомощн|бессил|сил|мощ|энерг|устал|истощ|вымотан|опустошен/i.test(
        response
      );
    const hasFeelWords = /чувств|ощущ|эмоц|настроен|состоян/i.test(response);
    const significantWords =
      /важн|серьезн|сложн|проблем|тяжел|невыносим|катастроф|кризис|критич|опасн|угроз|беспокоит|волнует|тревожит|мучает|терзает|гложет|довод|изматывает|подавляет|давит|душит/i.test(
        response
      );

    // Проверяем, описал ли пользователь эмоции
    const emotionsDescribed = hasEmotions || hasFeelWords;

    if (words > 15 && emotionsDescribed) {
      // Вариант 1: Пользователь подробно описал эмоции
      return {
        detailed: true,
        needsClarification: false,
        significant: false,
        supportText: this.getRandomSupportText(),
      };
    } else if (words < 10 && !emotionsDescribed) {
      // Вариант 2: Пользователь не описал эмоции И мало написал
      return {
        detailed: false,
        needsClarification: true,
        significant: false,
      };
    } else if (significantWords) {
      // Вариант 3: Было значимое/важное событие
      return {
        detailed: false,
        needsClarification: false,
        significant: true,
      };
    } else {
      // По умолчанию переходим к плюшкам с базовой поддержкой
      return {
        detailed: true,
        needsClarification: false,
        significant: false,
        supportText: this.getRandomSupportText(),
      };
    }
  }

  // Получить случайный текст поддержки
  public getRandomSupportText(): string {
    const supportTexts = [
      'Спасибо, что поделился 💚',
      'Понимаю тебя 🤗',
      'Это действительно непросто 💛',
      'Ты молодец, что проговариваешь это 🌱',
      'Твои чувства важны 💙',
      'Слышу тебя 🤍',
      'Благодарю за доверие 🌿',
    ];
    return supportTexts[Math.floor(Math.random() * supportTexts.length)];
  }

  // Определяем текущий шаг на основе состояния задач в БД
  private determineCurrentStep(post: any): string {
    // Приоритет у current_state из БД
    if (post.current_state) {
      return post.current_state;
    }

    // Fallback логика для старых записей
    if (!post.task1_completed) {
      // Если первое задание не выполнено
      if (post.bot_schema_message_id && !post.user_schema_message_id) {
        // Если схема отправлена, но пользователь не ответил - ждем ответа на схему
        return 'waiting_schema';
      } else {
        // Иначе ждем ответа на негатив
        return 'waiting_negative';
      }
    } else if (post.task1_completed && !post.task2_completed) {
      // Первое выполнено, второе нет - ждем ответа на плюшки
      return 'waiting_positive';
    } else if (post.task2_completed && !post.task3_completed) {
      // Два задания выполнены, третье нет - ждем выполнения практики
      return 'waiting_practice';
    } else {
      // Все задания выполнены
      return 'finished';
    }
  }

  // Обработка ответа пользователя в интерактивной сессии
  public async handleInteractiveUserResponse(
    userId: number,
    messageText: string,
    replyToChatId: number,
    messageId: number,
    messageThreadId?: number
  ) {
    // Интерактивные ответы ВКЛЮЧЕНЫ - это нужно для работы логики заданий
    const INTERACTIVE_RESPONSES_ENABLED = true; // Это НУЖНО для работы заданий!

    // Пытаемся найти активный пост пользователя в БД
    const { getUserIncompletePosts, getInteractivePost } = await import('./db');

    // Если есть messageThreadId, это может быть ID поста в канале
    let activePost = null;
    let channelMessageId = null;

    if (messageThreadId) {
      // В тестовом канале messageThreadId - это ID пересланного сообщения
      // Нужно найти соответствующий пост через маппинг
      schedulerLogger.debug(
        {
          messageThreadId,
          userId,
          messageText: messageText.substring(0, 50),
        },
        'Ищем пост по messageThreadId'
      );

      // Сначала пробуем найти channelMessageId через маппинг пересланных сообщений
      let mappedChannelId = null;

      // Сначала проверяем в памяти
      for (const [channelId, forwardedId] of this.forwardedMessages.entries()) {
        if (forwardedId === messageThreadId) {
          mappedChannelId = channelId;
          break;
        }
      }

      // Если не нашли в памяти, проверяем в БД
      if (!mappedChannelId) {
        const { getChannelMessageIdByThreadId } = require('./db');
        mappedChannelId = getChannelMessageIdByThreadId(messageThreadId);
      }

      if (mappedChannelId) {
        activePost = getInteractivePost(mappedChannelId);
        if (activePost) {
          channelMessageId = mappedChannelId;
          schedulerLogger.info(
            {
              userId,
              channelMessageId,
              messageThreadId,
              foundByMapping: true,
              postData: {
                task1: activePost.task1_completed,
                task2: activePost.task2_completed,
                task3: activePost.task3_completed,
              },
            },
            'Найден пост через маппинг пересланных сообщений'
          );
        }
      }

      // Если не нашли через маппинг, пробуем напрямую
      if (!activePost) {
        activePost = getInteractivePost(messageThreadId);
        if (activePost) {
          channelMessageId = messageThreadId;
          schedulerLogger.info(
            {
              userId,
              channelMessageId,
              foundByThreadId: true,
              postData: {
                task1: activePost.task1_completed,
                task2: activePost.task2_completed,
                task3: activePost.task3_completed,
              },
            },
            'Найден пост по messageThreadId напрямую'
          );
        } else {
          schedulerLogger.warn(
            {
              messageThreadId,
              userId,
              mappedChannelId,
            },
            'Пост НЕ найден ни через маппинг, ни напрямую'
          );
        }
      }
    }

    // Если не нашли по threadId, ищем незавершенные посты пользователя
    if (!activePost) {
      const incompletePosts = getUserIncompletePosts(userId);

      schedulerLogger.info(
        {
          userId,
          incompletePostsCount: incompletePosts.length,
          messageThreadId,
        },
        'Проверка незавершенных постов пользователя'
      );

      if (incompletePosts.length === 0) {
        // Нет активных постов
        schedulerLogger.debug({ userId }, 'Нет активных интерактивных постов');
        return false;
      }

      // Берем самый последний незавершенный пост
      activePost = incompletePosts[0];
      channelMessageId = activePost.channel_message_id;
    }

    // Создаем объект session из данных БД для обратной совместимости
    const session = {
      messageData: activePost.message_data,
      relaxationType: activePost.relaxation_type,
      channelMessageId: channelMessageId,
      currentStep: this.determineCurrentStep(activePost),
    };

    schedulerLogger.info(
      {
        userId,
        step: session.currentStep,
        messageText: messageText.substring(0, 50),
      },
      'Обработка интерактивного ответа пользователя'
    );

    // Импортируем функцию обновления статуса
    const { updateTaskStatus } = await import('./db');

    try {
      // Проверяем глубокий сценарий - ожидание списка ситуаций
      if (session.currentStep === 'deep_waiting_situations_list') {
        schedulerLogger.info(
          {
            userId,
            channelMessageId,
            messageText: messageText.substring(0, 50),
            scenario: 'deep',
          },
          'Получен список ситуаций в глубоком сценарии'
        );

        // Используем слова поддержки из messageData
        let supportText = session.messageData?.deep_support?.text;
        
        // Если слова поддержки не были сгенерированы, используем fallback
        if (!supportText) {
          supportText = 'Понимаю, как тебе сейчас непросто';
        }

        // Второй этап - отправляем слова поддержки + задание с кнопкой
        const secondTaskText = `<i>${escapeHTML(supportText)}</i>\n\nВыбери ситуацию, с которой хочешь поработать, и опиши ее подробно 📝`;
        
        // Кнопка "Таблица эмоций"
        const emotionsTableKeyboard = {
          inline_keyboard: [[{ text: 'Таблица эмоций', callback_data: `emotions_table_${channelMessageId}` }]],
        };

        // Отправляем второе сообщение с кнопкой
        const secondTaskMessage = await this.bot.telegram.sendMessage(replyToChatId, secondTaskText, {
          parse_mode: 'HTML',
          reply_markup: emotionsTableKeyboard,
          reply_parameters: {
            message_id: messageId,
          },
        });

        // Обновляем состояние - теперь ждем выбранную ситуацию
        const { updateInteractivePostState } = await import('./db');
        updateInteractivePostState(channelMessageId, 'deep_waiting_negative', {
          bot_task2_message_id: secondTaskMessage.message_id,
          user_task1_message_id: messageId,
        });

        return;
      }
      
      // Проверяем глубокий сценарий
      if (session.currentStep === 'deep_waiting_negative') {
        // Пользователь ответил на первое задание в глубоком сценарии
        schedulerLogger.info(
          {
            userId,
            channelMessageId,
            messageText: messageText.substring(0, 50),
            scenario: 'deep',
          },
          'Получен ответ на первое задание (глубокий сценарий)'
        );

        // Импортируем функцию получения обработчика глубокой работы
        const { getDeepWorkHandler } = await import('./handlers/callbacks/deep_work_buttons');
        const deepHandler = getDeepWorkHandler(this.bot, replyToChatId);
        
        // Анализируем ответ и выбираем технику
        await deepHandler.analyzeUserResponse(channelMessageId, messageText, userId, messageId);
        
        return;
      }
      
      // Обработка глубоких состояний
      if (session.currentStep === 'deep_waiting_thoughts') {
        const { getDeepWorkHandler } = await import('./handlers/callbacks/deep_work_buttons');
        const deepHandler = getDeepWorkHandler(this.bot, replyToChatId);
        await deepHandler.handleThoughtsResponse(channelMessageId, messageText, userId, messageId);
        return;
      }
      
      if (session.currentStep === 'deep_waiting_distortions') {
        const { getDeepWorkHandler } = await import('./handlers/callbacks/deep_work_buttons');
        const deepHandler = getDeepWorkHandler(this.bot, replyToChatId);
        await deepHandler.handleDistortionsResponse(channelMessageId, messageText, userId, messageId);
        return;
      }
      
      if (session.currentStep === 'deep_waiting_rational') {
        // Завершаем работу с фильтрами
        const sendOptions: any = { 
          parse_mode: 'HTML',
          reply_parameters: {
            message_id: messageId
          }
        };
        
        const sendOptionsWithButton: any = { 
          parse_mode: 'HTML',
          reply_parameters: {
            message_id: messageId
          },
          reply_markup: {
            inline_keyboard: [[
              { text: 'Вперед 🔥', callback_data: `deep_continue_to_treats_${channelMessageId}` }
            ]]
          }
        };
        
        await this.bot.telegram.sendMessage(replyToChatId, 
          '<i>🎉 Отлично! Сложная часть позади!\n' +
          'Можно выдохнуть 😌</i>\n\n' +
          'Перейдем к более приятной 🤗',
          sendOptionsWithButton
        );
        
        const { updateInteractivePostState, updateTaskStatus } = await import('./db');
        updateInteractivePostState(channelMessageId, 'deep_waiting_continue_to_treats');
        updateTaskStatus(channelMessageId, 1, true);
        
        return;
      }
      
      if (session.currentStep === 'deep_waiting_positive') {
        // Ответ на плюшки в глубоком сценарии - отправляем финальную часть
        schedulerLogger.info(
          {
            userId,
            channelMessageId,
            messageText: messageText.substring(0, 50),
          },
          '📝 Получен ответ на плюшки (глубокий сценарий), отправляем дыхательную практику'
        );

        // Отмечаем второе задание как выполненное
        const { updateTaskStatus } = await import('./db');
        updateTaskStatus(channelMessageId, 2, true);

        let finalMessage = '<i>Вау! 🤩 Ты справился! Это было потрясающе!</i>\n\n';
        finalMessage += 'Последний шаг - время замедлиться и побыть в покое 🤍\n';
        finalMessage += '3. <b>Дыхательная практика</b>\n\n';
        finalMessage += '<blockquote><b>Дыхание по квадрату:</b>\nВдох на 4 счета, задержка дыхания на 4 счета, выдох на 4 счета и задержка на 4 счета</blockquote>';

        // Добавляем кнопки к заданию 3
        const practiceKeyboard = {
          inline_keyboard: [
            [{ text: '✅ Сделал', callback_data: `pract_done_${channelMessageId}` }],
            [{ text: '⏰ Отложить на 1 час', callback_data: `pract_delay_${channelMessageId}` }],
          ],
        };

        const finalOptions: any = {
          parse_mode: 'HTML',
          reply_parameters: {
            message_id: messageId,
          },
          reply_markup: practiceKeyboard,
        };

        // Отправляем видео с дыхательной практикой
        const task3Message = await this.bot.telegram.sendVideo(replyToChatId, this.PRACTICE_VIDEO_ID, {
          caption: finalMessage,
          parse_mode: 'HTML',
          reply_parameters: {
            message_id: messageId,
          },
          reply_markup: practiceKeyboard,
        });

        // Сохраняем сообщение
        saveMessage(userId, finalMessage, new Date().toISOString(), 0);

        // Обновляем состояние в БД
        const { updateInteractivePostState } = await import('./db');
        updateInteractivePostState(channelMessageId, 'deep_waiting_practice', {
          bot_task3_message_id: task3Message.message_id,
          user_task2_message_id: messageId,
        });

        return;
      }
      
      // Обработка состояний разбора по схеме
      if (session.currentStep === 'schema_waiting_trigger') {
        const { getDeepWorkHandler } = await import('./handlers/callbacks/deep_work_buttons');
        const deepHandler = getDeepWorkHandler(this.bot, replyToChatId);
        await deepHandler.handleTriggerResponse(channelMessageId, messageText, userId, messageId);
        return;
      }
      
      if (session.currentStep === 'schema_waiting_thoughts') {
        const { getDeepWorkHandler } = await import('./handlers/callbacks/deep_work_buttons');
        const deepHandler = getDeepWorkHandler(this.bot, replyToChatId);
        await deepHandler.handleSchemaThoughtsResponse(channelMessageId, messageText, userId, messageId);
        return;
      }
      
      if (session.currentStep === 'schema_waiting_emotions') {
        const { getDeepWorkHandler } = await import('./handlers/callbacks/deep_work_buttons');
        const deepHandler = getDeepWorkHandler(this.bot, replyToChatId);
        await deepHandler.handleSchemaEmotionsResponse(channelMessageId, messageText, userId, messageId);
        return;
      }
      
      if (session.currentStep === 'schema_waiting_behavior') {
        const { getDeepWorkHandler } = await import('./handlers/callbacks/deep_work_buttons');
        const deepHandler = getDeepWorkHandler(this.bot, replyToChatId);
        await deepHandler.handleSchemaBehaviorResponse(channelMessageId, messageText, userId, messageId);
        return;
      }
      
      if (session.currentStep === 'schema_waiting_correction') {
        const { getDeepWorkHandler } = await import('./handlers/callbacks/deep_work_buttons');
        const deepHandler = getDeepWorkHandler(this.bot, replyToChatId);
        await deepHandler.handleSchemaCorrectionResponse(channelMessageId, messageText, userId, messageId);
        return;
      }
      
      if (session.currentStep === 'waiting_negative') {
        // Пользователь ответил на первое задание
        schedulerLogger.info(
          {
            userId,
            channelMessageId,
            messageText: messageText.substring(0, 50),
          },
          'Получен ответ на первое задание'
        );

        // Сохраняем ID сообщения пользователя и обновляем состояние
        const { updateInteractivePostState } = await import('./db');
        updateInteractivePostState(channelMessageId, 'waiting_schema', {
          user_task1_message_id: messageId,
        });

        // Отправляем схему разбора ситуации
        const responseText = `Давай <b>разложим</b> минимум одну ситуацию <b>по схеме</b>:
🗓 Триггер - Мысли - Эмоции - Ощущения в теле - Поведение или импульс к действию`;

        const sendOptions: any = {
          parse_mode: 'HTML',
          reply_parameters: {
            message_id: messageId,
          },
          reply_markup: {
            inline_keyboard: [[{ text: 'Пропустить', callback_data: `skip_schema_${channelMessageId}` }]],
          },
        };

        try {
          const schemaMessage = await this.bot.telegram.sendMessage(replyToChatId, responseText, sendOptions);
          saveMessage(userId, responseText, new Date().toISOString(), 0);

          // Сохраняем ID сообщения со схемой
          updateInteractivePostState(channelMessageId, 'waiting_schema', {
            bot_schema_message_id: schemaMessage.message_id,
          });

          // Обновляем состояние сессии - ждем разбор по схеме
          session.currentStep = 'waiting_schema';
          return true;
        } catch (schemaError) {
          schedulerLogger.error({ error: schemaError }, 'Ошибка отправки схемы, отправляем fallback');
          
          // Fallback: пропускаем схему и сразу отправляем плюшки
          try {
            // Отмечаем первое задание как выполненное
            updateTaskStatus(channelMessageId, 1, true);
            
            // Отправляем минимальные плюшки
            const fallbackText = '2. <b>Плюшки для лягушки</b> (ситуация+эмоция)';
            
            const fallbackMessage = await this.bot.telegram.sendMessage(replyToChatId, fallbackText, {
              parse_mode: 'HTML',
              reply_parameters: { message_id: messageId },
            });
            
            // Обновляем состояние
            updateInteractivePostState(channelMessageId, 'waiting_task2', {
              bot_task2_message_id: fallbackMessage.message_id,
            });
            
            session.currentStep = 'waiting_positive';
            return true;
          } catch (fallbackError2) {
            schedulerLogger.error({ error: fallbackError2 }, 'Критическая ошибка: не удалось отправить даже fallback');
            return false;
          }
        }
      } else if (session.currentStep === 'waiting_schema') {
        // Пользователь ответил на схему разбора
        schedulerLogger.info(
          {
            userId,
            channelMessageId,
            messageText: messageText.substring(0, 50),
          },
          'Получен ответ на схему разбора'
        );

        // Сохраняем ID ответа на схему и обновляем состояние
        const { updateInteractivePostState } = await import('./db');
        updateInteractivePostState(channelMessageId, 'waiting_task2', {
          user_schema_message_id: messageId,
        });

        // Теперь отмечаем первое задание как выполненное
        updateTaskStatus(channelMessageId, 1, true);

        // Отправляем слова поддержки + плюшки
        const supportText = this.getRandomSupportText();
        const responseText = `<i>${supportText}</i>\n\n${this.buildSecondPart(session.messageData)}`;

        const sendOptions: any = {
          parse_mode: 'HTML',
          reply_parameters: {
            message_id: messageId,
          },
        };

        try {
          const task2Message = await this.bot.telegram.sendMessage(replyToChatId, responseText, sendOptions);
          saveMessage(userId, responseText, new Date().toISOString(), 0);

          // Сохраняем ID сообщения с плюшками
          updateInteractivePostState(channelMessageId, 'waiting_task2', {
            bot_task2_message_id: task2Message.message_id,
          });

          // Обновляем состояние - теперь ждем плюшки
          session.currentStep = 'waiting_positive';
          return true;
        } catch (plushkiError) {
          schedulerLogger.error({ error: plushkiError }, 'Ошибка отправки плюшек, отправляем минимальный fallback');
          
          // Fallback: отправляем минимальные плюшки без доп. текста
          try {
            const fallbackText = '2. <b>Плюшки для лягушки</b> (ситуация+эмоция)';
            const fallbackMessage = await this.bot.telegram.sendMessage(replyToChatId, fallbackText, {
              parse_mode: 'HTML',
              reply_parameters: { message_id: messageId },
            });
            
            updateInteractivePostState(channelMessageId, 'waiting_task2', {
              bot_task2_message_id: fallbackMessage.message_id,
            });
            
            session.currentStep = 'waiting_positive';
            return true;
          } catch (criticalError) {
            schedulerLogger.error({ error: criticalError }, 'Критическая ошибка: не удалось отправить даже fallback плюшек');
            return false;
          }
        }
      } else if (session.currentStep === 'waiting_positive' || session.currentStep === 'waiting_task2') {
        // Ответ на плюшки - отправляем финальную часть
        schedulerLogger.info(
          {
            userId,
            currentStep: session.currentStep,
            channelMessageId,
            messageText: messageText.substring(0, 50),
          },
          '📝 Получен ответ на плюшки, отправляем задание 3'
        );

        // Отмечаем второе задание как выполненное
        updateTaskStatus(channelMessageId, 2, true);

        let finalMessage = 'У нас остался последний шаг\n\n';
        finalMessage += '3. <b>Дыхательная практика</b>\n\n';
        finalMessage += '<blockquote><b>Дыхание по квадрату:</b>\nВдох на 4 счета, задержка дыхания на 4 счета, выдох на 4 счета и задержка на 4 счета</blockquote>';

        // Добавляем кнопки к заданию 3
        // Передаем channelMessageId в callback_data для надежности
        const channelMsgId = session.channelMessageId || 0;

        const practiceKeyboard = {
          inline_keyboard: [
            [{ text: '✅ Сделал', callback_data: `pract_done_${channelMsgId}` }],
            [{ text: '⏰ Отложить на 1 час', callback_data: `pract_delay_${channelMsgId}` }],
          ],
        };

        const finalOptions: any = {
          parse_mode: 'HTML',
          reply_parameters: {
            message_id: messageId,
          },
          reply_markup: practiceKeyboard,
        };

        // Для обычных групп с комментариями не нужен message_thread_id
        // Используем только reply_to_message_id который уже установлен выше
        
        try {
          // Отправляем видео с дыхательной практикой
          const task3Message = await this.bot.telegram.sendVideo(replyToChatId, this.PRACTICE_VIDEO_ID, {
            caption: finalMessage,
            parse_mode: 'HTML',
            reply_parameters: {
              message_id: messageId,
            },
            reply_markup: practiceKeyboard,
          });

          // Сохраняем сообщение
          saveMessage(userId, finalMessage, new Date().toISOString(), 0);

          // Обновляем состояние в БД
          const { updateInteractivePostState } = await import('./db');
          updateInteractivePostState(channelMessageId, 'waiting_practice', {
            bot_task3_message_id: task3Message.message_id,
            user_task2_message_id: messageId,
          });

          // Обновляем состояние сессии
          session.currentStep = 'waiting_practice';
          return true;
        } catch (practiceError) {
          schedulerLogger.error({ error: practiceError }, 'Ошибка отправки финального задания, отправляем fallback');
          
          // Fallback: отправляем минимальное сообщение без кнопок
          try {
            const fallbackFinalText = 'У нас остался последний шаг\n\n3. <b>Дыхательная практика</b>\n\n<blockquote><b>Дыхание по квадрату:</b>\nВдох на 4 счета, задержка дыхания на 4 счета, выдох на 4 счета и задержка на 4 счета</blockquote>\n\nОтметьте выполнение ответом в этой ветке.';
            
            // В fallback тоже отправляем видео
            await this.bot.telegram.sendVideo(replyToChatId, this.PRACTICE_VIDEO_ID, {
              caption: fallbackFinalText,
              parse_mode: 'HTML',
              reply_parameters: { message_id: messageId },
            });
            
            // Обновляем состояние сессии все равно
            session.currentStep = 'waiting_practice';
            return true;
          } catch (criticalError) {
            schedulerLogger.error({ error: criticalError }, 'Критическая ошибка: не удалось отправить даже fallback финального задания');
            return false;
          }
        }
      } else if (session.currentStep === 'waiting_practice') {
        // Пользователь написал что-то после получения задания с кнопками
        schedulerLogger.info({ userId, messageText: messageText.substring(0, 50) }, 'Получен текст вместо нажатия кнопки практики');
        
        // Проверяем, отправляли ли мы уже напоминание
        const { updateInteractivePostState } = await import('./db');
        const { getInteractivePost } = await import('./db');
        const post = getInteractivePost(channelMessageId);
        
        if (!post?.practice_reminder_sent) {
          // Отправляем напоминание только один раз
          try {
            await this.bot.telegram.sendMessage(replyToChatId, 'Выполни практику и нажми "Сделал" после ее завершения', {
              reply_parameters: { message_id: messageId },
            });
            
            // Отмечаем, что напоминание отправлено
            updateInteractivePostState(channelMessageId, 'waiting_practice', {
              practice_reminder_sent: true,
            });
            
            schedulerLogger.info({ channelMessageId }, 'Отправлено напоминание о необходимости нажать кнопку');
          } catch (error) {
            schedulerLogger.error({ error }, 'Ошибка отправки напоминания о практике');
          }
        } else {
          // Напоминание уже было отправлено, просто игнорируем
          schedulerLogger.debug({ userId }, 'Игнорируем повторное сообщение - напоминание уже было отправлено');
        }
        
        return true; // Всегда возвращаем true, чтобы не обрабатывать как обычное сообщение
      }

      return true; // Обработано в интерактивном режиме
    } catch (error) {
      schedulerLogger.error({ error, userId }, 'Ошибка обработки интерактивного ответа');
      return false;
    }
  }

  // Проверка незавершенных заданий после запуска бота
  public async checkUncompletedTasks() {
    try {
      schedulerLogger.info('🔍 Проверка незавершенных заданий после запуска бота...');

      const db = await import('./db');
      const { restoreUncompletedDialogs } = await import('./interactive-tracker');

      // Вызываем универсальную функцию восстановления диалогов
      await restoreUncompletedDialogs(this.bot);

      // Получаем все незавершенные посты с учетом нового поля current_state
      const query = db.db.query(`
        SELECT DISTINCT ip.*, u.chat_id as user_chat_id
        FROM interactive_posts ip
        JOIN users u ON ip.user_id = u.chat_id
        WHERE (ip.task1_completed = 0 OR ip.task2_completed = 0 OR ip.task3_completed = 0)
        AND ip.created_at > datetime('now', '-7 days')
        ORDER BY ip.created_at DESC
      `);

      const incompletePosts = query.all() as any[];

      schedulerLogger.info(
        {
          count: incompletePosts.length,
          posts: incompletePosts.map(p => ({
            channelMessageId: p.channel_message_id,
            userId: p.user_id,
            task1: p.task1_completed,
            task2: p.task2_completed,
            task3: p.task3_completed,
            created: p.created_at,
          })),
        },
        `Найдено ${incompletePosts.length} незавершенных постов за последние 7 дней`
      );

      for (const post of incompletePosts) {
        try {
          // Парсим message_data
          if (post.message_data && typeof post.message_data === 'string') {
            post.message_data = JSON.parse(post.message_data);
          }

          const userId = post.user_id;
          const channelMessageId = post.channel_message_id;

          // Используем универсальную систему для проверки последних сообщений
          const messageLinksQuery = db.db.query(`
            SELECT * FROM message_links
            WHERE channel_message_id = ? AND message_type = 'user'
            ORDER BY created_at DESC
            LIMIT 1
          `);
          const lastUserLink = messageLinksQuery.get(channelMessageId) as any;

          if (!lastUserLink) {
            // Fallback к старой системе
            const msgQuery = db.db.query(`
              SELECT m.* FROM messages m
              JOIN users u ON m.user_id = u.id
              WHERE u.chat_id = ? AND m.author_id = ?
              ORDER BY m.sent_time DESC
              LIMIT 1
            `);
            const lastUserMsg = msgQuery.get(userId, userId) as any;

            schedulerLogger.debug(
              {
                userId,
                channelMessageId,
                lastUserMsg: lastUserMsg
                  ? {
                      text: lastUserMsg.message_text?.substring(0, 50),
                      time: lastUserMsg.sent_time,
                    }
                  : null,
              },
              'Результат поиска последнего сообщения (старая система)'
            );

            if (!lastUserMsg) {
              schedulerLogger.debug({ userId }, 'Пользователь еще не писал - пропускаем');
              continue;
            }

            // Проверяем, было ли последнее сообщение после создания поста
            const postTime = new Date(post.created_at).getTime();
            const msgTime = new Date(lastUserMsg.sent_time).getTime();

            if (msgTime > postTime) {
              // Пользователь что-то писал после поста
              const currentStep = this.determineCurrentStep(post);

              schedulerLogger.info(
                {
                  userId,
                  channelMessageId,
                  currentStep,
                  lastMessage: lastUserMsg.message_text.substring(0, 50),
                },
                '📨 Обнаружен пользователь с незавершенным заданием'
              );

              // Генерируем и отправляем ответ в зависимости от текущего шага
              const CHAT_ID = this.getChatId();
              if (CHAT_ID) {
                await this.sendPendingResponse(userId, post, currentStep, CHAT_ID, channelMessageId);

                // Добавляем задержку между отправками, чтобы не перегрузить API
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
            }
          } else {
            // Используем данные из универсальной системы
            const postTime = new Date(post.created_at).getTime();
            const msgTime = new Date(lastUserLink.created_at).getTime();

            schedulerLogger.debug(
              {
                userId,
                channelMessageId,
                messageId: lastUserLink.message_id,
                messageType: lastUserLink.message_type,
                time: lastUserLink.created_at,
              },
              'Найдено последнее сообщение через универсальную систему'
            );

            // Определяем текущий шаг на основе current_state или старой логики
            const currentStep = post.current_state || this.determineCurrentStep(post);

            schedulerLogger.info(
              {
                userId,
                channelMessageId,
                currentStep,
                messageId: lastUserLink.message_id,
              },
              '📨 Обнаружен пользователь с незавершенным заданием (универсальная система)'
            );

            // Генерируем и отправляем ответ в зависимости от текущего шага
            const CHAT_ID = this.getChatId();
            if (CHAT_ID) {
              await this.sendPendingResponse(userId, post, currentStep, CHAT_ID, channelMessageId);

              // Добавляем задержку между отправками, чтобы не перегрузить API
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
        } catch (error) {
          schedulerLogger.error(
            {
              error,
              postId: post.channel_message_id,
            },
            'Ошибка обработки незавершенного поста'
          );
        }
      }

      schedulerLogger.info('✅ Проверка незавершенных заданий завершена');
    } catch (error) {
      schedulerLogger.error({ error }, 'Ошибка проверки незавершенных заданий');
    }
  }

  // Отправка отложенного ответа
  private async sendPendingResponse(
    userId: number,
    post: any,
    currentStep: string,
    chatId: number,
    channelMessageId: number
  ) {
    // Определяем правильный chat_id для отправки
    // Для основного пользователя всегда используем основную группу
    if (userId === this.getMainUserId()) {
      chatId = -1002496122257; // Основная группа
    }

    // Получаем ID пересланного сообщения для правильной отправки в тред
    let threadId: number | undefined;

    // Сначала проверяем в памяти
    threadId = this.forwardedMessages.get(channelMessageId);

    // Если не нашли в памяти, проверяем в БД
    if (!threadId) {
      const { db } = await import('./db');
      const row = db
        .query('SELECT thread_id FROM thread_mappings WHERE channel_message_id = ?')
        .get(channelMessageId) as any;
      if (row?.thread_id) {
        threadId = row.thread_id;
      }
    }

    if (!threadId) {
      schedulerLogger.warn(
        {
          userId,
          channelMessageId,
        },
        '⚠️ Не найден thread_id для незавершенного задания, сообщение будет отправлено в общий чат'
      );
    }

    try {
      const { updateTaskStatus } = await import('./db');

      if (currentStep === 'waiting_negative') {
        // Пользователь уже ответил на первое задание, но бот не успел ответить
        // Отправляем схему разбора ситуации
        const responseText = `Давай <b>разложим</b> минимум одну ситуацию <b>по схеме</b>:
🗓 Триггер - Мысли - Эмоции - Ощущения в теле - Поведение или импульс к действию`;

        const sendOptions: any = {
          parse_mode: 'HTML',
        };

        // Для отправки в комментарии используем reply_to_message_id с ID пересланного сообщения
        // Это автоматически отправит сообщение в правильный тред комментариев
        if (threadId) {
          sendOptions.reply_to_message_id = threadId;
        }

        await this.bot.telegram.sendMessage(chatId, responseText, sendOptions);

        // НЕ обновляем статус, так как пользователь еще не ответил на схему

        schedulerLogger.info(
          {
            userId,
            channelMessageId,
            threadId,
            hasThread: !!threadId,
          },
          '✅ Отправлена схема разбора для незавершенного задания'
        );
      } else if (currentStep === 'waiting_positive') {
        // Отправляем третье задание
        let finalMessage = 'У нас остался последний шаг\n\n';
        // Всегда отправляем дыхательную практику с видео
        finalMessage += '3. <b>Дыхательная практика</b>\n\n';
        finalMessage += '<blockquote><b>Дыхание по квадрату:</b>\nВдох на 4 счета, задержка дыхания на 4 счета, выдох на 4 счета и задержка на 4 счета</blockquote>';

        const practiceKeyboard = {
          inline_keyboard: [
            [{ text: '✅ Сделал', callback_data: `pract_done_${channelMessageId}` }],
            [{ text: '⏰ Отложить на 1 час', callback_data: `pract_delay_${channelMessageId}` }],
          ],
        };

        const sendOptions: any = {
          parse_mode: 'HTML',
          reply_markup: practiceKeyboard,
        };

        // Для комментариев к постам из канала не используем message_thread_id
        // Сообщение будет отправлено как обычное сообщение в группу

        // Отправляем видео с дыхательной практикой
        await this.bot.telegram.sendVideo(chatId, this.PRACTICE_VIDEO_ID, {
          caption: finalMessage,
          ...sendOptions
        });

        updateTaskStatus(channelMessageId, 2, true);

        schedulerLogger.info(
          {
            userId,
            channelMessageId,
            threadId,
            hasThread: !!threadId,
          },
          '✅ Отправлено третье задание для незавершенного поста'
        );
      }
    } catch (error) {
      schedulerLogger.error({ error, userId }, 'Ошибка отправки отложенного ответа');
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
