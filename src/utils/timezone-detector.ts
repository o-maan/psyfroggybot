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
  timezone: string | null;
  offset: number | null; // в минутах
  source: 'library' | 'llm' | 'needsUserChoice';
  similarCities?: Array<{ city: string; timezone: string; offset: number }>;
  attemptedTimezone?: string; // Что пытались определить (для логов)
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

      // Проверяем что offset валидный
      if (offset !== null && !isNaN(offset)) {
        botLogger.info({
          cityName: trimmedCity,
          timezone: llmResult,
          offset,
          source: 'llm'
        }, '✅ Timezone определен через LLM');

        return { timezone: llmResult, offset, source: 'llm' };
      } else {
        // LLM вернул timezone, но он невалидный - ищем похожие города
        botLogger.warn({
          cityName: trimmedCity,
          attemptedTimezone: llmResult,
          offset
        }, '⚠️ LLM вернул timezone с невалидным offset, ищем похожие города');

        // Попробуем определить offset из названия timezone (например, America/New_York → -300)
        const estimatedOffset = offset || -300; // Fallback на восточное побережье США
        const similarCities = findSimilarCities(estimatedOffset, trimmedCity);

        if (similarCities.length > 0) {
          return {
            timezone: null,
            offset: null,
            source: 'needsUserChoice',
            similarCities,
            attemptedTimezone: llmResult
          };
        }
      }
    }
  } catch (error) {
    botLogger.warn({ cityName: trimmedCity, error }, '⚠️ Ошибка при определении через LLM');
  }

  // 3. Не смогли определить - ищем похожие города по популярным UTC offset
  botLogger.warn({
    cityName: trimmedCity
  }, '⚠️ Не удалось определить timezone, ищем похожие города');

  // Пробуем разные популярные offset'ы
  for (const offset of [180, -300, 0, 60, -480, 540]) { // MSK, EST, UTC, CET, PST, JST
    const similarCities = findSimilarCities(offset, trimmedCity);
    if (similarCities.length > 0) {
      return {
        timezone: null,
        offset: null,
        source: 'needsUserChoice',
        similarCities
      };
    }
  }

  // 4. Совсем ничего не нашли - предлагаем популярные города
  return {
    timezone: null,
    offset: null,
    source: 'needsUserChoice',
    similarCities: [
      { city: 'Moscow', timezone: 'Europe/Moscow', offset: 180 },
      { city: 'New York', timezone: 'America/New_York', offset: -300 },
      { city: 'London', timezone: 'Europe/London', offset: 0 },
      { city: 'Dubai', timezone: 'Asia/Dubai', offset: 240 }
    ]
  };
}

/**
 * Нормализует timezone название (исправляет типичные ошибки LLM)
 */
function normalizeTimezone(timezone: string): string {
  // Убираем лишние пробелы
  let normalized = timezone.trim();

  // Исправляем отсутствие подчёркивания между словами
  // America/NewYork → America/New_York
  // America/LosAngeles → America/Los_Angeles
  normalized = normalized.replace(/([a-z])([A-Z])/g, '$1_$2');

  // Заменяем пробелы на подчёркивания
  // America/New York → America/New_York
  normalized = normalized.replace(/ /g, '_');

  return normalized;
}

/**
 * Определяет timezone через LLM с улучшенным промптом
 */
async function detectTimezoneViaLLM(cityName: string): Promise<string | null> {
  const prompt = `Определи IANA timezone для города или страны: "${cityName}"

КРИТИЧЕСКИ ВАЖНО - формат IANA timezone:
- Используй ПОДЧЁРКИВАНИЕ между словами: America/New_York (НЕ America/NewYork!)
- Примеры правильного формата:
  * America/New_York (с подчёркиванием!)
  * America/Los_Angeles (с подчёркиванием!)
  * Europe/Moscow (одно слово - без подчёркивания)

ПРАВИЛА:
- Верни ТОЛЬКО название timezone в формате IANA
- Если это страна - верни timezone столицы
- Если не можешь определить - верни "unknown"
- НЕ добавляй никаких пояснений, только название timezone

Примеры (обрати внимание на подчёркивания!):
Владивосток → Asia/Vladivostok
Санкт-Петербург → Europe/Moscow
Нью-Йорк → America/New_York
нью йорк → America/New_York
Лос Анджелес → America/Los_Angeles
лос анжелес → America/Los_Angeles
Лондон → Europe/London
Токио → Asia/Tokyo
Германия → Europe/Berlin

Город/страна: ${cityName}
Timezone:`;

  try {
    const response = await generateMessage(prompt);
    let timezone = response.trim();

    // Проверяем формат IANA timezone
    if (timezone === 'unknown' || !timezone.includes('/')) {
      return null;
    }

    // Нормализуем timezone (исправляем типичные ошибки)
    timezone = normalizeTimezone(timezone);

    // Проверяем что timezone валидный через luxon
    try {
      DateTime.now().setZone(timezone);
      botLogger.info({ originalTimezone: response.trim(), normalizedTimezone: timezone }, '✅ Timezone нормализован и валиден');
      return timezone;
    } catch {
      botLogger.warn({ timezone, originalTimezone: response.trim() }, '⚠️ LLM вернул невалидный timezone даже после нормализации');
      return null;
    }
  } catch (error) {
    botLogger.error({ cityName, error }, '❌ Ошибка при запросе к LLM');
    return null;
  }
}

/**
 * Вычисляет расстояние Левенштейна между двумя строками
 */
function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[str2.length][str1.length];
}

/**
 * Ищет похожие города по UTC offset и названию
 */
export function findSimilarCities(targetOffset: number, searchQuery: string): Array<{ city: string; timezone: string; offset: number }> {
  const allCities = cityTimezones.cityMapping;
  const candidates: Array<{ city: string; timezone: string; offset: number; similarity: number }> = [];

  const normalizedQuery = searchQuery.toLowerCase().replace(/[^a-zа-яё]/g, '');

  for (const city of allCities) {
    const cityOffset = getTimezoneOffset(city.timezone);

    // Ищем города с тем же UTC offset (±30 минут)
    if (Math.abs(cityOffset - targetOffset) <= 30) {
      const normalizedCityName = city.city.toLowerCase().replace(/[^a-zа-яё]/g, '');
      const distance = levenshteinDistance(normalizedQuery, normalizedCityName);
      const similarity = 1 - (distance / Math.max(normalizedQuery.length, normalizedCityName.length));

      if (similarity > 0.3) { // Минимальное сходство 30%
        candidates.push({
          city: city.city,
          timezone: city.timezone,
          offset: cityOffset,
          similarity
        });
      }
    }
  }

  // Сортируем по схожести (от большей к меньшей)
  candidates.sort((a, b) => b.similarity - a.similarity);

  // Возвращаем топ-4 уникальных города
  const uniqueCities = new Set<string>();
  const result: Array<{ city: string; timezone: string; offset: number }> = [];

  for (const candidate of candidates) {
    if (!uniqueCities.has(candidate.timezone) && result.length < 4) {
      uniqueCities.add(candidate.timezone);
      result.push({
        city: candidate.city,
        timezone: candidate.timezone,
        offset: candidate.offset
      });
    }
  }

  return result;
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
