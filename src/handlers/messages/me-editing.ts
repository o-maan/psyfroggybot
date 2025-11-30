import { botLogger } from '../../logger';
import {
  getUserByChatId,
  updateUserName,
  updateUserRequest,
  updateOnboardingState,
  updateUserTimezone
} from '../../db';
import { detectTimezoneByCity } from '../../utils/timezone-detector';
import { Markup } from 'telegraf';

/**
 * Функция для капитализации первой буквы строки
 */
function capitalizeFirstLetter(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Обработчик сообщений при редактировании данных пользователя через /me
 * Проверяет состояние редактирования и обрабатывает ввод
 */
export async function handleMeEditingMessage(ctx: any): Promise<boolean> {
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

  // Проверяем состояние редактирования
  if (user.onboarding_state === 'editing_name') {
    // Пользователь вводит новое имя
    const rawName = message.trim();

    if (!rawName) {
      await ctx.reply('Пожалуйста, напиши своё имя 😊');
      return true;
    }

    // Капитализируем первую букву имени
    const name = capitalizeFirstLetter(rawName);

    // Сохраняем новое имя в БД
    updateUserName(chatId, name);

    // Сбрасываем состояние редактирования
    updateOnboardingState(chatId, null);

    botLogger.info({ chatId, userId, oldName: user.name, newName: name }, '✅ Имя пользователя обновлено');

    await ctx.reply(`Отлично! Имя обновлено на "${name}" ☑️`);
    return true;
  }

  if (user.onboarding_state === 'editing_timezone') {
    // Пользователь вводит название города для определения timezone
    const cityName = message.trim();

    if (!cityName) {
      await ctx.reply('Пожалуйста, напиши название города 😊');
      return true;
    }

    botLogger.info({ chatId, userId, cityName }, '🌍 Определение timezone по городу при редактировании');

    // Определяем timezone по городу
    const timezoneResult = await detectTimezoneByCity(cityName);

    // Проверяем результат
    if (timezoneResult.source === 'needsUserChoice') {
      // Не смогли определить точно - показываем кнопки с похожими городами
      const buttons = timezoneResult.similarCities!.map(city =>
        [Markup.button.callback(
          `${city.city} (UTC${city.offset >= 0 ? '+' : ''}${city.offset / 60})`,
          `me_timezone_select_${city.timezone}_${encodeURIComponent(city.city)}`
        )]
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
      }, '🔍 Показаны похожие города для выбора при редактировании');

      // Остаёмся в состоянии editing_timezone - пользователь либо нажмёт кнопку, либо напишет по-другому
      return true;
    }

    // Timezone определён успешно
    const finalTimezone = timezoneResult.timezone!;
    const finalOffset = timezoneResult.offset!;

    // Сохраняем timezone и город в БД
    updateUserTimezone(chatId, finalTimezone, finalOffset, cityName);

    // Сбрасываем состояние редактирования
    updateOnboardingState(chatId, null);

    botLogger.info({
      chatId,
      userId,
      cityName,
      timezone: finalTimezone,
      offset: finalOffset,
      source: timezoneResult.source
    }, '✅ Timezone обновлен при редактировании');

    // Формируем сообщение в зависимости от источника
    let confirmMessage = '';
    if (timezoneResult.source === 'library') {
      confirmMessage = `Отлично! Тайм зона обновлена на "${cityName} (UTC${finalOffset >= 0 ? '+' : ''}${finalOffset / 60})" ☑️`;
    } else if (timezoneResult.source === 'llm') {
      confirmMessage = `Тайм зона обновлена на "${cityName} (UTC${finalOffset >= 0 ? '+' : ''}${finalOffset / 60})" ☑️`;
    }

    await ctx.reply(confirmMessage);

    return true;
  }

  if (user.onboarding_state === 'editing_request') {
    // Пользователь вводит новый запрос
    const request = message.trim();

    if (!request) {
      await ctx.reply('Пожалуйста, напиши свой запрос 😊');
      return true;
    }

    // Сохраняем новый запрос в БД
    updateUserRequest(chatId, request);

    // Сбрасываем состояние редактирования
    updateOnboardingState(chatId, null);

    botLogger.info({ chatId, userId, requestLength: request.length }, '✅ Запрос пользователя обновлен');

    await ctx.reply(`Отлично! Запрос обновлен ☑️`);
    return true;
  }

  // Не в процессе редактирования
  return false;
}
