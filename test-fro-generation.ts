import { generateMessage } from './src/llm';
import { readFileSync } from 'fs';

async function testFroGeneration() {
  console.log('🧪 Тестирование генерации интерактивного сообщения\n');
  
  // Загружаем промпт как в scheduler.ts
  const promptBase = readFileSync('assets/prompts/scheduled-message.md', 'utf-8');
  
  // Заменяем переменные
  let prompt = promptBase
    .replace(/\{userName\}/g, 'Алекс')
    .replace(/\{userGender\}/g, 'male');
    
  // Добавляем дату
  const now = new Date();
  const dateTimeStr = now.toLocaleDateString('ru-RU', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  
  prompt += `\n\nСегодня: ${dateTimeStr}.`;
  
  console.log('📝 Промпт подготовлен, запрашиваю LLM...\n');
  
  const result = await generateMessage(prompt);
  
  console.log('🤖 Результат от LLM:');
  console.log('Длина:', result.length);
  console.log('Содержимое:', result.substring(0, 500) + (result.length > 500 ? '...' : ''));
  
  if (result === 'HF_JSON_ERROR') {
    console.log('\n❌ Получена ошибка HF_JSON_ERROR');
  } else {
    try {
      const json = JSON.parse(result);
      console.log('\n✅ JSON успешно распарсен:');
      console.log('encouragement.text:', json.encouragement?.text || 'НЕТ');
      console.log('negative_part.additional_text:', json.negative_part?.additional_text || 'null');
      console.log('positive_part.additional_text:', json.positive_part?.additional_text || 'null');
      console.log('feels_and_emotions.additional_text:', json.feels_and_emotions?.additional_text || 'null');
      
      // Проверка на "..."
      if (json.encouragement?.text === '...' || 
          json.negative_part?.additional_text === '...' ||
          json.positive_part?.additional_text === '...' ||
          json.feels_and_emotions?.additional_text === '...') {
        console.log('\n⚠️ ПРЕДУПРЕЖДЕНИЕ: Модель вернула "..." вместо реального текста!');
      }
    } catch (e) {
      console.log('\n❌ Ошибка парсинга JSON:', e.message);
    }
  }
}

testFroGeneration().catch(console.error);