import { Telegraf } from 'telegraf';
import { InlineQueryResultCachedPhoto } from 'telegraf/types';
import { logger } from '../../logger';
import { getAllFrogImages } from '../../db';

export function registerInlineHandlers(bot: Telegraf): void {
  // Обработчик inline запросов
  bot.on('inline_query', async ctx => {
    try {
      const query = ctx.inlineQuery.query.toLowerCase();

      logger.info(
        {
          query,
          userId: ctx.from.id,
          username: ctx.from.username,
        },
        'Получен inline запрос'
      );

      // Получаем картинки лягушек из базы данных
      const frogImages = getAllFrogImages();

      if (frogImages.length === 0) {
        logger.warn('Нет картинок лягушек в базе данных');
        await ctx.answerInlineQuery([], {
          button: {
            text: '🐸 Картинки не найдены',
            start_parameter: 'no_frogs',
          },
        });
        return;
      }

      // Создаем массив результатов из картинок в базе
      const results: InlineQueryResultCachedPhoto[] = frogImages.map((image) => ({
        type: 'photo',
        id: `frog_${image.id}`,
        photo_file_id: image.file_id,
        title: image.title,
        description: image.description,
        caption: image.title
      }));

      // Фильтруем результаты по запросу (если он не пустой)
      // Если запрос пустой - показываем все картинки
      const filteredResults = query
        ? results.filter(r => r.title?.toLowerCase().includes(query) || r.description?.toLowerCase().includes(query))
        : results;

      // Отправляем результаты
      await ctx.answerInlineQuery(filteredResults, {
        cache_time: 1, // Кэшируем на 5 минут
        is_personal: false, // Результаты одинаковые для всех
        button: {
          text: '🐸 Психологические лягушки',
          start_parameter: 'frog_support',
        },
      });

      logger.info(
        {
          resultsCount: filteredResults.length,
          query,
          totalImages: frogImages.length,
        },
        'Inline запрос обработан'
      );
    } catch (error) {
      logger.error({ error }, 'Ошибка при обработке inline запроса');
      // Отправляем пустой результат в случае ошибки
      await ctx.answerInlineQuery([]);
    }
  });

  logger.info('Обработчики inline запросов зарегистрированы');
}
