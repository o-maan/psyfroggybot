import { readFile } from 'fs/promises';
import type { BotContext } from '../../types';
import { botLogger } from '../../logger';
import { getMorningPost, updateMorningPostStep, getLastNMessages } from '../../db';
import { generateMessage } from '../../llm';
import { cleanLLMText } from '../../utils/clean-llm-text';
import { readFileSync } from 'fs';
import { callbackSendWithRetry } from '../../utils/telegram-retry';

// Обработчик кнопки "Не помню других эмоций" для утренних постов
export async function handleMorningCantRemember(ctx: BotContext) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const userId = ctx.from?.id;
    const threadId = 'message_thread_id' in ctx.callbackQuery.message! ? ctx.callbackQuery.message.message_thread_id : undefined;

    if (!userId) {
      botLogger.error({ channelMessageId }, 'Нет userId в контексте');
      await ctx.answerCbQuery('Ошибка: пользователь не определен');
      return;
    }

    // Закрываем всплывашку
    await ctx.answerCbQuery();

    botLogger.info(
      {
        action: 'morning_cant_remember',
        channelMessageId,
        userId,
      },
      '🌅 Нажата кнопка "Не помню других эмоций" на утреннем посте'
    );

    // Получаем утренний пост
    const morningPost = await getMorningPost(channelMessageId);

    if (!morningPost) {
      botLogger.error({ channelMessageId }, 'Утренний пост не найден в БД');
      return;
    }

    // Проверяем что пользователь нажал кнопку на своем посте
    if (morningPost.user_id !== userId) {
      botLogger.warn({ userId, postUserId: morningPost.user_id }, 'Пользователь нажал на чужой утренний пост');
      await ctx.answerCbQuery('Это не твой пост 😊');
      return;
    }

    // Получаем все сообщения пользователя
    const messages = getLastNMessages(userId, 10);
    const userMessages = messages
      .filter(m => m.author_id === userId)
      .map(m => m.message_text)
      .reverse()
      .join('\n');

    const chatId = ctx.callbackQuery.message?.chat?.id!;
    const replyToMessageId = ctx.callbackQuery.message?.message_id;

    // Отправляем сообщение "Читаю, минутку..."
    const readingMessageOptions: any = { parse_mode: 'HTML' };
    if (threadId) {
      readingMessageOptions.reply_to_message_id = threadId;
    }

    await callbackSendWithRetry(
      ctx,
      () => ctx.telegram.sendMessage(chatId, 'Читаю, минутку… 🧐', readingMessageOptions),
      'morning_cant_remember_reading'
    );

    // Определяем sentiment из current_step (waiting_more_emotions_negative или waiting_more_emotions_positive)
    const sentiment = morningPost.current_step.includes('negative') ? 'negative' : 'positive';

    // Генерируем финальный ответ (переходим к STEP 3)
    const finalPromptTemplate = await readFile('assets/prompts/morning-final-response.md', 'utf-8');
    const finalPrompt = finalPromptTemplate
      .replace('{{USER_MESSAGES}}', userMessages)
      .replace('{{SENTIMENT_TYPE}}', sentiment)
      .replace('{{#if isNegative}}', sentiment === 'negative' ? '' : '<!--')
      .replace('{{else}}', sentiment === 'negative' ? '-->' : '')
      .replace('{{/if}}', '');

    const finalResponse = await generateMessage(finalPrompt);
    const cleanedFinalResponse = cleanLLMText(finalResponse);

    const sendOptions: any = { parse_mode: 'HTML' };
    if (threadId) {
      sendOptions.reply_to_message_id = threadId;
    }

    await callbackSendWithRetry(
      ctx,
      () => ctx.telegram.sendMessage(chatId, cleanedFinalResponse, sendOptions),
      'morning_cant_remember_final'
    );

    // Обновляем шаг на завершенный
    updateMorningPostStep(channelMessageId, 'completed');

    botLogger.info({ userId }, '✅ Отправлен финальный ответ после "Не помню других эмоций"');
  } catch (error) {
    botLogger.error({ error: (error as Error).message, stack: (error as Error).stack }, 'Ошибка обработки кнопки "Не помню других эмоций"');

    try {
      await ctx.answerCbQuery('Произошла ошибка, попробуй еще раз 🙏');
    } catch (answerError) {
      botLogger.error({ answerError }, 'Не удалось отправить answerCbQuery после ошибки');
    }
  }
}
