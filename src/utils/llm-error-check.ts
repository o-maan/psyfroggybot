// Универсальная проверка на ошибки LLM
export function isLLMError(originalText: string, cleanedText?: string): boolean {
  // Список известных ошибок LLM
  // ВАЖНО: не включаем 'null' и 'undefined' в паттерны для поиска внутри текста,
  // так как JSON может содержать null значения (например: "additional_text": null)
  const errorPatterns = [
    'HF_JSON_ERROR',
    'HFJSONERROR',
    'ERROR',
    'error',
    'Internal Server Error',
    'Service Unavailable',
    'Bad Gateway',
    'Request failed',
    'Network Error',
    'Timeout',
    'Rate limit exceeded',
    'Invalid response',
    'You have exceeded',
    'Subscribe to PRO',
    'exceeded your monthly',
    'API Error',
    'Connection refused',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'Failed to fetch'
  ];

  // Проверка на точное совпадение с 'null' или 'undefined' (весь текст = null)
  const exactMatchErrors = ['null', 'undefined'];
  
  // Проверяем оригинальный текст
  if (!originalText || originalText.length < 5) return true;

  // Проверка на точное совпадение с null/undefined
  const textToCheckExact = (cleanedText !== undefined ? cleanedText : originalText).trim().toLowerCase();
  if (exactMatchErrors.includes(textToCheckExact)) {
    return true;
  }

  // Если передан очищенный текст - проверяем и его
  if (cleanedText !== undefined) {
    if (!cleanedText || cleanedText.length < 10) {
      console.log('isLLMError: cleanedText too short', {
        cleanedTextLength: cleanedText?.length || 0,
        cleanedTextPreview: cleanedText?.substring(0, 50)
      });
      return true;
    }

    // Проверяем очищенный текст на ошибки (includes для паттернов)
    const textToCheck = cleanedText.toLowerCase();
    for (const pattern of errorPatterns) {
      if (textToCheck.includes(pattern.toLowerCase())) {
        return true;
      }
    }
  }

  // Проверяем оригинальный текст на известные ошибки (includes для паттернов)
  const originalLower = originalText.toLowerCase();
  for (const pattern of errorPatterns) {
    if (originalLower.includes(pattern.toLowerCase())) {
      return true;
    }
  }
  
  // Проверяем на подозрительно короткие или технические ответы
  const checkText = cleanedText || originalText;
  if (checkText.match(/^[A-Z_]+$/)) { // Только заглавные буквы и подчеркивания
    return true;
  }
  
  return false;
}