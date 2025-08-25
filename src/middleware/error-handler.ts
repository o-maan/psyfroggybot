import { Telegraf } from 'telegraf';
import { botLogger } from '../logger';

// Обработчик ошибок
export function registerErrorHandler(bot: Telegraf) {
  bot.catch((err: any, ctx) => {
    botLogger.error(
      {
        error: err?.message || String(err),
        stack: err?.stack,
        updateType: ctx.updateType,
        chatId: ctx.chat?.id,
        userId: ctx.from?.id,
      },
      '❌ Ошибка в обработчике бота'
    );
  });
}