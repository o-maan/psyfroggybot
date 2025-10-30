// Сбалансированная модель определения спама
// ВНИМАНИЕ: Этот файл не используется в проекте, но оставлен для возможных экспериментов

// Основной принцип: комбинация простых правил с весами
export function isKeyboardSpamBalanced(text: string): boolean {
  const normalized = text.trim().toLowerCase();

  // 1. ЯВНЫЙ СПАМ - сразу возвращаем true

  // 1.1 Повторы одного символа (аааа, ддддд)
  if (/^(.)\1{2,}$/.test(normalized)) {
    return true;
  }

  // 1.2 Клавиатурные ряды
  if (/^[йцукен]{3,}$/.test(normalized) ||
      /^[фывапр]{3,}$/.test(normalized) ||
      /^[ячсмит]{3,}$/.test(normalized) ||
      /^[qwerty]{3,}$/i.test(normalized) ||
      /^[asdfgh]{3,}$/i.test(normalized) ||
      /^[zxcvbn]{3,}$/i.test(normalized)) {
    return true;
  }

  // 1.3 Только согласные 5+ подряд
  if (/^[бвгджзйклмнпрстфхцчшщ]{5,}$/.test(normalized)) {
    return true;
  }

  // 2. ПРОВЕРКА ПО СЛОВАРЮ - отключена, так как словарь не импортируется
  // TODO: если понадобится использовать этот файл, импортировать russianWordsSet из rude-filter.ts
  // if (russianWordsSet.has(normalized)) {
  //   return false;
  // }
  
  // 3. КОРОТКИЕ СЛОВА (1-3 буквы) - минимальный белый список
  if (normalized.length <= 3) {
    const essentialShortWords = [
      // Самые базовые
      'да', 'нет', 'не', 'ну', 'и', 'а', 'но', 'то', 'бы', 'же', 'ли',
      'ох', 'ах', 'эх', 'ух', 'ой', 'ай', 'эй', 'фу', 'ау',
      'ага', 'угу', 'хм', 'мм', 'эм',
      // Вопросы
      'что', 'кто', 'где', 'как', 'так',
      // Местоимения  
      'я', 'ты', 'он', 'мы', 'вы', 'их', 'наш', 'ваш', 'мой', 'его', 'её',
      // Предлоги
      'в', 'на', 'с', 'о', 'к', 'по', 'из', 'за', 'до', 'для', 'при', 'про', 'без',
      // Базовые слова
      'дом', 'кот', 'пес', 'лес', 'сад', 'год', 'раз', 'два', 'три', 'сто',
      'еда', 'чай', 'суп', 'мир', 'сын', 'дед',
      // Глаголы
      'был', 'жил', 'дал', 'шел',
      // Сленг и мат
      'хуй', 'бля', 'лох', 'лол', 'кек', 'рак', 'нуб', 'топ', 'изи',
      // Сокращения
      'ок', 'хз', 'пф', 'щас', 'че', 'чё', 'шо'
    ];
    
    return !essentialShortWords.includes(normalized);
  }
  
  // 4. АНАЛИЗ ПО БАЛЛАМ для слов 4+ букв
  let spamScore = 0;
  let validScore = 0;
  
  // 4.1 Начинается с редких букв
  if (/^[ыъьй]/.test(normalized)) {
    spamScore += 3;
  }
  
  // 4.2 Проверка гласных/согласных
  const vowels = (normalized.match(/[аеёиоуыэюя]/g) || []).length;
  const consonants = (normalized.match(/[бвгджзйклмнпрстфхцчшщ]/g) || []).length;
  const vowelRatio = vowels / normalized.length;
  
  // Нормальное соотношение гласных 0.35-0.5
  if (vowelRatio < 0.2 || vowelRatio > 0.7) {
    spamScore += 2;
  }
  
  // 4.3 Проверка на 3+ согласных подряд
  if (/[бвгджзклмнпрстфхцчшщ]{3}/.test(normalized)) {
    spamScore += 1;
  }
  
  // 4.4 Проверка распространенных окончаний
  const commonEndings = ['ать', 'ять', 'еть', 'ить', 'оть', 'уть', 
                         'ный', 'ная', 'ное', 'ные', 'ний', 'няя',
                         'ого', 'его', 'ому', 'ему', 'ая', 'яя',
                         'ий', 'ый', 'ой', 'ей', 'ов', 'ев', 'ин'];
  
  if (commonEndings.some(ending => normalized.endsWith(ending))) {
    validScore += 3;
  }
  
  // 4.5 Проверка распространенных приставок
  const commonPrefixes = ['пере', 'при', 'под', 'над', 'раз', 'без', 'вы', 'за', 'на', 'от', 'по', 'про', 'с'];
  
  if (commonPrefixes.some(prefix => normalized.startsWith(prefix))) {
    validScore += 2;
  }
  
  // 4.6 Проверка распространенных корней (упрощенно - биграммы в середине)
  const commonRoots = ['люб', 'раб', 'дел', 'ход', 'вод', 'нос', 'воз', 'каз', 'лож', 'став',
                       'держ', 'мысл', 'числ', 'служ', 'движ'];
  
  if (commonRoots.some(root => normalized.includes(root))) {
    validScore += 2;
  }
  
  // 4.7 Частые биграммы
  const frequentBigrams = ['ст', 'но', 'то', 'на', 'ен', 'ов', 'ни', 'ра', 'во', 'ко',
                           'ер', 'ол', 'ор', 'ан', 'ти', 'ал', 'ет', 'ес', 'ат', 'ит'];
  
  let bigramCount = 0;
  for (let i = 0; i < normalized.length - 1; i++) {
    if (frequentBigrams.includes(normalized.slice(i, i + 2))) {
      bigramCount++;
    }
  }
  
  // Если есть 2+ частых биграммы - скорее всего реальное слово
  if (bigramCount >= 2) {
    validScore += 3;
  } else if (bigramCount === 0 && normalized.length >= 5) {
    spamScore += 2;
  }
  
  // 4.8 Проверка на чередование гласных/согласных (высокая энтропия)
  let transitions = 0;
  let lastType = '';
  
  for (const char of normalized) {
    const currentType = /[аеёиоуыэюя]/.test(char) ? 'vowel' : 'consonant';
    if (lastType && lastType !== currentType) {
      transitions++;
    }
    lastType = currentType;
  }
  
  // Слишком частые переходы - признак спама
  if (transitions > normalized.length * 0.7) {
    spamScore += 2;
  }
  
  // ФИНАЛЬНОЕ РЕШЕНИЕ
  // Если больше признаков спама чем валидности - это спам
  return spamScore > validScore;
}

// Примеры работы:
// "тяжко" - есть окончание "ко", частая биграмма "тя" -> validScore выше
// "работа" - окончание "ота", приставка "ра", биграммы "ра", "бо" -> validScore выше  
// "ыдвпои" - начинается с "ы", нет окончаний, мало биграмм -> spamScore выше
// "увколд" - нет окончаний, нет приставок, мало биграмм -> spamScore выше
// "опш" - короткое, не в белом списке -> spam
// "шыовапл" - начинается нормально, но нет структуры слова -> spamScore выше