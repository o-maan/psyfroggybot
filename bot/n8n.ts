import { createLogger } from './logger';
import { N8N_WEBHOOK_URL } from './env';

const logger = createLogger('n8n-client');

export interface WorkflowPayload {
  chat_id: number | string;
  user_id?: number;
  username?: string;
  text?: string;
  callback_data?: string;
  message_type?: string;
  timestamp: string;
  step_name?: string;
}

export interface WorkflowResponse {
  success: boolean;
  message?: string;
  data?: any;
}

export class N8nClient {
  private webhookUrl: string;

  constructor(webhookUrl: string = N8N_WEBHOOK_URL) {
    this.webhookUrl = webhookUrl;
    logger.info('N8n client initialized', { webhook_url: this.webhookUrl });
  }

  /**
   * Start a new workflow
   */
  async startWorkflow(payload: WorkflowPayload): Promise<WorkflowResponse> {
    try {
      logger.info('Starting workflow', { 
        chat_id: payload.chat_id,
        text: payload.text 
      });

      const payloadWithStringIds = {
        ...payload,
        chat_id: String(payload.chat_id),
        user_id: payload.user_id ? String(payload.user_id) : undefined,
      };

      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadWithStringIds)
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Workflow start failed', {
          status: response.status,
          error: errorText,
          payload
        });
        
        throw new Error(`n8n returned ${response.status}: ${errorText}`);
      }

      const result = await response.json().catch(() => ({}));
      
      logger.info('Workflow started successfully', { 
        chat_id: payload.chat_id,
        result 
      });

      return {
        success: true,
        data: result
      };
    } catch (error) {
      logger.error('Failed to start workflow', {
        error: error instanceof Error ? error.message : error,
        payload
      });
      throw error;
    }
  }

  /**
   * Resume a waiting workflow
   */
  async resumeWorkflow(resumeUrl: string, payload: WorkflowPayload): Promise<WorkflowResponse> {
    try {
      logger.info('Resuming workflow - preparing request', { 
        chat_id: payload.chat_id,
        step: payload.step_name,
        resume_url: resumeUrl
      });

      const payloadWithStringIds = {
        ...payload,
        chat_id: String(payload.chat_id),
        user_id: payload.user_id ? String(payload.user_id) : undefined,
      };

      logger.info('Sending HTTP request to resume webhook', {
        url: resumeUrl,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payloadWithStringIds
      });

      // Add timeout to the fetch request
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      const response = await fetch(resumeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadWithStringIds),
        signal: controller.signal
      }).catch(error => {
        logger.error('Fetch error during resume', {
          error: error instanceof Error ? {
            message: error.message,
            name: error.name,
            stack: error.stack
          } : error,
          resume_url: resumeUrl
        });
        throw error;
      });

      clearTimeout(timeoutId);

      logger.info('Received response from resume webhook', {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        url: response.url
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Workflow resume failed with non-OK status', {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
          resume_url: resumeUrl,
          payload
        });
        
        throw new Error(`n8n resume returned ${response.status}: ${errorText}`);
      }

      const responseText = await response.text();
      logger.info('Response body text', {
        chat_id: payload.chat_id,
        responseText: responseText.substring(0, 500) // Log first 500 chars
      });

      let result;
      try {
        result = JSON.parse(responseText);
      } catch (parseError) {
        logger.warn('Response is not JSON, using text as result', {
          chat_id: payload.chat_id,
          responseText
        });
        result = { message: responseText };
      }
      
      logger.info('Workflow resumed successfully', { 
        chat_id: payload.chat_id,
        result 
      });

      return {
        success: true,
        data: result
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        logger.error('Resume workflow timeout', {
          error: 'Request timed out after 30 seconds',
          resume_url: resumeUrl,
          payload
        });
      } else {
        logger.error('Failed to resume workflow', {
          error: error instanceof Error ? {
            message: error.message,
            name: error.name,
            stack: error.stack
          } : error,
          resume_url: resumeUrl,
          payload
        });
      }
      throw error;
    }
  }

  /**
   * Call a custom n8n webhook
   */
  async callWebhook(webhookUrl: string, data: any): Promise<any> {
    try {
      logger.info('Calling webhook', { url: webhookUrl });

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Webhook returned ${response.status}: ${errorText}`);
      }

      return await response.json().catch(() => ({}));
    } catch (error) {
      logger.error('Webhook call failed', {
        error: error instanceof Error ? error.message : error,
        webhook_url: webhookUrl
      });
      throw error;
    }
  }
}