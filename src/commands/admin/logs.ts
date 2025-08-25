import { Telegraf } from 'telegraf';
import { Scheduler } from '../../scheduler';
import { botLogger } from '../../logger';
import fs from 'fs';
import path from 'path';
import {
  getLogsCount,
  getLogsStatistics,
  getRecentLogs,
  getRecentLogsByLevel,
  getRecentUnreadInfoLogs,
  getRecentUnreadLogs,
  getUnreadLogsCount,
  markAllLogsAsRead,
  markLogAsRead,
  markLogsAsRead,
} from '../../db';

// Функция для создания временного файла с логами
function createTempLogFile(logs: any[], filename: string): string {
  try {
    const tempDir = path.join(process.cwd(), 'temp');

    botLogger.debug({ tempDir, filename, logsCount: logs.length }, 'Создаю временный файл логов');

    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
      botLogger.debug({ tempDir }, 'Создана директория temp');
    }

    const filePath = path.join(tempDir, filename);
    let content = '=== СИСТЕМНЫЕ ЛОГИ ===\n\n';

    logs.forEach((log, index) => {
      const timestamp = new Date(log.timestamp).toLocaleString('ru-RU', {
        timeZone: 'Europe/Moscow',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      content += `[${timestamp}] ${log.level.toUpperCase()} #${log.id}\n`;
      content += `Сообщение: ${log.message}\n`;

      if (log.data) {
        try {
          const data = JSON.parse(log.data);
          content += `Данные: ${JSON.stringify(data, null, 2)}\n`;
        } catch {
          content += `Данные: ${log.data}\n`;
        }
      }

      content += `Прочитано: ${log.is_read ? 'Да' : 'Нет'}\n`;
      content += '---\n\n';
    });

    fs.writeFileSync(filePath, content, 'utf8');
    botLogger.debug({ filePath, contentLength: content.length }, 'Файл логов создан');
    return filePath;
  } catch (error) {
    const err = error as Error;
    botLogger.error({ error: err.message, stack: err.stack, filename }, 'Ошибка создания файла логов');
    throw err;
  }
}

// Функция для очистки временных файлов
function cleanupTempFile(filePath: string) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    const err = error as Error;
    botLogger.warn({ error: err.message }, 'Не удалось удалить временный файл');
  }
}

// Функция для форматирования логов
function formatLogEntry(log: any, index: number): string {
  const levelEmojis: Record<string, string> = {
    trace: '🔍',
    debug: '🐛',
    info: '📝',
    warn: '⚠️',
    error: '❌',
    fatal: '💀',
  };

  const emoji = levelEmojis[log.level] || '📄';
  const timestamp = new Date(log.timestamp).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const readStatus = log.is_read ? '✅' : '🆕';

  let message = log.message;
  if (message.length > 100) {
    message = message.substring(0, 97) + '...';
  }

  let result = `${readStatus} ${emoji} <b>#${log.id}</b> [${timestamp}]\n<code>${message}</code>`;

  if (log.data) {
    try {
      const data = JSON.parse(log.data);
      const dataStr = JSON.stringify(data, null, 2);
      if (dataStr.length <= 200) {
        result += `\n<pre>${dataStr}</pre>`;
      } else {
        result += `\n<i>📎 Данные: ${dataStr.length} символов</i>`;
      }
    } catch {
      result += `\n<i>📎 Данные: ${log.data.length} символов</i>`;
    }
  }

  return result;
}

// Команда для просмотра логов
export function registerLogsCommand(bot: Telegraf, scheduler: Scheduler) {
  bot.command('logs', async ctx => {
    const chatId = ctx.chat.id;
    const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

    if (chatId !== adminChatId) {
      await ctx.reply('❌ Эта команда доступна только администратору');
      return;
    }

    try {
      // По умолчанию показываем только непрочитанные логи уровня INFO и выше
      const logs = getRecentUnreadInfoLogs(7, 0);
      const totalCount = getLogsCount();
      const unreadCount = getUnreadLogsCount();

      if (logs.length === 0) {
        await ctx.reply(
          '📝 <b>ЛОГИ СИСТЕМЫ</b>\n\n📭 Непрочитанные логи INFO+ отсутствуют\n\n💡 Используйте кнопку "🔍 Фильтр" для других уровней логов',
          {
            parse_mode: 'HTML',
          }
        );
        return;
      }

      let message = `📝 <b>ЛОГИ СИСТЕМЫ</b>\n\n`;
      message += `📊 Всего: ${totalCount} | 🆕 Непрочитано: ${unreadCount}\n`;
      message += `📄 Показано: ${logs.length} непрочитанных | 🔍 Фильтр: INFO и выше\n\n`;

      // Проверяем, не слишком ли большое сообщение получается
      let testMessage = message;
      logs.forEach((log, index) => {
        testMessage += formatLogEntry(log, index) + '\n\n';
      });

      const keyboard = {
        inline_keyboard: [
          [
            { text: '⬅️ Предыдущие', callback_data: 'logs_prev_0_info+' },
            { text: '📊 Статистика', callback_data: 'logs_stats' },
            { text: 'Следующие ➡️', callback_data: 'logs_next_7_info+' },
          ],
          [
            { text: '🔍 Фильтр', callback_data: 'logs_filter_menu' },
            { text: '✅ Прочитано', callback_data: 'logs_mark_visible_read' },
            { text: '🔄 Обновить', callback_data: 'logs_refresh_0_info+' },
          ],
          [{ text: '📁 Скачать как файл', callback_data: 'logs_download_0_info+' }],
        ],
      };

      // Если сообщение слишком длинное (> 3500 символов), отправляем файлом
      if (testMessage.length > 3500) {
        const timestamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '-');
        const filename = `logs_${timestamp}.txt`;
        const filePath = createTempLogFile(logs, filename);

        try {
          await ctx.replyWithDocument(
            { source: filePath, filename },
            {
              caption: `📝 <b>ЛОГИ СИСТЕМЫ</b>\n\n📊 Всего: ${totalCount} | 🆕 Непрочитано: ${unreadCount}\n📄 В файле: ${logs.length} записей | 🔍 Фильтр: Все`,
              parse_mode: 'HTML',
              reply_markup: keyboard,
            }
          );
        } finally {
          cleanupTempFile(filePath);
        }
      } else {
        logs.forEach((log, index) => {
          message += formatLogEntry(log, index) + '\n\n';
        });

        await ctx.reply(message, {
          parse_mode: 'HTML',
          reply_markup: keyboard,
        });
      }
    } catch (e) {
      const error = e as Error;
      botLogger.error({ error: error.message, stack: error.stack }, 'Ошибка команды /logs');
      await ctx.reply(`❌ Ошибка при получении логов:\n<code>${error}</code>`, {
        parse_mode: 'HTML',
      });
    }
  });

  // Обработчики callback для пагинации логов
  bot.action(/logs_(.+)_(\d+)_(.+)/, async ctx => {
    const chatId = ctx.chat?.id;
    const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

    if (chatId !== adminChatId) {
      await ctx.answerCbQuery('❌ Доступ запрещен');
      return;
    }

    const action = ctx.match![1];
    const offset = parseInt(ctx.match![2]);
    const levelFilter = ctx.match![3] === 'all' ? null : ctx.match![3];

    try {
      let newOffset = offset;

      switch (action) {
        case 'prev':
          newOffset = Math.max(0, offset - 7);
          break;
        case 'next':
          newOffset = offset + 7;
          break;
        case 'refresh':
          newOffset = offset;
          break;
        default:
          await ctx.answerCbQuery('❌ Неизвестное действие');
          return;
      }

      let logs;
      if (levelFilter === 'unread') {
        logs = getRecentUnreadLogs(7, newOffset);
      } else if (levelFilter === 'info+') {
        logs = getRecentUnreadInfoLogs(7, newOffset);
      } else if (levelFilter && levelFilter !== 'all') {
        logs = getRecentLogsByLevel(levelFilter, 7, newOffset);
      } else {
        logs = getRecentLogs(7, newOffset);
      }
      const totalCount = getLogsCount();
      const unreadCount = getUnreadLogsCount();
      const filterSuffix = levelFilter || 'all';
      let filterName: string;
      if (!levelFilter || levelFilter === 'all') {
        filterName = 'Все';
      } else if (levelFilter === 'unread') {
        filterName = 'Непрочитанные';
      } else if (levelFilter === 'info+') {
        filterName = 'INFO и выше';
      } else {
        filterName = levelFilter.toUpperCase();
      }

      if (logs.length === 0) {
        await ctx.answerCbQuery('📭 Логов больше нет');
        return;
      }

      let message = `📝 <b>ЛОГИ СИСТЕМЫ</b>\n\n`;
      message += `📊 Всего: ${totalCount} | 🆕 Непрочитано: ${unreadCount}\n`;
      message += `📄 Показано: ${logs.length} (позиция ${newOffset + 1}-${
        newOffset + logs.length
      }) | 🔍 Фильтр: ${filterName}\n\n`;

      logs.forEach((log, index) => {
        message += formatLogEntry(log, index) + '\n\n';
      });

      const keyboard = {
        inline_keyboard: [
          [
            { text: '⬅️ Предыдущие', callback_data: `logs_prev_${newOffset}_${filterSuffix}` },
            { text: '📊 Статистика', callback_data: 'logs_stats' },
            { text: 'Следующие ➡️', callback_data: `logs_next_${newOffset}_${filterSuffix}` },
          ],
          [
            { text: '🔍 Фильтр', callback_data: 'logs_filter_menu' },
            { text: '✅ Все прочитано', callback_data: 'logs_mark_all_read' },
            { text: '🔄 Обновить', callback_data: `logs_refresh_${newOffset}_${filterSuffix}` },
          ],
          [{ text: '📁 Скачать как файл', callback_data: `logs_download_${newOffset}_${filterSuffix}` }],
        ],
      };

      await ctx.editMessageText(message, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });

      await ctx.answerCbQuery();
    } catch (e) {
      const error = e as Error;
      botLogger.error({ error: error.message, stack: error.stack }, 'Ошибка навигации по логам');
      await ctx.answerCbQuery('❌ Ошибка при загрузке логов');
    }
  });

  // Обработчик для меню фильтров логов
  bot.action('logs_filter_menu', async ctx => {
    const chatId = ctx.chat?.id;
    const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

    if (chatId !== adminChatId) {
      await ctx.answerCbQuery('❌ Доступ запрещен');
      return;
    }

    const keyboard = {
      inline_keyboard: [
        [
          { text: '📄 Все', callback_data: 'logs_filter_all' },
          { text: '🆕 Непрочитанные', callback_data: 'logs_filter_unread' },
          { text: '📝 INFO+', callback_data: 'logs_filter_info+' },
        ],
        [
          { text: '🐛 DEBUG', callback_data: 'logs_filter_debug' },
          { text: '📝 INFO', callback_data: 'logs_filter_info' },
        ],
        [
          { text: '⚠️ WARN', callback_data: 'logs_filter_warn' },
          { text: '❌ ERROR', callback_data: 'logs_filter_error' },
          { text: '💀 FATAL', callback_data: 'logs_filter_fatal' },
        ],
        [{ text: '◀️ Назад к логам', callback_data: 'logs_refresh_0_info+' }],
      ],
    };

    await ctx.editMessageText('🔍 <b>ВЫБЕРИТЕ УРОВЕНЬ ЛОГОВ</b>', {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });

    await ctx.answerCbQuery();
  });

  // Обработчик для фильтрации логов по уровню
  bot.action(/logs_filter_(.+)/, async ctx => {
    const chatId = ctx.chat?.id;
    const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

    if (chatId !== adminChatId) {
      await ctx.answerCbQuery('❌ Доступ запрещен');
      return;
    }

    const level = ctx.match![1];
    const levelFilter = level === 'all' ? null : level;
    const filterSuffix = level;
    let filterName: string;

    if (level === 'all') {
      filterName = 'Все';
    } else if (level === 'unread') {
      filterName = 'Непрочитанные';
    } else if (level === 'info+') {
      filterName = 'INFO и выше';
    } else {
      filterName = level.toUpperCase();
    }

    try {
      let logs;
      if (level === 'unread') {
        logs = getRecentUnreadLogs(7, 0);
      } else if (level === 'info+') {
        logs = getRecentUnreadInfoLogs(7, 0);
      } else if (levelFilter && level !== 'all') {
        logs = getRecentLogsByLevel(levelFilter, 7, 0);
      } else {
        logs = getRecentLogs(7, 0);
      }

      const totalCount = getLogsCount();
      const unreadCount = getUnreadLogsCount();

      if (logs.length === 0) {
        await ctx.answerCbQuery('📭 Логов с таким фильтром нет');
        return;
      }

      let message = `📝 <b>ЛОГИ СИСТЕМЫ</b>\n\n`;
      message += `📊 Всего: ${totalCount} | 🆕 Непрочитано: ${unreadCount}\n`;

      const displayCount = level === 'unread' ? unreadCount : totalCount;
      message += `📄 Показано: ${logs.length} из ${displayCount} | 🔍 Фильтр: ${filterName}\n\n`;

      logs.forEach((log, index) => {
        message += formatLogEntry(log, index) + '\n\n';
      });

      const keyboard = {
        inline_keyboard: [
          [
            { text: '⬅️ Предыдущие', callback_data: `logs_prev_0_${filterSuffix}` },
            { text: '📊 Статистика', callback_data: 'logs_stats' },
            { text: 'Следующие ➡️', callback_data: `logs_next_7_${filterSuffix}` },
          ],
          [
            { text: '🔍 Фильтр', callback_data: 'logs_filter_menu' },
            { text: '✅ Прочитано', callback_data: 'logs_mark_visible_read' },
            { text: '🔄 Обновить', callback_data: `logs_refresh_0_${filterSuffix}` },
          ],
          [{ text: '📁 Скачать как файл', callback_data: `logs_download_0_${filterSuffix}` }],
        ],
      };

      await ctx.editMessageText(message, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });

      await ctx.answerCbQuery(`🔍 Фильтр: ${filterName}`);
    } catch (e) {
      const error = e as Error;
      botLogger.error({ error: error.message, stack: error.stack }, 'Ошибка фильтрации логов');
      await ctx.answerCbQuery('❌ Ошибка при фильтрации логов');
    }
  });

  // Обработчик для статистики логов
  bot.action('logs_stats', async ctx => {
    const chatId = ctx.chat?.id;
    const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

    if (chatId !== adminChatId) {
      await ctx.answerCbQuery('❌ Доступ запрещен');
      return;
    }

    try {
      const stats = getLogsStatistics();
      const totalCount = getLogsCount();
      const unreadCount = getUnreadLogsCount();

      let message = `📊 <b>СТАТИСТИКА ЛОГОВ</b>\n\n`;
      message += `📄 Всего логов: ${totalCount}\n`;
      message += `🆕 Непрочитано: ${unreadCount}\n\n`;
      message += `<b>По уровням:</b>\n`;

      stats.forEach(stat => {
        const levelEmojis: Record<string, string> = {
          trace: '🔍',
          debug: '🐛',
          info: '📝',
          warn: '⚠️',
          error: '❌',
          fatal: '💀',
        };

        const emoji = levelEmojis[stat.level] || '📄';
        const percentage = ((stat.count / totalCount) * 100).toFixed(1);
        message += `${emoji} ${stat.level.toUpperCase()}: ${stat.count} (${percentage}%)`;
        if (stat.unread_count > 0) {
          message += ` | 🆕 ${stat.unread_count}`;
        }
        message += '\n';
      });

      const keyboard = {
        inline_keyboard: [[{ text: '◀️ Назад к логам', callback_data: 'logs_refresh_0_all' }]],
      };

      await ctx.editMessageText(message, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });

      await ctx.answerCbQuery();
    } catch (e) {
      const error = e as Error;
      botLogger.error({ error: error.message, stack: error.stack }, 'Ошибка статистики логов');
      await ctx.answerCbQuery('❌ Ошибка при загрузке статистики');
    }
  });

  // Обработчик для отметки всех логов как прочитанных
  bot.action('logs_mark_all_read', async ctx => {
    const chatId = ctx.chat?.id;
    const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

    if (chatId !== adminChatId) {
      await ctx.answerCbQuery('❌ Доступ запрещен');
      return;
    }

    try {
      markAllLogsAsRead();
      await ctx.answerCbQuery('✅ Все логи помечены как прочитанные');

      // Обновляем сообщение
      const logs = getRecentLogs(7, 0);
      const totalCount = getLogsCount();
      const unreadCount = getUnreadLogsCount();

      let message = `📝 <b>ЛОГИ СИСТЕМЫ</b>\n\n`;
      message += `📊 Всего: ${totalCount} | 🆕 Непрочитано: ${unreadCount}\n`;
      message += `📄 Показано: ${logs.length} из ${totalCount} | 🔍 Фильтр: Все\n\n`;

      logs.forEach((log, index) => {
        // Принудительно устанавливаем is_read = true для отображения
        log.is_read = true;
        message += formatLogEntry(log, index) + '\n\n';
      });

      const keyboard = {
        inline_keyboard: [
          [
            { text: '⬅️ Предыдущие', callback_data: 'logs_prev_0_all' },
            { text: '📊 Статистика', callback_data: 'logs_stats' },
            { text: 'Следующие ➡️', callback_data: 'logs_next_7_all' },
          ],
          [
            { text: '🔍 Фильтр', callback_data: 'logs_filter_menu' },
            { text: '✅ Все прочитано', callback_data: 'logs_mark_all_read' },
            { text: '🔄 Обновить', callback_data: 'logs_refresh_0_all' },
          ],
          [{ text: '📁 Скачать как файл', callback_data: 'logs_download_0_all' }],
        ],
      };

      await ctx.editMessageText(message, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } catch (e) {
      const error = e as Error;
      botLogger.error({ error: error.message, stack: error.stack }, 'Ошибка отметки всех логов');
      await ctx.answerCbQuery('❌ Ошибка при отметке логов');
    }
  });

  // Обработчик для отметки видимых логов как прочитанных
  bot.action('logs_mark_visible_read', async ctx => {
    const chatId = ctx.chat?.id;
    const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

    if (chatId !== adminChatId) {
      await ctx.answerCbQuery('❌ Доступ запрещен');
      return;
    }

    try {
      // Нужно получить информацию о текущем состоянии логов из сообщения
      // Это сложно сделать из callback, поэтому пока сделаем simple approach

      // Получаем последние 7 непрочитанных INFO+ логов (текущие видимые по умолчанию)
      const logs = getRecentUnreadInfoLogs(7, 0);

      if (logs.length === 0) {
        await ctx.answerCbQuery('📭 Нет видимых логов для пометки');
        return;
      }

      // Помечаем все видимые логи как прочитанные
      const logIds = logs.map(log => log.id);
      markLogsAsRead(logIds);

      await ctx.answerCbQuery(`✅ Помечено ${logs.length} логов как прочитанные`);

      // Обновляем сообщение, показывая те же логи но уже как прочитанные
      const totalCount = getLogsCount();
      const unreadCount = getUnreadLogsCount();

      let message = `📝 <b>ЛОГИ СИСТЕМЫ</b>\n\n`;
      message += `📊 Всего: ${totalCount} | 🆕 Непрочитано: ${unreadCount}\n`;
      message += `📄 Показано: ${logs.length} логов (помечены как прочитанные) | 🔍 Фильтр: Просмотренные\n\n`;

      // Принудительно показываем логи как прочитанные
      logs.forEach((log, index) => {
        log.is_read = true;
        message += formatLogEntry(log, index) + '\n\n';
      });

      const keyboard = {
        inline_keyboard: [
          [
            { text: '⬅️ Предыдущие', callback_data: 'logs_prev_0_info+' },
            { text: '📊 Статистика', callback_data: 'logs_stats' },
            { text: 'Следующие ➡️', callback_data: 'logs_next_7_info+' },
          ],
          [
            { text: '🔍 Фильтр', callback_data: 'logs_filter_menu' },
            { text: '✅ Уже прочитано', callback_data: 'logs_mark_visible_read' },
            { text: '🔄 Обновить', callback_data: 'logs_refresh_0_info+' },
          ],
          [{ text: '📁 Скачать как файл', callback_data: 'logs_download_0_info+' }],
        ],
      };

      await ctx.editMessageText(message, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } catch (e) {
      const error = e as Error;
      botLogger.error({ error: error.message, stack: error.stack }, 'Ошибка отметки видимых логов');
      await ctx.answerCbQuery('❌ Ошибка при отметке логов');
    }
  });

  // Обработчик для отметки отдельного лога как прочитанного
  bot.action(/log_read_(\d+)/, async ctx => {
    const chatId = ctx.chat?.id;
    const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

    if (chatId !== adminChatId) {
      await ctx.answerCbQuery('❌ Доступ запрещен');
      return;
    }

    const logId = parseInt(ctx.match![1]);

    try {
      markLogAsRead(logId);
      await ctx.answerCbQuery(`✅ Лог #${logId} помечен как прочитанный`);
    } catch (e) {
      const error = e as Error;
      botLogger.error({ error: error.message, stack: error.stack }, 'Ошибка отметки одного лога');
      await ctx.answerCbQuery('❌ Ошибка при отметке лога');
    }
  });

  // Обработчик для скачивания логов файлом
  bot.action(/logs_download_(\d+)_(.+)/, async ctx => {
    const chatId = ctx.chat?.id;
    const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);

    if (chatId !== adminChatId) {
      await ctx.answerCbQuery('❌ Доступ запрещен');
      return;
    }

    const offset = parseInt(ctx.match![1]);
    const levelFilter = ctx.match![2] === 'all' ? null : ctx.match![2];

    try {
      await ctx.answerCbQuery('📥 Подготавливаю файл...');

      // Получаем больше логов для файла (например, последние 100)
      let logs;
      if (levelFilter === 'unread') {
        logs = getRecentUnreadLogs(100, offset);
      } else if (levelFilter === 'info+') {
        logs = getRecentUnreadInfoLogs(100, offset);
      } else if (levelFilter && levelFilter !== 'all') {
        logs = getRecentLogsByLevel(levelFilter, 100, offset);
      } else {
        logs = getRecentLogs(100, offset);
      }

      if (logs.length === 0) {
        await ctx.reply('📭 Логи для скачивания отсутствуют');
        return;
      }

      const timestamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '-');
      const filterSuffix = levelFilter ? `_${levelFilter}` : '';
      const filename = `logs${filterSuffix}_${timestamp}.txt`;
      const filePath = createTempLogFile(logs, filename);

      try {
        await ctx.replyWithDocument(
          { source: filePath, filename },
          {
            caption: `📁 <b>Экспорт логов</b>\n\n📄 Записей в файле: ${logs.length}\n🔍 Фильтр: ${
              levelFilter ? levelFilter.toUpperCase() : 'Все'
            }\n📅 Создан: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`,
            parse_mode: 'HTML',
          }
        );
      } finally {
        cleanupTempFile(filePath);
      }
    } catch (e) {
      const error = e as Error;
      botLogger.error({ error: error.message, stack: error.stack }, 'Ошибка скачивания логов');
      await ctx.reply(`❌ Ошибка при создании файла логов:\n<code>${error.message}</code>`, {
        parse_mode: 'HTML',
      });
    }
  });
}