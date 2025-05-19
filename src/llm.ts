import { HfInference } from '@huggingface/inference';

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

const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);

export async function generateMessage(): Promise<string> {
  try {
    // Используем модель для генерации текста
    const result = await hf.textGeneration({
      model: 'gpt2',
      inputs: examples.join('\n'),
      parameters: {
        max_length: 50,
        temperature: 0.7,
        top_p: 0.9,
      }
    });

    // Очищаем и форматируем результат
    let message = result.generated_text
      .replace(/\n/g, ' ')
      .trim();

    // Если сообщение слишком короткое, используем случайный пример
    if (message.length < 10) {
      message = examples[Math.floor(Math.random() * examples.length)];
    }

    return message;
  } catch (error) {
    console.error('Ошибка при генерации сообщения:', error);
    // В случае ошибки возвращаем случайный пример
    return examples[Math.floor(Math.random() * examples.length)];
  }
} 