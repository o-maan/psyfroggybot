import { botLogger } from '../../logger';
import type { BotContext } from '../../types';
import type { Telegraf } from 'telegraf';
import type { Scheduler } from '../../scheduler';
import { scenarioSendWithRetry } from '../../utils/telegram-retry';

// Список фраз для запроса дополнительных эмоций
const MORE_EMOTIONS_PHRASES = [
  'Постарайся написать больше эмоций',
  'Какие еще эмоции были?',
  'Что еще почувствовал?',
  'Загляни в таблицу эмоций, что еще ощутил?',
  'Давай назовем больше эмоций',
  'Попробуй вспомнить еще пару эмоций',
  'Что еще происходило внутри тебя?',
  'Дополни список своих переживаний',
  'Какие еще чувства можешь назвать?',
  'Поищи в себе еще эмоции',
  'Прислушайся к себе - что еще ощутил?',
  'Углубись в свои ощущения, какие еще эмоции ты испытал?',
  'Покопайся в своих чувствах поглубже, что там еще?',
  'Что еще ты переживал в тот момент?',
  'Назови еще несколько эмоций',
  'Какие еще эмоции прятались за этим?',
  'Добавь еще своих ощущений',
  'Загляни глубже - что еще там было?',
  'Какими еще словами опишешь свое состояние? Смотри таблицу эмоций',
  'Назови больше того, что ты чувствовал - с таблицей будет проще',
  'Что еще ты испытывал? Таблица будет подсказкой',
  'Какие еще переживания были с тобой?',
  'Расширь список своих эмоций - попробуй назвать еще',
  'Что еще ты можешь добавить про свои чувства?',
];

// Список поддерживающих сообщений для случая когда пользователь хорошо описал эмоции
const SUPPORT_MESSAGES = [
  'Ты отлично справляешься с описанием своих чувств! Я горжусь тобой! Ты со всем справишься 💚',
  'Спасибо, что так подробно рассказал про свои переживания. Ты молодец, что смог это выразить 🙌🏻',
  'Я горжусь тобой! Ты очень точно описал свои чувства, это требует смелости 💙',
  'Какая глубокая работа с эмоциями! Ты все лучше слышишь себя 🫶🏻 Это ценный навык ⚡️',
  'Спасибо за доверие и честность. Ты проделал важную работу с чувствами 💜',
  'Ты учишься понимать себя, и у тебя это отлично получается! Продолжай в том же духе 💪🏻',
  'Я вижу, как ты стараешься назвать все свои чувства. Это делает тебя сильнее 🔥',
  'Отличная работа! Ты смог выразить сложные переживания словами 👏🏻',
  'Такое внимание к своим эмоциям делает тебя более осознанным 🦉 А чем лучше ты понимаешь себя, тем больше спокойствия будет в твоей жизни 🤍',
  'Говорить о неприятных переживаниях - непростая работа, и ты справился! Я рядом 👐🏻',
  'Я ценю, что ты поделился этим со мной. Твои чувства важны 🕊️',
  'Спасибо, что не побоялся назвать неприятные чувства. Это смело 🔥',
  'Ты все лучше понимаешь себя! Я вижу твой прогресс 📈',
  'Ты признаешь и называешь свои чувства - это так важно 🙌🏻',
  'Отличная работа с эмоциями! Ты растешь в понимании себя 🐸',
  'Ты не просто описал ситуации - ты услышал свои чувства! Ты справишься с чем угодно 💚',
  'Я вижу, как ты работаешь над собой. Это вдохновляет! ⭐',
  'Ты смог выразить то, что многие держат внутри. Это твоя сила 💪🏻',
  'Спасибо за откровенность! Я чувствую твою честность 🙏🏻',
  'Я рядом с тобой в этих переживаниях. Ты справляешься! 🫂',
  'Ты учишься быть честным с собой - это самое ценное 💫',
  'Спасибо за откровенность! Обнимаю 👐🏻 Каждое названное чувство - шаг к пониманию себя',
  'Ты смог увидеть и принять свои эмоции. Я с тобой, продолжаем! 🤗',
];

// Обработчик для кнопки "Да ☑️" после ввода негативных переживаний
export async function handleConfirmNegative(ctx: BotContext, bot: Telegraf, scheduler: Scheduler) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const messageId = ctx.callbackQuery.message?.message_id;
    const chatId = ctx.callbackQuery.message?.chat?.id;
    const userId = ctx.from?.id;

    await ctx.answerCbQuery('👍 Отлично! Продолжаем');

    botLogger.info(
      {
        action: 'confirm_negative',
        channelMessageId,
        messageId,
        chatId,
        userId,
      },
      '🔘 Нажата кнопка "Да ☑️/Готово ☑️" после выгрузки негативных переживаний'
    );

    // Останавливаем таймер напоминания если он есть
    if (scheduler && userId) {
      const cancelled = scheduler.cancelReminderTimeout(userId);
      botLogger.debug(
        { userId, cancelled },
        cancelled
          ? '⏰ Таймер напоминания остановлен при нажатии кнопки'
          : '✅ Таймера не было, но отмечено что пользователь ответил'
      );
    } else {
      botLogger.warn(
        { userId, hasScheduler: !!scheduler },
        '⚠️ Не удалось получить scheduler для отмены таймера'
      );
    }

    // Удаляем сообщение "Все описал?" или "Если ты все описал..." с кнопкой
    try {
      await bot.telegram.deleteMessage(chatId!, messageId!);
      botLogger.info({ messageId }, '🗑 Удалено сообщение "Все описал?"');
    } catch (deleteError) {
      botLogger.warn({ error: deleteError }, 'Не удалось удалить сообщение "Все описал?"');
    }

    // Получаем данные поста из БД
    const { getInteractivePost, updateTaskStatus, updateInteractivePostState } = await import('../../db');
    const post = getInteractivePost(channelMessageId);

    if (!post) {
      botLogger.error({ channelMessageId }, 'Критическая ошибка: пост не найден в БД');
      await ctx.answerCbQuery('❌ Ошибка: пост не найден');
      return;
    }

    // Отмечаем первое задание как выполненное
    updateTaskStatus(channelMessageId, 1, true);

    // Получаем все сообщения пользователя для этого задания с текстом
    const { db } = await import('../../db');
    const userMessagesQuery = db.query(`
      SELECT message_id, message_preview FROM message_links
      WHERE channel_message_id = ? AND message_type = 'user'
      ORDER BY created_at ASC
    `);
    const userMessages = userMessagesQuery.all(channelMessageId) as any[];

    botLogger.info(
      { channelMessageId, messagesCount: userMessages.length },
      `📊 Получено ${userMessages.length} сообщений от пользователя`
    );

    let replyToMessageId: number = messageId || 0;
    let needsEmotionsClarification = false;

    // Проверяем эмоции во ВСЕХ сообщениях (включая случай когда сообщение одно)
    const { countEmotions } = await import('../../utils/emotions');
    const messagesWithFewEmotions: number[] = [];
    const messagesWithNoEmotions: number[] = [];

    if (userMessages.length >= 1) {
      // Проверяем эмоции в каждом сообщении
      for (const msg of userMessages) {
        const messageText = msg.message_preview || '';
        const emotionsResult = countEmotions(messageText, 'all');

        botLogger.debug(
          { messageId: msg.message_id, emotionsCount: emotionsResult.count, emotions: emotionsResult.emotions },
          '📝 Проверка эмоций в сообщении'
        );

        if (emotionsResult.count === 0) {
          messagesWithNoEmotions.push(msg.message_id);
        }

        if (emotionsResult.count < 3) {
          messagesWithFewEmotions.push(msg.message_id);
        }
      }
    }

    // === ЛОГИКА ВЫБОРА ОТВЕТА НА ОСНОВЕ КОЛИЧЕСТВА СООБЩЕНИЙ С < 3 ЭМОЦИЙ ===
    const fewEmotionsCount = messagesWithFewEmotions.length;
    const noEmotionsCount = messagesWithNoEmotions.length;

    if (!chatId || !userId) {
      botLogger.error({ channelMessageId }, 'Отсутствует chatId или userId');
      return;
    }

    // Случай: эмоций нет НИ В ОДНОМ сообщении
    if (noEmotionsCount === userMessages.length && userMessages.length > 0) {
      botLogger.info({ channelMessageId, messagesCount: userMessages.length }, '😿 Эмоций нет ни в одном сообщении');

      const clarificationText = `<i>Спасибо, что делишься со мной! Я ценю это 💚</i>\n\n<b>Добавь, пожалуйста, хотя бы несколько эмоций к каждой ситуации 😿</b>`;

      try {
        await scenarioSendWithRetry(
          bot,
          chatId,
          userId,
          () =>
            bot.telegram.sendMessage(chatId, clarificationText, {
              parse_mode: 'HTML',
              reply_parameters: { message_id: userMessages[userMessages.length - 1].message_id },
              reply_markup: {
                inline_keyboard: [[{ text: 'Помоги с эмоциями', callback_data: `help_emotions_${channelMessageId}` }]],
              },
            }),
          'confirm_negative_no_emotions'
        );

        // Обновляем состояние - ждем добавления эмоций с скользящей кнопкой
        updateInteractivePostState(channelMessageId, 'waiting_emotions_addition', {
          user_task1_message_id: userMessages[userMessages.length - 1].message_id,
        });

        botLogger.info({ channelMessageId }, '✅ Состояние обновлено на waiting_emotions_addition (все 0)');
      } catch (error) {
        botLogger.error({ error }, 'Ошибка отправки запроса эмоций (нет ни в одном)');
      }
      return;
    }

    // Случай: 1 сообщение с <3 эмоций → запрашиваем больше эмоций (СТАРАЯ ЛОГИКА)
    if (userMessages.length === 1 && fewEmotionsCount === 1) {
      botLogger.info({ channelMessageId }, '📝 Одно сообщение с <3 эмоций - запрашиваем больше');

      replyToMessageId = userMessages[0].message_id;

      // Используем старую функцию getEmotionHelpMessage
      const { getEmotionHelpMessage } = await import('../../utils/emotions');
      const emotionAnalysis = countEmotions(userMessages[0].message_preview || '', 'negative');
      const helpMessage = getEmotionHelpMessage(emotionAnalysis.emotions, 'negative');

      // Если эмоций совсем нет (0) - только "Таблица эмоций", иначе + "В другой раз"
      const keyboard =
        emotionAnalysis.count === 0
          ? [[{ text: 'Таблица эмоций', callback_data: `emotions_table_${channelMessageId}` }]]
          : [
              [{ text: 'Таблица эмоций', callback_data: `emotions_table_${channelMessageId}` }],
              [{ text: 'В другой раз', callback_data: `skip_neg_${channelMessageId}` }],
            ];

      try {
        await scenarioSendWithRetry(
          bot,
          chatId,
          userId,
          () =>
            bot.telegram.sendMessage(chatId, helpMessage, {
              parse_mode: 'HTML',
              reply_parameters: { message_id: replyToMessageId },
              reply_markup: {
                inline_keyboard: keyboard,
              },
            }),
          'confirm_negative_one_message_few_emotions'
        );

        // Обновляем состояние в БД - теперь ждем ответ на уточнение эмоций
        updateInteractivePostState(channelMessageId, 'waiting_emotions_clarification', {
          user_schema_message_id: userMessages[0].message_id,
        });

        botLogger.info({ channelMessageId }, '✅ Состояние обновлено на waiting_emotions_clarification');
      } catch (error) {
        botLogger.error({ error }, 'Ошибка отправки запроса эмоций (1 сообщение)');
      }
      return;
    }

    // Случай: 1 сообщение с ≥3 эмоций → отправляем Плюшки (СТАРАЯ ЛОГИКА)
    if (userMessages.length === 1 && fewEmotionsCount === 0) {
      botLogger.info({ channelMessageId }, '✅ Одно сообщение с ≥3 эмоций - отправляем Плюшки');

      replyToMessageId = userMessages[0].message_id;
      await sendPlushkiMessage(bot, chatId, userId, channelMessageId, replyToMessageId, userMessages);
      return;
    }

    // === ЛОГИКА ДЛЯ НЕСКОЛЬКИХ СООБЩЕНИЙ ===

    // Случай: эмоций нет НИ В ОДНОМ сообщении (только для нескольких сообщений)
    if (userMessages.length > 1) {
      // Случай: эмоций нет НИ В ОДНОМ сообщении
      if (noEmotionsCount === userMessages.length) {
        botLogger.info({ channelMessageId, messagesCount: userMessages.length }, '😿 Эмоций нет ни в одном сообщении (несколько сообщений)');

        const clarificationText = `<i>Спасибо, что делишься со мной! Я ценю это 💚</i>\n\n<b>Добавь, пожалуйста, хотя бы несколько эмоций к каждой ситуации 😿</b>`;

        try {
          await scenarioSendWithRetry(
            bot,
            chatId!,
            userId!,
            () =>
              bot.telegram.sendMessage(chatId!, clarificationText, {
                parse_mode: 'HTML',
                reply_parameters: { message_id: userMessages[userMessages.length - 1].message_id },
                reply_markup: {
                  inline_keyboard: [[{ text: 'Помоги с эмоциями', callback_data: `help_emotions_${channelMessageId}` }]],
                },
              }),
            'confirm_negative_no_emotions'
          );
        } catch (error) {
          botLogger.error({ error }, 'Ошибка отправки запроса эмоций (нет ни в одном)');
        }
        return;
      }

      if (!chatId || !userId) {
        botLogger.error({ channelMessageId }, 'Отсутствует chatId или userId');
        return;
      }

      if (fewEmotionsCount === 1) {
        // Только в одном сообщении < 3 эмоций → просим добавить эмоции
        replyToMessageId = messagesWithFewEmotions[0];
        botLogger.info({ channelMessageId, messageId: replyToMessageId }, '📝 1 сообщение с < 3 эмоций - просим добавить');

        const clarificationText = `У тебя отлично выходит, а к этой ситуации давай добавим эмоций`;

        try {
          await scenarioSendWithRetry(
            bot,
            chatId,
            userId,
            () =>
              bot.telegram.sendMessage(chatId, clarificationText, {
                parse_mode: 'HTML',
                reply_parameters: { message_id: replyToMessageId },
                reply_markup: {
                  inline_keyboard: [[{ text: 'Таблица эмоций', callback_data: `emotions_table_${channelMessageId}` }]],
                },
              }),
            'confirm_negative_single_message_few_emotions'
          );

          // Обновляем состояние - ждем добавления эмоций
          updateInteractivePostState(channelMessageId, 'waiting_emotions_clarification', {
            user_schema_message_id: replyToMessageId,
          });

          botLogger.info({ channelMessageId }, '✅ Состояние обновлено на waiting_emotions_clarification (1 из нескольких)');
        } catch (error) {
          botLogger.error({ error }, 'Ошибка отправки запроса эмоций (1 из нескольких)');
        }
        return;
      }

      if (fewEmotionsCount === 0) {
        // Во всех сообщениях >= 3 эмоций → отправляем поддерживающее сообщение
        replyToMessageId = userMessages[userMessages.length - 1].message_id;
        botLogger.info({ channelMessageId }, '✅ Во всех сообщениях >= 3 эмоций - отправляем поддержку');

        // Получаем последние использованные сообщения
        const { getLastUsedSupportMessages, addUsedSupportMessage } = await import('../../db');
        const lastUsed = getLastUsedSupportMessages(5);

        // Выбираем случайное сообщение, исключая последние 5
        let availableMessages = SUPPORT_MESSAGES.map((msg, idx) => idx).filter(idx => !lastUsed.includes(idx));

        // Если доступных сообщений нет (все использованы) - используем все
        if (availableMessages.length === 0) {
          availableMessages = SUPPORT_MESSAGES.map((msg, idx) => idx);
        }

        const randomIndex = availableMessages[Math.floor(Math.random() * availableMessages.length)];
        const supportText = SUPPORT_MESSAGES[randomIndex];

        // Сохраняем использованное сообщение
        addUsedSupportMessage(randomIndex);

        botLogger.info({ channelMessageId, messageIndex: randomIndex }, `💚 Отправляем поддерживающее сообщение #${randomIndex}`);

        // Отправляем поддерживающее сообщение с кнопкой
        try {
          await scenarioSendWithRetry(
            bot,
            chatId,
            userId,
            () =>
              bot.telegram.sendMessage(chatId, supportText, {
                parse_mode: 'HTML',
                reply_parameters: { message_id: replyToMessageId },
                reply_markup: {
                  inline_keyboard: [[{ text: 'Идем дальше 🚀', callback_data: `continue_to_plushki_${channelMessageId}` }]],
                },
              }),
            'confirm_negative_support_message'
          );
        } catch (error) {
          botLogger.error({ error }, 'Ошибка отправки поддерживающего сообщения');
        }
        return;
      }

      if (fewEmotionsCount >= 2 && fewEmotionsCount <= 3) {
        // 2-3 сообщения с < 3 эмоций → пошаговое уточнение
        botLogger.info({ channelMessageId, fewEmotionsCount }, '📝 2-3 сообщения с < 3 эмоций - начинаем пошаговое уточнение');

        // Сохраняем список сообщений для уточнения в message_data
        const { getInteractivePost, db } = await import('../../db');
        const currentPost = getInteractivePost(channelMessageId);

        const updatedMessageData = {
          ...(currentPost?.message_data || {}),
          emotions_clarification_messages: messagesWithFewEmotions,
          emotions_clarification_step: 0,
        };

        const updateQuery = db.query(`
          UPDATE interactive_posts
          SET current_state = ?, message_data = ?
          WHERE channel_message_id = ?
        `);
        updateQuery.run('waiting_emotions_clarification', JSON.stringify(updatedMessageData), channelMessageId);

        // Отправляем первый запрос
        await sendEmotionsClarificationStep(bot, chatId!, userId!, channelMessageId, messagesWithFewEmotions[0], 0, fewEmotionsCount);
        return;
      }

      if (fewEmotionsCount > 3) {
        // Больше 3 сообщений с < 3 эмоций → одно общее сообщение
        botLogger.info({ channelMessageId, fewEmotionsCount }, '📝 Больше 3 сообщений с < 3 эмоций - общее уточнение');

        const clarificationText = `<i>Спасибо, что делишься со мной! Я ценю это 💚</i>\n\n<b>Напиши чуть больше о своих чувствах, в каждом событии ты что-то переживаешь 💔</b>`;

        if (!chatId || !userId) {
          botLogger.error({ channelMessageId }, 'Отсутствует chatId или userId');
          return;
        }

        try {
          await scenarioSendWithRetry(
            bot,
            chatId,
            userId,
            () =>
              bot.telegram.sendMessage(chatId, clarificationText, {
                parse_mode: 'HTML',
                reply_parameters: { message_id: userMessages[userMessages.length - 1].message_id },
                reply_markup: {
                  inline_keyboard: [[{ text: 'Таблица эмоций', callback_data: `emotions_table_${channelMessageId}` }]],
                },
              }),
            'confirm_negative_many_clarifications'
          );

          // Обновляем состояние - ждем добавления эмоций с скользящей кнопкой
          updateInteractivePostState(channelMessageId, 'waiting_emotions_addition', {
            user_task1_message_id: userMessages[userMessages.length - 1].message_id,
          });

          botLogger.info({ channelMessageId }, '✅ Состояние обновлено на waiting_emotions_addition (>3 с <3)');
        } catch (error) {
          botLogger.error({ error }, 'Ошибка отправки общего уточнения');
        }
        return;
      }
    }

    // Если дошли сюда - одно сообщение или не нужно уточнение
    // Отправляем "Плюшки для лягушки" с сохранением негативных событий
    if (chatId && userId) {
      await sendPlushkiMessage(bot, chatId, userId, channelMessageId, replyToMessageId, userMessages);
    }
  } catch (error) {
    botLogger.error(
      { error: (error as Error).message, stack: (error as Error).stack },
      'Ошибка обработки кнопки "Да ☑️"'
    );
    try {
      await ctx.answerCbQuery('❌ Произошла ошибка, попробуй еще раз');
    } catch (answerError) {
      botLogger.error({ answerError }, 'Не удалось отправить answerCbQuery после ошибки');
    }
  }
}

// Вспомогательная функция для отправки "Плюшки для лягушки"
async function sendPlushkiMessage(
  bot: Telegraf,
  chatId: number,
  userId: number,
  channelMessageId: number,
  replyToMessageId: number,
  userMessages?: any[]
) {
  const { updateInteractivePostState } = await import('../../db');

  const plushkiText = '2. <b>Плюшки для лягушки</b>\n\nВспомни и напиши все приятное за день\nТут тоже опиши эмоции, которые ты испытал 😍';

  const plushkiKeyboard = {
    inline_keyboard: [[{ text: 'Таблица эмоций', callback_data: `emotions_table_${channelMessageId}` }]],
  };

  // АСИНХРОННО сохраняем негативные события (не блокируем отправку плюшек)
  if (userMessages && userMessages.length > 0) {
    // Запускаем асинхронно
    (async () => {
      try {
        const { saveNegativeEvent } = await import('../../db');

        // Собираем все тексты в одну строку
        const allText = userMessages.map(m => m.message_preview || '').filter(Boolean).join('\n');

        if (allText) {
          saveNegativeEvent(
            userId,
            allText,
            '', // Эмоции уже в тексте события
            channelMessageId.toString()
          );
          botLogger.info({ userId, channelMessageId, messagesCount: userMessages.length }, '💔 Негативное событие сохранено асинхронно (вечер, упрощенный)');
        }
      } catch (error) {
        botLogger.error({ error, userId, channelMessageId }, 'Ошибка асинхронного сохранения негативного события');
      }
    })();
  }

  try {
    const plushkiMessage = await scenarioSendWithRetry(
      bot,
      chatId,
      userId,
      () =>
        bot.telegram.sendMessage(chatId, plushkiText, {
          parse_mode: 'HTML',
          reply_parameters: { message_id: replyToMessageId },
          reply_markup: plushkiKeyboard,
        }),
      'confirm_negative_plushki',
      { maxAttempts: 5, intervalMs: 3000 }
    );

    // Обновляем состояние в БД
    updateInteractivePostState(channelMessageId, 'waiting_positive', {
      bot_task2_message_id: plushkiMessage.message_id,
    });

    botLogger.info({ channelMessageId }, '✅ Отправлены "Плюшки для лягушки"');
  } catch (sendError) {
    botLogger.error({ error: sendError }, 'Критическая ошибка: не удалось отправить плюшки');
  }
}

// Функция для отправки пошагового уточнения эмоций
export async function sendEmotionsClarificationStep(
  bot: Telegraf,
  chatId: number,
  userId: number,
  channelMessageId: number,
  messageId: number,
  step: number,
  totalSteps: number
) {
  let text: string;
  let keyboard: any;

  if (step === 0) {
    // Первое сообщение
    const randomPhrase = MORE_EMOTIONS_PHRASES[Math.floor(Math.random() * MORE_EMOTIONS_PHRASES.length)];
    text = `<i>Спасибо, что делишься со мной! Я ценю это 💚</i>\n\n<b>${randomPhrase}</b>`;
    keyboard = {
      inline_keyboard: [[{ text: 'Таблица эмоций', callback_data: `emotions_table_${channelMessageId}` }]],
    };
  } else if (step === 1) {
    // Второе сообщение
    text = 'И вот тут добавь эмоций 🥹';
    keyboard = {
      inline_keyboard: [[{ text: 'Таблица эмоций', callback_data: `emotions_table_${channelMessageId}` }]],
    };
  } else if (step === 2) {
    // Третье сообщение
    text = 'А еще сюда добавь, пожалуйста, своих чувств';
    keyboard = {
      inline_keyboard: [[{ text: 'На сегодня хватит - пропустить 😮‍💨', callback_data: `skip_emotions_clarification_${channelMessageId}` }]],
    };
  }

  try {
    await scenarioSendWithRetry(
      bot,
      chatId,
      userId,
      () =>
        bot.telegram.sendMessage(chatId, text!, {
          parse_mode: 'HTML',
          reply_parameters: { message_id: messageId },
          reply_markup: keyboard!,
        }),
      `emotions_clarification_step_${step}`
    );

    botLogger.info({ channelMessageId, step, messageId }, `📝 Отправлен запрос эмоций, шаг ${step + 1}`);
  } catch (error) {
    botLogger.error({ error, channelMessageId, step }, 'Ошибка отправки запроса эмоций');
  }
}
