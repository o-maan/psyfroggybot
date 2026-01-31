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
    await handler.handleThoughts(callbackQueryId);
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, '❌ Ошибка обработки help:thoughts');
  }
}

// ==================== ОБРАБОТЧИКИ СЦЕНАРИЯ "МЫСЛИ НЕ ОТПУСКАЮТ" ====================

export async function handleHelpThoughtsStep2(ctx: Context, bot: Telegraf) {
  try {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    const callbackQueryId = ctx.callbackQuery?.id;
    if (!chatId || !userId || !callbackQueryId) return;
    const handler = new HelpHandler(bot, chatId, userId);
    await handler.handleThoughtsStep2(callbackQueryId);
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, '❌ Ошибка обработки help:thoughts_step2');
  }
}

export async function handleHelpThoughtsStep3(ctx: Context, bot: Telegraf) {
  try {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    const callbackQueryId = ctx.callbackQuery?.id;
    if (!chatId || !userId || !callbackQueryId) return;
    const handler = new HelpHandler(bot, chatId, userId);
    await handler.handleThoughtsStep3(callbackQueryId);
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, '❌ Ошибка обработки help:thoughts_step3');
  }
}

export async function handleHelpThoughtsStep4(ctx: Context, bot: Telegraf) {
  try {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    const callbackQueryId = ctx.callbackQuery?.id;
    if (!chatId || !userId || !callbackQueryId) return;
    const handler = new HelpHandler(bot, chatId, userId);
    await handler.handleThoughtsStep4(callbackQueryId);
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, '❌ Ошибка обработки help:thoughts_step4');
  }
}

export async function handleHelpThoughtsAssumption(ctx: Context, bot: Telegraf) {
  try {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    const callbackQueryId = ctx.callbackQuery?.id;
    if (!chatId || !userId || !callbackQueryId) return;
    const handler = new HelpHandler(bot, chatId, userId);
    await handler.handleThoughtsAssumption(callbackQueryId);
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, '❌ Ошибка обработки help:thoughts_assumption');
  }
}

export async function handleHelpThoughtsFact(ctx: Context, bot: Telegraf) {
  try {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    const callbackQueryId = ctx.callbackQuery?.id;
    if (!chatId || !userId || !callbackQueryId) return;
    const handler = new HelpHandler(bot, chatId, userId);
    await handler.handleThoughtsFact(callbackQueryId);
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, '❌ Ошибка обработки help:thoughts_fact');
  }
}

export async function handleHelpThoughtsStep5(ctx: Context, bot: Telegraf) {
  try {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    const callbackQueryId = ctx.callbackQuery?.id;
    if (!chatId || !userId || !callbackQueryId) return;
    const handler = new HelpHandler(bot, chatId, userId);
    await handler.handleThoughtsStep5(callbackQueryId);
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, '❌ Ошибка обработки help:thoughts_step5');
  }
}

export async function handleHelpThoughtsBetterQuestion(ctx: Context, bot: Telegraf) {
  try {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    const callbackQueryId = ctx.callbackQuery?.id;
    if (!chatId || !userId || !callbackQueryId) return;
    const handler = new HelpHandler(bot, chatId, userId);
    await handler.handleThoughtsBetterQuestion(callbackQueryId);
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, '❌ Ошибка обработки help:thoughts_better_question');
  }
}

export async function handleHelpThoughtsBetter(ctx: Context, bot: Telegraf) {
  try {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    const callbackQueryId = ctx.callbackQuery?.id;
    if (!chatId || !userId || !callbackQueryId) return;
    const handler = new HelpHandler(bot, chatId, userId);
    await handler.handleThoughtsBetter(callbackQueryId);
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, '❌ Ошибка обработки help:thoughts_better');
  }
}

export async function handleHelpThoughtsStillWorried(ctx: Context, bot: Telegraf) {
  try {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    const callbackQueryId = ctx.callbackQuery?.id;
    if (!chatId || !userId || !callbackQueryId) return;
    const handler = new HelpHandler(bot, chatId, userId);
    await handler.handleThoughtsStillWorried(callbackQueryId);
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, '❌ Ошибка обработки help:thoughts_still_worried');
  }
}

export async function handleHelpThoughtsWriteDown(ctx: Context, bot: Telegraf) {
  try {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    const callbackQueryId = ctx.callbackQuery?.id;
    if (!chatId || !userId || !callbackQueryId) return;
    const handler = new HelpHandler(bot, chatId, userId);
    await handler.handleThoughtsWriteDown(callbackQueryId);
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, '❌ Ошибка обработки help:thoughts_write_down');
  }
}

export async function handleHelpThoughtsExhale(ctx: Context, bot: Telegraf) {
  try {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    const callbackQueryId = ctx.callbackQuery?.id;
    if (!chatId || !userId || !callbackQueryId) return;
    const handler = new HelpHandler(bot, chatId, userId);
    await handler.handleThoughtsExhale(callbackQueryId);
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, '❌ Ошибка обработки help:thoughts_exhale');
  }
}

export async function handleHelpThoughtsEnough(ctx: Context, bot: Telegraf) {
  try {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    const callbackQueryId = ctx.callbackQuery?.id;
    if (!chatId || !userId || !callbackQueryId) return;
    const handler = new HelpHandler(bot, chatId, userId);
    await handler.handleThoughtsEnough(callbackQueryId);
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, '❌ Ошибка обработки help:thoughts_enough');
  }
}

export async function handleHelpThoughtsContinue(ctx: Context, bot: Telegraf) {
  try {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    const callbackQueryId = ctx.callbackQuery?.id;
    if (!chatId || !userId || !callbackQueryId) return;
    const handler = new HelpHandler(bot, chatId, userId);
    await handler.handleThoughtsContinue(callbackQueryId);
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, '❌ Ошибка обработки help:thoughts_continue');
  }
}

export async function handleHelpThoughtsAccept(ctx: Context, bot: Telegraf) {
  try {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    const callbackQueryId = ctx.callbackQuery?.id;
    if (!chatId || !userId || !callbackQueryId) return;
    const handler = new HelpHandler(bot, chatId, userId);
    await handler.handleThoughtsAccept(callbackQueryId);
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, '❌ Ошибка обработки help:thoughts_accept');
  }
}

export async function handleHelpThoughtsPlan(ctx: Context, bot: Telegraf) {
  try {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    const callbackQueryId = ctx.callbackQuery?.id;
    if (!chatId || !userId || !callbackQueryId) return;
    const handler = new HelpHandler(bot, chatId, userId);
    await handler.handleThoughtsPlan(callbackQueryId);
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, '❌ Ошибка обработки help:thoughts_plan');
  }
}

export async function handleHelpThoughtsSmallAction(ctx: Context, bot: Telegraf) {
  try {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    const callbackQueryId = ctx.callbackQuery?.id;
    if (!chatId || !userId || !callbackQueryId) return;
    const handler = new HelpHandler(bot, chatId, userId);
    await handler.handleThoughtsSmallAction(callbackQueryId);
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, '❌ Ошибка обработки help:thoughts_small_action');
  }
}

export async function handleHelpThoughtsFinal(ctx: Context, bot: Telegraf) {
  try {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    const callbackQueryId = ctx.callbackQuery?.id;
    if (!chatId || !userId || !callbackQueryId) return;
    const handler = new HelpHandler(bot, chatId, userId);
    await handler.handleThoughtsFinal(callbackQueryId);
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, '❌ Ошибка обработки help:thoughts_final');
  }
}

export async function handleHelpThoughtsThanks(ctx: Context, bot: Telegraf) {
  try {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    const callbackQueryId = ctx.callbackQuery?.id;
    if (!chatId || !userId || !callbackQueryId) return;
    const handler = new HelpHandler(bot, chatId, userId);
    await handler.handleThoughtsThanks(callbackQueryId);
  } catch (e) {
    const error = e as Error;
    botLogger.error({ error: error.message, stack: error.stack }, '❌ Ошибка обработки help:thoughts_thanks');
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
