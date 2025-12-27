import type { BotContext } from '../../types';
import { Telegraf } from 'telegraf';
import { botLogger } from '../../logger';
import { scenarioSendWithRetry } from '../../utils/telegram-retry';
import { sendToUser } from '../../utils/send-to-user';


// Обработчик кнопки "Упрощенный сценарий"
export async function handleScenarioSimplified(ctx: BotContext, bot: Telegraf) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const messageId = ctx.callbackQuery.message?.message_id;
    const chatId = ctx.callbackQuery.message?.chat?.id;
    const userId = ctx.from?.id;

    await ctx.answerCbQuery('🧩 Отлично! Начинаем упрощенный сценарий');

    botLogger.info(
      {
        action: 'scenario_simplified',
        channelMessageId,
        messageId,
        chatId,
        userId,
      },
      '🔘 Выбран упрощенный сценарий'
    );

    // Получаем данные поста из БД
    const { getInteractivePost, saveInteractivePost } = await import('../../db');
    let post = getInteractivePost(channelMessageId);
    
    // Определяем threadId заранее для fallback логики
    const threadId = 'message_thread_id' in ctx.callbackQuery.message! ? ctx.callbackQuery.message.message_thread_id : undefined;

    if (!post) {
      botLogger.warn({ channelMessageId, userId }, 'Пост не найден в БД, создаем fallback запись');

      // Fallback: создаем минимальную запись в БД
      try {
        // Используем минимальные данные для упрощенного сценария
        const defaultMessageData = {
          encouragement: { text: 'Привет! 🌸' },
          negative_part: { additional_text: null }, // Без дополнительного текста
          positive_part: { additional_text: null },
          feels_and_emotions: { additional_text: null }
        };

        // Определяем isDmMode: если нет threadId - скорее всего это ЛС
        const fallbackIsDmMode = !threadId;
        saveInteractivePost(channelMessageId, userId!, defaultMessageData, 'breathing', fallbackIsDmMode);
        botLogger.info({ channelMessageId, fallbackIsDmMode }, '💾 Fallback запись создана');
        
        // Получаем созданную запись
        post = getInteractivePost(channelMessageId);
      } catch (fallbackError) {
        botLogger.error({ error: fallbackError }, 'Ошибка создания fallback записи');
        await ctx.answerCbQuery('❌ Произошла ошибка. Попробуйте позже.');
        return;
      }
    }

    // Генерируем текст первого задания
    const firstTaskText = '1. <b>Выгрузка неприятных переживаний</b>\n\nОпиши все, что тебя волнует и какие эмоции 🥺 ты при этом испытывал${:а}\n\n<i>P.S. Отправь ответ одним сообщением или описывай каждую ситуацию отдельными сообщениями 💬</i>\n<i>Например:</i>\n<blockquote>Мне нахамили в магазине. Испытал возмущение, злость, обиду, тревогу, растерянность и чувство несправедливости</blockquote>';
    let firstTaskFullText = firstTaskText;

    // Кнопка пропуска
    const skipButtonTexts = [
      '😌 все ок - пропустить',
      '😊 у меня все хорошо - пропустить',
      '🌈 сегодня все отлично - пропустить',
      '✨ все супер - пропустить',
      '🌸 все в порядке - пропустить',
    ];
    const skipButtonText = skipButtonTexts[Math.floor(Math.random() * skipButtonTexts.length)];
    
    const firstTaskKeyboard = {
      inline_keyboard: [
        [{ text: 'Помоги с эмоциями', callback_data: `help_emotions_${channelMessageId}` }],
        [{ text: skipButtonText, callback_data: `skip_neg_${channelMessageId}` }]
      ],
    };

    // ✅ Определяем режим: ЛС или комментарии
    const isDmMode = post?.is_dm_mode ?? false;

    // Отправляем первое задание (threadId уже определён выше для fallback логики)
    const sendOptions: any = {
      parse_mode: 'HTML',
      reply_markup: firstTaskKeyboard,
    };

    // В режиме канала используем reply_to_message_id для привязки к треду
    // В режиме ЛС - отправляем напрямую без привязки
    if (!isDmMode && threadId) {
      sendOptions.reply_to_message_id = threadId;
    }

    botLogger.debug({ isDmMode, threadId, chatId }, 'Режим отправки первого задания');

    // В режиме ЛС chatId уже правильный (это ЛС пользователя)
    // В режиме канала chatId - это группа комментариев
    const firstTaskMessage = await scenarioSendWithRetry(
      bot,
      chatId!,
      userId!,
      () => sendToUser(bot, chatId!, userId!, firstTaskFullText, sendOptions),
      'simplified_first_task'
    );

    // Обновляем состояние поста
    const { updateInteractivePostState } = await import('../../db');
    updateInteractivePostState(channelMessageId, 'waiting_negative', {
      bot_task1_message_id: firstTaskMessage.message_id,
    });

    // Устанавливаем начальный таймер напоминания о незавершенной работе (30 мин)
    // Таймер будет перезапускаться при каждом ответе пользователя
    const scheduler = (bot as any).scheduler;
    if (scheduler && post?.user_id) {
      scheduler.setIncompleteWorkReminder(post.user_id, channelMessageId);
      botLogger.info({ userId: post.user_id, channelMessageId }, '⏰ Установлен начальный таймер напоминания (30 мин)');
    }

    botLogger.info({ channelMessageId }, '✅ Первое задание упрощенного сценария отправлено');
  } catch (error) {
    botLogger.error({ error: (error as Error).message }, 'Ошибка обработки выбора упрощенного сценария');
  }
}