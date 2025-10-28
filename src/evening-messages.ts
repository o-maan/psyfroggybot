import { readFileSync } from 'fs';
import { schedulerLogger } from './logger';
import { getMorningMessageIndexes, saveMorningMessageIndexes } from './db';

// Константы
const EVENING_MESSAGES_FILE = 'assets/evening-messages.md';

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
    nextIndex
  );

  // Возвращаем текст БЕЗ фразы про комментарии
  // (она добавится в sendInteractiveDailyMessage)
  return selectedText;
}
