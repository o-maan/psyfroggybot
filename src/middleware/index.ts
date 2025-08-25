import { Telegraf } from 'telegraf';
import { Scheduler } from '../scheduler';
import { trackIncomingMessage } from '../message-handler';
import { registerDebugMiddleware } from './debug';
import { registerErrorHandler } from './error-handler';
import { registerBotFilterMiddleware } from './bot-filter';

export function registerMiddleware(bot: Telegraf, scheduler: Scheduler) {
  // Добавляем middleware для отслеживания входящих сообщений
  bot.use(trackIncomingMessage);
  
  // Отладка всех обновлений
  registerDebugMiddleware(bot);
  
  // Обработчик ошибок
  registerErrorHandler(bot);
  
  // Middleware для разделения тестового и основного бота
  registerBotFilterMiddleware(bot, scheduler);
}