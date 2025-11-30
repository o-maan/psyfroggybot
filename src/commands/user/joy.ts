import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';
import { botLogger } from '../../logger';
import { sendToUser } from '../../utils/send-to-user';

/**
 * Регистрация команды /joy - Short Joy логика (пользовательская)
 * Показывает список радости ТАМ ГДЕ ВЫЗВАНА (личка/канал/комментарии)
 * БЕЗ проверок на 2 дня, в любое время
 */
export function registerJoyCommand(bot: Telegraf, scheduler: Scheduler) {
  // Общий обработчик для /joy и /joy@Psy_Froggy_bot
  const joyHandler = async (ctx: any) => {
    let chatId = ctx.chat.id;
    const messageThreadId = (ctx.message as any).message_thread_id;

    // Для каналов from может быть undefined или 777000
    // Используем ID из настроек бота
    let userId = ctx.from?.id;

    // Если команда вызвана в канале (from отсутствует или служебный аккаунт)
    if (!userId || userId === 777000) {
      // Проверяем, это комментарии к посту или сам канал
      if (messageThreadId) {
        // ЭТО КОММЕНТАРИИ К ПОСТУ - разрешаем работу (но не афишируем)
        const targetUserId = scheduler.getTargetUserId();
        if (!targetUserId) {
          botLogger.error({ chatId }, '❌ Не удалось определить userId для команды /joy в комментариях');
          return;
        }
        userId = targetUserId;
        chatId = scheduler.getChatId()!; // ID группы обсуждений

        botLogger.info(
          { chatId, userId, messageThreadId },
          '💬 Команда /joy вызвана в комментариях к посту'
        );
      } else {
        // ЭТО КАНАЛ - блокируем
        botLogger.info({ chatId }, '🚫 Команда /joy вызвана в канале - отправляем сообщение об ошибке');

        try {
          // В канале не передаем userId для системного сообщения
          await sendToUser(bot, chatId, null, 'Эта команда активна в личных сообщениях с Psy Froggy');
        } catch (error) {
          botLogger.error({ error }, 'Не удалось отправить сообщение об ошибке в канал');
        }
        return;
      }
    }

    try {
      botLogger.info(
        { chatId, userId, messageThreadId, chatType: ctx.chat.type },
        '🤩 Получена команда /joy (short joy)'
      );

      // Вызываем SHORT JOY логику в планировщике
      await scheduler.sendShortJoy(userId, chatId, messageThreadId);

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
      await sendToUser(bot, chatId, userId, `❌ Ошибка: ${err.message}`);
    }
  };

  // Регистрируем команду /joy
  bot.command('joy', joyHandler);

  // ВАЖНО: Также регистрируем через hears для поддержки /joy@Psy_Froggy_bot
  bot.hears(/^\/joy(?:@\w+)?$/, joyHandler);
}
