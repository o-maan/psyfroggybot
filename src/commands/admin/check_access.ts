import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';
import { botLogger } from '../../logger';

// Команда для проверки доступа к каналам
export function registerCheckAccessCommand(bot: Telegraf, scheduler: Scheduler) {
  bot.command('check_access', async ctx => {
    const chatId = ctx.chat.id;
    const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

    // Проверяем, что команду выполняет админ
    if (chatId !== adminChatId) {
      await ctx.reply('❌ Эта команда доступна только администратору');
      return;
    }

    const channelId = scheduler.CHANNEL_ID;
    const groupId = scheduler.getChatId();

    let message = `🔍 <b>Проверка доступа бота</b>\n\n`;
    message += `🤖 Тестовый режим: ${scheduler.isTestBot() ? 'ДА' : 'НЕТ'}\n`;
    message += `📢 ID канала: <code>${channelId}</code>\n`;
    message += `💬 ID группы: <code>${groupId}</code>\n\n`;

    // Проверяем доступ к каналу
    try {
      const channelInfo = await bot.telegram.getChat(channelId);
      message += `✅ Доступ к каналу: ЕСТЬ\n`;
      message += `   Название: ${('title' in channelInfo ? channelInfo.title : undefined) || 'Без названия'}\n`;
      message += `   Тип: ${channelInfo.type}\n`;
    } catch (error) {
      const err = error as Error;
      message += `❌ Доступ к каналу: НЕТ\n`;
      message += `   Ошибка: ${err.message}\n`;
    }

    // Проверяем доступ к группе
    if (groupId) {
      try {
        const groupInfo = await bot.telegram.getChat(groupId);
        message += `\n✅ Доступ к группе: ЕСТЬ\n`;
        message += `   Название: ${('title' in groupInfo ? groupInfo.title : undefined) || 'Без названия'}\n`;
        message += `   Тип: ${groupInfo.type}\n`;
      } catch (error) {
        const err = error as Error;
        message += `\n❌ Доступ к группе: НЕТ\n`;
        message += `   Ошибка: ${err.message}\n`;
      }
    } else {
      message += `\n⚠️ ID группы не настроен\n`;
    }

    // Проверяем права администратора в канале
    try {
      const botInfo = await bot.telegram.getMe();
      const member = await bot.telegram.getChatMember(channelId, botInfo.id);
      message += `\n📋 Статус бота в канале: ${member.status}\n`;
      if (member.status === 'administrator') {
        message += `   ✅ Права администратора\n`;
      }
    } catch (error) {
      const err = error as Error;
      message += `\n❌ Не удалось проверить права: ${err.message}\n`;
    }

    await ctx.reply(message, { parse_mode: 'HTML' });
  });
}