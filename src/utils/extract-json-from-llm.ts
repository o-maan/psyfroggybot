import { botLogger } from '../logger';

/**
 * Извлекает JSON из ответа LLM, даже если он обернут в think теги
 */
export function extractJsonFromLLM(text: string): string {
  // Проверяем на null/undefined
  if (!text) {
    botLogger.warn('⚠️ extractJsonFromLLM получил пустой текст');
    return '';
  }
  
  let processed = text.trim();
  
  // Проверяем на ошибки LLM
  if (processed === 'HF_JSON_ERROR' || processed === 'ERROR' || processed.startsWith('Error:')) {
    botLogger.warn({ text: processed }, '⚠️ extractJsonFromLLM получил ошибку от LLM');
    return processed;
  }
  
  // Если текст начинается с { и заканчивается на }, вероятно это уже чистый JSON
  if (processed.startsWith('{') && processed.endsWith('}')) {
    return processed;
  }
  
  
  // ПРИОРИТЕТ 1: Ищем JSON в блоке ```json ... ```
  const codeBlockJsonMatch = processed.match(/```json\s*([\s\S]*?)\s*```/i);
  if (codeBlockJsonMatch) {
    const jsonContent = codeBlockJsonMatch[1].trim();
    botLogger.debug({ 
      originalLength: text.length,
      extractedLength: jsonContent.length,
      source: 'code block'
    }, '🔍 Найден JSON в блоке кода ```json');
    return jsonContent;
  }
  
  // ПРИОРИТЕТ 2: Попробуем найти JSON после закрывающего think тега
  const afterThinkMatch = processed.match(/<\/think>\s*(\{[\s\S]*\})/i);
  if (afterThinkMatch) {
    // Ищем сбалансированный JSON после think
    const afterThinkText = processed.substring(processed.indexOf('</think>') + 8);
    const jsonStart = afterThinkText.indexOf('{');
    
    if (jsonStart !== -1) {
      let braceCount = 0;
      let inString = false;
      let escapeNext = false;
      let jsonEnd = -1;
      
      for (let i = jsonStart; i < afterThinkText.length; i++) {
        const char = afterThinkText[i];
        
        if (escapeNext) {
          escapeNext = false;
          continue;
        }
        
        if (char === '\\') {
          escapeNext = true;
          continue;
        }
        
        if (char === '"' && !escapeNext) {
          inString = !inString;
          continue;
        }
        
        if (!inString) {
          if (char === '{') braceCount++;
          else if (char === '}') braceCount--;
          
          if (braceCount === 0 && i > jsonStart) {
            jsonEnd = i + 1;
            break;
          }
        }
      }
      
      if (jsonEnd !== -1) {
        const extractedJson = afterThinkText.substring(jsonStart, jsonEnd);
        botLogger.debug({ 
          originalLength: text.length,
          extractedLength: extractedJson.length,
          source: 'after think'
        }, '🔍 Найден JSON после think тегов');
        return extractedJson;
      }
    }
  }
  
  // Обработка случая когда JSON разбит на строки с пробелами в ключах (deepseek-r1 issue)
  // Например: { "probablybusy": false вместо { "probably_busy": false
  const brokenJsonMatch = processed.match(/\{\s*"[^"]*"\s*:\s*[^}]*\}/i);
  if (brokenJsonMatch) {
    let fixedJson = brokenJsonMatch[0];
    // Исправляем распространенные ошибки DeepSeek
    fixedJson = fixedJson.replace(/"probablybusy"/gi, '"probably_busy"');
    fixedJson = fixedJson.replace(/"busyreason"/gi, '"busy_reason"');
    fixedJson = fixedJson.replace(/"negativepart"/gi, '"negative_part"');
    fixedJson = fixedJson.replace(/"positivepart"/gi, '"positive_part"');
    fixedJson = fixedJson.replace(/"additionaltext"/gi, '"additional_text"');
    fixedJson = fixedJson.replace(/"feelsandemotions"/gi, '"feels_and_emotions"');
    fixedJson = fixedJson.replace(/"deepsupport"/gi, '"deep_support"');
    
    botLogger.debug({ 
      originalJson: brokenJsonMatch[0],
      fixedJson 
    }, '🔧 Исправлен JSON с неправильными ключами');
    return fixedJson;
  }
  
  // Ищем JSON с правильным балансом скобок
  const jsonStart = processed.indexOf('{');
  if (jsonStart !== -1) {
    // Ищем сбалансированные скобки
    let braceCount = 0;
    let inString = false;
    let escapeNext = false;
    let jsonEnd = -1;
    
    for (let i = jsonStart; i < processed.length; i++) {
      const char = processed[i];
      
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      
      if (char === '\\') {
        escapeNext = true;
        continue;
      }
      
      if (char === '"' && !escapeNext) {
        inString = !inString;
        continue;
      }
      
      if (!inString) {
        if (char === '{') braceCount++;
        else if (char === '}') braceCount--;
        
        if (braceCount === 0) {
          jsonEnd = i + 1;
          break;
        }
      }
    }
    
    if (jsonEnd !== -1) {
      const extractedJson = processed.substring(jsonStart, jsonEnd);
      
      botLogger.debug({ 
        originalLength: text.length,
        extractedLength: extractedJson.length,
        startsWithBrace: extractedJson.startsWith('{'),
        endsWithBrace: extractedJson.endsWith('}'),
        first100: extractedJson.substring(0, 100),
        last100: extractedJson.substring(Math.max(0, extractedJson.length - 100))
      }, '🔍 Найден JSON с балансированными скобками');
      
      return extractedJson;
    }
    
    // Если не нашли конец, пробуем взять весь текст от начала {
    const fallbackJson = processed.substring(jsonStart);
    botLogger.warn({ 
      textLength: fallbackJson.length,
      preview: fallbackJson.substring(0, 200) 
    }, '⚠️ Не найден конец JSON, используем весь текст от {');
    
    return fallbackJson;
  }
  
  
  // Если ничего не нашли, возвращаем очищенный текст
  // Удаляем think теги
  processed = processed.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  
  // Если после удаления think тегов остался JSON
  if (processed.startsWith('{') && processed.endsWith('}')) {
    return processed;
  }
  
  // Последняя попытка - ищем JSON-подобную структуру более гибко
  const flexibleJsonMatch = processed.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g);
  if (flexibleJsonMatch && flexibleJsonMatch.length > 0) {
    // Берем самый длинный найденный JSON
    const longestJson = flexibleJsonMatch.reduce((a, b) => a.length > b.length ? a : b);
    botLogger.debug({ 
      foundCount: flexibleJsonMatch.length,
      longestLength: longestJson.length 
    }, '🔍 Найден JSON гибким поиском');
    return longestJson;
  }
  
  botLogger.warn({ 
    originalText: text.substring(0, 200),
    processed: processed.substring(0, 200) 
  }, '⚠️ Не удалось извлечь JSON из ответа LLM');
  
  return processed || '';
}