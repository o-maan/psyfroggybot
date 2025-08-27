import type { BotContext } from '../../types';
import { Telegraf } from 'telegraf';
import { botLogger } from '../../logger';
import { DeepWorkHandler } from '../../deep-work-handler';

// Храним экземпляры обработчиков для каждого чата
const deepWorkHandlers = new Map<number, DeepWorkHandler>();

function getDeepWorkHandler(bot: Telegraf, chatId: number): DeepWorkHandler {
  if (!deepWorkHandlers.has(chatId)) {
    deepWorkHandlers.set(chatId, new DeepWorkHandler(bot, chatId));
  }
  return deepWorkHandlers.get(chatId)!;
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

// Обработчик показа примера мыслей
export async function handleDeepFiltersExampleThoughts(ctx: BotContext, bot: Telegraf) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const userId = ctx.from?.id;

    await ctx.answerCbQuery('💡 Показываю пример');

    const messageId = ctx.callbackQuery.message?.message_id;
    const chatId = ctx.callbackQuery.message?.chat?.id!;
    const handler = getDeepWorkHandler(bot, chatId);
    await handler.showThoughtsExample(channelMessageId, userId!, messageId);

  } catch (error) {
    botLogger.error({ error: (error as Error).message }, 'Ошибка показа примера мыслей');
  }
}

// Обработчик показа примера искажений
export async function handleDeepFiltersExampleDistortions(ctx: BotContext, bot: Telegraf) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const userId = ctx.from?.id;

    await ctx.answerCbQuery('💡 Показываю пример');

    const messageId = ctx.callbackQuery.message?.message_id;
    const chatId = ctx.callbackQuery.message?.chat?.id!;
    const handler = getDeepWorkHandler(bot, chatId);
    await handler.showDistortionsExample(channelMessageId, userId!, messageId);

  } catch (error) {
    botLogger.error({ error: (error as Error).message }, 'Ошибка показа примера искажений');
  }
}

// Обработчик показа примера рациональной реакции
export async function handleDeepFiltersExampleRational(ctx: BotContext, bot: Telegraf) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const userId = ctx.from?.id;

    await ctx.answerCbQuery('💡 Показываю пример');

    const messageId = ctx.callbackQuery.message?.message_id;
    const chatId = ctx.callbackQuery.message?.chat?.id!;
    const handler = getDeepWorkHandler(bot, chatId);
    await handler.showRationalExample(channelMessageId, userId!, messageId);

  } catch (error) {
    botLogger.error({ error: (error as Error).message }, 'Ошибка показа примера рациональной реакции');
  }
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