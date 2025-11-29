/**
 * Утилита определения timezone по названию города
 *
 * Использует:
 * 1. city-timezones - база ~80,000 городов мира
 * 2. LLM fallback - для нестандартных случаев
 * 3. Moscow по умолчанию - если ничего не нашли
 */

import cityTimezones from 'city-timezones';
import { DateTime } from 'luxon';
import { generateMessage } from '../llm';
import { botLogger } from '../logger';

/**
 * Определяет timezone по названию города
 *
 * @param cityName - Название города (например, "Владивосток", "New York", "Лондон")
 * @returns IANA timezone (например, "Asia/Vladivostok", "America/New_York")
 */
export async function detectTimezoneByCity(cityName: string): Promise<{
  timezone: string;
  offset: number; // в минутах
  source: 'library' | 'llm' | 'default';
}> {
  const trimmedCity = cityName.trim();

  botLogger.info({ cityName: trimmedCity }, '🌍 Определение timezone по городу');

  // 1. Попытка через city-timezones
  try {
    const results = cityTimezones.lookupViaCity(trimmedCity);

    if (results && results.length > 0) {
      const timezone = results[0].timezone;
      const offset = getTimezoneOffset(timezone);

      botLogger.info({
        cityName: trimmedCity,
        timezone,
        offset,
        source: 'library'
      }, '✅ Timezone определен через библиотеку');

      return { timezone, offset, source: 'library' };
    }
  } catch (error) {
    botLogger.warn({ cityName: trimmedCity, error }, '⚠️ Ошибка при поиске в city-timezones');
  }

  // 2. Fallback на LLM (для нестандартных случаев)
  try {
    const llmResult = await detectTimezoneViaLLM(trimmedCity);

    if (llmResult) {
      const offset = getTimezoneOffset(llmResult);

      botLogger.info({
        cityName: trimmedCity,
        timezone: llmResult,
        offset,
        source: 'llm'
      }, '✅ Timezone определен через LLM');

      return { timezone: llmResult, offset, source: 'llm' };
    }
  } catch (error) {
    botLogger.warn({ cityName: trimmedCity, error }, '⚠️ Ошибка при определении через LLM');
  }

  // 3. Дефолт - Москва
  botLogger.warn({
    cityName: trimmedCity
  }, '⚠️ Не удалось определить timezone, используем Moscow по умолчанию');

  return {
    timezone: 'Europe/Moscow',
    offset: 180, // UTC+3 = 180 минут
    source: 'default'
  };
}

/**
 * Определяет timezone через LLM
 */
async function detectTimezoneViaLLM(cityName: string): Promise<string | null> {
  const prompt = `Определи IANA timezone для города или страны: "${cityName}"

ВАЖНО:
- Верни ТОЛЬКО название timezone в формате IANA (например, "Europe/Moscow", "Asia/Vladivostok", "America/New_York")
- Если это страна - верни timezone столицы
- Если не можешь определить - верни "unknown"
- НЕ добавляй никаких пояснений, только название timezone

Примеры:
Владивосток → Asia/Vladivostok
Санкт-Петербург → Europe/Moscow
Нью-Йорк → America/New_York
Лондон → Europe/London
Токио → Asia/Tokyo
Германия → Europe/Berlin

Город/страна: ${cityName}
Timezone:`;

  try {
    const response = await generateMessage(prompt);
    const timezone = response.trim();

    // Проверяем формат IANA timezone
    if (timezone === 'unknown' || !timezone.includes('/')) {
      return null;
    }

    // Проверяем что timezone валидный через luxon
    try {
      DateTime.now().setZone(timezone);
      return timezone;
    } catch {
      botLogger.warn({ timezone }, '⚠️ LLM вернул невалидный timezone');
      return null;
    }
  } catch (error) {
    botLogger.error({ cityName, error }, '❌ Ошибка при запросе к LLM');
    return null;
  }
}

/**
 * Получает UTC offset в минутах для timezone
 */
export function getTimezoneOffset(timezone: string): number {
  try {
    const now = DateTime.now().setZone(timezone);
    return now.offset; // возвращает offset в минутах
  } catch (error) {
    botLogger.error({ timezone, error }, '❌ Ошибка при получении offset для timezone');
    return 180; // дефолт MSK
  }
}

/**
 * Проверяет что две даты в одном дне (с учётом timezone)
 */
export function isSameDay(date1: Date | string, date2: Date | string, timezone: string): boolean {
  try {
    const dt1 = DateTime.fromJSDate(typeof date1 === 'string' ? new Date(date1) : date1).setZone(timezone);
    const dt2 = DateTime.fromJSDate(typeof date2 === 'string' ? new Date(date2) : date2).setZone(timezone);

    return dt1.hasSame(dt2, 'day');
  } catch (error) {
    botLogger.error({ date1, date2, timezone, error }, '❌ Ошибка при сравнении дат');
    return false;
  }
}

/**
 * Возвращает текущую дату в формате YYYY-MM-DD для указанного timezone
 */
export function getCurrentDateInTimezone(timezone: string): string {
  try {
    return DateTime.now().setZone(timezone).toISODate() || '';
  } catch (error) {
    botLogger.error({ timezone, error }, '❌ Ошибка при получении текущей даты');
    return DateTime.now().toISODate() || '';
  }
}
