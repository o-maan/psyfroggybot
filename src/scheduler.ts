import fs, { readFileSync } from 'fs';
import * as cron from 'node-cron';
import path from 'path';
import { Telegraf } from 'telegraf';
import { CalendarService, formatCalendarEvents, getUserTodayEvents } from './calendar';
import {
  addUsedAngryExample,
  addUsedPromptExample,
  addUser,
  clearUserTokens,
  getAllUsers,
  getLastBotMessage,
  getLastUsedAngryExamples,
  getLastUsedPromptExamples,
  getLastUserMessage,
  getUserByChatId,
  getUserImageIndex,
  getUserMessagesSinceLastPost,
  getUserResponseStats,
  incrementAngryPostUserResponse,
  saveMessage,
  saveUserImageIndex,
} from './db';
import { generateFrogImage, generateMessage } from './llm';
import { botLogger, calendarLogger, databaseLogger, logger, schedulerLogger } from './logger';
import { cleanLLMText } from './utils/clean-llm-text';
import { extractJsonFromLLM } from './utils/extract-json-from-llm';
import { fixAlternativeJsonKeys } from './utils/fix-json-keys';
import { isLLMError } from './utils/llm-error-check';

// Функция экранирования для HTML (Telegram)
function escapeHTML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export class Scheduler {
  private bot: Telegraf;
  private reminderTimeouts: Map<number, NodeJS.Timeout> = new Map();
  private users: Set<number> = new Set();
  private imageFiles: string[] = [];
  public readonly CHANNEL_ID = this.getChannelId();
  // Путь к видео с дыхательной практикой
  private readonly PRACTICE_VIDEO_PATH = 'assets/videos/breathing-practice-optimized.mp4';
  // Путь к превью для видео
  private readonly PRACTICE_VIDEO_THUMBNAIL_PATH = 'assets/videos/breathing-practice-thumbnail.jpg';
  // private readonly REMINDER_USER_ID = 5153477378; // больше не используется, теперь динамически используем chatId
  private calendarService: CalendarService;
  private dailyCronJob: cron.ScheduledTask | null = null;
  private morningCheckCronJob: cron.ScheduledTask | null = null;
  private morningMessageCronJob: cron.ScheduledTask | null = null;
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

  // Универсальный метод отправки сообщений с повторными попытками при сетевых ошибках
  private async sendWithRetry(
    sendFunction: () => Promise<any>,
    context: {
      chatId?: number;
      messageType: string;
      retryData?: any; // Дополнительные данные для сложных операций
      maxAttempts?: number; // Возможность задать кастомное количество попыток
      intervalMs?: number; // Возможность задать кастомный интервал
      onSuccess?: (result: any) => Promise<void>; // Коллбэк после успешной отправки
    }
  ): Promise<any> {
    const maxAttempts = context.maxAttempts || 111; // По умолчанию 111 попыток для интерактивных сообщений
    const intervalMs = context.intervalMs || 60000; // По умолчанию 1 минута
    let attempt = 1;

    // Цикл попыток
    while (attempt <= maxAttempts) {
      // Создаем копию context без retryData для логирования вне блока try
      const { retryData, ...contextForLogging } = context;

      try {
        schedulerLogger.info(
          {
            ...contextForLogging,
            attempt,
            maxAttempts,
            intervalMs,
            // Если есть retryData с изображением, логируем только размер
            ...(retryData?.generatedImageBuffer
              ? {
                  imageBufferSize: retryData.generatedImageBuffer.length,
                }
              : {}),
          },
          `🔄 Попытка отправки ${attempt}/${maxAttempts}`
        );

        // Пытаемся отправить
        const result = await sendFunction();

        // Успешно отправлено!
        // Используем contextForLogging без retryData
        schedulerLogger.info(
          {
            ...contextForLogging,
            attempt,
            totalAttempts: maxAttempts,
            // Если есть retryData с изображением, логируем только размер
            ...(retryData?.generatedImageBuffer
              ? {
                  imageBufferSize: retryData.generatedImageBuffer.length,
                }
              : {}),
          },
          `✅ Сообщение успешно отправлено с попытки ${attempt}/${maxAttempts}`
        );

        // Выполняем коллбэк после успешной отправки, если он есть
        if (context.onSuccess) {
          try {
            await context.onSuccess(result);
          } catch (callbackError) {
            schedulerLogger.error(
              {
                error: callbackError,
                ...context,
              },
              'Ошибка в коллбэке после успешной отправки'
            );
          }
        }

        return result;
      } catch (error) {
        const err = error as Error;

        // Проверяем, является ли это сетевой ошибкой
        if (
          err.message.includes('502') ||
          err.message.includes('Bad Gateway') ||
          err.message.includes('Network') ||
          err.message.includes('Timeout') ||
          err.message.includes('ETELEGRAM') ||
          err.message.includes('ECONNRESET') ||
          err.message.includes('ETIMEDOUT') ||
          err.message.includes('ENOTFOUND')
        ) {
          schedulerLogger.warn(
            {
              ...contextForLogging,
              error: err.message,
              attempt,
              maxAttempts,
              nextDelayMs: intervalMs,
              // Если есть retryData с изображением, логируем только размер
              ...(retryData?.generatedImageBuffer
                ? {
                    imageBufferSize: retryData.generatedImageBuffer.length,
                  }
                : {}),
            },
            `⚠️ Сетевая ошибка, попытка ${attempt}/${maxAttempts}`
          );

          // Если есть еще попытки - ждем и пробуем снова
          if (attempt < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, intervalMs));
            attempt++;
            continue;
          } else {
            // Исчерпаны все попытки
            schedulerLogger.error(
              {
                ...contextForLogging,
                totalAttempts: maxAttempts,
                // Если есть retryData с изображением, логируем только размер
                ...(retryData?.generatedImageBuffer
                  ? {
                      imageBufferSize: retryData.generatedImageBuffer.length,
                    }
                  : {}),
              },
              '❌ Исчерпаны все попытки отправки сообщения'
            );
            throw new Error(`Исчерпаны все ${maxAttempts} попыток отправки сообщения: ${err.message}`);
          }
        }

        // Не сетевая ошибка - пробрасываем сразу
        schedulerLogger.error(
          {
            ...contextForLogging,
            error: err.message,
            attempt,
            // Если есть retryData с изображением, логируем только размер
            ...(retryData?.generatedImageBuffer
              ? {
                  imageBufferSize: retryData.generatedImageBuffer.length,
                }
              : {}),
          },
          'Не сетевая ошибка, прекращаем попытки'
        );
        throw error;
      }
    }

    // Не должны сюда попасть, но на всякий случай
    throw new Error(`Исчерпаны все ${maxAttempts} попыток отправки сообщения`);
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
      const cleanedResponse = extractJsonFromLLM(response);

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
        isLLMError(response, cleanedResponse)
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
    const { saveThreadMapping, isAngryPost, db } = require('./db');
    saveThreadMapping(channelMessageId, discussionMessageId);

    // Проверяем, является ли это злым постом и обновляем thread_id
    if (isAngryPost(channelMessageId)) {
      db.query('UPDATE angry_posts SET thread_id = ? WHERE channel_message_id = ?').run(
        discussionMessageId,
        channelMessageId
      );
      schedulerLogger.info(
        {
          channelMessageId,
          discussionMessageId,
        },
        '😠 Обновлен thread_id для злого поста'
      );
    }

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

      // Извлекаем JSON из ответа LLM
      const jsonResponse = extractJsonFromLLM(response);

      try {
        let result = JSON.parse(jsonResponse);

        // Исправляем альтернативные ключи от модели
        result = fixAlternativeJsonKeys(result, { source: 'detectUserBusy' });

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
    schedulerLogger.info(
      {
        hasEncouragement: !!json?.encouragement,
        encouragementText: json?.encouragement?.text,
        encouragementLength: json?.encouragement?.text?.length || 0,
      },
      '📝 buildScheduledMessageFromHF: обработка encouragement'
    );

    let n = 1;
    const parts: string[] = [];
    // Вдохновляющий текст
    parts.push(`<i>${escapeHTML(json.encouragement.text)}</i>`);

    // 1. Выгрузка неприятных переживаний (рандомно)
    const showNegative = Math.random() < 0.5;
    if (showNegative) {
      let block = `${n++}. <b>Выгрузка неприятных переживаний</b> (ситуация+эмоция)`;
      parts.push(block);
    }

    // 2. Плюшки для лягушки (без пустой строки перед этим пунктом)
    let plushki = `${n++}. <b>Плюшки для лягушки</b> (ситуация+эмоция)`;
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
      schedulerLogger.info(
        {
          encouragementBefore: json.encouragement.text,
          encouragementLength: json.encouragement.text.length,
        },
        '🧹 buildInteractiveMessage: очистка encouragement от <think>'
      );
      json.encouragement.text = cleanLLMText(json.encouragement.text);
      schedulerLogger.info(
        {
          encouragementAfter: json.encouragement.text,
          encouragementLength: json.encouragement.text.length,
        },
        '✨ buildInteractiveMessage: encouragement после очистки'
      );
    }
    if (json.negative_part?.additional_text) {
      json.negative_part.additional_text = cleanLLMText(json.negative_part.additional_text);
    }
    if (json.positive_part?.additional_text) {
      json.positive_part.additional_text = cleanLLMText(json.positive_part.additional_text);
    }

    // Определяем что показывать
    // TODO: Временно отключаем расслабление тела, оставляем только дыхательную практику
    const relaxationType: 'body' | 'breathing' = 'breathing'; // Math.random() < 0.5 ? 'body' : 'breathing';

    // Используем encouragement из основного JSON (логика выходных уже учтена в generateInteractiveScheduledMessage)
    const firstPart = `<i>${escapeHTML(json.encouragement.text)}</i>`;

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

    // Получаем только новые сообщения пользователя с момента последнего поста
    const userMessages = getUserMessagesSinceLastPost(chatId);
    if (userMessages && userMessages.length > 0) {
      previousMessagesBlock = '\n\nОтветы пользователя:';
      userMessages.forEach((msg, i) => {
        // Ограничиваем длину до 500 символов для каждого сообщения
        const truncatedText =
          msg.message_text.length > 500 ? msg.message_text.substring(0, 497) + '...' : msg.message_text;
        previousMessagesBlock += `\n${i + 1}. ${truncatedText}`;
      });

      schedulerLogger.debug(
        {
          chatId,
          userMessagesCount: userMessages.length,
          totalLength: previousMessagesBlock.length,
        },
        'Добавлены ответы пользователя в промпт'
      );
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
      let rawText = await generateMessage(prompt);
      schedulerLogger.info({ chatId, textLength: rawText?.length || 0 }, `📝 LLM сырой ответ получен`);

      // Проверяем на ошибку до очистки
      if (rawText === 'HF_JSON_ERROR') {
        schedulerLogger.warn({ chatId }, '❌ LLM вернул HF_JSON_ERROR (flight)');
        const fallbackBusy =
          'Кажется чатик не хочет работать - негодяй!\n\nКайфового дня :) Давай когда будет свободная минутка подумаешь о приятном, просто перечисляй все, что тебя радует, приносит удовольствие... можно нафантазировать)\n\nГлавное пострайся при этом почувствовать что-то хорошее ♥';
        saveMessage(chatId, fallbackBusy, new Date().toISOString());
        return fallbackBusy;
      }

      // Удаляем теги <think>...</think>
      // Сначала пробуем извлечь JSON
      let jsonText = extractJsonFromLLM(rawText);

      // Проверяем после извлечения
      if (!jsonText || jsonText === 'HF_JSON_ERROR') {
        schedulerLogger.warn(
          { chatId, extractedLength: jsonText?.length || 0 },
          '❌ После извлечения JSON пустой (flight)'
        );
        const fallbackBusy =
          'Кажется чатик не хочет работать - негодяй!\n\nКайфового дня :) Давай когда будет свободная минутка подумаешь о приятном, просто перечисляй все, что тебя радует, приносит удовольствие... можно нафантазировать)\n\nГлавное пострайся при этом почувствовать что-то хорошее ♥';
        saveMessage(chatId, fallbackBusy, new Date().toISOString());
        return fallbackBusy;
      }

      // --- Новая логика: парсим JSON и собираем только encouragement + flight ---
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

        // Исправляем альтернативные ключи для flight режима
        json = fixAlternativeJsonKeys(json, { chatId, source: 'flight' });

        if (json && typeof json === 'object' && json.encouragement && json.flight && json.flight.additional_task) {
          // Только encouragement и flight
          schedulerLogger.info(
            {
              chatId,
              encouragement: json.encouragement.text,
              encouragementLength: json.encouragement.text?.length || 0,
              flightTask: json.flight.additional_task,
            },
            '✈️ Flight режим: используем encouragement + flight.additional_task'
          );
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
          schedulerLogger.info(
            {
              chatId,
              encouragement: json.encouragement.text,
              encouragementLength: json.encouragement.text?.length || 0,
            },
            '⚠️ Flight режим: fallback на только encouragement (без flight)'
          );
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
      const rawJsonText = await generateMessage(prompt);
      schedulerLogger.info(
        {
          chatId,
          rawLength: rawJsonText?.length || 0,
          rawPreview: rawJsonText?.substring(0, 200) || 'null',
          promptLength: prompt?.length || 0,
        },
        `📝 LLM сырой ответ получен`
      );

      // Сначала проверяем на исходную ошибку
      if (rawJsonText === 'HF_JSON_ERROR') {
        schedulerLogger.warn({ chatId }, '❌ LLM вернул HF_JSON_ERROR (до очистки)');
        const fallback = readFileSync('assets/fallback_text', 'utf-8');
        return fallback;
      }

      // Удаляем теги <think>...</think>
      // Для JSON используем специальный экстрактор
      let jsonText = extractJsonFromLLM(rawJsonText);

      // Проверяем после извлечения
      if (!jsonText || jsonText === 'HF_JSON_ERROR') {
        schedulerLogger.warn(
          { chatId, extractedLength: jsonText?.length || 0 },
          '❌ После извлечения JSON пустой или ошибка'
        );
        const fallback = readFileSync('assets/fallback_text', 'utf-8');
        return fallback;
      }

      schedulerLogger.info(
        {
          chatId,
          cleanedLength: jsonText?.length || 0,
          cleanedPreview: jsonText?.substring(0, 200) || 'null',
          hasThinkTags: rawJsonText?.includes('<think>') || false,
          hasBrackets: jsonText?.includes('{') || false,
        },
        `🧹 После очистки от технических элементов`
      );

      // Пост-обработка: убираем markdown-блоки и экранирование
      jsonText = jsonText.replace(/```json|```/gi, '').trim();
      // Если строка начинается и заканчивается кавычками, убираем их
      if (jsonText.startsWith('"') && jsonText.endsWith('"')) {
        jsonText = jsonText.slice(1, -1);
      }
      // Заменяем экранированные кавычки
      jsonText = jsonText.replace(/\\"/g, '"').replace(/\"/g, '"');

      schedulerLogger.debug(
        {
          chatId,
          finalJsonLength: jsonText?.length || 0,
          finalJsonPreview: jsonText?.substring(0, 200) || 'null',
        },
        `🔧 После финальной обработки JSON`
      );
      let json: any;
      try {
        schedulerLogger.debug(
          {
            chatId,
            beforeParse: jsonText?.substring(0, 100) || 'null',
          },
          `🔍 Пытаемся парсить JSON`
        );

        json = JSON.parse(jsonText);
        if (typeof json === 'string') {
          schedulerLogger.debug({ chatId }, '📦 Двойной парсинг: результат первого парсинга - строка');
          json = JSON.parse(json); // второй парс, если строка
        }

        // Исправляем альтернативные ключи от модели
        json = fixAlternativeJsonKeys(json, { chatId, source: 'scheduled' });

        schedulerLogger.info(
          {
            chatId,
            parsedType: typeof json,
            hasEncouragement: !!json?.encouragement,
            hasNegativePart: !!json?.negative_part,
            hasPositivePart: !!json?.positive_part,
            hasFeelsEmotions: 'feels_and_emotions' in (json || {}),
            jsonKeys: json ? Object.keys(json) : [],
          },
          `✅ JSON успешно распаршен`
        );

        // Проверяем, что структура валидная
        if (
          !json ||
          typeof json !== 'object' ||
          !json.encouragement ||
          !json.negative_part ||
          !json.positive_part ||
          !('feels_and_emotions' in json)
        ) {
          throw new Error(
            `Invalid structure: missing fields - encouragement: ${!!json?.encouragement}, negative_part: ${!!json?.negative_part}, positive_part: ${!!json?.positive_part}, feels_and_emotions: ${
              'feels_and_emotions' in (json || {})
            }`
          );
        }
      } catch (parseError) {
        // fallback всегда
        schedulerLogger.warn(
          {
            chatId,
            error: (parseError as Error).message,
            jsonTextLength: jsonText?.length || 0,
            jsonTextSample: jsonText?.substring(0, 200) || 'null',
          },
          '❌ JSON парсинг не удался, используем fallback'
        );
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
    // Для поста используем простое сообщение
    const postFallback = 'Надеюсь, у тебя был хороший день!';
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

    // Получаем только новые сообщения пользователя с момента последнего поста
    const userMessages = getUserMessagesSinceLastPost(chatId);
    if (userMessages && userMessages.length > 0) {
      previousMessagesBlock = '\n\nОтветы пользователя:';
      userMessages.forEach((msg, i) => {
        // Ограничиваем длину до 500 символов для каждого сообщения
        const truncatedText =
          msg.message_text.length > 500 ? msg.message_text.substring(0, 497) + '...' : msg.message_text;
        previousMessagesBlock += `\n${i + 1}. ${truncatedText}`;
      });

      schedulerLogger.debug(
        {
          chatId,
          userMessagesCount: userMessages.length,
          totalLength: previousMessagesBlock.length,
        },
        'Добавлены ответы пользователя в промпт для интерактивного режима'
      );
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

    // Проверяем выходной ли день и добавляем инструкции для encouragement
    const isWeekend = this.isWeekend();
    let weekendInstructions = '';
    if (isWeekend) {
      const weekendPromptContent = readFileSync('assets/prompts/weekend-encouragement.md', 'utf-8');
      weekendInstructions = `\n\n**ВАЖНО: Сегодня выходной день!**
Для encouragement.text используй стиль выходного дня из следующих рекомендаций:

${weekendPromptContent}`;
    }

    let prompt = promptBase + weekendInstructions + `\n\nСегодня: ${dateTimeStr}.` + eventsStr + previousMessagesBlock;

    // Генерируем сообщение
    const rawJsonText = await generateMessage(prompt);
    schedulerLogger.info(
      { chatId, rawLength: rawJsonText?.length || 0 },
      `📝 LLM сырой ответ получен для интерактивного режима`
    );

    // Временное детальное логирование для отладки
    if (rawJsonText && rawJsonText.length > 0 && rawJsonText !== 'HF_JSON_ERROR') {
      const hasThinkTags = rawJsonText.includes('<think>');
      const hasJson = rawJsonText.includes('{') && rawJsonText.includes('}');
      schedulerLogger.warn(
        {
          chatId,
          hasThinkTags,
          hasJson,
          first500chars: rawJsonText.substring(0, 500),
          last500chars: rawJsonText.substring(Math.max(0, rawJsonText.length - 500)),
        },
        `🔍 ОТЛАДКА: Детальный анализ ответа модели`
      );
    }

    // Проверяем на ошибку до очистки
    if (rawJsonText === 'HF_JSON_ERROR') {
      schedulerLogger.warn({ chatId }, '❌ LLM вернул HF_JSON_ERROR в интерактивном режиме (до очистки)');
      const fallback = readFileSync('assets/fallback_text', 'utf-8');

      schedulerLogger.info(
        {
          chatId,
          fallbackText: fallback,
          fallbackLength: fallback.length,
        },
        '🔄 Используем fallback текст как encouragement (HF_JSON_ERROR до очистки)'
      );

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

    // Извлекаем JSON из ответа (удаляем теги <think>...</think> и находим JSON)
    let jsonText = extractJsonFromLLM(rawJsonText);

    // Добавляем логирование результата извлечения
    schedulerLogger.info(
      {
        chatId,
        extractedLength: jsonText?.length || 0,
        extractedPreview: jsonText?.substring(0, 200) || 'null',
        isValidJsonStart: jsonText?.trim().startsWith('{') || false,
      },
      '📋 Результат извлечения JSON'
    );

    // Проверяем после извлечения
    if (!jsonText || jsonText === 'HF_JSON_ERROR') {
      schedulerLogger.warn(
        { chatId, extractedLength: jsonText?.length || 0 },
        '❌ После извлечения JSON пустой или ошибка в интерактивном режиме'
      );
      const fallback = readFileSync('assets/fallback_text', 'utf-8');

      schedulerLogger.info(
        {
          chatId,
          fallbackText: fallback,
          fallbackLength: fallback.length,
        },
        '🔄 Используем fallback текст как encouragement (после извлечения пустой/ошибка)'
      );

      return {
        json: {
          encouragement: { text: fallback },
          negative_part: { additional_text: '' },
          positive_part: { additional_text: '' },
          feels_and_emotions: { additional_text: null },
        },
        firstPart: postFallback,
        relaxationType: 'breathing' as const,
      };
    }

    // Пост-обработка: убираем markdown-блоки и экранирование
    jsonText = jsonText.replace(/```json|```/gi, '').trim();
    if (jsonText.startsWith('"') && jsonText.endsWith('"')) {
      jsonText = jsonText.slice(1, -1);
    }
    jsonText = jsonText.replace(/\\"/g, '"').replace(/\"/g, '"');

    let json: any;
    try {
      // Детальное логирование перед парсингом
      schedulerLogger.info(
        {
          chatId,
          jsonTextLength: jsonText.length,
          startsWithBrace: jsonText.startsWith('{'),
          endsWithBrace: jsonText.endsWith('}'),
          hasNewlines: jsonText.includes('\n'),
          preview: jsonText.substring(0, 300),
          lastChars: jsonText.substring(Math.max(0, jsonText.length - 100)),
        },
        '📋 Попытка парсинга JSON'
      );

      json = JSON.parse(jsonText);
      if (typeof json === 'string') {
        schedulerLogger.info({ chatId }, '⚠️ JSON.parse вернул строку, пробуем второй парсинг');
        json = JSON.parse(json); // второй парс, если строка
      }

      // Исправляем альтернативные ключи от модели
      json = fixAlternativeJsonKeys(json, { chatId, source: 'interactive' });

      // Проверяем, что структура валидная
      if (
        !json ||
        typeof json !== 'object' ||
        !json.encouragement ||
        !json.negative_part ||
        !json.positive_part ||
        !('feels_and_emotions' in json)
      ) {
        schedulerLogger.warn(
          {
            chatId,
            hasEncouragement: !!json?.encouragement,
            hasNegativePart: !!json?.negative_part,
            hasPositivePart: !!json?.positive_part,
            hasFeelsAndEmotions: 'feels_and_emotions' in (json || {}),
            jsonKeys: json ? Object.keys(json) : [],
          },
          '⚠️ Структура JSON не соответствует ожидаемой'
        );
        throw new Error('Invalid structure');
      }

      // Проверяем что модель не вернула шаблон с "..."
      const encouragementText = json.encouragement?.text || '';
      if (encouragementText === '...' || encouragementText.length < 10) {
        schedulerLogger.warn(
          {
            chatId,
            encouragementText,
            allTexts: {
              encouragement: json.encouragement?.text,
              negative: json.negative_part?.additional_text,
              positive: json.positive_part?.additional_text,
              emotions: json.feels_and_emotions?.additional_text,
              support: json.deep_support?.text,
            },
          },
          '⚠️ Модель вернула шаблон с "..." вместо реального текста'
        );
        throw new Error('Template with dots instead of real text');
      }

      // Логируем успешную валидацию encouragement
      schedulerLogger.info(
        {
          chatId,
          encouragementText,
          encouragementLength: encouragementText.length,
          hasNegativePart: !!json.negative_part?.additional_text,
          hasPositivePart: !!json.positive_part?.additional_text,
          hasEmotions: !!json.feels_and_emotions?.additional_text,
        },
        '✅ JSON успешно распарсен, encouragement валиден'
      );
    } catch (error) {
      // Подробное логирование ошибки
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      const syntaxErrorMatch = errorMsg.match(/position (\d+)/);

      let errorContext = '';
      if (syntaxErrorMatch) {
        const position = parseInt(syntaxErrorMatch[1]);
        const start = Math.max(0, position - 50);
        const end = Math.min(jsonText.length, position + 50);
        errorContext = jsonText.substring(start, end);
      }

      schedulerLogger.warn(
        {
          chatId,
          jsonTextLength: jsonText.length,
          jsonTextPreview: jsonText.substring(0, 500),
          error: errorMsg,
          errorType: error instanceof SyntaxError ? 'SyntaxError' : 'Other',
          errorContext,
          syntaxErrorPosition: syntaxErrorMatch ? syntaxErrorMatch[1] : null,
        },
        '❌ JSON парсинг не удался в интерактивном режиме, используем fallback'
      );
      const fallback = readFileSync('assets/fallback_text', 'utf-8');

      schedulerLogger.info(
        {
          chatId,
          fallbackText: fallback,
          fallbackLength: fallback.length,
        },
        '🔄 Используем fallback текст как encouragement (ошибка парсинга)'
      );

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
    // ВРЕМЕННО: разрешаем автоматическую отправку для тестового бота
    // if (this.isTestBot()) {
    //   schedulerLogger.warn('⚠️ Автоматическая рассылка отключена для тестового бота');
    //   return;
    // }

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
        // Выбираем случайный промпт в зависимости от дня недели
        const isWeekend = this.isWeekend();
        const promptVariant = Math.random() < 0.5 ? '1' : '2';
        const imagePromptFile = isWeekend
          ? `assets/prompts/frog-image-prompt-weekend-${promptVariant}`
          : `assets/prompts/frog-image-prompt-weekday-${promptVariant}`;
        const imagePrompt = readFileSync(imagePromptFile, 'utf-8');

        schedulerLogger.info({ chatId, imagePrompt, isWeekend, promptVariant }, `🎨 Промпт для планируемого изображения (вариант ${promptVariant}): "${imagePrompt}"`);
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

      // Включаем напоминание через 1.5 часа (для тестового бота тоже)
      const sentTime = new Date().toISOString();
      saveMessage(chatId, message, sentTime);
      this.setReminder(chatId, sentTime);
      schedulerLogger.info({ chatId }, '⏰ Напоминание через 1.5 часа установлено (команда /test)');
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
    // ВРЕМЕННО: разрешаем автоматическую отправку для тестового бота
    // if (this.isTestBot() && !isManualCommand) {
    //   schedulerLogger.warn('⚠️ Автоматическая интерактивная рассылка отключена для тестового бота');
    //   return;
    // }

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
        // Выбираем случайный промпт в зависимости от дня недели
        const isWeekend = this.isWeekend();
        const promptVariant = Math.random() < 0.5 ? '1' : '2';
        const imagePromptFile = isWeekend
          ? `assets/prompts/frog-image-prompt-weekend-${promptVariant}`
          : `assets/prompts/frog-image-prompt-weekday-${promptVariant}`;
        const imagePrompt = readFileSync(imagePromptFile, 'utf-8');

        schedulerLogger.info({ chatId, imagePrompt, isWeekend, promptVariant }, `🎨 Промпт для интерактивного изображения (вариант ${promptVariant}): "${imagePrompt}"`);
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

      // Используем дефолтные слова поддержки для первой отправки (генерация будет асинхронно)
      const { getDefaultSupportWords } = await import('./utils/support-words');
      const supportWords = getDefaultSupportWords();

      // Определяем пользователя для поста из env, с учетом режима бота
      const postUserId = this.isTestBot() ? this.getTestUserId() : this.getMainUserId();

      // Добавляем слова поддержки в message_data
      const messageDataWithSupport = {
        ...json,
        day_rating_support: supportWords,
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
        const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);
        if (adminChatId) {
          await this.bot.telegram
            .sendMessage(
              adminChatId,
              `❌ Критическая ошибка при отправке поста пользователю ${chatId}: не удалось сохранить в БД\n\nОшибка: ${
                (dbError as Error).message
              }`
            )
            .catch(err => schedulerLogger.error({ error: err }, 'Не удалось отправить уведомление админу'));
        }
        return;
      }

      // Отправляем основной пост БЕЗ кнопок с механизмом повторных попыток
      let sentMessage;

      // Подготавливаем данные для повторных попыток
      const retryData = {
        chatId,
        tempMessageId,
        messageDataWithSupport,
        captionWithComment,
        postUserId,
        relaxationType,
        generatedImageBuffer: imageBuffer,
      };

      // Функция отправки для использования в sendWithRetry
      const sendPhotoFunction = async () => {
        if (imageBuffer) {
          // Отправляем сгенерированное изображение
          return await this.bot.telegram.sendPhoto(
            this.CHANNEL_ID,
            { source: imageBuffer },
            {
              caption: captionWithComment,
              parse_mode: 'HTML',
            }
          );
        } else {
          // Fallback: используем старую систему ротации
          const imagePath = this.getNextImage(chatId);
          const imageFile = readFileSync(imagePath);
          return await this.bot.telegram.sendPhoto(
            this.CHANNEL_ID,
            { source: imageFile },
            {
              caption: captionWithComment,
              parse_mode: 'HTML',
            }
          );
        }
      };

      // Коллбэк после успешной отправки
      const onSuccessCallback = async (result: any) => {
        const messageId = result.message_id;

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
            const db = await import('./db');
            const deleteQuery = db.db.query('DELETE FROM interactive_posts WHERE channel_message_id = ?');
            deleteQuery.run(tempMessageId);
            schedulerLogger.info({ messageId }, '✅ Создана fallback запись с правильным ID');
          } catch (fallbackError) {
            schedulerLogger.error(
              { error: fallbackError },
              '❌ Критическая ошибка: не удалось создать fallback запись'
            );
          }
        }

        // Готовим выбор сценария для отправки в комментарии
        const scenarioChoiceText = '<b>Как сегодня хочешь поработать?</b>';
        const scenarioChoiceKeyboard = {
          inline_keyboard: [
            [{ text: 'Упрощенный сценарий 🧩', callback_data: `scenario_simplified_${messageId}` }],
            [{ text: 'Глубокая работа 🧘🏻', callback_data: `scenario_deep_${messageId}` }],
          ],
        };

        // Получаем ID группы обсуждений
        const CHAT_ID = this.getChatId();
        if (CHAT_ID) {
          // Отправляем выбор сценария асинхронно после появления пересланного сообщения
          this.sendFirstTaskAsync(
            messageId,
            scenarioChoiceText,
            scenarioChoiceKeyboard,
            'scenario_choice',
            chatId,
            CHAT_ID
          );
        }

        // Сохраняем сообщение в истории
        const { saveMessage } = await import('./db');
        const startTime = new Date().toISOString();
        saveMessage(chatId, captionWithComment, startTime);
      };

      // Отправляем с повторными попытками
      sentMessage = await this.sendWithRetry(sendPhotoFunction, {
        chatId,
        messageType: 'interactive_daily_message',
        retryData,
        maxAttempts: 111, // 111 попыток для интерактивных сообщений
        intervalMs: 60000, // 1 минута между попытками
        onSuccess: onSuccessCallback,
      });

      const postSentTime = new Date();
      schedulerLogger.info(
        {
          chatId,
          messageLength: captionWithComment.length,
          messageId: sentMessage.message_id,
          sentAt: postSentTime.toISOString(),
          timestamp: postSentTime.getTime(),
          hasGeneratedImage: !!imageBuffer,
        },
        'Основной пост отправлен в канал'
      );

      // Асинхронно генерируем и обновляем слова поддержки в БД (не блокируем)
      const messageId = sentMessage.message_id;
      (async () => {
        try {
          schedulerLogger.info({ chatId, messageId }, '🎯 Начинаем асинхронную генерацию слов поддержки');
          const { generateDayRatingSupportWords } = await import('./utils/support-words');
          const generatedSupportWords = await generateDayRatingSupportWords();

          // Обновляем в БД
          const db = await import('./db');
          const updateQuery = db.db.query(`
            UPDATE interactive_posts
            SET message_data = json_set(message_data, '$.day_rating_support', json(?))
            WHERE channel_message_id = ?
          `);
          updateQuery.run(JSON.stringify(generatedSupportWords), messageId);
          schedulerLogger.info({ chatId, messageId }, '✅ Слова поддержки сгенерированы и обновлены в БД');
        } catch (error) {
          schedulerLogger.error({ error, chatId, messageId }, '❌ Ошибка асинхронной генерации слов поддержки (используются дефолтные)');
        }
      })();

      // Устанавливаем напоминание через 1.5 часа для пользователя
      const sentTime = postSentTime.toISOString();
      this.setReminder(chatId, sentTime);
      schedulerLogger.info({ chatId, sentTime }, '⏰ Напоминание через 1.5 часа установлено');

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

      // Пробрасываем ошибку для обработки в команде
      throw error;
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

        const firstTaskMessage = await this.sendWithRetry(
          () => this.bot.telegram.sendMessage(CHAT_ID, firstTaskFullText, messageOptions),
          {
            chatId: originalChatId,
            messageType: 'first_task_with_thread',
            maxAttempts: 10,
            intervalMs: 5000,
          }
        );

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

        const firstTaskMessage = await this.sendWithRetry(
          () => this.bot.telegram.sendMessage(CHAT_ID, firstTaskFullText, messageOptions),
          {
            chatId: originalChatId,
            messageType: 'first_task_no_thread',
            maxAttempts: 10,
            intervalMs: 5000,
          }
        );

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
      await this.sendWithRetry(
        () =>
          this.bot.telegram.sendMessage(adminChatId, '❗️Нет пользователей для рассылки. Отправляю сообщение себе.'),
        {
          chatId: adminChatId,
          messageType: 'admin_no_users_warning',
          maxAttempts: 5,
          intervalMs: 3000,
        }
      );
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
      await this.sendWithRetry(() => this.bot.telegram.sendMessage(adminChatId, reportMessage), {
        chatId: adminChatId,
        messageType: 'admin_daily_report',
        maxAttempts: 5,
        intervalMs: 3000,
      });
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
    // ВРЕМЕННО: разрешаем напоминания для тестового бота
    // if (this.isTestBot()) {
    //   schedulerLogger.info('🤖 Тестовый бот - напоминания отключены');
    //   return;
    // }

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
        await this.sendWithRetry(() => this.bot.telegram.sendMessage(chatId, reminderText), {
          chatId,
          messageType: 'daily_reminder',
          maxAttempts: 5,
          intervalMs: 3000,
        });

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

  // Установить напоминание о незавершенной работе (через 30 минут или 1 минуту для тестового бота)
  async setIncompleteWorkReminder(chatId: number, channelMessageId: number) {
    // Проверяем, что chatId положительный (личный чат пользователя)
    if (chatId <= 0) {
      schedulerLogger.debug({ chatId }, 'Пропускаем напоминание о незавершенной работе для группы/канала');
      return;
    }

    // Проверяем, не получал ли пользователь уже задание с практикой в этом посте
    const { getInteractivePost } = await import('./db');
    const post = getInteractivePost(channelMessageId);

    if (post && post.task3_completed) {
      schedulerLogger.debug(
        { chatId, channelMessageId },
        'Пользователь уже получал задание с практикой в этом посте - напоминание не нужно'
      );
      return;
    }

    // Для тестового бота используем 1 минуту, для основного - 30 минут
    const delayMinutes = this.isTestBot() ? 1 : 30;
    const delayMs = delayMinutes * 60 * 1000;

    schedulerLogger.debug(
      {
        chatId,
        channelMessageId,
        delayMinutes,
        isTestBot: this.isTestBot(),
      },
      `⏰ Устанавливаем напоминание о незавершенной работе через ${delayMinutes} мин`
    );

    const timeout = setTimeout(async () => {
      try {
        // Проверяем текущее состояние поста
        const { getInteractivePost } = await import('./db');
        const post = getInteractivePost(channelMessageId);

        if (!post) {
          schedulerLogger.debug({ channelMessageId }, 'Пост не найден, пропускаем напоминание');
          return;
        }

        // Проверяем, не дошел ли пользователь до дыхательной практики
        const currentState = post.current_state;
        const practiceStates = ['waiting_practice', 'deep_waiting_practice', 'finished'];

        if (practiceStates.includes(currentState)) {
          schedulerLogger.debug(
            { channelMessageId, currentState },
            'Пользователь уже дошел до практики, напоминание не нужно'
          );
          return;
        }

        // Отправляем напоминание
        const reminderText = '🐸 Вижу, что лягуха не получила ответы на все задания. Давай доделаем - возвращайся 🤗';
        await this.sendWithRetry(() => this.bot.telegram.sendMessage(chatId, reminderText), {
          chatId,
          messageType: 'incomplete_work_reminder',
          maxAttempts: 5,
          intervalMs: 3000,
        });

        schedulerLogger.info({ chatId, channelMessageId }, '📨 Напоминание о незавершенной работе отправлено');

        // ВАЖНО: Удаляем таймер из Map после отправки напоминания
        this.reminderTimeouts.delete(chatId);
        schedulerLogger.debug({ chatId }, '🗑️ Таймер удален из Map после отправки напоминания');
      } catch (error) {
        schedulerLogger.error(
          { error: (error as Error).message, chatId },
          'Ошибка отправки напоминания о незавершенной работе'
        );
        // Удаляем таймер даже в случае ошибки
        this.reminderTimeouts.delete(chatId);
      }
    }, delayMs);

    // Сохраняем таймаут для возможной отмены
    this.reminderTimeouts.set(chatId, timeout);
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
    // Утренняя проверка в 8:00 - отправка злого поста если пользователь не ответил
    this.startMorningCheckCronJob();
    // Утреннее сообщение в 9:00 - приветствие и приглашение делиться переживаниями
    this.startMorningMessageCronJob();
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
              await this.sendWithRetry(
                () =>
                  this.bot.telegram.sendMessage(
                    adminChatId,
                    `🚨 КРИТИЧЕСКАЯ ОШИБКА в автоматической рассылке!\n\n` +
                      `⏰ Время: ${startTimeMoscow}\n` +
                      `❌ Ошибка: ${error}\n` +
                      `⏱️ Длительность: ${duration}ms\n\n` +
                      `Проверьте логи сервера для подробностей.`
                  ),
                {
                  chatId: adminChatId,
                  messageType: 'admin_critical_error',
                  maxAttempts: 5,
                  intervalMs: 3000,
                }
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
              await this.sendWithRetry(
                () =>
                  this.bot.telegram.sendMessage(adminChatId, `🚨 ОШИБКА в утренней проверке!\n\n❌ Ошибка: ${error}`),
                {
                  chatId: adminChatId,
                  messageType: 'admin_morning_error',
                  maxAttempts: 5,
                  intervalMs: 3000,
                }
              );
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

  // Запуск cron job для утреннего поста в 9:00
  private startMorningMessageCronJob() {
    // Останавливаем предыдущий job, если он есть
    if (this.morningMessageCronJob) {
      schedulerLogger.info('Перезапуск morning message cron job');
      this.morningMessageCronJob.stop();
      this.morningMessageCronJob.destroy();
      this.morningMessageCronJob = null;
    }

    schedulerLogger.info('Создание morning message cron job (9:00 МСК)');

    // Создаем новый cron job: каждый день в 9:00
    this.morningMessageCronJob = cron.schedule(
      '0 9 * * *',
      async () => {
        schedulerLogger.info('🌅 Запуск утренней рассылки');
        try {
          const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);
          if (!adminChatId) {
            throw new Error('ADMIN_CHAT_ID не установлен в переменных окружения');
          }
          await this.sendMorningMessage(adminChatId);
        } catch (error) {
          schedulerLogger.error(error as Error, 'Ошибка утренней рассылки');
          // Уведомляем админа об ошибке
          try {
            const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);
            if (adminChatId) {
              await this.sendWithRetry(
                () =>
                  this.bot.telegram.sendMessage(adminChatId, `🚨 ОШИБКА в утренней рассылке!\n\n❌ Ошибка: ${error}`),
                {
                  chatId: adminChatId,
                  messageType: 'admin_morning_message_error',
                  maxAttempts: 5,
                  intervalMs: 3000,
                }
              );
            }
          } catch (notifyError) {
            logger.error('Уведомление админа об ошибке morning message', notifyError as Error);
          }
        }
      },
      {
        timezone: 'Europe/Moscow',
      }
    );

    if (this.morningMessageCronJob) {
      schedulerLogger.info('Morning message cron job успешно создан');
    } else {
      logger.error('Morning message планировщик', new Error('Morning message cron job не был создан'));
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
        await this.sendWithRetry(
          () => this.bot.telegram.sendMessage(adminChatId, reportMessage, { parse_mode: 'HTML' }),
          {
            chatId: adminChatId,
            messageType: 'admin_morning_report',
            maxAttempts: 5,
            intervalMs: 3000,
          }
        );
      } catch (adminError) {
        schedulerLogger.error(adminError as Error, 'Ошибка отправки отчета админу');
      }
    }
  }

  // Извлечение конкретной секции промпта из файла
  private extractPromptSection(fileContent: string, promptNumber: number): string | null {
    try {
      // Определяем маркеры для каждой секции
      const sectionMarkers = {
        1: '## ПРОМТ №1 - злюсь',
        2: '## ПРОМТ №2 - расстроен',
        3: '## ПРОМТ №3 - переживаю, забочусь, поддерживаю',
        4: '## ПРОМТ №4 - шутки шучу',
        5: '## ПРОМТ №5 (перепроверка)',
      };

      const currentMarker = sectionMarkers[promptNumber as keyof typeof sectionMarkers];
      if (!currentMarker) {
        schedulerLogger.warn({ promptNumber }, 'Неизвестный номер промпта');
        return null;
      }

      // Находим начало нужной секции
      const startIndex = fileContent.indexOf(currentMarker);
      if (startIndex === -1) {
        schedulerLogger.warn({ promptNumber, marker: currentMarker }, 'Секция не найдена в файле');
        return null;
      }

      // Находим начало следующей секции (или конец файла)
      let endIndex = fileContent.length;
      const allMarkers = Object.values(sectionMarkers);
      const currentMarkerIndex = allMarkers.indexOf(currentMarker);

      // Ищем следующую секцию
      for (let i = currentMarkerIndex + 1; i < allMarkers.length; i++) {
        const nextMarkerIndex = fileContent.indexOf(allMarkers[i], startIndex + 1);
        if (nextMarkerIndex !== -1 && nextMarkerIndex < endIndex) {
          endIndex = nextMarkerIndex;
        }
      }

      // Извлекаем текст секции
      const sectionContent = fileContent.substring(startIndex, endIndex).trim();

      schedulerLogger.debug(
        {
          promptNumber,
          sectionLength: sectionContent.length,
          preview: sectionContent.substring(0, 100),
        },
        'Извлечена секция промпта'
      );

      return sectionContent;
    } catch (error) {
      schedulerLogger.error({ error, promptNumber }, 'Ошибка извлечения секции промпта');
      return null;
    }
  }

  // Извлечение примеров из секции промпта
  private extractExamplesFromPrompt(promptSection: string): string[] {
    try {
      // Ищем маркер начала примеров
      const examplesMarker = '### Примеры хороших ответов';
      const examplesStart = promptSection.indexOf(examplesMarker);

      if (examplesStart === -1) {
        schedulerLogger.warn('Не найден маркер примеров в промпте');
        return [];
      }

      // Вырезаем часть с примерами
      const examplesSection = promptSection.substring(examplesStart + examplesMarker.length);

      // Разбиваем на строки и фильтруем
      const lines = examplesSection.split('\n');
      const examples: string[] = [];
      let currentExample = '';

      for (const line of lines) {
        const trimmedLine = line.trim();

        // Пропускаем пустые строки
        if (!trimmedLine) {
          // Если накопили пример, добавляем его
          if (currentExample) {
            examples.push(currentExample.trim());
            currentExample = '';
          }
          continue;
        }

        // Если строка начинается с дефиса - это начало нового примера
        if (trimmedLine.startsWith('-')) {
          // Если был предыдущий пример, добавляем его
          if (currentExample) {
            examples.push(currentExample.trim());
          }
          // Начинаем новый пример (убираем дефис)
          currentExample = trimmedLine.substring(1).trim();
        } else if (currentExample) {
          // Это продолжение текущего примера
          currentExample += '\n' + trimmedLine;
        }
      }

      // Добавляем последний пример, если есть
      if (currentExample) {
        examples.push(currentExample.trim());
      }

      schedulerLogger.debug(
        {
          examplesCount: examples.length,
          firstExample: examples[0]?.substring(0, 50),
        },
        'Извлечены примеры из промпта'
      );

      return examples;
    } catch (error) {
      schedulerLogger.error({ error }, 'Ошибка извлечения примеров из промпта');
      return [];
    }
  }

  // Создание промпта с одним конкретным примером
  private createPromptWithSingleExample(basePromptSection: string, selectedExample: string): string {
    try {
      // Находим где начинаются примеры
      const examplesMarker = '### Примеры хороших ответов';
      const examplesStart = basePromptSection.indexOf(examplesMarker);

      if (examplesStart === -1) {
        // Если не нашли маркер, возвращаем промпт как есть
        return basePromptSection;
      }

      // Берем всю часть до примеров
      const promptBeforeExamples = basePromptSection.substring(0, examplesStart);

      // Изменяем правила, чтобы указать на использование конкретного примера
      const modifiedPrompt = promptBeforeExamples.replace(
        'Выбери рандомным образом один из примеров ниже и на основании его напиши ответ в похожем стиле',
        'На основании примера ниже напиши ответ в похожем стиле'
      );

      // Создаем новый промпт с одним примером
      const newPrompt =
        modifiedPrompt +
        '### Пример для подражания\n\n' +
        selectedExample +
        '\n\n' +
        'Напиши новый текст в точно таком же стиле, сохраняя тональность, длину и структуру примера.\n\n' +
        'ВАЖНО: Генерируй ТОЛЬКО готовый текст для отправки пользователю. БЕЗ размышлений, БЕЗ префиксов "Мысли:", "Ответ:", БЕЗ технических пометок. Только чистый текст в стиле примера.';

      return newPrompt;
    } catch (error) {
      schedulerLogger.error({ error }, 'Ошибка создания промпта с одним примером');
      return basePromptSection;
    }
  }

  // Отправка "злого" поста для пользователя, который не ответил
  private async sendAngryPost(userId: number) {
    // ВРЕМЕННО: разрешаем отправку злого поста для тестового бота
    // if (this.isTestBot()) {
    //   schedulerLogger.warn('⚠️ Отправка злого поста отключена для тестового бота');
    //   return;
    // }

    try {
      // Читаем файл с промптами
      const angryPromptsFile = readFileSync('assets/prompts/no-answer', 'utf-8');

      // Выбираем рандомно один из 4 вариантов
      const promptNumber = Math.floor(Math.random() * 4) + 1; // 1, 2, 3 или 4

      schedulerLogger.info({ promptNumber }, `🎲 Выбран вариант промпта №${promptNumber} для злого поста`);

      let finalText = '';

      if (promptNumber === 4) {
        // Вариант 4 - выбираем рандомный пример из списка, исключая последние 5 использованных
        const prompt4Examples = [
          'Что за беспорядок? Ни ответа, ни привета! Так с лягухами не поступают! 😒\nБыстренько выполни вчерашние задания',
          'Психолог злиться не может, а лягуха может! 😠 Кто вчера не сделал задания? Не надо так 😒\nВернись и сделай, пожалуйста',
          'Ну что за дела?! 😤\nВажно делать задания регулярно - исправь это! А то буду квакать под окном! 🐸',
          'Ква! 😡 Я возмущен, что не увидел твой ответ вчера! Выполни задания, а то затяну в болото, и будешь тут, как водяной с новыми подружками - пиявками и лягушками 😄',
          'Это что такое?! 🤨 Пропал без вести вместе с заданиями! Я готов объявить розыск! 🚨\nМы найдем тебя, где бы ты ни прятался 🐸',
          'Ну знаешь ли! 🐸 Так дело не пойдет! Почему исчезаешь и игнорируешь нашу работу? Это подрывает мой авторитет! 😅\nЖду твои ответы под вчерашним постом',
          'Квак! 🐸 Ты от меня так просто не отделаешься! Я могу квакать целый день - лучше сделай задания 😅',
          'Что это было?! 🤨 Вздумал дурить лягуху и не делать задания? Ну уж нееет - бегом пиши все, что нужно! 😠\nТы делаешь это для себя, не забывай 🙌🏻',
          'Пропускаем мои посты, значит? Не отвечаем? Ох, я негодую! 🤬\nПридется меня задобрить 🙃 И сделать двойную порцию заданий - сейчас и вечером. Никаких возражений 😝',
          'Пиши объяснительную 😅 По какой причине я вчера без твоих сообщений остался?\nНу шо такое? Мне скучно тут одному - напиши хоть что-нибудь 🥺',
          'Почему нет вчерашнего ответа? О, боже, я ничего не вижу! Помогите! 🙀\nА нет, стоп, это просто ты ничего не написал вчера.. 😑\nТак не пойдет - исправь это! Давай-давай',
          'Решил меня игнорировать? 😑\nОт меня так просто не отделаться! Буду квакать пока не выполнишь все задания! Ква-ква! 🐸',
          'Разыскивается человек, который не заполняет лягуху! 🕵🏻‍♂️\nОсобые приметы: умеет писать, но вчера этого не сделал 🤨\nВознаграждение: 50 мух, 100 комаров.\nP.S. Тебе бы лучше сделать задание поскорее, а то запущу их всех 🪰🦟 к тебе 😈',
          'По болоту ходят слухи, что ты вчера не сделал задания 🗣️\nКомары уже сплетничают, что психолог из меня хреновый 🙈 Спаси мою репутацию - напиши что-нибудь! 🥲',
          'Ты знаешь, у меня в пруду собеседников толковых не много. Поговори со мной 😅 \n А если серьезно - давай заполним вчерашний пробел. Смотри задания 🗓️ в посте выше ☝🏻',
          'Вчера я начал вести дневник: "Человек игнорирует мои сообщения. Переживаю, что меня уволят. Ощущаю тревогу, разочарование в себе и обиду" 😢 \n Подышал - полегчало. \nНо будет еще лучше, когда ты сделаешь задания 📝',
          'Без твоих вчерашних ответов я начал разговаривать сам с собой 🐸 Беседа вышла интересная, но я предпочитаю твою компанию 🗣️ \nВозвращайся поскорее 😅',
          'Вчера ты молчал, и я от нечего делать организовал забастовку мух. Они требуют твоего возвращения! 📢 \nСделай быстрее задания ✍🏻',
          'Я вчера так долго ждал твой ответ, что успел написать автобиографию. \n Глава 15: "Все еще жду" 🗿 \nЧувствовал себя глупо 🙈 Сгладь эту неловкость - выполни задания',
          'Вчера я тренировался в телепатии. Не сработало! 🥲 Так и не понял, о чем ты думаешь 💬 Поэтому расскажи мне',
          'Я буду на доске позора за такую работу 😱 Спасай ситуацию - сделай задания ✏️',
          'Я вчера от скуки начал считать капли дождя. Дошел до 1247 и понял - твои сообщения интереснее! 😉 \nВозвращайся, пока я не стал метеорологом 🌧️',
          'Знаешь что? Вчера без твоих ответов я так заскучал, что начал учиться синхронному плаванию! 🏊 \nПрогресс есть, но лучше бы мы с тобой поговорили!',
          'Слушай, я тут дошел до того, что начал давать психологические консультации мошкам! \nНо они жужжали что-то непонятное.. и.. я их съел.. 😐 \nДавай лучше мы с тобой продолжим, а? 😄',
          'Мне придется вызвать лягушачью полицию! 🐸 \nОставлять мои задания невыполненными - возмутительно! Исправь ситуацию',
        ];

        // Получаем последние использованные примеры
        const lastUsedIndices = getLastUsedAngryExamples(7);
        schedulerLogger.info({ lastUsedIndices }, '📋 Последние использованные примеры');

        // Отфильтровываем доступные примеры
        const availableIndices: number[] = [];
        for (let i = 0; i < prompt4Examples.length; i++) {
          if (!lastUsedIndices.includes(i)) {
            availableIndices.push(i);
          }
        }

        // Если все примеры использованы (маловероятно при 25 примерах), используем все
        const indicesToChooseFrom =
          availableIndices.length > 0 ? availableIndices : Array.from({ length: prompt4Examples.length }, (_, i) => i);

        // Выбираем рандомный индекс из доступных
        const selectedIndex = indicesToChooseFrom[Math.floor(Math.random() * indicesToChooseFrom.length)];
        finalText = prompt4Examples[selectedIndex];

        // Сохраняем в историю
        addUsedAngryExample(selectedIndex);

        schedulerLogger.info(
          {
            selectedIndex,
            selectedExample: finalText.substring(0, 50),
            availableCount: availableIndices.length,
            totalCount: prompt4Examples.length,
          },
          '📝 Выбран готовый пример из варианта 4'
        );
      } else {
        // Варианты 1, 2 или 3 - используем LLM

        // Извлекаем нужный промпт из файла
        const promptSection = this.extractPromptSection(angryPromptsFile, promptNumber);

        if (!promptSection) {
          throw new Error(`Не удалось извлечь промпт №${promptNumber} из файла`);
        }

        // Извлекаем все примеры из секции
        const examples = this.extractExamplesFromPrompt(promptSection);

        if (examples.length === 0) {
          throw new Error(`Не найдены примеры в промпте №${promptNumber}`);
        }

        // Получаем последние использованные примеры для этого промпта
        const lastUsedIndices = getLastUsedPromptExamples(promptNumber, 7);
        schedulerLogger.info({ promptNumber, lastUsedIndices }, '📋 Последние использованные примеры промпта');

        // Отфильтровываем доступные примеры
        const availableIndices: number[] = [];
        for (let i = 0; i < examples.length; i++) {
          if (!lastUsedIndices.includes(i)) {
            availableIndices.push(i);
          }
        }

        // Если все примеры использованы, используем все
        const indicesToChooseFrom =
          availableIndices.length > 0 ? availableIndices : Array.from({ length: examples.length }, (_, i) => i);

        // Выбираем рандомный индекс из доступных
        const selectedIndex = indicesToChooseFrom[Math.floor(Math.random() * indicesToChooseFrom.length)];
        const selectedExample = examples[selectedIndex];

        // Сохраняем в историю
        addUsedPromptExample(promptNumber, selectedIndex, selectedExample.substring(0, 200));

        // Создаем промпт только с одним примером
        const modifiedPrompt = this.createPromptWithSingleExample(promptSection, selectedExample);

        schedulerLogger.info(
          {
            promptNumber,
            totalExamples: examples.length,
            selectedIndex,
            selectedExample: selectedExample.substring(0, 50),
            availableCount: availableIndices.length,
          },
          '📝 Выбран пример для генерации'
        );

        // Генерируем текст через LLM на основе одного примера
        const generatedText = await generateMessage(modifiedPrompt);

        // Очищаем текст от технических элементов
        let cleanedText = cleanLLMText(generatedText);

        // Проверяем на ЛЮБЫЕ ошибки LLM
        if (isLLMError(generatedText, cleanedText)) {
          // Используем fallback - выбираем рандомный пример из промптов 1, 2 и 3
          const fallbackExamples = [
            // Промпт 1 - злюсь
            'Кто-то вчера не сделал задания, что за безобразие! 😠 Я весь вечер ждал твой ответ,\nпроверял сообщения, а ты не написал ни слова! 🧐 Надо это исправить, у тебя получится 💪🏻',
            'Что за беспорядок? 😠 Задания остались без внимания, а я без твоих новостей! Так не\nпойдет! Быстренько напиши ответ ✍🏻',
            'А кто будет выполнять задания? 😠 Они сами себя не сделают - понимаю, что хотелось бы 😁 Не отлынивай, пора вернуться к работе',
            'Ээй! 😤 Ты что, забыл про меня? Я жду-жду, а ты молчишь! 🤐 Вчера весь вечер просидел у экрана в ожидании твоего сообщения 🐸  Давай, возвращайся и сделай задания',
            'Ну что за дела?! 😤 Я жду, а ты молчишь... 🤐 Так дело не пойдет! Напиши про свой вчерашний день',
            'Так-так-так... 🤨 А кто вчера проигнорировал задания? Я весь вечер ждал,\nно так ничего и не увидел от тебя! 🧐 Непорядок! Давай-ка быстренько исправляй ситуацию',
            'Как так?! 😤 Я весь вечер ждал твой ответ! Даже чай остыл, пока сидел у экрана. Где же ты был? 😩 Неужели забыл про нашу важную работу? Возвращайся скорее',
            'Ну и ну! 🤨 Задания сами себя не выполнят! Помни, что важна регулярность 🗓 Жду твоих новостей с нетерпением',
            'Ай-яй-яй… Так не пойдет! 🐸 Задания делаются не для галочки - это помогает тебе лучше понимать себя! Поэтому давай сделаем их 📝',
            'Так, стоп! 😠 Где вчерашние ответы? 📑 Я искал везде, но их нигде нет! Ты заставляешь меня беспокоиться.',
            'Что за безобразие?! 😠 Я тут сижу, жду... А тебя все нет! 🫠 Вернись к нашей работе, ты сможешь, жду 🗒️',
            'Ква! 🤬 Где твои ответы? Мы требуем внимания! 🐸 Быстренько удели время этой важной работе - не забывай про себя',
            // Промпт 2 - расстроен
            'Вижу, что вчерашняя лягуха осталась без ответа 😔 Давай исправим',
            'Эй! 😤 Ты забыл про меня? Я жду-жду, а ты молчишь! 🐸 Давай, возвращайся',
            'Ты вчера не поделился своими эмоциями... 😔 Я все еще здесь и готов выслушать! Давай наверстаем 🐸',
            'Что же ты так? 🙈 Я жду, задания ждут, а ты так и не появился 😒 Порадуй ляхуху своими ответами 🥺',
            'Эх, вчерашний день прошел без твоих новостей... 😮‍💨 Мне не хватает наших разговоров 💚',
            'Ох... 🐸 Вчера я так и не дождался твоего ответа... 😔 Думал, ты напишешь хотя бы пару слов. Так тоскливо, когда ты пропадаешь',
            'Ты ничего не написал - мне грустно без твоих историй 🐸 Поделись своими переживаниями. Я рядом 🌟',
            'Сижу, грущу в одиночестве - ты вчера ничего не написал 😓 Меня это огорчает. Давай попробуем сейчас заполнить то, что пропустили?',
            'Эхх! Вчера ты так и не появился 🫤 Не забывай про лягуху. Еще можно сделать задания. Постоянство - ключ к успеху 🗝️',
            'Ты знаешь, я немного приуныл ☹️ Вчера от тебя не было ни слова. У тебя все хорошо? Давай вернемся и сделаем задания 📝',
            'Скучаю по нашим беседам 😔 Вчера ты не выполнил задания 📋 Расскажи, что случилось?',
            'Что-то на душе тяжело... 🥺 Ты вчера проигнорировал задания. Хочется видеть твои результаты, а для этого нужно постараться! 🚀 Давай вернемся и пройдем этот путь вместе 👐🏻',
            'С нетерпением жду твоих сообщений. Но вчера ты не написал 😮‍💨 Давай поговорим? Я скучаю',
            'Эх, день без твоих новостей - это так уныло 🫠 Мне тоскливо, когда ты пропадаешь 💚 Вчера задания остались без ответа. Давай это исправим сейчас ✏️',
            'Грущу... 😢 Ты вчера даже не заглянул. Ты же знаешь, я всегда рядом и готов выслушать 🐸 Не пропадай так',
            'Печалька... 🥺 Я так и не увидел твой ответ вчера. Поделись, что у тебя происходит? 🫂',
            'Знаешь, что самое грустное? Я даже не знаю - все ли у тебя в порядке 🥺 Ты как? Готов продолжить? ⚡️ Новые привычки формируются систематичностью. Не останавливайся 🙏🏻',
            'Смотрю на невыполненные задания 🗒️ и становится так грустно 😞 Возвращайся, давай продолжим 👨🏻‍🎓',
            'Вчера я долго смотрел на экран, надеясь увидеть твои сообщения. Но ты так и не появился 😒 Нужно это исправить - сделай задания сейчас ✍🏻',
            // Промпт 3 - переживаю, забочусь, поддерживаю
            'Помни, что важна регулярность, давай вернемся к заданию, у тебя получится! 🙌🏻',
            'Ты помнишь, что ты - самое важное, что у тебя есть? 🥺 А для себя нужно постараться! Вернись и сделай задания ✏️ У тебя получится! Я верю в тебя! 🐸',
            'Хмм... 🤔 Кажется, кто-то забыл про вчерашнее задание! Мы с тобой заодно, поэтому хочу напомнить, как важно не пропускать - это влияет на твой результат! 🏆 Нужно наверстать упущенное 🐸',
            'Ой, как же тихо и пусто было вчера без тебя... 💔 Я переживаю, когда ты исчезаешь. Ты быстрее увидишь результаты, если будешь продолжать каждый день 👣',
            'Ээй… 👀 Ты где пропадаешь? Вчерашнее задание осталось без внимания! Я переживаю за тебя... Удели себе время! 💚 Возвращайся скорее!',
            'А почему вчера не смог сделать задания? 📃 Я очень жду - пиши. Мне ведь важно знать, как у тебя дела 🐸',
            'Знаешь, вчера я немного растерялся... Отправил тебе задания, а в ответ - тишина 🤐 Переживаю - все ли в порядке? И чуточку огорчен, что не знаю, как прошел твой день. Расскажи мне 🤗',
            'Привет! 👋🏻 Вчера ты не ответил, и я весь вечер думал о тебе. Просто волнуюсь - все ли в порядке? Работа над собой - это не прямая дорога. Иногда мы останавливаемся, и это тоже часть пути. Давай продолжим вместе? 🐸',
            'Вчера от тебя не было вестей! 🥺 Ты не должен быть идеальным каждый день! И можешь рассказать мне обо всем! Очень важно продолжать уделять время самому важному - себе! ♥️',
            'Пропустил задания, так бывает, я понимаю. Только не останавливайся! Каждый момент - это шанс начать заново 🌟 И я буду рядом, чтобы помочь тебе в этом 🤗',
            'Знаешь, вчера я расстроился без твоих сообщений. Но потом подумал - может, тебе просто нужно было побыть с собой? Это тоже важно. Главное, не забывай возвращаться 💫',
            'Даже если вчера не получилось, сегодня - новая возможность 🙌🏻 Давай продолжим нашу работу? Я готов начать, когда тебе удобно. Без спешки, без давления. Просто ты,\nя и путь к твоей лучшей жизни 🤩',
            'Вчера ты не написал... Я волновался и думал о тебе. Знаешь, что хочу сказать? Спасибо, что ты вообще начал этот путь. Это требует смелости 🌱 Возвращайся поскорее! Я здесь для тебя 🐸',
            'Эй, ты как? Вчера от тебя не было новостей 😮‍💨 Но давай договоримся - никакого чувства вины за пропущенный день. Жизнь случается, и это нормально. Важно то, что ты можешь продолжить в любой момент. Хоть прямо сейчас! Давай?) 😊',
            'Не дождался твоего ответа вчера... Я беспокоюсь! Знаешь, даже если трудно начать - маленькими шагами мы справимся 👣 Помни - я здесь, чтобы помочь тебе чувствовать себя лучше. Давай продолжим? 😊',
            'Даже если вчера не получилось сделать задания - не страшно! Сегодня новый день, и у нас есть возможность все исправить. Ты справишься 💚',
            'Заметил, что вчера от тебя не было сообщений 🧐 Это заставило меня поволноваться! Но я верю - ты найдешь силы продолжить 💪🏻 Сделай вчерашние задания 📝',
            'Вчерашняя тишина меня огорчила... Но знаешь что важно? Ты можешь продолжить прямо сейчас! Я буду рядом 💚',
          ];

          cleanedText = fallbackExamples[Math.floor(Math.random() * fallbackExamples.length)];
          schedulerLogger.warn('⚠️ LLM вернул ошибку, используем fallback из примеров промптов 1-3');
        }

        // ВРЕМЕННО ОТКЛЮЧЕНО ДЛЯ ТЕСТИРОВАНИЯ: Для вариантов 1-3 прогоняем через промпт 5 (перепроверка)
        const validationPrompt = null; // this.extractPromptSection(angryPromptsFile, 5);
        if (validationPrompt) {
          const validationRequest = `${validationPrompt}\n\nТекст для проверки:\n${cleanedText}`;
          const validatedText = await generateMessage(validationRequest);

          // Если валидация вернула результат, используем его
          if (validatedText && validatedText !== 'HF_JSON_ERROR') {
            // Проверяем, не является ли ответ подтверждением что всё ОК
            const validationOkPatterns = [
              /^ошибок не обнаружено/i,
              /^текст корректен/i,
              /^все правильно/i,
              /^всё правильно/i,
              /^текст не требует исправлений/i,
              /^исправления не требуются/i,
              /^текст соответствует/i,
              /^ошибок нет/i,
              /^OK$/i,
              /^CORRECT$/i,
              /^✓$/,
              /^✅/,
              /^👍/,
            ];

            const cleanedValidation = cleanLLMText(validatedText).trim();
            const isValidationOk = validationOkPatterns.some(pattern => pattern.test(cleanedValidation));

            if (isValidationOk) {
              // Модель подтвердила, что текст корректен - используем оригинальный
              finalText = cleanedText;
              schedulerLogger.info(
                {
                  validationResponse: cleanedValidation.substring(0, 50),
                },
                '✅ Валидация подтвердила корректность текста, используем оригинал'
              );
            } else {
              // Модель внесла исправления - используем их
              finalText = cleanLLMText(validatedText);
              schedulerLogger.info(
                {
                  originalLength: validatedText.length,
                  cleanedLength: finalText.length,
                  preview: finalText.substring(0, 50),
                },
                '✅ Текст прошел валидацию и очистку через промпт 5'
              );
            }
          } else {
            // Если валидация не удалась, используем оригинальный текст
            finalText = cleanedText;
            schedulerLogger.warn('⚠️ Валидация не удалась, используем оригинальный текст');
          }
        } else {
          finalText = cleanedText;
        }
      }

      // Ограничиваем длину текста
      finalText = finalText.length > 500 ? finalText.slice(0, 497) + '...' : finalText;

      // Генерируем злое изображение лягушки
      const angryImagePrompt = readFileSync('assets/prompts/frog-image-promt-angry', 'utf-8');
      let imageBuffer: Buffer | null = null;

      try {
        imageBuffer = await generateFrogImage(angryImagePrompt);
        schedulerLogger.info({ userId }, '🎨 Злое изображение лягушки сгенерировано');
      } catch (imageError) {
        schedulerLogger.error({ error: imageError, userId }, 'Ошибка генерации злого изображения');
      }

      // Отправляем в канал с повторными попытками
      const sentMessage = await this.sendWithRetry(
        async () => {
          if (imageBuffer) {
            return await this.bot.telegram.sendPhoto(
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
            return await this.bot.telegram.sendPhoto(
              this.CHANNEL_ID,
              { source: imagePath },
              {
                caption: finalText,
                parse_mode: 'HTML',
              }
            );
          }
        },
        {
          chatId: userId,
          messageType: 'angry_post',
          maxAttempts: 20,
          intervalMs: 10000,
        }
      );

      schedulerLogger.info({ userId, messageId: sentMessage.message_id }, '😠 Злой пост отправлен в канал');

      // Сохраняем информацию о злом посте в БД
      const { saveAngryPost } = await import('./db');

      // Ждем немного, чтобы пост был переслан в группу обсуждений
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Получаем thread_id из памяти или БД
      let threadId: number | null = this.forwardedMessages.get(sentMessage.message_id) || null;

      if (!threadId) {
        const { db } = await import('./db');
        const row = db
          .query('SELECT thread_id FROM thread_mappings WHERE channel_message_id = ?')
          .get(sentMessage.message_id) as any;
        threadId = row?.thread_id || null;
      }

      // Сохраняем злой пост
      saveAngryPost(sentMessage.message_id, threadId, userId);
      schedulerLogger.info({ channelMessageId: sentMessage.message_id, threadId, userId }, 'Злой пост сохранен в БД');

      // Сохраняем сообщение в историю
      saveMessage(userId, finalText, new Date().toISOString());
    } catch (error) {
      throw error;
    }
  }

  // Отправка утреннего поста в 9:00
  async sendMorningMessage(chatId: number) {
    try {
      schedulerLogger.debug({ chatId }, 'Начало отправки утреннего сообщения');

      // Показываем, что бот "пишет"
      await this.bot.telegram.sendChatAction(this.CHANNEL_ID, 'upload_photo');

      // Генерируем текст утреннего сообщения
      const morningPrompt = readFileSync('assets/prompts/morning-message.md', 'utf-8');
      const morningText = await generateMessage(morningPrompt);
      const cleanedText = cleanLLMText(morningText);

      schedulerLogger.info({ chatId, text: cleanedText }, 'Сгенерирован текст утреннего сообщения');

      // Генерируем изображение лягушки
      let imageBuffer: Buffer | null = null;
      try {
        const imagePrompt = readFileSync('assets/prompts/frog-image-prompt-morning', 'utf-8');
        schedulerLogger.info({ chatId, imagePrompt }, '🎨 Промпт для утреннего изображения');
        imageBuffer = await generateFrogImage(imagePrompt);
      } catch (imageError) {
        const imgErr = imageError as Error;
        schedulerLogger.error(
          {
            error: imgErr.message,
            stack: imgErr.stack,
            chatId,
          },
          'Ошибка генерации изображения для утреннего сообщения'
        );
      }

      // Добавляем текст "Переходи в комментарии и продолжим 😉"
      const captionWithComment = cleanedText + '\n\nПереходи в комментарии и продолжим 😉';

      // Отправляем основной пост БЕЗ кнопок
      let sentMessage;
      if (imageBuffer) {
        sentMessage = await this.bot.telegram.sendPhoto(
          this.CHANNEL_ID,
          { source: imageBuffer },
          {
            caption: captionWithComment,
            parse_mode: 'HTML',
          }
        );
        schedulerLogger.info(
          {
            chatId,
            messageLength: cleanedText.length,
            imageSize: imageBuffer.length,
          },
          'Утреннее сообщение с сгенерированным изображением отправлено'
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
            messageLength: cleanedText.length,
            imagePath,
          },
          'Утреннее сообщение с изображением из ротации отправлено (fallback)'
        );
      }

      const messageId = sentMessage.message_id;

      // Сохраняем пост в БД как утренний (с типом morning)
      const { saveMorningPost } = await import('./db');
      const postUserId = this.isTestBot() ? this.getTestUserId() : this.getMainUserId();
      saveMorningPost(messageId, postUserId);

      schedulerLogger.info({ messageId, chatId }, '💾 Утренний пост сохранен в БД');

      // Получаем ID группы обсуждений
      const CHAT_ID = this.getChatId();
      if (CHAT_ID) {
        // Отправляем первое сообщение в комментарии асинхронно
        this.sendFirstTaskAsync(
          messageId,
          'Когда будешь готов поделиться - просто напиши! Я здесь для тебя 🤗',
          undefined,
          'morning_initial',
          chatId,
          CHAT_ID
        );
      }

      schedulerLogger.info({ chatId }, 'Утренний пост успешно отправлен');
    } catch (e) {
      const error = e as Error;
      schedulerLogger.error({ error: error.message, stack: error.stack, chatId }, 'Ошибка отправки утреннего сообщения');
      throw error;
    }
  }

  // Обработка ответов пользователя на утренний пост
  private async handleMorningPostResponse(
    userId: number,
    messageText: string,
    replyToChatId: number,
    messageId: number,
    morningPost: { id: number; channel_message_id: number; user_id: number; created_at: string; current_step: string; last_button_message_id?: number }
  ) {
    const { updateMorningPostStep, updateMorningPostButtonMessage, saveMessage } = await import('./db');
    const { getLastNMessages } = await import('./db');
    const { checkRudeMessage } = await import('./utils/rude-filter');

    schedulerLogger.info(
      {
        userId,
        currentStep: morningPost.current_step,
        messageText: messageText.substring(0, 50),
      },
      '🌅 Обработка ответа на утренний пост'
    );

    // Сохраняем сообщение пользователя в БД (независимо от того, нажал ли он кнопку)
    saveMessage(userId, messageText, new Date().toISOString(), userId);
    schedulerLogger.debug({ userId, messageText: messageText.substring(0, 50) }, '💾 Сообщение пользователя сохранено в БД');

    // Проверка на грубость/фигню БЕЗ LLM
    const rudeCheck = checkRudeMessage(messageText, userId);
    if (rudeCheck.isRude && rudeCheck.response) {
      await this.sendWithRetry(
        () =>
          this.bot.telegram.sendMessage(replyToChatId, rudeCheck.response!, {
            reply_parameters: { message_id: messageId },
          }),
        {
          chatId: userId,
          messageType: 'morning_rude_response',
          maxAttempts: 5,
          intervalMs: 3000,
        }
      );

      schedulerLogger.info({ userId, messageText }, '✅ Отправлен ответ на грубость/фигню');
      return;
    }

    // Обработка в зависимости от шага
    if (morningPost.current_step === 'waiting_user_message') {
      // ШАГ 1: Пользователь написал первое сообщение

      // Ставим реакцию 👀 на сообщение пользователя
      try {
        await this.bot.telegram.setMessageReaction(replyToChatId, messageId, [{ type: 'emoji', emoji: '👀' }]);
        schedulerLogger.debug({ userId, messageId }, '👀 Поставлена реакция на сообщение (ШАГ 1)');
      } catch (reactionError) {
        schedulerLogger.warn({ reactionError, messageId }, 'Не удалось поставить реакцию 👀 (ШАГ 1)');
      }

      // Отправляем сообщение с кнопкой "Ответь мне"
      const responseText = 'Дописал? Тыкай на кнопку 🐸';
      const keyboard = {
        inline_keyboard: [[{ text: 'Ответь мне', callback_data: `morning_respond_${morningPost.channel_message_id}` }]],
      };

      const sentMessage = await this.sendWithRetry(
        () =>
          this.bot.telegram.sendMessage(replyToChatId, responseText, {
            reply_parameters: { message_id: messageId },
            reply_markup: keyboard,
          }),
        {
          chatId: userId,
          messageType: 'morning_step1',
          maxAttempts: 5,
          intervalMs: 3000,
        }
      );

      // Сохраняем ID отправленного сообщения
      if (sentMessage) {
        updateMorningPostButtonMessage(morningPost.channel_message_id, sentMessage.message_id);
      }

      // Обновляем шаг
      updateMorningPostStep(morningPost.channel_message_id, 'waiting_button_click');

      schedulerLogger.info({ userId }, '✅ ШАГ 1: Отправлено сообщение с кнопкой');
    } else if (morningPost.current_step === 'waiting_button_click') {
      // Ставим реакцию 👀 на сообщение пользователя
      try {
        await this.bot.telegram.setMessageReaction(replyToChatId, messageId, [{ type: 'emoji', emoji: '👀' }]);
        schedulerLogger.debug({ userId, messageId }, '👀 Поставлена реакция на сообщение (waiting_button_click)');
      } catch (reactionError) {
        schedulerLogger.warn({ reactionError, messageId }, 'Не удалось поставить реакцию 👀 (waiting_button_click)');
      }

      // Удаляем предыдущее сообщение с кнопкой (если оно есть)
      if (morningPost.last_button_message_id) {
        try {
          await this.bot.telegram.deleteMessage(replyToChatId, morningPost.last_button_message_id);
          schedulerLogger.info({ userId, deletedMessageId: morningPost.last_button_message_id }, '🗑️ Удалено предыдущее сообщение с кнопкой');
        } catch (error) {
          schedulerLogger.warn({ error, messageId: morningPost.last_button_message_id }, 'Не удалось удалить предыдущее сообщение с кнопкой');
        }
      }

      // Пользователь продолжает писать, повторяем сообщение с кнопкой
      const responseText = 'Дописал? Тыкай на кнопку 🐸';
      const keyboard = {
        inline_keyboard: [[{ text: 'Ответь мне', callback_data: `morning_respond_${morningPost.channel_message_id}` }]],
      };

      const sentMessage = await this.sendWithRetry(
        () =>
          this.bot.telegram.sendMessage(replyToChatId, responseText, {
            reply_parameters: { message_id: messageId },
            reply_markup: keyboard,
          }),
        {
          chatId: userId,
          messageType: 'morning_step1_repeat',
          maxAttempts: 5,
          intervalMs: 3000,
        }
      );

      // Сохраняем ID нового сообщения
      if (sentMessage) {
        updateMorningPostButtonMessage(morningPost.channel_message_id, sentMessage.message_id);
      }

      schedulerLogger.info({ userId }, '✅ ШАГ 1: Повторно отправлено сообщение с кнопкой');
    } else if (morningPost.current_step === 'waiting_more_emotions' || morningPost.current_step.startsWith('waiting_more_emotions_')) {
      // ШАГ 2.5: Пользователь написал больше об эмоциях после просьбы

      // Ставим реакцию 👀 на сообщение пользователя
      try {
        await this.bot.telegram.setMessageReaction(replyToChatId, messageId, [{ type: 'emoji', emoji: '👀' }]);
        schedulerLogger.debug({ userId, messageId }, '👀 Поставлена реакция на сообщение (waiting_more_emotions)');
      } catch (reactionError) {
        schedulerLogger.warn({ reactionError, messageId }, 'Не удалось поставить реакцию 👀 (waiting_more_emotions)');
      }

      // Переходим к анализу и ШАГу 3
      await this.processMorningStep3(userId, messageText, replyToChatId, messageId, morningPost);
    } else if (morningPost.current_step === 'waiting_more') {
      // Пользователь продолжает делиться после финального ответа

      // Ставим реакцию 👀 на сообщение пользователя
      try {
        await this.bot.telegram.setMessageReaction(replyToChatId, messageId, [{ type: 'emoji', emoji: '👀' }]);
        schedulerLogger.debug({ userId, messageId }, '👀 Поставлена реакция на сообщение (waiting_more)');
      } catch (reactionError) {
        schedulerLogger.warn({ reactionError, messageId }, 'Не удалось поставить реакцию 👀 (waiting_more)');
      }

      // Запускаем логику заново с кнопкой "Ответь мне"
      schedulerLogger.info({ userId, currentStep: morningPost.current_step }, '🔄 Пользователь продолжает делиться, отправляем кнопку');

      // Удаляем предыдущую кнопку если есть
      const { getMorningPost } = await import('./db');
      const currentPost = getMorningPost(morningPost.channel_message_id);
      if (currentPost?.last_button_message_id) {
        try {
          await this.bot.telegram.deleteMessage(replyToChatId, currentPost.last_button_message_id);
          schedulerLogger.info({ userId, deletedMessageId: currentPost.last_button_message_id }, '🗑️ Удалено предыдущее сообщение с кнопкой');
        } catch (error) {
          schedulerLogger.warn({ error }, 'Не удалось удалить предыдущее сообщение с кнопкой');
        }
      }

      // Отправляем кнопку "Ответь мне"
      const responseText = 'Дописал? Тыкай на кнопку 🐸';

      const sentMessage = await this.sendWithRetry(
        () =>
          this.bot.telegram.sendMessage(replyToChatId, responseText, {
            reply_parameters: { message_id: messageId },
            reply_markup: {
              inline_keyboard: [[{ text: 'Ответь мне', callback_data: `morning_respond_${morningPost.channel_message_id}` }]],
            },
          }),
        {
          chatId: userId,
          messageType: 'morning_step1_repeat',
          maxAttempts: 5,
          intervalMs: 3000,
        }
      );

      // Сохраняем ID кнопки
      if (sentMessage) {
        const { updateMorningPostButtonMessage } = await import('./db');
        updateMorningPostButtonMessage(morningPost.channel_message_id, sentMessage.message_id);
      }

      // Обновляем шаг
      const { updateMorningPostStep } = await import('./db');
      updateMorningPostStep(morningPost.channel_message_id, 'waiting_button_click');

      schedulerLogger.info({ userId }, '✅ Отправлена кнопка для продолжения диалога');
    } else if (morningPost.current_step === 'completed') {
      // Сессия завершена (старая логика, больше не используется)
      const finalText = 'Спасибо что делишься! Я всегда рад тебя слушать 🤗';

      await this.sendWithRetry(
        () =>
          this.bot.telegram.sendMessage(replyToChatId, finalText, {
            reply_parameters: { message_id: messageId },
          }),
        {
          chatId: userId,
          messageType: 'morning_completed',
          maxAttempts: 5,
          intervalMs: 3000,
        }
      );

      schedulerLogger.info({ userId }, '✅ Утренняя сессия уже завершена, отправлена благодарность');
    }
  }

  // ШАГ 3: Финальная обработка с анализом эмоций
  private async processMorningStep3(
    userId: number,
    messageText: string,
    replyToChatId: number,
    messageId: number,
    morningPost: { id: number; channel_message_id: number; user_id: number; created_at: string; current_step: string }
  ) {
    const { updateMorningPostStep } = await import('./db');
    const { getLastNMessages } = await import('./db');

    // Получаем все сообщения пользователя за эту сессию
    const messages = getLastNMessages(userId, 10);
    const userMessages = messages
      .filter(m => m.author_id === userId)
      .map(m => m.message_text)
      .reverse()
      .join('\n');

    schedulerLogger.info({ userId, messagesCount: messages.length }, 'ШАГ 3: Финальный ответ с поддержкой');

    // Ставим реакцию 👀 на сообщение пользователя чтобы показать что читаем
    try {
      await this.bot.telegram.setMessageReaction(replyToChatId, messageId, [{ type: 'emoji', emoji: '👀' }]);
      schedulerLogger.debug({ userId, messageId }, '👀 Поставлена реакция на сообщение');
    } catch (reactionError) {
      schedulerLogger.warn({ reactionError, messageId }, 'Не удалось поставить реакцию 👀');
    }

    // Определяем sentiment из current_step
    const sentiment = morningPost.current_step.includes('negative') ? 'negative' : 'positive';

    // Генерируем финальный ответ в зависимости от sentiment
    let finalPrompt = '';
    if (sentiment === 'negative') {
      finalPrompt = `Контекст всех сообщений пользователя:
${userMessages}

Пользователь поделился негативными эмоциями. Не повторяя предыдущих слов - еще раз кратко вырази поддержку или напиши что-то приятное человеку, чтобы его утешить или поднять настроение.

Требования:
- До 200 символов
- До 2 эмоджи
- Тепло, заботливо и искренне
- Как человек, а не робот
- НЕ используй обращения типа "брат", "братан", "бро", "слушай" и т.п.
- Мужской род (например, "я рад помочь")
- ТОЛЬКО текст поддержки, без кавычек, без технической информации`;
    } else {
      finalPrompt = `Контекст всех сообщений пользователя:
${userMessages}

Пользователь поделился позитивными эмоциями. Не повторяя предыдущих слов - пожелай человеку чаще испытывать больше хороших эмоций, похвали или еще раз порадуйся за человека.

Требования:
- До 200 символов
- До 2 эмоджи
- Тепло, заботливо и искренне
- Как человек, а не робот
- НЕ используй обращения типа "брат", "братан", "бро", "слушай" и т.п.
- Мужской род (например, "я рад за тебя")
- ТОЛЬКО текст поддержки, без кавычек, без технической информации`;
    }

    const finalResponse = await generateMessage(finalPrompt);
    const cleanedFinalResponse = cleanLLMText(finalResponse);

    // Добавляем фразу "Если захочешь еще чем-то поделиться - я рядом 🤗"
    const fullMessage = `${cleanedFinalResponse}\n\nЕсли захочешь еще чем-то поделиться - я рядом 🤗`;

    await this.sendWithRetry(
      () =>
        this.bot.telegram.sendMessage(replyToChatId, fullMessage, {
          reply_parameters: { message_id: messageId },
        }),
      {
        chatId: userId,
        messageType: 'morning_step3',
        maxAttempts: 5,
        intervalMs: 3000,
      }
    );

    // Обновляем шаг на "waiting_more" чтобы бот продолжал слушать (работа по кругу)
    updateMorningPostStep(morningPost.channel_message_id, 'waiting_more');

    schedulerLogger.info({ userId }, '✅ ШАГ 3: Отправлен финальный ответ с поддержкой');
  }

  // Построение второй части сообщения
  public buildSecondPart(json: any, isSimplified: boolean = false): string {
    if (isSimplified) {
      // Для упрощенного сценария используем новый текст
      let message =
        '2. <b>Плюшки для лягушки</b>\n\nВспомни и напиши все приятное за день\nТут тоже опиши эмоции, которые ты испытал 😍';
      return message;
    } else {
      // Для обычного сценария оставляем старый текст
      let message = '2. <b>Плюшки для лягушки</b> (ситуация+эмоция)';
      return message;
    }
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

    // Сначала проверяем, не является ли это комментарием к злому посту
    if (messageThreadId) {
      const { isAngryPostByThreadId } = await import('./db');
      const isAngryComment = await isAngryPostByThreadId(messageThreadId);

      if (isAngryComment) {
        schedulerLogger.info(
          {
            userId,
            messageThreadId,
            messageText: messageText.substring(0, 50),
          },
          '😠 Обнаружен комментарий к злому посту'
        );

        // Увеличиваем счётчик ответов пользователя
        const responseCount = incrementAngryPostUserResponse(messageThreadId, userId);

        // Определяем текст ответа в зависимости от количества ответов
        let responseText = '';

        if (responseCount === 1) {
          // Первый ответ
          responseText = 'Я рад тебя слышать! 🤗\nВыполни задания под вчерашним постом ✍🏻';
        } else if (responseCount === 2) {
          // Второй ответ
          responseText = 'Буду ждать тебя там 🐸';
        } else {
          // Третий и последующие - не реагируем
          schedulerLogger.info(
            { userId, messageThreadId, responseCount },
            '🔇 Пользователь написал больше 2 раз, игнорируем'
          );
          return true;
        }

        // Отправляем ответ
        await this.sendWithRetry(
          () =>
            this.bot.telegram.sendMessage(replyToChatId, responseText, {
              reply_parameters: {
                message_id: messageId,
              },
            }),
          {
            chatId: userId,
            messageType: 'angry_post_response',
            maxAttempts: 5,
            intervalMs: 3000,
          }
        );

        schedulerLogger.info({ userId, responseCount }, '✅ Отправлен ответ на комментарий к злому посту');
        return true; // Возвращаем true, чтобы показать что сообщение обработано
      }
    }

    // Проверяем, не является ли это комментарием к утреннему посту
    if (messageThreadId) {
      const { getMorningPost } = await import('./db');

      // Пробуем найти утренний пост по messageThreadId
      let morningPost = await getMorningPost(messageThreadId);

      // Если не нашли напрямую, ищем через маппинг пересланных сообщений
      if (!morningPost) {
        let mappedChannelId = null;

        // Проверяем в памяти
        for (const [channelId, forwardedId] of this.forwardedMessages.entries()) {
          if (forwardedId === messageThreadId) {
            mappedChannelId = channelId;
            break;
          }
        }

        // Если не нашли в памяти, проверяем в БД
        if (!mappedChannelId) {
          const { getChannelMessageIdByThreadId } = require('./db');
          mappedChannelId = await getChannelMessageIdByThreadId(messageThreadId);
        }

        if (mappedChannelId) {
          morningPost = await getMorningPost(mappedChannelId);
        }
      }

      if (morningPost) {
        schedulerLogger.info(
          {
            userId,
            messageThreadId,
            morningPostId: morningPost.channel_message_id,
            currentStep: morningPost.current_step,
            messageText: messageText.substring(0, 50),
          },
          '🌅 Обнаружен комментарий к утреннему посту'
        );

        // Обрабатываем комментарий к утреннему посту
        await this.handleMorningPostResponse(
          userId,
          messageText,
          replyToChatId,
          messageId,
          morningPost
        );

        return true; // Возвращаем true, чтобы показать что сообщение обработано
      }
    }

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

    // Проверяем на грубый/бессмысленный ответ
    try {
      const { checkRudeMessage, resetKeyboardSpamCounter } = await import('./utils/rude-filter');
      const rudeCheck = checkRudeMessage(messageText, userId);

      if (rudeCheck.isRude) {
        schedulerLogger.info(
          { userId, messageText: messageText.substring(0, 50), response: rudeCheck.response },
          'Обнаружен грубый/бессмысленный ответ'
        );

        // Отправляем ответ
        if (rudeCheck.response) {
          try {
            await this.bot.telegram.sendMessage(replyToChatId, rudeCheck.response, {
              reply_parameters: { message_id: messageId },
            });
          } catch (sendError) {
            schedulerLogger.error({ error: sendError }, 'Ошибка отправки ответа на грубое сообщение');
          }
        }

        // Не продолжаем обработку, ждем нормальный ответ
        return true;
      } else if (!rudeCheck.needsCounter) {
        // Если это был нормальный ответ - сбрасываем счетчик набора букв
        resetKeyboardSpamCounter(userId);
      }
    } catch (rudeError) {
      schedulerLogger.error({ error: rudeError }, 'Ошибка проверки грубого ответа, продолжаем как обычно');
      // При ошибке продолжаем как с обычным ответом
    }

    // Проверяем, нужно ли устанавливать напоминание
    const practiceStates = ['waiting_practice', 'deep_waiting_practice', 'finished', 'completed'];
    const shouldSetReminder = !practiceStates.includes(session.currentStep);

    if (shouldSetReminder) {
      // Перезапускаем таймер напоминания при каждом ответе пользователя
      // Отменяем предыдущий таймер если есть
      this.clearReminder(userId);

      // Устанавливаем новый таймер от текущего момента
      await this.setIncompleteWorkReminder(userId, channelMessageId);
      const delayMinutes = this.isTestBot() ? 1 : 30;
      schedulerLogger.debug(
        { userId, channelMessageId, delayMinutes },
        `⏰ Таймер напоминания перезапущен (${delayMinutes} мин от последней активности)`
      );
    } else {
      // Если пользователь дошел до практики или завершил работу - отменяем напоминание
      this.clearReminder(userId);
      schedulerLogger.debug(
        { userId, channelMessageId, currentStep: session.currentStep },
        '⏰ Напоминание отменено - пользователь на финальном этапе'
      );
    }

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
        const secondTaskText = `<i>${escapeHTML(
          supportText
        )}</i>\n\n<b>Выбери 1 ситуацию, с которой хочешь поработать, и опиши ее подробно 📝</b>\n\n<i>💡 Ты можешь разобрать событие из прошлого, если сегодня ничего не произошло или что-то больше беспокоит</i>`;

        // Кнопка "Таблица эмоций"
        const emotionsTableKeyboard = {
          inline_keyboard: [[{ text: 'Таблица эмоций', callback_data: `emotions_table_${channelMessageId}` }]],
        };

        // Отправляем второе сообщение с кнопкой
        const secondTaskMessage = await this.sendWithRetry(
          () =>
            this.bot.telegram.sendMessage(replyToChatId, secondTaskText, {
              parse_mode: 'HTML',
              reply_markup: emotionsTableKeyboard,
              reply_parameters: {
                message_id: messageId,
              },
            }),
          {
            chatId: userId,
            messageType: 'deep_second_task',
            maxAttempts: 10,
            intervalMs: 5000,
            onSuccess: async result => {
              // Обновляем состояние - теперь ждем выбранную ситуацию
              const { updateInteractivePostState } = await import('./db');
              updateInteractivePostState(channelMessageId, 'deep_waiting_negative', {
                bot_task2_message_id: result.message_id,
                user_task1_message_id: messageId,
              });
            },
          }
        );

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

      if (session.currentStep === 'deep_waiting_harm') {
        const { getDeepWorkHandler } = await import('./handlers/callbacks/deep_work_buttons');
        const deepHandler = getDeepWorkHandler(this.bot, replyToChatId);
        await deepHandler.handleHarmResponse(channelMessageId, messageText, userId, messageId);
        return;
      }

      if (session.currentStep === 'deep_waiting_rational') {
        // Завершаем работу с фильтрами
        const sendOptions: any = {
          parse_mode: 'HTML',
          reply_parameters: {
            message_id: messageId,
          },
        };

        const sendOptionsWithButton: any = {
          parse_mode: 'HTML',
          reply_parameters: {
            message_id: messageId,
          },
          reply_markup: {
            inline_keyboard: [[{ text: 'Вперед 🔥', callback_data: `deep_continue_to_treats_${channelMessageId}` }]],
          },
        };

        await this.sendWithRetry(
          () =>
            this.bot.telegram.sendMessage(
              replyToChatId,
              '<i>🎉 Отлично! Сложная часть позади!\n' + 'Можно выдохнуть 😌</i>\n\n' + 'Перейдем к более приятной 🤗',
              sendOptionsWithButton
            ),
          {
            chatId: userId,
            messageType: 'deep_rational_complete',
            maxAttempts: 10,
            intervalMs: 5000,
            onSuccess: async () => {
              const { updateInteractivePostState, updateTaskStatus } = await import('./db');
              updateInteractivePostState(channelMessageId, 'deep_waiting_continue_to_treats');
              updateTaskStatus(channelMessageId, 1, true);
            },
          }
        );

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

        // Импортируем функцию подсчета эмоций
        const { countEmotions, getEmotionHelpMessage } = await import('./utils/emotions');

        // Проверяем количество позитивных эмоций в ответе
        const emotionAnalysis = countEmotions(messageText, 'positive');

        // Проверяем, не запрашивали ли мы уже дополнение негативных эмоций в глубоком сценарии
        const negativeEmotionsWereRequested = activePost?.current_state === 'schema_waiting_emotions_clarification';

        schedulerLogger.debug(
          {
            userId,
            channelMessageId,
            positiveEmotionsCount: emotionAnalysis.count,
            positiveEmotions: emotionAnalysis.emotions,
            categories: emotionAnalysis.categories,
            negativeEmotionsWereRequested,
            scenario: 'deep',
          },
          'Анализ позитивных эмоций в плюшках (глубокий сценарий)'
        );

        // Если эмоций мало И мы не просили дополнить негативные эмоции - предлагаем дополнить
        if (emotionAnalysis.count < 3 && !negativeEmotionsWereRequested) {
          const helpMessage = getEmotionHelpMessage(emotionAnalysis.emotions, 'positive');

          const sendOptions: any = {
            parse_mode: 'HTML',
            reply_parameters: {
              message_id: messageId,
            },
            reply_markup: {
              inline_keyboard: [
                [{ text: 'Таблица эмоций', callback_data: `emotions_table_${channelMessageId}` }],
                [{ text: 'Пропустить', callback_data: `skip_positive_emotions_${channelMessageId}` }],
              ],
            },
          };

          try {
            await this.sendWithRetry(() => this.bot.telegram.sendMessage(replyToChatId, helpMessage, sendOptions), {
              chatId: userId,
              messageType: 'positive_emotions_help_deep',
              maxAttempts: 10,
              intervalMs: 5000,
            });

            // Обновляем состояние в БД сразу после успешной отправки
            const { updateInteractivePostState } = await import('./db');
            updateInteractivePostState(channelMessageId, 'deep_waiting_positive_emotions_clarification', {
              user_task2_message_id: messageId,
            });

            // Обновляем состояние сессии
            session.currentStep = 'deep_waiting_positive_emotions_clarification';
            return true;
          } catch (helpError) {
            schedulerLogger.error(
              { error: helpError },
              'Ошибка отправки помощи с позитивными эмоциями в глубоком сценарии, продолжаем с практикой'
            );
            // Продолжаем дальше к практике
          }
        }

        // Если эмоций достаточно, были негативные эмоции или произошла ошибка - продолжаем как обычно

        // Отмечаем второе задание как выполненное
        const { updateTaskStatus } = await import('./db');
        updateTaskStatus(channelMessageId, 2, true);

        let finalMessage = '<i>Вау! 🤩 Ты справился! Это было потрясающе!</i>\n\n';
        finalMessage += 'Последний шаг - время замедлиться и побыть в покое 🤍\n';
        finalMessage += '3. <b>Дыхательная практика</b>\n\n';
        finalMessage +=
          '<blockquote><b>Дыхание по квадрату:</b>\nВдох на 4 счета, задержка дыхания на 4 счета, выдох на 4 счета и задержка на 4 счета</blockquote>';

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

        // Логируем перед отправкой видео
        schedulerLogger.info(
          {
            channelMessageId,
            replyToChatId,
            messageId,
            practiceVideoPath: this.PRACTICE_VIDEO_PATH,
            step: 'before_deep_video_send',
            isTestBot: this.isTestBot(),
            chatId: replyToChatId,
          },
          '🎬 [DEEP] Готовимся отправить видео с практикой'
        );

        // Отправляем видео с дыхательной практикой
        const practiceVideo = readFileSync(this.PRACTICE_VIDEO_PATH);
        const thumbnailBuffer = readFileSync(this.PRACTICE_VIDEO_THUMBNAIL_PATH);

        const task3Message = await this.sendWithRetry(
          () =>
            this.bot.telegram.sendVideo(replyToChatId, { source: practiceVideo }, {
              caption: finalMessage,
              parse_mode: 'HTML',
              reply_to_message_id: messageId, // Используем reply_to_message_id вместо reply_parameters
              reply_markup: practiceKeyboard,
              thumbnail: { source: thumbnailBuffer },
            } as any),
          {
            chatId: userId,
            messageType: 'deep_practice_video',
            maxAttempts: 20,
            intervalMs: 10000,
            onSuccess: async result => {
              // Логика перенесена после вызова
            },
          }
        );

        // Сохраняем сообщение
        saveMessage(userId, finalMessage, new Date().toISOString(), 0);

        // Обновляем состояние в БД
        const { updateInteractivePostState } = await import('./db');
        updateInteractivePostState(channelMessageId, 'deep_waiting_practice', {
          bot_task3_message_id: task3Message.message_id,
          user_task2_message_id: messageId,
        });

        // Отмечаем что задание 3 было отправлено (практика)
        updateTaskStatus(channelMessageId, 3, true);

        // Отменяем напоминание о незавершенной работе, так как пользователь дошел до практики
        this.clearReminder(userId);
        schedulerLogger.debug(
          { userId, channelMessageId },
          'Напоминание о незавершенной работе отменено - пользователь дошел до практики (глубокий сценарий)'
        );

        return;
      }

      // Обработка состояния deep_waiting_positive_emotions_clarification
      if (session.currentStep === 'deep_waiting_positive_emotions_clarification') {
        // Пользователь дополнил ответ про позитивные эмоции в глубоком сценарии
        schedulerLogger.info(
          {
            userId,
            channelMessageId,
            messageText: messageText.substring(0, 50),
          },
          'Получен дополненный ответ про позитивные эмоции (глубокий сценарий)'
        );

        // Сохраняем ответ пользователя в БД
        const { getUserByChatId } = await import('./db');
        const user = getUserByChatId(userId);
        if (user) {
          saveMessage(userId, messageText, new Date().toISOString(), user.id);
        }

        // Отмечаем второе задание как выполненное
        const { updateTaskStatus } = await import('./db');
        updateTaskStatus(channelMessageId, 2, true);

        // Сохраняем ID ответа пользователя
        const { updateInteractivePostState } = await import('./db');
        updateInteractivePostState(channelMessageId, 'deep_waiting_practice', {
          user_positive_emotions_clarification_message_id: messageId,
        });

        // Отправляем финальную часть с особым текстом для глубокого сценария
        let finalMessage = '<i>Вау! 🤩 Ты справился! Это было потрясающе!</i>\n\n';
        finalMessage += 'Последний шаг - время замедлиться и побыть в покое 🤍\n';
        finalMessage += '3. <b>Дыхательная практика</b>\n\n';
        finalMessage +=
          '<blockquote><b>Дыхание по квадрату:</b>\nВдох на 4 счета, задержка дыхания на 4 счета, выдох на 4 счета и задержка на 4 счета</blockquote>';

        const practiceKeyboard = {
          inline_keyboard: [
            [{ text: '✅ Сделал', callback_data: `pract_done_${channelMessageId}` }],
            [{ text: '⏰ Отложить на 1 час', callback_data: `pract_delay_${channelMessageId}` }],
          ],
        };

        try {
          // Отправляем видео с дыхательной практикой
          const practiceVideo = readFileSync(this.PRACTICE_VIDEO_PATH);
          const thumbnailBuffer = readFileSync(this.PRACTICE_VIDEO_THUMBNAIL_PATH);

          const task3Message = await this.sendWithRetry(
            () =>
              this.bot.telegram.sendVideo(replyToChatId, { source: practiceVideo }, {
                caption: finalMessage,
                parse_mode: 'HTML',
                reply_to_message_id: messageId,
                reply_markup: practiceKeyboard,
                thumbnail: { source: thumbnailBuffer },
              } as any),
            {
              chatId: userId,
              messageType: 'deep_practice_video_after_positive_clarification',
              maxAttempts: 20,
              intervalMs: 10000,
            }
          );

          // Сохраняем сообщение
          saveMessage(userId, finalMessage, new Date().toISOString(), 0);

          // Обновляем состояние в БД
          updateInteractivePostState(channelMessageId, 'deep_waiting_practice', {
            bot_task3_message_id: task3Message.message_id,
          });

          // Отмечаем что задание 3 было отправлено
          updateTaskStatus(channelMessageId, 3, true);

          // Отменяем напоминание о незавершенной работе
          this.clearReminder(userId);
          schedulerLogger.debug(
            { userId, channelMessageId },
            'Напоминание отменено - пользователь дошел до практики (глубокий сценарий после уточнения эмоций)'
          );

          return true;
        } catch (practiceError) {
          schedulerLogger.error(
            { error: practiceError },
            'Ошибка отправки практики после уточнения позитивных эмоций (глубокий сценарий)'
          );
          return false;
        }
      }

      // Обработка состояния deep_waiting_practice
      if (session.currentStep === 'deep_waiting_practice') {
        // Пользователь написал что-то после получения задания с практикой (глубокий сценарий)
        schedulerLogger.info(
          { userId, messageText: messageText.substring(0, 50) },
          'Получен текст вместо нажатия кнопки практики (глубокий сценарий)'
        );

        // Проверяем, отправляли ли мы уже напоминание
        const { updateInteractivePostState } = await import('./db');
        const { getInteractivePost } = await import('./db');
        const post = getInteractivePost(channelMessageId);

        if (!post?.practice_reminder_sent) {
          // Отправляем напоминание только один раз
          try {
            await this.sendWithRetry(
              () =>
                this.bot.telegram.sendMessage(
                  userId,
                  'Отличная работа! 🌟 Теперь выполни дыхательную практику и нажми "Сделал" после ее завершения'
                ),
              {
                chatId: userId,
                messageType: 'deep_practice_reminder',
                maxAttempts: 5,
                intervalMs: 3000,
              }
            );

            // Отмечаем, что напоминание отправлено
            updateInteractivePostState(channelMessageId, 'deep_waiting_practice', {
              practice_reminder_sent: true,
            });

            schedulerLogger.info(
              { channelMessageId },
              'Отправлено напоминание о необходимости нажать кнопку (глубокий сценарий)'
            );
          } catch (error) {
            schedulerLogger.error({ error }, 'Ошибка отправки напоминания о практике (глубокий сценарий)');
          }
        } else {
          // Напоминание уже было отправлено, просто игнорируем
          schedulerLogger.debug(
            { userId },
            'Игнорируем повторное сообщение - напоминание уже было отправлено (глубокий сценарий)'
          );
        }

        return true; // Всегда возвращаем true, чтобы не обрабатывать как обычное сообщение
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

      if (session.currentStep === 'schema_waiting_emotions_clarification') {
        const { getDeepWorkHandler } = await import('./handlers/callbacks/deep_work_buttons');
        const deepHandler = getDeepWorkHandler(this.bot, replyToChatId);
        await deepHandler.handleSchemaEmotionsClarificationResponse(channelMessageId, messageText, userId, messageId);
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

        // Импортируем функции из БД
        const { updateInteractivePostState, updateTaskStatus } = await import('./db');

        // Сохраняем ID сообщения пользователя
        updateInteractivePostState(channelMessageId, 'waiting_negative', {
          user_task1_message_id: messageId,
        });

        // Сразу анализируем ответ на наличие эмоций
        // Импортируем функцию подсчета эмоций
        const { countEmotions, getEmotionHelpMessage } = await import('./utils/emotions');

        // Проверяем количество эмоций в ответе
        const emotionAnalysis = countEmotions(messageText, 'negative');

        schedulerLogger.debug(
          {
            userId,
            channelMessageId,
            emotionsCount: emotionAnalysis.count,
            emotions: emotionAnalysis.emotions,
            categories: emotionAnalysis.categories,
          },
          'Анализ эмоций в ответе пользователя'
        );

        // Если меньше 3 эмоций - предлагаем дополнить
        if (emotionAnalysis.count < 3) {
          const helpMessage = getEmotionHelpMessage(emotionAnalysis.emotions, 'negative');

          const sendOptions: any = {
            parse_mode: 'HTML',
            reply_parameters: {
              message_id: messageId,
            },
            reply_markup: {
              inline_keyboard: [
                [{ text: 'Таблица эмоций', callback_data: `emotions_table_${channelMessageId}` }],
                [{ text: 'В другой раз', callback_data: `skip_neg_${channelMessageId}` }],
              ],
            },
          };

          try {
            const helpMessageResult = await this.sendWithRetry(
              () => this.bot.telegram.sendMessage(replyToChatId, helpMessage, sendOptions),
              {
                chatId: userId,
                messageType: 'emotions_help',
                maxAttempts: 10,
                intervalMs: 5000,
              }
            );

            // Обновляем состояние в БД сразу после успешной отправки
            updateInteractivePostState(channelMessageId, 'waiting_emotions_clarification', {
              user_schema_message_id: messageId,
            });

            // Обновляем состояние сессии
            session.currentStep = 'waiting_emotions_clarification';
            return true;
          } catch (helpError) {
            schedulerLogger.error({ error: helpError }, 'Ошибка отправки помощи с эмоциями, продолжаем с плюшками');
            // Продолжаем дальше если ошибка
          }
        }

        // Если эмоций достаточно или произошла ошибка - отправляем плюшки
        try {
          // Отмечаем первое задание как выполненное
          updateTaskStatus(channelMessageId, 1, true);

          // Отправляем плюшки с новым текстом
          const fallbackText =
            '2. <b>Плюшки для лягушки</b>\n\nВспомни и напиши все приятное за день\nТут тоже опиши эмоции, которые ты испытал 😍';

          const fallbackMessage = await this.sendWithRetry(
            () =>
              this.bot.telegram.sendMessage(replyToChatId, fallbackText, {
                parse_mode: 'HTML',
                reply_parameters: { message_id: messageId },
                reply_markup: {
                  inline_keyboard: [[{ text: 'Таблица эмоций', callback_data: `emotions_table_${channelMessageId}` }]],
                },
              }),
            {
              chatId: userId,
              messageType: 'positive_task',
              maxAttempts: 5,
              intervalMs: 3000,
            }
          );

          // Обновляем состояние
          updateInteractivePostState(channelMessageId, 'waiting_positive', {
            bot_task2_message_id: fallbackMessage.message_id,
          });

          session.currentStep = 'waiting_positive';
          return true;
        } catch (fallbackError2) {
          schedulerLogger.error({ error: fallbackError2 }, 'Критическая ошибка: не удалось отправить плюшки');
          return false;
        }
      } else if (session.currentStep === 'waiting_emotions') {
        // Пользователь ответил на вопрос про эмоции
        schedulerLogger.info(
          {
            userId,
            channelMessageId,
            messageText: messageText.substring(0, 50),
          },
          'Получен ответ на вопрос про эмоции'
        );

        // Импортируем функцию подсчета эмоций
        const { countEmotions, getEmotionHelpMessage } = await import('./utils/emotions');

        // Проверяем количество эмоций в ответе
        const emotionAnalysis = countEmotions(messageText, 'negative');

        schedulerLogger.debug(
          {
            userId,
            channelMessageId,
            emotionsCount: emotionAnalysis.count,
            emotions: emotionAnalysis.emotions,
            categories: emotionAnalysis.categories,
          },
          'Анализ эмоций в ответе пользователя'
        );

        // Если меньше 3 эмоций - предлагаем дополнить
        if (emotionAnalysis.count < 3) {
          const helpMessage = getEmotionHelpMessage(emotionAnalysis.emotions, 'negative');

          const sendOptions: any = {
            parse_mode: 'HTML',
            reply_parameters: {
              message_id: messageId,
            },
            reply_markup: {
              inline_keyboard: [
                [{ text: 'Таблица эмоций', callback_data: `emotions_table_${channelMessageId}` }],
                [{ text: 'В другой раз', callback_data: `skip_neg_${channelMessageId}` }],
              ],
            },
          };

          try {
            const helpMessageResult = await this.sendWithRetry(
              () => this.bot.telegram.sendMessage(replyToChatId, helpMessage, sendOptions),
              {
                chatId: userId,
                messageType: 'emotions_help',
                maxAttempts: 10,
                intervalMs: 5000,
              }
            );

            // Обновляем состояние в БД сразу после успешной отправки
            const { updateInteractivePostState } = await import('./db');
            updateInteractivePostState(channelMessageId, 'waiting_emotions_clarification', {
              user_schema_message_id: messageId,
            });

            // Обновляем состояние сессии
            session.currentStep = 'waiting_emotions_clarification';
            return true;
          } catch (helpError) {
            schedulerLogger.error({ error: helpError }, 'Ошибка отправки помощи с эмоциями, продолжаем с плюшками');
            // Продолжаем дальше к плюшкам
          }
        }

        // Если эмоций достаточно или произошла ошибка - продолжаем как обычно

        // Отмечаем первое задание как выполненное
        updateTaskStatus(channelMessageId, 1, true);

        // Сохраняем ID ответа пользователя
        const { updateInteractivePostState } = await import('./db');
        updateInteractivePostState(channelMessageId, 'waiting_positive', {
          user_schema_message_id: messageId,
        });

        // Отправляем плюшки с новым текстом
        const supportText = this.getRandomSupportText();
        const plushkiText = `<i>${supportText}</i>\n\n2. <b>Плюшки для лягушки</b>\n\nВспомни и напиши все приятное за день\nТут тоже опиши эмоции, которые ты испытал 😍`;

        const sendOptions: any = {
          parse_mode: 'HTML',
          reply_parameters: {
            message_id: messageId,
          },
          reply_markup: {
            inline_keyboard: [[{ text: 'Таблица эмоций', callback_data: `emotions_table_${channelMessageId}` }]],
          },
        };

        try {
          const task2Message = await this.sendWithRetry(
            () => this.bot.telegram.sendMessage(replyToChatId, plushkiText, sendOptions),
            {
              chatId: userId,
              messageType: 'plushki_task',
              maxAttempts: 10,
              intervalMs: 5000,
              onSuccess: async result => {
                saveMessage(userId, plushkiText, new Date().toISOString(), 0);

                // Сохраняем ID сообщения с плюшками
                updateInteractivePostState(channelMessageId, 'waiting_positive', {
                  bot_task2_message_id: result.message_id,
                });
              },
            }
          );

          // Обновляем состояние - теперь ждем плюшки
          session.currentStep = 'waiting_positive';
          return true;
        } catch (plushkiError) {
          schedulerLogger.error({ error: plushkiError }, 'Ошибка отправки плюшек');
          return false;
        }
      } else if (session.currentStep === 'waiting_emotions_clarification') {
        // Пользователь дополнил ответ про эмоции
        schedulerLogger.info(
          {
            userId,
            channelMessageId,
            messageText: messageText.substring(0, 50),
          },
          'Получен дополненный ответ про эмоции'
        );

        // Сохраняем ответ пользователя в БД
        const { getUserByChatId } = await import('./db');
        const user = getUserByChatId(userId);
        if (user) {
          saveMessage(userId, messageText, new Date().toISOString(), user.id);
        }

        // Отмечаем первое задание как выполненное
        updateTaskStatus(channelMessageId, 1, true);

        // Сохраняем ID ответа пользователя
        const { updateInteractivePostState } = await import('./db');
        updateInteractivePostState(channelMessageId, 'waiting_positive', {
          user_emotions_clarification_message_id: messageId,
        });

        // Отправляем плюшки с рандомным текстом поддержки
        const emotionsSupportTexts = [
          'Теперь ты лучше понимаешь свои эмоции 🙌🏻',
          'Спасибо, что назвал непростые эмоции 🩶',
          'Ты молодец, что смог это описать 🌟',
          'Важно, что ты осознаешь свои чувства, даже когда это совсем непросто ❤️‍🩹',
          'Хорошо, что получилось назвать эмоции ✨',
          'Ты справился с непростой задачей 🎯',
          'С каждым разом ты все лучше разбираешься в своих эмоциях 🎉',
          'Ты учишься понимать себя - это ценно! Я с тобой 🫂',
          'Ты делаешь важные шаги к пониманию себя 👣',
          'Я горжусь тобой! Ты смог назвать эмоции 🤍',
          'Молодец! Теперь эмоции стали понятнее 🔮',
          'Ты проделал важную работу с чувствами 💪🏻',
          'Ты учишься слышать себя - это важно 👂🏻',
          'Уфф.. непростая работа проделана с неприятными эмоциями! Ты молодец ❣️',
          'Ты становишься ближе к себе 🤲🏻',
          'Каждая названная эмоция - это победа 🏆',
          'Ты смог! И это очень ценно 💎',
          'Ты справился! Это был важный шаг 👏🏻',
          'Ты на правильном пути! Продолжай',
          'Ты отлично справляешься! Я в тебя верю 🌱',
          'Спасибо, что доверился и назвал свои чувства 🤍',
          'Я вижу твои переживания. Ты смог их озвучить 🫶🏻',
          'Это было непросто, но ты справился 💚',
          'Твои чувства важны. Хорошо, что ты их назвал 🕊️',
          'Понимаю, как это сложно. Ты молодец 💜',
          'Я рядом. Ты смог назвать то, что тревожит 🤲🏻',
          'Это требовало смелости. Ты справился 🌱',
          'Благодарю за доверие и честность 💫',
          'Ты проделал непростую работу с эмоциями 🌊',
          'Я слышу тебя. Ты смог это выразить 👐🏻',
        ];
        const randomSupportText = emotionsSupportTexts[Math.floor(Math.random() * emotionsSupportTexts.length)];
        const plushkiText = `<i>${randomSupportText}</i>\n\n2. <b>Плюшки для лягушки</b>\n\nВспомни и напиши все приятное за день\nТут тоже опиши эмоции, которые ты испытал 😍`;

        const sendOptions: any = {
          parse_mode: 'HTML',
          reply_parameters: {
            message_id: messageId,
          },
          reply_markup: {
            inline_keyboard: [[{ text: 'Таблица эмоций', callback_data: `emotions_table_${channelMessageId}` }]],
          },
        };

        try {
          const task2Message = await this.sendWithRetry(
            () => this.bot.telegram.sendMessage(replyToChatId, plushkiText, sendOptions),
            {
              chatId: userId,
              messageType: 'plushki_after_clarification',
              maxAttempts: 10,
              intervalMs: 5000,
            }
          );

          // Сохраняем сообщение в БД
          saveMessage(userId, plushkiText, new Date().toISOString(), 0);

          // Обновляем состояние в БД
          updateInteractivePostState(channelMessageId, 'waiting_positive', {
            bot_task2_message_id: task2Message.message_id,
          });

          // Обновляем состояние - теперь ждем плюшки
          session.currentStep = 'waiting_positive';
          return true;
        } catch (plushkiError) {
          schedulerLogger.error({ error: plushkiError }, 'Ошибка отправки плюшек после уточнения');
          return false;
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
        updateInteractivePostState(channelMessageId, 'waiting_positive', {
          user_schema_message_id: messageId,
        });

        // Теперь отмечаем первое задание как выполненное
        updateTaskStatus(channelMessageId, 1, true);

        // Отправляем слова поддержки + плюшки (в упрощенном сценарии схемы нет)
        const supportText = this.getRandomSupportText();
        const responseText = `<i>${supportText}</i>\n\n${this.buildSecondPart(session.messageData, true)}`;

        const sendOptions: any = {
          parse_mode: 'HTML',
          reply_parameters: {
            message_id: messageId,
          },
        };

        try {
          const task2Message = await this.sendWithRetry(
            () => this.bot.telegram.sendMessage(replyToChatId, responseText, sendOptions),
            {
              chatId: userId,
              messageType: 'plushki_after_schema',
              maxAttempts: 10,
              intervalMs: 5000,
              onSuccess: async result => {
                saveMessage(userId, responseText, new Date().toISOString(), 0);

                // Сохраняем ID сообщения с плюшками
                updateInteractivePostState(channelMessageId, 'waiting_positive', {
                  bot_task2_message_id: result.message_id,
                });
              },
            }
          );

          // Обновляем состояние - теперь ждем плюшки
          session.currentStep = 'waiting_positive';
          return true;
        } catch (plushkiError) {
          schedulerLogger.error({ error: plushkiError }, 'Ошибка отправки плюшек, отправляем минимальный fallback');

          // Fallback: отправляем минимальные плюшки без доп. текста
          try {
            const fallbackText = '2. <b>Плюшки для лягушки</b> (ситуация+эмоция)';
            const fallbackMessage = await this.sendWithRetry(
              () =>
                this.bot.telegram.sendMessage(replyToChatId, fallbackText, {
                  parse_mode: 'HTML',
                  reply_parameters: { message_id: messageId },
                }),
              {
                chatId: userId,
                messageType: 'plushki_fallback',
                maxAttempts: 5,
                intervalMs: 3000,
              }
            );

            updateInteractivePostState(channelMessageId, 'waiting_positive', {
              bot_task2_message_id: fallbackMessage.message_id,
            });

            session.currentStep = 'waiting_positive';
            return true;
          } catch (criticalError) {
            schedulerLogger.error(
              { error: criticalError },
              'Критическая ошибка: не удалось отправить даже fallback плюшек'
            );
            return false;
          }
        }
      } else if (session.currentStep === 'waiting_positive') {
        // Ответ на плюшки - отправляем финальную часть
        schedulerLogger.info(
          {
            userId,
            currentStep: session.currentStep,
            channelMessageId,
            messageText: messageText.substring(0, 50),
            replyToChatId,
            messageId,
            activePost: {
              task1: activePost?.task1_completed,
              task2: activePost?.task2_completed,
              task3: activePost?.task3_completed,
              current_state: activePost?.current_state,
            },
          },
          '📝 Получен ответ на плюшки, отправляем задание 3'
        );

        // Импортируем функцию подсчета эмоций
        const { countEmotions, getEmotionHelpMessage } = await import('./utils/emotions');

        // Проверяем количество позитивных эмоций в ответе
        const emotionAnalysis = countEmotions(messageText, 'positive');

        // Проверяем, не запрашивали ли мы уже дополнение негативных эмоций
        const negativeEmotionsWereRequested =
          activePost?.current_state === 'waiting_emotions_clarification' || activePost?.bot_help_message_id;

        schedulerLogger.debug(
          {
            userId,
            channelMessageId,
            positiveEmotionsCount: emotionAnalysis.count,
            positiveEmotions: emotionAnalysis.emotions,
            categories: emotionAnalysis.categories,
            negativeEmotionsWereRequested,
          },
          'Анализ позитивных эмоций в плюшках'
        );

        // Если эмоций мало И мы не просили дополнить негативные эмоции - предлагаем дополнить
        if (emotionAnalysis.count < 3 && !negativeEmotionsWereRequested) {
          const helpMessage = getEmotionHelpMessage(emotionAnalysis.emotions, 'positive');

          const sendOptions: any = {
            parse_mode: 'HTML',
            reply_parameters: {
              message_id: messageId,
            },
            reply_markup: {
              inline_keyboard: [
                [{ text: 'Таблица эмоций', callback_data: `emotions_table_${channelMessageId}` }],
                [{ text: 'Пропустить', callback_data: `skip_positive_emotions_${channelMessageId}` }],
              ],
            },
          };

          try {
            await this.sendWithRetry(() => this.bot.telegram.sendMessage(replyToChatId, helpMessage, sendOptions), {
              chatId: userId,
              messageType: 'positive_emotions_help',
              maxAttempts: 10,
              intervalMs: 5000,
            });

            // Обновляем состояние в БД сразу после успешной отправки
            const { updateInteractivePostState } = await import('./db');
            updateInteractivePostState(channelMessageId, 'waiting_positive_emotions_clarification', {
              user_task2_message_id: messageId,
            });

            // Обновляем состояние сессии
            session.currentStep = 'waiting_positive_emotions_clarification';
            return true;
          } catch (helpError) {
            schedulerLogger.error(
              { error: helpError },
              'Ошибка отправки помощи с позитивными эмоциями, продолжаем с практикой'
            );
            // Продолжаем дальше к практике
          }
        }

        // Если эмоций достаточно, были негативные эмоции или произошла ошибка - продолжаем как обычно

        // Отмечаем второе задание как выполненное
        updateTaskStatus(channelMessageId, 2, true);

        schedulerLogger.debug(
          {
            channelMessageId,
            step: 'after_task2_update',
          },
          '✅ Второе задание отмечено как выполненное'
        );

        let finalMessage = 'У нас остался последний шаг\n\n';
        finalMessage += '3. <b>Дыхательная практика</b>\n\n';
        finalMessage +=
          '<blockquote><b>Дыхание по квадрату:</b>\nВдох на 4 счета, задержка дыхания на 4 счета, выдох на 4 счета и задержка на 4 счета</blockquote>';

        // Добавляем кнопки к заданию 3
        // Используем channelMessageId напрямую, как в глубоком сценарии
        if (!channelMessageId || channelMessageId === 0) {
          schedulerLogger.error(
            {
              channelMessageId,
              sessionData: session,
              activePost: activePost ? { id: activePost.channel_message_id } : null,
            },
            '❌ channelMessageId отсутствует или равен 0!'
          );
          // Пытаемся восстановить из activePost
          if (activePost && activePost.channel_message_id) {
            channelMessageId = activePost.channel_message_id;
          }
        }

        schedulerLogger.debug(
          {
            sessionChannelMessageId: session.channelMessageId,
            channelMessageId: channelMessageId,
            finalChannelId: channelMessageId,
            step: 'prepare_practice_keyboard',
          },
          '🔢 Подготовка ID для кнопок практики'
        );

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

        // Для обычных групп с комментариями не нужен message_thread_id
        // Используем только reply_to_message_id который уже установлен выше

        schedulerLogger.info(
          {
            channelMessageId,
            replyToChatId,
            messageId,
            practiceVideoPath: this.PRACTICE_VIDEO_PATH,
            keyboardData: practiceKeyboard,
            step: 'before_video_send',
            isTestBot: this.isTestBot(),
            chatId: replyToChatId,
          },
          '🎬 Готовимся отправить видео с практикой'
        );

        try {
          // Отправляем видео с дыхательной практикой с повторными попытками
          const practiceVideo = readFileSync(this.PRACTICE_VIDEO_PATH);
          const thumbnailBuffer = readFileSync(this.PRACTICE_VIDEO_THUMBNAIL_PATH);

          const task3Message = await this.sendWithRetry(
            () =>
              this.bot.telegram.sendVideo(replyToChatId, { source: practiceVideo }, {
                caption: finalMessage,
                parse_mode: 'HTML',
                reply_to_message_id: messageId, // Используем reply_to_message_id вместо reply_parameters
                reply_markup: practiceKeyboard,
                thumbnail: { source: thumbnailBuffer },
              } as any),
            {
              chatId: userId,
              messageType: 'practice_video',
              maxAttempts: 20, // Для видео больше попыток
              intervalMs: 10000, // 10 секунд между попытками
              onSuccess: async result => {
                schedulerLogger.info(
                  {
                    channelMessageId,
                    task3MessageId: result.message_id,
                    step: 'video_sent_success',
                  },
                  '✅ Видео с практикой успешно отправлено'
                );

                // Сохраняем сообщение
                saveMessage(userId, finalMessage, new Date().toISOString(), 0);

                // Обновляем состояние в БД
                const { updateInteractivePostState } = await import('./db');
                updateInteractivePostState(channelMessageId, 'waiting_practice', {
                  bot_task3_message_id: result.message_id,
                  user_task2_message_id: messageId,
                });

                // Отмечаем что задание 3 было отправлено (практика)
                updateTaskStatus(channelMessageId, 3, true);

                // Отменяем напоминание о незавершенной работе
                this.clearReminder(userId);
                schedulerLogger.debug(
                  { userId, channelMessageId },
                  'Напоминание о незавершенной работе отменено - пользователь дошел до практики'
                );
              },
            }
          );

          // Обновляем состояние сессии
          session.currentStep = 'waiting_practice';
          return true;
        } catch (practiceError) {
          schedulerLogger.error(
            {
              error: practiceError,
              errorMessage: (practiceError as Error).message,
              errorStack: (practiceError as Error).stack,
              errorDetails: JSON.stringify(practiceError),
              channelMessageId,
              replyToChatId,
              messageId,
              videoPath: this.PRACTICE_VIDEO_PATH,
              isTestBot: this.isTestBot(),
              step: 'video_send_error',
            },
            'Ошибка отправки финального задания, отправляем fallback'
          );

          // Fallback: отправляем минимальное сообщение без кнопок
          try {
            const fallbackFinalText =
              'У нас остался последний шаг\n\n3. <b>Дыхательная практика</b>\n\n<blockquote><b>Дыхание по квадрату:</b>\nВдох на 4 счета, задержка дыхания на 4 счета, выдох на 4 счета и задержка на 4 счета</blockquote>\n\nОтметьте выполнение ответом в этой ветке.';

            // В fallback тоже отправляем видео с повторными попытками
            const fallbackVideo = readFileSync(this.PRACTICE_VIDEO_PATH);
            const fallbackThumbnail = readFileSync(this.PRACTICE_VIDEO_THUMBNAIL_PATH);

            await this.sendWithRetry(
              () =>
                this.bot.telegram.sendVideo(replyToChatId, { source: fallbackVideo }, {
                  caption: fallbackFinalText,
                  parse_mode: 'HTML',
                  reply_to_message_id: messageId, // Используем reply_to_message_id вместо reply_parameters
                  thumbnail: { source: fallbackThumbnail },
                } as any),
              {
                chatId: userId,
                messageType: 'practice_video_fallback',
                maxAttempts: 5,
                intervalMs: 3000,
              }
            );

            // Обновляем состояние сессии все равно
            session.currentStep = 'waiting_practice';
            return true;
          } catch (criticalError) {
            schedulerLogger.error(
              { error: criticalError },
              'Критическая ошибка: не удалось отправить даже fallback финального задания'
            );
            return false;
          }
        }
      } else if (session.currentStep === 'waiting_positive_emotions_clarification') {
        // Пользователь дополнил ответ про позитивные эмоции
        schedulerLogger.info(
          {
            userId,
            channelMessageId,
            messageText: messageText.substring(0, 50),
          },
          'Получен дополненный ответ про позитивные эмоции'
        );

        // Сохраняем ответ пользователя в БД
        const { getUserByChatId } = await import('./db');
        const user = getUserByChatId(userId);
        if (user) {
          saveMessage(userId, messageText, new Date().toISOString(), user.id);
        }

        // Отмечаем второе задание как выполненное
        updateTaskStatus(channelMessageId, 2, true);

        // Сохраняем ID ответа пользователя
        const { updateInteractivePostState } = await import('./db');
        updateInteractivePostState(channelMessageId, 'waiting_practice', {
          user_positive_emotions_clarification_message_id: messageId,
        });

        // Отправляем финальную часть
        let finalMessage = 'У нас остался последний шаг\n\n';
        finalMessage += '3. <b>Дыхательная практика</b>\n\n';
        finalMessage +=
          '<blockquote><b>Дыхание по квадрату:</b>\nВдох на 4 счета, задержка дыхания на 4 счета, выдох на 4 счета и задержка на 4 счета</blockquote>';

        const practiceKeyboard = {
          inline_keyboard: [
            [{ text: '✅ Сделал', callback_data: `pract_done_${channelMessageId}` }],
            [{ text: '⏰ Отложить на 1 час', callback_data: `pract_delay_${channelMessageId}` }],
          ],
        };

        try {
          // Отправляем видео с дыхательной практикой
          const practiceVideo = readFileSync(this.PRACTICE_VIDEO_PATH);
          const thumbnailBuffer = readFileSync(this.PRACTICE_VIDEO_THUMBNAIL_PATH);

          const practiceResult = await this.sendWithRetry(
            () =>
              this.bot.telegram.sendVideo(replyToChatId, { source: practiceVideo }, {
                caption: finalMessage,
                parse_mode: 'HTML',
                reply_to_message_id: messageId,
                reply_markup: practiceKeyboard,
                thumbnail: { source: thumbnailBuffer },
              } as any),
            {
              chatId: userId,
              messageType: 'practice_video_after_positive_clarification',
              maxAttempts: 20,
              intervalMs: 10000,
            }
          );

          // Сохраняем сообщение
          saveMessage(userId, finalMessage, new Date().toISOString(), 0);

          // Обновляем состояние в БД
          updateInteractivePostState(channelMessageId, 'waiting_practice', {
            bot_task3_message_id: practiceResult.message_id,
          });

          // Отмечаем что задание 3 было отправлено
          updateTaskStatus(channelMessageId, 3, true);

          // Отменяем напоминание о незавершенной работе
          this.clearReminder(userId);
          schedulerLogger.debug({ userId, channelMessageId }, 'Напоминание отменено - пользователь дошел до практики');

          return true;
        } catch (practiceError) {
          schedulerLogger.error({ error: practiceError }, 'Ошибка отправки практики после уточнения позитивных эмоций');
          return false;
        }
      } else if (session.currentStep === 'waiting_practice') {
        // Пользователь написал что-то после получения задания с кнопками
        schedulerLogger.info(
          { userId, messageText: messageText.substring(0, 50) },
          'Получен текст вместо нажатия кнопки практики'
        );

        // Проверяем, отправляли ли мы уже напоминание
        const { updateInteractivePostState } = await import('./db');
        const { getInteractivePost } = await import('./db');
        const post = getInteractivePost(channelMessageId);

        if (!post?.practice_reminder_sent) {
          // Отправляем напоминание только один раз
          try {
            await this.sendWithRetry(
              () =>
                this.bot.telegram.sendMessage(replyToChatId, 'Выполни практику и нажми "Сделал" после ее завершения', {
                  reply_parameters: {
                    message_id: messageId,
                  },
                }),
              {
                chatId: userId,
                messageType: 'practice_reminder',
                maxAttempts: 5,
                intervalMs: 3000,
              }
            );

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

        await this.sendWithRetry(() => this.bot.telegram.sendMessage(chatId, responseText, sendOptions), {
          chatId: userId,
          messageType: 'pending_schema_response',
          maxAttempts: 10,
          intervalMs: 5000,
        });

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
        finalMessage +=
          '<blockquote><b>Дыхание по квадрату:</b>\nВдох на 4 счета, задержка дыхания на 4 счета, выдох на 4 счета и задержка на 4 счета</blockquote>';

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
        const practiceVideoBuffer = readFileSync(this.PRACTICE_VIDEO_PATH);
        const thumbnailBuffer = readFileSync(this.PRACTICE_VIDEO_THUMBNAIL_PATH);

        // Для видео используем reply_to_message_id вместо reply_parameters
        const videoOptions: any = {
          caption: finalMessage,
          parse_mode: sendOptions.parse_mode,
          reply_markup: sendOptions.reply_markup,
          thumbnail: { source: thumbnailBuffer },
        };
        if (sendOptions.reply_parameters?.message_id) {
          videoOptions.reply_to_message_id = sendOptions.reply_parameters.message_id;
        }
        await this.sendWithRetry(
          () => this.bot.telegram.sendVideo(chatId, { source: practiceVideoBuffer }, videoOptions),
          {
            chatId: userId,
            messageType: 'pending_practice_video',
            maxAttempts: 20,
            intervalMs: 10000,
          }
        );

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
