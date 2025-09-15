// Списки эмоций по категориям
export const NEGATIVE_EMOTIONS = {
  ГРУСТЬ: [
    'печаль', 'скука', 'разочарование', 'лень', 'тоска', 'отрешенность', 
    'жалость', 'боль', 'горечь', 'скорбь', 'безнадежность', 'сожаление', 
    'потерянность', 'озадаченность', 'недоумение', 'потрясение', 'опустошение', 
    'загнанность', 'отчужденность', 'грусть', 'грустно', 'грущу', 
    'грустил', 'грустила', 'погрустнел', 'погрустнела'
  ],
  ГНЕВ: [
    'злость', 'раздражение', 'ярость', 'ненависть', 'негодование', 
    'презрение', 'обида', 'ревность', 'уязвленность', 'досада', 
    'зависть', 'неприязнь', 'возмущение', 'отвращение', 'истерия', 
    'бешенство', 'недовольство', 'брезгливость', 'гнев', 'злился', 
    'злилась', 'злой', 'злая', 'разозлился', 'разозлилась', 'разозлило',
    'раздражен', 'раздражена', 'раздражало', 'бесит', 'бесило'
  ],
  СТРАХ: [
    'испуг', 'боязнь', 'оцепенение', 'ужас', 'тревога', 'беспокойство', 
    'опасение', 'унижение', 'замешательство', 'растерянность', 'отчаяние', 
    'стыд', 'вина', 'нерешительность', 'смущение', 'застенчивость', 
    'подавленность', 'напряженность', 'паника', 'ошарашенность', 'страх',
    'страшно', 'боюсь', 'боялся', 'боялась', 'испугался', 'испугалась',
    'тревожно', 'беспокоюсь', 'волнуюсь', 'волновался', 'волновалась',
    'стыдно', 'виноват', 'виновата'
  ]
};

export const POSITIVE_EMOTIONS = {
  РАДОСТЬ: [
    'счастье', 'восторг', 'ликование', 'умиротворение', 'увлечение', 
    'интерес', 'забота', 'удовлетворение', 'вдохновение', 'радость', 
    'принятие', 'возбуждение', 'приподнятость', 'надежда', 'вера', 
    'изумление', 'радуюсь', 'порадовало', 'обрадовало', 'радостно',
    'счастлив', 'счастлива', 'рад', 'рада', 'доволен', 'довольна'
  ],
  ЛЮБОВЬ: [
    'нежность', 'теплота', 'благодарность', 'блаженство', 'доверие', 
    'безопасность', 'спокойствие', 'симпатия', 'любовь к себе', 'восхищение', 
    'уважение', 'очарование', 'искренность', 'дружелюбие', 'доброта', 
    'сочувствие', 'благостность', 'гордость', 'самоценность', 'влюбленность', 
    'любовь', 'люблю', 'нравится', 'обожаю', 'восхищаюсь', 'горжусь',
    'благодарен', 'благодарна', 'спокоен', 'спокойна'
  ]
};

// Все эмоции для быстрого поиска
const ALL_EMOTIONS = [
  ...Object.values(NEGATIVE_EMOTIONS).flat(),
  ...Object.values(POSITIVE_EMOTIONS).flat()
];

// Нормализация текста для сравнения
function normalizeText(text: string): string {
  return text.toLowerCase().trim();
}

// Функция для получения корня эмоции
function getEmotionRoot(emotion: string): string {
  // Словарь основных корней для группировки схожих эмоций
  const roots: { [key: string]: string[] } = {
    'раздражение': ['раздраж'],
    'грусть': ['груст', 'грущ'],
    'злость': ['зл', 'злоб'],
    'страх': ['страх', 'страш'],
    'тревога': ['тревог', 'тревож'],
    'вина': ['вин', 'винов'],
    'стыд': ['стыд'],
    'боль': ['боль', 'бол'],
    'радость': ['рад'],
    'счастье': ['счаст'],
    'любовь': ['люб', 'любов'],
    'спокойствие': ['спокой', 'спок'],
    'гнев': ['гнев'],
    'ярость': ['ярост'],
    'ненависть': ['ненавид', 'ненавист'],
    'обида': ['обид', 'обиж'],
    'разочарование': ['разочар'],
    'печаль': ['печаль'],
    'тоска': ['тоск'],
    'беспокойство': ['беспокой', 'беспок'],
    'волнение': ['волн'],
    'испуг': ['испуг', 'пуг'],
    'ужас': ['ужас'],
    'отчаяние': ['отчая'],
    'благодарность': ['благодар'],
    'восторг': ['восторг', 'восторж'],
    'восхищение': ['восхищ', 'восхит'],
    'гордость': ['горд', 'горж'],
    'доверие': ['довер'],
    'уважение': ['уваж'],
    'симпатия': ['симпат'],
    'нежность': ['нежн'],
    'теплота': ['тепл'],
    'умиротворение': ['умиротвор', 'мир'],
    'возбуждение': ['возбужд'],
    'интерес': ['интерес'],
    'надежда': ['надежд', 'надеж']
  };
  
  // Ищем, к какому корню относится эмоция
  for (const [baseEmotion, rootPatterns] of Object.entries(roots)) {
    for (const pattern of rootPatterns) {
      if (emotion.includes(pattern)) {
        return baseEmotion;
      }
    }
  }
  
  // Если не нашли в словаре, возвращаем саму эмоцию
  return emotion;
}

// Функция для подсчета эмоций в тексте
export function countEmotions(text: string, emotionType: 'negative' | 'positive' | 'all' = 'all'): {
  count: number;
  emotions: string[];
  categories: { [key: string]: string[] };
} {
  const normalizedText = normalizeText(text);
  const words = normalizedText.split(/\s+/);
  const foundEmotions: string[] = [];
  const categories: { [key: string]: string[] } = {};
  const foundRoots = new Set<string>(); // Для отслеживания уникальных корней эмоций
  
  let emotionsToCheck: { [key: string]: string[] };
  
  if (emotionType === 'negative') {
    emotionsToCheck = NEGATIVE_EMOTIONS;
  } else if (emotionType === 'positive') {
    emotionsToCheck = POSITIVE_EMOTIONS;
  } else {
    emotionsToCheck = { ...NEGATIVE_EMOTIONS, ...POSITIVE_EMOTIONS };
  }
  
  // Проверяем каждое слово в тексте
  for (const word of words) {
    for (const [category, emotions] of Object.entries(emotionsToCheck)) {
      for (const emotion of emotions) {
        // Проверяем точное совпадение или если слово содержит эмоцию как корень
        if (word === emotion || (word.includes(emotion) && emotion.length > 3)) {
          const emotionRoot = getEmotionRoot(emotion);
          
          if (!foundRoots.has(emotionRoot)) {
            foundRoots.add(emotionRoot);
            foundEmotions.push(emotion);
            if (!categories[category]) {
              categories[category] = [];
            }
            categories[category].push(emotion);
          }
        }
      }
    }
  }
  
  return {
    count: foundRoots.size, // Используем размер Set для подсчета уникальных корней
    emotions: foundEmotions,
    categories
  };
}

// Функция для определения преобладающей категории негативных эмоций
export function getPredominantNegativeCategory(text: string): string | null {
  const result = countEmotions(text, 'negative');
  
  if (result.count === 0) return null;
  
  // Находим категорию с наибольшим количеством эмоций
  let maxCount = 0;
  let predominantCategory = null;
  
  for (const [category, emotions] of Object.entries(result.categories)) {
    if (emotions.length > maxCount) {
      maxCount = emotions.length;
      predominantCategory = category;
    }
  }
  
  return predominantCategory;
}

// Функция для получения сообщения помощи с эмоциями
export function getEmotionHelpMessage(emotions: string[], emotionType: 'negative' | 'positive'): string {
  const emotionCategories = emotionType === 'negative' ? NEGATIVE_EMOTIONS : POSITIVE_EMOTIONS;
  const foundCategories = new Set<string>();
  
  // Определяем какие категории упомянуты
  for (const emotion of emotions) {
    for (const [category, categoryEmotions] of Object.entries(emotionCategories)) {
      if (categoryEmotions.some(e => emotion.includes(e) || e.includes(emotion))) {
        foundCategories.add(category);
      }
    }
  }
  
  // Специальные случаи для негативных эмоций
  if (emotionType === 'negative') {
    // Если вообще не описал эмоции
    if (emotions.length === 0) {
      return '<i>Важно учиться называть свои эмоции 😒😍😫</i>\n\nДля начала подумай.. то, что ты описал больше про грусть, страх или злость (гнев)? И посмотри соответствующую колонку в таблице\nКакие эмоции ты ощутил?';
    }
    
    const categoriesArray = Array.from(foundCategories);
    
    // Проверяем специальные эмоции
    const hasGuilt = emotions.some(e => e.includes('вин') || e.includes('стыд'));
    const hasPain = emotions.some(e => e.includes('боль'));
    
    if (hasGuilt) {
      return 'Стыд и вина часто идут с другими эмоциями, посмотри колонку "страх" и "грусть" в таблице, что можешь дополнить?';
    }
    
    if (hasPain) {
      return 'Что за твоей болью? Давай попробуем посмотреть в таблице колонки "грусть" и "гнев", какие эмоции ты еще можешь назвать?';
    }
    
    // Обработка по категориям
    if (categoriesArray.length === 1) {
      const category = categoriesArray[0].toLowerCase();
      switch (category) {
        case 'грусть':
          return 'Посмотри колонку "грусть" в таблице эмоций и постарайся описать детальнее';
        case 'гнев':
          return 'Давай попробуем дополнить - посмотри колонку "гнев" в таблице, что еще можешь назвать?';
        case 'страх':
          return 'В таблице есть колонка "страх" - посмотри, какие еще эмоции могут описать твои переживания?';
      }
    } else if (categoriesArray.length >= 2) {
      const categoriesStr = categoriesArray.map(c => `"${c.toLowerCase()}"`).join(' и ');
      return `Ты можешь попробовать дополнить свой ответ, подсмотрев эмоции в колонках ${categoriesStr}`;
    }
  }
  
  // Для позитивных эмоций
  if (emotionType === 'positive') {
    if (emotions.length === 0) {
      return 'Давай опишем, что ты почувствовал ❤️‍🔥\nМожно подсмотреть эмоции в колонке "радость" и "любовь"';
    } else {
      return 'Давай расширим нашу палитру эмоций 🙃\nВ таблице найди слова, которые еще красочнее опишут то, что ты испытал <i>(смотри колонки "радость" и "любовь")</i>';
    }
  }
  
  return '';
}