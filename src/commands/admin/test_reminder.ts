import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';

// Команда для теста напоминания
export function registerTestReminderCommand(bot: Telegraf, scheduler: Scheduler) {
  bot.command('test_reminder', async ctx => {
    const chatId = ctx.chat.id;
    const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

    // Проверяем, что команду выполняет админ
    if (chatId !== adminChatId) {
      await ctx.reply('❌ Эта команда доступна только администратору');
      return;
    }

    await ctx.reply(
      '🧪 <b>ТЕСТ НАПОМИНАНИЯ</b>\n\n' + 'Устанавливаю напоминание на 10 секунд...\n' + 'Оно придет вам в личку',
      { parse_mode: 'HTML' }
    );

    // Создаем временное напоминание через 10 секунд
    const timeout = setTimeout(async () => {
      const reminderText = '🐸 Привет! Не забудь ответить на сегодняшнее задание, если еще не успел(а)';
      await bot.telegram.sendMessage(chatId, reminderText);
      await ctx.reply('✅ Напоминание отправлено!');
    }, 10 * 1000); // 10 секунд

    // Сохраняем timeout для возможности отмены
    scheduler['reminderTimeouts'].set(chatId, timeout);
  });
}