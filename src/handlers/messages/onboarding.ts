import { botLogger } from '../../logger';
import { getUserByChatId, updateUserName, updateOnboardingState, updateUserRequest } from '../../db';

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
        [
          Markup.button.callback('Мужской 🙋🏻', 'onboarding_gender_male'),
          Markup.button.callback('Женский 🙋🏻‍♀️', 'onboarding_gender_female')
        ]
      ])
    );

    // Сохраняем ID сообщения с выбором пола
    userGenderMessages.set(chatId, genderMessage.message_id);

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

    // Получаем имя и пол пользователя
    const userName = user.name!;
    const userGender = user.gender;

    // Отправляем финальное сообщение (с учётом пола)
    const readyText = userGender === 'male' ? 'готов' : 'готова';
    await ctx.reply(
      `Приятно познакомиться, ${userName}! 🤗

Теперь ты ${readyText} к работе. Каждый вечер в 22:00 буду отправлять тебе задания для размышлений и работы над собой.

Если хочешь начать прямо сейчас - просто напиши мне о том, что сейчас чувствуешь или что происходит в твоей жизни. Я буду рад выслушать 💚`
    );

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
        [
          Markup.button.callback('Мужской 🙋🏻', 'onboarding_gender_male'),
          Markup.button.callback('Женский 🙋🏻‍♀️', 'onboarding_gender_female')
        ]
      ])
    );

    // Обновляем ID сообщения с выбором пола
    userGenderMessages.set(chatId, genderMessage.message_id);

    return true;
  }

  return false;
}
