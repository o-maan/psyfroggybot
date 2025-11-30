import { Telegraf, Markup } from 'telegraf';
import { botLogger } from '../../logger';
import { getUserByChatId, updateOnboardingState, updateUserGender, updateUserRequest, updateUserTimezone } from '../../db';
import { detectTimezoneByCity } from '../../utils/timezone-detector';
import { scheduler } from '../../bot';

/**
 * Обработчик кнопки "Вперед 🚀" в приветственном сообщении
 */
export function registerOnboardingStartCallback(bot: Telegraf) {
  bot.action('onboarding_start', async ctx => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      botLogger.error({}, '❌ Не удалось получить chatId из callback');
      return;
    }

    const userId = ctx.from?.id || 0;
    botLogger.info({ userId, chatId }, '🚀 Пользователь нажал кнопку "Вперед"');

    try {
      // Удаляем кнопку из предыдущего сообщения (редактируем caption)
      await ctx.editMessageCaption(
        `Квак! 🐸
Я твой лягушка-психолог

Я здесь, чтобы помогать тебе быть чуть ближе к себе, замечать свои чувства и делать жизнь лучше 💫

Весь день я буду рядом, чтобы выслушать, а каждый вечер – присылать небольшие задания. Работа со своим внутренним миром может изменить многое 😊`
      );
    } catch (error) {
      botLogger.warn({ error }, '⚠️ Не удалось отредактировать сообщение (возможно, оно уже изменено)');
    }

    // Отправляем запрос имени
    await ctx.reply(
      `Как мне тебя называть?
<b>Напиши свое имя</b> или можешь придумать прозвище 🙃`,
      { parse_mode: 'HTML' }
    );

    // Обновляем состояние онбординга
    updateOnboardingState(chatId, 'waiting_name');
    botLogger.info({ userId, chatId }, '✅ Ожидаем ввод имени от пользователя');
  });

  // Обработчик кнопки выбора пола - Мужской
  bot.action('onboarding_gender_male', async ctx => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      botLogger.error({}, '❌ Не удалось получить chatId из callback');
      return;
    }

    const userId = ctx.from?.id || 0;
    botLogger.info({ userId, chatId }, '👨 Пользователь выбрал мужской пол');

    // Сохраняем пол в БД
    updateUserGender(chatId, 'male');

    // Переходим к выбору timezone
    updateOnboardingState(chatId, 'waiting_timezone');

    // Отвечаем пользователю
    await ctx.answerCbQuery('Отлично! 🙋🏻');

    // Отправляем запрос timezone
    await ctx.reply(
      `Чтобы я присылал тебе сообщения 📩 в корректное время - давай уточним тайм зону 🌙🌆☀️
<b>Укажи свой город</b>
Если как в Москве (UTC+3) - просто нажми кнопку ниже`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('MSK, UTC+3', 'onboarding_timezone_msk')]
        ])
      }
    );

    botLogger.info({ userId, chatId, gender: 'male' }, '✅ Запрос timezone отправлен');
  });

  // Обработчик кнопки выбора пола - Женский
  bot.action('onboarding_gender_female', async ctx => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      botLogger.error({}, '❌ Не удалось получить chatId из callback');
      return;
    }

    const userId = ctx.from?.id || 0;
    botLogger.info({ userId, chatId }, '👩 Пользователь выбрал женский пол');

    // Сохраняем пол в БД
    updateUserGender(chatId, 'female');

    // Переходим к выбору timezone
    updateOnboardingState(chatId, 'waiting_timezone');

    // Отвечаем пользователю
    await ctx.answerCbQuery('Отлично! 🙋🏻‍♀️');

    // Отправляем запрос timezone
    await ctx.reply(
      `Чтобы я присылал тебе сообщения 📩 в корректное время - давай уточним тайм зону 🌙🌆☀️
<b>Укажи свой город</b>
Если как в Москве (UTC+3) - просто нажми кнопку ниже`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('MSK, UTC+3', 'onboarding_timezone_msk')]
        ])
      }
    );

    botLogger.info({ userId, chatId, gender: 'female' }, '✅ Запрос timezone отправлен');
  });

  // Обработчик кнопки "MSK, UTC+3" для выбора московского timezone
  bot.action('onboarding_timezone_msk', async ctx => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      botLogger.error({}, '❌ Не удалось получить chatId из callback');
      return;
    }

    const userId = ctx.from?.id || 0;
    botLogger.info({ userId, chatId }, '🕓 Пользователь выбрал MSK timezone');

    // Сохраняем timezone в БД
    updateUserTimezone(chatId, 'Europe/Moscow', 180, 'Москва');

    // Добавляем пользователя в timezone-based планировщик
    await scheduler.addUserToTimezone(chatId, 'Europe/Moscow');

    // Переходим к запросу целей
    updateOnboardingState(chatId, 'waiting_request');

    // Отвечаем пользователю
    await ctx.answerCbQuery('Отлично! 🕓');

    // Отправляем запрос о целях с кнопкой "Пропустить"
    await ctx.reply(
      `И последний вопрос 📝
<b>Расскажи о своем запросе</b>, что тебя беспокоит, что хочешь улучшить, к чему прийти?

<i>Например, может ты хочешь лучше понимать себя, снизить стресс или прийти к балансу в жизни</i>`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('Пропустить', 'onboarding_skip_request')]
        ])
      }
    );

    botLogger.info({ userId, chatId, timezone: 'Europe/Moscow' }, '✅ Запрос целей отправлен');
  });

  // Обработчик выбора timezone из предложенных городов
  bot.action(/^timezone_select_(.+)_(.+)$/, async ctx => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      botLogger.error({}, '❌ Не удалось получить chatId из callback');
      return;
    }

    const userId = ctx.from?.id || 0;
    const timezone = ctx.match[1]; // Извлекаем timezone из callback_data
    const city = decodeURIComponent(ctx.match[2]); // Извлекаем город из callback_data

    botLogger.info({ userId, chatId, timezone, city }, '🌆 Пользователь выбрал timezone из списка');

    // Импортируем getTimezoneOffset
    const { getTimezoneOffset } = await import('../../utils/timezone-detector');
    const offset = getTimezoneOffset(timezone);

    // Сохраняем timezone и город в БД
    updateUserTimezone(chatId, timezone, offset, city);

    // Добавляем пользователя в timezone-based планировщик
    await scheduler.addUserToTimezone(chatId, timezone);

    // Переходим к запросу целей
    updateOnboardingState(chatId, 'waiting_request');

    // Отвечаем пользователю
    await ctx.answerCbQuery('Отлично! ✅');

    // Отправляем запрос о целях с кнопкой "Пропустить"
    await ctx.reply(
      `И последний вопрос 📝
<b>Расскажи о своем запросе</b>, что тебя беспокоит, что хочешь улучшить, к чему прийти?

<i>Например, может ты хочешь лучше понимать себя, снизить стресс или прийти к балансу в жизни</i>`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('Пропустить', 'onboarding_skip_request')]
        ])
      }
    );

    botLogger.info({ userId, chatId, timezone, offset, city }, '✅ Timezone выбран из списка, запрос целей отправлен');
  });

  // Обработчик кнопки "Пропустить" для запроса целей
  bot.action('onboarding_skip_request', async ctx => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      botLogger.error({}, '❌ Не удалось получить chatId из callback');
      return;
    }

    const userId = ctx.from?.id || 0;
    botLogger.info({ userId, chatId }, '⏭️ Пользователь пропустил запрос целей');

    // Сохраняем null для user_request
    updateUserRequest(chatId, null);

    // Завершаем онбординг
    updateOnboardingState(chatId, null);

    // Получаем данные пользователя
    const user = getUserByChatId(chatId);
    const userName = user?.name!;
    const userTimezone = user?.timezone || 'Europe/Moscow';
    const userTimezoneOffset = user?.timezone_offset || 180;

    // Отвечаем пользователю
    await ctx.answerCbQuery('Хорошо!');

    // Генерируем финальное сообщение с учетом времени до вечерней лягухи
    const { generateOnboardingFinalMessage } = await import('../../utils/onboarding-final-message');
    const finalMessage = generateOnboardingFinalMessage(userName, userTimezone, userTimezoneOffset);

    // Отправляем финальное сообщение
    if (finalMessage.buttons) {
      await ctx.reply(finalMessage.text, finalMessage.buttons);
    } else {
      await ctx.reply(finalMessage.text);
    }

    botLogger.info({ userId, chatId }, '✅ Онбординг завершен (запрос пропущен)');
  });

  // Обработчик кнопки "Хочу сейчааааас 😁" - запуск утренней лягухи
  bot.action('onboarding_start_morning', async ctx => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      botLogger.error({}, '❌ Не удалось получить chatId из callback');
      return;
    }

    const userId = ctx.from?.id || 0;
    botLogger.info({ userId, chatId }, '🌅 Пользователь запустил утреннюю лягуху после онбординга');

    await ctx.answerCbQuery('Отлично! Начинаем! 🐸');

    try {
      // Импортируем scheduler
      const { scheduler } = await import('../../bot');

      // Запускаем утреннюю лягуху
      // Это будет считаться первым запуском, поэтому на следующий день вводное сообщение не отправится
      await scheduler.sendMorningMessage(chatId, true); // true = manual mode

      botLogger.info({ userId, chatId }, '✅ Утренняя лягуха запущена после онбординга');
    } catch (error) {
      botLogger.error({ error, userId, chatId }, '❌ Ошибка запуска утренней лягухи после онбординга');
      await ctx.reply('Произошла ошибка при запуске утренней лягухи. Попробуй позже или напиши мне о своих чувствах 💚');
    }
  });

  // Обработчик кнопки "Ждем вечера"
  bot.action('onboarding_wait_evening', async ctx => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      botLogger.error({}, '❌ Не удалось получить chatId из callback');
      return;
    }

    const userId = ctx.from?.id || 0;
    botLogger.info({ userId, chatId }, '⏰ Пользователь решил подождать вечерней лягухи');

    await ctx.answerCbQuery('Хорошо! До вечера! 🌙');
    await ctx.reply('Отлично! Увидимся вечером 🌙\n\nА пока можешь написать мне о том, что сейчас чувствуешь или что происходит в твоей жизни. Я буду рад выслушать 💚');

    botLogger.info({ userId, chatId }, '✅ Пользователь ждет вечерней лягухи');
  });
}
