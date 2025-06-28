import { InferenceClient } from "@huggingface/inference";

const client = new InferenceClient(process.env.HF_TOKEN);


// Примеры текстов для генерации
const examples = [
  "Привет! Как твой день?",
  "Сегодня отличная погода для прогулки!",
  "Не забудь выпить воды!",
  "Время для небольшого перерыва!",
  "Как твои дела?",
  "Надеюсь, у тебя хороший день!",
  "Не забудь улыбнуться!",
  "Время для чашечки чая!",
  "Как прошёл твой день?",
  "Надеюсь, ты хорошо отдохнул!"
];


export async function generateMessage(prompt?: string): Promise<string> {
  try {
    console.log('🔍 GENERATING MESSAGE STREAM - Prompt:', prompt);
    
    const stream = client.chatCompletionStream({
      provider: "novita",
      model: 'deepseek-ai/DeepSeek-R1-0528', // очень долгая, 685B params
      // model: 'Qwen/Qwen3-235B-A22B', // долгая
      // model: 'Qwen/Qwen2.5-7B-Instruct-1M',

      messages: [
        {
          role: "user",
          content: `${prompt || ''}\n\n Примеры поддержки: ${examples.join('\n')}`,
        },
      ],
      parameters: {
        max_new_tokens: 500,
        temperature: 0.7,
        top_p: 0.9,
      }
    });

    let fullMessage = '';
    let chunkCount = 0;
    
    // Собираем все чанки в полное сообщение
    for await (const chunk of stream) {
      if (chunk.choices && chunk.choices[0]?.delta?.content) {
        const content = chunk.choices[0].delta.content;
        fullMessage += content;
        chunkCount++;
        
        // Логируем прогресс каждые 10 чанков
        if (chunkCount % 10 === 0) {
          console.log(`🔄 Получено ${chunkCount} чанков, длина: ${fullMessage.length} символов`);
        }
      }
    }

    console.log(`✅ Стриминг завершен: ${chunkCount} чанков, итого ${fullMessage.length} символов`);

    // Очищаем и форматируем результат
    let message = fullMessage
      .replace(/\n/g, ' ')
      // <think>...</think> - убираем размышления модели
      .replace(/<think>(.*?)<\/think>/gm, '')
      .trim();

    console.log('🔍 Generated message after cleanup:', { 
      originalLength: fullMessage.length, 
      cleanedLength: message.length,
      message: message.substring(0, 200) + (message.length > 200 ? '...' : '')
    });

    // Если сообщение слишком короткое, используем fallback
    if (message.length < 10) {
      console.warn('⚠️ Сообщение слишком короткое, используем fallback');
      return 'HF_JSON_ERROR';
    }

    return message;
  } catch (error) {
    // fallback
    console.error('❌ Ошибка при генерации сообщения через стриминг:', error);
    // В случае ошибки возвращаем специальную строку
    return 'HF_JSON_ERROR';
  }
}

// Минимальный тестовый запрос с использованием стриминга
export async function minimalTestLLM() {
  try {
    console.log('🔍 MINIMAL TEST LLM STREAM - Starting...');
    
    const stream = client.chatCompletionStream({
      provider: "novita", // Используем тот же провайдер
      model: "Qwen/Qwen3-235B-A22B",
      messages: [
        {
          role: "user",
          content: "What is the capital of France?",
        },
      ],
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

    console.log(`✅ Минимальный тест завершен: ${chunkCount} чанков`);
    console.log('🔍 Минимальный ответ LLM:', fullResponse);
    
    return fullResponse.trim();
  } catch (error) {
    console.error('❌ Ошибка минимального запроса к LLM через стриминг:', error);
    return null;
  }
} 
