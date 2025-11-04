import { Context, Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';
import { botLogger } from '../../logger';

/**
 * Обработчики удаления/редактирования для SHORT JOY
 * (Основные обработчики add/hint/finish находятся в short_joy_buttons.ts)
 */

/**
 * Обработчик кнопки "Убрать лишнее" в SHORT JOY
 */
export async function handleShortJoyRemove(ctx: Context, bot: Telegraf, scheduler: Scheduler) {
  try {
    const userId = ctx.from?.id;
    if (!userId) {
      botLogger.error('handleShortJoyRemove: userId не определен');
      await ctx.answerCbQuery('Ошибка: пользователь не определен');
      return;
    }

    await ctx.answerCbQuery('Начинаем удаление 🗑️');

    const session = scheduler.getShortJoySession(userId);
    const shortJoyId = session?.shortJoyId || 0;

    botLogger.info(
      { action: 'short_joy_remove', shortJoyId, userId },
      '🗑️ Нажата кнопка "Убрать лишнее" в SHORT JOY'
    );

    const { getAllJoySources } = await import('../../db');
    const sources = getAllJoySources(userId);

    if (sources.length === 0) {
      await ctx.answerCbQuery('Список пуст 🤷‍♂️');
      return;
    }

    const chatId = ctx.chat?.id;
    const messageThreadId = (ctx.callbackQuery?.message as any)?.message_thread_id;

    if (!chatId) {
      botLogger.error({ userId }, 'handleShortJoyRemove: chatId не определен');
      return;
    }

    // ГИБРИДНАЯ ЛОГИКА: ≤10 пунктов = кнопки, >10 = текстовый ввод
    if (sources.length <= 10) {
      // КНОПОЧНЫЙ ИНТЕРФЕЙС (текущая логика)
      let removeText = '<b>Что хочешь убрать?</b>\n\n';

      const keyboard: any[] = [];
      sources.forEach((source, index) => {
        removeText += `${index + 1}. ${source.text}\n`;
        keyboard.push([{
          text: `❌ ${index + 1}. ${source.text.substring(0, 30)}${source.text.length > 30 ? '...' : ''}`,
          callback_data: `short_joy_remove_item_${source.id}`
        }]);
      });

      removeText += '\nНажми на пункт, чтобы удалить его:';

      // Добавляем кнопки "Очистить весь список" и "Назад"
      keyboard.push([
        { text: 'Очистить весь список 🗑', callback_data: `short_joy_clear_all_${shortJoyId}` }
      ]);
      keyboard.push([
        { text: '← Назад', callback_data: `short_joy_back_to_list_${shortJoyId}` }
      ]);

      // Удаляем предыдущее сообщение с кнопками удаления, если оно есть
      const sessionKey = `${userId}_${shortJoyId}`;
      const lastRemoveMessageId = scheduler.shortJoyLastButtonMessageId?.get(sessionKey);
      if (lastRemoveMessageId) {
        try {
          await bot.telegram.deleteMessage(chatId, lastRemoveMessageId);
        } catch (error) {
          botLogger.debug('Не удалось удалить предыдущее сообщение с кнопками удаления');
        }
      }

      // Подготавливаем опции отправки
      const sendOptions: any = {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      };
      if (messageThreadId) {
        sendOptions.reply_to_message_id = messageThreadId;
      }

      const removeMessage = await bot.telegram.sendMessage(chatId, removeText, sendOptions);

      // Сохраняем ID сообщения с кнопками для удаления следующего
      if (!scheduler.shortJoyLastButtonMessageId) {
        scheduler.shortJoyLastButtonMessageId = new Map();
      }
      scheduler.shortJoyLastButtonMessageId.set(sessionKey, removeMessage.message_id);

      botLogger.info({ userId, chatId, sourcesCount: sources.length }, '✅ Показан кнопочный интерфейс удаления в SHORT JOY');
    } else {
      // ТЕКСТОВЫЙ ИНТЕРФЕЙС (для >10 пунктов, аналогично обычной Joy)
      const instructionText = `<b>Что хочешь убрать?</b>

${sources.map((s, i) => `${i + 1}. ${s.text}`).join('\n')}

Напиши номера пунктов, которые хочешь удалить (например: 1, 5 и 7)`;

      const { Markup } = await import('telegraf');
      const shortJoyButtonsOptions: any = {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('Добавить еще ⚡️', `short_joy_add_more_${shortJoyId}`)],
          [Markup.button.callback('Очистить весь список', `short_joy_clear_all_${shortJoyId}`)],
          [Markup.button.callback('Завершить', `short_joy_finish_${shortJoyId}`)]
        ])
      };

      if (messageThreadId) {
        shortJoyButtonsOptions.reply_to_message_id = messageThreadId;
      }

      const instructionMessage = await bot.telegram.sendMessage(chatId, instructionText, shortJoyButtonsOptions);

      // Сохраняем состояние режима удаления
      const sessionKey = `${userId}_${shortJoyId}`;
      if (!scheduler.shortJoyRemovalSessions) {
        scheduler.shortJoyRemovalSessions = new Map();
      }
      scheduler.shortJoyRemovalSessions.set(sessionKey, {
        instructionMessageId: instructionMessage.message_id,
        numbersToDelete: new Map<number, number[]>(), // Map для поддержки редактирования
        state: 'waiting_numbers'
      });

      botLogger.info({ userId, chatId, sourcesCount: sources.length }, '✅ Показан текстовый интерфейс удаления в SHORT JOY');
    }
  } catch (error) {
    botLogger.error({ error, userId: ctx.from?.id }, 'Ошибка handleShortJoyRemove');

    try {
      await ctx.answerCbQuery('Произошла ошибка, попробуй еще раз 🙏');
    } catch (answerError) {
      botLogger.error({ answerError }, 'Не удалось отправить answerCbQuery после ошибки');
    }
  }
}

/**
 * Обработчик удаления конкретного пункта в SHORT JOY
 */
export async function handleShortJoyRemoveItem(ctx: Context, bot: Telegraf, scheduler: Scheduler) {
  try {
    const userId = ctx.from?.id;
    if (!userId) {
      botLogger.error('handleShortJoyRemoveItem: userId не определен');
      await ctx.answerCbQuery('Ошибка: пользователь не определен');
      return;
    }

    // Извлекаем ID источника из callback_data
    const data = (ctx.callbackQuery as any).data;
    const match = data.match(/short_joy_remove_item_(\d+)/);
    if (!match) {
      await ctx.answerCbQuery('Ошибка: неверный формат данных');
      return;
    }

    const sourceId = parseInt(match[1]);

    const { deleteJoySourcesByIds, updateJoyCheckpoint } = await import('../../db');

    // Удаляем источник
    deleteJoySourcesByIds(userId, [sourceId]);

    // Обновляем checkpoint
    updateJoyCheckpoint(userId, new Date().toISOString());

    await ctx.answerCbQuery('Удалено ✅');

    // УДАЛЯЕМ ТЕКУЩЕЕ СООБЩЕНИЕ С КНОПКАМИ ПЕРЕД ОБНОВЛЕНИЕМ
    const currentMessageId = ctx.callbackQuery?.message?.message_id;
    const chatId = ctx.chat?.id;
    if (currentMessageId && chatId) {
      try {
        await bot.telegram.deleteMessage(chatId, currentMessageId);
      } catch (error) {
        botLogger.debug('Не удалось удалить текущее сообщение с кнопками удаления');
      }
    }

    // Обновляем список или возвращаемся к главному меню
    const { getAllJoySources } = await import('../../db');
    const sources = getAllJoySources(userId);

    if (sources.length === 0) {
      // Список стал пустым - показываем вводную логику
      if (chatId) {
        const messageThreadId = (ctx.callbackQuery?.message as any)?.message_thread_id;
        await scheduler.sendShortJoy(userId, chatId, messageThreadId);
      }
    } else {
      // Обновляем список для удаления
      await handleShortJoyRemove(ctx, bot, scheduler);
    }

    botLogger.info({ userId, sourceId }, '✅ Источник удален в SHORT JOY');
  } catch (error) {
    botLogger.error({ error, userId: ctx.from?.id }, 'Ошибка handleShortJoyRemoveItem');
    await ctx.answerCbQuery('Ошибка при удалении');
  }
}

/**
 * Обработчик кнопки "Назад" (возврат к списку с основными кнопками)
 */
export async function handleShortJoyBackToList(ctx: Context, bot: Telegraf, scheduler: Scheduler) {
  try {
    await ctx.answerCbQuery();

    const userId = ctx.from?.id;
    if (!userId) {
      botLogger.error('handleShortJoyBackToList: userId не определен');
      return;
    }

    const chatId = ctx.chat?.id;
    if (!chatId) {
      botLogger.error({ userId }, 'handleShortJoyBackToList: chatId не определен');
      return;
    }

    const messageThreadId = (ctx.callbackQuery?.message as any)?.message_thread_id;

    // Показываем список с основными кнопками
    await scheduler.sendShortJoyListUpdate(userId, chatId, messageThreadId);

    botLogger.info({ userId, chatId }, '✅ Возврат к списку SHORT JOY');
  } catch (error) {
    botLogger.error({ error, userId: ctx.from?.id }, 'Ошибка handleShortJoyBackToList');
  }
}

/**
 * Обработчик подтверждения удаления (кнопка "Готово" при текстовом вводе номеров, >10 пунктов)
 */
export async function handleShortJoyRemoveConfirm(ctx: Context, bot: Telegraf, scheduler: Scheduler) {
  try {
    const userId = ctx.from?.id;
    if (!userId) {
      botLogger.error('handleShortJoyRemoveConfirm: userId не определен');
      await ctx.answerCbQuery('Ошибка: пользователь не определен');
      return;
    }

    await ctx.answerCbQuery('Удаляю...');

    const session = scheduler.getShortJoySession(userId);
    const shortJoyId = session?.shortJoyId || 0;
    const sessionKey = `${userId}_${shortJoyId}`;

    const removalSession = scheduler.shortJoyRemovalSessions?.get(sessionKey);

    if (!removalSession) {
      await ctx.answerCbQuery('Не выбраны пункты для удаления');
      return;
    }

    // Собираем все уникальные номера из всех сообщений пользователя
    const allNumbers = new Set<number>();
    for (const nums of removalSession.numbersToDelete.values()) {
      nums.forEach((n: number) => allNumbers.add(n));
    }

    if (allNumbers.size === 0) {
      await ctx.answerCbQuery('Не выбраны пункты для удаления');
      return;
    }

    // Получаем все источники для получения ID
    const { getAllJoySources, deleteJoySourcesByIds, updateJoyCheckpoint } = await import('../../db');
    const allSources = getAllJoySources(userId);

    // Конвертируем номера в ID (номера с 1, индексы с 0)
    const idsToDelete: number[] = [];
    for (const num of allNumbers) {
      if (num >= 1 && num <= allSources.length) {
        idsToDelete.push(allSources[num - 1].id);
      }
    }

    if (idsToDelete.length === 0) {
      await ctx.answerCbQuery('Неверные номера');
      return;
    }

    // Удаляем источники
    deleteJoySourcesByIds(userId, idsToDelete);

    // Обновляем checkpoint
    updateJoyCheckpoint(userId, new Date().toISOString());

    // Очищаем состояние удаления
    scheduler.shortJoyRemovalSessions?.delete(sessionKey);

    const chatId = ctx.chat?.id;
    const messageThreadId = (ctx.callbackQuery?.message as any)?.message_thread_id;

    if (!chatId) {
      botLogger.error({ userId }, 'handleShortJoyRemoveConfirm: chatId не определен');
      return;
    }

    // Отправляем подтверждение
    const confirmationText = `Список отредактирован ☑️`;

    const sendOptions: any = { parse_mode: 'HTML' };
    if (messageThreadId) {
      sendOptions.reply_to_message_id = messageThreadId;
    }

    await bot.telegram.sendMessage(chatId, confirmationText, sendOptions);

    // Проверяем, остались ли источники
    const remainingSources = getAllJoySources(userId);

    if (remainingSources.length === 0) {
      // Список стал пустым - показываем вводную логику
      await scheduler.sendShortJoy(userId, chatId, messageThreadId);
    } else {
      // Показываем обновленный список
      await scheduler.sendShortJoyListUpdate(userId, chatId, messageThreadId);
    }

    botLogger.info({ userId, deletedCount: idsToDelete.length }, '✅ Источники удалены в SHORT JOY (текстовый ввод)');
  } catch (error) {
    botLogger.error({ error, userId: ctx.from?.id }, 'Ошибка handleShortJoyRemoveConfirm');
    await ctx.answerCbQuery('Ошибка при удалении');
  }
}

/**
 * Обработчик кнопки "Очистить весь список"
 */
export async function handleShortJoyClearAll(ctx: Context, bot: Telegraf, scheduler: Scheduler) {
  try {
    const userId = ctx.from?.id;
    if (!userId) {
      botLogger.error('handleShortJoyClearAll: userId не определен');
      await ctx.answerCbQuery('Ошибка: пользователь не определен');
      return;
    }

    await ctx.answerCbQuery('Подтверди удаление');

    const session = scheduler.getShortJoySession(userId);
    const shortJoyId = session?.shortJoyId || 0;

    botLogger.info(
      { action: 'short_joy_clear_all', shortJoyId, userId },
      '🗑️ Нажата кнопка "Очистить весь список" в SHORT JOY'
    );

    const confirmText = '<b>Ты точно хочешь удалить ВСЕ из списка?</b> Его нужно будет составить заново';

    const chatId = ctx.chat?.id;
    const messageThreadId = (ctx.callbackQuery?.message as any)?.message_thread_id;

    if (!chatId) {
      botLogger.error({ userId }, 'handleShortJoyClearAll: chatId не определен');
      return;
    }

    // Подготавливаем опции отправки (кнопки друг под другом)
    const sendOptions: any = {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Да, удалить 🗑', callback_data: `short_joy_clear_confirm_${shortJoyId}` }],
          [{ text: 'Нет, передумал', callback_data: `short_joy_back_to_list_${shortJoyId}` }]
        ]
      }
    };
    if (messageThreadId) {
      sendOptions.reply_to_message_id = messageThreadId;
    }

    await bot.telegram.sendMessage(chatId, confirmText, sendOptions);

    botLogger.info({ userId, shortJoyId }, '✅ Запрошено подтверждение очистки списка SHORT JOY');
  } catch (error) {
    botLogger.error({ error, userId: ctx.from?.id }, 'Ошибка handleShortJoyClearAll');

    try {
      await ctx.answerCbQuery('Произошла ошибка, попробуй еще раз 🙏');
    } catch (answerError) {
      botLogger.error({ answerError }, 'Не удалось отправить answerCbQuery после ошибки');
    }
  }
}

/**
 * Обработчик подтверждения очистки всего списка
 */
export async function handleShortJoyClearConfirm(ctx: Context, bot: Telegraf, scheduler: Scheduler) {
  try {
    const userId = ctx.from?.id;
    if (!userId) {
      botLogger.error('handleShortJoyClearConfirm: userId не определен');
      await ctx.answerCbQuery('Ошибка: пользователь не определен');
      return;
    }

    await ctx.answerCbQuery('Удаляю весь список...');

    const { clearAllJoySources } = await import('../../db');

    // Очищаем все источники
    clearAllJoySources(userId);

    const session = scheduler.getShortJoySession(userId);
    const shortJoyId = session?.shortJoyId || 0;
    const sessionKey = `${userId}_${shortJoyId}`;

    // Сбрасываем флаг показа списка, так как список теперь пуст
    scheduler.shortJoyListShown?.delete(sessionKey);
    scheduler.shortJoyListMessageId?.delete(sessionKey);

    const chatId = ctx.chat?.id;
    const messageThreadId = (ctx.callbackQuery?.message as any)?.message_thread_id;

    if (!chatId) {
      botLogger.error({ userId }, 'handleShortJoyClearConfirm: chatId не определен');
      return;
    }

    // Создаем ShortJoyHandler для правильной отправки в тред
    const { ShortJoyHandler } = await import('../../short-joy-handler');
    const shortJoyHandler = new ShortJoyHandler(
      bot,
      chatId,
      userId,
      shortJoyId,
      scheduler.shortJoyPendingMessages,
      scheduler.shortJoyLastButtonMessageId,
      scheduler.shortJoyListMessageId,
      scheduler.shortJoyAddingSessions,
      scheduler.shortJoyListShown,
      messageThreadId
    );

    // Показываем предложение создать список заново
    const rebuildText = 'Теперь ты можешь создать список заново\n\n<b>Что хочешь добавить?</b>';

    const sendOptions: any = {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Дай подсказку', callback_data: `short_joy_hint_${shortJoyId}` }],
          [{ text: 'Завершить', callback_data: `short_joy_finish_${shortJoyId}` }]
        ]
      }
    };

    if (messageThreadId) {
      sendOptions.reply_to_message_id = messageThreadId;
    }

    await bot.telegram.sendMessage(chatId, rebuildText, sendOptions);

    // Включаем режим накопления для нового списка
    scheduler.shortJoyAddingSessions.set(sessionKey, true);
    // КРИТИЧЕСКИ ВАЖНО: удаляем флаг удаления, иначе будет работать логика удаления!
    scheduler.shortJoyRemovalSessions?.delete(sessionKey);

    botLogger.info({ userId, shortJoyId }, '✅ Весь список очищен в SHORT JOY, режим накопления включен');
  } catch (error) {
    botLogger.error({ error, userId: ctx.from?.id }, 'Ошибка handleShortJoyClearConfirm');
    await ctx.answerCbQuery('Ошибка при очистке списка');
  }
}
