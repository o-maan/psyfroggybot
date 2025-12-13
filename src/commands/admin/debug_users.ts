import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';
import { db } from '../../db';

/**
 * Команда /debug_users - ПОЛНАЯ диагностика пользователей
 *
 * Показывает ВСЕ поля для каждого пользователя:
 * - chat_id, username, name, gender
 * - dm_enabled, channel_enabled, channel_id
 * - timezone, city, onboarding_state
 * - Находится ли в планировщике
 */
export function registerDebugUsersCommand(bot: Telegraf, scheduler: Scheduler) {
  bot.command('debug_users', async ctx => {
    const chatId = ctx.chat.id;
    const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

    // ⚠️ ВРЕМЕННО: команда доступна ВСЕМ (для диагностики)
    // Позже вернуть проверку админа
    // if (chatId !== adminChatId) {
    //   await ctx.reply('❌ Эта команда доступна только администратору');
    //   return;
    // }

    try {
      // Получаем ВСЕХ пользователей с ПОЛНОЙ информацией
      const users = db.query(`
        SELECT
          chat_id,
          username,
          name,
          gender,
          dm_enabled,
          channel_enabled,
          channel_id,
          timezone,
          city,
          onboarding_state,
          response_count,
          last_response_time
        FROM users
        WHERE chat_id > 0
        ORDER BY chat_id DESC
      `).all() as Array<{
        chat_id: number;
        username: string | null;
        name: string | null;
        gender: string | null;
        dm_enabled: number;
        channel_enabled: number;
        channel_id: number | null;
        timezone: string | null;
        city: string | null;
        onboarding_state: string | null;
        response_count: number;
        last_response_time: string | null;
      }>;

      let message = `🔍 <b>ПОЛНАЯ ДИАГНОСТИКА ПОЛЬЗОВАТЕЛЕЙ</b>\n\n`;
      message += `Всего пользователей: ${users.length}\n\n`;

      // Получаем информацию о планировщике
      const schedulerStatus = scheduler.getSchedulerStatus();
      message += `📊 <b>Планировщик:</b>\n`;
      message += `├─ Всего в памяти: ${schedulerStatus.totalUsers}\n`;
      message += `├─ Timezone групп: ${schedulerStatus.timezoneGroups}\n\n`;

      users.forEach((user, index) => {
        message += `<b>${index + 1}. ID ${user.chat_id}</b>\n`;

        // Основная информация
        if (user.name) message += `├─ 👤 Имя: ${user.name}\n`;
        if (user.username) message += `├─ 📝 Username: @${user.username}\n`;
        if (user.gender) message += `├─ ⚧ Пол: ${user.gender}\n`;

        // Режимы доставки
        message += `├─ 📬 ЛС: ${user.dm_enabled ? '✅' : '❌'}\n`;
        message += `├─ 📢 Канал: ${user.channel_enabled ? '✅' : '❌'}\n`;
        if (user.channel_id) {
          message += `├─ 📺 Channel ID: <code>${user.channel_id}</code>\n`;
        } else {
          message += `├─ 📺 Channel ID: NULL\n`;
        }

        // Локация и онбординг
        if (user.timezone) message += `├─ 🌍 Timezone: ${user.timezone}\n`;
        if (user.city) message += `├─ 🏙 Город: ${user.city}\n`;
        if (user.onboarding_state) {
          message += `├─ 🎯 Онбординг: ${user.onboarding_state}\n`;
        } else {
          message += `├─ 🎯 Онбординг: завершен ✅\n`;
        }

        // Статистика
        message += `└─ 💬 Ответов: ${user.response_count || 0}\n`;

        message += '\n';
      });

      // Отправляем сообщение (может быть длинным - разбиваем)
      const maxLength = 4000;
      if (message.length <= maxLength) {
        await ctx.reply(message, { parse_mode: 'HTML' });
      } else {
        // Разбиваем на части
        const parts = [];
        let currentPart = '';
        const lines = message.split('\n');

        for (const line of lines) {
          if ((currentPart + line + '\n').length > maxLength) {
            parts.push(currentPart);
            currentPart = line + '\n';
          } else {
            currentPart += line + '\n';
          }
        }
        if (currentPart) parts.push(currentPart);

        for (const part of parts) {
          await ctx.reply(part, { parse_mode: 'HTML' });
        }
      }
    } catch (error) {
      await ctx.reply(`❌ Ошибка: ${(error as Error).message}`);
    }
  });
}
