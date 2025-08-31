import { Telegraf } from 'telegraf';
import { InlineQueryResultPhoto } from 'telegraf/types';
import { logger } from '../../logger';

// Временный массив с URL изображений фильтров восприятия
// TODO: Заменить на реальные изображения из указанной папки
const FILTER_IMAGES = [
  // Заглушки - нужно заменить на реальные URL изображений
  { url: 'https://via.placeholder.com/300x400/FF6B6B/FFFFFF?text=Фильтр+1', thumb: 'https://via.placeholder.com/150x200/FF6B6B/FFFFFF?text=1' },
  { url: 'https://via.placeholder.com/300x400/4ECDC4/FFFFFF?text=Фильтр+2', thumb: 'https://via.placeholder.com/150x200/4ECDC4/FFFFFF?text=2' },
  { url: 'https://via.placeholder.com/300x400/45B7D1/FFFFFF?text=Фильтр+3', thumb: 'https://via.placeholder.com/150x200/45B7D1/FFFFFF?text=3' },
  { url: 'https://via.placeholder.com/300x400/96CEB4/FFFFFF?text=Фильтр+4', thumb: 'https://via.placeholder.com/150x200/96CEB4/FFFFFF?text=4' },
  { url: 'https://via.placeholder.com/300x400/FECA57/FFFFFF?text=Фильтр+5', thumb: 'https://via.placeholder.com/150x200/FECA57/FFFFFF?text=5' },
  { url: 'https://via.placeholder.com/300x400/F38181/FFFFFF?text=Фильтр+6', thumb: 'https://via.placeholder.com/150x200/F38181/FFFFFF?text=6' },
  { url: 'https://via.placeholder.com/300x400/AA96DA/FFFFFF?text=Фильтр+7', thumb: 'https://via.placeholder.com/150x200/AA96DA/FFFFFF?text=7' },
  { url: 'https://via.placeholder.com/300x400/95E1D3/FFFFFF?text=Фильтр+8', thumb: 'https://via.placeholder.com/150x200/95E1D3/FFFFFF?text=8' },
  { url: 'https://via.placeholder.com/300x400/F6D5A8/FFFFFF?text=Фильтр+9', thumb: 'https://via.placeholder.com/150x200/F6D5A8/FFFFFF?text=9' },
  { url: 'https://via.placeholder.com/300x400/FFC947/FFFFFF?text=Фильтр+10', thumb: 'https://via.placeholder.com/150x200/FFC947/FFFFFF?text=10' },
  { url: 'https://via.placeholder.com/300x400/74B9FF/FFFFFF?text=Фильтр+11', thumb: 'https://via.placeholder.com/150x200/74B9FF/FFFFFF?text=11' },
  { url: 'https://via.placeholder.com/300x400/A29BFE/FFFFFF?text=Фильтр+12', thumb: 'https://via.placeholder.com/150x200/A29BFE/FFFFFF?text=12' },
  { url: 'https://via.placeholder.com/300x400/FD79A8/FFFFFF?text=Фильтр+13', thumb: 'https://via.placeholder.com/150x200/FD79A8/FFFFFF?text=13' },
  { url: 'https://via.placeholder.com/300x400/FDCB6E/FFFFFF?text=Фильтр+14', thumb: 'https://via.placeholder.com/150x200/FDCB6E/FFFFFF?text=14' },
  { url: 'https://via.placeholder.com/300x400/6C5CE7/FFFFFF?text=Фильтр+15', thumb: 'https://via.placeholder.com/150x200/6C5CE7/FFFFFF?text=15' },
];

const FILTER_NAMES = [
  'Долженствование',
  'Катастрофизация', 
  'Предсказание будущего',
  'Чтение мыслей',
  'Сверхобобщение',
  'Навешивание ярлыков',
  'Обесценивание позитивного',
  'Персонализация',
  'Черно-белое мышление',
  'Эмоциональное обоснование',
  'Поспешные выводы',
  'Ментальный фильтр',
  'Увеличение/Преуменьшение',
  'Туннельное зрение',
  'Винить других',
];

export function registerInlineHandlers(bot: Telegraf): void {
  // Обработчик inline запросов
  bot.on('inline_query', async (ctx) => {
    try {
      const query = ctx.inlineQuery.query.toLowerCase();
      
      logger.info({ 
        query, 
        userId: ctx.from.id,
        username: ctx.from.username 
      }, 'Получен inline запрос');

      // Создаем массив результатов - сетка 3x5
      const results: InlineQueryResultPhoto[] = FILTER_IMAGES.map((image, index) => ({
        type: 'photo',
        id: `filter_${index + 1}`,
        photo_url: image.url,
        thumbnail_url: image.thumb,
        title: FILTER_NAMES[index] || `Фильтр ${index + 1}`,
        description: `Когнитивное искажение №${index + 1}`,
        photo_width: 300,
        photo_height: 400,
        // Можно добавить кнопки под каждой картинкой
        reply_markup: {
          inline_keyboard: [[
            { 
              text: '📖 Подробнее', 
              callback_data: `filter_info_${index + 1}` 
            }
          ]]
        }
      }));

      // Фильтруем результаты по запросу (если он не пустой)
      const filteredResults = query 
        ? results.filter(r => 
            r.title?.toLowerCase().includes(query) || 
            r.description?.toLowerCase().includes(query)
          )
        : results;

      // Отправляем результаты
      await ctx.answerInlineQuery(
        filteredResults,
        {
          cache_time: 300, // Кэшируем на 5 минут
          is_personal: false, // Результаты одинаковые для всех
          button: {
            text: '🔍 Помощь по фильтрам',
            start_parameter: 'filters_help'
          }
        }
      );

      logger.info({ 
        resultsCount: filteredResults.length,
        query 
      }, 'Inline запрос обработан');

    } catch (error) {
      logger.error({ error }, 'Ошибка при обработке inline запроса');
      // Отправляем пустой результат в случае ошибки
      await ctx.answerInlineQuery([]);
    }
  });

  // Обработчик для кнопок "Подробнее" под картинками
  bot.action(/^filter_info_(\d+)$/, async (ctx) => {
    const filterIndex = parseInt(ctx.match[1]) - 1;
    const filterName = FILTER_NAMES[filterIndex] || `Фильтр ${filterIndex + 1}`;
    
    await ctx.answerCbQuery(
      `ℹ️ ${filterName} - это когнитивное искажение, которое влияет на наше восприятие реальности.`,
      { show_alert: true }
    );
  });

  logger.info('Обработчики inline запросов зарегистрированы');
}