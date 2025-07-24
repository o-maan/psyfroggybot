#!/usr/bin/env bun

// Тестовый скрипт для проверки системы злых постов

import { bot, scheduler } from './src/bot';
import { logger } from './src/logger';

async function runTest() {
  logger.info('🧪 Запуск теста системы злых постов');
  
  // 1. Проверяем, что пользователь 5153477378 есть в базе
  const { getUserResponseStats } = await import('./src/db');
  const userStats = getUserResponseStats(5153477378);
  
  logger.info({
    userExists: !!userStats,
    lastResponseTime: userStats?.last_response_time,
    responseCount: userStats?.response_count
  }, '👤 Данные пользователя 5153477378');
  
  // 2. Проверяем настройки
  const checkDelay = process.env.ANGRY_POST_DELAY_MINUTES || 2;
  const channelId = scheduler.CHANNEL_ID;
  
  logger.info({
    checkDelayMinutes: checkDelay,
    channelId,
    channelIdFromEnv: process.env.CHANNEL_ID
  }, '⚙️ Настройки системы');
  
  // 3. Тестируем отправку поста
  logger.info('📤 Отправка тестового поста через /fro...');
  
  // Симулируем команду /fro
  const adminChatId = Number(process.env.ADMIN_CHAT_ID || 0);
  await scheduler.sendDailyMessage(adminChatId);
  
  logger.info(`⏰ Ожидаем проверку ответов через ${checkDelay} минут(ы)...`);
  logger.info('💡 Чтобы злой пост появился - НЕ пишите комментарий под постом!');
  
  // 4. Проверяем статус планировщика
  const status = scheduler.getSchedulerStatus();
  logger.info(status, '📊 Статус планировщика');
}

// Запускаем тест
runTest()
  .then(() => {
    logger.info('✅ Тест запущен успешно! Ожидайте результатов.');
    // Не закрываем процесс, чтобы таймер сработал
  })
  .catch(error => {
    logger.error(error, '❌ Ошибка при запуске теста');
    process.exit(1);
  });