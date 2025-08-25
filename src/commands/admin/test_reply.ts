import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';

// Команда для теста обработки сообщений
export function registerTestReplyCommand(bot: Telegraf, scheduler: Scheduler) {
  bot.command('test_reply', async ctx => {
    const chatId = ctx.chat.id;
    const chatType = ctx.chat.type;
    const CHAT_ID = scheduler.getChatId();

    await ctx.reply(
      `🧪 <b>ТЕСТ ОБРАБОТКИ СООБЩЕНИЙ</b>\n\n` +
        `📍 Текущий чат ID: <code>${chatId}</code>\n` +
        `📝 Тип чата: <code>${chatType}</code>\n` +
        `🎯 Целевой CHAT_ID: <code>${CHAT_ID || 'НЕ УСТАНОВЛЕН'}</code>\n` +
        `✅ Бот обрабатывает сообщения: ${!CHAT_ID || chatId === CHAT_ID ? 'ДА' : 'НЕТ'}\n\n` +
        `Напишите любое сообщение для теста...`,
      { parse_mode: 'HTML' }
    );
  });
}