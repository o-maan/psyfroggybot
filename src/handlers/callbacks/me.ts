import { Telegraf, Markup } from 'telegraf';
import { botLogger } from '../../logger';
import { getUserByChatId, updateOnboardingState } from '../../db';

/**
 * Обработчик кнопки "Все верно ☑️"
 */
export function handleMeConfirm(bot: Telegraf) {
  bot.action('me_confirm', async ctx => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      botLogger.error({}, '❌ Не удалось получить chatId из callback');
      return;
    }

    const userId = ctx.from?.id || 0;
    botLogger.info({ userId, chatId }, '☑️ Пользователь подтвердил данные');

    await ctx.answerCbQuery('Отлично! 👍');
    await ctx.reply('Хорошо, все данные в порядке! Если захочешь что-то изменить - используй команду /me 😊');
  });
}

/**
 * Обработчик кнопки "Изменить имя ✏️"
 */
export function handleMeEditName(bot: Telegraf) {
  bot.action('me_edit_name', async ctx => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      botLogger.error({}, '❌ Не удалось получить chatId из callback');
      return;
    }

    const userId = ctx.from?.id || 0;
    botLogger.info({ userId, chatId }, '✏️ Пользователь начал изменение имени');

    // Устанавливаем состояние редактирования имени
    updateOnboardingState(chatId, 'editing_name');

    await ctx.answerCbQuery();
    await ctx.reply(
      'Хорошо! Напиши новое имя:',
      Markup.inlineKeyboard([
        [Markup.button.callback('Отмена', 'me_cancel')]
      ])
    );
  });
}

/**
 * Обработчик кнопки "Изменить пол 👤"
 */
export function handleMeEditGender(bot: Telegraf) {
  bot.action('me_edit_gender', async ctx => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      botLogger.error({}, '❌ Не удалось получить chatId из callback');
      return;
    }

    const userId = ctx.from?.id || 0;
    botLogger.info({ userId, chatId }, '👤 Пользователь начал изменение пола');

    // Устанавливаем состояние редактирования пола
    updateOnboardingState(chatId, 'editing_gender');

    await ctx.answerCbQuery();
    await ctx.reply(
      'Выбери пол:',
      Markup.inlineKeyboard([
        [Markup.button.callback('Мужской 🙋🏻‍♂️', 'me_gender_male')],
        [Markup.button.callback('Женский 🙋🏻‍♀️', 'me_gender_female')],
        [Markup.button.callback('Отмена', 'me_cancel')]
      ])
    );
  });
}

/**
 * Обработчик кнопки "Изменить тайм зону 🌍"
 */
export function handleMeEditTimezone(bot: Telegraf) {
  bot.action('me_edit_timezone', async ctx => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      botLogger.error({}, '❌ Не удалось получить chatId из callback');
      return;
    }

    const userId = ctx.from?.id || 0;
    botLogger.info({ userId, chatId }, '🌍 Пользователь начал изменение timezone');

    // Устанавливаем состояние редактирования timezone
    updateOnboardingState(chatId, 'editing_timezone');

    await ctx.answerCbQuery();
    await ctx.reply(
      '<b>Укажи свой город</b>\nЕсли как в Москве (UTC+3) - просто нажми кнопку ниже',
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('MSK, UTC+3', 'me_timezone_msk')],
          [Markup.button.callback('Отмена', 'me_cancel')]
        ])
      }
    );
  });
}

/**
 * Обработчик кнопки "Изменить запрос 📝"
 */
export function handleMeEditRequest(bot: Telegraf) {
  bot.action('me_edit_request', async ctx => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      botLogger.error({}, '❌ Не удалось получить chatId из callback');
      return;
    }

    const userId = ctx.from?.id || 0;
    botLogger.info({ userId, chatId }, '📝 Пользователь начал изменение запроса');

    // Устанавливаем состояние редактирования запроса
    updateOnboardingState(chatId, 'editing_request');

    await ctx.answerCbQuery();
    await ctx.reply(
      '<b>Расскажи о своем запросе:</b>\nЧто тебя беспокоит, что хочешь улучшить, к чему прийти?\n\n<i>Можно удалить запрос по кнопке ниже</i>',
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('Очистить запрос', 'me_clear_request')],
          [Markup.button.callback('Отмена', 'me_cancel')]
        ])
      }
    );
  });
}

/**
 * Обработчик кнопки "Отмена ❌"
 */
export function handleMeCancel(bot: Telegraf) {
  bot.action('me_cancel', async ctx => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      botLogger.error({}, '❌ Не удалось получить chatId из callback');
      return;
    }

    const userId = ctx.from?.id || 0;
    botLogger.info({ userId, chatId }, '❌ Пользователь отменил редактирование');

    // Сбрасываем состояние редактирования
    updateOnboardingState(chatId, null);

    await ctx.answerCbQuery('Отменено');
    await ctx.reply('Редактирование отменено. Данные не изменены.');
  });
}

/**
 * Обработчик выбора мужского пола при редактировании
 */
export function handleMeGenderMale(bot: Telegraf) {
  bot.action('me_gender_male', async ctx => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      botLogger.error({}, '❌ Не удалось получить chatId из callback');
      return;
    }

    const userId = ctx.from?.id || 0;
    botLogger.info({ userId, chatId }, '👨 Пользователь выбрал мужской пол');

    // Импортируем функцию обновления пола
    const { updateUserGender } = await import('../../db');
    updateUserGender(chatId, 'male');

    // Сбрасываем состояние редактирования
    updateOnboardingState(chatId, null);

    await ctx.answerCbQuery('Пол обновлен! 👨');
    await ctx.reply('Отлично! Пол обновлен на "Мужской" ☑️');
  });
}

/**
 * Обработчик выбора женского пола при редактировании
 */
export function handleMeGenderFemale(bot: Telegraf) {
  bot.action('me_gender_female', async ctx => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      botLogger.error({}, '❌ Не удалось получить chatId из callback');
      return;
    }

    const userId = ctx.from?.id || 0;
    botLogger.info({ userId, chatId }, '👩 Пользователь выбрал женский пол');

    // Импортируем функцию обновления пола
    const { updateUserGender } = await import('../../db');
    updateUserGender(chatId, 'female');

    // Сбрасываем состояние редактирования
    updateOnboardingState(chatId, null);

    await ctx.answerCbQuery('Пол обновлен! 👩');
    await ctx.reply('Отлично! Пол обновлен на "Женский" ☑️');
  });
}

/**
 * Обработчик кнопки "MSK, UTC+3" при редактировании timezone
 */
export function handleMeTimezoneMsk(bot: Telegraf) {
  bot.action('me_timezone_msk', async ctx => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      botLogger.error({}, '❌ Не удалось получить chatId из callback');
      return;
    }

    const userId = ctx.from?.id || 0;
    botLogger.info({ userId, chatId }, '🕓 Пользователь выбрал MSK timezone при редактировании');

    // Импортируем функцию обновления timezone
    const { updateUserTimezone } = await import('../../db');
    updateUserTimezone(chatId, 'Europe/Moscow', 180, 'Москва');

    // Сбрасываем состояние редактирования
    updateOnboardingState(chatId, null);

    await ctx.answerCbQuery('Тайм зона обновлена! 🕓');
    await ctx.reply('Отлично! Тайм зона обновлена на "Москва (UTC+3)" ☑️');
  });
}

/**
 * Обработчик кнопки "Очистить запрос"
 */
export function handleMeClearRequest(bot: Telegraf) {
  bot.action('me_clear_request', async ctx => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      botLogger.error({}, '❌ Не удалось получить chatId из callback');
      return;
    }

    const userId = ctx.from?.id || 0;
    botLogger.info({ userId, chatId }, '🗑️ Пользователь очистил запрос');

    // Импортируем функцию обновления запроса
    const { updateUserRequest } = await import('../../db');
    updateUserRequest(chatId, null);

    // Сбрасываем состояние редактирования
    updateOnboardingState(chatId, null);

    await ctx.answerCbQuery('Запрос очищен');
    await ctx.reply('Запрос удален ☑️');
  });
}

/**
 * Обработчик выбора timezone из предложенных городов (при редактировании)
 */
export function handleMeTimezoneSelect(bot: Telegraf) {
  bot.action(/^me_timezone_select_(.+)_(.+)$/, async ctx => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      botLogger.error({}, '❌ Не удалось получить chatId из callback');
      return;
    }

    const userId = ctx.from?.id || 0;
    const timezone = ctx.match[1];
    const city = decodeURIComponent(ctx.match[2]);

    botLogger.info({ userId, chatId, timezone, city }, '🌆 Пользователь выбрал timezone из списка при редактировании');

    // Импортируем функции
    const { getTimezoneOffset } = await import('../../utils/timezone-detector');
    const { updateUserTimezone } = await import('../../db');

    const offset = getTimezoneOffset(timezone);

    // Обновляем timezone и город
    updateUserTimezone(chatId, timezone, offset, city);

    // Сбрасываем состояние редактирования
    updateOnboardingState(chatId, null);

    await ctx.answerCbQuery('Тайм зона обновлена! ☑️');
    await ctx.reply(`Отлично! Тайм зона обновлена на "${city} (UTC${offset >= 0 ? '+' : ''}${offset / 60})" ☑️`);
  });
}

/**
 * Регистрация всех обработчиков кнопок /me команды
 */
export function registerMeCallbacks(bot: Telegraf) {
  handleMeConfirm(bot);
  handleMeEditName(bot);
  handleMeEditGender(bot);
  handleMeEditTimezone(bot);
  handleMeEditRequest(bot);
  handleMeCancel(bot);
  handleMeGenderMale(bot);
  handleMeGenderFemale(bot);
  handleMeTimezoneMsk(bot);
  handleMeClearRequest(bot);
  handleMeTimezoneSelect(bot);
}
