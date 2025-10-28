import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';
import { botLogger } from '../../logger';

// Обработка команды /fro
export function registerFroCommand(bot: Telegraf, scheduler: Scheduler) {
  bot.command('fro', async ctx => {
    const chatId = ctx.chat.id;
    const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

    try {
      // Отладочная информация
      botLogger.info(
        {
          chatId,
          adminChatId,
          isTestBot: scheduler.isTestBot(),
          channelId: scheduler.CHANNEL_ID,
          targetUserId: scheduler.getTargetUserId(),
        },
        'Получена команда /fro'
      );

      // Сначала отвечаем пользователю
      botLogger.info('📤 Отправляем первый ответ пользователю...');
      await ctx.reply('🐸 Отправляю сообщение...');
      botLogger.info('✅ Первый ответ отправлен');

      // Используем интерактивный метод с флагом ручной команды
      // (логика выбора текста: ЧТ/СБ = LLM, остальные = список)
      botLogger.info('🚀 Запускаем sendInteractiveDailyMessage...');
      await scheduler.sendInteractiveDailyMessage(chatId, true);
      botLogger.info('✅ sendInteractiveDailyMessage завершен');

      // Для тестового бота - отправляем уведомление о том, что проверка будет запущена
      if (scheduler.isTestBot()) {
        botLogger.info('📤 Отправляем уведомление о тестовом режиме...');
        await ctx.reply('🤖 Тестовый режим: проверка ответов запланирована через заданное время');
        botLogger.info('✅ Уведомление о тестовом режиме отправлено');
      }

      botLogger.info('🎉 Команда /fro полностью выполнена');
    } catch (error) {
      const err = error as Error;
      botLogger.error(
        {
          error: err.message,
          stack: err.stack,
          chatId,
          isTestBot: scheduler.isTestBot(),
        },
        'Ошибка при выполнении команды /fro'
      );
      await ctx.reply(`❌ Ошибка: ${err.message}`);
    }
  });
}