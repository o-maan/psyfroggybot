import { Telegraf, Markup } from 'telegraf';
import { botLogger } from '../../logger';
import type { BotContext } from '../../types';
import { sendToUser } from '../../utils/send-to-user';
import { db, disableDMMode, disableChannelMode, enableChannelMode, clearAllJoySources, getUserByChatId } from '../../db';

/**
 * Обработчик отмены сброса (общая кнопка для обоих режимов)
 */
export async function handleResetCancel(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id || 0;

  if (!chatId) {
    botLogger.error({ userId }, 'ChatId не определен в handleResetCancel');
    return;
  }

  try {
    // Удаляем сообщение с кнопками
    await ctx.deleteMessage();

    await sendToUser(ctx.telegram as any, chatId, userId, 'Отменено ☑️');

    await ctx.answerCbQuery();
    botLogger.info({ userId, chatId }, '✅ Сброс отменен');
  } catch (error) {
    const err = error as Error;
    botLogger.error(
      {
        error: err.message,
        stack: err.stack,
        chatId,
        userId,
      },
      'Ошибка при отмене сброса'
    );
    await ctx.answerCbQuery('Произошла ошибка');
  }
}

/**
 * Обработчик подтверждения сброса данных в ЛС
 */
export async function handleResetConfirmDM(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id || 0;

  botLogger.info({ chatId, userId, hasChat: !!ctx.chat }, '🔍 handleResetConfirmDM вызван');

  if (!chatId) {
    botLogger.error({ userId }, 'ChatId не определен в handleResetConfirmDM');
    await ctx.answerCbQuery('Ошибка: ChatId не определен');
    return;
  }

  try {
    botLogger.info({ userId, chatId }, '🔄 Начинается сброс данных ЛС');

    // Получаем внутренний ID пользователя из БД
    botLogger.info({ chatId }, '🔍 Получаем пользователя из БД');
    const user = getUserByChatId(chatId);
    botLogger.info({ chatId, user: user ? 'найден' : 'не найден', userId: user?.id }, '🔍 Результат getUserByChatId');

    if (!user) {
      botLogger.error({ chatId, userId }, 'Пользователь не найден в БД');
      await ctx.answerCbQuery('Пользователь не найден');
      return;
    }
    const internalUserId = user.id;
    botLogger.info({ internalUserId, chatId }, '✅ Internal user ID получен');

    // Удаляем ВСЕ данные пользователя из БД
    botLogger.info({ chatId, internalUserId }, '🗑️ Начинаем удаление данных');

    // 1. Отключаем режим ЛС
    try {
      botLogger.info({ chatId }, '🔄 Шаг 1: Отключаем режим ЛС');
      disableDMMode(chatId);
      botLogger.info({ chatId }, '✅ Шаг 1 выполнен');
    } catch (e) {
      botLogger.error({ error: e, chatId }, '❌ Ошибка на шаге 1');
      throw e;
    }

    // 2. Удаляем все сообщения
    try {
      botLogger.info({ internalUserId }, '🔄 Шаг 2: Удаляем сообщения');
      db.query('DELETE FROM messages WHERE user_id = ?').run(internalUserId);
      botLogger.info({ internalUserId }, '✅ Шаг 2 выполнен');
    } catch (e) {
      botLogger.error({ error: e, internalUserId }, '❌ Ошибка на шаге 2');
      throw e;
    }

    // 3. Удаляем интерактивные посты
    try {
      botLogger.info({ internalUserId }, '🔄 Шаг 3: Удаляем интерактивные посты');
      db.query('DELETE FROM interactive_posts WHERE user_id = ?').run(internalUserId);
      botLogger.info({ internalUserId }, '✅ Шаг 3 выполнен');
    } catch (e) {
      botLogger.error({ error: e, internalUserId }, '❌ Ошибка на шаге 3');
      throw e;
    }

    // 4. Удаляем утренние посты
    try {
      botLogger.info({ internalUserId }, '🔄 Шаг 4: Удаляем утренние посты');
      db.query('DELETE FROM morning_posts WHERE user_id = ?').run(internalUserId);
      botLogger.info({ internalUserId }, '✅ Шаг 4 выполнен');
    } catch (e) {
      botLogger.error({ error: e, internalUserId }, '❌ Ошибка на шаге 4');
      throw e;
    }

    // 5. Удаляем источники радости
    try {
      botLogger.info({ chatId }, '🔄 Шаг 5: Удаляем источники радости');
      clearAllJoySources(chatId);
      botLogger.info({ chatId }, '✅ Шаг 5 выполнен');
    } catch (e) {
      botLogger.error({ error: e, chatId }, '❌ Ошибка на шаге 5');
      throw e;
    }

    // 6. Удаляем позитивные события
    try {
      botLogger.info({ internalUserId }, '🔄 Шаг 6: Удаляем позитивные события');
      db.query('DELETE FROM positive_events WHERE user_id = ?').run(internalUserId);
      botLogger.info({ internalUserId }, '✅ Шаг 6 выполнен');
    } catch (e) {
      botLogger.error({ error: e, internalUserId }, '❌ Ошибка на шаге 6');
      throw e;
    }

    // 7. Удаляем негативные события
    try {
      botLogger.info({ internalUserId }, '🔄 Шаг 7: Удаляем негативные события');
      db.query('DELETE FROM negative_events WHERE user_id = ?').run(internalUserId);
      botLogger.info({ internalUserId }, '✅ Шаг 7 выполнен');
    } catch (e) {
      botLogger.error({ error: e, internalUserId }, '❌ Ошибка на шаге 7');
      throw e;
    }

    // 8. Сбрасываем индексы сообщений
    try {
      botLogger.info({ internalUserId }, '🔄 Шаг 8: Сбрасываем индексы сообщений');
      db.query('DELETE FROM morning_message_indexes WHERE user_id = ?').run(internalUserId);
      botLogger.info({ internalUserId }, '✅ Шаг 8 выполнен');
    } catch (e) {
      botLogger.error({ error: e, internalUserId }, '❌ Ошибка на шаге 8');
      throw e;
    }

    // 9. Сбрасываем checkpoint списка радости
    try {
      botLogger.info({ internalUserId }, '🔄 Шаг 9: Сбрасываем checkpoint списка радости');
      db.query('DELETE FROM joy_list_checkpoints WHERE user_id = ?').run(internalUserId);
      botLogger.info({ internalUserId }, '✅ Шаг 9 выполнен');
    } catch (e) {
      botLogger.error({ error: e, internalUserId }, '❌ Ошибка на шаге 9');
      throw e;
    }

    // 10. Сбрасываем счетчик вечерних постов
    try {
      botLogger.info({ chatId }, '🔄 Шаг 10: Сбрасываем счетчик вечерних постов');
      db.query('UPDATE users SET evening_posts_count = 0 WHERE chat_id = ?').run(chatId);
      botLogger.info({ chatId }, '✅ Шаг 10 выполнен');
    } catch (e) {
      botLogger.error({ error: e, chatId }, '❌ Ошибка на шаге 10');
      throw e;
    }

    // 11. Сбрасываем дату первого вечернего поста
    try {
      botLogger.info({ chatId }, '🔄 Шаг 11: Сбрасываем дату первого вечернего поста');
      db.query('UPDATE users SET first_evening_post_date = NULL WHERE chat_id = ?').run(chatId);
      botLogger.info({ chatId }, '✅ Шаг 11 выполнен');
    } catch (e) {
      botLogger.error({ error: e, chatId }, '❌ Ошибка на шаге 11');
      throw e;
    }

    // 12. Сбрасываем имя, пол, запрос, состояние онбординга
    // ВАЖНО: timezone и timezone_offset имеют NOT NULL constraint, устанавливаем значения по умолчанию
    try {
      botLogger.info({ chatId }, '🔄 Шаг 12: Сбрасываем профиль пользователя');
      db.query(`
        UPDATE users
        SET name = NULL,
            gender = NULL,
            user_request = NULL,
            timezone = 'Europe/Moscow',
            timezone_offset = 180,
            city = NULL,
            onboarding_state = NULL,
            last_response_time = NULL,
            response_count = 0
        WHERE chat_id = ?
      `).run(chatId);
      botLogger.info({ chatId }, '✅ Шаг 12 выполнен');
    } catch (e) {
      botLogger.error({ error: e, chatId }, '❌ Ошибка на шаге 12');
      throw e;
    }

    botLogger.info({ chatId }, '✅ Все данные удалены, отправляем подтверждение');

    // Удаляем сообщение с кнопками
    botLogger.info({ chatId }, '🔄 Удаляем сообщение с кнопками');
    await ctx.deleteMessage();

    // Отправляем сообщение об успешном сбросе с кнопкой "Старт"
    botLogger.info({ chatId }, '🔄 Отправляем сообщение об успешном сбросе');
    await sendToUser(
      ctx.telegram as any,
      chatId,
      null, // не адаптируем под пол - это системное сообщение
      'Ты можешь начать заново 😊',
      {
        ...Markup.inlineKeyboard([
          [Markup.button.callback('Старт 🚀', 'onboarding_start')]
        ])
      }
    );

    botLogger.info({ chatId }, '🔄 Отвечаем на callback query');
    await ctx.answerCbQuery();
    botLogger.info({ userId, chatId }, '✅ Данные ЛС успешно сброшены');
  } catch (error) {
    const err = error as Error;
    botLogger.error(
      {
        error: err.message,
        stack: err.stack,
        chatId,
        userId,
      },
      'Ошибка при сбросе данных ЛС'
    );
    await ctx.answerCbQuery('Произошла ошибка при сбросе данных');
  }
}

/**
 * Обработчик подтверждения сброса данных в канале
 */
export async function handleResetConfirmChannel(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id || 0;

  if (!chatId) {
    botLogger.error({ userId }, 'ChatId не определен в handleResetConfirmChannel');
    return;
  }

  try {
    botLogger.info({ userId, chatId }, '🔄 Начинается сброс данных канала');

    // Получаем внутренний ID пользователя из БД
    const user = getUserByChatId(chatId);
    if (!user) {
      botLogger.error({ chatId, userId }, 'Пользователь не найден в БД');
      await ctx.answerCbQuery('Пользователь не найден');
      return;
    }
    const internalUserId = user.id;

    // Удаляем ВСЕ данные пользователя из КАНАЛА
    // 1. Отключаем режим канала
    disableChannelMode(chatId);

    // 2. Удаляем все сообщения
    db.query('DELETE FROM messages WHERE user_id = ?').run(internalUserId);

    // 3. Удаляем интерактивные посты
    db.query('DELETE FROM interactive_posts WHERE user_id = ?').run(internalUserId);

    // 4. Удаляем утренние посты
    db.query('DELETE FROM morning_posts WHERE user_id = ?').run(internalUserId);

    // 5. Удаляем источники радости
    clearAllJoySources(chatId);

    // 6. Удаляем позитивные события
    db.query('DELETE FROM positive_events WHERE user_id = ?').run(internalUserId);

    // 7. Удаляем негативные события
    db.query('DELETE FROM negative_events WHERE user_id = ?').run(internalUserId);

    // 8. Сбрасываем индексы сообщений
    db.query('DELETE FROM morning_message_indexes WHERE user_id = ?').run(internalUserId);

    // 9. Сбрасываем checkpoint списка радости
    db.query('DELETE FROM joy_list_checkpoints WHERE user_id = ?').run(internalUserId);

    // 10. Сбрасываем счетчик вечерних постов
    db.query('UPDATE users SET evening_posts_count = 0 WHERE chat_id = ?').run(chatId);

    // 11. Сбрасываем дату первого вечернего поста
    db.query('UPDATE users SET first_evening_post_date = NULL WHERE chat_id = ?').run(chatId);

    // НЕ удаляем имя, пол, запрос, таймзону - они остаются для канала

    // Удаляем сообщение с кнопками
    await ctx.deleteMessage();

    // Отправляем сообщение об успешном сбросе с кнопкой "Запустить рассылку в канал"
    await sendToUser(
      ctx.telegram as any,
      chatId,
      userId,
      'Ты можешь начать заново',
      {
        ...Markup.inlineKeyboard([
          [Markup.button.callback('Запустить рассылку в канал 🚀', 'start_channel_from_reset')]
        ])
      }
    );

    await ctx.answerCbQuery();
    botLogger.info({ userId, chatId }, '✅ Данные канала успешно сброшены');
  } catch (error) {
    const err = error as Error;
    botLogger.error(
      {
        error: err.message,
        stack: err.stack,
        chatId,
        userId,
      },
      'Ошибка при сбросе данных канала'
    );
    await ctx.answerCbQuery('Произошла ошибка при сбросе данных');
  }
}

/**
 * Обработчик кнопки "Запустить рассылку в канал" после сброса
 */
export async function handleStartChannelFromReset(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id || 0;

  if (!chatId) {
    botLogger.error({ userId }, 'ChatId не определен в handleStartChannelFromReset');
    return;
  }

  try {
    // Включаем режим канала
    enableChannelMode(chatId);

    // Удаляем сообщение с кнопкой
    await ctx.deleteMessage();

    await sendToUser(
      ctx.telegram as any,
      chatId,
      userId,
      '📺 Режим канала включен!\n\n' +
        'Автоматическая рассылка в канал запущена.\n\n' +
        'Чтобы остановить, используй команду /stop_channel'
    );

    await ctx.answerCbQuery();
    botLogger.info({ userId, chatId }, '✅ Режим канала включен после сброса');
  } catch (error) {
    const err = error as Error;
    botLogger.error(
      {
        error: err.message,
        stack: err.stack,
        chatId,
        userId,
      },
      'Ошибка при включении режима канала после сброса'
    );
    await ctx.answerCbQuery('Произошла ошибка');
  }
}

/**
 * Регистрация callback handlers для кнопок reset
 */
export function registerResetCallbacks(bot: Telegraf) {
  bot.action('reset_cancel', handleResetCancel);
  bot.action('reset_confirm_dm', handleResetConfirmDM);
  bot.action('reset_confirm_channel', handleResetConfirmChannel);
  bot.action('start_channel_from_reset', handleStartChannelFromReset);
}
