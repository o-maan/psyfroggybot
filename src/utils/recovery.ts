import { Telegraf } from 'telegraf';
import { getUsersWithUnansweredMessages, getLastNMessages, saveMessage } from '../db';
import { generateUserResponse } from '../llm';
import { getUserTodayEvents } from '../calendar';
import { logger } from '../logger';

// Проверяем, тестовый ли это бот
const IS_TEST_BOT = process.env.IS_TEST_BOT === 'true';
const MAIN_CHANNEL_ID = -1002405993986;
const MAIN_CHAT_ID = -1002496122257;

/**
 * Восстановление ответов после перезапуска бота
 * Находит всех пользователей с необработанными сообщениями
 * и отправляет ОДИН ответ на последнее сообщение каждому
 *
 * ВАЖНО: Тестовый бот НЕ работает с основным каналом/группой
 */
export async function recoverUnansweredMessages(bot: Telegraf) {
  try {
    logger.info('🔄 Начинаем восстановление необработанных сообщений...');

    // Получаем всех пользователей с необработанными сообщениями
    const usersWithUnanswered = getUsersWithUnansweredMessages();

    if (usersWithUnanswered.length === 0) {
      logger.info('✅ Нет необработанных сообщений для восстановления');
      return;
    }

    logger.info(
      { usersCount: usersWithUnanswered.length },
      `📝 Найдено пользователей с необработанными сообщениями: ${usersWithUnanswered.length}`
    );

    // Обрабатываем каждого пользователя
    for (const user of usersWithUnanswered) {
      try {
        // Определяем куда отправлять ответ
        const replyToChatId = user.message_chat_id || user.chat_id;

        // ВАЖНО: Если тестовый бот - пропускаем сообщения из основного канала/группы
        if (IS_TEST_BOT && (replyToChatId === MAIN_CHANNEL_ID || replyToChatId === MAIN_CHAT_ID)) {
          logger.debug(
            { chatId: user.chat_id, replyToChatId },
            '⏭️ Тестовый бот пропускает сообщения из основного канала/группы'
          );
          continue;
        }

        logger.info(
          {
            chatId: user.chat_id,
            username: user.username,
            lastMessageTime: user.last_message_time,
            messagePreview: user.last_message.substring(0, 50),
          },
          `💬 Восстанавливаем ответ для пользователя ${user.username || user.chat_id}`
        );

        // Получаем последние 7 сообщений для контекста
        const lastMessages = getLastNMessages(user.chat_id, 7);

        // Форматируем историю сообщений
        const conversationHistory = lastMessages
          .reverse()
          .map(msg => {
            const date = new Date(msg.sent_time).toLocaleString('ru-RU', {
              timeZone: 'Europe/Moscow',
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            });
            const author = msg.author_id === 0 ? 'Бот' : msg.username || 'Пользователь';
            return `[${date}] ${author}: ${msg.message_text}`;
          })
          .join('\n');

        // Получаем события календаря
        const calendarEvents = await getUserTodayEvents(user.chat_id);

        // Генерируем ответ
        const textResponse = await generateUserResponse(
          user.last_message,
          conversationHistory,
          calendarEvents || undefined
        );

        // Отправляем ответ
        if (user.telegram_message_id && user.message_chat_id) {
          // Если есть ID сообщения - отвечаем с reply
          await bot.telegram.sendMessage(replyToChatId, textResponse, {
            reply_parameters: {
              message_id: user.telegram_message_id,
              chat_id: user.message_chat_id,
            },
          });
        } else {
          // Иначе просто отправляем в чат
          await bot.telegram.sendMessage(replyToChatId, textResponse);
        }

        // Сохраняем ответ в БД
        const botResponseTime = new Date().toISOString();
        saveMessage(user.chat_id, textResponse, botResponseTime, 0);

        logger.info(
          { chatId: user.chat_id, username: user.username },
          `✅ Ответ восстановлен для ${user.username || user.chat_id}`
        );

        // Небольшая задержка между отправками, чтобы не перегружать API
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        const err = error as Error;
        logger.error(
          {
            error: err.message,
            stack: err.stack,
            chatId: user.chat_id,
            username: user.username,
          },
          `❌ Ошибка восстановления ответа для ${user.username || user.chat_id}`
        );

        // Отправляем fallback ответ
        try {
          const fallbackMessage = 'Спасибо, что поделился! 🤍';
          const replyToChatId = user.message_chat_id || user.chat_id;

          if (user.telegram_message_id && user.message_chat_id) {
            await bot.telegram.sendMessage(replyToChatId, fallbackMessage, {
              reply_parameters: {
                message_id: user.telegram_message_id,
                chat_id: user.message_chat_id,
              },
            });
          } else {
            await bot.telegram.sendMessage(replyToChatId, fallbackMessage);
          }

          const fallbackTime = new Date().toISOString();
          saveMessage(user.chat_id, fallbackMessage, fallbackTime, 0);

          logger.info({ chatId: user.chat_id }, '✅ Отправлен fallback ответ');
        } catch (fallbackError) {
          logger.error(
            { error: (fallbackError as Error).message, chatId: user.chat_id },
            '❌ Не удалось отправить даже fallback ответ'
          );
        }
      }
    }

    logger.info(
      { processedUsers: usersWithUnanswered.length },
      '🎉 Восстановление необработанных сообщений завершено'
    );
  } catch (error) {
    const err = error as Error;
    logger.error(
      { error: err.message, stack: err.stack },
      '❌ Критическая ошибка при восстановлении необработанных сообщений'
    );
  }
}
