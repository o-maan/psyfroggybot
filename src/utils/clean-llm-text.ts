// Универсальная функция для очистки текста от LLM
export function cleanLLMText(text: string): string {
  let cleaned = text.trim();
  
  // Удаляем теги think если есть (включая вариации)
  const lastThinkClose = cleaned.lastIndexOf('</think>');
  if (lastThinkClose !== -1 && cleaned.trim().startsWith('<think>')) {
    cleaned = cleaned.substring(lastThinkClose + 8).trim();
  }
  // Дополнительно удаляем любые оставшиеся теги think
  cleaned = cleaned.replace(/<think>.*?<\/think>/gis, '');
  
  // Обработка формата "Размышления: ... Готовый текст: ..."
  if (cleaned.includes('Готовый текст:')) {
    const readyTextMatch = cleaned.match(/Готовый текст:\s*(.+?)$/is);
    if (readyTextMatch) {
      cleaned = readyTextMatch[1].trim();
    }
  }
  
  // Также проверяем вариации
  if (cleaned.includes('Ответ:') && cleaned.includes('Размышлени')) {
    const answerMatch = cleaned.match(/Ответ:\s*(.+?)$/is);
    if (answerMatch) {
      cleaned = answerMatch[1].trim();
    }
  }
  
  // Удаляем блоки кода ```...```
  cleaned = cleaned.replace(/```[\s\S]*?```/g, '');
  
  // Ищем текст после "**Исправленный вариант**" и "> "
  const correctedMatch = cleaned.match(/\*\*Исправленный вариант\*\*\s*:?\s*>?\s*(.+?)(?:\*\*|$)/s);
  if (correctedMatch) {
    cleaned = correctedMatch[1].trim();
  } else {
    // Альтернативный поиск - ищем текст после ">"
    const quoteMatch = cleaned.match(/^>\s*(.+?)(?:\n\n|\*\*|$)/s);
    if (quoteMatch) {
      cleaned = quoteMatch[1].trim();
    }
  }
  
  // Удаляем любые технические пометки в скобках
  cleaned = cleaned.replace(/\s*\([^)]*символ[^)]*\)/gi, '');
  cleaned = cleaned.replace(/\s*\(\d+[^)]*\)/g, '');
  cleaned = cleaned.replace(/\s*\([^)]*\)/g, '');
  
  // Удаляем кавычки в начале и конце
  cleaned = cleaned.replace(/^["'«»]|["'«»]$/g, '').trim();
  
  // Убираем markdown списки в начале строк
  cleaned = cleaned.replace(/^[\-\*\+]\s+/gm, '');
  cleaned = cleaned.replace(/^\d+\.\s+/gm, '');
  
  // Убираем markdown форматирование более корректно
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1'); // жирный текст
  cleaned = cleaned.replace(/\*([^*]+)\*/g, '$1'); // курсив
  cleaned = cleaned.replace(/__([^_]+)__/g, '$1'); // жирный текст альтернатива
  cleaned = cleaned.replace(/_([^_]+)_/g, '$1'); // курсив альтернатива
  cleaned = cleaned.replace(/~~([^~]+)~~/g, '$1'); // зачеркнутый текст
  cleaned = cleaned.replace(/`([^`]+)`/g, '$1'); // инлайн код
  
  // Убираем символы форматирования markdown (*, _, `, ~) которые остались
  cleaned = cleaned.replace(/[\*_`~]/g, '');
  
  // Убираем markdown заголовки (##, ###, etc)
  cleaned = cleaned.replace(/^#+\s*/gm, '');
  
  // Убираем markdown ссылки [text](url) -> text
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  
  // Убираем HTML теги
  cleaned = cleaned.replace(/<[^>]+>/g, '');
  
  // Удаляем технические фразы LLM
  cleaned = cleaned.replace(/^(Ответ:|Answer:|Результат:|Result:|Output:|Вывод:|Response:)\s*/gmi, '');
  cleaned = cleaned.replace(/^(Вот|Here is|Here's|Это)\s+(ответ|текст|результат|answer|text|result):?\s*/gmi, '');
  
  // Убираем множественные пробелы и переносы строк
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n'); // максимум 2 переноса подряд
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  // Финальная очистка от пустых строк в начале и конце
  cleaned = cleaned.replace(/^\n+|\n+$/g, '').trim();
  
  return cleaned;
}