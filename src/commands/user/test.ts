import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';
import { botLogger } from '../../logger';
import { sendToUser } from '../../utils/send-to-user';

// Обработка команды /test
export function registerTestCommand(bot: Telegraf, scheduler: Scheduler) {
  bot.command('test', async ctx => {
    const chatId = ctx.chat.id;
    const fromId = ctx.from?.id;
    botLogger.info({ userId: fromId || 0, chatId }, `📱 Команда /test от пользователя ${fromId}`);

    // Генерируем сообщение и проверяем его длину
    const message = await scheduler.generateScheduledMessage(fromId);
    await sendToUser(
      bot,
      chatId,
      fromId,
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
      await scheduler.sendDailyMessage(fromId);
    }
  });
}