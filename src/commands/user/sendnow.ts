import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';
import { sendToUser } from '../../utils/send-to-user';

// Обработка команды /sendnow
export function registerSendnowCommand(bot: Telegraf, scheduler: Scheduler) {
  bot.command('sendnow', async ctx => {
    const chatId = ctx.chat.id;
    const userId = ctx.from?.id;
    const targetTime = new Date();
    targetTime.setHours(15, 38, 0, 0);

    scheduler.scheduleOneTimeMessage(chatId, targetTime);
    await sendToUser(bot, chatId, userId, 'Сообщение будет отправлено в 15:38!');
  });
}