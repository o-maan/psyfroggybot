import type { BotContext } from '../../types';
import { Telegraf } from 'telegraf';
import { botLogger } from '../../logger';

// Функция экранирования для HTML (Telegram) 
function escapeHTML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Обработчик кнопки "Глубокая работа"
export async function handleScenarioDeep(ctx: BotContext, bot: Telegraf) {
  try {
    const channelMessageId = parseInt(ctx.match![1]);
    const messageId = ctx.callbackQuery.message?.message_id;
    const chatId = ctx.callbackQuery.message?.chat?.id;
    const userId = ctx.from?.id;

    await ctx.answerCbQuery('🧘🏻 Отлично! Начинаем глубокую работу');

    botLogger.info(
      {
        action: 'scenario_deep',
        channelMessageId,
        messageId,
        chatId,
        userId,
      },
      '🔘 Выбрана глубокая работа'
    );

    // Получаем данные поста из БД
    const { getInteractivePost, saveInteractivePost } = await import('../../db');
    let post = getInteractivePost(channelMessageId);
    
    if (!post) {
      botLogger.warn({ channelMessageId, userId }, 'Пост не найден в БД, создаем fallback запись');
      
      // Fallback: создаем минимальную запись в БД
      try {
        // Используем дефолтные данные для глубокого сценария
        const defaultMessageData = {
          encouragement: { text: 'Привет! 🌱 Давай поработаем с нашими переживаниями' },
          negative_part: { additional_text: null },
          positive_part: { additional_text: null },
          feels_and_emotions: { additional_text: null }
        };
        
        saveInteractivePost(channelMessageId, userId!, defaultMessageData, 'breathing');
        botLogger.info({ channelMessageId }, '💾 Fallback запись создана');
        
        // Получаем созданную запись
        post = getInteractivePost(channelMessageId);
      } catch (fallbackError) {
        botLogger.error({ error: fallbackError }, 'Ошибка создания fallback записи');
        await ctx.answerCbQuery('❌ Произошла ошибка. Попробуйте позже.');
        return;
      }
    }

    // Первый этап - отправляем текст без кнопок
    const firstTaskText = 'Вот это настрой! 🔥\n\n1. <b>Что тебя волнует?</b>\nПеречисли неприятные ситуации и события, которые тебя беспокоят';

    // Отправляем первое сообщение БЕЗ кнопок
    const firstTaskMessage = await bot.telegram.sendMessage(chatId!, firstTaskText, {
      parse_mode: 'HTML',
      reply_parameters: {
        message_id: messageId!,
      },
    });

    // Обновляем состояние поста для глубокой работы - ждем перечисления ситуаций
    const { updateInteractivePostState } = await import('../../db');
    updateInteractivePostState(channelMessageId, 'deep_waiting_situations_list', {
      bot_task1_message_id: firstTaskMessage.message_id,
    });

    botLogger.info({ channelMessageId }, '✅ Первое задание глубокой работы отправлено');
  } catch (error) {
    botLogger.error({ error: (error as Error).message }, 'Ошибка обработки выбора глубокой работы');
  }
}