import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';
import { sendToUser } from '../../utils/send-to-user';
import { isAdmin } from '../../utils/admin-check';

// Обработка команды /sendnow (только для админа)
export function registerSendnowCommand(bot: Telegraf, scheduler: Scheduler) {
  bot.command('sendnow', async ctx => {
    const chatId = ctx.chat.id;
    const userId = ctx.from?.id || 0;

    // Проверка на админа
    if (!isAdmin(userId)) {
      await sendToUser(bot, chatId, userId, 'Эта команда доступна только администратору');
      return;
    }

    const targetTime = new Date();
    targetTime.setHours(15, 38, 0, 0);

    scheduler.scheduleOneTimeMessage(chatId, targetTime);
    await sendToUser(bot, chatId, null, 'Сообщение будет отправлено в 15:38!');
  });
}
