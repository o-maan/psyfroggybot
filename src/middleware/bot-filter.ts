import { Telegraf } from 'telegraf';
import { Scheduler } from '../scheduler';
import { botLogger } from '../logger';

// Middleware для разделения тестового и основного бота
export function registerBotFilterMiddleware(bot: Telegraf, scheduler: Scheduler) {
  bot.use(async (ctx, next) => {
    // Пропускаем проверку для обновлений без chat (например, inline_query)
    if (!ctx.chat) {
      return next();
    }

    const chatId = ctx.chat.id;
    const TEST_CHANNEL_ID = -1002846400650;
    const TEST_CHAT_ID = -1002798126153;
    const isTestChannel = chatId === TEST_CHANNEL_ID || chatId === TEST_CHAT_ID;

    // Для команд в личных сообщениях разрешаем обоим ботам
    if (ctx.chat.type === 'private') {
      return next();
    }

    if (scheduler.isTestBot() && !isTestChannel) {
      // Тестовый бот работает только в тестовых каналах (кроме личных сообщений)
      botLogger.debug(
        { chatId, isTestBot: true, chatType: ctx.chat.type },
        'Тестовый бот игнорирует обновление не из тестового канала'
      );
      return;
    }

    if (!scheduler.isTestBot() && isTestChannel) {
      // Основной бот не работает в тестовых каналах
      botLogger.debug(
        { chatId, isTestBot: false, chatType: ctx.chat.type },
        'Основной бот игнорирует обновление из тестового канала'
      );
      return;
    }

    return next();
  });
}