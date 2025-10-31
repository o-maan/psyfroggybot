import { readFileSync } from 'fs';
import { schedulerLogger } from './logger';
import { getMorningMessageIndexes, saveMorningMessageIndexes } from './db';

// Константы
const JOY_MAIN_MESSAGES_FILE = 'assets/joy-main-posts.md';

/**
 * Парсинг файла с основными постами Joy
 * Формат файла: каждый пост начинается с "## Пост N"
 */
export function parseJoyMainMessages(): string[] {
  try {
    const content = readFileSync(JOY_MAIN_MESSAGES_FILE, 'utf-8');
    const lines = content.split('\n');

    const messages: string[] = [];
    let currentMessage = '';
    let isReadingPost = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // Пропускаем заголовок файла
      if (trimmed.startsWith('# Тексты постов для основного сценария Joy')) {
        continue;
      }

      // Начало нового поста
      if (trimmed.startsWith('## Пост')) {
        // Сохраняем предыдущий пост
        if (currentMessage) {
          messages.push(currentMessage.trim());
        }
        // Начинаем новый пост
        currentMessage = '';
        isReadingPost = true;
        continue;
      }

      // Пропускаем пустые строки в начале поста
      if (isReadingPost && trimmed === '') {
        continue;
      }

      // Добавляем строку к текущему посту
      if (isReadingPost && trimmed !== '') {
        if (currentMessage) {
          currentMessage += '\n' + line; // Сохраняем оригинальные переносы
        } else {
          currentMessage = line;
        }
      }
    }

    // Сохраняем последний пост
    if (currentMessage) {
      messages.push(currentMessage.trim());
    }

    schedulerLogger.debug(
      { messagesCount: messages.length },
      'Основные посты Joy успешно распарсены'
    );

    return messages;
  } catch (error) {
    schedulerLogger.error({ error }, 'Ошибка парсинга файла основных постов Joy');
    throw error;
  }
}

/**
 * Получить текст поста Joy с циклической ротацией
 * @param userId - ID пользователя
 * @returns Текст поста (БЕЗ фразы про комментарии - она добавится отдельно)
 */
export function getJoyMainMessageText(userId: number): string {
  const messages = parseJoyMainMessages();
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

  const currentIndex = indexes.joy_main_index ?? 0;

  // Получаем текст по текущему индексу (с fallback на первый)
  const selectedText = messages[currentIndex] || messages[0];

  // Вычисляем следующий индекс с циклической ротацией (бесконечный цикл)
  const nextIndex = (currentIndex + 1) % messages.length;

  schedulerLogger.info(
    { userId, currentIndex, nextIndex, totalMessages: messages.length },
    '📝 Пост Joy выбран из списка'
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
    indexes.evening_index,
    !!indexes.morning_intro_shown,
    !!indexes.evening_intro_shown,
    nextIndex // новый параметр
  );

  // Возвращаем текст БЕЗ фразы про комментарии
  // (она добавится в sendJoyRegularMessage)
  return selectedText;
}
