import { Telegraf, Markup } from 'telegraf';
import { botLogger } from '../../logger';
import { sendToUser } from '../../utils/send-to-user';

/**
 * Регистрация команды /reset - сброс всех данных пользователя в ЛС с подтверждением
 */
export function registerResetCommand(bot: Telegraf) {
  bot.command('reset', async ctx => {
    const chatId = ctx.chat.id;
    const userId = ctx.from?.id || 0;
    const chatType = ctx.chat.type;

    botLogger.info({ userId, chatId, chatType }, '🔄 Команда /reset от пользователя');

    // Проверяем, что команда вызвана в ЛС (private)
    if (chatType !== 'private') {
      botLogger.warn({ userId, chatId, chatType }, '⚠️ Команда /reset вызвана не в ЛС');
      await sendToUser(
        bot,
        chatId,
        userId,
        'Эта команда работает только в личных сообщениях 💬'
      );
      return;
    }

    try {
      // Формируем текст с подтверждением
      const message = `<b>Ты точно хочешь удалить весь прогресс? 😦 Вернуть не получится!</b>
Ты можешь изменить имя, пол, таймзону и свой запрос по команде /me`;

      // Отправляем сообщение с кнопками подтверждения
      await sendToUser(
        bot,
        chatId,
        userId,
        message,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('Да, точно', 'reset_confirm_dm')],
            [Markup.button.callback('Отменить', 'reset_cancel')]
          ])
        }
      );

      botLogger.info({ userId, chatId }, '✅ Команда /reset выполнена, ожидаем подтверждение');
    } catch (error) {
      const err = error as Error;
      botLogger.error(
        {
          error: err.message,
          stack: err.stack,
          chatId,
          userId,
        },
        'Ошибка при выполнении команды /reset'
      );
      await sendToUser(bot, chatId, userId, `❌ Ошибка: ${err.message}`);
    }
  });
}
