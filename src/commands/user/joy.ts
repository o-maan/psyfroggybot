import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';
import { botLogger } from '../../logger';

/**
 * Регистрация команды /joy - список "Мои источники радости и энергии"
 */
export function registerJoyCommand(bot: Telegraf, scheduler: Scheduler) {
  bot.command('joy', async ctx => {
    const chatId = ctx.chat.id;
    const userId = ctx.from?.id;

    if (!userId) {
      await ctx.reply('❌ Ошибка: не удалось определить пользователя');
      return;
    }

    // Игнорируем служебные сообщения от Telegram (userId 777000)
    if (userId === 777000) {
      botLogger.debug(
        { chatId, userId },
        '⏭️ Пропускаем команду /joy от служебного аккаунта Telegram'
      );
      return;
    }

    try {
      botLogger.info(
        { chatId, userId },
        'Получена команда /joy'
      );

      await ctx.reply('🤩 Готовлю твой список источников радости...');

      // Вызываем метод планировщика для отправки поста со списком радости
      await scheduler.sendJoyPost(userId);

      botLogger.info({ chatId, userId }, '✅ Команда /joy выполнена');
    } catch (error) {
      const err = error as Error;
      botLogger.error(
        {
          error: err.message,
          stack: err.stack,
          chatId,
          userId,
        },
        'Ошибка при выполнении команды /joy'
      );
      await ctx.reply(`❌ Ошибка: ${err.message}`);
    }
  });
}
