import { extractJsonFromLLM } from './src/utils/extract-json-from-llm';

// Тестовый ответ похожий на то что генерирует DeepSeek
const testResponse = `<think>
Мы создаем JSON объект. Вот пример:
{
     "encouragement": { "text": "Алекс, твой труд вдохновляет! Не забывай про отдых 😌💪" },
     "negative_part": { "additional_text": null },
     "positive_part": { "additional_text": "Запиши 3 приятных момента дня" },
     "feels_and_emotions": { "additional_text": null }
}

Но нужно подкорректировать...
</think>

{
  "encouragement": { "text": "Алекс, каждый шаг важен! Двигаемся вперед 🚀" },
  "negative_part": { "additional_text": null },
  "positive_part": { "additional_text": "Вспомни минимум 3 хороших момента сегодня 🌟" },
  "feels_and_emotions": { "additional_text": "Какие эмоции удалось заметить сегодня?" },
  "deep_support": { "text": null }
}`;

console.log('🧪 Тестирование позиции JSON\n');
console.log('Входные данные:', testResponse.length, 'символов\n');

// Ищем все JSON в тексте
const allJsonMatches = testResponse.matchAll(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g);
let index = 0;
for (const match of allJsonMatches) {
  console.log(`\nJSON #${++index}:`);
  console.log('Позиция:', match.index);
  console.log('Длина:', match[0].length);
  console.log('Внутри think?', match.index! < testResponse.indexOf('</think>'));
  console.log('Содержимое:', match[0].substring(0, 100) + '...');
}

console.log('\n📋 Результат extractJsonFromLLM:');
const extracted = extractJsonFromLLM(testResponse);
console.log('Длина:', extracted.length);
console.log('Содержимое:', extracted.substring(0, 200) + (extracted.length > 200 ? '...' : ''));

try {
  const json = JSON.parse(extracted);
  console.log('\n✅ JSON валидный!');
  console.log('Поля:', Object.keys(json));
} catch (e) {
  console.log('\n❌ Ошибка парсинга:', e.message);
}