/**
 * Обертка для генерации LLM с автоматическим учетом пола и имени пользователя
 *
 * ВАЖНО: ВСЕГДА используй эту функцию вместо прямого вызова generateMessage()
 * чтобы автоматически передавать информацию о поле пользователя в промпт
 */

import { generateMessage } from './llm';
import { getUserByChatId } from './db';
import { llmLogger } from './logger';

/**
 * Генерирует текст через LLM с автоматической подстановкой данных пользователя
 *
 * Автоматически:
 * 1. Получает имя и пол пользователя из БД
 * 2. Добавляет инструкции о поле в системный промпт
 * 3. Заменяет {userName} и {userGender} в промпте
 *
 * @param userId - ID пользователя для получения данных из БД
 * @param prompt - Промпт для генерации
 * @param includeUserName - Передавать ли имя в LLM (true = для постов, false = для комментариев)
 * @returns Сгенерированный текст
 */
export async function generateWithUserContext(
  userId: number,
  prompt: string,
  includeUserName: boolean = false
): Promise<string> {
  // Получаем данные пользователя
  const user = getUserByChatId(userId);
  const userName = user?.name || null;
  const userGender = user?.gender || 'unknown';

  llmLogger.debug(
    { userId, userName, userGender, includeUserName },
    'Генерация с контекстом пользователя'
  );

  // Формируем инструкцию о поле пользователя
  // includeUserName = true: для постов (можно использовать имя в приветствии)
  // includeUserName = false: для комментариев (НЕ использовать имя, только "ты")
  const genderInstruction = includeUserName
    ? `
ВАЖНАЯ ИНФОРМАЦИЯ О ПОЛЬЗОВАТЕЛЕ:
- Имя пользователя: ${userName || 'неизвестно'}
- Пол пользователя: ${userGender === 'male' ? 'мужской' : userGender === 'female' ? 'женский' : 'неизвестен'}

ПРАВИЛА ОБРАЩЕНИЯ К ПОЛЬЗОВАТЕЛЮ:
- Если пол мужской: используй мужской род ("ты сделал", "ты готов", "ты рад")
- Если пол женский: используй женский род ("ты сделала", "ты готова", "ты рада")
- Лягушка (от чьего лица ты пишешь) ВСЕГДА мужского рода: "я рад" (НЕ "я рада"), "я готов" (НЕ "я готова")
- Можешь использовать имя пользователя в приветствии, но не повторяй его часто

`
    : `
ВАЖНАЯ ИНФОРМАЦИЯ О ПОЛЬЗОВАТЕЛЕ:
- Пол пользователя: ${userGender === 'male' ? 'мужской' : userGender === 'female' ? 'женский' : 'неизвестен'}

ПРАВИЛА ОБРАЩЕНИЯ К ПОЛЬЗОВАТЕЛЮ:
- Если пол мужской: используй мужской род ("ты сделал", "ты готов", "ты рад")
- Если пол женский: используй женский род ("ты сделала", "ты готова", "ты рада")
- Лягушка (от чьего лица ты пишешь) ВСЕГДА мужского рода: "я рад" (НЕ "я рада"), "я готов" (НЕ "я готова")
- НЕ используй имя пользователя в ответах - обращайся просто "ты"

`;

  // Заменяем {userName} и {userGender} если они есть в промпте
  // ВАЖНО: userName всегда должно быть (собирается при онбординге), fallback только для безопасности
  let processedPrompt = prompt
    .replace(/\{userName\}/g, userName || 'друг')
    .replace(/\{userGender\}/g, userGender);

  // Добавляем инструкцию о поле в начало промпта
  const fullPrompt = genderInstruction + processedPrompt;

  llmLogger.debug(
    {
      userId,
      originalPromptLength: prompt.length,
      fullPromptLength: fullPrompt.length
    },
    'Промпт подготовлен с контекстом пользователя'
  );

  // Вызываем оригинальную функцию генерации
  return await generateMessage(fullPrompt);
}
