import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';
import { logger, botLogger } from '../../logger';

// Команда для немедленного теста рассылки
export function registerTestNowCommand(bot: Telegraf, scheduler: Scheduler) {
  bot.command('test_now', async ctx => {
    const chatId = ctx.chat.id;
    const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

    // Проверяем, что команду выполняет админ
    if (chatId !== adminChatId) {
      await ctx.reply('❌ Эта команда доступна только администратору');
      return;
    }

    await ctx.reply('🧪 <b>НЕМЕДЛЕННЫЙ ТЕСТ РАССЫЛКИ</b>\n\nЗапускаю рассылку прямо сейчас...', { parse_mode: 'HTML' });

    try {
      logger.info('Запуск немедленного теста рассылки');
      await scheduler.sendDailyMessagesToAll(adminChatId);
      await ctx.reply('✅ 🧪 Тест рассылки завершен успешно!');
    } catch (e) {
      const error = e as Error;
      botLogger.error({ error: error.message, stack: error.stack }, 'Ошибка немедленного теста рассылки');
      await ctx.reply(`❌ Ошибка при тесте рассылки:\n<code>${error}</code>`, {
        parse_mode: 'HTML',
      });
    }
  });
}