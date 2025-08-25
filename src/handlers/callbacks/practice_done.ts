import type { BotContext } from '../../types';

// Старый обработчик для обратной совместимости
export async function handlePracticeDone(ctx: BotContext) {
  await ctx.answerCbQuery('Эта кнопка устарела. Используйте новый пост.');
}