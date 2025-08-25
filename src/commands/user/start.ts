import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';
import { botLogger } from '../../logger';
import { addUser, updateUserName, updateUserGender } from '../../db';

// Обработка команды /start
export function registerStartCommand(bot: Telegraf, scheduler: Scheduler) {
  bot.command('start', async ctx => {
    const chatId = ctx.chat.id;
    const userId = ctx.from?.id || 0;
    const username = ctx.from?.username || '';
    botLogger.info({ userId, chatId }, `📱 Команда /start от пользователя ${userId}`);

    // Добавляем пользователя в планировщик для рассылки
    scheduler.addUser(chatId);

    // Проверяем, если это Алекс (ID: 5153477378), автоматически устанавливаем имя и пол
    if (userId === 5153477378) {
      addUser(chatId, username, 'Алекс', 'male');
      updateUserName(chatId, 'Алекс');
      updateUserGender(chatId, 'male');
      botLogger.info({ userId, name: 'Алекс', gender: 'male' }, '✅ Автоматически установлено имя и пол для Алекса');
    } else {
      addUser(chatId, username);
    }

    await ctx.reply(
      'Привет! Я бот-лягушка 🐸\n\n' +
        'Я буду отправлять сообщения в канал каждый день в 22:00.\n' +
        'Если ты не ответишь в течение 1.5 часов, я отправлю тебе напоминание в личку.\n\n' +
        'Доступные команды:\n' +
        '/fro - отправить сообщение сейчас\n' +
        '/calendar - настроить доступ к календарю\n' +
        '/setname [имя] - установить своё имя\n\n' +
        'Админские команды:\n' +
        '/status - статус планировщика\n' +
        '/users - список пользователей\n' +
        '/last_run - время последней рассылки\n' +
        '/logs - просмотр системных логов\n' +
        '/test_schedule - тест планировщика на следующую минуту\n' +
        '/test_now - немедленный тест рассылки\n' +
        '/test_reminder - тест напоминания\n' +
        '/test_reply - тест обработки сообщений\n' +
        '/chat_info - информация о чате\n' +
        '/minimalTestLLM - тест LLM подключения'
    );
  });
}