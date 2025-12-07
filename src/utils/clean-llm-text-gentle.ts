/**
 * Мягкая очистка LLM текста специально для gender adaptation
 *
 * Убирает ТОЛЬКО технический мусор от LLM, сохраняя ВСЁ форматирование:
 * - HTML теги (<b>, <i>, <code> и т.д.)
 * - Emoji
 * - Переносы строк (\n, \n\n)
 * - Пробелы между словами
 */

export function cleanLLMTextGentle(text: string): string {
  let cleaned = text.trim();

  // 1. Удаляем теги <think>...</think> (DeepSeek-R1)
  const lastThinkClose = cleaned.lastIndexOf('</think>');
  if (lastThinkClose !== -1 && cleaned.trim().startsWith('<think>')) {
    cleaned = cleaned.substring(lastThinkClose + 8).trim();
  }
  // Дополнительно удаляем любые оставшиеся теги think
  cleaned = cleaned.replace(/<think>.*?<\/think>/gis, '');

  // 2. Обработка формата "Размышления: ... Готовый текст: ..."
  if (cleaned.includes('Готовый текст:')) {
    const readyTextMatch = cleaned.match(/Готовый текст:\s*(.+?)$/is);
    if (readyTextMatch) {
      cleaned = readyTextMatch[1].trim();
    }
  }

  // 3. Также проверяем вариации
  if (cleaned.includes('Ответ:') && cleaned.includes('Размышлени')) {
    const answerMatch = cleaned.match(/Ответ:\s*(.+?)$/is);
    if (answerMatch) {
      cleaned = answerMatch[1].trim();
    }
  }

  // 4. Обработка формата "Мысли: ..."
  if (cleaned.startsWith('Мысли:')) {
    const thoughtsEnd = cleaned.search(/\n\n/);
    if (thoughtsEnd > 0) {
      cleaned = cleaned.substring(thoughtsEnd).trim();
    }
  }

  // 5. Удаляем технические фразы LLM (ТОЛЬКО в начале строки)
  cleaned = cleaned.replace(/^(Ответ:|Answer:|Результат:|Result:|Output:|Вывод:|Response:)\s*/gmi, '');
  cleaned = cleaned.replace(/^(Вот|Here is|Here's|Это)\s+(ответ|текст|результат|answer|text|result):?\s*/gmi, '');
  cleaned = cleaned.replace(/^(Адаптированный текст:)\s*/gmi, '');

  // 6. Удаляем кавычки ТОЛЬКО в начале и конце всего текста
  cleaned = cleaned.replace(/^["'«»]|["'«»]$/g, '').trim();

  // 7. Ограничиваем максимум 2 переноса подряд (но НЕ убираем одинарные/двойные!)
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  // ❌ НЕ убираем пробелы внутри текста! Это важно для сохранения структуры
  // ❌ НЕ убираем HTML теги - они используются в Telegram
  // ❌ НЕ убираем emoji
  // ❌ НЕ убираем переносы строк

  return cleaned.trim();
}

/**
 * Извлекает все emoji из текста
 */
function extractEmoji(text: string): string[] {
  // Regex для Unicode emoji (все диапазоны)
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
  return text.match(emojiRegex) || [];
}

/**
 * Умное восстановление форматирования из оригинального текста
 *
 * Копирует потерянные элементы (emoji, переносы строк) из оригинала,
 * сохраняя адаптированный текст от LLM
 */
export function restoreFormatting(adapted: string, original: string): string {
  let result = adapted;

  // 1. Восстанавливаем потерянные emoji
  const originalEmoji = extractEmoji(original);
  const adaptedEmoji = extractEmoji(adapted);

  if (originalEmoji.length > adaptedEmoji.length) {
    // Находим какие emoji потерялись
    const missingEmoji = originalEmoji.filter((emoji, index) => {
      return !adaptedEmoji[index] || adaptedEmoji[index] !== emoji;
    });

    // Добавляем потерянные emoji в конец (простая эвристика)
    if (missingEmoji.length > 0) {
      result = result.trimEnd() + ' ' + missingEmoji.join(' ');
    }
  }

  // 2. Восстанавливаем двойные переносы строк, если они были в оригинале
  const originalDoubleLineBreaks = (original.match(/\n\n/g) || []).length;
  const adaptedDoubleLineBreaks = (adapted.match(/\n\n/g) || []).length;

  if (originalDoubleLineBreaks > adaptedDoubleLineBreaks) {
    // Восстанавливаем потерянные переносы строк
    // Ищем место где был перенос - между предложениями (после . ! ? перед заглавной буквой)
    let replacements = 0;
    result = result.replace(/([.!?])\s+([А-ЯЁA-Z])/g, (match, punct, letter) => {
      if (replacements < originalDoubleLineBreaks) {
        replacements++;
        return `${punct}\n\n${letter}`;
      }
      return match;
    });
  }

  return result;
}

/**
 * Проверяет что базовое форматирование сохранилось
 */
export function hasBasicFormatting(adapted: string, original: string): boolean {
  // Проверяем HTML теги
  const originalHTMLTags = (original.match(/<[^>]+>/g) || []).length;
  const adaptedHTMLTags = (adapted.match(/<[^>]+>/g) || []).length;

  // Проверяем emoji
  const originalEmoji = extractEmoji(original);
  const adaptedEmoji = extractEmoji(adapted);

  // Проверяем двойные переносы строк (важно для структуры текста)
  const originalDoubleLineBreaks = (original.match(/\n\n/g) || []).length;
  const adaptedDoubleLineBreaks = (adapted.match(/\n\n/g) || []).length;

  // Считаем что форматирование сохранилось, если:
  // 1. Количество HTML тегов совпадает
  // 2. Emoji потеряно не более 1 (допускаем небольшую погрешность)
  // 3. Двойные переносы строк сохранены (БЕЗ погрешности - потеря даже одного \n\n критична!)
  const htmlMatch = originalHTMLTags === adaptedHTMLTags;
  const emojiMatch = Math.abs(originalEmoji.length - adaptedEmoji.length) <= 1;
  const lineBreaksMatch = originalDoubleLineBreaks === adaptedDoubleLineBreaks;

  return htmlMatch && emojiMatch && lineBreaksMatch;
}
