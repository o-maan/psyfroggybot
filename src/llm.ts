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
    console.log('🔍 GENERATING MESSAGE - Prompt:', prompt);
    const result = await client.chatCompletion({
      provider: "hf-inference",
      model: 'Qwen/Qwen3-235B-A22B', // долгая
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

    // Очищаем и форматируем результат
    let message = (result.choices[0].message.content || '')
      .replace(/\n/g, ' ')
      // <think>...</think>
      .replace(/<think>(.*?)<\/think>/gm, '')
      .trim();

    console.log('🔍 Generated message:', { message });

    // Если сообщение слишком короткое, используем случайный пример
    if (message.length < 10) {
      // fallback
      return 'HF_JSON_ERROR';
    }

    return message;
  } catch (error) {
    // fallback
    console.error('Ошибка при генерации сообщения:', error);
    // В случае ошибки возвращаем специальную строку
    return 'HF_JSON_ERROR';
  }
}

// Минимальный тестовый запрос к самой простой LLM (gpt2)
export async function minimalTestLLM() {
  try {
    const chatCompletion = await client.chatCompletion({
      provider: "hf-inference",
      model: "Qwen/Qwen3-235B-A22B",
      messages: [
        {
          role: "user",
          content: "What is the capital of France?",
        },
      ],
    });

    console.log('Минимальный ответ LLM:', chatCompletion.choices[0].message.content);
    return chatCompletion.choices[0].message.content;
  } catch (error) {
    console.error('Ошибка минимального запроса к LLM:', error);
    return null;
  }
} 