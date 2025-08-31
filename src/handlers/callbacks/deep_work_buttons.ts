import type { BotContext } from '../../types';
import { Telegraf } from 'telegraf';
import { botLogger } from '../../logger';
import { DeepWorkHandler } from '../../deep-work-handler';

// Храним экземпляры обработчиков для каждого чата/треда
const deepWorkHandlers = new Map<string, DeepWorkHandler>();

export function getDeepWorkHandler(bot: Telegraf, chatId: number): DeepWorkHandler {
  if (!deepWorkHandlers.has(`${chatId}`)) {
    deepWorkHandlers.set(`${chatId}`, new DeepWorkHandler(bot, chatId));
  }
  return deepWorkHandlers.get(`${chatId}`)!;
}

// Обработчик выбора ситуации
export async function handleDeepSituationChoice(ctx: BotContext, bot: Telegraf) {
  try {
    const match = ctx.match![0].split('_');
    const channelMessageId = parseInt(match[2]);
    const situationIndex = parseInt(match[3]);
    const userId = ctx.from?.id;

    await ctx.answerCbQuery('✅ Ситуация выбрана');

    botLogger.info({
      action: 'deep_situation_choice',
      channelMessageId,
      situationIndex,
      userId
    }, 'Выбрана ситуация для разбора');

    const chatId = ctx.callbackQuery.message?.chat?.id!;
    const handler = getDeepWorkHandler(bot, chatId);
    
    // Пока используем фильтры восприятия по умолчанию
    // TODO: сохранять выбранную ситуацию и определять технику
    const messageId = ctx.callbackQuery.message?.message_id;
    await handler.startTechnique(channelMessageId, 'percept_filters', userId!, messageId);

  } catch (error) {
    botLogger.error({ error: (error as Error).message }, 'Ошибка выбора ситуации');
  }
}

// Обработчик начала фильтров восприятия
export async function handleDeepFiltersStart(ctx: BotContext, bot: Telegraf) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const userId = ctx.from?.id;

    await ctx.answerCbQuery('🚀 Начинаем!');

    botLogger.info({
      action: 'deep_filters_start',
      channelMessageId,
      userId
    }, 'Начало работы с фильтрами восприятия');

    const messageId = ctx.callbackQuery.message?.message_id;
    const chatId = ctx.callbackQuery.message?.chat?.id!;
    const handler = getDeepWorkHandler(bot, chatId);
    await handler.handleFiltersStart(channelMessageId, userId!, messageId);

  } catch (error) {
    botLogger.error({ error: (error as Error).message }, 'Ошибка начала фильтров');
  }
}

// Единый обработчик показа примеров
export async function handleDeepFiltersExample(ctx: BotContext, bot: Telegraf) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const userId = ctx.from?.id;

    const messageId = ctx.callbackQuery.message?.message_id;
    const chatId = ctx.callbackQuery.message?.chat?.id!;
    const handler = getDeepWorkHandler(bot, chatId);
    
    // Проверяем, не исчерпаны ли примеры
    const key = `examples_${channelMessageId}`;
    const count = (handler as any).exampleCounters?.get(key) || 0;
    
    if (count >= 5) {
      // Показываем всплывающее сообщение о том, что примеров больше нет
      await ctx.answerCbQuery('А все, больше нет 😁');
      return;
    }
    
    // Выбираем текст всплывающего сообщения в зависимости от счетчика
    let callbackText = '💡 Показываю пример';
    if (count === 3 || count === 4) {
      callbackText = '🎴 Смотри фильтры восприятия';
    }
    
    await ctx.answerCbQuery(callbackText);
    await handler.showThoughtsExample(channelMessageId, userId!, messageId);

  } catch (error) {
    botLogger.error({ error: (error as Error).message }, 'Ошибка показа примера');
  }
}

// Обработчик показа примера мыслей (для обратной совместимости)
export async function handleDeepFiltersExampleThoughts(ctx: BotContext, bot: Telegraf) {
  return handleDeepFiltersExample(ctx, bot);
}

// Обработчик показа примера искажений (для обратной совместимости)
export async function handleDeepFiltersExampleDistortions(ctx: BotContext, bot: Telegraf) {
  return handleDeepFiltersExample(ctx, bot);
}

// Обработчик показа примера рациональной реакции (для обратной совместимости)
export async function handleDeepFiltersExampleRational(ctx: BotContext, bot: Telegraf) {
  return handleDeepFiltersExample(ctx, bot);
}

// Обработчик показа карточек фильтров
export async function handleDeepShowFilters(ctx: BotContext, bot: Telegraf) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const userId = ctx.from?.id;

    await ctx.answerCbQuery('🎴 Показываю фильтры');

    const messageId = ctx.callbackQuery.message?.message_id;
    const chatId = ctx.callbackQuery.message?.chat?.id!;
    const handler = getDeepWorkHandler(bot, chatId);
    await handler.showFiltersCards(channelMessageId, userId!, messageId);

  } catch (error) {
    botLogger.error({ error: (error as Error).message }, 'Ошибка показа фильтров');
  }
}

// Обработчик кнопки "Вперед" для перехода к плюшкам
export async function handleDeepContinueToTreats(ctx: BotContext, bot: Telegraf) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const userId = ctx.from?.id;

    await ctx.answerCbQuery('🤗 Переходим к приятному!');

    botLogger.info({
      action: 'deep_continue_to_treats',
      channelMessageId,
      userId
    }, 'Переход к плюшкам после фильтров');

    const messageId = ctx.callbackQuery.message?.message_id;
    const chatId = ctx.callbackQuery.message?.chat?.id!;
    const handler = getDeepWorkHandler(bot, chatId);
    await handler.continueToPluskas(channelMessageId, userId!, messageId);

  } catch (error) {
    botLogger.error({ error: (error as Error).message }, 'Ошибка перехода к плюшкам');
  }
}

// Обработчик кнопки "Показать фильтры"
export async function handleShowFilters(ctx: any, bot: Telegraf) {
  try {
    await ctx.answerCbQuery();
    
    const match = ctx.callbackQuery.data.match(/show_filters_(\d+)/);
    if (!match) return;
    
    const channelMessageId = parseInt(match[1]);
    const userId = ctx.from?.id;
    
    if (!userId) {
      botLogger.error('Нет ID пользователя в callback запросе');
      return;
    }

    const messageId = ctx.callbackQuery.message?.message_id;
    const chatId = ctx.callbackQuery.message?.chat?.id!;
    const handler = getDeepWorkHandler(bot, chatId);
    await handler.showFilters(channelMessageId, userId, messageId);

  } catch (error) {
    botLogger.error({ error: (error as Error).message }, 'Ошибка показа фильтров');
  }
}