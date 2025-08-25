import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';
import { botLogger } from '../../logger';

// Команда для ручной проверки незавершенных заданий
export function registerAnsCommand(bot: Telegraf, scheduler: Scheduler) {
  bot.command('ans', async ctx => {
    const chatId = ctx.chat.id;
    const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

    // Проверяем, что команду выполняет админ
    if (chatId !== adminChatId) {
      await ctx.reply('❌ Эта команда доступна только администратору');
      return;
    }

    await ctx.reply('🔍 Запускаю проверку незавершенных заданий...');

    try {
      await scheduler.checkUncompletedTasks();
      await ctx.reply('✅ Проверка завершена! Посмотрите логи для деталей.');
    } catch (error) {
      botLogger.error({ error }, 'Ошибка при выполнении команды /ans');
      await ctx.reply(`❌ Ошибка при проверке: ${error}`);
    }
  });
}