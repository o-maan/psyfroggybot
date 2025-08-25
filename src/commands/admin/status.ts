import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';

// Команда для проверки статуса планировщика
export function registerStatusCommand(bot: Telegraf, scheduler: Scheduler) {
  bot.command('status', async ctx => {
    const chatId = ctx.chat.id;
    const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

    // Проверяем, что команду выполняет админ
    if (chatId !== adminChatId) {
      await ctx.reply('❌ Эта команда доступна только администратору');
      return;
    }

    const status = scheduler.getSchedulerStatus();

    await ctx.reply(
      `📊 <b>СТАТУС ПЛАНИРОВЩИКА</b>\n\n` +
        `⚙️ Общий статус: ${status.isRunning ? '🟢 <b>Активен</b>' : '🔴 <b>Остановлен</b>'}\n` +
        `🌙 Вечерняя рассылка: ${status.isDailyRunning ? '🟢 Активна' : '🔴 Остановлена'}\n` +
        `☀️ Утренняя проверка: ${status.isMorningRunning ? '🟢 Активна' : '🔴 Остановлена'}\n\n` +
        `📅 Расписание: <code>${status.description}</code>\n` +
        `🕐 Выражения: <code>${status.cronExpression}</code>\n` +
        `🌍 Часовой пояс: <code>${status.timezone}</code>\n\n` +
        `🕐 <b>Текущее время (МСК):</b> <code>${status.currentTime}</code>\n` +
        `⏰ <b>Следующие запуски:</b>\n<code>${status.nextRunTime}</code>\n\n` +
        `👥 <b>Пользователей:</b> ${status.usersCount}\n` +
        `🔑 <b>Admin ID:</b> <code>${status.adminChatId}</code>\n` +
        `📋 <b>Список пользователей:</b>\n<code>${
          status.usersList.length > 0 ? status.usersList.join(', ') : 'Нет пользователей'
        }</code>`,
      { parse_mode: 'HTML' }
    );
  });
}