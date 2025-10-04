import { readFileSync } from 'fs';

// Тестируем полный ответ от LLM
async function testFullResponse() {
  const { InferenceClient } = await import('@huggingface/inference');
  const client = new InferenceClient(process.env.HF_TOKEN);
  
  console.log('🧪 Тестирование полного ответа от LLM\n');
  
  // Минимальный JSON промпт
  const prompt = `Ответь ТОЛЬКО валидным JSON объектом:
{
  "encouragement": { "text": "короткий текст поддержки" },
  "negative_part": { "additional_text": "текст про негатив или null" },
  "positive_part": { "additional_text": "текст про позитив или null" },
  "feels_and_emotions": { "additional_text": "текст про эмоции или null" }
}

ВАЖНО: НЕ используй теги <think>, НЕ пиши размышления. Только JSON!`;

  console.log('📝 Промпт:', prompt);
  console.log('\n🤖 Запрашиваю LLM...\n');
  
  const stream = client.chatCompletionStream({
    provider: 'novita',
    model: 'deepseek-ai/DeepSeek-R1-0528',
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
    parameters: {
      max_new_tokens: 500,
      temperature: 0.7,
      top_p: 0.9,
    },
  });

  let fullResponse = '';
  let chunkCount = 0;

  for await (const chunk of stream) {
    if (chunk.choices && chunk.choices[0]?.delta?.content) {
      const content = chunk.choices[0].delta.content;
      fullResponse += content;
      chunkCount++;
    }
  }

  console.log('📊 Статистика:');
  console.log('- Количество чанков:', chunkCount);
  console.log('- Длина ответа:', fullResponse.length);
  console.log('\n📝 Полный ответ:');
  console.log(fullResponse);
  console.log('\n' + '='.repeat(80) + '\n');
  
  // Проверяем наличие think тегов
  if (fullResponse.includes('<think>')) {
    console.log('⚠️ Модель проигнорировала инструкцию и использовала <think> теги!');
  }
  
  // Пробуем извлечь JSON
  const jsonMatch = fullResponse.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    console.log('📋 Извлеченный JSON:');
    console.log(jsonMatch[0]);
    
    try {
      const json = JSON.parse(jsonMatch[0]);
      console.log('\n✅ JSON валидный!');
      console.log('Структура:', Object.keys(json));
    } catch (e) {
      console.log('\n❌ Ошибка парсинга:', e.message);
    }
  }
}

testFullResponse().catch(console.error);