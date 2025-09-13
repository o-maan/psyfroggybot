import type { Context } from 'telegraf';
import { Telegraf } from 'telegraf';
import { createLogger } from './logger';
import { N8nClient, WorkflowPayload } from './n8n';
import { SessionManager } from './session';

const logger = createLogger('telegram');

export interface BotContext extends Context {
  sessionManager?: SessionManager;
  n8nClient?: N8nClient;
}

export class TelegramBot {
  private bot: Telegraf<BotContext>;
  private sessionManager: SessionManager;
  private n8nClient: N8nClient;

  constructor(token: string, sessionManager: SessionManager, n8nClient: N8nClient) {
    this.bot = new Telegraf<BotContext>(token);
    this.sessionManager = sessionManager;
    this.n8nClient = n8nClient;

    // Add session manager and n8n client to context
    this.bot.use((ctx, next) => {
      ctx.sessionManager = this.sessionManager;
      ctx.n8nClient = this.n8nClient;
      return next();
    });

    this.setupHandlers();
  }

  private setupHandlers() {
    // Command handlers
    this.bot.command('start', this.handleStart.bind(this));
    this.bot.command('stop', this.handleStop.bind(this));
    this.bot.command('status', this.handleStatus.bind(this));
    this.bot.command('help', this.handleHelp.bind(this));

    // Text message handler (excluding commands)
    this.bot.on('text', async ctx => {
      // Skip if it's a command
      if (ctx.message && 'text' in ctx.message && ctx.message.text.startsWith('/')) {
        return;
      }
      await this.handleMessage(ctx);
    });

    // Callback query handler
    this.bot.on('callback_query', this.handleMessage.bind(this));

    // Error handler
    this.bot.catch((err, ctx) => {
      logger.error('Bot error', {
        error:
          err instanceof Error
            ? {
                message: err.message,
                stack: err.stack,
              }
            : err,
        chat_id: ctx.chat?.id,
      });
      ctx.reply('❌ An error occurred. Please try again.').catch(() => {});
    });
  }

  private async handleStart(ctx: BotContext) {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    logger.info('Start command', { chat_id: chatId });

    // Clear any existing session
    await this.sessionManager.clearSession(chatId);
    await this.sessionManager.clearWorkflowData(chatId);

    // Start new workflow with /start command
    try {
      const messageData = this.extractMessageData(ctx);
      const result = await this.n8nClient.startWorkflow(messageData);
      logger.info('Workflow started from /start command', {
        chat_id: chatId,
        success: result.success,
        data: result.data,
      });
    } catch (error) {
      logger.error('Error starting workflow from /start', {
        error:
          error instanceof Error
            ? {
                message: error.message,
                stack: error.stack,
              }
            : error,
        chat_id: chatId,
      });
      await ctx.reply('❌ Failed to start workflow. Please try again.');
    }
  }

  private async handleStop(ctx: BotContext) {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    logger.info('Stop command', { chat_id: chatId });

    // Clear session
    await this.sessionManager.clearSession(chatId);
    await this.sessionManager.clearWorkflowData(chatId);

    await ctx.reply('✅ Session cleared. Use /start to begin a new session.');
  }

  private async handleStatus(ctx: BotContext) {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const session = await this.sessionManager.getSession(chatId);

    if (session) {
      await ctx.reply(
        `📊 *Session Status*\n\n` +
          `Step: ${session.stepName}\n` +
          `Started: ${session.timestamp}\n` +
          `Status: Waiting for input`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await ctx.reply('No active session. Use /start to begin.');
    }
  }

  private async handleHelp(ctx: BotContext) {
    await ctx.reply(
      `🤖 *PsyFroggyBot Commands*\n\n` +
        `/start - Start new article generation\n` +
        `/stop - Cancel current session\n` +
        `/status - Check session status\n` +
        `/help - Show this help message`,
      { parse_mode: 'Markdown' }
    );
  }

  async handleMessage(ctx: BotContext) {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    try {
      // Extract message data
      const messageData = this.extractMessageData(ctx);
      logger.info('Processing message', {
        chat_id: chatId,
        text: messageData.text,
        message_type: messageData.message_type,
      });

      // Check if we have an active session with resume URL
      const session = await this.sessionManager.getSession(chatId);
      logger.info('Session state', {
        chat_id: chatId,
        has_session: !!session,
        step_name: session?.stepName,
        has_resume_url: !!session?.resumeUrl,
        resume_url: session?.resumeUrl,
      });

      if (session && session.resumeUrl) {
        // We have a waiting workflow - resume it
        logger.info('Preparing to resume workflow', {
          chat_id: chatId,
          step: session.stepName,
          resume_url: session.resumeUrl,
        });

        const payload: WorkflowPayload = {
          ...messageData,
          step_name: session.stepName,
        };

        logger.info('Calling resumeWorkflow', {
          chat_id: chatId,
          payload,
        });

        // Resume the workflow
        const result = await this.n8nClient.resumeWorkflow(session.resumeUrl, payload);

        logger.info('Resume workflow result', {
          chat_id: chatId,
          success: result.success,
          data: result.data,
        });

        // Clear the session after successful resume
        // n8n will register a new wait state if needed
        await this.sessionManager.clearSession(chatId);
        logger.info('Session cleared after resume', { chat_id: chatId });
      } else {
        // No active session - start new workflow
        logger.info('Starting new workflow', { chat_id: chatId });

        // Start new workflow
        const result = await this.n8nClient.startWorkflow(messageData);
        logger.info('Start workflow result', {
          chat_id: chatId,
          success: result.success,
          data: result.data,
        });
      }
    } catch (error) {
      logger.error('Error handling message', {
        error:
          error instanceof Error
            ? {
                message: error.message,
                stack: error.stack,
              }
            : error,
        chat_id: chatId,
      });
      await ctx.reply('❌ An error occurred. Please try again or use /start to restart.');
    }
  }

  private extractMessageData(ctx: any): WorkflowPayload {
    const chatId = ctx.chat?.id || 0;
    const message = ctx.message || ctx.callbackQuery?.message;
    const callbackQuery = ctx.callbackQuery;

    return {
      chat_id: chatId,
      user_id: ctx.from?.id,
      username: ctx.from?.username,
      text: message?.text || callbackQuery?.data,
      callback_data: callbackQuery?.data,
      message_type: ctx.updateType,
      timestamp: new Date().toISOString(),
    };
  }

  async launch() {
    await this.bot.launch();
    logger.info('Bot launched successfully');
  }

  stop(signal?: string) {
    this.bot.stop(signal);
    logger.info('Bot stopped', { signal });
  }

  // Getter for telegram instance (for API server)
  get telegram() {
    return this.bot.telegram;
  }
}
