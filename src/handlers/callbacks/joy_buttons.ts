import type { BotContext } from '../../types';
import { botLogger } from '../../logger';
import { JoyHandler } from '../../joy-handler';
import { Scheduler } from '../../scheduler';
import { Telegraf, Markup } from 'telegraf';

/**
 * Обновляет или создает joy-сессию для пользователя
 * КРИТИЧЕСКИ ВАЖНО: без этого handleJoyUserMessage не найдет сессию!
 */
function ensureJoySession(
  scheduler: Scheduler,
  userId: number,
  channelMessageId: number,
  chatId: number,
  messageThreadId?: number
) {
  let joySession = scheduler['joySessions'].get(userId);

  // Если messageThreadId не передан, пытаемся найти его в forwardedMessages
  let actualForwardedId = messageThreadId;
  if (!actualForwardedId) {
    const forwardedId = scheduler['forwardedMessages'].get(channelMessageId);
    if (forwardedId) {
      actualForwardedId = forwardedId;
      botLogger.debug(
        { channelMessageId, forwardedId },
        '🔍 forwardedMessageId найден в forwardedMessages'
      );
    }
  }

  if (joySession) {
    joySession.channelMessageId = channelMessageId;
    joySession.chatId = chatId;
    // ВАЖНО: НЕ перезаписываем forwardedMessageId если он уже установлен!
    // Это нужно потому что sendJoyFirstMessageAsync устанавливает его асинхронно
    if (actualForwardedId !== undefined) {
      joySession.forwardedMessageId = actualForwardedId;
    }
  } else {
    joySession = {
      channelMessageId,
      userId,
      chatId,
      forwardedMessageId: actualForwardedId
    };
  }
  scheduler['joySessions'].set(userId, joySession);

  botLogger.debug(
    { userId, channelMessageId, chatId, messageThreadId, actualForwardedId, forwardedId: joySession.forwardedMessageId },
    '💾 Обновлена/создана joy-сессия'
  );
}

/**
 * Обработчик кнопки "Добавить 🔥"
 * Сохраняет накопленные сообщения пользователя в список радости
 */
export async function handleJoyAdd(ctx: BotContext, bot: Telegraf, scheduler: Scheduler) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const userId = ctx.from?.id;

    if (!userId) {
      botLogger.error({ channelMessageId }, 'Нет userId в контексте joy_add');
      await ctx.answerCbQuery('Ошибка: пользователь не определен');
      return;
    }

    await ctx.answerCbQuery('Добавляю в список...⚡️');

    botLogger.info(
      { action: 'joy_add', channelMessageId, userId },
      '🔥 Нажата кнопка "Добавить" в списке радости'
    );

    const chatId = ctx.callbackQuery.message?.chat?.id!;
    const replyToMessageId = ctx.callbackQuery.message?.message_id;
    const messageThreadId = (ctx.callbackQuery.message as any)?.message_thread_id;

    // Обновляем joy-сессию
    ensureJoySession(scheduler, userId, channelMessageId, chatId, messageThreadId);

    // Создаем экземпляр JoyHandler с общими Map из scheduler
    const joyHandler = new JoyHandler(
      bot,
      chatId,
      userId,
      channelMessageId,
      scheduler.joyPendingMessages,
      scheduler.joyLastButtonMessageId,
      scheduler.joyListMessageId,
      scheduler.joyAddingSessions,
      scheduler.joyListShown,
      messageThreadId // ID треда для отправки БЕЗ reply
    );

    // Сохраняем источники радости
    await joyHandler.saveJoySources();

    botLogger.info({ userId, channelMessageId }, '✅ Источники радости сохранены');
  } catch (error) {
    botLogger.error(
      { error: (error as Error).message, stack: (error as Error).stack },
      'Ошибка обработки кнопки joy_add'
    );

    try {
      await ctx.answerCbQuery('Произошла ошибка, попробуй еще раз 🙏');
    } catch (answerError) {
      botLogger.error({ answerError }, 'Не удалось отправить answerCbQuery после ошибки');
    }
  }
}

/**
 * Обработчик кнопки "Добавить еще ⚡️"
 * Начинает новую сессию добавления источников радости
 */
export async function handleJoyAddMore(ctx: BotContext, bot: Telegraf, scheduler: Scheduler) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const userId = ctx.from?.id;

    if (!userId) {
      botLogger.error({ channelMessageId }, 'Нет userId в контексте joy_add_more');
      await ctx.answerCbQuery('Ошибка: пользователь не определен');
      return;
    }

    await ctx.answerCbQuery('Жду новые источники радости ⚡️');

    botLogger.info(
      { action: 'joy_add_more', channelMessageId, userId },
      '⚡️ Нажата кнопка "Добавить еще" в списке радости'
    );

    const chatId = ctx.callbackQuery.message?.chat?.id!;
    const replyToMessageId = ctx.callbackQuery.message?.message_id;
    const messageThreadId = (ctx.callbackQuery.message as any)?.message_thread_id;

    // КРИТИЧЕСКИ ВАЖНО: Обновляем или создаем joy-сессию
    // Без этого handleJoyUserMessage НЕ найдет сессию!
    let joySession = scheduler['joySessions'].get(userId);
    if (joySession) {
      // Обновляем существующую сессию
      joySession.channelMessageId = channelMessageId;
      joySession.chatId = chatId;
      joySession.forwardedMessageId = messageThreadId;
    } else {
      // Создаем новую сессию
      joySession = {
        channelMessageId,
        userId,
        chatId,
        forwardedMessageId: messageThreadId
      };
    }
    scheduler['joySessions'].set(userId, joySession);

    botLogger.info(
      { userId, channelMessageId, chatId, messageThreadId },
      '💾 Обновлена/создана joy-сессия при нажатии "Добавить еще"'
    );

    // ВАЖНО: Очищаем режим удаления, если он был активен
    const sessionKey = `${userId}_${channelMessageId}`;
    if (scheduler.joyRemovalSessions) {
      scheduler.joyRemovalSessions.delete(sessionKey);
      botLogger.debug({ userId, channelMessageId }, '🗑️ Очищен режим удаления при "Добавить еще"');
    }

    // Создаем экземпляр JoyHandler с общими Map из scheduler
    const joyHandler = new JoyHandler(
      bot,
      chatId,
      userId,
      channelMessageId,
      scheduler.joyPendingMessages,
      scheduler.joyLastButtonMessageId,
      scheduler.joyListMessageId,
      scheduler.joyAddingSessions,
      scheduler.joyListShown,
      messageThreadId // ID треда для отправки БЕЗ reply
    );

    // Начинаем новую сессию добавления
    await joyHandler.startAddMoreSession();

    botLogger.info({ userId, channelMessageId }, '✅ Начата новая сессия добавления');
  } catch (error) {
    botLogger.error(
      { error: (error as Error).message, stack: (error as Error).stack },
      'Ошибка обработки кнопки joy_add_more'
    );

    try {
      await ctx.answerCbQuery('Произошла ошибка, попробуй еще раз 🙏');
    } catch (answerError) {
      botLogger.error({ answerError }, 'Не удалось отправить answerCbQuery после ошибки');
    }
  }
}

/**
 * Обработчик кнопки "Посмотреть"
 * Показывает весь список источников радости
 */
export async function handleJoyView(ctx: BotContext, bot: Telegraf, scheduler: Scheduler) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const userId = ctx.from?.id;

    if (!userId) {
      botLogger.error({ channelMessageId }, 'Нет userId в контексте joy_view');
      await ctx.answerCbQuery('Ошибка: пользователь не определен');
      return;
    }

    await ctx.answerCbQuery('Показываю список 📋');

    botLogger.info(
      { action: 'joy_view', channelMessageId, userId },
      '📋 Нажата кнопка "Посмотреть" в списке радости'
    );

    const chatId = ctx.callbackQuery.message?.chat?.id!;
    const replyToMessageId = ctx.callbackQuery.message?.message_id;
    const messageThreadId = (ctx.callbackQuery.message as any)?.message_thread_id;

    // Обновляем joy-сессию
    ensureJoySession(scheduler, userId, channelMessageId, chatId, messageThreadId);

    // Создаем экземпляр JoyHandler с общими Map из scheduler
    const joyHandler = new JoyHandler(
      bot,
      chatId,
      userId,
      channelMessageId,
      scheduler.joyPendingMessages,
      scheduler.joyLastButtonMessageId,
      scheduler.joyListMessageId,
      scheduler.joyAddingSessions,
      scheduler.joyListShown,
      messageThreadId // ID треда для отправки БЕЗ reply
    );

    // Показываем список
    await joyHandler.showJoyList();

    botLogger.info({ userId, channelMessageId }, '✅ Показан список источников радости');
  } catch (error) {
    botLogger.error(
      { error: (error as Error).message, stack: (error as Error).stack },
      'Ошибка обработки кнопки joy_view'
    );

    try {
      await ctx.answerCbQuery('Произошла ошибка, попробуй еще раз 🙏');
    } catch (answerError) {
      botLogger.error({ answerError }, 'Не удалось отправить answerCbQuery после ошибки');
    }
  }
}

/**
 * Обработчик кнопки "Дай подсказку 🙌🏻" (воскресный вводный сценарий)
 * Отправляет подсказку с типами триггеров радости и энергии
 */
export async function handleJoySundayHint(ctx: BotContext, bot: Telegraf, scheduler: Scheduler) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const userId = ctx.from?.id;

    if (!userId) {
      botLogger.error({ channelMessageId }, 'Нет userId в контексте joy_sunday_hint');
      await ctx.answerCbQuery('Ошибка: пользователь не определен');
      return;
    }

    await ctx.answerCbQuery('Отправляю подсказку 💡');

    botLogger.info(
      { action: 'joy_sunday_hint', channelMessageId, userId },
      '💡 Нажата кнопка "Дай подсказку" в воскресном Joy'
    );

    const chatId = ctx.callbackQuery.message?.chat?.id!;
    const replyToMessageId = ctx.callbackQuery.message?.message_id!;
    const messageThreadId = (ctx.callbackQuery.message as any)?.message_thread_id;

    // Обновляем/создаем Joy-сессию для правильной маршрутизации сообщений
    ensureJoySession(scheduler, userId, channelMessageId, chatId, messageThreadId);

    const hintText = `Можно разделить по типу воздействия:
❤️‍🔥 <b>Сенсорные триггеры</b> (запах выпечки, шерсть кота, дождь за окном)
❤️‍🔥 <b>Действия</b> (прогулки на лошадях, контрастный душ, танцы под музыку)
❤️‍🔥 <b>Социальные моменты</b> (общение с другом, помощь, объятия, обмен подарками)
❤️‍🔥 <b>Ментальные состояния</b> (чувство завершенности, момент ясности)

Так будет чуть проще 🙃
<b>Пройдись отдельно по радостным аспектам и тому, что дает энергию</b> ⚡️
<blockquote><b>И уточняй</b> - постарайся писать не просто "шерсть кота", а что конкретнее тебе нравится:
слегка касаться и перебирать руками или уткнуться головой и гладить кота, ощущая пальцами мягкость шерсти?
<b>Пиши важные моменты для себя</b></blockquote>`;

    // Создаем JoyHandler для отправки БЕЗ реплая
    const { JoyHandler } = await import('../../joy-handler');
    const joyHandler = new JoyHandler(
      bot,
      chatId,
      userId,
      channelMessageId,
      scheduler.joyPendingMessages,
      scheduler.joyLastButtonMessageId,
      scheduler.joyListMessageId,
      scheduler.joyAddingSessions,
      scheduler.joyListShown,
      messageThreadId
    );

    // Отправляем подсказку БЕЗ реплая
    await joyHandler['sendMessage'](hintText, undefined, {
      parse_mode: 'HTML'
    });

    // Начинаем интерактивную сессию (отправит приглашение и установит флаг)
    await joyHandler.startInteractiveSession();

    botLogger.info({ userId, channelMessageId }, '✅ Подсказка отправлена, начата интерактивная сессия');
  } catch (error) {
    botLogger.error(
      { error: (error as Error).message, stack: (error as Error).stack },
      'Ошибка обработки кнопки joy_sunday_hint'
    );

    try {
      await ctx.answerCbQuery('Произошла ошибка, попробуй еще раз 🙏');
    } catch (answerError) {
      botLogger.error({ answerError }, 'Не удалось отправить answerCbQuery после ошибки');
    }
  }
}

/**
 * Обработчик кнопки "В другой раз" (воскресный вводный сценарий)
 * Пропускает Joy и переходит к обычному вечернему посту
 */
export async function handleJoySundaySkip(ctx: BotContext, bot: Telegraf, scheduler: Scheduler) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const userId = ctx.from?.id;

    if (!userId) {
      botLogger.error({ channelMessageId }, 'Нет userId в контексте joy_sunday_skip');
      await ctx.answerCbQuery('Ошибка: пользователь не определен');
      return;
    }

    await ctx.answerCbQuery('Переходим к основному 👌');

    botLogger.info(
      { action: 'joy_sunday_skip', channelMessageId, userId },
      '👋 Нажата кнопка "В другой раз" в воскресном Joy'
    );

    const chatId = ctx.callbackQuery.message?.chat?.id!;
    const replyToMessageId = ctx.callbackQuery.message?.message_id!;
    const messageThreadId = (ctx.callbackQuery.message as any)?.message_thread_id;

    // Обновляем/создаем Joy-сессию для правильной маршрутизации сообщений
    ensureJoySession(scheduler, userId, channelMessageId, chatId, messageThreadId);

    // Создаем JoyHandler для отправки БЕЗ реплая
    const { JoyHandler } = await import('../../joy-handler');
    const joyHandler = new JoyHandler(
      bot,
      chatId,
      userId,
      channelMessageId,
      scheduler.joyPendingMessages,
      scheduler.joyLastButtonMessageId,
      scheduler.joyListMessageId,
      scheduler.joyAddingSessions,
      scheduler.joyListShown,
      messageThreadId
    );

    // Переход к вечернему посту - выбор сценария
    const transitionText = `Хорошо, можешь вернуться к списку в любое время по команде /joy

<b>По какому сценарию мы сегодня поработаем?</b>`;

    await joyHandler['sendMessage'](transitionText, undefined, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('Глубокая работа 🧠', `scenario_deep_${channelMessageId}`)],
        [Markup.button.callback('Упрощенный вариант 💫', `scenario_simplified_${channelMessageId}`)]
      ])
    });

    botLogger.info({ userId, channelMessageId }, '✅ Переход к вечернему посту выполнен');
  } catch (error) {
    botLogger.error(
      { error: (error as Error).message, stack: (error as Error).stack },
      'Ошибка обработки кнопки joy_sunday_skip'
    );

    try {
      await ctx.answerCbQuery('Произошла ошибка, попробуй еще раз 🙏');
    } catch (answerError) {
      botLogger.error({ answerError }, 'Не удалось отправить answerCbQuery после ошибки');
    }
  }
}

/**
 * Обработчик кнопки "Идем дальше" (переход к вечернему посту)
 */
export async function handleJoyContinue(ctx: BotContext, bot: Telegraf, scheduler: Scheduler) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const userId = ctx.from?.id;

    if (!userId) {
      botLogger.error({ channelMessageId }, 'Нет userId в контексте joy_continue');
      await ctx.answerCbQuery('Ошибка: пользователь не определен');
      return;
    }

    await ctx.answerCbQuery('Переходим дальше 🚀');

    botLogger.info(
      { action: 'joy_continue', channelMessageId, userId },
      '🚀 Нажата кнопка "Идем дальше"'
    );

    const chatId = ctx.callbackQuery.message?.chat?.id!;
    const replyToMessageId = ctx.callbackQuery.message?.message_id!;
    const messageThreadId = (ctx.callbackQuery.message as any)?.message_thread_id;

    // Обновляем/создаем Joy-сессию для правильной маршрутизации сообщений
    ensureJoySession(scheduler, userId, channelMessageId, chatId, messageThreadId);

    // Создаем JoyHandler для отправки БЕЗ реплая
    const { JoyHandler } = await import('../../joy-handler');
    const joyHandler = new JoyHandler(
      bot,
      chatId,
      userId,
      channelMessageId,
      scheduler.joyPendingMessages,
      scheduler.joyLastButtonMessageId,
      scheduler.joyListMessageId,
      scheduler.joyAddingSessions,
      scheduler.joyListShown,
      messageThreadId
    );

    // Отправляем финальное сообщение перед переходом
    const finalText = `Ты можешь возвращаться к своему списку в любое время по команде /joy и пополнять его

Начни постепенно добавлять что-то для радости и энергии в свою жизнь на ежедневной основе – ты увидишь, насколько больше ресурса в тебе начнет открываться

<b>По какому сценарию мы сегодня поработаем?</b>`;

    await joyHandler['sendMessage'](finalText, undefined, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('Глубокая работа 🧠', `scenario_deep_${channelMessageId}`)],
        [Markup.button.callback('Упрощенный вариант 💫', `scenario_simplified_${channelMessageId}`)]
      ])
    });

    botLogger.info({ userId, channelMessageId }, '✅ Переход к вечернему посту выполнен');
  } catch (error) {
    botLogger.error(
      { error: (error as Error).message, stack: (error as Error).stack },
      'Ошибка обработки кнопки joy_continue'
    );

    try {
      await ctx.answerCbQuery('Произошла ошибка, попробуй еще раз 🙏');
    } catch (answerError) {
      botLogger.error({ answerError }, 'Не удалось отправить answerCbQuery после ошибки');
    }
  }
}

/**
 * Обработчик кнопки "Убрать лишнее 🙅🏻"
 * Начинает режим удаления источников из списка
 */
export async function handleJoyRemove(ctx: BotContext, bot: Telegraf, scheduler: Scheduler) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const userId = ctx.from?.id;

    if (!userId) {
      botLogger.error({ channelMessageId }, 'Нет userId в контексте joy_remove');
      await ctx.answerCbQuery('Ошибка: пользователь не определен');
      return;
    }

    await ctx.answerCbQuery('Начинаем удаление 🗑️');

    botLogger.info(
      { action: 'joy_remove', channelMessageId, userId },
      '🗑️ Нажата кнопка "Убрать лишнее" в списке радости'
    );

    const chatId = ctx.callbackQuery.message?.chat?.id!;
    const replyToMessageId = ctx.callbackQuery.message?.message_id!;
    const messageThreadId = (ctx.callbackQuery.message as any)?.message_thread_id;

    // Обновляем/создаем Joy-сессию для правильной маршрутизации сообщений
    ensureJoySession(scheduler, userId, channelMessageId, chatId, messageThreadId);

    // Отправляем инструкцию
    const instructionText = `Напиши номера пунктов из списка, которые хочешь удалить (например: 1, 5 и 7)

Чтобы очистить полностью – нажми "Очистить весь список" ☠️
Или ты можешь еще что-то добавить`;

    // НЕ удаляем список! Он должен остаться для навигации
    // Отправляем инструкцию как ответ на список
    const sessionKey = `${userId}_${channelMessageId}`;
    const listMessageId = scheduler.joyListMessageId?.get(sessionKey) || replyToMessageId;

    const instructionMessage = await bot.telegram.sendMessage(chatId, instructionText, {
      reply_parameters: { message_id: listMessageId },
      ...Markup.inlineKeyboard([
        [Markup.button.callback('Добавить еще ⚡️', `joy_add_more_${channelMessageId}`)],
        [Markup.button.callback('Очистить весь список', `joy_clear_all_${channelMessageId}`)],
        [Markup.button.callback('Идем дальше', `joy_continue_${channelMessageId}`)]
      ])
    });

    // Сохраняем ID скользящего сообщения
    if (!scheduler.joyLastButtonMessageId) {
      scheduler.joyLastButtonMessageId = new Map();
    }
    scheduler.joyLastButtonMessageId.set(sessionKey, instructionMessage.message_id);

    // Сохраняем состояние режима удаления
    if (!scheduler.joyRemovalSessions) {
      scheduler.joyRemovalSessions = new Map();
    }
    scheduler.joyRemovalSessions.set(sessionKey, {
      instructionMessageId: instructionMessage.message_id,
      numbersToDelete: new Map<number, number[]>(), // Map для поддержки редактирования
      state: 'waiting_numbers'
    });

    botLogger.info({ userId, channelMessageId }, '✅ Начат режим удаления источников');
  } catch (error) {
    botLogger.error(
      { error: (error as Error).message, stack: (error as Error).stack },
      'Ошибка обработки кнопки joy_remove'
    );

    try {
      await ctx.answerCbQuery('Произошла ошибка, попробуй еще раз 🙏');
    } catch (answerError) {
      botLogger.error({ answerError }, 'Не удалось отправить answerCbQuery после ошибки');
    }
  }
}

/**
 * Обработчик подтверждения удаления (кнопка "Готово?")
 */
export async function handleJoyRemoveConfirm(ctx: BotContext, bot: Telegraf, scheduler: Scheduler) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const userId = ctx.from?.id;

    if (!userId) {
      botLogger.error({ channelMessageId }, 'Нет userId в контексте joy_remove_confirm');
      await ctx.answerCbQuery('Ошибка: пользователь не определен');
      return;
    }

    await ctx.answerCbQuery('Удаляю...');

    botLogger.info(
      { action: 'joy_remove_confirm', channelMessageId, userId },
      '✅ Подтверждено удаление источников'
    );

    const chatId = ctx.callbackQuery.message?.chat?.id!;
    const replyToMessageId = ctx.callbackQuery.message?.message_id!;
    const messageThreadId = (ctx.callbackQuery.message as any)?.message_thread_id;

    // Обновляем/создаем Joy-сессию для правильной маршрутизации сообщений
    ensureJoySession(scheduler, userId, channelMessageId, chatId, messageThreadId);

    // Создаем JoyHandler для отправки БЕЗ реплая
    const { JoyHandler: JoyHandlerError } = await import('../../joy-handler');
    const joyHandlerError = new JoyHandlerError(
      bot,
      chatId,
      userId,
      channelMessageId,
      scheduler.joyPendingMessages,
      scheduler.joyLastButtonMessageId,
      scheduler.joyListMessageId,
      scheduler.joyAddingSessions,
      scheduler.joyListShown,
      messageThreadId
    );

    // Получаем состояние
    const sessionKey = `${userId}_${channelMessageId}`;
    const session = scheduler.joyRemovalSessions?.get(sessionKey);

    if (!session) {
      await joyHandlerError['sendMessage']('Не выбраны пункты для удаления', undefined);
      return;
    }

    // Собираем все уникальные номера из всех сообщений пользователя
    const allNumbers = new Set<number>();
    for (const nums of session.numbersToDelete.values()) {
      nums.forEach(n => allNumbers.add(n));
    }

    if (allNumbers.size === 0) {
      await joyHandlerError['sendMessage']('Не выбраны пункты для удаления', undefined);
      return;
    }

    // Получаем все источники для получения ID
    const { getAllJoySources, deleteJoySourcesByIds } = await import('../../db');
    const allSources = getAllJoySources(userId);

    // Конвертируем номера в ID (номера с 1, индексы с 0)
    const idsToDelete: number[] = [];
    for (const num of allNumbers) {
      if (num > 0 && num <= allSources.length) {
        idsToDelete.push(allSources[num - 1].id);
      }
    }

    if (idsToDelete.length === 0) {
      await joyHandlerError['sendMessage']('Некорректные номера пунктов', undefined);
      return;
    }

    // Удаляем скользящее сообщение "Готово", если есть
    if (session.confirmButtonMessageId) {
      try {
        await bot.telegram.deleteMessage(chatId, session.confirmButtonMessageId);
      } catch (error) {
        botLogger.debug('Не удалось удалить скользящее сообщение "Готово"');
      }
    }

    // Удаляем источники из БД
    deleteJoySourcesByIds(userId, idsToDelete);

    // Создаем экземпляр JoyHandler для правильной отправки в тред
    const { JoyHandler } = await import('../../joy-handler');
    const joyHandler = new JoyHandler(
      bot,
      chatId,
      userId,
      channelMessageId,
      scheduler.joyPendingMessages,
      scheduler.joyLastButtonMessageId,
      scheduler.joyListMessageId,
      scheduler.joyAddingSessions,
      scheduler.joyListShown,
      messageThreadId // ID треда для отправки БЕЗ reply
    );

    // Показываем сообщение "Список отредактирован"
    // Это системное сообщение - отправляем БЕЗ reply (просто в тред)
    const confirmText = 'Список отредактирован ☑️';
    await joyHandler['sendMessage'](confirmText, undefined, {
      ...Markup.inlineKeyboard([
        [Markup.button.callback('Посмотреть список 📝', `joy_view_${channelMessageId}`)],
        [Markup.button.callback('Добавить еще ⚡️', `joy_add_more_${channelMessageId}`)],
        [Markup.button.callback('Идем дальше', `joy_continue_${channelMessageId}`)]
      ])
    });

    // Очищаем состояние
    scheduler.joyRemovalSessions?.delete(sessionKey);

    botLogger.info({ userId, channelMessageId, deletedCount: idsToDelete.length }, '✅ Источники удалены');
  } catch (error) {
    botLogger.error(
      { error: (error as Error).message, stack: (error as Error).stack },
      'Ошибка обработки подтверждения удаления joy_remove_confirm'
    );

    try {
      await ctx.answerCbQuery('Произошла ошибка, попробуй еще раз 🙏');
    } catch (answerError) {
      botLogger.error({ answerError }, 'Не удалось отправить answerCbQuery после ошибки');
    }
  }
}

/**
 * Обработчик кнопки "Очистить весь список"
 */
export async function handleJoyClearAll(ctx: BotContext, bot: Telegraf, scheduler: Scheduler) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const userId = ctx.from?.id;

    if (!userId) {
      botLogger.error({ channelMessageId }, 'Нет userId в контексте joy_clear_all');
      await ctx.answerCbQuery('Ошибка: пользователь не определен');
      return;
    }

    await ctx.answerCbQuery('Подтверди удаление');

    botLogger.info(
      { action: 'joy_clear_all', channelMessageId, userId },
      '🗑️ Нажата кнопка "Очистить весь список"'
    );

    const chatId = ctx.callbackQuery.message?.chat?.id!;
    const replyToMessageId = ctx.callbackQuery.message?.message_id!;
    const messageThreadId = (ctx.callbackQuery.message as any)?.message_thread_id;

    // Обновляем/создаем Joy-сессию для правильной маршрутизации сообщений
    ensureJoySession(scheduler, userId, channelMessageId, chatId, messageThreadId);

    // Создаем JoyHandler для правильной отправки в тред
    const { JoyHandler } = await import('../../joy-handler');
    const joyHandler = new JoyHandler(
      bot,
      chatId,
      userId,
      channelMessageId,
      scheduler.joyPendingMessages,
      scheduler.joyLastButtonMessageId,
      scheduler.joyListMessageId,
      scheduler.joyAddingSessions,
      scheduler.joyListShown,
      messageThreadId // ID треда для отправки БЕЗ reply
    );

    // Показываем подтверждение
    // Это системное сообщение - отправляем БЕЗ reply (просто в тред)
    const confirmText = 'Ты точно хочешь удалить ВСЕ из списка? Его нужно будет составить заново';
    await joyHandler['sendMessage'](confirmText, undefined, {
      ...Markup.inlineKeyboard([
        [Markup.button.callback('Да, удалить', `joy_clear_confirm_${channelMessageId}`)],
        [Markup.button.callback('Нет, передумал', `joy_clear_cancel_${channelMessageId}`)]
      ])
    });

    botLogger.info({ userId, channelMessageId }, '✅ Показано подтверждение очистки списка');
  } catch (error) {
    botLogger.error(
      { error: (error as Error).message, stack: (error as Error).stack },
      'Ошибка обработки кнопки joy_clear_all'
    );

    try {
      await ctx.answerCbQuery('Произошла ошибка, попробуй еще раз 🙏');
    } catch (answerError) {
      botLogger.error({ answerError }, 'Не удалось отправить answerCbQuery после ошибки');
    }
  }
}

/**
 * Обработчик подтверждения очистки списка
 */
export async function handleJoyClearConfirm(ctx: BotContext, bot: Telegraf, scheduler: Scheduler) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const userId = ctx.from?.id;

    if (!userId) {
      botLogger.error({ channelMessageId }, 'Нет userId в контексте joy_clear_confirm');
      await ctx.answerCbQuery('Ошибка: пользователь не определен');
      return;
    }

    await ctx.answerCbQuery('Удаляю весь список...');

    botLogger.info(
      { action: 'joy_clear_confirm', channelMessageId, userId },
      '✅ Подтверждена очистка всего списка'
    );

    const chatId = ctx.callbackQuery.message?.chat?.id!;
    const replyToMessageId = ctx.callbackQuery.message?.message_id!;
    const messageThreadId = (ctx.callbackQuery.message as any)?.message_thread_id;

    // Обновляем/создаем Joy-сессию для правильной маршрутизации сообщений
    ensureJoySession(scheduler, userId, channelMessageId, chatId, messageThreadId);

    // Удаляем все источники
    const { clearAllJoySources } = await import('../../db');
    clearAllJoySources(userId);

    // Сбрасываем флаг показа списка, так как список теперь пуст
    const sessionKey = `${userId}_${channelMessageId}`;
    scheduler.joyListShown?.delete(sessionKey);
    scheduler.joyListMessageId?.delete(sessionKey);

    // Создаем JoyHandler для правильной отправки в тред
    const { JoyHandler } = await import('../../joy-handler');
    const joyHandler = new JoyHandler(
      bot,
      chatId,
      userId,
      channelMessageId,
      scheduler.joyPendingMessages,
      scheduler.joyLastButtonMessageId,
      scheduler.joyListMessageId,
      scheduler.joyAddingSessions,
      scheduler.joyListShown,
      messageThreadId // ID треда для отправки БЕЗ reply
    );

    // Показываем предложение создать список заново
    // Это системное сообщение - отправляем БЕЗ reply (просто в тред)
    const rebuildText = 'Теперь ты можешь создать список заново\n\n<b>Что хочешь добавить?</b>';
    await joyHandler['sendMessage'](rebuildText, undefined, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('Дай подсказку', `joy_sunday_hint_${channelMessageId}`)],
        [Markup.button.callback('В другой раз', `joy_later_${channelMessageId}`)]
      ])
    });

    botLogger.info({ userId, channelMessageId }, '✅ Весь список очищен');
  } catch (error) {
    botLogger.error(
      { error: (error as Error).message, stack: (error as Error).stack },
      'Ошибка обработки подтверждения очистки joy_clear_confirm'
    );

    try {
      await ctx.answerCbQuery('Произошла ошибка, попробуй еще раз 🙏');
    } catch (answerError) {
      botLogger.error({ answerError }, 'Не удалось отправить answerCbQuery после ошибки');
    }
  }
}

/**
 * Обработчик отмены очистки списка
 */
export async function handleJoyClearCancel(ctx: BotContext, bot: Telegraf, scheduler: Scheduler) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const userId = ctx.from?.id;

    if (!userId) {
      botLogger.error({ channelMessageId }, 'Нет userId в контексте joy_clear_cancel');
      await ctx.answerCbQuery('Ошибка: пользователь не определен');
      return;
    }

    await ctx.answerCbQuery('Отменено');

    botLogger.info(
      { action: 'joy_clear_cancel', channelMessageId, userId },
      '❌ Отменена очистка списка'
    );

    const chatId = ctx.callbackQuery.message?.chat?.id!;
    const replyToMessageId = ctx.callbackQuery.message?.message_id!;
    const messageThreadId = (ctx.callbackQuery.message as any)?.message_thread_id;

    // Обновляем/создаем Joy-сессию для правильной маршрутизации сообщений
    ensureJoySession(scheduler, userId, channelMessageId, chatId, messageThreadId);

    // Создаем JoyHandler для отправки БЕЗ реплая
    const { JoyHandler } = await import('../../joy-handler');
    const joyHandler = new JoyHandler(
      bot,
      chatId,
      userId,
      channelMessageId,
      scheduler.joyPendingMessages,
      scheduler.joyLastButtonMessageId,
      scheduler.joyListMessageId,
      scheduler.joyAddingSessions,
      scheduler.joyListShown,
      messageThreadId
    );

    // Показываем меню
    const menuText = 'Хорошо, тогда что хочешь сделать?';
    await joyHandler['sendMessage'](menuText, undefined, {
      ...Markup.inlineKeyboard([
        [Markup.button.callback('Добавить еще ⚡️', `joy_add_more_${channelMessageId}`)],
        [Markup.button.callback('Убрать лишнее 🙅🏻', `joy_remove_${channelMessageId}`)],
        [Markup.button.callback('Посмотреть список 📝', `joy_view_${channelMessageId}`)],
        [Markup.button.callback('Идем дальше', `joy_continue_${channelMessageId}`)]
      ])
    });

    botLogger.info({ userId, channelMessageId }, '✅ Показано меню после отмены очистки');
  } catch (error) {
    botLogger.error(
      { error: (error as Error).message, stack: (error as Error).stack },
      'Ошибка обработки отмены очистки joy_clear_cancel'
    );

    try {
      await ctx.answerCbQuery('Произошла ошибка, попробуй еще раз 🙏');
    } catch (answerError) {
      botLogger.error({ answerError }, 'Не удалось отправить answerCbQuery после ошибки');
    }
  }
}

/**
 * Обработчик кнопки "Позже 😔" при пустом списке
 * Переходит к основному вечернему посту с выбором сценария
 */
export async function handleJoyLater(ctx: BotContext, bot: Telegraf, scheduler: Scheduler) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const userId = ctx.from?.id;

    if (!userId) {
      botLogger.error({ channelMessageId }, 'Нет userId в контексте joy_later');
      await ctx.answerCbQuery('Ошибка: пользователь не определен');
      return;
    }

    await ctx.answerCbQuery('Переходим к выбору сценария');

    botLogger.info(
      { action: 'joy_later', channelMessageId, userId },
      '😔 Пользователь отложил заполнение списка радости'
    );

    const chatId = ctx.callbackQuery.message?.chat?.id!;
    const replyToMessageId = ctx.callbackQuery.message?.message_id!;
    const messageThreadId = (ctx.callbackQuery.message as any)?.message_thread_id;

    // Обновляем/создаем Joy-сессию для правильной маршрутизации сообщений
    ensureJoySession(scheduler, userId, channelMessageId, chatId, messageThreadId);

    // Создаем JoyHandler для отправки БЕЗ реплая
    const { JoyHandler } = await import('../../joy-handler');
    const joyHandler = new JoyHandler(
      bot,
      chatId,
      userId,
      channelMessageId,
      scheduler.joyPendingMessages,
      scheduler.joyLastButtonMessageId,
      scheduler.joyListMessageId,
      scheduler.joyAddingSessions,
      scheduler.joyListShown,
      messageThreadId
    );

    // Переход к вечернему посту - выбор сценария
    const transitionText = `Хорошо, можешь вернуться к списку в любое время по команде /joy

<b>По какому сценарию мы сегодня поработаем?</b>`;

    await joyHandler['sendMessage'](transitionText, undefined, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('Глубокая работа 🧠', `scenario_deep_${channelMessageId}`)],
        [Markup.button.callback('Упрощенный вариант 💫', `scenario_simplified_${channelMessageId}`)]
      ])
    });

    botLogger.info({ userId, channelMessageId }, '✅ Показан выбор сценария после отложенного списка');
  } catch (error) {
    botLogger.error(
      { error: (error as Error).message, stack: (error as Error).stack },
      'Ошибка обработки кнопки joy_later'
    );

    try {
      await ctx.answerCbQuery('Произошла ошибка, попробуй еще раз 🙏');
    } catch (answerError) {
      botLogger.error({ answerError }, 'Не удалось отправить answerCbQuery после ошибки');
    }
  }
}
