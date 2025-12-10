/**
 * Утилиты для адаптации текстов в коде под пол пользователя
 *
 * Используется для текстов, которые прописаны прямо в коде (не в markdown файлах)
 * Например: кнопки, команды, системные сообщения
 */

/**
 * Адаптирует текст под пол пользователя через условие в коде
 *
 * @param gender - Пол пользователя
 * @param maleText - Текст для мужского рода
 * @param femaleText - Текст для женского рода
 * @returns Адаптированный текст
 *
 * @example
 * adaptText(gender, 'Ты справился!', 'Ты справилась!')
 * // male → "Ты справился!"
 * // female → "Ты справилась!"
 * // unknown → "Ты справился!"
 */
export function adaptText(
  gender: 'male' | 'female' | 'unknown' | null | undefined,
  maleText: string,
  femaleText: string
): string {
  return gender === 'female' ? femaleText : maleText;
}

/**
 * Адаптирует окончание глагола под пол пользователя
 *
 * @param gender - Пол пользователя
 * @param base - Основа глагола (без окончания)
 * @param maleEnding - Окончание для мужского рода
 * @param femaleEnding - Окончание для женского рода
 * @returns Глагол с правильным окончанием
 *
 * @example
 * adaptVerb(gender, 'справил', '', 'а')
 * // male → "справил"
 * // female → "справила"
 *
 * @example
 * adaptVerb(gender, 'Дописал', '', 'а')
 * // male → "Дописал"
 * // female → "Дописала"
 */
export function adaptVerb(
  gender: 'male' | 'female' | 'unknown' | null | undefined,
  base: string,
  maleEnding: string,
  femaleEnding: string
): string {
  const ending = gender === 'female' ? femaleEnding : maleEnding;
  return base + ending;
}

/**
 * Создает адаптированный текст с подстановкой окончания
 *
 * ВАЖНО: Используй это для коротких вставок окончаний в длинные строки
 *
 * @param gender - Пол пользователя
 * @param femaleEnding - Окончание для женского рода (для мужского будет пусто)
 * @returns Окончание или пустая строка
 *
 * @example
 * `Дописал${ending(gender, 'а')}? Можешь дополнить`
 * // male → "Дописал? Можешь дополнить"
 * // female → "Дописала? Можешь дополнить"
 */
export function ending(
  gender: 'male' | 'female' | 'unknown' | null | undefined,
  femaleEnding: string
): string {
  return gender === 'female' ? femaleEnding : '';
}
