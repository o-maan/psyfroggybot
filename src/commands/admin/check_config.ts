import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';

// Команда для проверки конфигурации утренней проверки
export function registerCheckConfigCommand(bot: Telegraf, scheduler: Scheduler) {
  bot.command('check_config', async ctx => {
    const chatId = ctx.chat.id;
    const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

    // Проверяем, что команду выполняет админ
    if (chatId !== adminChatId) {
      await ctx.reply('❌ Эта команда доступна только администратору');
      return;
    }

    const TARGET_USER_ID = scheduler.getTargetUserId();
    const status = scheduler.getSchedulerStatus();

    // Проверяем существование файлов промптов
    const fs = require('fs');
    const textPromptExists = fs.existsSync('assets/prompts/no-answer');
    const imagePromptExists = fs.existsSync('assets/prompts/frog-image-promt-angry');

    await ctx.reply(
      `🔧 <b>КОНФИГУРАЦИЯ УТРЕННЕЙ ПРОВЕРКИ</b>\n\n` +
        `👤 Целевой пользователь: <code>${TARGET_USER_ID}</code>\n` +
        `📢 Канал для постов: <code>${scheduler.CHANNEL_ID}</code>\n` +
        `⏰ Время проверки: <b>8:00 МСК</b>\n` +
        `☀️ Статус утренней проверки: ${status.isMorningRunning ? '🟢 Активна' : '🔴 Остановлена'}\n\n` +
        `📄 <b>Файлы промптов:</b>\n` +
        `├─ Текст (no-answer): ${textPromptExists ? '✅ Найден' : '❌ Не найден'}\n` +
        `└─ Изображение (frog-image-promt-angry): ${imagePromptExists ? '✅ Найден' : '❌ Не найден'}\n\n` +
        `🕐 Текущее время МСК: <code>${status.currentTime}</code>`,
      { parse_mode: 'HTML' }
    );
  });
}