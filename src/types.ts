import type { Context } from 'telegraf';
import type { CallbackQuery } from 'telegraf/types';

export type BotContext = Context & {
  match?: RegExpMatchArray;
  callbackQuery: CallbackQuery;
};