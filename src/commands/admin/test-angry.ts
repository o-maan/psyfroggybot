import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';
import { botLogger } from '../../logger';

// Команда для тестирования генерации злых постов
export function registerTestAngryCommand(bot: Telegraf, scheduler: Scheduler) {
  bot.command('test_angry', async ctx => {
    const chatId = ctx.chat.id;
    const userId = ctx.from?.id;
    const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

    // Проверяем, что команду выполняет админ
    if (userId !== adminChatId) {
      await ctx.reply('❌ Эта команда доступна только администратору');
      return;
    }

    try {
      botLogger.info({ userId }, '🧪 Запуск тестовой генерации злого поста');
      
      // Отправляем сообщение о начале теста
      await ctx.reply('🧪 Запускаю тестовую генерацию злого поста...');
      
      // Получаем ID целевого пользователя из scheduler
      const targetUserId = scheduler.getTargetUserId();
      
      // Вызываем приватный метод через обход типов
      await (scheduler as any).sendAngryPost(targetUserId);
      
      await ctx.reply('✅ Тестовый злой пост успешно отправлен в канал!');
      
      botLogger.info({ targetUserId }, '✅ Тестовый злой пост отправлен');
    } catch (error) {
      const err = error as Error;
      botLogger.error({ error: err.message, stack: err.stack }, '❌ Ошибка тестовой генерации злого поста');
      await ctx.reply(`❌ Ошибка: ${err.message}`);
    }
  });
}