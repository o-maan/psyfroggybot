import { Telegraf } from 'telegraf';
import { botLogger } from '../logger';

// Отладка всех обновлений
export function registerDebugMiddleware(bot: Telegraf) {
  bot.use(async (ctx, next) => {
    const logData: any = {
      updateType: ctx.updateType,
      chatId: ctx.chat?.id,
      from: ctx.from?.id,
      callbackQuery: ctx.callbackQuery ? true : false,
      message: ctx.message ? true : false,
    };

    // Добавляем детали для callback_query
    if (ctx.callbackQuery) {
      logData.callbackData = 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
      logData.callbackFrom = ctx.callbackQuery.from?.id;
      logData.callbackChatId = ctx.callbackQuery.message?.chat?.id;
    }

    botLogger.info(logData, '📥 Получено обновление от Telegram');
    return next();
  });
}