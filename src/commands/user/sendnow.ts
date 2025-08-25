import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';

// Обработка команды /sendnow
export function registerSendnowCommand(bot: Telegraf, scheduler: Scheduler) {
  bot.command('sendnow', async ctx => {
    const chatId = ctx.chat.id;
    const targetTime = new Date();
    targetTime.setHours(15, 38, 0, 0);

    scheduler.scheduleOneTimeMessage(chatId, targetTime);
    await ctx.reply('Сообщение будет отправлено в 15:38!');
  });
}