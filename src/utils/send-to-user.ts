/**
 * Централизованная функция для отправки сообщений пользователю
 *
 * КРИТИЧЕСКИ ВАЖНО: ВСЕГДА используй эту функцию вместо bot.telegram.sendMessage()
 * для отправки сообщений пользователю, чтобы автоматически адаптировать текст под пол
 */

import type { Telegraf } from 'telegraf';
import { getUserByChatId } from '../db';
import { adaptTextForGender } from './gender-adapter';
import { botLogger } from '../logger';

/**
 * Отправляет сообщение с автоматической адаптацией под пол пользователя
 *
 * Автоматически:
 * 1. Получает пол пользователя из БД (если userId передан)
 * 2. Адаптирует текст под женский пол (если нужно)
 * 3. Заменяет {userName} на реальное имя
 * 4. Отправляет сообщение через Telegram API
 *
 * @param bot - Экземпляр Telegraf бота
 * @param chatId - ID чата для отправки
 * @param userId - ID пользователя для получения данных (пол, имя). Если null/undefined - отправка без адаптации
 * @param text - Текст сообщения
 * @param options - Опции для sendMessage (reply_parameters, parse_mode и т.д.)
 * @returns Promise с результатом отправки
 */
export async function sendToUser(
  bot: Telegraf,
  chatId: number,
  userId: number | null | undefined,
  text: string,
  options?: any
) {
  // Если userId не передан - отправляем как есть (админские уведомления, системные сообщения)
  if (!userId) {
    botLogger.debug(
      { chatId, textLength: text.length },
      'Отправка сообщения без адаптации (нет userId)'
    );
    return await bot.telegram.sendMessage(chatId, text, options);
  }

  // Получаем данные пользователя
  const user = getUserByChatId(userId);
  const userGender = (user?.gender || 'unknown') as 'male' | 'female' | 'unknown' | null;
  const userName = user?.name || null;

  botLogger.debug(
    {
      chatId,
      userId,
      userGender,
      userName,
      textLength: text.length
    },
    'Отправка сообщения пользователю с адаптацией'
  );

  // Адаптируем текст под пол (если женский - меняем окончания)
  let adaptedText = adaptTextForGender(text, userGender);

  // Заменяем {userName} если есть в тексте
  if (userName) {
    adaptedText = adaptedText.replace(/\{userName\}/g, userName);
  }

  // Отправляем через стандартный API Telegram
  return await bot.telegram.sendMessage(chatId, adaptedText, options);
}
