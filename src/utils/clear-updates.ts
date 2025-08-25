import { logger } from '../logger';

// НЕ очищаем pending updates - пусть Telegraf их обработает
export async function clearPendingUpdates() {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return;

    // Получаем информацию o webhook
    const webhookResponse = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    const webhookData = await webhookResponse.json();

    if (webhookData.ok && webhookData.result.pending_update_count > 0) {
      logger.info(
        {
          pendingCount: webhookData.result.pending_update_count,
        },
        '🔄 Найдены pending updates, Telegraf их обработает'
      );
    } else {
      logger.info('✅ Очередь updates пуста');
    }
  } catch (error) {
    logger.warn({ error: (error as Error).message }, '⚠️ Не удалось проверить очередь updates');
  }
}