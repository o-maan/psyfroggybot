import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables
dotenv.config();

// Environment schema
const envSchema = z.object({
  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),

  // N8N
  N8N_WEBHOOK_URL: z.string().default('http://localhost:5678/webhook/bot-start'),

  // Bot API
  PORT: z.string().default('3001').transform(Number),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),

  // Optional
  ADMIN_CHAT_ID: z.string().optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

// Parse and validate environment variables
const parseResult = envSchema.safeParse(process.env);

if (!parseResult.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parseResult.error.format());
  process.exit(1);
}

export const env = parseResult.data;

// Export individual variables for convenience
export const { TELEGRAM_BOT_TOKEN, N8N_WEBHOOK_URL, PORT, REDIS_URL, LOG_LEVEL, ADMIN_CHAT_ID, NODE_ENV } = env;
