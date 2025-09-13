#!/usr/bin/env bun
import { env } from './env';
import { createLogger } from './logger';
import { N8nClient } from './n8n';
import { createApiServer } from './server';
import { SessionManager } from './session';
import { TelegramBot } from './telegram';

const logger = createLogger('main');

async function main() {
  try {
    logger.info('🤖 Starting PsyFroggyBot with Wait node support...');
    logger.info('Configuration', {
      n8n_webhook: env.N8N_WEBHOOK_URL,
      api_port: env.PORT,
      redis: env.REDIS_URL,
      log_level: env.LOG_LEVEL,
      node_env: env.NODE_ENV,
    });

    // Initialize services
    const sessionManager = new SessionManager();
    await sessionManager.connect();
    logger.info('✅ Session manager connected');

    const n8nClient = new N8nClient(env.N8N_WEBHOOK_URL);
    logger.info('✅ N8n client initialized');

    // Create a new string to avoid readonly property issues
    const botToken = env.TELEGRAM_BOT_TOKEN;
    const bot = new TelegramBot(botToken, sessionManager, n8nClient);
    logger.info('✅ Telegram bot initialized');

    // Initialize and start API server
    const apiServer = createApiServer(sessionManager, bot);
    apiServer.listen(env.PORT, '0.0.0.0', () => {
      logger.info(`📡 API server listening on http://0.0.0.0:${env.PORT}`);
    });

    // Start bot
    await bot.launch();
    logger.info('✅ Bot is running!');
    logger.info('💡 Commands: /start, /stop, /status, /help');

    // Graceful shutdown
    process.once('SIGINT', () => {
      logger.info('SIGINT received, stopping...');
      bot.stop('SIGINT');
      process.exit(0);
    });

    process.once('SIGTERM', () => {
      logger.info('SIGTERM received, stopping...');
      bot.stop('SIGTERM');
      process.exit(0);
    });
  } catch (error) {
    logger.error('Failed to start bot', {
      error:
        error instanceof Error
          ? {
              message: error.message,
              stack: error.stack,
            }
          : error,
    });
    process.exit(1);
  }
}

// Run the bot
main().catch(error => {
  logger.error('Unhandled error in main', {
    error:
      error instanceof Error
        ? {
            message: error.message,
            stack: error.stack,
          }
        : error,
  });
  process.exit(1);
});
