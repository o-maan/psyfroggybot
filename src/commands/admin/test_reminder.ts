import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';
import { getUserByChatId } from '../../db';
import { sendToUser } from '../../utils/send-to-user';

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
      // Получаем пол пользователя для правильного окончания
      const user = getUserByChatId(chatId);
      const userName = user?.name || null;
      const userGender = user?.gender || null;

      let reminderText = '🐸 Привет';
      if (userName) {
        reminderText += `, ${userName}`;
      }
      reminderText += '! Не забудь ответить на сегодняшнее задание, если еще не ';

      // Учитываем пол пользователя
      if (userGender === 'female') {
        reminderText += 'успела';
      } else {
        // По умолчанию мужской род (если не указан или male)
        reminderText += 'успел';
      }

      await sendToUser(bot, chatId, chatId, reminderText);
      await ctx.reply('✅ Напоминание отправлено!');
    }, 10 * 1000); // 10 секунд

    // Сохраняем timeout для возможности отмены
    scheduler['reminderTimeouts'].set(chatId, timeout);
  });
}