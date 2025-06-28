import { InferenceClient } from '@huggingface/inference';
import { llmLogger } from './logger';

const client = new InferenceClient(process.env.HF_TOKEN);

// Примеры текстов для генерации
const examples = [
  'Привет! Как твой день?',
  'Сегодня отличная погода для прогулки!',
  'Не забудь выпить воды!',
  'Время для небольшого перерыва!',
  'Как твои дела?',
  'Надеюсь, у тебя хороший день!',
  'Не забудь улыбнуться!',
  'Время для чашечки чая!',
  'Как прошёл твой день?',
  'Надеюсь, ты хорошо отдохнул!',
];

export async function generateMessage(prompt?: string): Promise<string> {
  const startTime = Date.now();
  try {
    const model = 'deepseek-ai/DeepSeek-R1-0528';
    llmLogger.info({ model, promptLength: prompt?.length || 0 }, `🤖 Начало генерации LLM`);

    const stream = client.chatCompletionStream({
      provider: 'novita',
      model: 'deepseek-ai/DeepSeek-R1-0528', // очень долгая, 685B params
      // model: 'Qwen/Qwen3-235B-A22B', // долгая
      // model: 'Qwen/Qwen2.5-7B-Instruct-1M',

      messages: [
        {
          role: 'user',
          content: `${prompt || ''}\n\n Примеры поддержки: ${examples.join('\n')}`,
        },
      ],
      parameters: {
        max_new_tokens: 500,
        temperature: 0.7,
        top_p: 0.9,
      },
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
          llmLogger.debug({ chunkCount, totalLength: fullMessage.length }, `🔄 Получен чанк ${chunkCount}`);
        }
      }
    }

    const duration = Date.now() - startTime;
    llmLogger.info(
      { chunkCount, finalLength: fullMessage.length, duration },
      `✅ LLM генерация завершена за ${duration}ms`
    );

    // Очищаем и форматируем результат
    let message = fullMessage
      .replace(/\n/g, ' ')
      // <think>...</think> - убираем размышления модели
      .replace(/<think>(.*?)<\/think>/gm, '')
      .trim();

    // Если сообщение слишком короткое, используем fallback
    if (message.length < 10) {
      llmLogger.error({ model, messageLength: message.length }, 'Сообщение слишком короткое');
      return 'HF_JSON_ERROR';
    }

    return message;
  } catch (e) {
    const error = e as Error;
    llmLogger.error(
      {
        error: error.message,
        stack: error.stack,
        model: 'deepseek-ai/DeepSeek-R1-0528',
      },
      'Ошибка LLM генерации'
    );
    return 'HF_JSON_ERROR';
  }
}

// Минимальный тестовый запрос с использованием стриминга
export async function minimalTestLLM() {
  const startTime = Date.now();
  const model = 'Qwen/Qwen3-235B-A22B';

  try {
    llmLogger.info({ model, promptLength: 33 }, '🤖 Начало минимального теста LLM');

    const stream = client.chatCompletionStream({
      provider: 'novita', // Используем тот же провайдер
      model,
      messages: [
        {
          role: 'user',
          content: 'What is the capital of France?',
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

    const duration = Date.now() - startTime;
    llmLogger.info(
      { chunkCount, finalLength: fullResponse.length, duration },
      `✅ Минимальный тест завершен за ${duration}ms`
    );

    return fullResponse.trim();
  } catch (e) {
    const error = e as Error;
    llmLogger.error({ error: error.message, stack: error.stack, model }, 'Ошибка минимального теста LLM');
    return null;
  }
}
