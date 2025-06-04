// PM2 config (instead of docker)
require('dotenv').config(); // Загружаем .env файл в PM2

module.exports = {
  apps: [{
    name: 'psy_froggy_bot',
    script: './src/bot.ts',
    interpreter: 'bun',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3456,
      WEBHOOK_PORT: 3456,
      SERVER_PORT: 3456,
      // Читаем все переменные из .env
      TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
      HF_TOKEN: process.env.HF_TOKEN,
      ADMIN_CHAT_ID: process.env.ADMIN_CHAT_ID,
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
      // База данных будет в /var/www/databases/psy_froggy_bot/
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3456,
      SERVER_PORT: 3456,
      // В production переменные должны быть в системе или .env
      TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
      HF_TOKEN: process.env.HF_TOKEN,
      ADMIN_CHAT_ID: process.env.ADMIN_CHAT_ID,
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
    },
    log_file: '/var/log/pm2/psy_froggy_bot.log',
    out_file: '/var/log/pm2/psy_froggy_bot-out.log',
    error_file: '/var/log/pm2/psy_froggy_bot-error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    // Graceful shutdown
    kill_timeout: 5000,
    listen_timeout: 10000,
    // Restart delay
    restart_delay: 4000,
    // Health check
    health_check_http: {
      path: '/status',
      port: 3456,
      max_restarts: 3,
      grace_period: 30000
    }
  }]
}; 