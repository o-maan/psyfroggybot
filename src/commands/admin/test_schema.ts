import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';
import { botLogger } from '../../logger';

// Команда для проверки кнопки skip_schema
export function registerTestSchemaCommand(bot: Telegraf, scheduler: Scheduler) {
  bot.command('test_schema', async ctx => {
    const chatId = ctx.chat.id;
    const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

    // Проверяем, что команду выполняет админ
    if (chatId !== adminChatId) {
      await ctx.reply('❌ Эта команда доступна только администратору');
      return;
    }

    try {
      // Создаем тестовый channelMessageId
      const testChannelMessageId = Date.now();

      // Отправляем тестовое сообщение со схемой и кнопкой пропуска
      const schemaText = `📝 <b>Тестовая схема разбора ситуации</b>

Давай разложим самую беспокоящую ситуацию по схеме:

1. <b>Ситуация</b> - что произошло?
2. <b>Эмоции</b> - что я чувствую?
3. <b>Мысли</b> - о чем думаю?
4. <b>Действия</b> - что делаю или хочу сделать?

<i>Это тестовое сообщение для проверки кнопки пропуска схемы.</i>`;

      await ctx.reply(schemaText, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: 'Пропустить', callback_data: `skip_schema_${testChannelMessageId}` }]],
        },
      });

      // Создаем тестовую запись в БД
      const { db } = await import('../../db');
      db.run(
        `
        INSERT OR REPLACE INTO interactive_posts
        (channel_message_id, user_id, created_at, task1_completed, task2_completed, task3_completed)
        VALUES (?, ?, datetime('now'), 1, 0, 0)
      `,
        [testChannelMessageId, chatId]
      );

      await ctx.reply(
        `✅ Тестовая схема отправлена!\n\n` +
          `Test Channel Message ID: <code>${testChannelMessageId}</code>\n\n` +
          `Нажмите кнопку "Пропустить" для проверки обработчика.`,
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      const err = error as Error;
      botLogger.error({ error: err.message }, 'Ошибка команды /test_schema');
      await ctx.reply(`❌ Ошибка: ${err.message}`);
    }
  });
}