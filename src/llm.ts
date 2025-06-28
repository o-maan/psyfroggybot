import { InferenceClient } from '@huggingface/inference';
import fs from 'fs';
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

// Генерация контекстуального ответа на сообщение пользователя
export async function generateUserResponse(userMessage: string, lastBotMessage?: string, calendarEvents?: string): Promise<string> {
  const startTime = Date.now();
  try {
    // Загружаем промпт для анализа ответов пользователя
    const promptPath = './assets/prompts/user-response.md';
    const userResponsePrompt = fs.readFileSync(promptPath, 'utf-8');
    
    const model = 'deepseek-ai/DeepSeek-R1-0528';
    llmLogger.info({ model, userMessageLength: userMessage.length }, '🤖 Начало генерации ответа пользователю');

    // Формируем контекст
    let contextMessage = userResponsePrompt + '\n\n';
    
    if (lastBotMessage) {
      contextMessage += `**Последнее сообщение от бота:**\n${lastBotMessage}\n\n`;
    }
    
    if (calendarEvents) {
      contextMessage += `**События календаря на сегодня:**\n${calendarEvents}\n\n`;
    }
    
    contextMessage += `**Ответ пользователя:**\n${userMessage}\n\n`;
    contextMessage += 'Дай краткий, теплый и поддерживающий ответ (до 300 символов):';

    const stream = client.chatCompletionStream({
      provider: 'novita',
      model,
      messages: [
        {
          role: 'user',
          content: contextMessage,
        },
      ],
      parameters: {
        max_new_tokens: 200,
        temperature: 0.8,
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

        if (chunkCount % 5 === 0) {
          llmLogger.debug({ chunkCount, totalLength: fullResponse.length }, '🔄 Получен чанк ответа пользователю');
        }
      }
    }

    const duration = Date.now() - startTime;
    llmLogger.info(
      { chunkCount, finalLength: fullResponse.length, duration },
      `✅ Генерация ответа пользователю завершена за ${duration}ms`
    );

    // Очищаем и форматируем результат
    let response = fullResponse
      .replace(/\n/g, ' ')
      .replace(/<think>(.*?)<\/think>/gm, '')
      .trim();

    // Ограничиваем длину ответа
    if (response.length > 300) {
      response = response.substring(0, 297) + '...';
    }

    // Если ответ слишком короткий, используем fallback
    if (response.length < 5) {
      llmLogger.error({ model, responseLength: response.length }, 'Ответ пользователю слишком короткий');
      return 'Спасибо, что поделился! 🤍';
    }

    return response;
  } catch (e) {
    const error = e as Error;
    llmLogger.error(
      {
        error: error.message,
        stack: error.stack,
        model: 'deepseek-ai/DeepSeek-R1-0528',
      },
      'Ошибка генерации ответа пользователю'
    );
    
    // Fallback ответ при ошибке
    return 'Спасибо, что поделился! 🤍';
  }
}

// Генерация изображения лягушки на основе промпта
export async function generateFrogImage(prompt: string): Promise<Buffer | null> {
  const startTime = Date.now();
  try {
    const model = 'black-forest-labs/FLUX.1-dev';
    llmLogger.info({ model, promptLength: prompt.length, prompt }, `🎨 Начало генерации изображения лягушки с промптом: "${prompt}"`);

    const response = await client.textToImage({
      model,
      inputs: prompt,
      parameters: {
        width: 512,
        height: 512,
        guidance_scale: 7.5,
        num_inference_steps: 20,
      },
    });

    const duration = Date.now() - startTime;
    
    // Обрабатываем различные типы ответа
    let buffer: Buffer;
    
    try {
      if (response && typeof response === 'object' && 'arrayBuffer' in response) {
        const arrayBuffer = await (response as any).arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
      } else if (Buffer.isBuffer(response)) {
        buffer = response;
      } else {
        // Пытаемся обработать как ArrayBuffer или другой тип
        buffer = Buffer.from(response as any);
      }
      
      llmLogger.info(
        { duration, imageSize: buffer.length },
        `✅ Изображение лягушки сгенерировано за ${duration}ms`
      );
      return buffer;
    } catch (conversionError) {
      llmLogger.error({ 
        model, 
        responseType: typeof response,
        conversionError: (conversionError as Error).message 
      }, 'Ошибка конвертации ответа модели изображений');
      return null;
    }
  } catch (e) {
    const error = e as Error;
    llmLogger.error(
      {
        error: error.message,
        stack: error.stack,
        model: 'black-forest-labs/FLUX.1-dev',
      },
      'Ошибка генерации изображения лягушки'
    );
    return null;
  }
}

// Генерация промпта для изображения лягушки на основе пользовательского ответа и календаря
export async function generateFrogPrompt(userMessage: string, calendarEvents?: string, lastBotMessage?: string): Promise<string> {
  const startTime = Date.now();
  try {
    // Загружаем промпт для генерации описания лягушки
    const promptPath = './assets/prompts/frog-image-prompt.md';
    const frogPromptTemplate = fs.readFileSync(promptPath, 'utf-8');
    
    const model = 'deepseek-ai/DeepSeek-R1-0528';
    llmLogger.info({ model, userMessageLength: userMessage.length }, '🎨 Начало генерации промпта для лягушки');

    // Формируем контекст
    let contextMessage = frogPromptTemplate + '\n\n';
    
    // Добавляем текущую дату для контекста
    const today = new Date();
    const dateString = today.toLocaleDateString('ru-RU', {
      weekday: 'long',
      year: 'numeric', 
      month: 'long',
      day: 'numeric'
    });
    contextMessage += `**Сегодня:** ${dateString}\n\n`;
    
    if (lastBotMessage) {
      contextMessage += `**Последнее сообщение от бота:**\n${lastBotMessage}\n\n`;
    }
    
    contextMessage += `**Ответ пользователя:**\n${userMessage}\n\n`;
    
    if (calendarEvents) {
      contextMessage += `**События календаря на сегодня:**\n${calendarEvents}\n\n`;
    }
    
    contextMessage += 'Создай промпт для изображения лягушки (на английском, до 200 символов):';

    const stream = client.chatCompletionStream({
      provider: 'novita',
      model,
      messages: [
        {
          role: 'user',
          content: contextMessage,
        },
      ],
      parameters: {
        max_new_tokens: 100,
        temperature: 0.9,
        top_p: 0.95,
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

    const duration = Date.now() - startTime;
    llmLogger.info(
      { chunkCount, finalLength: fullResponse.length, duration },
      `✅ Промпт для лягушки сгенерирован за ${duration}ms`
    );

    // Очищаем и форматируем результат
    let prompt = fullResponse
      .replace(/\n/g, ' ')
      .replace(/<think>(.*?)<\/think>/gm, '')
      .replace(/"/g, '')
      .trim();

    // Ограничиваем длину промпта
    if (prompt.length > 200) {
      prompt = prompt.substring(0, 197) + '...';
    }

    // Если промпт слишком короткий, используем fallback
    if (prompt.length < 10) {
      llmLogger.error({ model, promptLength: prompt.length }, 'Промпт для лягушки слишком короткий');
      return 'anthropomorphic frog portrait, friendly psychologist, warm smile, soft lighting, digital art, looking at viewer';
    }

    return prompt;
  } catch (e) {
    const error = e as Error;
    llmLogger.error(
      {
        error: error.message,
        stack: error.stack,
        model: 'deepseek-ai/DeepSeek-R1-0528',
      },
      'Ошибка генерации промпта для лягушки'
    );
    
    // Fallback промпт при ошибке
    return 'anthropomorphic frog portrait, friendly psychologist, warm smile, soft lighting, digital art, looking at viewer';
  }
}
