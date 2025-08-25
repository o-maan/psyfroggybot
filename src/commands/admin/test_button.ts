import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';

// Команда для проверки кнопок
export function registerTestButtonCommand(bot: Telegraf, scheduler: Scheduler) {
  bot.command('test_button', async ctx => {
    try {
      const keyboard = {
        inline_keyboard: [[{ text: '✅ Тестовая кнопка', callback_data: 'test_button_click' }]],
      };

      await ctx.reply('🧪 Тест кнопки:', {
        reply_markup: keyboard,
      });
    } catch (error) {
      await ctx.reply(`❌ Ошибка: ${(error as Error).message}`);
    }
  });

  // Обработчик тестовой кнопки
  bot.action('test_button_click', async ctx => {
    await ctx.answerCbQuery('✅ Кнопка работает!');
    await ctx.reply('🎉 Callback получен и обработан!');
  });
}