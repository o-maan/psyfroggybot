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
import { handleEmotionsTable } from './emotions_table';
import { handleSkipEmotions } from './skip_emotions';
import { handleHelpEmotions } from './help_emotions';
import { handleSkipPositiveEmotions } from './skip_positive_emotions';
import { handleMorningRespond } from './morning_respond';
import { handleMorningCantRemember } from './morning_cant_remember';
import {
  handleDeepSituationChoice,
  handleDeepFiltersStart,
  handleDeepFiltersExample,
  handleDeepFiltersExampleThoughts,
  handleDeepFiltersExampleDistortions,
  handleDeepFiltersExampleRational,
  handleDeepContinueToTreats,
  handleShowFilters,
  handleSchemaStart,
  handleSchemaExample,
  handleSchemaContinue,
  handleSkipNegSchema
} from './deep_work_buttons';

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
  bot.action(/skip_emotions_(\d+)/, ctx => handleSkipEmotions(ctx, scheduler));
  bot.action(/help_emotions_(\d+)/, handleHelpEmotions);
  bot.action(/skip_positive_emotions_(\d+)/, ctx => handleSkipPositiveEmotions(ctx, bot));

  // Обработчики кнопок утреннего поста
  bot.action(/morning_respond_(\d+)/, handleMorningRespond);
  bot.action(/cant_remember_emotions_(\d+)/, handleMorningCantRemember);

  // Обработчик для неактивной кнопки
  bot.action('disabled', async (ctx) => {
    await ctx.answerCbQuery();
  });
  
  // Обработчики выбора сценария
  bot.action(/scenario_simplified_(\d+)/, ctx => handleScenarioSimplified(ctx, bot));
  bot.action(/scenario_deep_(\d+)/, ctx => handleScenarioDeep(ctx, bot));
  bot.action(/emotions_table_(\d+)/, handleEmotionsTable);
  
  // Обработчики глубокой работы
  bot.action(/deep_situation_(\d+)_(\d+)/, ctx => handleDeepSituationChoice(ctx, bot));
  bot.action(/deep_filters_start_(\d+)/, ctx => handleDeepFiltersStart(ctx, bot));
  bot.action(/deep_filters_example_(\d+)/, ctx => handleDeepFiltersExample(ctx, bot));
  bot.action(/deep_filters_example_thoughts_(\d+)/, ctx => handleDeepFiltersExampleThoughts(ctx, bot));
  bot.action(/deep_filters_example_distortions_(\d+)/, ctx => handleDeepFiltersExampleDistortions(ctx, bot));
  bot.action(/deep_filters_example_rational_(\d+)/, ctx => handleDeepFiltersExampleRational(ctx, bot));
  bot.action(/deep_continue_to_treats_(\d+)/, ctx => handleDeepContinueToTreats(ctx, bot));
  bot.action(/show_filters_(\d+)/, ctx => handleShowFilters(ctx, bot));
  
  // Обработчики разбора по схеме
  bot.action(/schema_start_(\d+)/, ctx => handleSchemaStart(ctx, bot));
  bot.action(/schema_example_(\d+)/, ctx => handleSchemaExample(ctx, bot));
  bot.action(/schema_continue_(\d+)/, ctx => handleSchemaContinue(ctx, bot));
  bot.action(/skip_neg_schema_(\d+)/, ctx => handleSkipNegSchema(ctx, bot));
  
  // Обработчик оценки дня
  bot.action(/day_rating_(\d+)_(\d+)/, async ctx => {
    const { handleDayRating } = await import('./day_rating');
    await handleDayRating(ctx);
  });
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