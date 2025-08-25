import type { BotContext } from '../../types';

// Старый обработчик для обратной совместимости
export async function handleDailySkipNegative(ctx: BotContext) {
  await ctx.answerCbQuery('Эта кнопка устарела. Используйте новый пост.');
}