import { botLogger } from '../../logger';
import type { BotContext } from '../../types';

// Общий обработчик для всех callback_query (для отладки)
export async function handleCallbackQuery(ctx: BotContext, next: () => Promise<void>) {
  const data = 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
  const chatId = ctx.callbackQuery.message?.chat?.id;

  botLogger.info(
    {
      callbackData: data,
      fromId: ctx.from?.id,
      chatId: chatId,
      messageId: ctx.callbackQuery.message?.message_id,
      isPracticeDone: data?.startsWith('practice_done_'),
      isPracticePostpone: data?.startsWith('practice_postpone_'),
    },
    '🔔 Получен callback_query'
  );

  // Проверяем, что callback обрабатывается
  if (data?.startsWith('practice_')) {
    botLogger.info(
      {
        callbackData: data,
        willBeHandled: true,
      },
      '✅ Callback будет обработан'
    );
  }

  return next();
}