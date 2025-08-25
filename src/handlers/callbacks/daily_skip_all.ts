import { botLogger } from '../../logger';
import type { BotContext } from '../../types';

// Обработчик кнопки "Все ок - пропустить" (больше не используется в новой логике)
export async function handleDailySkipAll(ctx: BotContext) {
  try {
    await ctx.answerCbQuery('Эта функция больше не используется');
  } catch (error) {
    botLogger.error({ error }, 'Ошибка обработки кнопки "Все ок - пропустить"');
    await ctx.answerCbQuery('❌ Произошла ошибка');
  }
}