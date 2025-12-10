import type { BotContext } from '../../types';
import { Telegraf } from 'telegraf';
import { botLogger } from '../../logger';
import { DeepWorkHandler } from '../../deep-work-handler';
import { sendToUser } from '../../utils/send-to-user';

// Храним экземпляры обработчиков для каждого чата/треда
const deepWorkHandlers = new Map<string, DeepWorkHandler>();

export function getDeepWorkHandler(bot: Telegraf, chatId: number, userId: number, threadId?: number): DeepWorkHandler {
  // Ключ теперь включает threadId для правильного кэширования
  const key = threadId ? `${chatId}_${threadId}` : `${chatId}`;
  if (!deepWorkHandlers.has(key)) {
    deepWorkHandlers.set(key, new DeepWorkHandler(bot, chatId, userId, threadId));
  }
  return deepWorkHandlers.get(key)!;
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
    const threadId = 'message_thread_id' in ctx.callbackQuery.message! ? ctx.callbackQuery.message.message_thread_id : undefined;
    const handler = getDeepWorkHandler(bot, chatId, userId!, threadId);
    
    // Получаем рекомендованную технику из БД
    const { getInteractivePost } = await import('../../db');
    const post = getInteractivePost(channelMessageId);
    const techniqueType = post?.message_data?.recommended_technique || 'percept_filters';
    
    botLogger.info({
      channelMessageId,
      techniqueType,
      hasRecommendation: !!post?.message_data?.recommended_technique
    }, 'Используем технику для выбранной ситуации');
    
    // Если выбрана техника "разбор по схеме" - генерируем слова поддержки
    if (techniqueType === 'schema' || techniqueType === 'abc') {
      // Используем текст ситуации для контекста (можно улучшить, сохранив текст ситуации)
      await handler.generateAndSaveSupportWords(channelMessageId, 'выбранная ситуация', userId!);
    }

    await handler.startTechnique(channelMessageId, techniqueType, userId!);

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

    const chatId = ctx.callbackQuery.message?.chat?.id!;
    const threadId = 'message_thread_id' in ctx.callbackQuery.message! ? ctx.callbackQuery.message.message_thread_id : undefined;
    const handler = getDeepWorkHandler(bot, chatId, userId!, threadId);
    await handler.handleFiltersStart(channelMessageId, userId!);

  } catch (error) {
    botLogger.error({ error: (error as Error).message }, 'Ошибка начала фильтров');
  }
}

// Единый обработчик показа примеров
export async function handleDeepFiltersExample(ctx: BotContext, bot: Telegraf) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const userId = ctx.from?.id;

    const chatId = ctx.callbackQuery.message?.chat?.id!;
    const threadId = 'message_thread_id' in ctx.callbackQuery.message! ? ctx.callbackQuery.message.message_thread_id : undefined;
    const handler = getDeepWorkHandler(bot, chatId, userId!, threadId);
    
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
    await handler.showThoughtsExample(channelMessageId, userId!);

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

    const chatId = ctx.callbackQuery.message?.chat?.id!;
    const threadId = 'message_thread_id' in ctx.callbackQuery.message! ? ctx.callbackQuery.message.message_thread_id : undefined;
    const handler = getDeepWorkHandler(bot, chatId, userId!, threadId);
    await handler.showFiltersCards(channelMessageId, userId!);

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

    const chatId = ctx.callbackQuery.message?.chat?.id!;
    const threadId = 'message_thread_id' in ctx.callbackQuery.message! ? ctx.callbackQuery.message.message_thread_id : undefined;
    const handler = getDeepWorkHandler(bot, chatId, userId!, threadId);
    await handler.continueToPluskas(channelMessageId, userId!);

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

    const chatId = ctx.callbackQuery.message?.chat?.id!;
    const threadId = 'message_thread_id' in ctx.callbackQuery.message! ? ctx.callbackQuery.message.message_thread_id : undefined;
    const handler = getDeepWorkHandler(bot, chatId, userId!, threadId);
    await handler.showFilters(channelMessageId, userId);

  } catch (error) {
    botLogger.error({ error: (error as Error).message }, 'Ошибка показа фильтров');
  }
}

// Обработчик начала разбора по схеме
export async function handleSchemaStart(ctx: BotContext, bot: Telegraf) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const userId = ctx.from?.id;

    await ctx.answerCbQuery('🚀 Поехали!');

    botLogger.info({
      action: 'schema_start',
      channelMessageId,
      userId
    }, 'Начало разбора по схеме');

    const chatId = ctx.callbackQuery.message?.chat?.id!;
    const threadId = 'message_thread_id' in ctx.callbackQuery.message! ? ctx.callbackQuery.message.message_thread_id : undefined;
    const handler = getDeepWorkHandler(bot, chatId, userId!, threadId);
    await handler.handleSchemaStart(channelMessageId, userId!);

  } catch (error) {
    botLogger.error({ error: (error as Error).message }, 'Ошибка начала разбора по схеме');
  }
}

// Обработчик показа примера для разбора по схеме
export async function handleSchemaExample(ctx: BotContext, bot: Telegraf) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const userId = ctx.from?.id;
    
    const chatId = ctx.callbackQuery.message?.chat?.id!;
    const threadId = 'message_thread_id' in ctx.callbackQuery.message! ? ctx.callbackQuery.message.message_thread_id : undefined;
    const handler = getDeepWorkHandler(bot, chatId, userId!, threadId);
    
    // Проверяем счетчик примеров
    const key = `schema_examples_${channelMessageId}`;
    const count = (handler as any).schemaExampleCounters?.get(key) || 0;
    
    // Выбираем текст для callback
    let callbackText = 'Показываю пример';
    if (count === 3) {
      callbackText = 'Закончились примеры';
    } else if (count === 4) {
      callbackText = 'Неть примеров';
    } else if (count >= 5) {
      // Кнопки больше не реагируют
      await ctx.answerCbQuery();
      return;
    }

    await ctx.answerCbQuery(callbackText);

    const messageId = ctx.callbackQuery.message?.message_id;
    await handler.showSchemaExample(channelMessageId, userId!);

  } catch (error) {
    botLogger.error({ error: (error as Error).message }, 'Ошибка показа примера для схемы');
  }
}

// Обработчик продолжения после разбора по схеме
export async function handleSchemaContinue(ctx: BotContext, bot: Telegraf) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const userId = ctx.from?.id;

    await ctx.answerCbQuery('🤗 Переходим к плюшкам!');

    botLogger.info({
      action: 'schema_continue',
      channelMessageId,
      userId
    }, 'Переход к плюшкам после разбора по схеме');

    const chatId = ctx.callbackQuery.message?.chat?.id!;
    const threadId = 'message_thread_id' in ctx.callbackQuery.message! ? ctx.callbackQuery.message.message_thread_id : undefined;
    const handler = getDeepWorkHandler(bot, chatId, userId!, threadId);
    await handler.continueToPluskas(channelMessageId, userId!);

  } catch (error) {
    botLogger.error({ error: (error as Error).message }, 'Ошибка перехода к плюшкам из схемы');
  }
}

// Обработчик кнопки "В другой раз" для эмоций в схеме
export async function handleSkipNegSchema(ctx: BotContext, bot: Telegraf) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const userId = ctx.from?.id;

    await ctx.answerCbQuery('👍 Хорошо! Продолжаем');

    botLogger.info({
      action: 'skip_neg_schema',
      channelMessageId,
      userId
    }, 'Пропуск уточнения эмоций в схеме');

    const chatId = ctx.callbackQuery.message?.chat?.id!;
    const threadId = 'message_thread_id' in ctx.callbackQuery.message! ? ctx.callbackQuery.message.message_thread_id : undefined;
    const handler = getDeepWorkHandler(bot, chatId, userId!, threadId);
    
    // Получаем пост для слов поддержки
    const { getInteractivePost } = await import('../../db');
    const post = getInteractivePost(channelMessageId);
    let supportText = '<i>Понимаю тебя 💚</i>';
    
    if (post?.message_data?.schema_support?.text) {
      supportText = `<i>${post.message_data.schema_support.text}</i>`;
    }
    
    // Отправляем слова поддержки и следующий вопрос
    const handler2 = handler as any;
    const buttonText = handler2.getSchemaExampleButtonText ? handler2.getSchemaExampleButtonText(channelMessageId) : '';
    const messageOptions: any = {};
    
    if (buttonText) {
      messageOptions.reply_markup = {
        inline_keyboard: [[
          { text: buttonText, callback_data: `schema_example_${channelMessageId}` }
        ]]
      };
    }
    
    // Отправляем сообщение напрямую через Telegram API
    // Это СИСТЕМНОЕ сообщение - отправляем БЕЗ reply (просто в тред через threadId)
    const sendOptions: any = {
      parse_mode: 'HTML',
      ...messageOptions
    };

    // Используем threadId из handler для отправки в комментарии
    if (threadId) {
      sendOptions.reply_to_message_id = threadId;
    }

    await sendToUser(
      bot,
      chatId,
      userId,
      supportText + `\n\n<b>Какое поведение 💃 или импульс к действию спровоцировала ситуация?</b>\n<i>Что ты сделал${'${:а}'}? Как отреагировал${'${:а}'}? Или что хотелось сделать?</i>`,
      sendOptions
    );

    // Обновляем состояние
    const { updateInteractivePostState } = await import('../../db');
    updateInteractivePostState(channelMessageId, 'schema_waiting_behavior');

  } catch (error) {
    botLogger.error({ error: (error as Error).message }, 'Ошибка пропуска уточнения эмоций в схеме');
  }
}