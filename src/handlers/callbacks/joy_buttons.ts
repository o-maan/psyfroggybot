import type { BotContext } from '../../types';
import { botLogger } from '../../logger';
import { JoyHandler } from '../../joy-handler';
import { Scheduler } from '../../scheduler';
import { Telegraf } from 'telegraf';

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

    // Создаем экземпляр JoyHandler с общими Map из scheduler
    const joyHandler = new JoyHandler(
      bot,
      chatId,
      userId,
      channelMessageId,
      scheduler.joyPendingMessages,
      scheduler.joyLastButtonMessageId
    );

    // Сохраняем источники радости
    await joyHandler.saveJoySources(replyToMessageId);

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

    // Создаем экземпляр JoyHandler с общими Map из scheduler
    const joyHandler = new JoyHandler(
      bot,
      chatId,
      userId,
      channelMessageId,
      scheduler.joyPendingMessages,
      scheduler.joyLastButtonMessageId
    );

    // Начинаем новую сессию добавления
    await joyHandler.startAddMoreSession(replyToMessageId);

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

    // Создаем экземпляр JoyHandler с общими Map из scheduler
    const joyHandler = new JoyHandler(
      bot,
      chatId,
      userId,
      channelMessageId,
      scheduler.joyPendingMessages,
      scheduler.joyLastButtonMessageId
    );

    // Показываем список
    await joyHandler.showJoyList(replyToMessageId);

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
