/**
 * Парсер шаблонов для адаптации текстов под пол пользователя
 *
 * Синтаксис шаблонов в markdown:
 * - ${мужской:женский} - например: ${ся:ась}, ${ал:ала}
 * - ${:женский} - например: ${:а} (пустой мужской вариант)
 * - <!-- gender:both --> - маркер что текст не требует адаптации
 *
 * Примеры:
 * "Ты справил${ся:ась} с заданием!" → мужской: "Ты справился с заданием!"
 *                                     → женский: "Ты справилась с заданием!"
 *
 * "Дописал${:а}?" → мужской: "Дописал?"
 *                 → женский: "Дописала?"
 */

import { botLogger } from '../logger';

/**
 * Результат парсинга шаблона
 */
export interface TemplateParseResult {
  /** Адаптированный текст */
  text: string;
  /** Был ли найден шаблон или маркер gender:both */
  wasTemplateFound: boolean;
  /** Количество найденных подстановок */
  substitutionsCount: number;
}

/**
 * Парсит шаблон и адаптирует текст под указанный пол
 *
 * @param text - Текст с шаблонами
 * @param gender - Пол пользователя ('male' | 'female' | 'unknown')
 * @returns Результат парсинга с адаптированным текстом
 */
export function parseGenderTemplate(
  text: string,
  gender: 'male' | 'female' | 'unknown' | null
): TemplateParseResult {
  // Проверяем маркер <!-- gender:both --> (текст не требует адаптации)
  const hasBothGenderMarker = /<!--\s*gender:\s*both\s*-->/i.test(text);

  if (hasBothGenderMarker) {
    // 1. Удаляем маркер из текста
    // 2. Нормализуем переносы: 3+ переносов -> 2 (одна пустая строка максимум)
    // 3. Убираем переносы в начале и конце
    const cleanedText = text
      .replace(/<!--\s*gender:\s*both\s*-->/gi, '') // удаляем маркер
      .replace(/\n{3,}/g, '\n\n') // нормализуем переносы (не больше одной пустой строки)
      .replace(/^\n+|\n+$/g, ''); // убираем переносы в начале и конце

    botLogger.debug(
      { textLength: text.length },
      'Найден маркер gender:both - текст не требует адаптации'
    );

    return {
      text: cleanedText,
      wasTemplateFound: true,
      substitutionsCount: 0
    };
  }

  // Ищем шаблоны вида ${мужской:женский}
  const templateRegex = /\$\{([^:}]*):([^}]+)\}/g;
  let substitutionsCount = 0;

  // Для unknown используем мужской род (по умолчанию)
  const useFemale = gender === 'female';

  const adaptedText = text.replace(templateRegex, (match, maleVariant, femaleVariant) => {
    substitutionsCount++;

    // Выбираем нужный вариант в зависимости от пола
    const result = useFemale ? femaleVariant : maleVariant;

    botLogger.trace(
      {
        match,
        maleVariant,
        femaleVariant,
        gender,
        result
      },
      'Подстановка шаблона'
    );

    return result;
  });

  const wasTemplateFound = substitutionsCount > 0;

  if (wasTemplateFound) {
    botLogger.debug(
      {
        gender,
        substitutionsCount,
        textLength: text.length
      },
      'Шаблон успешно распарсен'
    );
  }

  return {
    text: adaptedText,
    wasTemplateFound,
    substitutionsCount
  };
}

/**
 * Проверяет, содержит ли текст шаблоны или маркер gender:both
 *
 * @param text - Текст для проверки
 * @returns true если найдены шаблоны или маркер
 */
export function hasGenderTemplate(text: string): boolean {
  // Проверяем маркер gender:both
  if (/<!--\s*gender:\s*both\s*-->/i.test(text)) {
    return true;
  }

  // Проверяем наличие шаблонов ${...}
  return /\$\{[^:}]*:[^}]+\}/g.test(text);
}

/**
 * Извлекает чистый текст без маркеров (для предпросмотра)
 *
 * @param text - Текст с шаблонами
 * @returns Текст без маркеров и шаблонов (в мужском роде)
 */
export function extractCleanText(text: string): string {
  // Удаляем маркер gender:both
  let cleanText = text.replace(/<!--\s*gender:\s*both\s*-->/gi, '');

  // Заменяем шаблоны на мужской вариант
  cleanText = cleanText.replace(/\$\{([^:}]*):([^}]+)\}/g, '$1');

  return cleanText.trim();
}
