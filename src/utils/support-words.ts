import { generateMessage } from '../llm';
import { botLogger } from '../logger';
import { db } from '../db';

interface DayRatingSupportWords {
  rating1: string; // 😭
  rating2: string; // 😩
  rating3: string; // 🫤
  rating4: string; // 😊
  rating5: string; // 🤩
}

// Функция для удаления технических пометок
function cleanSupportText(text: string): string {
  let cleaned = text.trim();
  // Удаляем теги think если есть
  const lastThinkClose = cleaned.lastIndexOf('</think>');
  if (lastThinkClose !== -1 && cleaned.trim().startsWith('<think>')) {
    cleaned = cleaned.substring(lastThinkClose + 8).trim();
  }
  // Удаляем любые технические пометки в скобках
  cleaned = cleaned.replace(/\s*\([^)]*символ[^)]*\)/gi, '');
  cleaned = cleaned.replace(/\s*\(\d+[^)]*\)/g, '');
  cleaned = cleaned.replace(/\s*\([^)]*\)/g, '');
  // Удаляем кавычки в начале и конце
  cleaned = cleaned.replace(/^["']|["']$/g, '').trim();
  return cleaned;
}

// Генерация слов поддержки для всех оценок
export async function generateDayRatingSupportWords(): Promise<DayRatingSupportWords> {
  const supportWords: DayRatingSupportWords = getDefaultSupportWords();

  // Промпты для каждой оценки
  const prompts = {
    rating1: `Человек оценил свой день как ужасный (😭). Напиши 1-2 теплых фразы (до 100 символов вместе) с эмодзи. Подведи итог дня и поддержи. Будь человечным и искренним.

Примеры:
- Сложный день позади. Обнимаю крепко 🫂
- Сегодня было тяжело. Я с тобой 💚
- Непростой день. Завтра будет лучше 🌱
- Трудный день. Держись, ты справишься 🤗

Напиши 1-2 фразы, не повторяя примеры. Без кавычек, скобок, технической информации. Ты - лягушка мужского рода, используй соответствующие окончания глаголов.`,
    
    rating2: `Человек оценил свой день как плохой (😩). Напиши 1-2 теплых фразы (до 100 символов вместе) с эмодзи. Подведи итог дня и подбодри.

Примеры:
- Сегодня было тяжело. Завтра будет лучше 💚
- Непростой день позади. Ты справился 🌿
- День не задался. Все наладится 🌸
- Трудный день. Верю в тебя 💪

Напиши 1-2 фразы, не повторяя примеры. Без кавычек, скобок, технической информации. Ты - лягушка мужского рода, используй соответствующие окончания глаголов.`,
    
    rating3: `Человек оценил свой день как нейтральный (🫤). Напиши короткую теплую фразу (до 50 символов) с эмодзи.

Примеры:
- И такие дни нужны 🌿
- Все в порядке 🤍
- Отдохни сегодня 🌙
- Ты молодец 💛

Напиши ОДНУ фразу, не повторяя примеры. Без кавычек, скобок, технической информации.`,
    
    rating4: `Человек оценил свой день как хороший (😊). Напиши короткую теплую фразу радости (до 50 символов) с эмодзи.

Примеры:
- Рад за тебя 🌸
- Так держать! 🌟
- Ты молодец 💚
- Супер день! 🎉

Напиши ОДНУ фразу, не повторяя примеры. Без кавычек, скобок, технической информации.`,
    
    rating5: `Человек оценил свой день как отличный (🤩). Напиши короткую восторженную фразу (до 50 символов) с эмодзи.

Примеры:
- Ты сияешь! ✨
- Вау, супер! 🎉
- Космос! 🚀
- Восхитительно! 💫

Напиши ОДНУ фразу, не повторяя примеры. Без кавычек, скобок, технической информации.`
  };

  // Генерируем для каждой оценки
  const defaults = getDefaultSupportWords();
  for (const [key, prompt] of Object.entries(prompts)) {
    try {
      const generated = await generateMessage(prompt);
      if (generated !== 'HF_JSON_ERROR') {
        const cleaned = cleanSupportText(generated);
        if (cleaned.length > 0 && cleaned.length <= 100) { // лимит 100 символов как просили
          supportWords[key as keyof DayRatingSupportWords] = cleaned;
        } else {
          // Если текст пустой или слишком длинный, используем дефолт
          botLogger.warn({ key, cleanedLength: cleaned.length }, 'Сгенерированный текст не подходит, используем дефолт');
          supportWords[key as keyof DayRatingSupportWords] = defaults[key as keyof DayRatingSupportWords];
        }
      } else {
        // Если LLM вернул ошибку, используем дефолт
        botLogger.warn({ key }, 'LLM вернул ошибку, используем дефолт');
        supportWords[key as keyof DayRatingSupportWords] = defaults[key as keyof DayRatingSupportWords];
      }
    } catch (error) {
      botLogger.error({ error, rating: key }, 'Ошибка генерации слов поддержки для оценки дня');
      // В случае ошибки используем дефолт
      supportWords[key as keyof DayRatingSupportWords] = defaults[key as keyof DayRatingSupportWords];
    }
  }

  return supportWords;
}

// Обновленные дефолты для 1-2 фраз
export function getDefaultSupportWords(): DayRatingSupportWords {
  return {
    rating1: 'Сложный день позади. Обнимаю крепко 🤗',
    rating2: 'Сегодня было тяжело. Завтра будет лучше 💚', 
    rating3: 'Обычный день. И такие дни нужны 🌿',
    rating4: 'Хороший день! Рад за тебя 🌸',
    rating5: 'Супер день! Ты сияешь ✨'
  };
}

// Получение слов поддержки для конкретной оценки
export async function getDayRatingSupportWord(channelMessageId: number, rating: number): Promise<string> {
  try {
    const query = db.query(`
      SELECT message_data FROM interactive_posts WHERE channel_message_id = ?
    `);
    const post = query.get(channelMessageId) as any;
    
    if (post?.message_data) {
      const messageData = JSON.parse(post.message_data);
      const supportWords = messageData.day_rating_support;
      
      if (supportWords) {
        const key = `rating${rating}` as keyof DayRatingSupportWords;
        return supportWords[key] || getDefaultSupportWord(rating);
      }
    }
  } catch (error) {
    botLogger.error({ error, channelMessageId, rating }, 'Ошибка получения слов поддержки');
  }
  
  return getDefaultSupportWord(rating);
}

// Получение слов поддержки для конкретной оценки
function getDefaultSupportWord(rating: number): string {
  const defaults = getDefaultSupportWords();
  const key = `rating${rating}` as keyof DayRatingSupportWords;
  return defaults[key] || 'Спасибо за оценку 💚';
}