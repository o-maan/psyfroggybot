import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';
import { logger, botLogger } from '../../logger';

// Команда для тестирования автоматической отправки
export function registerTestScheduleCommand(bot: Telegraf, scheduler: Scheduler) {
  bot.command('test_schedule', async ctx => {
    const chatId = ctx.chat.id;
    const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

    // Проверяем, что команду выполняет админ
    if (chatId !== adminChatId) {
      await ctx.reply('❌ Эта команда доступна только администратору');
      return;
    }

    // Создаем тестовый cron job на следующую минуту
    const now = new Date();
    const nextMinute = (now.getMinutes() + 1) % 60;
    const nextHour = nextMinute === 0 ? now.getHours() + 1 : now.getHours();
    const cronExpression = `${nextMinute} ${nextHour} * * *`;

    await ctx.reply(
      `🧪 <b>ТЕСТ ПЛАНИРОВЩИКА</b>\n\n` +
        `⏱️ Cron выражение: <code>${cronExpression}</code>\n` +
        `🕐 Запуск в: <code>${String(nextHour).padStart(2, '0')}:${String(nextMinute).padStart(2, '0')}</code>\n` +
        `🌍 Часовой пояс: <code>Europe/Moscow</code>\n\n` +
        `⏳ Ожидайте тестовое сообщение...`,
      { parse_mode: 'HTML' }
    );

    const testJob = require('node-cron').schedule(
      cronExpression,
      async () => {
        try {
          logger.info('Запуск тестового cron job');

          // FIRE-AND-FORGET: запускаем БЕЗ await чтобы не блокировать cron job на 10-66 секунд!
          scheduler.sendInteractiveDailyMessage(chatId, true, true).catch(error => {
            botLogger.error(
              { error: (error as Error).message, stack: (error as Error).stack, chatId },
              '❌ Ошибка в sendInteractiveDailyMessage (fire-and-forget)'
            );
          });

          await ctx.reply('✅ 🧪 Тестовое сообщение запущено в фоне (генерация продолжается асинхронно)');
          testJob.stop();
          testJob.destroy();
        } catch (e) {
          const error = e as Error;
          botLogger.error({ error: error.message, stack: error.stack }, 'Ошибка тестового cron job');
          await ctx.reply(`❌ Ошибка при отправке тестового сообщения:\n<code>${error}</code>`, { parse_mode: 'HTML' });
          testJob.stop();
          testJob.destroy();
        }
      },
      {
        scheduled: true,
        timezone: 'Europe/Moscow',
      }
    );
  });
}