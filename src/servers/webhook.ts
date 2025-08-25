import express, { Request, Response } from 'express';
import { Scheduler } from '../scheduler';
import { logger } from '../logger';

// --- Express сервер для webhook ---
export function createWebhookServer(scheduler: Scheduler) {
  const app = express();
  app.use(express.json());

  // Webhook endpoint для вызова после деплоя
  app.post('/webhook/deploy', async (req: Request, res: Response) => {
    try {
      logger.info('🚀 Получен webhook о деплое, запускаем проверку незавершенных заданий...');

      // Вызываем проверку незавершенных заданий
      await scheduler.checkUncompletedTasks();

      res.json({ success: true, message: 'Deploy webhook processed' });
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Ошибка обработки webhook деплоя');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Health check endpoint
  app.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', bot: 'running' });
  });

  // Запускаем Express сервер
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    logger.info({ port: PORT }, `🌐 Express сервер запущен на порту ${PORT}`);
  });

  return app;
}