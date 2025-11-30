import { botLogger } from '../../logger';
import { getUserByChatId, updateUserName, updateOnboardingState, updateUserRequest, updateUserTimezone } from '../../db';
import { detectTimezoneByCity } from '../../utils/timezone-detector';
import { scheduler } from '../../bot';

/**
 * Функция для капитализации первой буквы строки
 */
function capitalizeFirstLetter(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * ID последнего сообщения с запросом пола для каждого пользователя
 * Используется для удаления при редактировании имени
 */
const userGenderMessages = new Map<number, number>();

/**
 * Обработчик сообщений в процессе онбординга
 * Проверяет состояние онбординга и обрабатывает ввод имени
 */
export async function handleOnboardingMessage(
  ctx: any
): Promise<boolean> {
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id || 0;
  const message = ctx.message?.text;

  if (!chatId || !message) {
    return false;
  }

  // Получаем информацию о пользователе
  const user = getUserByChatId(chatId);

  if (!user) {
    botLogger.warn({ chatId, userId }, '⚠️ Пользователь не найден в БД');
    return false;
  }

  // Проверяем состояние онбординга
  if (user.onboarding_state === 'waiting_start') {
    // Пользователь написал текст вместо нажатия кнопки "Вперед"
    // Считаем это за нажатие кнопки
    botLogger.info({ chatId, userId }, '🚀 Пользователь написал текст вместо кнопки - засчитываем как нажатие');

    await ctx.reply(
      `Как мне тебя называть?
<b>Напиши свое имя</b> или можешь придумать прозвище 🙃`,
      { parse_mode: 'HTML' }
    );

    // Обновляем состояние онбординга
    updateOnboardingState(chatId, 'waiting_name');
    return true;
  }

  if (user.onboarding_state === 'waiting_name') {
    // Пользователь вводит имя
    const rawName = message.trim();

    if (!rawName) {
      await ctx.reply('Пожалуйста, напиши своё имя 😊');
      return true;
    }

    // Капитализируем первую букву имени
    const name = capitalizeFirstLetter(rawName);

    // Сохраняем имя в БД
    updateUserName(chatId, name);

    // Переходим к запросу пола
    updateOnboardingState(chatId, 'waiting_gender');

    botLogger.info({ chatId, userId, name }, '✅ Имя пользователя сохранено, запрашиваем пол');

    // Импортируем Markup и Telegraf здесь
    const { Markup } = await import('telegraf');

    // Отправляем запрос пола с кнопками и сохраняем ID сообщения
    const genderMessage = await ctx.reply(
      `${name}, укажи свой пол`,
      Markup.inlineKeyboard([
        [Markup.button.callback('Мужской 🙋🏻‍♂️', 'onboarding_gender_male')],
        [Markup.button.callback('Женский 🙋🏻‍♀️', 'onboarding_gender_female')]
      ])
    );

    // Сохраняем ID сообщения с выбором пола
    userGenderMessages.set(chatId, genderMessage.message_id);

    return true;
  }

  if (user.onboarding_state === 'waiting_timezone') {
    // Пользователь вводит название города для определения timezone
    const cityName = message.trim();

    if (!cityName) {
      await ctx.reply('Пожалуйста, напиши название города или нажми кнопку "MSK, UTC+3" 😊');
      return true;
    }

    botLogger.info({ chatId, userId, cityName }, '🌍 Определение timezone по городу');

    // Определяем timezone по городу
    const timezoneResult = await detectTimezoneByCity(cityName);

    // Проверяем результат
    if (timezoneResult.source === 'needsUserChoice') {
      // Не смогли определить точно - показываем кнопки с похожими городами
      const { Markup } = await import('telegraf');

      const buttons = timezoneResult.similarCities!.map(city =>
        [Markup.button.callback(`${city.city} (UTC${city.offset >= 0 ? '+' : ''}${city.offset / 60})`, `timezone_select_${city.timezone}_${encodeURIComponent(city.city)}`)]
      );

      await ctx.reply(
        `Извини, небольшая путаница 🙈\nВозможно что-то из этих городов (нажми на нужную кнопку) или попробуй написать по-другому`,
        Markup.inlineKeyboard(buttons)
      );

      botLogger.info({
        chatId,
        userId,
        cityName,
        similarCitiesCount: timezoneResult.similarCities!.length
      }, '🔍 Показаны похожие города для выбора');

      // Остаёмся в состоянии waiting_timezone - пользователь либо нажмёт кнопку, либо напишет по-другому
      return true;
    }

    // Timezone определён успешно
    const finalTimezone = timezoneResult.timezone!;
    const finalOffset = timezoneResult.offset!;

    // Сохраняем timezone и город в БД
    updateUserTimezone(chatId, finalTimezone, finalOffset, cityName);

    // Добавляем пользователя в timezone-based планировщик
    await scheduler.addUserToTimezone(chatId, finalTimezone);

    // Переходим к запросу целей
    updateOnboardingState(chatId, 'waiting_request');

    botLogger.info({
      chatId,
      userId,
      cityName,
      timezone: finalTimezone,
      offset: finalOffset,
      source: timezoneResult.source
    }, '✅ Timezone определен и сохранен');

    // Формируем сообщение в зависимости от источника
    let confirmMessage = '';
    if (timezoneResult.source === 'library') {
      confirmMessage = `Отлично! Установил timezone для ${cityName} ✅`;
    } else if (timezoneResult.source === 'llm') {
      confirmMessage = `Определил timezone для ${cityName} ✅`;
    }

    await ctx.reply(confirmMessage);

    // Импортируем Markup
    const { Markup } = await import('telegraf');

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

    return true;
  }

  if (user.onboarding_state === 'waiting_request') {
    // Пользователь вводит запрос/цели
    const request = message.trim();

    if (!request) {
      await ctx.reply('Пожалуйста, напиши свой запрос или нажми кнопку "Пропустить" 😊');
      return true;
    }

    // Сохраняем запрос в БД
    updateUserRequest(chatId, request);

    // Завершаем онбординг
    updateOnboardingState(chatId, null);

    botLogger.info({ chatId, userId, requestLength: request.length }, '✅ Запрос пользователя сохранен, онбординг завершен');

    // Получаем данные пользователя
    const userName = user.name!;
    const userTimezone = user.timezone || 'Europe/Moscow';
    const userTimezoneOffset = user.timezone_offset || 180;

    // Генерируем финальное сообщение с учетом времени до вечерней лягухи
    const { generateOnboardingFinalMessage } = await import('../../utils/onboarding-final-message');
    const finalMessage = generateOnboardingFinalMessage(userName, userTimezone, userTimezoneOffset);

    // Отправляем финальное сообщение
    if (finalMessage.buttons) {
      await ctx.reply(finalMessage.text, finalMessage.buttons);
    } else {
      await ctx.reply(finalMessage.text);
    }

    return true;
  }

  // Не в процессе онбординга
  return false;
}

/**
 * Обработчик редактирования сообщений в процессе онбординга
 * Поддерживает исправление имени пользователя
 */
export async function handleOnboardingEditedMessage(
  ctx: any
): Promise<boolean> {
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id || 0;
  const message = ctx.editedMessage?.text;

  if (!chatId || !message) {
    return false;
  }

  // Получаем информацию о пользователе
  const user = getUserByChatId(chatId);

  if (!user) {
    return false;
  }

  // Проверяем, что пользователь находится на этапе выбора пола
  // (то есть уже ввел имя, но еще не выбрал пол)
  if (user.onboarding_state === 'waiting_gender') {
    // Пользователь отредактировал своё имя
    const rawName = message.trim();

    if (!rawName) {
      return false;
    }

    // Капитализируем первую букву имени
    const name = capitalizeFirstLetter(rawName);

    // Обновляем имя в БД
    updateUserName(chatId, name);

    botLogger.info({ chatId, userId, oldName: user.name, newName: name }, '✏️ Пользователь отредактировал имя');

    // Удаляем старое сообщение с выбором пола (если существует)
    const oldGenderMessageId = userGenderMessages.get(chatId);
    if (oldGenderMessageId) {
      try {
        const bot = ctx.telegram;
        await bot.deleteMessage(chatId, oldGenderMessageId);
        botLogger.info({ chatId, messageId: oldGenderMessageId }, '🗑️ Удалено старое сообщение с выбором пола');
      } catch (error) {
        botLogger.warn({ error, chatId, messageId: oldGenderMessageId }, '⚠️ Не удалось удалить старое сообщение с выбором пола');
      }
    }

    // Импортируем Markup
    const { Markup } = await import('telegraf');

    // Отправляем новое сообщение с выбором пола с обновленным именем
    const genderMessage = await ctx.reply(
      `${name}, укажи свой пол`,
      Markup.inlineKeyboard([
        [Markup.button.callback('Мужской 🙋🏻‍♂️', 'onboarding_gender_male')],
        [Markup.button.callback('Женский 🙋🏻‍♀️', 'onboarding_gender_female')]
      ])
    );

    // Обновляем ID сообщения с выбором пола
    userGenderMessages.set(chatId, genderMessage.message_id);

    return true;
  }

  return false;
}
