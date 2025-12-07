import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';
import { botLogger } from '../../logger';
import { sendToUser } from '../../utils/send-to-user';
import { isAdmin } from '../../utils/admin-check';

// Обработка команды /test (только для админа)
export function registerTestCommand(bot: Telegraf, scheduler: Scheduler) {
  bot.command('test', async ctx => {
    const chatId = ctx.chat.id;
    const userId = ctx.from?.id || 0;
    botLogger.info({ userId, chatId }, `📱 Команда /test от пользователя ${userId}`);

    // Проверка на админа
    if (!isAdmin(userId)) {
      await sendToUser(bot, chatId, userId, 'Эта команда доступна только администратору');
      return;
    }

    // Генерируем сообщение и проверяем его длину
    const message = await scheduler.generateScheduledMessage(userId);
    await sendToUser(
      bot,
      chatId,
      null,
      `📊 <b>ТЕСТ ГЕНЕРАЦИИ СООБЩЕНИЯ</b>\n\n` +
        `📏 Длина: ${message.length} символов\n` +
        `${
          message.length > 1024 ? `❌ ПРЕВЫШЕН ЛИМИТ на ${message.length - 1024} символов!` : '✅ В пределах лимита'
        }\n\n` +
        `<b>Сообщение:</b>\n${message}`,
      { parse_mode: 'HTML' }
    );

    // Отправляем в канал только если не превышен лимит
    if (message.length <= 1024) {
      await scheduler.sendDailyMessage(userId);
    }
  });
}
