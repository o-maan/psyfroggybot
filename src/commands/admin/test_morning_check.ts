import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';

// Команда для тестирования утренней проверки
export function registerTestMorningCheckCommand(bot: Telegraf, scheduler: Scheduler) {
  bot.command('test_morning_check', async ctx => {
    const chatId = ctx.chat.id;
    const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

    // Проверяем, что команду выполняет админ
    if (chatId !== adminChatId) {
      await ctx.reply('❌ Эта команда доступна только администратору');
      return;
    }

    await ctx.reply('🌅 Запускаю тестовую утреннюю проверку...');

    try {
      // Вызываем приватный метод через any cast
      await (scheduler as any).checkUsersResponses();
      await ctx.reply('✅ Тестовая утренняя проверка выполнена успешно!');
    } catch (error) {
      await ctx.reply(`❌ Ошибка при выполнении утренней проверки:\n<code>${error}</code>`, { parse_mode: 'HTML' });
    }
  });
}