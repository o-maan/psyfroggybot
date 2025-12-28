import { readFile } from 'fs/promises';
import { schedulerLogger } from './logger';
import { getMorningMessageIndexes, saveMorningMessageIndexes, getUserByChatId } from './db';

// Константы
const WEEKDAY_MESSAGES_FILE = 'assets/morning-messages.md';

// Вводное сообщение (показывается только один раз)
const MORNING_INTRO_TEXT = `ЛЯГУХА С ТОБОЙ ЦЕЛЫЙ ДЕНЬ 🤗

Каждое утро я буду присылать тебе пост с короткой мыслью 💭 или упражнением, которые будут помогать тебе глубже понимать себя 🧘🏻✨ и делать шаги 👣 к улучшению качества твоей жизни 🔥

<b>Ты можешь писать мне ✍🏻 в течение дня обо всем, что тебя волнует</b> – такой дневник, где ты фиксируешь, что с тобой происходит 👁‍🗨 и твою реакцию в моменте – она многое говорит о тебе

Со временем ты начнешь замечать закономерности ⚙️ и паттерны своего поведения

P.S. Можно попробовать прямо сейчас 🙃`;

// Пороги для проверки спец.текстов
const SPECIAL_TEXT_THRESHOLDS = {
  WED: 14, // После 14 текста проверяем СР
  SUN: 25, // После 25 текста проверяем ВС
  THU: 35, // После 35 текста проверяем ЧТ
  MON: 52, // После 52 текста проверяем ПН
};

// Приветствия (циклическая ротация)
const GREETINGS = [
  'Доброе утро! ☀️',
  'Хорошего дня! ☀️',
  'Доброе! ☀️',
  'Привет! ☀️',
  'Доброе утро! ☀️',
  'Прекрасного утра! ☀️',
  'Доброе утро! ☀️',
  'С добрым утром! ☀️',
  'Солнечного тебе дня! ☀️',
  'Доброе утро! ☀️',
];

// Эмоджи для фразы про события
const POSITIVE_EMOJIS = ['🤩', '😍', '🥹', '😊'];
const NEGATIVE_EMOJIS = ['🤯', '😱', '😭', '🤬'];

// Интерфейсы
interface ParsedMessages {
  weekday: string[];
  weekend: string[];
  special: {
    mon: string;
    wed: string;
    thu: string;
    sun: string;
  };
}

// Парсинг файла с сообщениями
export async function parseMorningMessages(): Promise<ParsedMessages> {
  try {
    const content = await readFile(WEEKDAY_MESSAGES_FILE, 'utf-8');
    const lines = content.split('\n');

    const result: ParsedMessages = {
      weekday: [],
      weekend: [],
      special: {
        mon: '',
        wed: '',
        thu: '',
        sun: '',
      },
    };

    let currentSection: 'weekday' | 'weekend' | 'special' | null = null;
    let currentSpecialDay: 'mon' | 'wed' | 'thu' | 'sun' | null = null;
    let currentMessage = '';

    for (const line of lines) {
      const trimmed = line.trim();

      // Определяем секции
      if (trimmed === '## БУДНИЕ ДНИ') {
        // Сохраняем предыдущее сообщение перед сменой секции
        if (currentMessage && currentSection) {
          if (currentSection === 'weekday') {
            result.weekday.push(currentMessage.trim());
          } else if (currentSection === 'weekend') {
            result.weekend.push(currentMessage.trim());
          }
        }
        currentSection = 'weekday';
        currentMessage = '';
        continue;
      }
      if (trimmed === '## ВЫХОДНЫЕ') {
        // Сохраняем предыдущее сообщение перед сменой секции
        if (currentMessage && currentSection) {
          if (currentSection === 'weekday') {
            result.weekday.push(currentMessage.trim());
          } else if (currentSection === 'weekend') {
            result.weekend.push(currentMessage.trim());
          }
        }
        currentSection = 'weekend';
        currentMessage = '';
        continue;
      }
      if (trimmed === '## С ПРИВЯЗКОЙ К ДНЮ НЕДЕЛИ') {
        // Сохраняем предыдущее сообщение перед сменой секции
        if (currentMessage && currentSection) {
          if (currentSection === 'weekday') {
            result.weekday.push(currentMessage.trim());
          } else if (currentSection === 'weekend') {
            result.weekend.push(currentMessage.trim());
          }
        }
        currentSection = 'special';
        currentMessage = '';
        continue;
      }

      // Определяем спец.дни
      if (currentSection === 'special') {
        if (trimmed === '### ПН:') {
          currentSpecialDay = 'mon';
          continue;
        }
        if (trimmed === '### СР:') {
          currentSpecialDay = 'wed';
          continue;
        }
        if (trimmed === '### ЧТ:') {
          currentSpecialDay = 'thu';
          continue;
        }
        if (trimmed === '### ВС:') {
          currentSpecialDay = 'sun';
          continue;
        }
      }

      // Пропускаем разделители и пустые строки
      if (trimmed === '---' || trimmed === '' || trimmed.startsWith('#')) {
        continue;
      }

      // Пропускаем нумерацию
      if (/^\d+\.\s/.test(trimmed)) {
        // Сохраняем предыдущее сообщение
        if (currentMessage && currentSection) {
          if (currentSection === 'weekday') {
            result.weekday.push(currentMessage.trim());
          } else if (currentSection === 'weekend') {
            result.weekend.push(currentMessage.trim());
          }
        }
        // Начинаем новое сообщение (убираем номер)
        currentMessage = trimmed.replace(/^\d+\.\s/, '');
        continue;
      }

      // Добавляем строку к текущему сообщению
      if (currentSection === 'special' && currentSpecialDay) {
        result.special[currentSpecialDay] += (result.special[currentSpecialDay] ? '\n' : '') + trimmed;
      } else if (currentSection && (currentSection === 'weekday' || currentSection === 'weekend')) {
        currentMessage += (currentMessage ? '\n' : '') + trimmed;
      }
    }

    // Сохраняем последнее сообщение
    if (currentMessage && currentSection) {
      if (currentSection === 'weekday') {
        result.weekday.push(currentMessage.trim());
      } else if (currentSection === 'weekend') {
        result.weekend.push(currentMessage.trim());
      }
    }

    schedulerLogger.debug(
      {
        weekdayCount: result.weekday.length,
        weekendCount: result.weekend.length,
        specialDays: Object.keys(result.special).filter(k => result.special[k as keyof typeof result.special]),
      },
      'Сообщения успешно распарсены'
    );

    return result;
  } catch (error) {
    schedulerLogger.error({ error }, 'Ошибка парсинга файла утренних сообщений');
    throw error;
  }
}

// Получить следующее приветствие
export function getNextGreeting(userId: number): string {
  const indexes = getMorningMessageIndexes(userId);
  const greetingIndex = indexes?.greeting_index ?? 0;

  let greeting = GREETINGS[greetingIndex];
  const nextIndex = (greetingIndex + 1) % GREETINGS.length;

  // Добавляем имя к приветствию в 50% случаев
  // НЕ добавляем к "Солнечного тебе дня! ☀️" (индекс 8)
  if (greetingIndex !== 8 && Math.random() < 0.5) {
    const user = getUserByChatId(userId);
    const userName = user?.name;

    if (userName) {
      // Заменяем "!" на ", {имя}!" перед эмоджи
      // Например: "Доброе утро! ☀️" → "Доброе утро, Алекс! ☀️"
      greeting = greeting.replace(/!\s*(?=☀️)/, `, ${userName}! `);
    }
  }

  // Сохраняем только индекс приветствия, остальное не трогаем
  if (indexes) {
    saveMorningMessageIndexes(
      userId,
      indexes.weekday_index,
      indexes.weekend_index,
      nextIndex,
      !!indexes.used_mon,
      !!indexes.used_wed,
      !!indexes.used_thu,
      !!indexes.used_sun,
      indexes.evening_index ?? 0,
      !!indexes.morning_intro_shown,
      !!indexes.evening_intro_shown,
      indexes.joy_main_index ?? 0
    );
  } else {
    saveMorningMessageIndexes(userId, 0, 0, nextIndex, false, false, false, false, 0, false, false, 0);
  }

  return greeting;
}

// Получить случайные эмоджи для фразы про события
export function getRandomEmojis(): { positive: string; negative: string } {
  const positive = POSITIVE_EMOJIS[Math.floor(Math.random() * POSITIVE_EMOJIS.length)];
  const negative = NEGATIVE_EMOJIS[Math.floor(Math.random() * NEGATIVE_EMOJIS.length)];
  return { positive, negative };
}

// Получить текст утреннего сообщения
export async function getMorningMessageText(userId: number, dayOfWeek: number): Promise<string> {
  const messages = await parseMorningMessages();
  const indexes = getMorningMessageIndexes(userId) ?? {
    weekday_index: 0,
    weekend_index: 0,
    greeting_index: 0,
    evening_index: 0,
    joy_main_index: 0,
    used_mon: 0,
    used_wed: 0,
    used_thu: 0,
    used_sun: 0,
    morning_intro_shown: 0,
    evening_intro_shown: 0,
    updated_at: new Date().toISOString(),
  };

  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6; // 0 = воскресенье, 6 = суббота
  let selectedText = '';
  let newWeekdayIndex = indexes.weekday_index;
  let newWeekendIndex = indexes.weekend_index;
  let newUsedMon = !!indexes.used_mon;
  let newUsedWed = !!indexes.used_wed;
  let newUsedThu = !!indexes.used_thu;
  let newUsedSun = !!indexes.used_sun;

  if (isWeekend) {
    // ВЫХОДНЫЕ: проверяем спец.текст для воскресенья
    if (
      dayOfWeek === 0 && // Воскресенье
      newWeekendIndex >= 20 && // После 20 текстов выходных (примерно 10 недель)
      !newUsedSun
    ) {
      // Используем спец.текст для воскресенья
      selectedText = messages.special.sun;
      newUsedSun = true;
      schedulerLogger.info({ userId, dayOfWeek, weekendIndex: newWeekendIndex }, '📅 Используем спец.текст ВС для выходных');
    } else {
      // Обычный текст из выходных
      selectedText = messages.weekend[newWeekendIndex] || messages.weekend[0];
      newWeekendIndex = (newWeekendIndex + 1) % messages.weekend.length;

      // Если индекс вернулся к 0 - сбрасываем флаг ВС
      if (newWeekendIndex === 0) {
        newUsedSun = false;
        schedulerLogger.info({ userId }, '🔄 Цикл выходных текстов завершён, сбрасываем флаг ВС');
      }
    }
  } else {
    // БУДНИЕ: проверяем спец.тексты
    let useSpecialText = false;
    let specialTextKey: 'mon' | 'wed' | 'thu' | 'sun' | null = null;

    // Проверяем СР (после 14)
    if (
      newWeekdayIndex >= SPECIAL_TEXT_THRESHOLDS.WED &&
      dayOfWeek === 3 &&
      !newUsedWed
    ) {
      useSpecialText = true;
      specialTextKey = 'wed';
      newUsedWed = true;
    }
    // Проверяем ЧТ (после 35)
    else if (
      newWeekdayIndex >= SPECIAL_TEXT_THRESHOLDS.THU &&
      dayOfWeek === 4 &&
      !newUsedThu
    ) {
      useSpecialText = true;
      specialTextKey = 'thu';
      newUsedThu = true;
    }
    // Проверяем ПН (после 52)
    else if (
      newWeekdayIndex >= SPECIAL_TEXT_THRESHOLDS.MON &&
      dayOfWeek === 1 &&
      !newUsedMon
    ) {
      useSpecialText = true;
      specialTextKey = 'mon';
      newUsedMon = true;
    }

    if (useSpecialText && specialTextKey) {
      // Используем спец.текст
      selectedText = messages.special[specialTextKey];
      schedulerLogger.info({ userId, specialTextKey, dayOfWeek }, '📅 Используем спец.текст для дня недели');
    } else {
      // Обычный текст из будних
      selectedText = messages.weekday[newWeekdayIndex] || messages.weekday[0];
      newWeekdayIndex = (newWeekdayIndex + 1) % messages.weekday.length;

      // Если индекс вернулся к 0 - сбрасываем флаги использованных спец.текстов
      if (newWeekdayIndex === 0) {
        newUsedMon = false;
        newUsedWed = false;
        newUsedThu = false;
        newUsedSun = false;
        schedulerLogger.info({ userId }, '🔄 Цикл будних текстов завершён, сбрасываем флаги спец.текстов');
      }
    }
  }

  // Сохраняем обновлённые индексы
  saveMorningMessageIndexes(
    userId,
    newWeekdayIndex,
    newWeekendIndex,
    indexes.greeting_index,
    newUsedMon,
    newUsedWed,
    newUsedThu,
    newUsedSun,
    indexes.evening_index ?? 0,
    !!indexes.morning_intro_shown,
    !!indexes.evening_intro_shown,
    indexes.joy_main_index ?? 0
  );

  return selectedText;
}

// Проверить нужно ли показать вводное сообщение (только первый раз)
export function shouldShowMorningIntro(userId: number): boolean {
  // 1️⃣ Проверяем флаг в morning_message_indexes
  const indexes = getMorningMessageIndexes(userId);
  if (indexes?.morning_intro_shown) {
    return false; // Флаг установлен - вводный уже показывали
  }

  // 2️⃣ ДОПОЛНИТЕЛЬНАЯ ПРОВЕРКА: есть ли записи в user_daily_posts?
  // Защита от случаев когда флаг сбросился (например после /reset)
  const { db } = require('./db');
  const existingPosts = db.query(`
    SELECT COUNT(*) as count FROM user_daily_posts
    WHERE user_id = ? AND post_type = 'morning'
  `).get(userId) as { count: number } | undefined;

  if (existingPosts && existingPosts.count > 0) {
    // Есть старые утренние посты, но флаг не установлен → была ошибка/сброс
    // Устанавливаем флаг и НЕ показываем вводный
    const { schedulerLogger } = require('./logger');
    schedulerLogger.warn({ userId, postsCount: existingPosts.count }, '⚠️ Найдены старые утренние посты, но флаг intro не установлен - исправляем');

    // Устанавливаем флаг через setMorningIntroShown
    const { setMorningIntroShown } = require('./db');
    setMorningIntroShown(userId, true);

    return false; // НЕ показываем вводный
  }

  // Нет постов и флаг не установлен → первый раз
  return true;
}

// Получить вводное сообщение и установить флаг
export function getMorningIntro(userId: number): string {
  const indexes = getMorningMessageIndexes(userId) ?? {
    weekday_index: 0,
    weekend_index: 0,
    greeting_index: 0,
    evening_index: 0,
    joy_main_index: 0,
    used_mon: 0,
    used_wed: 0,
    used_thu: 0,
    used_sun: 0,
    morning_intro_shown: 0,
    evening_intro_shown: 0,
    updated_at: new Date().toISOString(),
  };

  // Устанавливаем флаг, что вводное сообщение показано
  // ВАЖНО: индексы НЕ меняем
  saveMorningMessageIndexes(
    userId,
    indexes.weekday_index,
    indexes.weekend_index,
    indexes.greeting_index,
    !!indexes.used_mon,
    !!indexes.used_wed,
    !!indexes.used_thu,
    !!indexes.used_sun,
    indexes.evening_index,
    true, // morning_intro_shown = true
    !!indexes.evening_intro_shown,
    indexes.joy_main_index ?? 0
  );

  schedulerLogger.info({ userId }, '📢 Показываем вводное сообщение для утренней лягушки');
  return MORNING_INTRO_TEXT;
}

// Собрать полный текст поста
export async function buildMorningPost(userId: number, dayOfWeek: number, isFriday: boolean): Promise<string> {
  // Пятница - отдельная логика (пока возвращаем null, будет использоваться LLM)
  if (isFriday) {
    return '';
  }

  const greeting = getNextGreeting(userId);
  const messageText = await getMorningMessageText(userId, dayOfWeek);
  const emojis = getRandomEmojis();

  // Текст БЕЗ "Переходи в комментарии" - фраза добавляется в scheduler.ts только при отправке в канал
  const post = `${greeting}

${messageText}

<b>А я буду ждать твои события за день – делись всем, что волнует тебя</b> ${emojis.positive}${emojis.negative}`;

  return post;
}
