import { Context, Telegraf } from 'telegraf';
import { botLogger, schedulerLogger } from '../logger';

interface RetryOptions {
  maxAttempts?: number;
  intervalMs?: number;
  onSuccess?: (result: any) => Promise<void>;
}

// Универсальная функция retry для callback обработчиков
export async function sendWithRetry(
  sendFunction: () => Promise<any>,
  context: {
    chatId: number;
    messageType: string;
    userId?: number;
  },
  options: RetryOptions = {}
): Promise<any> {
  const maxAttempts = options.maxAttempts || 10;
  const intervalMs = options.intervalMs || 5000;
  let attempt = 1;

  while (attempt <= maxAttempts) {
    try {
      schedulerLogger.info(
        {
          ...context,
          attempt,
          maxAttempts,
          intervalMs,
        },
        `🔄 Попытка отправки ${attempt}/${maxAttempts}`
      );

      // Пытаемся отправить
      const result = await sendFunction();

      // Успешно отправлено!
      schedulerLogger.info(
        {
          ...context,
          attempt,
          totalAttempts: maxAttempts,
        },
        `✅ Сообщение успешно отправлено с попытки ${attempt}/${maxAttempts}`
      );

      // Выполняем коллбэк после успешной отправки, если он есть
      if (options.onSuccess) {
        try {
          await options.onSuccess(result);
        } catch (callbackError) {
          schedulerLogger.error(
            {
              error: callbackError,
              ...context,
            },
            'Ошибка в коллбэке после успешной отправки'
          );
        }
      }

      return result;
    } catch (error) {
      const err = error as Error;

      // Проверяем, является ли это сетевой ошибкой
      if (
        err.message.includes('502') ||
        err.message.includes('Bad Gateway') ||
        err.message.includes('Network') ||
        err.message.includes('Timeout') ||
        err.message.includes('ETELEGRAM') ||
        err.message.includes('ECONNRESET') ||
        err.message.includes('ETIMEDOUT') ||
        err.message.includes('ENOTFOUND')
      ) {
        schedulerLogger.warn(
          {
            ...context,
            error: err.message,
            attempt,
            maxAttempts,
            nextDelayMs: intervalMs,
          },
          `⚠️ Сетевая ошибка, попытка ${attempt}/${maxAttempts}`
        );

        // Если есть еще попытки - ждем и пробуем снова
        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, intervalMs));
          attempt++;
          continue;
        } else {
          // Исчерпаны все попытки
          schedulerLogger.error(
            {
              ...context,
              totalAttempts: maxAttempts,
            },
            '❌ Исчерпаны все попытки отправки сообщения'
          );
          throw new Error(
            `Исчерпаны все ${maxAttempts} попыток отправки сообщения: ${err.message}`
          );
        }
      }

      // Не сетевая ошибка - пробрасываем сразу
      schedulerLogger.error(
        {
          ...context,
          error: err.message,
          attempt,
        },
        'Не сетевая ошибка, прекращаем попытки'
      );
      throw error;
    }
  }

  // Не должны сюда попасть, но на всякий случай
  throw new Error(`Исчерпаны все ${maxAttempts} попыток отправки сообщения`);
}

// Хелпер для callback обработчиков
export async function callbackSendWithRetry(
  ctx: Context,
  sendFunction: () => Promise<any>,
  messageType: string,
  options: RetryOptions = {}
): Promise<any> {
  const chatId = ctx.chat?.id || ctx.from?.id || 0;
  const userId = ctx.from?.id;
  
  return sendWithRetry(
    sendFunction,
    {
      chatId,
      userId,
      messageType,
    },
    options
  );
}

// Хелпер для обработчиков сценариев (где используется bot, а не ctx)
export async function scenarioSendWithRetry(
  bot: Telegraf,
  chatId: number,
  userId: number,
  sendFunction: () => Promise<any>,
  messageType: string,
  options: RetryOptions = {}
): Promise<any> {
  return sendWithRetry(
    sendFunction,
    {
      chatId,
      userId,
      messageType,
    },
    options
  );
}