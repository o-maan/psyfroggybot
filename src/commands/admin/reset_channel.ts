import { Telegraf, Markup } from 'telegraf';
import { botLogger } from '../../logger';
import { sendToUser } from '../../utils/send-to-user';
import { isAdmin } from '../../utils/admin-check';

/**
 * Регистрация команды /reset_channel - сброс всех данных пользователя в канале с подтверждением
 * Доступна только для админов (Алекс и Ольга)
 */
export function registerResetChannelCommand(bot: Telegraf) {
  bot.command('reset_channel', async ctx => {
    const chatId = ctx.chat.id;
    const userId = ctx.from?.id || 0;

    botLogger.info({ userId, chatId }, '🔄 Команда /reset_channel от пользователя');

    // Проверяем, что пользователь является админом
    if (!isAdmin(userId)) {
      botLogger.warn({ userId, chatId }, '⚠️ Команда /reset_channel вызвана не админом');
      await sendToUser(
        bot,
        chatId,
        userId,
        'У тебя нет прав для выполнения этой команды 🚫'
      );
      return;
    }

    try {
      // Формируем текст с подтверждением
      const message = `<b>Ты точно хочешь удалить весь прогресс в своем канале? 😦 Вернуть не получится!</b>
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
            [Markup.button.callback('Да, точно', 'reset_confirm_channel')],
            [Markup.button.callback('Отменить', 'reset_cancel')]
          ])
        }
      );

      botLogger.info({ userId, chatId }, '✅ Команда /reset_channel выполнена, ожидаем подтверждение');
    } catch (error) {
      const err = error as Error;
      botLogger.error(
        {
          error: err.message,
          stack: err.stack,
          chatId,
          userId,
        },
        'Ошибка при выполнении команды /reset_channel'
      );
      await sendToUser(bot, chatId, userId, `❌ Ошибка: ${err.message}`);
    }
  });
}
