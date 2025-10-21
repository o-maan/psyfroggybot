import type { BotContext } from '../../types';
import { botLogger } from '../../logger';
import { getMorningPost, updateMorningPostStep, getMorningPostUserMessages, getMorningPostMessagesAfterLastFinal, updateMorningPostFinalMessageTime } from '../../db';
import { generateMessage, analyzeWithLowTemp } from '../../llm';
import { cleanLLMText } from '../../utils/clean-llm-text';
import { extractJsonFromLLM } from '../../utils/extract-json-from-llm';
import { readFileSync } from 'fs';
import { callbackSendWithRetry } from '../../utils/telegram-retry';

// Обработчик кнопки "Ответь мне" для утренних постов
export async function handleMorningRespond(ctx: BotContext) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const userId = ctx.from?.id;

    if (!userId) {
      botLogger.error({ channelMessageId }, 'Нет userId в контексте');
      await ctx.answerCbQuery('Ошибка: пользователь не определен');
      return;
    }

    // Показываем всплывашку "Froggy пишет..."
    await ctx.answerCbQuery('Froggy пишет...');

    botLogger.info(
      {
        action: 'morning_respond',
        channelMessageId,
        userId,
      },
      '🌅 Нажата кнопка "Ответь мне" на утреннем посте'
    );

    // Получаем утренний пост
    const morningPost = await getMorningPost(channelMessageId);

    if (!morningPost) {
      botLogger.error({ channelMessageId }, 'Утренний пост не найден в БД');
      await ctx.answerCbQuery('Ошибка: пост не найден');
      return;
    }

    // Проверяем что пользователь нажал кнопку на своем посте
    if (morningPost.user_id !== userId) {
      botLogger.warn({ userId, postUserId: morningPost.user_id }, 'Пользователь нажал на чужой утренний пост');
      await ctx.answerCbQuery('Это не твой пост 😊');
      return;
    }

    const chatId = ctx.callbackQuery.message?.chat?.id!;
    const replyToMessageId = ctx.callbackQuery.message?.message_id;

    // Отправляем сообщение "Froggy пишет... 💻\nПодожди минутку" (курсивом)
    await ctx.telegram.sendMessage(chatId, '<i>Froggy пишет... 💻\nПодожди минутку</i>', {
      reply_parameters: { message_id: replyToMessageId! },
      parse_mode: 'HTML'
    });

    // Получаем ВСЕ сообщения за день (для контекста и связности)
    const allDayMessages = getMorningPostUserMessages(userId, channelMessageId);
    const allDayUserMessages = allDayMessages
      .map(m => m.message_text)
      .join('\n');

    // Получаем сообщения НОВОГО цикла (после последнего финального ответа)
    // Это для анализа sentiment - отвечаем преимущественно на НОВУЮ ситуацию
    const newCycleMessages = getMorningPostMessagesAfterLastFinal(userId, channelMessageId);
    const newCycleUserMessages = newCycleMessages
      .map(m => m.message_text)
      .join('\n');

    botLogger.info({
      userId,
      allDayMessagesCount: allDayMessages.length,
      newCycleMessagesCount: newCycleMessages.length
    }, 'Анализируем сообщения пользователя');

    // Анализируем эмоции НОВОГО цикла с помощью LLM (с низкой температурой для точности)
    const analyzePromptTemplate = readFileSync('assets/prompts/morning-analyze-emotions.md', 'utf-8');
    const analyzePrompt = analyzePromptTemplate.replace('{{USER_MESSAGES}}', newCycleUserMessages);

    const analyzeResult = await analyzeWithLowTemp(analyzePrompt);
    const cleanedAnalyzeResult = extractJsonFromLLM(analyzeResult);

    let analysisData: { sentiment: string; emotions_count: number; emotions_described: boolean } | null = null;
    try {
      const parsed = JSON.parse(cleanedAnalyzeResult) as any;
      // Нормализуем ключи (LLM может вернуть emotionscount вместо emotions_count)
      analysisData = {
        sentiment: parsed.sentiment || 'neutral',
        emotions_count: parsed.emotions_count ?? parsed.emotionscount ?? 0,
        emotions_described: parsed.emotions_described ?? parsed.emotionsdescribed ?? false
      };
    } catch (parseError) {
      botLogger.error(
        { error: parseError, result: cleanedAnalyzeResult },
        'Ошибка парсинга результата анализа эмоций'
      );
    }

    if (!analysisData) {
      // Fallback - если не удалось распарсить
      analysisData = { sentiment: 'neutral', emotions_count: 0, emotions_described: false };
    }

    botLogger.info({ userId, analysisData }, 'Результат анализа эмоций');

    // Если названо 3 и более эмоций - сразу переходим к финальному ответу
    if (analysisData.emotions_count >= 3) {
      botLogger.info({ userId }, 'Названо 3+ эмоций, переходим к финальному ответу');

      // Используем специальный промпт для первого финального ответа (без предыдущих ответов бота)
      const finalPromptTemplate = readFileSync('assets/prompts/morning-first-final-response.md', 'utf-8');
      const finalPrompt = finalPromptTemplate
        .replace('{{USER_MESSAGES}}', allDayUserMessages)
        .replace('{{SENTIMENT_TYPE}}', analysisData.sentiment)
        .replace('{{#if isNegative}}', analysisData.sentiment === 'negative' ? '' : '<!--')
        .replace('{{else}}', analysisData.sentiment === 'negative' ? '-->' : '')
        .replace('{{/if}}', '');

      const finalResponse = await generateMessage(finalPrompt);
      const cleanedFinalResponse = cleanLLMText(finalResponse);

      // Добавляем финальную фразу для завершения цикла
      const fullMessage = `${cleanedFinalResponse}\n\nЕсли захочешь еще чем-то поделиться - я рядом 🤗`;

      const sendOptions: any = { parse_mode: 'HTML' };
      if (replyToMessageId) {
        sendOptions.reply_parameters = { message_id: replyToMessageId };
      }

      await callbackSendWithRetry(
        ctx,
        () => ctx.telegram.sendMessage(chatId, fullMessage, sendOptions),
        'morning_final_response'
      );

      // Записываем timestamp финального сообщения для определения начала нового цикла
      const finalMessageTimestamp = new Date().toISOString();
      updateMorningPostFinalMessageTime(channelMessageId, finalMessageTimestamp);
      botLogger.info({ userId, timestamp: finalMessageTimestamp }, '⏱️ Обновлен timestamp финального сообщения');

      // Обновляем шаг на "waiting_more" чтобы бот продолжал слушать (работа по кругу)
      updateMorningPostStep(channelMessageId, 'waiting_more');

      botLogger.info({ userId }, '✅ Отправлен финальный ответ (3+ эмоций)');
      return;
    }

    // Если меньше 3 эмоций - отправляем промежуточный ответ с просьбой указать эмоции
    botLogger.info({ userId, emotionsCount: analysisData.emotions_count, sentiment: analysisData.sentiment }, 'Меньше 3 эмоций, просим указать больше');

    // Определяем какие условия передавать в промпт
    const needsEmotions = analysisData.emotions_count === 0;
    const needsMoreEmotions = analysisData.emotions_count > 0 && analysisData.emotions_count < 3;

    // Формируем промпт для генерации ответа с двумя частями
    let responsePrompt = '';

    if (analysisData.sentiment === 'negative') {
      // Негативные события
      if (needsEmotions) {
        responsePrompt = `Пользователь поделился негативными переживаниями, но не назвал свои эмоции.

НОВАЯ ситуация (отвечай на ЭТО):
${newCycleUserMessages}

Контекст всего дня (используй ТОЛЬКО если есть прямая связь с новой ситуацией, в большинстве случаев НЕ учитывай):
${allDayUserMessages}

ВАЖНО: Твоя задача - помочь человеку НАЗВАТЬ эмоции, которые он испытывает. Спрашивай там, где это уместно, какие эмоции он почувствовал.

Тебе нужно ответить в формате JSON с двумя частями:

1. "support_text": Слова поддержки, сочувствия и заботы (до 200 символов, до 2 эмоджи)
2. "question_text": Вопрос, который поможет человеку назвать эмоции

Пример структуры ответа:
{
  "support_text": "Мне очень жаль это слышать! 😔 Обнимаю 👐🏻",
  "question_text": "Расскажи мне, пожалуйста, какие эмоции ты сейчас испытываешь?"
}

Требования:
- Пиши тепло, заботливо и искренне
- Как человек, а не робот
- НЕ используй обращения типа "брат", "братан", "бро", "слушай" и т.п.
- Акцент на ЭМОЦИЯХ (чувствах)
- Мужской род (например, "я рад")
- Верни ТОЛЬКО валидный JSON без дополнительных пояснений`;

      } else if (needsMoreEmotions) {
        responsePrompt = `Пользователь поделился негативными переживаниями и назвал 1-2 эмоции.

НОВАЯ ситуация (отвечай на ЭТО):
${newCycleUserMessages}

Контекст всего дня (используй ТОЛЬКО если есть прямая связь с новой ситуацией, в большинстве случаев НЕ учитывай):
${allDayUserMessages}

ВАЖНО: Человек уже назвал некоторые эмоции. НЕ спрашивай про эмоции и ощущения, которые он УЖЕ описал. Спрашивай про ЧТО ЕЩЕ он чувствует помимо этого.

Тебе нужно ответить в формате JSON с двумя частями:

1. "support_text": Слова поддержки и сочувствия (до 200 символов, до 2 эмоджи)
2. "question_text": Мягкая просьба назвать другие эмоции помимо уже описанных

Пример структуры ответа:
{
  "support_text": "Это действительно тяжело, понимаю 🫠 Я рядом!",
  "question_text": "Есть ли еще какие-то чувства, которые ты испытываешь?"
}

Требования:
- Пиши тепло, заботливо и искренне
- Как человек, а не робот
- НЕ используй обращения типа "брат", "братан", "бро", "слушай" и т.п.
- Мужской род (например, "я рад")
- Верни ТОЛЬКО валидный JSON без дополнительных пояснений`;
      }
    } else {
      // Позитивные события
      if (needsEmotions) {
        responsePrompt = `Пользователь поделился позитивными событиями, но не назвал свои эмоции.

НОВАЯ ситуация (отвечай на ЭТО):
${newCycleUserMessages}

Контекст всего дня (используй ТОЛЬКО если есть прямая связь с новой ситуацией, в большинстве случаев НЕ учитывай):
${allDayUserMessages}

ВАЖНО: Твоя задача - помочь человеку НАЗВАТЬ эмоции, которые он испытывает. Спрашивай там, где это уместно, какие эмоции он почувствовал.

Тебе нужно ответить в формате JSON с двумя частями:

1. "support_text": Искренняя радость за человека, восхищение или похвала (до 200 символов, до 2 эмоджи)
2. "question_text": Вопрос, который поможет человеку назвать эмоции

Пример структуры ответа:
{
  "support_text": "Вау, меня радуют такие новости! 😊 Это очень здорово!",
  "question_text": "Какие эмоции ты испытал при этом?"
}

Требования:
- Пиши тепло, заботливо и искренне
- Как человек, а не робот
- НЕ используй обращения типа "брат", "братан", "бро", "слушай" и т.п.
- Акцент на ЭМОЦИЯХ (чувствах)
- Мужской род (например, "я рад")
- Верни ТОЛЬКО валидный JSON без дополнительных пояснений`;

      } else if (needsMoreEmotions) {
        responsePrompt = `Пользователь поделился позитивными событиями и назвал 1-2 эмоции.

НОВАЯ ситуация (отвечай на ЭТО):
${newCycleUserMessages}

Контекст всего дня (используй ТОЛЬКО если есть прямая связь с новой ситуацией, в большинстве случаев НЕ учитывай):
${allDayUserMessages}

ВАЖНО: Человек уже назвал некоторые эмоции. НЕ спрашивай про эмоции и ощущения, которые он УЖЕ описал. Спрашивай про ЧТО ЕЩЕ он чувствует помимо этого.

Тебе нужно ответить в формате JSON с двумя частями:

1. "support_text": Радость за успехи и похвала (до 200 символов, до 2 эмоджи)
2. "question_text": Мягкая просьба назвать другие эмоции помимо уже описанных

Пример структуры ответа:
{
  "support_text": "Радуют твои успехи! 🤩 Я горжусь тобой!",
  "question_text": "Есть ли еще какие-то приятные чувства, которые ты испытываешь?"
}

Требования:
- Пиши тепло, заботливо и искренне
- Как человек, а не робот
- НЕ используй обращения типа "брат", "братан", "бро", "слушай" и т.п.
- Мужской род (например, "я рад")
- Верни ТОЛЬКО валидный JSON без дополнительных пояснений`;
      }
    }

    const response = await generateMessage(responsePrompt);
    const cleanedResponse = extractJsonFromLLM(response);

    botLogger.info({
      userId,
      sentiment: analysisData.sentiment,
      needsEmotions,
      needsMoreEmotions,
      emotionsCount: analysisData.emotions_count
    }, 'Генерируем ответ с двумя частями');

    // Парсим JSON ответ
    let responseData: { support_text: string; question_text?: string } | null = null;
    try {
      responseData = JSON.parse(cleanedResponse);
    } catch (parseError) {
      botLogger.error(
        { error: parseError, result: cleanedResponse },
        'Ошибка парсинга ответа с двумя частями'
      );
      // Fallback - используем весь текст как support_text
      responseData = { support_text: cleanedResponse };
    }

    if (!responseData) {
      botLogger.error('responseData is null после парсинга');
      responseData = { support_text: 'Произошла ошибка при генерации ответа 😔' };
    }

    botLogger.info({
      userId,
      support_text: responseData.support_text,
      question_text: responseData.question_text,
      has_support: !!responseData.support_text,
      has_question: !!responseData.question_text
    }, 'Распарсенные данные ответа');

    // Формируем финальное сообщение
    let finalMessage = responseData.support_text || 'Ошибка: пустой support_text';

    // Добавляем вопрос с новой строки, если он есть и нужен
    if ((needsEmotions || needsMoreEmotions) && responseData.question_text) {
      finalMessage += '\n\n' + responseData.question_text;
    }

    botLogger.info({
      userId,
      finalMessageLength: finalMessage.length,
      finalMessagePreview: finalMessage.substring(0, 100)
    }, 'Финальное сообщение для отправки');

    // Добавляем кнопки
    let keyboard: any = undefined;

    if (needsEmotions) {
      // Если эмоций нет вообще - даем кнопку "Помоги с эмоциями"
      keyboard = {
        inline_keyboard: [[{ text: '💡 Помоги с эмоциями', callback_data: `help_emotions_${channelMessageId}` }]],
      };
    } else if (needsMoreEmotions) {
      // Если эмоций мало - даем ДВЕ кнопки: "Таблица эмоций" и "Не помню других эмоций"
      keyboard = {
        inline_keyboard: [
          [{ text: '📊 Таблица эмоций', callback_data: `emotions_table_${channelMessageId}` }],
          [{ text: 'Не помню других эмоций', callback_data: `cant_remember_emotions_${channelMessageId}` }]
        ],
      };
    }

    const sendOptions: any = { parse_mode: 'HTML' };
    if (replyToMessageId) {
      sendOptions.reply_parameters = { message_id: replyToMessageId };
    }
    if (keyboard) {
      sendOptions.reply_markup = keyboard;
    }

    await callbackSendWithRetry(
      ctx,
      () => ctx.telegram.sendMessage(chatId, finalMessage, sendOptions),
      'morning_step2_response'
    );

    // Обновляем шаг - ждем больше эмоций
    const nextStep = `waiting_more_emotions_${analysisData.sentiment}`;
    updateMorningPostStep(channelMessageId, nextStep);

    botLogger.info({ userId, nextStep }, '✅ Отправлен ответ с просьбой указать эмоции');
  } catch (error) {
    botLogger.error({ error: (error as Error).message, stack: (error as Error).stack }, 'Ошибка обработки кнопки "Ответь мне"');

    try {
      await ctx.answerCbQuery('Произошла ошибка, попробуй еще раз 🙏');
    } catch (answerError) {
      botLogger.error({ answerError }, 'Не удалось отправить answerCbQuery после ошибки');
    }
  }
}
