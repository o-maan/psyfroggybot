import { readFile } from 'fs/promises';
import { botLogger } from '../../logger';
import type { BotContext } from '../../types';
import type { Telegraf } from 'telegraf';
import { readFileSync } from 'fs';
import path from 'path';

// Обработчик для кнопки пропуска позитивных эмоций
export async function handleSkipPositiveEmotions(ctx: BotContext, bot: Telegraf) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const messageId = ctx.callbackQuery.message?.message_id;
    const chatId = ctx.callbackQuery.message?.chat?.id;
    const userId = ctx.from?.id;
    const threadId = 'message_thread_id' in ctx.callbackQuery.message! ? ctx.callbackQuery.message.message_thread_id : undefined;

    await ctx.answerCbQuery('✅ Переходим к практике');

    botLogger.info(
      {
        action: 'skip_positive_emotions',
        channelMessageId,
        messageId,
        chatId,
        userId,
      },
      '🔘 Нажата кнопка пропуска позитивных эмоций'
    );

    // Получаем scheduler для доступа к методам
    const scheduler = (bot as any).scheduler;
    
    // Отправляем финальную часть
    let finalMessage = 'У нас остался последний шаг\n\n';
    finalMessage += '3. <b>Дыхательная практика</b>\n\n';
    finalMessage += '<blockquote><b>Дыхание по квадрату:</b>\nВдох на 4 счета, задержка дыхания на 4 счета, выдох на 4 счета и задержка на 4 счета</blockquote>';

    const practiceKeyboard = {
      inline_keyboard: [
        [{ text: '✅ Сделал', callback_data: `pract_done_${channelMessageId}` }],
        [{ text: '⏰ Отложить на 1 час', callback_data: `pract_delay_${channelMessageId}` }],
      ],
    };

    try {
      // Читаем видео файл
      const PRACTICE_VIDEO_PATH = path.join(process.cwd(), 'assets', 'videos', 'breathing-practice-optimized.mp4');
      const PRACTICE_VIDEO_THUMBNAIL_PATH = path.join(process.cwd(), 'assets', 'videos', 'breathing-practice-thumbnail.jpg');
      const practiceVideo = await readFile(PRACTICE_VIDEO_PATH);
      const thumbnailBuffer = await readFile(PRACTICE_VIDEO_THUMBNAIL_PATH);
      
      // Отправляем видео с практикой
      const videoOptions: any = {
        caption: finalMessage,
        parse_mode: 'HTML',
        reply_markup: practiceKeyboard,
        thumbnail: { source: thumbnailBuffer },
      };

      if (threadId) {
        videoOptions.reply_to_message_id = threadId;
      }

      const result = await bot.telegram.sendVideo(chatId!, { source: practiceVideo }, videoOptions as any);

      // Обновляем состояние в БД
      const { updateInteractivePostState, updateTaskStatus, saveMessage } = await import('../../db');
      
      // Отмечаем второе задание как выполненное
      updateTaskStatus(channelMessageId, 2, true);
      
      // Обновляем состояние
      updateInteractivePostState(channelMessageId, 'waiting_practice', {
        bot_task3_message_id: result.message_id,
      });
      
      // Отмечаем что задание 3 было отправлено
      updateTaskStatus(channelMessageId, 3, true);
      
      // Сохраняем сообщение
      saveMessage(userId!, finalMessage, new Date().toISOString(), 0);
      
      // Отменяем напоминание о незавершенной работе если есть scheduler
      if (scheduler && userId) {
        scheduler.clearReminder(userId);
        botLogger.debug({ userId, channelMessageId }, 'Напоминание отменено - пользователь пропустил позитивные эмоции и перешел к практике');
      }

      botLogger.info(
        { 
          channelMessageId,
          task3MessageId: result.message_id
        }, 
        '✅ Практика отправлена после пропуска позитивных эмоций'
      );
    } catch (error) {
      botLogger.error({ error: (error as Error).message }, 'Ошибка отправки практики после пропуска позитивных эмоций');
      
      // Fallback: отправляем текстовое сообщение
      const fallbackSendOptions: any = {
        parse_mode: 'HTML',
        reply_markup: practiceKeyboard,
      };

      if (threadId) {
        fallbackSendOptions.reply_to_message_id = threadId;
      }

      await bot.telegram.sendMessage(chatId!, finalMessage, fallbackSendOptions);
    }
  } catch (error) {
    botLogger.error({ error: (error as Error).message }, 'Ошибка обработки кнопки пропуска позитивных эмоций');
  }
}