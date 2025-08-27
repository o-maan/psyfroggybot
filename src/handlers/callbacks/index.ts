import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';
import { handleCallbackQuery } from './callback_query';
import { handleDailySkipAll } from './daily_skip_all';
import { handleSkipNeg } from './skip_neg';
import { handleDailySkipNegative } from './daily_skip_negative';
import { handlePractDone } from './pract_done';
import { handlePracticeDone } from './practice_done';
import { handlePractDelay } from './pract_delay';
import { handlePracticePostpone } from './practice_postpone';
import { handleSkipSchema } from './skip_schema';
import { handleScenarioSimplified } from './scenario_simplified';
import { handleScenarioDeep } from './scenario_deep';

export function registerCallbackHandlers(bot: Telegraf, scheduler: Scheduler) {
  // Общий обработчик callback_query
  bot.on('callback_query', handleCallbackQuery);
  
  // Обработчики кнопок
  bot.action('daily_skip_all', handleDailySkipAll);
  bot.action(/skip_neg_(\d+)/, ctx => handleSkipNeg(ctx, bot));
  bot.action('daily_skip_negative', handleDailySkipNegative);
  bot.action(/pract_done_(\d+)/, ctx => handlePractDone(ctx, scheduler));
  bot.action(/practice_done_(\d+)/, handlePracticeDone);
  bot.action(/pract_delay_(\d+)/, handlePractDelay);
  bot.action(/practice_postpone_(\d+)/, ctx => handlePracticePostpone(ctx, scheduler));
  bot.action(/skip_schema_(\d+)/, ctx => handleSkipSchema(ctx, scheduler));
  
  // Обработчики выбора сценария
  bot.action(/scenario_simplified_(\d+)/, ctx => handleScenarioSimplified(ctx, bot));
  bot.action(/scenario_deep_(\d+)/, ctx => handleScenarioDeep(ctx));
}

// Export individual handlers for backwards compatibility
export {
  handleCallbackQuery,
  handleDailySkipAll,
  handleSkipNeg,
  handleDailySkipNegative,
  handlePractDone,
  handlePracticeDone,
  handlePractDelay,
  handlePracticePostpone,
  handleSkipSchema,
};