import { readFileSync } from 'fs';
import { schedulerLogger } from './logger';
import { getMorningMessageIndexes, saveMorningMessageIndexes } from './db';

// Константы
const EVENING_MESSAGES_FILE = 'assets/evening-messages.md';

// Вводное сообщение (показывается только один раз)
const EVENING_INTRO_TEXT = `ВЕЧЕРНЯЯ ЛЯГУХА 🐸

Здесь у нас будут основные задания – им важно уделять внимание каждый день

Открою тебе два главных секрета.. ✨
<b>Когда ты понимаешь, что с тобой происходит – ты можешь на это влиять!</b> 🗝️❤️‍🔥
Твое тело и чувства – лучшие ориентиры 🧭 в этом, поэтому я буду помогать тебе замечать свои эмоции 🥺🤩😩

А с помощью различных техник мы будем учиться корректировать искаженные мысли 😵‍💫 и деструктивное поведение 🙈

И еще.. <b>твоя жизнь не меняется от заданий и техник – она меняется от смены привычного образа мыслить и действовать</b> 🗝️🧠
А для этого нужна регулярность и терпение 😁

Можем начинать)`;

// Парсинг файла с вечерними сообщениями
export function parseEveningMessages(): string[] {
  try {
    const content = readFileSync(EVENING_MESSAGES_FILE, 'utf-8');
    const lines = content.split('\n');

    const messages: string[] = [];
    let currentMessage = '';

    for (const line of lines) {
      const trimmed = line.trim();

      // Пропускаем заголовок
      if (trimmed.startsWith('# ТЕКСТЫ ДЛЯ ВЕЧЕРНЕЙ ЛЯГУШКИ') || trimmed === '') {
        continue;
      }

      // Начало нового сообщения (нумерация)
      if (/^\d+\.\s/.test(trimmed)) {
        // Сохраняем предыдущее сообщение
        if (currentMessage) {
          messages.push(currentMessage.trim());
        }
        // Начинаем новое сообщение (убираем номер)
        currentMessage = trimmed.replace(/^\d+\.\s/, '');
        continue;
      }

      // Добавляем строку к текущему сообщению
      if (currentMessage) {
        currentMessage += '\n' + trimmed;
      }
    }

    // Сохраняем последнее сообщение
    if (currentMessage) {
      messages.push(currentMessage.trim());
    }

    schedulerLogger.debug(
      { messagesCount: messages.length },
      'Вечерние сообщения успешно распарсены'
    );

    return messages;
  } catch (error) {
    schedulerLogger.error({ error }, 'Ошибка парсинга файла вечерних сообщений');
    throw error;
  }
}

// Получить текст вечернего сообщения с циклической ротацией
export function getEveningMessageText(userId: number): string {
  const messages = parseEveningMessages();
  const indexes = getMorningMessageIndexes(userId) ?? {
    weekday_index: 0,
    weekend_index: 0,
    greeting_index: 0,
    evening_index: 0,
    used_mon: 0,
    used_wed: 0,
    used_thu: 0,
    used_sun: 0,
    morning_intro_shown: 0,
    evening_intro_shown: 0,
    updated_at: new Date().toISOString(),
  };

  const currentIndex = indexes.evening_index ?? 0;

  // Получаем текст по текущему индексу (с fallback на первый)
  const selectedText = messages[currentIndex] || messages[0];

  // Вычисляем следующий индекс с циклической ротацией (бесконечный цикл)
  const nextIndex = (currentIndex + 1) % messages.length;

  schedulerLogger.info(
    { userId, currentIndex, nextIndex, totalMessages: messages.length },
    '📝 Вечернее сообщение выбрано из списка'
  );

  // Сохраняем обновлённый индекс
  saveMorningMessageIndexes(
    userId,
    indexes.weekday_index,
    indexes.weekend_index,
    indexes.greeting_index,
    !!indexes.used_mon,
    !!indexes.used_wed,
    !!indexes.used_thu,
    !!indexes.used_sun,
    nextIndex,
    !!indexes.morning_intro_shown,
    !!indexes.evening_intro_shown
  );

  // Возвращаем текст БЕЗ фразы про комментарии
  // (она добавится в sendInteractiveDailyMessage)
  return selectedText;
}

// Проверить нужно ли показать вводное сообщение (только первый раз)
export function shouldShowEveningIntro(userId: number): boolean {
  const indexes = getMorningMessageIndexes(userId);
  // Если флаг НЕ установлен - нужно показать вводное
  return !indexes || !indexes.evening_intro_shown;
}

// Получить вводное сообщение и установить флаг
export function getEveningIntro(userId: number): string {
  const indexes = getMorningMessageIndexes(userId) ?? {
    weekday_index: 0,
    weekend_index: 0,
    greeting_index: 0,
    evening_index: 0,
    used_mon: 0,
    used_wed: 0,
    used_thu: 0,
    used_sun: 0,
    morning_intro_shown: 0,
    evening_intro_shown: 0,
    updated_at: new Date().toISOString(),
  };

  // Устанавливаем флаг, что вводное сообщение показано
  // ВАЖНО: индекс НЕ меняем, остается 0
  saveMorningMessageIndexes(
    userId,
    indexes.weekday_index,
    indexes.weekend_index,
    indexes.greeting_index,
    !!indexes.used_mon,
    !!indexes.used_wed,
    !!indexes.used_thu,
    !!indexes.used_sun,
    indexes.evening_index, // НЕ увеличиваем!
    !!indexes.morning_intro_shown,
    true // evening_intro_shown = true
  );

  schedulerLogger.info({ userId }, '📢 Показываем вводное сообщение для вечерней лягушки');
  return EVENING_INTRO_TEXT;
}
