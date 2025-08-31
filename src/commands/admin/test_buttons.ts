import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';
import { botLogger } from '../../logger';

// Тестовая команда для проверки кнопок в комментариях
export function registerTestButtonsCommand(bot: Telegraf, scheduler: Scheduler) {
  bot.command('test_buttons', async ctx => {
    const chatId = ctx.chat.id;
    const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

    // Проверяем, что команду выполняет админ
    if (chatId !== adminChatId) {
      await ctx.reply('❌ Эта команда доступна только администратору');
      return;
    }

    try {
      // Отправляем тестовый пост в канал
      const CHANNEL_ID = scheduler.CHANNEL_ID;

      const testMessage = await bot.telegram.sendMessage(
        CHANNEL_ID,
        '🧪 <b>ТЕСТОВЫЙ ПОСТ ДЛЯ ПРОВЕРКИ КНОПОК</b>\n\n' +
          'Это тестовое сообщение для проверки работы кнопок в комментариях.\n\n' +
          '⬇️ Кнопки должны появиться в комментариях ниже',
        { parse_mode: 'HTML' }
      );

      const messageId = testMessage.message_id;

      // Ждем немного
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Отправляем кнопки в группу обсуждений
      const CHAT_ID = scheduler.getChatId();

      if (!CHAT_ID) {
        await ctx.reply('❌ CHAT_ID не настроен в .env');
        return;
      }

      // Формируем URL для перехода в комментарии
      const commentUrl = `https://t.me/c/${CHANNEL_ID.toString().slice(4)}/${messageId}?thread=${messageId}`;

      const keyboard = {
        inline_keyboard: [
          [{ text: '💬 Написать ответ', url: commentUrl }],
          [{ text: '✅ Все ок - пропустить', callback_data: 'daily_skip_all' }],
        ],
      };

      const buttonMessage = await bot.telegram.sendMessage(
        CHAT_ID,
        '🧪 Тестовые кнопки:\n\n' +
          `Channel ID: ${CHANNEL_ID}\n` +
          `Message ID: ${messageId}\n` +
          `Comment URL: ${commentUrl}`,
        {
          reply_markup: keyboard,
        }
      );

      await ctx.reply(
        '✅ Тестовый пост отправлен!\n\n' +
          `📢 Channel ID: <code>${CHANNEL_ID}</code>\n` +
          `💬 Chat ID: <code>${CHAT_ID}</code>\n` +
          `📝 Message ID: <code>${messageId}</code>\n` +
          `🔗 URL: <code>${commentUrl}</code>`,
        { parse_mode: 'HTML' }
      );
      
      // Отправляем последнюю картинку из фильтров
      await ctx.reply('📸 Последняя картинка из массива фильтров (Туннельное видение):');
      const lastFilterId = 'AgACAgIAAxkBAAIF9Gi0ij7wfJoLrBApRaBXfRSeKB2DAAK-9jEbGZqoSYqi4i1O6U0lAQADAgADeQADNgQ';
      await ctx.replyWithPhoto(lastFilterId);
    } catch (error) {
      const err = error as Error;
      botLogger.error({ error: err.message, stack: err.stack }, 'Ошибка команды /test_buttons');
      await ctx.reply(`❌ Ошибка: ${err.message}`);
    }
  });
}