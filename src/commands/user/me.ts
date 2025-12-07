import { Telegraf, Markup } from 'telegraf';
import { botLogger } from '../../logger';
import { getUserByChatId } from '../../db';
import { sendToUser } from '../../utils/send-to-user';

/**
 * Обработка команды /me - просмотр и редактирование данных пользователя
 */
export function registerMeCommand(bot: Telegraf) {
  bot.command('me', async ctx => {
    const chatId = ctx.chat.id;
    const userId = ctx.from?.id || 0;

    botLogger.info({ userId, chatId }, '📋 Команда /me от пользователя');

    try {
      // Получаем данные пользователя из БД
      const user = getUserByChatId(chatId);

      if (!user) {
        botLogger.warn({ chatId, userId }, '⚠️ Пользователь не найден в БД');
        await sendToUser(
          bot,
          chatId,
          userId,
          'Похоже, ты еще не зарегистрирован. Используй команду /start для начала работы! 🐸'
        );
        return;
      }

      // Формируем текст с данными пользователя
      const name = user.name || 'Не указано';
      const gender = user.gender === 'male' ? 'Мужской' : user.gender === 'female' ? 'Женский' : 'Не указан';

      // Формируем timezone строку
      let timezoneText = 'Не указана';
      if (user.timezone) {
        const offset = user.timezone_offset || 0;
        const offsetHours = offset / 60;
        const offsetSign = offsetHours >= 0 ? '+' : '';
        const city = user.city || user.timezone;
        timezoneText = `${city} (UTC${offsetSign}${offsetHours})`;
      }

      const request = user.user_request || 'Не указан';

      const messageText = `Твои данные 📋\n\nИмя: ${name}\nПол: ${gender}\nТайм зона: ${timezoneText}\nЗапрос: ${request}\n\n<b>Что хочешь изменить?</b>`;

      // Отправляем сообщение с кнопками
      await sendToUser(
        bot,
        chatId,
        userId,
        messageText,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('Изменить имя ✏️', 'me_edit_name')],
            [Markup.button.callback('Изменить пол 👤', 'me_edit_gender')],
            [Markup.button.callback('Изменить тайм зону 🌍', 'me_edit_timezone')],
            [Markup.button.callback('Изменить запрос 📝', 'me_edit_request')],
            [Markup.button.callback('Все верно ☑️', 'me_confirm')]
          ])
        }
      );

      botLogger.info({ userId, chatId }, '✅ Данные пользователя отправлены');
    } catch (error) {
      botLogger.error({ error, userId, chatId }, '❌ Ошибка при обработке команды /me');
      await sendToUser(bot, chatId, userId, 'Произошла ошибка при загрузке твоих данных. Попробуй еще раз или обратись к администратору.');
    }
  });
}
