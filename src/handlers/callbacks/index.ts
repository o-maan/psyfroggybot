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
import { handleConfirmNegative } from './confirm_negative';
import { handleSkipEmotionsClarification } from './skip_emotions_clarification';
import { handleContinueToPlushki } from './continue_to_plushki';
import { handleEmotionsAdditionDone } from './emotions_addition_done';
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
import {
  handleJoyAdd,
  handleJoyAddMore,
  handleJoyView,
  handleJoySundayHint,
  handleJoySundaySkip,
  handleJoyContinue,
  handleJoyRemove,
  handleJoyRemoveItem,
  handleJoyRemoveConfirm,
  handleJoyBackToList,
  handleJoyClearAll,
  handleJoyClearConfirm,
  handleJoyClearCancel,
  handleJoyLater
} from './joy_buttons';
import {
  handleShortJoyFinish,
  handleShortJoyHint,
  handleShortJoyAdd,
  handleShortJoyAddMore,
  handleShortJoyView
} from './short_joy_buttons';

import {
  handleShortJoyRemove,
  handleShortJoyRemoveItem,
  handleShortJoyRemoveConfirm,
  handleShortJoyBackToList,
  handleShortJoyClearAll,
  handleShortJoyClearConfirm
} from './short_joy_remove_buttons';

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

  // Обработчик подтверждения выгрузки негативных переживаний
  bot.action(/confirm_negative_(\d+)/, ctx => handleConfirmNegative(ctx, bot, scheduler));

  // Обработчик пропуска уточнения эмоций
  bot.action(/skip_emotions_clarification_(\d+)/, ctx => handleSkipEmotionsClarification(ctx, bot));

  // Обработчик кнопки "Идем дальше 🚀"
  bot.action(/continue_to_plushki_(\d+)/, ctx => handleContinueToPlushki(ctx, bot));

  // Обработчик кнопки "Описал ☑️" (после добавления эмоций B1/B4)
  bot.action(/emotions_addition_done_(\d+)/, ctx => handleEmotionsAdditionDone(ctx, bot));

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

  // ВАЖНО: SHORT JOY обработчики ДОЛЖНЫ быть ДО обычных Joy,
  // чтобы паттерн /joy_add/ не перехватывал short_joy_add!
  bot.action(/short_joy_finish_(\d+)/, ctx => handleShortJoyFinish(ctx, bot, scheduler));
  bot.action(/short_joy_hint_(\d+)/, ctx => handleShortJoyHint(ctx, bot, scheduler));
  bot.action(/short_joy_add_(\d+)/, ctx => handleShortJoyAdd(ctx, bot, scheduler));
  bot.action(/short_joy_add_more_(\d+)/, ctx => handleShortJoyAddMore(ctx, bot, scheduler));
  bot.action(/short_joy_view_(\d+)/, ctx => handleShortJoyView(ctx, bot, scheduler));
  bot.action(/short_joy_remove_(\d+)/, ctx => handleShortJoyRemove(ctx, bot, scheduler));
  bot.action(/short_joy_remove_item_(\d+)/, ctx => handleShortJoyRemoveItem(ctx, bot, scheduler));
  bot.action(/short_joy_remove_confirm_(\d+)/, ctx => handleShortJoyRemoveConfirm(ctx, bot, scheduler));
  bot.action(/short_joy_back_to_list_(\d+)/, ctx => handleShortJoyBackToList(ctx, bot, scheduler));
  bot.action(/short_joy_clear_all_(\d+)/, ctx => handleShortJoyClearAll(ctx, bot, scheduler));
  bot.action(/short_joy_clear_confirm_(\d+)/, ctx => handleShortJoyClearConfirm(ctx, bot, scheduler));

  // Обработчики кнопок списка радости
  bot.action(/joy_add_(\d+)/, ctx => handleJoyAdd(ctx, bot, scheduler));
  bot.action(/joy_add_more_(\d+)/, ctx => handleJoyAddMore(ctx, bot, scheduler));
  bot.action(/joy_view_(\d+)/, ctx => handleJoyView(ctx, bot, scheduler));

  // Обработчики кнопок воскресного вводного Joy
  bot.action(/joy_sunday_hint_(\d+)/, ctx => handleJoySundayHint(ctx, bot, scheduler));
  bot.action(/joy_sunday_skip_(\d+)/, ctx => handleJoySundaySkip(ctx, bot, scheduler));
  bot.action(/joy_continue_(\d+)/, ctx => handleJoyContinue(ctx, bot, scheduler));

  // Обработчики удаления источников радости
  bot.action(/joy_remove_(\d+)/, ctx => handleJoyRemove(ctx, bot, scheduler));
  bot.action(/joy_remove_item_(\d+)/, ctx => handleJoyRemoveItem(ctx, bot, scheduler));
  bot.action(/joy_remove_confirm_(\d+)/, ctx => handleJoyRemoveConfirm(ctx, bot, scheduler));
  bot.action(/joy_back_to_list_(\d+)/, ctx => handleJoyBackToList(ctx, bot, scheduler));
  bot.action(/joy_clear_all_(\d+)/, ctx => handleJoyClearAll(ctx, bot, scheduler));
  bot.action(/joy_clear_confirm_(\d+)/, ctx => handleJoyClearConfirm(ctx, bot, scheduler));
  bot.action(/joy_clear_cancel_(\d+)/, ctx => handleJoyClearCancel(ctx, bot, scheduler));
  bot.action(/joy_later_(\d+)/, ctx => handleJoyLater(ctx, bot, scheduler));
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