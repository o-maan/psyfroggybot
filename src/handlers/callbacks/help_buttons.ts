import { Context, Telegraf } from 'telegraf';
import { HelpHandler } from '../../help-handler';
import { botLogger } from '../../logger';

/**
 * Обработчик выбора типа тревоги: Острая тревога
 */
export async function handleHelpAcute(ctx: Context, bot: Telegraf) {
  try {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    const callbackQueryId = ctx.callbackQuery?.id;

    if (!chatId || !userId || !callbackQueryId) {
      botLogger.warn({ chatId, userId }, '⚠️ Некорректный контекст для help:acute');
      return;
    }

    const handler = new HelpHandler(bot, chatId, userId);
    await handler.handleAcuteAnxiety(callbackQueryId);
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, '❌ Ошибка обработки help:acute');
  }
}

/**
 * Обработчик кнопки "Вызвал скорую"
 */
export async function handleHelpAcuteCalled(ctx: Context, bot: Telegraf) {
  try {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    const callbackQueryId = ctx.callbackQuery?.id;

    if (!chatId || !userId || !callbackQueryId) {
      botLogger.warn({ chatId, userId }, '⚠️ Некорректный контекст для help:acute_called');
      return;
    }

    const handler = new HelpHandler(bot, chatId, userId);
    await handler.handleAcuteCalled(callbackQueryId);
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, '❌ Ошибка обработки help:acute_called');
  }
}

/**
 * Обработчик кнопки "Нет ничего из списка"
 */
export async function handleHelpAcuteNoSymptoms(ctx: Context, bot: Telegraf) {
  try {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    const callbackQueryId = ctx.callbackQuery?.id;

    if (!chatId || !userId || !callbackQueryId) {
      botLogger.warn({ chatId, userId }, '⚠️ Некорректный контекст для help:acute_no_symptoms');
      return;
    }

    const handler = new HelpHandler(bot, chatId, userId);
    await handler.handleNoSymptoms(callbackQueryId);
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, '❌ Ошибка обработки help:acute_no_symptoms');
  }
}

/**
 * Обработчик кнопки "Да" (есть признаки из списка)
 */
export async function handleHelpAcuteSymptomsYes(ctx: Context, bot: Telegraf) {
  try {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    const callbackQueryId = ctx.callbackQuery?.id;

    if (!chatId || !userId || !callbackQueryId) {
      botLogger.warn({ chatId, userId }, '⚠️ Некорректный контекст для help:acute_symptoms_yes');
      return;
    }

    const handler = new HelpHandler(bot, chatId, userId);
    await handler.handleAcuteSymptomsYes(callbackQueryId);
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, '❌ Ошибка обработки help:acute_symptoms_yes');
  }
}

/**
 * Обработчик кнопки "Нет" (нет признаков из списка)
 */
export async function handleHelpAcuteSymptomsNo(ctx: Context, bot: Telegraf) {
  try {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    const callbackQueryId = ctx.callbackQuery?.id;

    if (!chatId || !userId || !callbackQueryId) {
      botLogger.warn({ chatId, userId }, '⚠️ Некорректный контекст для help:acute_symptoms_no');
      return;
    }

    const handler = new HelpHandler(bot, chatId, userId);
    await handler.handleNoSymptoms(callbackQueryId);
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, '❌ Ошибка обработки help:acute_symptoms_no');
  }
}

/**
 * Обработчики шагов инструкций
 */
export async function handleHelpAcuteStep2(ctx: Context, bot: Telegraf) {
  try {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    const callbackQueryId = ctx.callbackQuery?.id;

    if (!chatId || !userId || !callbackQueryId) return;

    const handler = new HelpHandler(bot, chatId, userId);
    await handler.handleAcuteStep2(callbackQueryId);
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, '❌ Ошибка обработки help:acute_step2');
  }
}

export async function handleHelpAcuteStep3(ctx: Context, bot: Telegraf) {
  try {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    const callbackQueryId = ctx.callbackQuery?.id;

    if (!chatId || !userId || !callbackQueryId) return;

    const handler = new HelpHandler(bot, chatId, userId);
    await handler.handleAcuteStep3(callbackQueryId);
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, '❌ Ошибка обработки help:acute_step3');
  }
}

export async function handleHelpAcuteStep4(ctx: Context, bot: Telegraf) {
  try {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    const callbackQueryId = ctx.callbackQuery?.id;

    if (!chatId || !userId || !callbackQueryId) return;

    const handler = new HelpHandler(bot, chatId, userId);
    await handler.handleAcuteStep4(callbackQueryId);
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, '❌ Ошибка обработки help:acute_step4');
  }
}

export async function handleHelpAcuteFinal(ctx: Context, bot: Telegraf) {
  try {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    const callbackQueryId = ctx.callbackQuery?.id;

    if (!chatId || !userId || !callbackQueryId) return;

    const handler = new HelpHandler(bot, chatId, userId);
    await handler.handleAcuteFinal(callbackQueryId);
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, '❌ Ошибка обработки help:acute_final');
  }
}

/**
 * Обработчик кнопки "Признаки панической атаки"
 */
export async function handleHelpPanicSigns(ctx: Context, bot: Telegraf) {
  try {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    const callbackQueryId = ctx.callbackQuery?.id;

    if (!chatId || !userId || !callbackQueryId) {
      botLogger.warn({ chatId, userId }, '⚠️ Некорректный контекст для help:panic_signs');
      return;
    }

    const handler = new HelpHandler(bot, chatId, userId);
    await handler.handlePanicSigns(callbackQueryId);
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, '❌ Ошибка обработки help:panic_signs');
  }
}

/**
 * Обработчик кнопки "Что делать?" (сценарий ПА)
 */
export async function handleHelpPanicWhatToDo(ctx: Context, bot: Telegraf) {
  try {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    const callbackQueryId = ctx.callbackQuery?.id;

    if (!chatId || !userId || !callbackQueryId) {
      botLogger.warn({ chatId, userId }, '⚠️ Некорректный контекст для help:panic_what_to_do');
      return;
    }

    const handler = new HelpHandler(bot, chatId, userId);
    await handler.handlePanicWhatToDo(callbackQueryId);
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, '❌ Ошибка обработки help:panic_what_to_do');
  }
}

/**
 * Обработчики шагов сценария панической атаки
 */
export async function handleHelpPanicStep2(ctx: Context, bot: Telegraf) {
  try {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    const callbackQueryId = ctx.callbackQuery?.id;

    if (!chatId || !userId || !callbackQueryId) return;

    const handler = new HelpHandler(bot, chatId, userId);
    await handler.handlePanicStep2(callbackQueryId);
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, '❌ Ошибка обработки help:panic_step2');
  }
}

export async function handleHelpPanicStep3(ctx: Context, bot: Telegraf) {
  try {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    const callbackQueryId = ctx.callbackQuery?.id;

    if (!chatId || !userId || !callbackQueryId) return;

    const handler = new HelpHandler(bot, chatId, userId);
    await handler.handlePanicStep3(callbackQueryId);
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, '❌ Ошибка обработки help:panic_step3');
  }
}

export async function handleHelpPanicStep4(ctx: Context, bot: Telegraf) {
  try {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    const callbackQueryId = ctx.callbackQuery?.id;

    if (!chatId || !userId || !callbackQueryId) return;

    const handler = new HelpHandler(bot, chatId, userId);
    await handler.handlePanicStep4(callbackQueryId);
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, '❌ Ошибка обработки help:panic_step4');
  }
}

export async function handleHelpPanicStep5(ctx: Context, bot: Telegraf) {
  try {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    const callbackQueryId = ctx.callbackQuery?.id;

    if (!chatId || !userId || !callbackQueryId) return;

    const handler = new HelpHandler(bot, chatId, userId);
    await handler.handlePanicStep5(callbackQueryId);
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, '❌ Ошибка обработки help:panic_step5');
  }
}

/**
 * Обработчики других типов тревоги (пока заглушки)
 */
export async function handleHelpThoughts(ctx: Context, bot: Telegraf) {
  try {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    const callbackQueryId = ctx.callbackQuery?.id;

    if (!chatId || !userId || !callbackQueryId) return;

    const handler = new HelpHandler(bot, chatId, userId);
    await handler.handleOtherAnxietyType(callbackQueryId, 'thoughts');
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, '❌ Ошибка обработки help:thoughts');
  }
}

export async function handleHelpBackground(ctx: Context, bot: Telegraf) {
  try {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    const callbackQueryId = ctx.callbackQuery?.id;

    if (!chatId || !userId || !callbackQueryId) return;

    const handler = new HelpHandler(bot, chatId, userId);
    await handler.handleOtherAnxietyType(callbackQueryId, 'background');
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, '❌ Ошибка обработки help:background');
  }
}

export async function handleHelpPeoplePlaces(ctx: Context, bot: Telegraf) {
  try {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    const callbackQueryId = ctx.callbackQuery?.id;

    if (!chatId || !userId || !callbackQueryId) return;

    const handler = new HelpHandler(bot, chatId, userId);
    await handler.handleOtherAnxietyType(callbackQueryId, 'people_places');
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, '❌ Ошибка обработки help:people_places');
  }
}
