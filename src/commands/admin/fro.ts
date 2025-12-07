import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';
import { botLogger } from '../../logger';
import { sendToUser } from '../../utils/send-to-user';
import { isAdmin } from '../../utils/admin-check';

// Обработка команды /fro (только для админа)
export function registerFroCommand(bot: Telegraf, scheduler: Scheduler) {
  bot.command('fro', async ctx => {
    const chatId = ctx.chat.id;
    const userId = ctx.from?.id || 0;

    try {
      // Проверка на админа
      if (!isAdmin(userId)) {
        await sendToUser(bot, chatId, userId, 'Эта команда доступна только администратору');
        return;
      }

      // Отладочная информация
      botLogger.info(
        {
          chatId,
          userId,
          isTestBot: scheduler.isTestBot(),
          channelId: scheduler.CHANNEL_ID,
          targetUserId: scheduler.getTargetUserId(),
        },
        'Получена команда /fro'
      );

      // Сначала отвечаем пользователю
      botLogger.info('📤 Отправляем первый ответ пользователю...');
      await sendToUser(bot, chatId, null, '🐸 Отправляю сообщение...');
      botLogger.info('✅ Первый ответ отправлен');

      // Используем интерактивный метод с флагом ручной команды
      // (логика выбора текста: ЧТ/СБ = LLM, остальные = список)
      // FIRE-AND-FORGET: запускаем БЕЗ await чтобы не блокировать бота на 10-66 секунд!
      botLogger.info('🚀 Запускаем sendInteractiveDailyMessage (асинхронно, без блокировки)...');
      scheduler.sendInteractiveDailyMessage(chatId, true).catch(error => {
        botLogger.error(
          { error: (error as Error).message, stack: (error as Error).stack, chatId },
          '❌ Ошибка в sendInteractiveDailyMessage (fire-and-forget)'
        );
      });
      botLogger.info('✅ sendInteractiveDailyMessage запущен в фоне, бот продолжает работать');

      // Для тестового бота - отправляем уведомление о том, что проверка будет запущена
      if (scheduler.isTestBot()) {
        botLogger.info('📤 Отправляем уведомление о тестовом режиме...');
        await sendToUser(bot, chatId, null, '🤖 Тестовый режим: проверка ответов запланирована через заданное время');
        botLogger.info('✅ Уведомление о тестовом режиме отправлено');
      }

      botLogger.info('🎉 Команда /fro выполнена (генерация продолжается в фоне)');
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
      await sendToUser(bot, chatId, null, `❌ Ошибка: ${err.message}`);
    }
  });
}
