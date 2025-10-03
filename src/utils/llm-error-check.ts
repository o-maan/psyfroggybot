// Универсальная проверка на ошибки LLM
export function isLLMError(originalText: string, cleanedText?: string): boolean {
  // Список известных ошибок LLM
  const errorPatterns = [
    'HF_JSON_ERROR',
    'HFJSONERROR',
    'ERROR',
    'error',
    'undefined',
    'null',
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
  
  // Проверяем оригинальный текст
  if (!originalText || originalText.length < 5) return true;
  
  // Если передан очищенный текст - проверяем и его
  if (cleanedText !== undefined) {
    if (!cleanedText || cleanedText.length < 10) return true;
    
    // Проверяем очищенный текст на ошибки
    const textToCheck = cleanedText.toLowerCase();
    for (const pattern of errorPatterns) {
      if (cleanedText === pattern || textToCheck.includes(pattern.toLowerCase())) {
        return true;
      }
    }
  }
  
  // Проверяем оригинальный текст на известные ошибки
  const originalLower = originalText.toLowerCase();
  for (const pattern of errorPatterns) {
    if (originalText === pattern || originalLower.includes(pattern.toLowerCase())) {
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