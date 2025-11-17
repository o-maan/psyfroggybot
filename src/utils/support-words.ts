import { readFile } from 'fs/promises';
import { generateMessage } from '../llm';
import { botLogger } from '../logger';
import { db } from '../db';
import { cleanLLMText } from './clean-llm-text';

interface DayRatingSupportWords {
  rating1: string; // 😩
  rating2: string; // 😔
  rating3: string; // 😐
  rating4: string; // 😊
  rating5: string; // 🤩
}


// Генерация слов поддержки для всех оценок ОДНИМ запросом
export async function generateDayRatingSupportWords(): Promise<DayRatingSupportWords> {
  const defaults = getDefaultSupportWords();

  try {
    // Загружаем промпт из файла
    const { readFileSync } = await import('fs');
    const prompt = await readFile('assets/prompts/day-rating-support-words.md', 'utf-8');

    // Делаем ОДИН запрос к LLM для генерации всех 5 вариантов
    const response = await generateMessage(prompt);

    if (response === 'HF_JSON_ERROR') {
      botLogger.warn('LLM вернул ошибку для слов поддержки, используем дефолты');
      return defaults;
    }

    // Извлекаем JSON из ответа
    const { extractJsonFromLLM } = await import('./extract-json-from-llm');
    const jsonText = extractJsonFromLLM(response);

    // Парсим JSON
    const parsed = JSON.parse(jsonText);

    // Валидируем и очищаем каждое поле
    const supportWords: DayRatingSupportWords = { ...defaults };

    for (const key of ['rating1', 'rating2', 'rating3', 'rating4', 'rating5']) {
      if (parsed[key] && typeof parsed[key] === 'string') {
        const cleaned = cleanLLMText(parsed[key]);
        const maxLength = key === 'rating1' || key === 'rating2' ? 100 : 50;

        if (cleaned.length > 0 && cleaned.length <= maxLength) {
          supportWords[key as keyof DayRatingSupportWords] = cleaned;
        } else {
          botLogger.warn({ key, length: cleaned.length, maxLength }, 'Слово поддержки не подходит по длине, используем дефолт');
        }
      }
    }

    return supportWords;
  } catch (error) {
    botLogger.error({ error }, 'Ошибка генерации слов поддержки, используем дефолты');
    return defaults;
  }
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