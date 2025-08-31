import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';
import { botLogger } from '../../logger';

export function registerShowLastFilterCommand(bot: Telegraf, scheduler: Scheduler) {
  bot.command('show_last_filter', async ctx => {
    const chatId = ctx.chat.id;
    const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

    // Проверяем, что команду выполняет админ
    if (chatId !== adminChatId) {
      await ctx.reply('❌ Эта команда доступна только администратору');
      return;
    }
    try {
      // ID последней картинки из массива
      const lastFilterId = 'AgACAgIAAxkBAAIF9Gi0ij7wfJoLrBApRaBXfRSeKB2DAAK-9jEbGZqoSYqi4i1O6U0lAQADAgADeQADNgQ';
      
      await ctx.replyWithPhoto(lastFilterId, {
        caption: 'Последняя картинка из массива фильтров восприятия (Туннельное видение)'
      });
      
    } catch (error) {
      botLogger.error({ error }, 'Ошибка показа последней картинки');
      await ctx.reply('Ошибка при отправке картинки');
    }
  });
}