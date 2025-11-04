import type { BotContext } from '../../types';
import { botLogger } from '../../logger';
import { ShortJoyHandler } from '../../short-joy-handler';
import { Scheduler } from '../../scheduler';
import { Telegraf } from 'telegraf';

/**
 * Callback обработчики для SHORT JOY (команда /joy)
 * Используют механизм накопления сообщений из ShortJoyHandler (аналог JoyHandler)
 */

/**
 * Обработчик кнопки "Добавить 🔥" в SHORT JOY (вводная логика)
 * Сохраняет накопленные сообщения пользователя в список радости
 */
export async function handleShortJoyAdd(ctx: BotContext, bot: Telegraf, scheduler: Scheduler) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const userId = ctx.from?.id;

    if (!userId) {
      botLogger.error({ channelMessageId }, 'Нет userId в контексте short_joy_add');
      await ctx.answerCbQuery('Ошибка: пользователь не определен');
      return;
    }

    await ctx.answerCbQuery('Добавляю в список...⚡️');

    botLogger.info(
      { action: 'short_joy_add', channelMessageId, userId },
      '🔥 Нажата кнопка "Добавить" в SHORT JOY'
    );

    const chatId = ctx.callbackQuery.message?.chat?.id!;
    const messageThreadId = (ctx.callbackQuery.message as any)?.message_thread_id;

    // Создаем экземпляр ShortJoyHandler
    const handler = new ShortJoyHandler(
      bot,
      chatId,
      userId,
      channelMessageId,
      scheduler.shortJoyPendingMessages,
      scheduler.shortJoyLastButtonMessageId,
      scheduler.shortJoyListMessageId,
      scheduler.shortJoyAddingSessions,
      scheduler.shortJoyListShown,
      messageThreadId
    );

    // Сохраняем источники радости
    await handler.saveJoySources();
  } catch (error) {
    botLogger.error({ error }, 'Ошибка в handleShortJoyAdd');
    await ctx.answerCbQuery('Произошла ошибка');
  }
}

/**
 * Обработчик кнопки "Дай подсказку 🙌🏻" в SHORT JOY (вводная логика)
 */
export async function handleShortJoyHint(ctx: BotContext, bot: Telegraf, scheduler: Scheduler) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const userId = ctx.from?.id;

    if (!userId) {
      botLogger.error({ channelMessageId }, 'Нет userId в контексте short_joy_hint');
      await ctx.answerCbQuery('Ошибка: пользователь не определен');
      return;
    }

    await ctx.answerCbQuery();

    botLogger.info(
      { action: 'short_joy_hint', channelMessageId, userId },
      '🙌🏻 Нажата кнопка "Дай подсказку" в SHORT JOY'
    );

    const chatId = ctx.callbackQuery.message?.chat?.id!;
    const messageThreadId = (ctx.callbackQuery.message as any)?.message_thread_id;

    // Текст подсказки (такой же как в обычной Joy)
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

    // Создаем экземпляр ShortJoyHandler для отправки
    const handler = new ShortJoyHandler(
      bot,
      chatId,
      userId,
      channelMessageId,
      scheduler.shortJoyPendingMessages,
      scheduler.shortJoyLastButtonMessageId,
      scheduler.shortJoyListMessageId,
      scheduler.shortJoyAddingSessions,
      scheduler.shortJoyListShown,
      messageThreadId
    );

    // Отправляем подсказку БЕЗ реплая (используем private метод sendMessage)
    await handler['sendMessage'](hintText, undefined, {
      parse_mode: 'HTML'
    });

    // Устанавливаем флаг активной сессии добавления (пользователь может сразу писать после подсказки)
    const sessionKey = `${userId}_${channelMessageId}`;
    scheduler.shortJoyAddingSessions.set(sessionKey, true);

    botLogger.info({ userId, chatId, channelMessageId }, '✅ Подсказка SHORT JOY отправлена');
  } catch (error) {
    botLogger.error({ error }, 'Ошибка в handleShortJoyHint');
    await ctx.answerCbQuery('Произошла ошибка');
  }
}

/**
 * Обработчик кнопки "Добавить еще ⚡️" в SHORT JOY (после показа списка)
 * Активирует режим добавления новых источников радости
 */
export async function handleShortJoyAddMore(ctx: BotContext, bot: Telegraf, scheduler: Scheduler) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const userId = ctx.from?.id;

    if (!userId) {
      botLogger.error({ channelMessageId }, 'Нет userId в контексте short_joy_add_more');
      await ctx.answerCbQuery('Ошибка: пользователь не определен');
      return;
    }

    await ctx.answerCbQuery('Жду новые источники радости ⚡️');

    botLogger.info(
      { action: 'short_joy_add_more', channelMessageId, userId },
      '⚡️ Нажата кнопка "Добавить еще" в SHORT JOY'
    );

    const chatId = ctx.callbackQuery.message?.chat?.id!;
    const messageThreadId = (ctx.callbackQuery.message as any)?.message_thread_id;

    // КРИТИЧЕСКИ ВАЖНО: Обновляем или создаем SHORT joy-сессию
    let shortJoySession = scheduler['shortJoySessions'].get(userId);
    if (shortJoySession) {
      shortJoySession.shortJoyId = channelMessageId;
      shortJoySession.chatId = chatId;
      shortJoySession.messageThreadId = messageThreadId;
    } else {
      shortJoySession = {
        shortJoyId: channelMessageId,
        userId,
        chatId,
        messageThreadId,
        isIntro: false // Это уже НЕ вводная логика
      };
    }
    scheduler['shortJoySessions'].set(userId, shortJoySession);

    botLogger.info(
      { userId, channelMessageId, chatId, messageThreadId },
      '💾 Обновлена/создана SHORT joy-сессия при "Добавить еще"'
    );

    // Создаем handler для активации режима добавления
    const { ShortJoyHandler } = await import('../../short-joy-handler');
    const handler = new ShortJoyHandler(
      bot,
      chatId,
      userId,
      channelMessageId,
      scheduler.shortJoyPendingMessages,
      scheduler.shortJoyLastButtonMessageId,
      scheduler.shortJoyListMessageId,
      scheduler.shortJoyAddingSessions,
      scheduler.shortJoyListShown,
      messageThreadId
    );

    // Запускаем сессию добавления
    await handler.startAddMoreSession();

    botLogger.info({ userId, channelMessageId }, '✅ Активирован режим добавления в SHORT JOY');
  } catch (error) {
    botLogger.error({ error }, 'Ошибка в handleShortJoyAddMore');
    await ctx.answerCbQuery('Произошла ошибка');
  }
}

/**
 * Обработчик кнопки "Посмотреть список 📝" в SHORT JOY
 * Показывает полный список источников радости
 */
export async function handleShortJoyView(ctx: BotContext, bot: Telegraf, scheduler: Scheduler) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const userId = ctx.from?.id;

    if (!userId) {
      botLogger.error({ channelMessageId }, 'Нет userId в контексте short_joy_view');
      await ctx.answerCbQuery('Ошибка: пользователь не определен');
      return;
    }

    await ctx.answerCbQuery();

    botLogger.info(
      { action: 'short_joy_view', channelMessageId, userId },
      '📝 Нажата кнопка "Посмотреть список" в SHORT JOY'
    );

    const chatId = ctx.callbackQuery.message?.chat?.id!;
    const messageThreadId = (ctx.callbackQuery.message as any)?.message_thread_id;

    // Создаем handler для показа списка
    const { ShortJoyHandler } = await import('../../short-joy-handler');
    const handler = new ShortJoyHandler(
      bot,
      chatId,
      userId,
      channelMessageId,
      scheduler.shortJoyPendingMessages,
      scheduler.shortJoyLastButtonMessageId,
      scheduler.shortJoyListMessageId,
      scheduler.shortJoyAddingSessions,
      scheduler.shortJoyListShown,
      messageThreadId
    );

    // Показываем список
    await handler.showJoyList();

    botLogger.info({ userId, channelMessageId }, '✅ Показан список в SHORT JOY');
  } catch (error) {
    botLogger.error({ error }, 'Ошибка в handleShortJoyView');
    await ctx.answerCbQuery('Произошла ошибка');
  }
}

/**
 * Обработчик кнопки "Завершить" в SHORT JOY
 * Показывает финальное сообщение и очищает сессию
 */
export async function handleShortJoyFinish(ctx: BotContext, bot: Telegraf, scheduler: Scheduler) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const userId = ctx.from?.id;

    if (!userId) {
      botLogger.error({ channelMessageId }, 'Нет userId в контексте short_joy_finish');
      await ctx.answerCbQuery('Ошибка: пользователь не определен');
      return;
    }

    await ctx.answerCbQuery();

    botLogger.info(
      { action: 'short_joy_finish', channelMessageId, userId },
      '✅ Нажата кнопка "Завершить" в SHORT JOY'
    );

    const chatId = ctx.callbackQuery.message?.chat?.id!;
    const messageThreadId = (ctx.callbackQuery.message as any)?.message_thread_id;

    // Финальное сообщение
    const finishText = `Ты можешь возвращаться к своему списку в любое время по команде /joy и пополнять его ❤️‍🔥
Внедряй эти пункты в свою жизнь! 🔥`;

    const sendOptions: any = {};
    if (messageThreadId) {
      sendOptions.reply_to_message_id = messageThreadId;
    }

    await bot.telegram.sendMessage(chatId, finishText, sendOptions);

    // Очищаем SHORT JOY Maps
    const sessionKey = `${userId}_${channelMessageId}`;
    scheduler.shortJoyPendingMessages.delete(sessionKey);
    scheduler.shortJoyLastButtonMessageId.delete(sessionKey);
    scheduler.shortJoyListMessageId.delete(sessionKey);
    scheduler.shortJoyAddingSessions.delete(sessionKey);
    scheduler.shortJoyListShown.delete(sessionKey);
    scheduler['shortJoySessions'].delete(userId);

    botLogger.info({ userId, chatId, channelMessageId }, '✅ SHORT JOY завершен, сессия очищена');
  } catch (error) {
    botLogger.error({ error }, 'Ошибка в handleShortJoyFinish');
    await ctx.answerCbQuery('Произошла ошибка');
  }
}
