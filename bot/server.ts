import express from 'express';
import { createLogger } from './logger';
import { SessionManager } from './session';
import { TelegramBot } from './telegram';

const logger = createLogger('api-server');

export function createApiServer(sessionManager: SessionManager, bot: TelegramBot) {
  const app = express();
  app.use(express.json());

  // Endpoint for n8n to register a wait state with resume URL
  app.post('/api/register-wait', async (req, res) => {
    const { chatId, resumeUrl, executionId, webhookSuffix, stepName, message, reply_markup } = req.body;

    try {
      // Build the resume URL from executionId and webhookSuffix if not provided directly
      let finalResumeUrl = resumeUrl;
      if (!resumeUrl && executionId && webhookSuffix) {
        // Construct the webhook-waiting URL
        // Format: http://localhost:5678/webhook-waiting/{executionId}{webhookSuffix}
        finalResumeUrl = `http://localhost:5678/webhook-waiting/${executionId}${webhookSuffix}`;
      }

      logger.info('Register wait state', {
        body: req.body,
        chatId: chatId,
        stepName,
        resumeUrl: finalResumeUrl,
        executionId,
        webhookSuffix,
      });

      // Store the resume URL for this chat
      await sessionManager.setResumeUrl(chatId, finalResumeUrl, stepName);

      // Send message to user via bot
      if (message) {
        if (reply_markup) {
          await bot.telegram.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup,
          });
        } else {
          await bot.telegram.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
          });
        }
      }

      res.json({ success: true });
    } catch (error) {
      logger.error('Error in register-wait', {
        error: error instanceof Error ? error.message : error,
      });
      res.status(500).json({ error: 'Failed to register wait state' });
    }
  });

  // Endpoint for n8n to send a message without waiting
  app.post('/api/send-message', async (req, res) => {
    const { chatId, message, reply_markup, clear_session } = req.body;

    try {
      logger.info('Send message', {
        chat_id: chatId,
        clear_session,
      });

      // Send message via bot
      if (reply_markup) {
        await bot.telegram.sendMessage(chatId, message, {
          parse_mode: 'Markdown',
          reply_markup,
        });
      } else {
        await bot.telegram.sendMessage(chatId, message, {
          parse_mode: 'Markdown',
        });
      }

      // Clear session if requested (e.g., at workflow end)
      if (clear_session) {
        await sessionManager.clearSession(chatId);
        await sessionManager.clearWorkflowData(chatId);
      }

      res.json({ success: true });
    } catch (error) {
      logger.error('Error in send-message', {
        error: error instanceof Error ? error.message : error,
      });
      res.status(500).json({ error: 'Failed to send message' });
    }
  });

  // Endpoint to serve prompt files
  app.get('/api/prompts/:filename', async (req, res) => {
    const { filename } = req.params;

    try {
      // Security: only allow .json files from prompts directory
      if (!filename.endsWith('.json')) {
        return res.status(400).json({ error: 'Only JSON files are allowed' });
      }

      // Read the prompt file
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const promptPath = path.join(process.cwd(), 'prompts', filename);

      // Check if file exists
      try {
        await fs.access(promptPath);
      } catch {
        return res.status(404).json({ error: 'Prompt file not found' });
      }

      // Read and parse the prompt file
      const content = await fs.readFile(promptPath, 'utf-8');
      let promptData = JSON.parse(content);

      // Add current date to the prompt
      const currentDate = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
      const dateInstruction = `\n\n---\nIMPORTANT: Today's date is ${currentDate}. Use this date for any temporal references, when searching for recent events, or when the current date/time context is needed in your analysis. When searching for recent events, prioritize information from ${currentDate.substring(
        0,
        7
      )} (current month) and recent months.`;

      // Add date context to the prompt
      if (typeof promptData === 'object' && !Array.isArray(promptData)) {
        // Add date context field (for metadata)
        promptData.current_date = currentDate;
        promptData.date_context = `Today's date is ${currentDate}. Use this date for any temporal references or when the current date is needed in your analysis.`;

        // Add date to actual prompt text fields that will be sent to LLM
        if (promptData.task) {
          promptData.task += dateInstruction;
        }

        if (promptData.description) {
          promptData.description += dateInstruction;
        }

        if (promptData.context) {
          promptData.context += dateInstruction;
        }

        if (promptData.instructions) {
          if (typeof promptData.instructions === 'string') {
            promptData.instructions += dateInstruction;
          } else if (typeof promptData.instructions === 'object') {
            promptData.instructions.date_context = `Current date: ${currentDate}`;
          }
        }

        // For prompts that have a main 'prompt' field
        if (promptData.prompt) {
          promptData.prompt += dateInstruction;
        }

        // For prompts with 'system' field
        if (promptData.system) {
          promptData.system += dateInstruction;
        }
      } else if (typeof promptData === 'string') {
        // If the whole prompt is just a string
        promptData += dateInstruction;
      }

      // Return the prompt content with date
      res.json({ prompt: promptData });
    } catch (error) {
      logger.error('Error serving prompt file', {
        filename,
        error: error instanceof Error ? error.message : error,
      });
      res.status(500).json({ error: 'Failed to load prompt file' });
    }
  });

  // Get active sessions (for debugging)
  app.get('/api/sessions', async (_req, res) => {
    try {
      const sessions = await sessionManager.listActiveSessions();
      res.json({ sessions });
    } catch (error) {
      logger.error('Error listing sessions', {
        error: error instanceof Error ? error.message : error,
      });
      res.status(500).json({ error: 'Failed to list sessions' });
    }
  });

  // Health check
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'psyfroggybot-api',
    });
  });

  return app;
}
