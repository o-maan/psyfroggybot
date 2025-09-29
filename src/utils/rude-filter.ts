import { botLogger } from '../logger';
import { readFileSync } from 'fs';
import path from 'path';

interface RudeResponse {
  isRude: boolean;
  response?: string;
  needsCounter?: boolean;
}

// Счетчик для набора букв (в памяти)
const keyboardSpamCounter = new Map<number, number>();

// Очищаем старые записи каждые 30 минут
setInterval(() => {
  keyboardSpamCounter.clear();
}, 30 * 60 * 1000);

// Загружаем и парсим промпт при старте
const rudePhrasesData = loadRudePhrases();

function loadRudePhrases(): Map<string, { phrases: Set<string>, response: string }> {
  try {
    const promptPath = path.join(process.cwd(), 'assets', 'prompts', 'wtf');
    const content = readFileSync(promptPath, 'utf-8');
    const lines = content.split('\n');
    
    const categories = new Map<string, { phrases: Set<string>, response: string }>();
    let currentCategory = '';
    let currentResponse = '';
    let collectingPhrases = false;
    let skipUntilCategory = false;
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Пропускаем пустые строки и разделители
      if (!trimmed || trimmed === '---') {
        skipUntilCategory = false;
        continue;
      }
      
      // Пропускаем заголовки и пояснения до категорий
      if (trimmed.includes('ПРЯМЫЕ ОТКАЗЫ') || trimmed.includes('ГРУБЫЕ ПОСЛАНИЯ')) {
        skipUntilCategory = true;
        continue;
      }
      
      // Определяем категорию и ответ - ищем паттерн "КАТЕГОРИЯ - "ответ""
      if (!trimmed.startsWith('-') && trimmed.includes(' - "') && trimmed.endsWith('"')) {
        // Убираем эмодзи из начала строки
        const cleanLine = trimmed.replace(/^[🚫⏭️🖕😤🙄🎭🤬🎯😩]+\s*/, '');
        const match = cleanLine.match(/^(.+?)\s*-\s*"(.+)"$/);
        if (match) {
          currentCategory = match[1].trim();
          currentResponse = match[2];
          categories.set(currentCategory, { phrases: new Set(), response: currentResponse });
          collectingPhrases = true;
          skipUntilCategory = false;
          continue;
        }
      }
      
      // Специальная обработка для ответов на несколько строк (например, список ответов)
      if (trimmed.startsWith('"') && trimmed.endsWith('"') && !trimmed.includes(' - ')) {
        // Это может быть один из вариантов ответов, пропускаем
        continue;
      }
      
      // Собираем фразы
      if (collectingPhrases && trimmed.startsWith('-') && !skipUntilCategory) {
        const phrasesLine = trimmed.substring(1).trim();
        // Разбираем строку с фразами в кавычках
        const phrases = phrasesLine.match(/"[^"]+"/g);
        if (phrases) {
          const categoryData = categories.get(currentCategory);
          if (categoryData) {
            phrases.forEach(phrase => {
              // Убираем кавычки и добавляем в Set
              categoryData.phrases.add(phrase.slice(1, -1).toLowerCase());
            });
          }
        }
      } else if (collectingPhrases && !trimmed.startsWith('-') && !trimmed.startsWith('"')) {
        // Конец списка фраз
        collectingPhrases = false;
      }
    }
    
    // Логируем для отладки
    botLogger.info({ categoriesCount: categories.size }, 'Загружено категорий из промпта');
    categories.forEach((data, category) => {
      botLogger.debug({ category, phrasesCount: data.phrases.size, response: data.response }, 'Загружена категория');
    });
    
    // Парсим категории с обзывательствами из промпта
    if (!categories.has('ИНТЕЛЛЕКТУАЛЬНЫЕ ОСКОРБЛЕНИЯ')) {
      // Добавляем из промпта обзывательства с "ты"
      const intellectualInsults = ['ты тупой', 'ты тупица', 'ты тупень', 'ты тупак',
        'ты дебил', 'ты дебилоид', 'ты дэбил', 'ты идиот', 'ты идиотина', 'ты идиотище',
        'ты дурак', 'ты дурень', 'ты дурачок', 'ты кретин', 'ты кретиноид', 'ты кретинище',
        'ты имбецил', 'ты олигофрен', 'ты даун', 'ты отсталый', 'ты умственно отсталый',
        'ты недоразвитый', 'ты слабоумный', 'ты тормоз', 'ты тугодум', 'ты бестолковый',
        'ты безмозглый', 'ты пустоголовый'];
      
      const rudeInsults = ['ты мудак', 'ты мудила', 'ты мудло', 'ты мудозвон',
        'ты козел', 'ты козлина', 'ты козляра', 'ты козлище',
        'ты говнюк', 'ты говнарь', 'ты говноед',
        'ты гандон', 'ты пидор', 'ты пидрила', 'ты педрила',
        'ты ублюдок', 'ты выблядок', 'ты ебанат', 'ты ебанашка',
        'ты долбоеб', 'ты долбанутый', 'ты ебанутый',
        'ты хуесос', 'ты хуйло', 'ты хуеплет', 'ты хуепутало',
        'ты пидорас', 'ты петух', 'ты петушара',
        'ты уебан', 'ты уебок', 'ты уебище',
        'ты пиздабол', 'ты пиздобол', 'ты придурок', 'ты блядина', 
        'ты уёбок', 'ты ушлепок', 'ты ушлёпок'];
      
      // Добавляем все обзывательства с "ты" в категорию ОБЗЫВАТЕЛЬСТВА
      const existingPhrases = categories.get('ОБЗЫВАТЕЛЬСТВА')?.phrases || new Set();
      [...intellectualInsults, ...rudeInsults].forEach(phrase => {
        existingPhrases.add(phrase.toLowerCase());
      });
      
      if (categories.has('ОБЗЫВАТЕЛЬСТВА')) {
        categories.get('ОБЗЫВАТЕЛЬСТВА')!.phrases = existingPhrases;
      }
    }
    
    // Если парсинг не сработал корректно, добавим базовые категории вручную
    if (categories.size < 10) {
      // ОДНОСЛОЖНЫЕ НЕТ
      categories.set('ОДНОСЛОЖНЫЕ НЕТ', {
        phrases: new Set(['нет', 'не', 'неа', 'не-а', 'неее', 'нееет', 'найн', 'ноу', 'no', 'nope', 'nah']),
        response: 'Ква! Давай все-таки поработаем'
      });
      
      // НЕ ХОЧУ
      categories.set('НЕ ХОЧУ/НЕ БУДУ', {
        phrases: new Set(['не хочу', 'не буду', 'не стану', 'не собираюсь']),
        response: 'Понимаю, не всегда хочется, но нужно сделать'
      });
      
      // ОТСТАНЬ/ОТВАЛИ
      categories.set('ОТСТАНЬ/ОТВАЛИ', {
        phrases: new Set(['отвали', 'отстань', 'отцепись', 'отвяжись', 
                         'отвали от меня', 'отстань от меня',
                         'отвали со своими заданиями', 'отстань со своими заданиями',
                         'отвали от меня со своими заданиями', 'отстань от меня со своими заданиями']),
        response: 'Я тут чтобы помочь тебе. Может тебе нужен небольшой перерыв'
      });
      
      // ИДИ КУДА ПОДАЛЬШЕ
      categories.set('ИДИ КУДА ПОДАЛЬШЕ', {
        phrases: new Set(['иди нахуй', 'иди на хуй', 'иди нах', 'идинах', 'пошел нахуй', 
                         'пошел на хуй', 'пошел нах', 'иди нахер', 'пошел нахер']),
        response: 'Давай искупаемся в болоте - говорят, плавание снимает стресс 😁'
      });
      
      // ОБЗЫВАТЕЛЬСТВА (без "ты")
      categories.set('ОБЗЫВАТЕЛЬСТВА', {
        phrases: new Set(['тупой', 'тупица', 'тупень', 'тупак', 'дебил', 'дебилоид', 
                         'идиот', 'идиотина', 'дурак', 'дурень', 'кретин', 'имбецил',
                         'мудак', 'мудила', 'мудло', 'козел', 'козлина', 'говнюк',
                         'гандон', 'пидор', 'пидрила', 'ублюдок', 'ебанат', 'долбоеб',
                         'хуесос', 'хуйло', 'пидорас', 'петух', 'лох', 'лошара', 'лузер',
                         'неудачник', 'слабак', 'урод', 'уродец', 'псих', 'психопат',
                         'шизик', 'больной', 'ненормальный', 'чокнутый', 'конченый',
                         'упоротый', 'наркоман', 'торчок', 'алкаш', 'мразь', 'подонок',
                         'отморозок', 'быдло', 'быдлан', 'гопник', 'изгой', 'отщепенец',
                         'задрот', 'ботан', 'девственник', 'инцел', 'бомж', 'нищеброд',
                         'раб', 'холоп', 'терпила', 'тряпка', 'кринж', 'зашквар',
                         'токсик', 'душнила', 'хейтер', 'тролль', 'фейк', 'бот', 'нпс',
                         'ламер', 'нуб', 'рак', 'школьник', 'позор', 'позорище',
                         'разочарование', 'недоразумение', 'ошибка', 'баг', 'глюк',
                         'кошмар', 'ужас', 'треш', 'отстой', 'бесполезный', 'никчемный',
                         // Новые обзывательства
                         'пиздабол', 'пиздобол', 'придурок', 'блядина', 'уебок', 'уёбок', 'ушлепок', 'ушлёпок',
                         // Добавляем обзывательства с "ты" как отдельные слова
                         'ты тупой', 'ты тупица', 'ты тупень', 'ты тупак',
                         'ты дебил', 'ты дебилоид', 'ты дэбил', 'ты идиот', 'ты идиотина', 'ты идиотище',
                         'ты дурак', 'ты дурень', 'ты дурачок', 'ты кретин', 'ты кретиноид', 'ты кретинище',
                         'ты имбецил', 'ты олигофрен', 'ты даун', 'ты отсталый', 'ты умственно отсталый',
                         'ты недоразвитый', 'ты слабоумный', 'ты тормоз', 'ты тугодум', 'ты бестолковый',
                         'ты безмозглый', 'ты пустоголовый', 'ты мудак', 'ты мудила', 'ты мудло', 'ты мудозвон',
                         'ты долбоеб', 'ты долбоёб',
                         // Новые обзывательства с "ты"
                         'ты пиздабол', 'ты пиздобол', 'ты придурок', 'ты блядина', 'ты уебок', 'ты уёбок', 'ты ушлепок', 'ты ушлёпок',
                         // Дополнительные обзывательства из промпта
                         'олигофрен', 'даун', 'отсталый', 'умственно отсталый', 'недоразвитый', 'слабоумный',
                         'тормоз', 'тугодум', 'бестолковый', 'безмозглый', 'пустоголовый', 'мудозвон', 'долбоёб']),
        response: 'Обзывать лягуху - ну это как-то несерьезно 😕'
      });
      
      // КОРОТКИЕ РУГАТЕЛЬСТВА
      categories.set('КОРОТКИЕ РУГАТЕЛЬСТВА', {
        phrases: new Set(['говно', 'жопа', 'говно жопа', 'говно-жопа', 
                         'хуйня', 'хуйни', 'пизда', 'пиздец', 'блядь', 'бля', 
                         'хуй', 'хуя', 'хуи', 'пидор', 'ебать', 'ебал',
                         'нахуй', 'нахуя', 'похуй', 'хули', 'ахуй']),
        response: 'Давай чуточку подробнее 😅'
      });
      
      // БЕСИШЬ
      categories.set('БЕСИШЬ', {
        phrases: new Set(['бесишь', 'бесишь бля', 'бесиш', 'не беси', 'не беси меня']),
        response: 'Давай искупаемся в болоте - говорят, плавание снимает стресс 😁'
      });
      
      // ПРОПУСК/СКИП
      categories.set('ПРОПУСК/СКИП', { 
        phrases: new Set(['пас', 'пасс', 'pass', 'скип', 'скипаю', 'skip', 'скипну', 
                         'пропускаю', 'пропущу', 'пропуск', 'дальше', 'следующий', 
                         'некст', 'next', 'давай дальше', 'давай следующее', 
                         'минус этот', 'мимо', 'пролистываю', 'листаю дальше']),
        response: 'Важно сделать это задание' 
      });
      
      botLogger.warn('Использованы базовые категории вместо промпта');
    }
    
    return categories;
  } catch (error) {
    botLogger.error({ error }, 'Ошибка загрузки фраз для rude-filter');
    return new Map();
  }
}

// Проверка на набор букв
function isKeyboardSpam(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  
  // Белый список - точно осмысленные короткие слова
  const validWords = [
    'да', 'не', 'нет', 'ну', 'а', 'и', 'но', 'то', 'бы', 'же', 'ли', 'ка',
    'ох', 'ах', 'эх', 'ух', 'фу', 'ого', 'ой', 'ай', 'эй', 'ау', 'увы',
    'ага', 'угу', 'мм', 'хм', 'эм', 'гм', 'тьфу', 'брр', 'кхм',
    'ок', 'окей', 'хех', 'хах', 'лол', 'кек', 'ыы', 'хз', 'пф',
    'а?', 'м?', 'э?', 'чо', 'че', 'шо'
  ];
  
  if (validWords.includes(normalized)) {
    return false;
  }
  
  // Признаки набора букв:
  
  // 1. Только согласные (3+ подряд)
  if (/^[бвгджзйклмнпрстфхцчшщъь]{3,}$/.test(normalized)) {
    return true;
  }
  
  // 2. Латиница или цифры без смысла
  if (/^[a-z0-9]+$/i.test(normalized) && normalized.length > 1) {
    return true;
  }
  
  // 3. Смесь алфавитов (рус + eng)
  if (/[a-z]/i.test(normalized) && /[а-я]/i.test(normalized)) {
    return true;
  }
  
  // 4. Повторы одного символа (3+)
  if (/(.)\1{2,}/.test(normalized) && normalized.length === normalized.match(/(.)\1*/)?.[0].length) {
    return true;
  }
  
  // 5. Бессмысленные паттерны
  if (/^([бвгджзйклмнпрстфхцчшщ]{2,}[аеёиоуыэюя]){2,}$/.test(normalized) || // "фрафра"
      /^([аеёиоуыэюя][бвгджзйклмнпрстфхцчшщ]{2,}){2,}$/.test(normalized)) {  // "аффафф"
    return true;
  }
  
  // 6. Слишком странное соотношение букв для русского языка
  if (normalized.length > 5) {
    const vowels = (normalized.match(/[аеёиоуыэюя]/g) || []).length;
    const consonants = (normalized.match(/[бвгджзйклмнпрстфхцчшщ]/g) || []).length;
    
    // Нет гласных вообще или слишком мало
    if (vowels === 0 || (consonants > 0 && vowels / consonants < 0.15)) {
      return true;
    }
  }
  
  // 7. Явно случайные комбинации (только для коротких строк)
  if (normalized.length <= 6 && normalized.length >= 2) {
    // Проверяем, похоже ли на начало/конец какого-либо слова
    const hasWordStructure = /^[а-я]{1,2}$/.test(normalized) || // "я", "мы"
                            /^(пр|вз|вс|сп|ст|тр|др|гр|кр)[аеёиоуыэюя]/.test(normalized) || // приставки
                            /[аеёиоуыэюя](ть|сь|ся|ла|ло|ли|ет|ит|ут|ют)$/.test(normalized); // окончания
    
    if (!hasWordStructure && !/[аеёиоуыэюя]{2,}/.test(normalized)) {
      return true;
    }
  }
  
  // 8. Специальные паттерны клавиатурного спама
  if (/^[йцукен]+$/.test(normalized) || // верхний ряд
      /^[фывапр]+$/.test(normalized) || // средний ряд  
      /^[ячсмит]+$/.test(normalized)) { // нижний ряд
    return true;
  }
  
  return false;
}

// Проверка на другой язык
function isNonRussianText(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  
  // Если есть русские буквы - это не "другой язык"
  if (/[а-яё]/i.test(normalized)) {
    return false;
  }
  
  // Если только латиница и это не короткое слово из белого списка
  const englishWords = ['ok', 'okay', 'yes', 'no', 'lol', 'omg', 'wtf'];
  if (/^[a-z\s]+$/i.test(normalized) && !englishWords.includes(normalized)) {
    return true;
  }
  
  return false;
}

// Получить ответ для набора букв с учетом счетчика
function getKeyboardSpamResponse(userId?: number): string {
  if (!userId) return "Кажется, ты сел на клавиатуру 😁";
  
  const count = (keyboardSpamCounter.get(userId) || 0) + 1;
  keyboardSpamCounter.set(userId, count);
  
  switch (count) {
    case 1:
      return "Кажется, ты сел на клавиатуру 😁";
    case 2:
      return "Неть, так не пойдет 🙈";
    case 3:
      return "Терпеливо жду ответ на задание 😌";
    default:
      return ""; // После 3-х раз молчим
  }
}

// Основная функция проверки
export function checkRudeMessage(text: string, userId?: number): RudeResponse {
  try {
    const normalized = text.trim().toLowerCase();
    
    // ГЛАВНОЕ ПРАВИЛО: проверяем только если это ЕДИНСТВЕННЫЙ текст в сообщении
    
    // 1. Сначала проверяем точные совпадения с фразами из списков
    for (const [category, data] of rudePhrasesData.entries()) {
      if (data.phrases.has(normalized)) {
        botLogger.info({ category, phrase: normalized }, 'Обнаружен грубый ответ');
        
        // Для категории ОБЗЫВАТЕЛЬСТВА выбираем рандомный ответ
        let response = data.response;
        if (category === 'ОБЗЫВАТЕЛЬСТВА') {
          const responses = [
            'Обзывать лягуху - ну это как-то несерьезно 😕',
            'Кто обзывается, тот сам так и называется 😅',
            'Ну и ладно, пойду поквакаю в другом месте 🥲',
            'Помогаешь-помогаешь, а они вон что 🤨',
            'Ну и сам тут разбирайся тогда 🤪'
          ];
          response = responses[Math.floor(Math.random() * responses.length)];
        }
        
        return {
          isRude: true,
          response: response,
          needsCounter: false
        };
      }
    }
    
    // 2. Проверка на другой язык (ТОЛЬКО если это весь текст)
    if (isNonRussianText(normalized)) {
      botLogger.info({ text: normalized }, 'Обнаружен текст на другом языке');
      return {
        isRude: true,
        response: "Я могу говорить только русский 🫠",
        needsCounter: false
      };
    }
    
    // 3. Проверка на набор букв (ТОЛЬКО если это весь текст)
    if (isKeyboardSpam(normalized)) {
      const response = getKeyboardSpamResponse(userId);
      if (response) {
        botLogger.info({ text: normalized, userId }, 'Обнаружен набор букв');
        return {
          isRude: true,
          response,
          needsCounter: true
        };
      }
    }
    
    // Если дошли сюда - это нормальный ответ
    return { isRude: false };
  } catch (error) {
    botLogger.error({ error }, 'Ошибка в checkRudeMessage');
    // При любой ошибке - считаем ответ нормальным
    return { isRude: false };
  }
}

// Сброс счетчика для пользователя (вызывать при получении нормального ответа)
export function resetKeyboardSpamCounter(userId: number): void {
  keyboardSpamCounter.delete(userId);
}