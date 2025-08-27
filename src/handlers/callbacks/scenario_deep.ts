import type { BotContext } from '../../types';
import { botLogger } from '../../logger';

// Обработчик кнопки "Глубокая работа"
export async function handleScenarioDeep(ctx: BotContext) {
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

    // Отправляем сообщение о том, что функционал в разработке
    await ctx.reply('🧘🏻 Глубокая работа в разработке. Скоро здесь появятся новые практики!', {
      reply_parameters: {
        message_id: messageId!,
      },
    });

  } catch (error) {
    botLogger.error({ error: (error as Error).message }, 'Ошибка обработки выбора глубокой работы');
  }
}