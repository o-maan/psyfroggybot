import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';
import { botLogger } from '../../logger';

// Команда для дебага индекса картинки
export function registerNextImageCommand(bot: Telegraf, scheduler: Scheduler) {
  bot.command('next_image', async ctx => {
    const chatId = ctx.chat.id;
    try {
      const imagePath = scheduler.getNextImage(chatId);
      await ctx.replyWithPhoto(
        { source: imagePath },
        {
          caption: `Next image for chatId=${chatId}\nПуть: ${imagePath}`,
        }
      );
    } catch (e) {
      const error = e as Error;
      botLogger.error({ error: error.message, stack: error.stack, chatId }, 'Ошибка команды next_image');
      await ctx.reply(`Ошибка при получении картинки: ${error.message}`);
    }
  });
}