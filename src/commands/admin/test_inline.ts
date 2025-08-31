import { Telegraf } from 'telegraf';
import { logger } from '../../logger';

export function registerTestInlineCommand(bot: Telegraf): void {
  bot.command('test_inline', async (ctx) => {
    const chatId = ctx.chat.id;
    const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

    // Проверяем, что команду выполняет админ
    if (chatId !== adminChatId) {
      await ctx.reply('❌ Эта команда доступна только администратору');
      return;
    }

    try {
      const botUsername = ctx.botInfo?.username || 'bot';
      
      await ctx.reply(
        `🔍 Для тестирования inline query:\n\n` +
        `1. В любом чате начните набирать: @${botUsername}\n` +
        `2. Появится сетка 3x5 с фильтрами восприятия\n` +
        `3. Можете добавить поисковый запрос после @${botUsername} для фильтрации\n\n` +
        `Например:\n` +
        `• @${botUsername} - покажет все фильтры\n` +
        `• @${botUsername} катастроф - найдёт "Катастрофизация"\n` +
        `• @${botUsername} мышление - найдёт связанные фильтры\n\n` +
        `💡 Совет: Inline запросы работают в любом чате!`,
        {
          reply_markup: {
            inline_keyboard: [[
              { 
                text: '🚀 Попробовать сейчас', 
                switch_inline_query: '' 
              }
            ]]
          }
        }
      );

      logger.info({ 
        adminId: ctx.from.id,
        botUsername 
      }, 'Команда test_inline выполнена');
      
    } catch (error) {
      logger.error({ error }, 'Ошибка при выполнении команды test_inline');
      await ctx.reply('❌ Произошла ошибка при выполнении команды');
    }
  });
}