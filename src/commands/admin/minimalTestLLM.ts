import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';
import { minimalTestLLM } from '../../llm';

// Команда для минимального теста LLM
export function registerMinimalTestLLMCommand(bot: Telegraf, scheduler: Scheduler) {
  bot.command('minimalTestLLM', async ctx => {
    await ctx.reply('Выполняю минимальный тест LLM...');
    const result = await minimalTestLLM();
    if (result) {
      await ctx.reply('Ответ LLM:\n' + result);
    } else {
      await ctx.reply('Ошибка при выполнении минимального запроса к LLM.');
    }
  });
}