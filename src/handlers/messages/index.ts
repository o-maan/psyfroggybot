import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';
import { registerForwardedMessageHandler } from './forwarded';
import { registerTextMessageHandler } from './text';

export function registerMessageHandlers(bot: Telegraf, scheduler: Scheduler) {
  registerForwardedMessageHandler(bot, scheduler);
  registerTextMessageHandler(bot, scheduler);
}