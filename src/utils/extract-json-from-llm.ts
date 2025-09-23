import { botLogger } from '../logger';

/**
 * Извлекает JSON из ответа LLM, даже если он обернут в think теги
 */
export function extractJsonFromLLM(text: string): string {
  let processed = text.trim();
  
  // Если текст начинается с { и заканчивается на }, вероятно это уже чистый JSON
  if (processed.startsWith('{') && processed.endsWith('}')) {
    return processed;
  }
  
  // Попробуем найти JSON внутри think тегов
  const thinkMatch = processed.match(/<think>[\s\S]*?<\/think>/i);
  if (thinkMatch) {
    const thinkContent = thinkMatch[0];
    
    // Ищем JSON внутри think блока
    const jsonMatch = thinkContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      botLogger.debug({ 
        originalLength: text.length,
        extractedLength: jsonMatch[0].length 
      }, '🔍 Извлечен JSON из think тегов');
      return jsonMatch[0];
    }
  }
  
  // Попробуем найти JSON после закрывающего think тега
  const afterThinkMatch = processed.match(/<\/think>\s*(\{[\s\S]*\})/i);
  if (afterThinkMatch) {
    botLogger.debug({ 
      originalLength: text.length,
      extractedLength: afterThinkMatch[1].length 
    }, '🔍 Найден JSON после think тегов');
    return afterThinkMatch[1];
  }
  
  // Ищем JSON в любом месте текста
  const jsonAnywhere = processed.match(/\{[\s\S]*\}/);
  if (jsonAnywhere) {
    botLogger.debug({ 
      originalLength: text.length,
      extractedLength: jsonAnywhere[0].length 
    }, '🔍 Найден JSON в тексте');
    return jsonAnywhere[0];
  }
  
  // Удаляем блоки кода ```json ... ```
  const codeBlockMatch = processed.match(/```json\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch) {
    return codeBlockMatch[1];
  }
  
  // Если ничего не нашли, возвращаем очищенный текст
  // Удаляем think теги
  processed = processed.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  
  // Если после удаления think тегов остался JSON
  if (processed.startsWith('{') && processed.endsWith('}')) {
    return processed;
  }
  
  botLogger.warn({ 
    originalText: text.substring(0, 200),
    processed: processed.substring(0, 200) 
  }, '⚠️ Не удалось извлечь JSON из ответа LLM');
  
  return processed;
}