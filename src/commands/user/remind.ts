import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';

// Обработка команды /remind
export function registerRemindCommand(bot: Telegraf, scheduler: Scheduler) {
  bot.command('remind', async ctx => {
    const chatId = ctx.chat.id;
    const sentTime = new Date().toISOString();
    scheduler.setReminder(chatId, sentTime);
  });
}