import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';

// Временная команда для проверки текста
export function registerFly1Command(bot: Telegraf, scheduler: Scheduler) {
  bot.command('fly1', async ctx => {
    const text =
      'Кажется чатик не хочет работать - негодяй!\n\nКайфового полета :) Давай пока ты будешь лететь ты подумаешь о приятном, просто перечисляй все, что тебя радует, приносит удовольствие... можно нафантазировать)\n\nГлавное пострайся при этом почувствовать что-то хорошее ♥';

    try {
      await bot.telegram.sendMessage(scheduler.CHANNEL_ID, text);
      await ctx.reply('✅ Тестовое сообщение отправлено в канал!');
    } catch (error) {
      await ctx.reply(`❌ Ошибка отправки: ${error}`);
    }
  });
}